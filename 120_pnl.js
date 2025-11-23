// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 120_pnl.js
// RUOLO: Conto Economico (P&L) dinamico Multi-Anno per GLOBALE e per SEDE.
// NOTE: Usa UTIL.date, ERROR_HANDLER.safely(), ordinamento famiglie fornitori.
// =============================================================

/**
 * Crea o aggiorna foglio Conto Economico Riclassificato con P&L multi-anno e multi-perimetro (Gelateria/Hotel).
 * Implementa logica di riclassificazione costi, famiglie, C1, GOP, sezioni per perimetro.
 */
function createPnlSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'Conto Economico Riclassificato';
  UTIL.showToast(`Aggiornamento ${sheetName}...`, 'Conto Economico', 10);

  const VOCE_FATTURATO = 'RICAVI DA SERVIZI GENERICI';
  const VOCE_CEDOLINI = '3 - Cedolini';
  
  // COSTI OPERATIVI (C1 - GOP): Food + Consumabili + Cedolini
  const COSTI_OPERATIVI_GOP = [
    '1 - Food Cost',
    '2 - Consumabili',
    '3 - Cedolini'
  ];
  
  // ALTRI COSTI (non operativi)
  const ALTRI_COSTI = [
    '4 - Personale (costi azienda)',
    '5 - Utenze (utenze e costi fissi)',
    '6 - Automezzi',
    '7 - Struttura (manutenzioni ordinarie)',
    '8 - Gestione (spese generali)',
    '9 - Marketing',
    'Non Categorizzato'
  ];
  
  const FAMIGLIE_ORDINATE = [...COSTI_OPERATIVI_GOP, ...ALTRI_COSTI];
  
  // Mapping flessibile: normalizza nomi famiglie per matching
  const normalizzaFamiglia = (nome) => String(nome).toLowerCase().replace(/[^a-z]/g, '');
  const FAMIGLIA_MAPPING = new Map();
  FAMIGLIE_ORDINATE.forEach(fam => {
    const key = normalizzaFamiglia(fam);
    FAMIGLIA_MAPPING.set(key, fam);
  });
  
  // Funzione per trovare famiglia standard da nome variabile
  const trovaFamigliaStandard = (nomeVar) => {
    if (!nomeVar) return 'Non Categorizzato';
    const normalized = normalizzaFamiglia(nomeVar);
    // Match esatto
    if (FAMIGLIA_MAPPING.has(normalized)) return FAMIGLIA_MAPPING.get(normalized);
    // Match parziale (contiene la chiave)
    for (const [key, standard] of FAMIGLIA_MAPPING.entries()) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return standard;
      }
    }
    return 'Non Categorizzato';
  };

  let sh = ss.getSheetByName(sheetName);
  if (!sh) { sh = ss.insertSheet(sheetName, 0); }

  // --- DIALOG DI FILTRO ---
  const ui = SpreadsheetApp.getUi();
  
  // 1. Scelta Anno
  const responseAnno = ui.prompt(
    '📅 FILTRO ANNO',
    'Inserisci anno (es: 2025) oppure lascia VUOTO per tutti:',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (responseAnno.getSelectedButton() === ui.Button.CANCEL) {
    UTIL.showToast('Operazione annullata', 'Info', 3);
    return;
  }
  
  const filtroAnno = responseAnno.getResponseText().trim();
  
  // 2. Scelta Perimetro
  const responsePerimetro = ui.prompt(
    '🎯 FILTRO VISUALIZZAZIONE',
    'Scegli cosa visualizzare:\\n\\n' +
    '1 = GLOBALE (totale gelateria)\\n' +
    '2 = TUTTE LE SEDI\\n' +
    '3 = SEDE SPECIFICA\\n' +
    '4 = TUTTO\\n\\n' +
    'Inserisci 1, 2, 3 o 4:',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (responsePerimetro.getSelectedButton() === ui.Button.CANCEL) {
    UTIL.showToast('Operazione annullata', 'Info', 3);
    return;
  }
  
  const filtroPerimetro = responsePerimetro.getResponseText().trim();
  
  // 3. Se scelta = 3, chiedi quale sede
  let filtroSede = '';
  if (filtroPerimetro === '3') {
    const responseSede = ui.prompt(
      '🏢 SCELTA SEDE',
      'Inserisci il nome della sede (parziale o completo):',
      ui.ButtonSet.OK_CANCEL
    );
    
    if (responseSede.getSelectedButton() === ui.Button.CANCEL) {
      UTIL.showToast('Operazione annullata', 'Info', 3);
      return;
    }
    
    filtroSede = responseSede.getResponseText().trim().toUpperCase();
  }

  // Pulizia robusta
  sh.clear();
  sh.getCharts().forEach(chart => sh.removeChart(chart));
  try { sh.setFrozenRows(0); sh.setFrozenColumns(0); } catch (e) {}
  try { sh.getDataRange().breakApart(); } catch(e){} // Rimuove merge

  // --- 1. CARICAMENTO DATI ---
  const aziendaMap = _getAziendaMap(); // Mappa Sede → Azienda dal foglio Aziende
  const dataMensili = _getDatiMensiliBySede();
  const famiglieFornitori = _getFamiglieFornitori();
  const costiAggregati = _getAggregatedCostsBySede(famiglieFornitori);

  // --- 2. PREPARAZIONE STRUTTURA DATI P&L PER PERIMETRO ---
  // Mappe per perimetro: globale gelateria, gemma gelateria, zaffiro gelateria, hotel, sedi
  const pnlGlobaleGelateria = new Map();
  const pnlGemmaGelateria = new Map();
  const pnlZaffiroGelateria = new Map();
  const pnlHotel = new Map();
  const pnlPerSede = new Map();
  const tutteLeFamiglie = new Set(['Non Categorizzato']);
  const tuttiIMesi = new Set();
  const tutteLeSedi = new Set([...dataMensili.keys(), ...costiAggregati.keys()]);

  // Helper per aggregazione perimetro
  function isGelateria(reparto) {
    return !reparto || String(reparto).toLowerCase() !== 'hotel';
  }
  function isHotel(reparto) {
    return String(reparto).toLowerCase() === 'hotel';
  }

  // Inizializza mappe per famiglie e voci
  [pnlGlobaleGelateria, pnlGemmaGelateria, pnlZaffiroGelateria, pnlHotel].forEach(map => {
    map.set(VOCE_FATTURATO, new Map());
    COSTI_OPERATIVI_GOP.forEach(fam => map.set(fam, new Map()));
    ALTRI_COSTI.forEach(fam => map.set(fam, new Map()));
  });
  tutteLeSedi.forEach(sede => {
    const sedeMap = new Map();
    sedeMap.set(VOCE_FATTURATO, new Map());
    COSTI_OPERATIVI_GOP.forEach(fam => sedeMap.set(fam, new Map()));
    ALTRI_COSTI.forEach(fam => sedeMap.set(fam, new Map()));
    pnlPerSede.set(sede, sedeMap);
  });

  // --- Aggrega Dati Mensili (Fatturato, Cedolini) per perimetro ---
  dataMensili.forEach((mesi, sede) => {
    mesi.forEach((dati, annoMese) => {
      tuttiIMesi.add(annoMese);
      const { fatturato, personale, azienda, reparto } = dati;
      
      // LOGICA REPARTO: Zaffiro ignora sempre il reparto (solo Gelateria), Gemma usa il reparto
      const repartoEffettivo = (azienda === 'Zaffiro') ? 'Gelateria' : reparto;
      
      // Perimetro gelateria
      if (isGelateria(repartoEffettivo)) {
        pnlGlobaleGelateria.get(VOCE_FATTURATO).set(annoMese, (pnlGlobaleGelateria.get(VOCE_FATTURATO).get(annoMese) ?? 0) + fatturato);
        pnlGlobaleGelateria.get(VOCE_CEDOLINI).set(annoMese, (pnlGlobaleGelateria.get(VOCE_CEDOLINI).get(annoMese) ?? 0) + personale);
        if (azienda === 'Gemma') {
          pnlGemmaGelateria.get(VOCE_FATTURATO).set(annoMese, (pnlGemmaGelateria.get(VOCE_FATTURATO).get(annoMese) ?? 0) + fatturato);
          pnlGemmaGelateria.get(VOCE_CEDOLINI).set(annoMese, (pnlGemmaGelateria.get(VOCE_CEDOLINI).get(annoMese) ?? 0) + personale);
        }
        if (azienda === 'Zaffiro') {
          pnlZaffiroGelateria.get(VOCE_FATTURATO).set(annoMese, (pnlZaffiroGelateria.get(VOCE_FATTURATO).get(annoMese) ?? 0) + fatturato);
          pnlZaffiroGelateria.get(VOCE_CEDOLINI).set(annoMese, (pnlZaffiroGelateria.get(VOCE_CEDOLINI).get(annoMese) ?? 0) + personale);
        }
      }
      // Perimetro hotel (solo Gemma, Zaffiro sempre Gelateria)
      if (isHotel(repartoEffettivo)) {
        pnlHotel.get(VOCE_FATTURATO).set(annoMese, (pnlHotel.get(VOCE_FATTURATO).get(annoMese) ?? 0) + fatturato);
        pnlHotel.get(VOCE_CEDOLINI).set(annoMese, (pnlHotel.get(VOCE_CEDOLINI).get(annoMese) ?? 0) + personale);
      }
      // Sede (come ora)
      const sedePnl = pnlPerSede.get(sede);
      sedePnl.get(VOCE_FATTURATO)?.set(annoMese, (sedePnl.get(VOCE_FATTURATO)?.get(annoMese) ?? 0) + fatturato);
      sedePnl.get(VOCE_CEDOLINI)?.set(annoMese, (sedePnl.get(VOCE_CEDOLINI)?.get(annoMese) ?? 0) + personale);
    });
  });

  // Mappe separate per costi Hotel (esclusi dal P&L normale, mostrati sotto MOL solo per Gemma)
  const costiHotelGemma = new Map();
  costiHotelGemma.set('COSTI HOTEL', new Map());

  // --- Aggrega Costi Fornitori per perimetro ---
  costiAggregati.forEach((mesi, sede) => {
    mesi.forEach((costiPerFamiglia, annoMese) => {
      tuttiIMesi.add(annoMese);
      costiPerFamiglia.forEach((infoFamiglia, famigliaOriginale) => {
        // Normalizza il nome della famiglia per matching con standard
        const famiglia = trovaFamigliaStandard(famigliaOriginale);
        tutteLeFamiglie.add(famiglia);
        const { costoNetto, reparto, azienda } = infoFamiglia;
        
        // LOGICA REPARTO: Zaffiro ignora sempre il reparto (solo Gelateria), Gemma usa il reparto
        const repartoEffettivo = (azienda === 'Zaffiro') ? 'Gelateria' : reparto;
        
        // Perimetro gelateria (escludi Hotel solo da Gemma, Zaffiro sempre Gelateria)
        if (isGelateria(repartoEffettivo)) {
          if (!pnlGlobaleGelateria.has(famiglia)) pnlGlobaleGelateria.set(famiglia, new Map());
          pnlGlobaleGelateria.get(famiglia).set(annoMese, (pnlGlobaleGelateria.get(famiglia).get(annoMese) ?? 0) + costoNetto);
          
          if (azienda === 'Gemma') {
            if (!pnlGemmaGelateria.has(famiglia)) pnlGemmaGelateria.set(famiglia, new Map());
            pnlGemmaGelateria.get(famiglia).set(annoMese, (pnlGemmaGelateria.get(famiglia).get(annoMese) ?? 0) + costoNetto);
          }
          if (azienda === 'Zaffiro') {
            if (!pnlZaffiroGelateria.has(famiglia)) pnlZaffiroGelateria.set(famiglia, new Map());
            pnlZaffiroGelateria.get(famiglia).set(annoMese, (pnlZaffiroGelateria.get(famiglia).get(annoMese) ?? 0) + costoNetto);
          }
        }
        
        // Perimetro hotel: aggrega separatamente solo per Gemma (Zaffiro non ha Hotel)
        if (isHotel(repartoEffettivo)) {
          if (!pnlHotel.has(famiglia)) pnlHotel.set(famiglia, new Map());
          pnlHotel.get(famiglia).set(annoMese, (pnlHotel.get(famiglia).get(annoMese) ?? 0) + costoNetto);
          
          // Aggrega costi Hotel solo per Gemma (mostrati sotto MOL)
          if (azienda === 'Gemma') {
            costiHotelGemma.get('COSTI HOTEL').set(annoMese, (costiHotelGemma.get('COSTI HOTEL').get(annoMese) ?? 0) + costoNetto);
          }
        }
        
        // Sede (come ora)
        const sedePnl = pnlPerSede.get(sede);
        if (!sedePnl.has(famiglia)) sedePnl.set(famiglia, new Map());
        sedePnl.get(famiglia).set(annoMese, (sedePnl.get(famiglia).get(annoMese) ?? 0) + costoNetto);
      });
    });
  });

  // Ordina le famiglie e i mesi per la scrittura
  const famiglieOrdinate = [...COSTI_OPERATIVI_GOP, ...ALTRI_COSTI];
  const mesiOrdinati = [...tuttiIMesi].sort();

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
    const currencyFormat = '€ #,##0.00;[Red](€ #,##0.00);€ 0.00';
    const percentFormat  = '0.00%';

    // Trova tutti gli anni disponibili e ordinali in modo decrescente
    const anniDisponibili = [...new Set(mesiOrdinati.map(m => m.split('-')[0]))].sort((a, b) => b.localeCompare(a));

    // Scrive una sezione per ogni anno
    anniDisponibili.forEach((anno, index) => {
      // Applica filtro anno
      if (filtroAnno && anno !== filtroAnno) {
        return;
      }
      
      const mesiDellAnno = mesiOrdinati.filter(m => m.startsWith(anno));
      if (mesiDellAnno.length === 0) return;
      
      // Verifica se l'anno ha almeno un dato (in qualsiasi perimetro)
      const annoHaDati = mesiDellAnno.some(meseAnno => {
        // Controlla tutti i perimetri
        const perimetri = [pnlGlobaleGelateria, pnlGemmaGelateria, pnlZaffiroGelateria, pnlHotel, ...pnlPerSede.values()];
        return perimetri.some(pnlData => 
          Array.from(pnlData.values()).some(mesiValori => mesiValori.has(meseAnno) && mesiValori.get(meseAnno) !== 0)
        );
      });
      
      if (!annoHaDati) {
        LOG.info('PNL_SHEET', `Anno ${anno} saltato: nessun dato presente`);
        return;
      }
      
      if (index > 0) currentRow += 2;
      const headerRowAnno = ['Voce/Mese', `Totale ${anno}`];
      mesiDellAnno.forEach(am => headerRowAnno.push(_meseIntToNome(am.split('-')[1], anno.slice(-2))));

      // Sezione GLOBALE (solo se filtro = 1 o 4)
      if (filtroPerimetro === '1' || filtroPerimetro === '4') {
        const globaleHaDati = mesiDellAnno.some(meseAnno =>
          Array.from(pnlGlobaleGelateria.values()).some(mesiValori => mesiValori.has(meseAnno) && mesiValori.get(meseAnno) !== 0)
        );
        if (globaleHaDati) {
          // GLOBALE: mostra costi Hotel se presenti (Gemma)
          const costiHotelGlobale = costiHotelGemma.get('COSTI HOTEL')?.size > 0 ? costiHotelGemma : null;
          currentRow = _writePnlSection(
            sh, currentRow, `CONTO ECONOMICO RICLASSIFICATO - GLOBALE GELATERIA (Anno ${anno})`,
            pnlGlobaleGelateria, COSTI_OPERATIVI_GOP, ALTRI_COSTI, mesiDellAnno, headerRowAnno, VOCE_FATTURATO, currencyFormat, percentFormat, costiHotelGlobale
          );
          currentRow += 2;
        }
      }

      // Sezioni SEDI (con logica azienda per costi Hotel)
      if (filtroPerimetro === '2' || filtroPerimetro === '4') {
        // Mostra tutte le sedi
        [...tutteLeSedi].sort().forEach(sede => {
          const pnlDataSede = pnlPerSede.get(sede);
          let sedeHaDatiAnno = false;
          if (pnlDataSede) {
            sedeHaDatiAnno = mesiDellAnno.some(meseAnno =>
              Array.from(pnlDataSede.values()).some(mesiValori => mesiValori.has(meseAnno) && mesiValori.get(meseAnno) !== 0)
            );
          }
          if (sedeHaDatiAnno) {
            // Determina se mostrare costi Hotel (solo per Gemma, Zaffiro ha solo Gelateria)
            const aziendaSede = aziendaMap.get(sede);
            const costiHotelSede = aziendaSede === 'Gemma' ? costiHotelGemma : null;
            
            currentRow = _writePnlSection(
              sh, currentRow, `CONTO ECONOMICO RICLASSIFICATO - SEDE: ${sede} (Anno ${anno})`,
              pnlDataSede, COSTI_OPERATIVI_GOP, ALTRI_COSTI, mesiDellAnno, headerRowAnno, VOCE_FATTURATO, currencyFormat, percentFormat, costiHotelSede
            );
            currentRow += 3;
          }
        });
      } else if (filtroPerimetro === '3' && filtroSede) {
        // Mostra solo la sede specifica
        [...tutteLeSedi].sort().forEach(sede => {
          if (sede.toUpperCase().includes(filtroSede)) {
            const pnlDataSede = pnlPerSede.get(sede);
            let sedeHaDatiAnno = false;
            if (pnlDataSede) {
              sedeHaDatiAnno = mesiDellAnno.some(meseAnno =>
                Array.from(pnlDataSede.values()).some(mesiValori => mesiValori.has(meseAnno) && mesiValori.get(meseAnno) !== 0)
              );
            }
            if (sedeHaDatiAnno) {
              // Determina se mostrare costi Hotel (solo per Gemma, Zaffiro ha solo Gelateria)
              const aziendaSede = aziendaMap.get(sede);
              const costiHotelSede = aziendaSede === 'Gemma' ? costiHotelGemma : null;
              
              currentRow = _writePnlSection(
                sh, currentRow, `CONTO ECONOMICO RICLASSIFICATO - SEDE: ${sede} (Anno ${anno})`,
                pnlDataSede, COSTI_OPERATIVI_GOP, ALTRI_COSTI, mesiDellAnno, headerRowAnno, VOCE_FATTURATO, currencyFormat, percentFormat, costiHotelSede
              );
              currentRow += 3;
            }
          }
        });
      }
    });

    // Ridimensionamento finale
    if (sh.getLastRow() > 1 && sh.getLastColumn() > 1) {
      const maxColsUsed = anniDisponibili.reduce((max, anno) => {
        const mesiDellAnno = mesiOrdinati.filter(m => m.startsWith(anno));
        return Math.max(max, 2 + mesiDellAnno.length);
      }, 1);
      if (maxColsUsed > 1) {
        GG.get('ERROR_HANDLER').safely(
          () => sh.autoResizeColumns(1, Math.min(sh.getMaxColumns(), maxColsUsed)),
          { scope: 'PNL_RESIZE', message: 'Impossibile ridimensionare automaticamente le colonne.' }
        );
      }
    }

    LOG.info('PNL_SHEET', `P&L Dinamico multi-perimetro scritto con successo.`);
    UTIL.showToast(`P&L Dinamico "${sheetName}" aggiornato!`, 'Completato', 10);
    ss.setActiveSheet(sh);

  } catch (e) {
    LOG.error('PNL_SHEET', `Errore during la scrittura del P&L Dinamico.`, { error: e.message, stack: e.stack });
    throw new Error(`Errore creazione P&L Dinamico: ${e.message}`);
  }
}


