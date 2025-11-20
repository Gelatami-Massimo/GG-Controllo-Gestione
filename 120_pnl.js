// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 120_pnl.js
// VERSIONE: 28.0 (P&L Engine - Column Validation Refactoring)
// DESCRIZIONE: Crea un P&L dinamico Multi-Anno per GLOBALE e per SEDE.
//              Uses UTIL.date.getShortMonthName() for month name generation.
//              REFACTORED: 3 try/catch blocks replaced with ERROR_HANDLER.safely()
//              REFACTORED: Column validation loop replaced with UTIL.checkColumns()
// Novità v28:
// - Validazione colonne con UTIL.checkColumns() (più conciso e chiaro)
// Novità v27:
// - Integrazione ERROR_HANDLER.safely() per operazioni formatting non-critiche
// - Eliminati 3 blocchi try/catch duplicati (-18 righe boilerplate)
// Novità v23:
// - Ordinamento famiglie (prefisso numerico -> alfa) con "Non Categorizzato" in coda
// - Normalizzazione robusta FornitoreID (IT + zeri) con UTIL.normKey
// - Riga (B) - COSTI FORNITORI (NETTI) e riga "MOL % (MOL/Ricavi)"
// - Formati: valuta per valori monetari, percentuale per MOL %
// - Letture ottimizzate e maggiore resilienza
// =============================================================

// Dependencies (legacy style - no ModuleRegistry)
const ERROR_HANDLER = GG.get('ERROR_HANDLER');

/**
 * Crea o aggiorna il foglio 'Conto Economico Riclassificato'
 */
function createPnlSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'Conto Economico Riclassificato';
  UTIL.showToast(`Aggiornamento ${sheetName}...`, 'Conto Economico', 10);

  const VOCE_FATTURATO = 'FATTURATO';
  const VOCE_CEDOLINI = '3 Cedolini'; // Nome fisso per costo personale

  let sh = ss.getSheetByName(sheetName);
  if (!sh) { sh = ss.insertSheet(sheetName, 0); }

  // Pulizia robusta
  sh.clear();
  sh.getCharts().forEach(chart => sh.removeChart(chart));
  try { sh.setFrozenRows(0); sh.setFrozenColumns(0); } catch (e) {}
  try { sh.getDataRange().breakApart(); } catch(e){} // Rimuove merge

  // --- 1. CARICAMENTO DATI ---
  const dataMensili = _getDatiMensiliBySede();
  const famiglieFornitori = _getFamiglieFornitori();
  const costiAggregati = _getAggregatedCostsBySede(famiglieFornitori);

  // --- 2. PREPARAZIONE STRUTTURA DATI P&L ---
  const pnlPerSede = new Map();
  const pnlGlobale = new Map();
  const tutteLeFamiglie = new Set(['Non Categorizzato']);
  const tuttiIMesi = new Set();
  const tutteLeSedi = new Set([...dataMensili.keys(), ...costiAggregati.keys()]);

  // Inizializzazione strutture dati
  pnlGlobale.set(VOCE_FATTURATO, new Map());
  pnlGlobale.set(VOCE_CEDOLINI, new Map());
  tutteLeSedi.forEach(sede => {
    const sedeMap = new Map();
    sedeMap.set(VOCE_FATTURATO, new Map());
    sedeMap.set(VOCE_CEDOLINI, new Map());
    pnlPerSede.set(sede, sedeMap);
  });

  // Popola Fatturato e Costo Personale da Dati Mensili
  dataMensili.forEach((mesi, sede) => {
    mesi.forEach((dati, annoMese) => {
      tuttiIMesi.add(annoMese);
      const { fatturato, personale } = dati;
      const sedePnl = pnlPerSede.get(sede);
      sedePnl.get(VOCE_FATTURATO)?.set(annoMese, (sedePnl.get(VOCE_FATTURATO)?.get(annoMese) ?? 0) + fatturato);
      sedePnl.get(VOCE_CEDOLINI)?.set(annoMese, (sedePnl.get(VOCE_CEDOLINI)?.get(annoMese) ?? 0) + personale);
      // Aggrega anche nel globale
      pnlGlobale.get(VOCE_FATTURATO).set(annoMese, (pnlGlobale.get(VOCE_FATTURATO).get(annoMese) ?? 0) + fatturato);
      pnlGlobale.get(VOCE_CEDOLINI).set(annoMese, (pnlGlobale.get(VOCE_CEDOLINI).get(annoMese) ?? 0) + personale);
    });
  });

  // Popola Costi Fornitori per Famiglia da Fatture
  costiAggregati.forEach((mesi, sede) => {
    const sedePnl = pnlPerSede.get(sede);
    mesi.forEach((costiPerFamiglia, annoMese) => {
      tuttiIMesi.add(annoMese);
      costiPerFamiglia.forEach((costoNetto, famiglia) => {
        tutteLeFamiglie.add(famiglia); // Aggiunge la famiglia all'elenco generale
        if (!sedePnl.has(famiglia)) { sedePnl.set(famiglia, new Map()); }
        if (!pnlGlobale.has(famiglia)) { pnlGlobale.set(famiglia, new Map()); }
        // Aggrega per sede
        sedePnl.get(famiglia).set(annoMese, (sedePnl.get(famiglia).get(annoMese) ?? 0) + costoNetto);
        // Aggrega nel globale
        pnlGlobale.get(famiglia).set(annoMese, (pnlGlobale.get(famiglia).get(annoMese) ?? 0) + costoNetto);
      });
    });
  });

  // Ordina le famiglie e i mesi per la scrittura
  let famiglieOrdinate = _sortFamilies([...tutteLeFamiglie], VOCE_CEDOLINI);
  const mesiOrdinati = [...tuttiIMesi].sort(); // Ordine cronologico YYYY-MM

  if (mesiOrdinati.length === 0) {
    sh.getRange('A1').setValue('Nessun dato temporale trovato per generare il P&L.');
    LOG.warn('PNL_SHEET', 'Nessun mese trovato in Dati Mensili o Fatture.');
    return;
  }

  // --- 3. SCRITTURA FOGLIO ---
  try {
    sh.setFrozenRows(1);
    sh.setFrozenColumns(1);
    let currentRow = 1;
    const currencyFormat = '€ #,##0.00;[Red](€ #,##0.00);€ 0.00'; // Formato valuta
    const percentFormat  = '0.00%';

    // Trova tutti gli anni disponibili e ordinali in modo decrescente
    const anniDisponibili = [...new Set(mesiOrdinati.map(m => m.split('-')[0]))].sort((a, b) => b.localeCompare(a));

    // Scrive una sezione per ogni anno
    anniDisponibili.forEach((anno, index) => {
      if (index > 0) currentRow += 2; // Spazio tra anni
      const mesiDellAnno = mesiOrdinati.filter(m => m.startsWith(anno));
      if (mesiDellAnno.length === 0) return; // Salta anni senza mesi

      // Costruisce l'header dinamico per l'anno corrente
      const headerRowAnno = ['Voce/Mese', `Totale ${anno}`];
      mesiDellAnno.forEach(am => headerRowAnno.push(_meseIntToNome(am.split('-')[1], anno.slice(-2)))); // Es: 'Gen '24'

      // Sezione GLOBALE
      currentRow = _writePnlSection(
        sh, currentRow, `CONTO ECONOMICO RICLASSIFICATO - GLOBALE (Anno ${anno})`,
        pnlGlobale, famiglieOrdinate, mesiDellAnno, headerRowAnno, VOCE_FATTURATO, VOCE_CEDOLINI, currencyFormat, percentFormat
      );
      currentRow += 3; // Spazio prima della prossima sezione

      // Sezioni per SEDE (ordine alfabetico)
      [...tutteLeSedi].sort().forEach(sede => {
        const pnlDataSede = pnlPerSede.get(sede);
        let sedeHaDatiAnno = false;
        if (pnlDataSede) {
          // Verifica se ci sono dati *per questo anno specifico* per la sede
          sedeHaDatiAnno = mesiDellAnno.some(meseAnno =>
            Array.from(pnlDataSede.values()).some(mesiValori => mesiValori.has(meseAnno) && mesiValori.get(meseAnno) !== 0)
          );
        }
        // Scrive la sezione solo se ci sono dati per quell'anno
        if (sedeHaDatiAnno) {
          currentRow = _writePnlSection(
            sh, currentRow, `CONTO ECONOMICO RICLASSIFICATO - SEDE: ${sede} (Anno ${anno})`,
            pnlDataSede, famiglieOrdinate, mesiDellAnno, headerRowAnno, VOCE_FATTURATO, VOCE_CEDOLINI, currencyFormat, percentFormat
          );
          currentRow += 3; // Spazio
        }
      });
    });

    // Ridimensionamento finale
    if (sh.getLastRow() > 1 && sh.getLastColumn() > 1) {
      // Trova il numero massimo di colonne usate in qualsiasi anno
      const maxColsUsed = anniDisponibili.reduce((max, anno) => {
        const mesiDellAnno = mesiOrdinati.filter(m => m.startsWith(anno));
        return Math.max(max, 2 + mesiDellAnno.length); // Voce + Totale + Mesi
      }, 1);
      if (maxColsUsed > 1) {
        ERROR_HANDLER.safely(
          () => sh.autoResizeColumns(1, Math.min(sh.getMaxColumns(), maxColsUsed)),
          { scope: 'PNL_RESIZE', message: 'Impossibile ridimensionare automaticamente le colonne.' }
        );
      }
    }

    LOG.info('PNL_SHEET', `P&L Dinamico (Globale + Sedi per ${anniDisponibili.length} anni) scritto con successo.`);
    UTIL.showToast(`P&L Dinamico "${sheetName}" aggiornato!`, 'Completato', 10);
    ss.setActiveSheet(sh);

  } catch (e) {
    LOG.error('PNL_SHEET', `Errore during la scrittura del P&L Dinamico.`, { error: e.message, stack: e.stack });
    throw new Error(`Errore creazione P&L Dinamico: ${e.message}`);
  }
}