/**
 * Scrive una sezione completa di P&L sul foglio con logica GOP.
 * (A) Ricavi → C1 Costi Operativi (Food+Consumabili+Cedolini) → GOP (A-C1) → Altri Costi → (C) Totale Costi → MOL (A-C) → [COSTI HOTEL]
 * @private
 */
function _writePnlSection(sheet, currentRow, title, pnlData, costiOperativiGOP, altriCosti, mesiDellAnno, headerRowAnno, VOCE_FATTURATO, currencyFormat, percentFormat, costiHotel = null) {
  try {
    const headerNames = headerRowAnno;
    if (!Array.isArray(headerNames)) {
      throw new Error(`headerRowAnno non è un array: ${typeof headerNames}`);
    }
    const numCols = headerNames.length;
    const headerDataRow = currentRow + 1;

    // --- Mappa Nome Header -> Lettera Colonna ---
    const headerMap = {};
    headerNames.forEach((name, index) => {
      if (name) headerMap[name] = UTIL.getColumnLetter(index);
    });
  const firstMonthColIndex = 2;
  const lastMonthColIndex = headerNames.length - 1;
  const firstMonthColLetter = UTIL.getColumnLetter(firstMonthColIndex);
  const lastMonthColLetter = UTIL.getColumnLetter(lastMonthColIndex);
  const totalColHeader = headerNames[1];
  const totalColLetter = headerMap[totalColHeader];

  if (!totalColLetter || !firstMonthColLetter || !lastMonthColLetter) {
    throw new Error("Impossibile determinare le colonne Totale Anno o Mesi.");
  }

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
  
  // Percentuale 100% per ricavi
  currentRow++;
  const rigaPercRicavi = currentRow;
  sheet.getRange(rigaPercRicavi, 1).setValue('').setFontStyle('italic');
  for (let i = 1; i < numCols; i++) {
    const colLetter = UTIL.getColumnLetter(i);
    sheet.getRange(`${colLetter}${rigaPercRicavi}`).setValue('(100.0)%').setFontStyle('italic');
  }
  currentRow++;

  // (A) - TOTALE RICAVI
  const rigaTotRicavi = currentRow;
  sheet.getRange(rigaTotRicavi, 1).setValue('(A) - TOTALE RICAVI').setFontWeight('bold').setBackground('#f3f3f3');
  _writeFormulaRow(sheet, rigaTotRicavi, `${totalColLetter}${rigaFatturato}`, headerMap, mesiDellAnno, '#f3f3f3');
  currentRow++;
  currentRow++; // Spazio

  // --- SEZIONE COSTI: Prima famiglie operative, poi altri costi, poi totali ---
  const righeCostiOp = {};
  const righeAltriCosti = {};
  
  // 1. FAMIGLIE OPERATIVE (Food, Consumabili, Cedolini)
  costiOperativiGOP.forEach(famiglia => {
    sheet.getRange(currentRow, 1).setValue(famiglia);
    _writePnlRow(sheet, pnlData.get(famiglia), currentRow, mesiDellAnno, headerMap, totalColLetter, firstMonthColLetter, lastMonthColLetter);
    
    // Percentuale su fatturato
    currentRow++;
    const rigaPerc = currentRow;
    sheet.getRange(rigaPerc, 1).setValue('').setFontStyle('italic');
    _writePercentFormulaRow(sheet, rigaPerc, currentRow - 1, rigaFatturato, headerMap, mesiDellAnno, totalColLetter);
    righeCostiOp[famiglia] = currentRow - 1;
    currentRow++;
  });
  
  // 2. ALTRI COSTI (Personale, Utenze, Automezzi, Struttura, Gestione, Marketing, Non Categorizzato)
  altriCosti.forEach(famiglia => {
    sheet.getRange(currentRow, 1).setValue(famiglia);
    _writePnlRow(sheet, pnlData.get(famiglia), currentRow, mesiDellAnno, headerMap, totalColLetter, firstMonthColLetter, lastMonthColLetter);
    
    // Percentuale su fatturato
    currentRow++;
    const rigaPerc = currentRow;
    sheet.getRange(rigaPerc, 1).setValue('').setFontStyle('italic');
    _writePercentFormulaRow(sheet, rigaPerc, currentRow - 1, rigaFatturato, headerMap, mesiDellAnno, totalColLetter);
    righeAltriCosti[famiglia] = currentRow - 1;
    currentRow++;
  });
  
  // 3. C1 - DI CUI OPERATIVI (totale costi operativi)
  const rigaTotCostiOp = currentRow;
  sheet.getRange(rigaTotCostiOp, 1).setValue('C1 - DI CUI OPERATIVI').setFontWeight('bold').setBackground('#f3f3f3');
  
  const righeCostiOpArray = Object.values(righeCostiOp);
  const formulaSumC1 = righeCostiOpArray.map(r => `${totalColLetter}${r}`).join('+');
  _writeFormulaRow(sheet, rigaTotCostiOp, formulaSumC1, headerMap, mesiDellAnno, '#f3f3f3');
  
  // Percentuale C1 su fatturato
  currentRow++;
  const rigaPercC1 = currentRow;
  sheet.getRange(rigaPercC1, 1).setValue('').setFontStyle('italic');
  _writePercentFormulaRow(sheet, rigaPercC1, rigaTotCostiOp, rigaFatturato, headerMap, mesiDellAnno, totalColLetter);
  currentRow++;
  currentRow++; // Spazio

  // 4. GOP (A - C1)
  const rigaGOP = currentRow;
  sheet.getRange(rigaGOP, 1).setValue('GOP (A - C1)').setFontWeight('bold').setBackground('#e0e0e0');
  _writeFormulaRow(sheet, rigaGOP, `${totalColLetter}${rigaTotRicavi}-${totalColLetter}${rigaTotCostiOp}`, headerMap, mesiDellAnno, '#e0e0e0');
  currentRow++;
  currentRow++; // Spazio

  // 5. C - TOTALE COSTI (C1 + Altri Costi)
  const rigaTotCosti = currentRow;
  sheet.getRange(rigaTotCosti, 1).setValue('C - TOTALE COSTI').setFontWeight('bold').setBackground('#f3f3f3');
  
  const righeAltriCostiValori = Object.values(righeAltriCosti);
  if (righeAltriCostiValori.length > 0) {
    const formulaAltri = righeAltriCostiValori.map(r => `${totalColLetter}${r}`).join('+');
    _writeFormulaRow(sheet, rigaTotCosti, `${totalColLetter}${rigaTotCostiOp}+${formulaAltri}`, headerMap, mesiDellAnno, '#f3f3f3');
  } else {
    _writeFormulaRow(sheet, rigaTotCosti, `${totalColLetter}${rigaTotCostiOp}`, headerMap, mesiDellAnno, '#f3f3f3');
  }
  
  // Percentuale C su fatturato
  currentRow++;
  const rigaPercC = currentRow;
  sheet.getRange(rigaPercC, 1).setValue('').setFontStyle('italic');
  _writePercentFormulaRow(sheet, rigaPercC, rigaTotCosti, rigaFatturato, headerMap, mesiDellAnno, totalColLetter);
  currentRow++;
  currentRow++; // Spazio

  // 6. MOL (A - C)
  const rigaMOL = currentRow;
  sheet.getRange(rigaMOL, 1).setValue('MOL (A-C)').setFontWeight('bold').setBackground('#e0e0e0');
  _writeFormulaRow(sheet, rigaMOL, `${totalColLetter}${rigaTotRicavi}-${totalColLetter}${rigaTotCosti}`, headerMap, mesiDellAnno, '#e0e0e0');
  currentRow++;
  currentRow++; // Spazio

  // 7. COSTI HOTEL (solo se presenti)
  let rigaCostiHotel = null;
  if (costiHotel && costiHotel.has('COSTI HOTEL')) {
    rigaCostiHotel = currentRow;
    sheet.getRange(rigaCostiHotel, 1).setValue('COSTI HOTEL').setFontWeight('bold').setFontColor('#cc0000');
    _writePnlRow(sheet, costiHotel.get('COSTI HOTEL'), rigaCostiHotel, mesiDellAnno, headerMap, totalColLetter, firstMonthColLetter, lastMonthColLetter);
    currentRow++;
  }

  // Formattazione valori monetari (escluse percentuali)
  const righeDaFormattare = [rigaFatturato, rigaTotRicavi, ...Object.values(righeCostiOp), rigaTotCostiOp, rigaGOP, ...Object.values(righeAltriCosti), rigaTotCosti, rigaMOL];
  if (rigaCostiHotel) righeDaFormattare.push(rigaCostiHotel);
  righeDaFormattare.forEach(riga => {
    if (numCols > 1) {
      GG.get('ERROR_HANDLER').safely(
        () => sheet.getRange(riga, 2, 1, numCols - 1).setNumberFormat(currencyFormat),
        { scope: 'PNL_FORMAT', message: `Errore formato valuta riga ${riga}` }
      );
    }
  });

  // Formattazione percentuali
  const righePercentuali = [rigaPercRicavi, rigaPercC1, rigaPercC, ...Object.keys(righeCostiOp).map(f => righeCostiOp[f] + 1), ...Object.keys(righeAltriCosti).map(f => righeAltriCosti[f] + 1)];
  righePercentuali.forEach(riga => {
    if (numCols > 1) {
      GG.get('ERROR_HANDLER').safely(
        () => sheet.getRange(riga, 2, 1, numCols - 1).setNumberFormat(percentFormat),
        { scope: 'PNL_FORMAT', message: `Errore formato percentuale riga ${riga}` }
      );
    }
  });

  return currentRow;
  } catch (e) {
    LOG.error('PNL_SECTION', `Errore scrittura sezione P&L: ${title}`, { error: e.message, stack: e.stack });
    throw e;
  }
}


/**
 * Scrive una riga di dati P&L (valori numerici).
 * CORRETTO: Usa lettere colonne passate per formula Totale Anno.
 * @private
 */
function _writePnlRow(sheet, dataMap, rowNum, mesiDellAnno, headerMap, totalColLetter, firstMonthColLetter, lastMonthColLetter) {
  try {
    const monthlyValues = mesiDellAnno.map(key => Number(dataMap?.get(key) || 0));
    const headerNames = Object.keys(headerMap);

    if (monthlyValues.length > 0) {
      // Scrive i valori mensili (da colonna C in poi)
      const firstMonthColIndex = headerNames.findIndex(h => headerMap[h] === firstMonthColLetter);
      if (firstMonthColIndex !== -1) {
        sheet.getRange(rowNum, firstMonthColIndex + 1, 1, monthlyValues.length).setValues([monthlyValues]);
      } else {
        LOG.warn('PNL_WRITE_ROW', `Impossibile trovare l'indice della colonna ${firstMonthColLetter} per la riga ${rowNum}`);
      }

      // Formula dinamica per Totale anno (colonna B)
      if (totalColLetter) {
        sheet.getRange(`${totalColLetter}${rowNum}`)
             .setFormula(`=SUM(${firstMonthColLetter}${rowNum}:${lastMonthColLetter}${rowNum})`);
      }
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
       const totalColsToWrite = mesiDellAnno.length + 1;
       if (totalColsToWrite > 0 && totalColLetter) {
         const startColIndex = Object.keys(headerMap).findIndex(h => headerMap[h] === totalColLetter);
         if (startColIndex !== -1) {
            sheet.getRange(rowNum, startColIndex + 1, 1, totalColsToWrite).setValue(0);
         }
       }
    } catch (_) {}
  }
}