/**
 * Scrive una sezione completa di P&L sul foglio.
 * CORRETTO: Usa mappa header -> colonna per formule dinamiche.
 * Aggiunge (B) COSTI FORNITORI NETTI e riga "MOL %".
 * @private
 */
function _writePnlSection(sheet, currentRow, title, pnlData, famiglieOrdinate, mesiDellAnno, headerRowAnno, VOCE_FATTURATO, VOCE_CEDOLINI, currencyFormat, percentFormat) {
  const headerNames = headerRowAnno; // ['Voce/Mese', 'Totale 2024', 'Gen '24', ...]
  const numCols = headerNames.length;
  const headerDataRow = currentRow + 1;

  // --- Mappa Nome Header -> Lettera Colonna ---
  const headerMap = {}; // Es: { 'Voce/Mese': 'A', 'Totale 2024': 'B', 'Gen '24': 'C', ... }
  headerNames.forEach((name, index) => {
    if (name) {
      headerMap[name] = UTIL.getColumnLetter(index); // index 0 -> 'A', 1 -> 'B'
    }
  });
  // Identifica la prima e l'ultima colonna dei mesi
  const firstMonthColIndex = 2; // Indice 0-based della prima colonna mese ('C')
  const lastMonthColIndex = headerNames.length - 1; // Indice 0-based dell'ultima colonna mese
  const firstMonthColLetter = UTIL.getColumnLetter(firstMonthColIndex);
  const lastMonthColLetter = UTIL.getColumnLetter(lastMonthColIndex);
  // Trova dinamicamente la lettera della colonna Totale (dovrebbe essere la seconda)
  const totalColHeader = headerNames[1]; // Es: 'Totale 2024'
  const totalColLetter = headerMap[totalColHeader];

  if (!totalColLetter || !firstMonthColLetter || !lastMonthColLetter) {
      throw new Error("Impossibile determinare le colonne Totale Anno o Mesi.");
  }
  // --- FINE MAPPA ---

  // Titolo
  if (numCols > 1) {
    sheet.getRange(currentRow, 2, 1, numCols - 1).merge().setValue(title).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#e0e0e0');
  } else {
    sheet.getRange(currentRow, 1).setValue(title).setFontWeight('bold');
  }

  // Header Dati
  sheet.getRange(headerDataRow, 1, 1, numCols).setValues([headerRowAnno]).setFontWeight('bold');
  currentRow = headerDataRow + 1;

  // (A) Fatturato
  const rigaFatturato = currentRow;
  sheet.getRange(rigaFatturato, 1).setValue(VOCE_FATTURATO).setFontWeight('bold');
  _writePnlRow(sheet, pnlData.get(VOCE_FATTURATO), rigaFatturato, mesiDellAnno, headerMap, totalColLetter, firstMonthColLetter, lastMonthColLetter);
  currentRow++;

  // Totale Ricavi (Formula)
  const rigaTotRicavi = currentRow;
  sheet.getRange(rigaTotRicavi, 1).setValue('(A) - TOTALE RICAVI').setFontWeight('bold').setBackground('#f3f3f3');
  _writeFormulaRow(sheet, rigaTotRicavi, `${totalColLetter}${rigaFatturato}`, headerMap, mesiDellAnno, '#f3f3f3');
  currentRow += 2; // Spazio

  // Costi per Famiglia (escluso Cedolini)
  const rigaInizioCostiForn = currentRow;
  famiglieOrdinate.forEach(famiglia => {
    if (famiglia === VOCE_CEDOLINI) return; // Salta cedolini qui
    sheet.getRange(currentRow, 1).setValue(famiglia);
    _writePnlRow(sheet, pnlData.get(famiglia), currentRow, mesiDellAnno, headerMap, totalColLetter, firstMonthColLetter, lastMonthColLetter);
    currentRow++;
  });
  const rigaFineCostiForn = currentRow - 1;

  // (B) - COSTI FORNITORI (NETTI)
  let rigaTotForn = null;
  if (rigaInizioCostiForn <= rigaFineCostiForn) {
    rigaTotForn = currentRow;
    sheet.getRange(rigaTotForn, 1).setValue('(B) - COSTI FORNITORI (NETTI)').setFontWeight('bold').setBackground('#f3f3f3');
    _writeFormulaRow(sheet, rigaTotForn, `SUM(${totalColLetter}${rigaInizioCostiForn}:${totalColLetter}${rigaFineCostiForn})`, headerMap, mesiDellAnno, '#f3f3f3');
    currentRow += 2; // Spazio
  }

  // Riga Costo Personale (Cedolini)
  const rigaCostoPers = currentRow;
  sheet.getRange(rigaCostoPers, 1).setValue(VOCE_CEDOLINI); // Sempre presente
  _writePnlRow(sheet, pnlData.get(VOCE_CEDOLINI), rigaCostoPers, mesiDellAnno, headerMap, totalColLetter, firstMonthColLetter, lastMonthColLetter);
  currentRow++;
  currentRow++; // Spazio

  // (C) - TOTALE COSTI = (B) + Cedolini (o solo Cedolini se non ci sono costi fornitori)
  const rigaTotCosti = currentRow;
  sheet.getRange(rigaTotCosti, 1).setValue('(C) - TOTALE COSTI').setFontWeight('bold').setBackground('#f3f3f3');
  const formulaSommaCosti = rigaTotForn
    ? `${totalColLetter}${rigaTotForn}+${totalColLetter}${rigaCostoPers}`
    : `${totalColLetter}${rigaCostoPers}`; // Se non ci sono costi forn, Tot Costi = Costo Personale
  _writeFormulaRow(sheet, rigaTotCosti, formulaSommaCosti, headerMap, mesiDellAnno, '#f3f3f3');
  currentRow += 2; // Spazio

  // (A-C) - MOL
  const rigaMOL = currentRow;
  sheet.getRange(rigaMOL, 1).setValue('MOL (A-C)').setFontWeight('bold').setBackground('#e0e0e0');
  _writeFormulaRow(sheet, rigaMOL, `${totalColLetter}${rigaTotRicavi}-${totalColLetter}${rigaTotCosti}`, headerMap, mesiDellAnno, '#e0e0e0');
  currentRow++;

  // MOL % (MOL/Ricavi)
  const rigaMOLPerc = currentRow;
  sheet.getRange(rigaMOLPerc, 1).setValue(`MOL % (MOL/Ricavi)`).setFontWeight('bold');
  _writeFormulaRow(sheet, rigaMOLPerc, `IFERROR(${totalColLetter}${rigaMOL}/${totalColLetter}${rigaTotRicavi},0)`, headerMap, mesiDellAnno, null);
  currentRow++;

  // Formattazione
  const firstDataRow = headerDataRow + 1; // Prima riga con dati (Fatturato)
  const lastFormatRow = rigaMOL; // Ultima riga con valori monetari
  if (firstDataRow <= lastFormatRow && numCols > 1) {
    ERROR_HANDLER.safely(
      () => sheet.getRange(firstDataRow, 2, (lastFormatRow - firstDataRow + 1), numCols - 1).setNumberFormat(currencyFormat),
      { scope: 'PNL_FORMAT', message: `Errore formato valuta sezione ${title}` }
    );
  }
   if (numCols > 1) {
      ERROR_HANDLER.safely(
        () => sheet.getRange(rigaMOLPerc, 2, 1, numCols - 1).setNumberFormat(percentFormat),
        { scope: 'PNL_FORMAT', message: `Errore formato percentuale sezione ${title}` }
      );
   }

  return currentRow; // Prossima riga libera
}


/**
 * Scrive una riga di dati P&L (valori numerici).
 * CORRETTO: Usa lettere colonne passate per formula Totale Anno.
 * @private
 */
function _writePnlRow(sheet, dataMap, rowNum, mesiDellAnno, headerMap, totalColLetter, firstMonthColLetter, lastMonthColLetter) {
  try {
    const monthlyValues = mesiDellAnno.map(key => Number(dataMap?.get(key) || 0));
    const headerNames = Object.keys(headerMap); // Per trovare l'indice

    if (monthlyValues.length > 0) {
      // Scrive i valori mensili (da colonna C in poi)
      const firstMonthColIndex = headerNames.findIndex(h => headerMap[h] === firstMonthColLetter); // Indice 0-based
      if (firstMonthColIndex !== -1) {
        sheet.getRange(rowNum, firstMonthColIndex + 1, 1, monthlyValues.length).setValues([monthlyValues]); // Indice 1-based per getRange
      } else {
        LOG.warn('PNL_WRITE_ROW', `Impossibile trovare l'indice della colonna ${firstMonthColLetter} per la riga ${rowNum}`);
      }

      // --- CORREZIONE: Formula dinamica per Totale anno (colonna B) ---
      if (totalColLetter) {
        sheet.getRange(`${totalColLetter}${rowNum}`)
             .setFormula(`=SUM(${firstMonthColLetter}${rowNum}:${lastMonthColLetter}${rowNum})`);
      }
      // --- FINE CORREZIONE ---
    } else {
       // Se non ci sono mesi, azzera almeno la colonna Totale Anno
       if (totalColLetter) {
          sheet.getRange(`${totalColLetter}${rowNum}`).setValue(0);
       }
    }
  } catch (e) {
    LOG.error('PNL_WRITE_ROW', `Errore scrittura riga P&L ${rowNum}`, { error: e.message, stack: e.stack });
    // Fallback: azzera le colonne da B in poi
    try {
       const totalColsToWrite = mesiDellAnno.length + 1; // Totale + mesi
       if (totalColsToWrite > 0 && totalColLetter) {
         const startColIndex = Object.keys(headerMap).findIndex(h => headerMap[h] === totalColLetter); // Indice 0-based di B
         if (startColIndex !== -1) {
            sheet.getRange(rowNum, startColIndex + 1, 1, totalColsToWrite).setValue(0); // Indice 1-based per getRange
         }
       }
    } catch (_) {}
  }
}