/**
 * Scrive percentuali calcolate in JavaScript (non formule).
 * Calcola valore/fatturato per ogni colonna e scrive i valori direttamente.
 * @private
 */
function _writePercentFormulaRow(sheet, rowNum, rigaValore, rigaFatturato, headerMap, mesiDellAnno, totalColLetter) {
  try {
    const headerNames = Object.keys(headerMap).sort((a,b) => headerMap[a].localeCompare(headerMap[b]));
    const numCols = headerNames.length;
    
    // Verifica parametri
    if (!rigaValore || !rigaFatturato) {
      LOG.error('PNL_PERCENT_CALC', `Parametri invalidi: rigaValore=${rigaValore}, rigaFatturato=${rigaFatturato}`);
      return;
    }

    // Leggi i valori delle righe fatturato e valore
    const valoriValore = sheet.getRange(rigaValore, 2, 1, numCols - 1).getValues()[0];
    const valoriFatturato = sheet.getRange(rigaFatturato, 2, 1, numCols - 1).getValues()[0];
    
    // Calcola percentuali
    const percentuali = [];
    for (let i = 0; i < valoriValore.length; i++) {
      const valore = Number(valoriValore[i]) || 0;
      const fatturato = Number(valoriFatturato[i]) || 0;
      
      if (fatturato === 0) {
        percentuali.push('');
      } else {
        percentuali.push(valore / fatturato);
      }
    }

    // Scrive i valori percentuali
    sheet.getRange(rowNum, 2, 1, numCols - 1).setValues([percentuali]);
    
    // Applica formato percentuale
    sheet.getRange(rowNum, 2, 1, numCols - 1).setNumberFormat('0.0%');

  } catch (e) {
    LOG.error('PNL_PERCENT_CALC', `Errore calcolo percentuali riga ${rowNum}`, { error: e.message, rigaValore, rigaFatturato });
    // Fallback: celle vuote
    try {
      const numColsToWrite = Object.keys(headerMap).length - 1;
      if (numColsToWrite > 0) {
        sheet.getRange(rowNum, 2, 1, numColsToWrite).setValue("");
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
 * Legge Dati Mensili in Map<Sede, Map<AnnoMese, {fatturato, personale, azienda, reparto}>>
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
    const idxAzienda = idx.Azienda; // opzionale
    const idxReparto = idx.Reparto; // opzionale

    const lastCol = Math.max(idx.Sede, idx.AnnoMese, idx.Fatturato, idxPersonale ?? 0, idxAzienda ?? 0, idxReparto ?? 0) + 1;
    const rows = sh.getRange(headerRow + 1, 1, sh.getLastRow() - headerRow, lastCol).getValues();

    rows.forEach(r => {
      const sede = String(r[idx.Sede] ?? 'Non Assegnata').trim() || 'Non Assegnata';
      const ym = String(r[idx.AnnoMese] ?? '').trim();
      if (!/^\d{4}-\d{2}$/.test(ym)) return;

      const fatt = UTIL.parseNumSmart(r[idx.Fatturato]);
      const pers = idxPersonale !== undefined ? UTIL.parseNumSmart(r[idxPersonale]) : 0;
      const azienda = idxAzienda !== undefined ? String(r[idxAzienda] ?? '').trim() : null;
      const reparto = idxReparto !== undefined ? String(r[idxReparto] ?? '').trim() : null;

      if (!result.has(sede)) result.set(sede, new Map());
      const m = result.get(sede);
      const curr = m.get(ym) || { fatturato: 0, personale: 0, azienda, reparto };
      curr.fatturato += fatt;
      curr.personale += pers;
      if (azienda) curr.azienda = azienda;
      if (reparto) curr.reparto = reparto;
      m.set(ym, curr);
    });
  } catch (e) {
    LOG.error('PNL_DM', 'Errore lettura Dati Mensili.', { error: e.message });
  }
  return result;
}


/**
 * Mappa FornitoreID normalizzato -> {famiglia, reparto, azienda}
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
    const lastCol = Math.max(idx.FornitoreID, idx.Famiglia, idx.Reparto ?? 0, idx.Azienda ?? 0) + 1;
    const rows = sh.getRange(headerRow + 1, 1, sh.getLastRow() - headerRow, lastCol).getValues();

    rows.forEach(r => {
      const idRaw = String(r[idx.FornitoreID] ?? '');
      const idNorm = UTIL.normKey(idRaw).replace(/^0+/, '');
      if (!idNorm) return;
      const fam = String(r[idx.Famiglia] ?? '').trim() || 'Non Categorizzato';
      const reparto = idx.Reparto !== undefined ? String(r[idx.Reparto] ?? '').trim() : null;
      const azienda = idx.Azienda !== undefined ? String(r[idx.Azienda] ?? '').trim() : null;
      map.set(idNorm, { famiglia: fam, reparto, azienda });
    });
  } catch (e) {
    LOG.error('PNL_FOR', 'Errore lettura Fornitori.', { error: e.message });
  }
  return map;
}


/**
 * Aggrega costi fornitori: Map<Sede, Map<AnnoMese, Map<Famiglia, {costoNetto, reparto, azienda}>>>
 * Usa TotImponibile (segno già corretto da import) e info da Fornitori + Fatture.
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
    const lastCol = Math.max(idx.Sede, idx.Data, idx.TotImponibile, idx.FornitoreID, idx.Reparto ?? 0, idx.Azienda ?? 0) + 1;
    const rows = sh.getRange(headerRow + 1, 1, sh.getLastRow() - headerRow, lastCol).getValues();

    rows.forEach(r => {
      const sede = String(r[idx.Sede] ?? 'Non Assegnata').trim() || 'Non Assegnata';
      const data = r[idx.Data];
      if (!(data instanceof Date) || isNaN(data.getTime())) return;

      const ym = `${data.getFullYear()}-${('0' + (data.getMonth() + 1)).slice(-2)}`;
      const idRaw = String(r[idx.FornitoreID] ?? '');
      const idNorm = UTIL.normKey(idRaw).replace(/^0+/, '');
      const infoFornitore = famiglieFornitori.get(idNorm) || { famiglia: 'Non Categorizzato', reparto: null, azienda: null };
      const famiglia = infoFornitore.famiglia;
      // Priorità: Reparto da Fatture, poi da Fornitori
      const repartoFattura = idx.Reparto !== undefined ? String(r[idx.Reparto] ?? '').trim() : null;
      const aziendaFattura = idx.Azienda !== undefined ? String(r[idx.Azienda] ?? '').trim() : null;
      const reparto = repartoFattura || infoFornitore.reparto;
      const azienda = aziendaFattura || infoFornitore.azienda;
      const costoNetto = UTIL.parseNumSmart(r[idx.TotImponibile]); // può essere negativo per NC

      if (!result.has(sede)) result.set(sede, new Map());
      const m = result.get(sede);
      if (!m.has(ym)) m.set(ym, new Map());
      const famMap = m.get(ym);
      if (!famMap.has(famiglia)) {
        famMap.set(famiglia, { costoNetto: 0, reparto, azienda });
      }
      const curr = famMap.get(famiglia);
      curr.costoNetto += costoNetto;
      if (reparto) curr.reparto = reparto;
      if (azienda) curr.azienda = azienda;
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
/**
 * Ordina le famiglie rispettando l'ordine fisso definito in FAMIGLIE_ORDINATE.
 * Le famiglie non presenti nell'ordine fisso vengono aggiunte alla fine in ordine alfabetico.
 * @private
 */
function _sortFamiliesFixed(famList, VOCE_CEDOLINI, FAMIGLIE_ORDINATE) {
  const arr = famList.filter(f => f && f !== VOCE_CEDOLINI); // Filtra null, undefined, "" e VOCE_CEDOLINI
  const ordineFisso = FAMIGLIE_ORDINATE.filter(f => f !== VOCE_CEDOLINI); // Ordine di riferimento senza Cedolini
  
  // Crea mappa posizione famiglia -> indice per ordinamento veloce
  const posizioneMap = new Map();
  ordineFisso.forEach((fam, idx) => posizioneMap.set(fam, idx));

  arr.sort((a, b) => {
    const posA = posizioneMap.has(a) ? posizioneMap.get(a) : Number.POSITIVE_INFINITY;
    const posB = posizioneMap.has(b) ? posizioneMap.get(b) : Number.POSITIVE_INFINITY;
    
    if (posA !== posB) {
      return posA - posB; // Ordina per posizione nell'array fisso
    }
    
    // Se entrambe non sono nell'ordine fisso, ordina alfabeticamente
    return String(a).localeCompare(String(b));
  });

  return arr;
}

/**
 * LEGACY: Ordina le famiglie con logica numerica e alfabetica (non più usata).
 * Mantenuta per backward compatibility se necessario ripristinarla.
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

/**
 * Legge il foglio "Aziende" e crea una mappa Sede → Azienda (Gemma/Zaffiro).
 * Necessario perché il campo "azienda" non è presente in "Dati Mensili" ma in "Aziende".
 * Inferisce l'azienda dalla P_IVA: 4230940167 = Gemma, 4489830986 = Zaffiro
 * @returns {Map<string, string>} Mappa Sede → Azienda
 * @private
 */
function _getAziendaMap() {
  const aziendaMap = new Map();
  
  // Mapping P_IVA → Azienda (hardcoded per robustezza)
  const pIvaToAzienda = {
    '4230940167': 'Gemma',
    '4489830986': 'Zaffiro'
  };
  
  try {
    const shAziende = SHEETS.get('Aziende');
    if (!shAziende) {
      LOG.warn('PNL_AZIENDA_MAP', 'Foglio "Aziende" non trovato. Impossibile determinare Azienda per le sedi.');
      return aziendaMap;
    }

    const headerRow = SHEETS._findHeaderRow(shAziende, 'Aziende');
    const lastRow = shAziende.getLastRow();
    
    if (lastRow <= headerRow) {
      LOG.warn('PNL_AZIENDA_MAP', 'Foglio "Aziende" vuoto.');
      return aziendaMap;
    }

    const idx = SHEETS.headerIndex('Aziende');
    
    // Verifica che le colonne necessarie esistano (P_IVA_Azienda e Nome_Sede)
    if (idx.P_IVA_Azienda === undefined || idx.Nome_Sede === undefined) {
      LOG.error('PNL_AZIENDA_MAP', 'Colonne "P_IVA_Azienda" o "Nome_Sede" non trovate nel foglio "Aziende".');
      return aziendaMap;
    }

    const maxCol = Math.max(idx.P_IVA_Azienda, idx.Nome_Sede) + 1;
    const rows = shAziende.getRange(headerRow + 1, 1, lastRow - headerRow, maxCol).getValues();

    rows.forEach(row => {
      const pIva = String(row[idx.P_IVA_Azienda] ?? '').trim();
      const sede = String(row[idx.Nome_Sede] ?? '').trim();
      
      if (sede && pIva) {
        const azienda = pIvaToAzienda[pIva];
        if (azienda) {
          aziendaMap.set(sede, azienda);
        } else {
          LOG.warn('PNL_AZIENDA_MAP', `P_IVA non riconosciuta per sede "${sede}": ${pIva}`);
        }
      }
    });

    LOG.info('PNL_AZIENDA_MAP', `Mappa Sede→Azienda creata con ${aziendaMap.size} sedi.`);
    
  } catch (e) {
    LOG.error('PNL_AZIENDA_MAP', 'Errore lettura foglio "Aziende".', { error: e.message, stack: e.stack });
  }
  
  return aziendaMap;
}