/**
 * Scrive una riga contenente formule.
 * CORRETTO: Usa headerMap per generare formule dinamicamente per ogni colonna.
 * @private
 */
function _writeFormulaRow(sheet, rowNum, formulaBaseTotalCol, headerMap, mesiDellAnno, background = null) {
  try {
     // Ottieni header in ordine A, B, C...
     const headerNames = Object.keys(headerMap).sort((a,b) => headerMap[a].localeCompare(headerMap[b]));
     const numCols = headerNames.length;
     const totalColHeader = headerNames[1]; // Assume Totale Anno sia la seconda colonna
     const totalColLetter = headerMap[totalColHeader];

     if (!totalColLetter) throw new Error("Lettera colonna Totale non trovata");

     const formulas = [[]]; // Array bidimensionale per setFormulas

     // Itera su tutte le colonne definite in headerMap (tranne la prima 'Voce/Mese')
     for (let i = 1; i < numCols; i++) {
         const currentColHeader = headerNames[i];
         const currentColLetter = headerMap[currentColHeader];

         if (currentColHeader.startsWith('Totale')) {
             // Formula per la colonna Totale Anno
             formulas[0].push(`=${formulaBaseTotalCol}`);
         } else {
             // Formula per le colonne Mese: sostituisci TUTTI i riferimenti
             // alla colonna Totale con la colonna Mese corrente.
             const formulaMese = formulaBaseTotalCol.replace(new RegExp(`([\$]?)${totalColLetter}([\\$]?\\d+)`, 'g'), `$1${currentColLetter}$2`);
             formulas[0].push(`=${formulaMese}`);
         }
     }

     // Scrive tutte le formule in una volta (da colonna B in poi)
     const startColIndex = 1; // Indice 0-based di B

     const formulaRange = sheet.getRange(rowNum, startColIndex + 1, 1, numCols - 1); // Indice 1-based per getRange
     formulaRange.setFormulas(formulas);
     if (background) formulaRange.setBackground(background);

  } catch (e) {
    LOG.error('PNL_FORMULA', `Errore scrittura formula P&L riga ${rowNum}`, { formulaBase: formulaBaseTotalCol, error: e.message, stack: e.stack });
    // Fallback: azzera le colonne
    try {
        const numColsToWrite = Object.keys(headerMap).length -1;
        if(numColsToWrite > 0){
           const startColIndex = 1; // Indice 0-based di B
           const errorRange = sheet.getRange(rowNum, startColIndex + 1, 1, numColsToWrite);
           errorRange.setValue(0);
           if (background) errorRange.setBackground(background);
        }
    } catch (_) {}
  }
}


/**
 * Legge Dati Mensili in Map<Sede, Map<AnnoMese, {fatturato, personale}>>
 * @private
 */
function _getDatiMensiliBySede() {
  const result = new Map();
  const sh = SHEETS.get(SHEETS.SHEET_NAMES.Dati_Mensili);
  if (!sh) return result;

  const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Dati_Mensili);
  if (sh.getLastRow() <= headerRow) return result;

  try {
    const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Dati_Mensili);
    if (idx.Sede === undefined || idx.AnnoMese === undefined || idx.Fatturato === undefined) {
      LOG.error('PNL_DM', 'Colonne Sede, AnnoMese o Fatturato mancanti in Dati Mensili.');
      return result;
    }
    const idxPersonale = idx.Costo_Personale; // opzionale

    const lastCol = Math.max(idx.Sede, idx.AnnoMese, idx.Fatturato, idxPersonale ?? 0) + 1;
    const rows = sh.getRange(headerRow + 1, 1, sh.getLastRow() - headerRow, lastCol).getValues();

    rows.forEach(r => {
      const sede = String(r[idx.Sede] ?? 'Non Assegnata').trim() || 'Non Assegnata';
      const ym = String(r[idx.AnnoMese] ?? '').trim();
      if (!/^\d{4}-\d{2}$/.test(ym)) return;

      const fatt = UTIL.parseNumSmart(r[idx.Fatturato]);
      const pers = idxPersonale !== undefined ? UTIL.parseNumSmart(r[idxPersonale]) : 0;

      if (!result.has(sede)) result.set(sede, new Map());
      const m = result.get(sede);
      const curr = m.get(ym) || { fatturato: 0, personale: 0 };
      curr.fatturato += fatt;
      curr.personale += pers;
      m.set(ym, curr);
    });
  } catch (e) {
    LOG.error('PNL_DM', 'Errore lettura Dati Mensili.', { error: e.message });
  }
  return result;
}


/**
 * Mappa FornitoreID normalizzato -> Famiglia
 * @private
 */
function _getFamiglieFornitori() {
  const map = new Map();
  const sh = SHEETS.get(SHEETS.SHEET_NAMES.Fornitori);
  if (!sh) return map;

  const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Fornitori);
  if (sh.getLastRow() <= headerRow) return map;

  try {
    const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fornitori);
    if (idx.FornitoreID === undefined || idx.Famiglia === undefined) {
      LOG.error('PNL_FOR', 'Colonne FornitoreID o Famiglia mancanti in Fornitori.');
      return map;
    }
    const lastCol = idx.Reparto !== undefined
      ? Math.max(idx.FornitoreID, idx.Famiglia, idx.Reparto) + 1
      : Math.max(idx.FornitoreID, idx.Famiglia) + 1;
    const rows = sh.getRange(headerRow + 1, 1, sh.getLastRow() - headerRow, lastCol).getValues();

    rows.forEach(r => {
      const idRaw = String(r[idx.FornitoreID] ?? '');
      // --- Corretto: Usa UTIL.normKey anche qui per coerenza ---
      const idNorm = UTIL.normKey(idRaw).replace(/^0+/, '');
      if (!idNorm) return;
      const fam = String(r[idx.Famiglia] ?? '').trim() || 'Non Categorizzato';
      map.set(idNorm, fam);
    });
  } catch (e) {
    LOG.error('PNL_FOR', 'Errore lettura Fornitori.', { error: e.message });
  }
  return map;
}


/**
 * Aggrega costi fornitori: Map<Sede, Map<AnnoMese, Map<Famiglia, costoNetto>>>
 * Usa TotImponibile (segno già corretto da import) e family da Fornitori.
 * @private
 */
function _getAggregatedCostsBySede(famiglieFornitori) {
  const result = new Map();
  const sh = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
  if (!sh) return result;

  const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Fatture);
  if (sh.getLastRow() <= headerRow) return result;

  try {
    const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
    const required = ['Sede', 'Data', 'TotImponibile', 'FornitoreID'];
    const missing = UTIL.checkColumns(idx, required);
    if (missing.length) {
      LOG.error('PNL_FATT', `Colonne mancanti in Fatture: ${missing.join(', ')}`);
      return result;
    }
    const lastCol = Math.max(idx.Sede, idx.Data, idx.TotImponibile, idx.FornitoreID) + 1;
    const rows = sh.getRange(headerRow + 1, 1, sh.getLastRow() - headerRow, lastCol).getValues();

    rows.forEach(r => {
      const sede = String(r[idx.Sede] ?? 'Non Assegnata').trim() || 'Non Assegnata';
      const data = r[idx.Data];
      if (!(data instanceof Date) || isNaN(data.getTime())) return;

      const ym = `${data.getFullYear()}-${('0' + (data.getMonth() + 1)).slice(-2)}`;
      const idRaw = String(r[idx.FornitoreID] ?? '');
      // --- Corretto: Usa UTIL.normKey ---
      const idNorm = UTIL.normKey(idRaw).replace(/^0+/, '');
      const famiglia = famiglieFornitori.get(idNorm) || 'Non Categorizzato';
      const costoNetto = UTIL.parseNumSmart(r[idx.TotImponibile]); // può essere negativo per NC

      if (!result.has(sede)) result.set(sede, new Map());
      const m = result.get(sede);
      if (!m.has(ym)) m.set(ym, new Map());
      const famMap = m.get(ym);
      famMap.set(famiglia, (famMap.get(famiglia) ?? 0) + costoNetto);
    });
  } catch (e) {
    LOG.error('PNL_FATT', 'Errore lettura/aggregazione Fatture.', { error: e.message });
  }
  return result;
}


// --- UTILITIES ---

/**
 * Converte numero mese ("01".."12") in nome abbreviato IT + anno breve. Es: "Gen '24"
 * @private
 */
function _meseIntToNome(meseInt, annoShort) {
  return UTIL.date.getShortMonthName(parseInt(String(meseInt), 10), annoShort);
}

/**
 * Ordina famiglie con logica:
 * 1) Prefisso numerico in testa (ordine crescente), poi alfabetico
 * 2) "Non Categorizzato" sempre in coda
 * 3) Esclude eventuale voce Cedolini dall’elenco (è gestita a parte)
 * @private
 */
function _sortFamilies(famList, VOCE_CEDOLINI) {
  const arr = famList
    .filter(f => f && f !== VOCE_CEDOLINI); // Filtra null, undefined, "" e VOCE_CEDOLINI

  const hasNumPrefix = s => /^\s*(\d+)[\s.\-)]/.test(s);
  const getNumPrefix = s => {
    const m = /^\s*(\d+)[\s.\-)]/.exec(s);
    return m ? parseInt(m[1], 10) : Number.POSITIVE_INFINITY;
  };

  arr.sort((a, b) => {
    const aNC = String(a).toLowerCase() === 'non categorizzato';
    const bNC = String(b).toLowerCase() === 'non categorizzato';
    if (aNC && !bNC) return 1;  // 'Non Categorizzato' va in fondo
    if (!aNC && bNC) return -1; // 'Non Categorizzato' va in fondo

    const aNum = hasNumPrefix(a), bNum = hasNumPrefix(b);
    if (aNum && bNum) { // Entrambi hanno prefisso numerico
      const diff = getNumPrefix(a) - getNumPrefix(b);
      if (diff !== 0) return diff; // Ordina per numero
      return String(a).localeCompare(String(b)); // A parità di numero, ordina alfabeticamente
    }
    if (aNum && !bNum) return -1; // Quelli con numero vengono prima
    if (!aNum && bNum) return 1;  // Quelli con numero vengono prima

    return String(a).localeCompare(String(b)); // Ordine alfabetico standard
  });

  return arr;
}
