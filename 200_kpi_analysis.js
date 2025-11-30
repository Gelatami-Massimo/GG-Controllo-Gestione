// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 200_kpi_analysis.js
// RUOLO: Analisi KPI consumi (Acquisti / N. Scontrini)
// NOTE: Calcola KG/Scontrino, PZ/Scontrino, €/Scontrino per Sede/Mese/Categoria
// =============================================================

const KPI_ANALYSIS = (function() {

  /**
   * Genera report KPI consumi per anno.
   * Calcola rapporti: Acquisti (KG, PZ, €) diviso Numero Scontrini.
   * 
   * Workflow:
   * 1. Richiede anno all'utente
   * 2. Recupera dati acquisti da Righe + Prodotti
   * 3. Recupera numero scontrini da "Dati Mensili"
   * 4. Aggrega per Sede > Mese > Categoria
   * 5. Calcola KPI: KG/Scontrino, PZ/Scontrino, €/Scontrino
   * 6. Scrive foglio "KPI Consumi [ANNO]"
   * 
   * @returns {void}
   */
  function runConsumptionReport() {
    const runId = LOG.generateRunId();
    LOG.info(runId, 'KPI_START', 'Avvio generazione report KPI consumi');

    try {
      const ui = SpreadsheetApp.getUi();
      
      // ✅ STEP 1: Richiedi anno
      const yearResponse = ui.prompt(
        '📊 KPI Consumi - Anno di riferimento',
        'Inserisci l\'anno (es. 2025):',
        ui.ButtonSet.OK_CANCEL
      );
      
      if (yearResponse.getSelectedButton() !== ui.Button.OK) {
        LOG.info(runId, 'KPI_CANCELLED', 'Operazione annullata dall\'utente');
        return;
      }
      
      const anno = yearResponse.getResponseText().trim();
      if (!/^\d{4}$/.test(anno)) {
        ui.alert('❌ Errore', 'Anno non valido. Inserire un anno a 4 cifre (es. 2025).', ui.ButtonSet.OK);
        return;
      }

      UTIL.showToast('Elaborazione KPI consumi in corso...', 'KPI Analysis', 10);

      // ✅ STEP 2: Definisci filtro date (1 Gen - 31 Dic)
      const dateFilter = {
        start: new Date(Number(anno), 0, 1),  // 1 Gennaio
        end: new Date(Number(anno), 11, 31)   // 31 Dicembre
      };

      LOG.info(runId, 'KPI_DATE_FILTER', 'Filtro date impostato', {
        anno,
        dataInizio: dateFilter.start.toISOString(),
        dataFine: dateFilter.end.toISOString()
      });

      // ✅ STEP 3: Recupera dati acquisti
      const rawPurchases = _getRawPurchaseData(dateFilter, runId);
      
      if (rawPurchases.length === 0) {
        ui.alert(
          '⚠️ Nessun dato',
          `Nessun acquisto trovato per l'anno ${anno}.`,
          ui.ButtonSet.OK
        );
        return;
      }

      LOG.info(runId, 'KPI_PURCHASES', 'Dati acquisti recuperati', {
        totalRows: rawPurchases.length
      });

      // ✅ STEP 4: Recupera numero scontrini
      const scontriniMap = _getReceiptCounts(anno, runId);
      
      LOG.info(runId, 'KPI_RECEIPTS', 'Conteggi scontrini recuperati', {
        totalSeats: scontriniMap.size
      });

      // ✅ STEP 5: Aggrega per Sede > Mese > Categoria
      const aggregati = {};

      rawPurchases.forEach(purchase => {
        const key = `${purchase.sede}||${purchase.mese}||${purchase.categoria}`;
        
        if (!aggregati[key]) {
          aggregati[key] = {
            sede: purchase.sede,
            mese: purchase.mese,
            categoria: purchase.categoria,
            kgTot: 0,
            pzTot: 0,
            euroTot: 0
          };
        }

        aggregati[key].kgTot += purchase.kgBase;
        aggregati[key].pzTot += purchase.pzBase;
        aggregati[key].euroTot += purchase.euro;
      });

      LOG.info(runId, 'KPI_AGGREGATION', 'Aggregazione completata', {
        totalKeys: Object.keys(aggregati).length
      });

      // ✅ STEP 6: Scrivi report
      _writeKpiReport(aggregati, scontriniMap, anno, runId);

      UTIL.showToast(
        `Report KPI ${anno} completato!`,
        'KPI Analysis',
        5
      );

      ui.alert(
        '✅ Report KPI Completato',
        `Foglio "KPI Consumi ${anno}" creato con successo.\n\n` +
        `Aggregazioni: ${Object.keys(aggregati).length}\n` +
        `Sedi monitorate: ${scontriniMap.size}`,
        ui.ButtonSet.OK
      );

      LOG.info(runId, 'KPI_COMPLETE', 'Report KPI completato', { anno });

    } catch (e) {
      LOG.error(runId, 'KPI_ERROR', 'Errore generazione report KPI', {
        error: e.message,
        stack: e.stack
      });
      
      SpreadsheetApp.getUi().alert(
        '❌ Errore',
        `Errore durante la generazione del report KPI:\n${e.message}`,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
      
      throw e;
    }
  }

  /**
   * Recupera numero scontrini da foglio "Dati Mensili".
   * 
   * Cerca dinamicamente le colonne:
   * - "Sede" (obbligatoria)
   * - "AnnoMese" o "Anno-Mese" (obbligatoria)
   * - "N.Scontrini" o "N. Scontrini" o "N.Doc" (con fallback)
   * 
   * @param {string} anno - Anno di riferimento (es. "2025")
   * @param {string} runId - ID esecuzione per logging
   * @returns {Map<string, Map<number, number>>} Map<Sede, Map<MeseNumerico, NumeroScontrini>>
   * @private
   */
  function _getReceiptCounts(anno, runId) {
    const sheetName = 'Dati Mensili';
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    
    if (!sh) {
      LOG.warn(runId, 'KPI_NO_RECEIPTS_SHEET', `Foglio "${sheetName}" non trovato`);
      return new Map();
    }

    try {
      const lastRow = sh.getLastRow();
      if (lastRow < 2) {
        LOG.warn(runId, 'KPI_RECEIPTS_EMPTY', `Foglio "${sheetName}" vuoto`);
        return new Map();
      }

      // Leggi header (riga 1)
      const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
      
      // ✅ Cerca colonne dinamicamente
      let sedeCol = -1;
      let annoMeseCol = -1;
      let scontriniCol = -1;

      headers.forEach((header, idx) => {
        const h = String(header).trim().toUpperCase();
        
        if (h === 'SEDE') {
          sedeCol = idx;
        } else if (h === 'ANNOMESE' || h === 'ANNO-MESE' || h === 'ANNO_MESE') {
          annoMeseCol = idx;
        } else if (h === 'N.SCONTRINI' || h === 'N. SCONTRINI' || h === 'NSCONTRINI' || h === 'N.DOC' || h === 'N. DOC') {
          scontriniCol = idx;
        }
      });

      // Validazione colonne obbligatorie
      if (sedeCol === -1) {
        LOG.error(runId, 'KPI_NO_SEDE_COL', 'Colonna "Sede" non trovata in Dati Mensili');
        return new Map();
      }

      if (annoMeseCol === -1) {
        LOG.error(runId, 'KPI_NO_ANNOMESE_COL', 'Colonna "AnnoMese" non trovata in Dati Mensili');
        return new Map();
      }

      if (scontriniCol === -1) {
        LOG.warn(runId, 'KPI_NO_RECEIPTS_COL', 'Colonna scontrini non trovata in Dati Mensili (cercato: N.Scontrini, N.Doc)');
        return new Map();
      }

      LOG.info(runId, 'KPI_RECEIPTS_COLS', 'Colonne identificate in Dati Mensili', {
        sedeCol,
        annoMeseCol,
        scontriniCol
      });

      // Leggi dati
      const data = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
      const scontriniMap = new Map();

      data.forEach((row, i) => {
        const sede = String(row[sedeCol] || '').trim();
        const annoMeseVal = String(row[annoMeseCol] || '').trim();
        const scontriniVal = row[scontriniCol];

        // Filtra per anno
        if (!annoMeseVal.startsWith(anno)) {
          return;
        }

        // Estrai mese numerico (es. "2025-01" -> 1)
        const meseParts = annoMeseVal.split('-');
        if (meseParts.length !== 2) {
          LOG.warn(runId, 'KPI_INVALID_ANNOMESE', 'Formato AnnoMese non valido', {
            rowNum: i + 2,
            annoMeseVal
          });
          return;
        }

        const meseNum = parseInt(meseParts[1], 10);
        if (isNaN(meseNum) || meseNum < 1 || meseNum > 12) {
          LOG.warn(runId, 'KPI_INVALID_MONTH', 'Mese non valido', {
            rowNum: i + 2,
            meseNum
          });
          return;
        }

        // Converti scontrini in numero
        const numScontrini = Number(scontriniVal) || 0;

        // Inizializza mappa sede se non esiste
        if (!scontriniMap.has(sede)) {
          scontriniMap.set(sede, new Map());
        }

        // Salva conteggio scontrini
        scontriniMap.get(sede).set(meseNum, numScontrini);
      });

      LOG.info(runId, 'KPI_RECEIPTS_LOADED', 'Conteggi scontrini caricati', {
        totalSeats: scontriniMap.size,
        totalRecords: data.length
      });

      return scontriniMap;

    } catch (e) {
      LOG.error(runId, 'KPI_RECEIPTS_ERROR', 'Errore lettura conteggi scontrini', {
        error: e.message,
        stack: e.stack
      });
      return new Map();
    }
  }

  /**
   * Recupera dati acquisti normalizzati da Righe + Prodotti.
   * 
   * Workflow:
   * 1. Legge Prodotti per creare mappa con: Categoria, UMBase, PZxCT, KGxPZ
   * 2. Legge Righe filtrate per data
   * 3. Per ogni riga, calcola pzBase e kgBase usando fattori di conversione
   * 4. Restituisce array con: sede, mese, categoria, pzBase, kgBase, euro
   * 
   * @param {Object} dateFilter - Filtro date {start: Date, end: Date}
   * @param {string} runId - ID esecuzione per logging
   * @returns {Array<Object>} Array di oggetti acquisto normalizzati
   * @private
   */
  function _getRawPurchaseData(dateFilter, runId) {
    try {
      // ✅ STEP 1: Crea mappa prodotti
      const shProdotti = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
      if (!shProdotti) {
        LOG.error(runId, 'KPI_NO_PRODUCTS', 'Foglio Prodotti non trovato');
        return [];
      }

      const headerRowP = SHEETS._findHeaderRow(shProdotti, SHEETS.SHEET_NAMES.Prodotti);
      const idxP = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
      
      const requiredColsP = ['CodiceInternoBreve', 'CategoriaProdotto', 'UMBase', 'PZxCT', 'KGxPZ'];
      const missingColsP = requiredColsP.filter(col => idxP[col] === undefined);
      
      if (missingColsP.length > 0) {
        LOG.error(runId, 'KPI_MISSING_PRODUCT_COLS', 'Colonne mancanti in Prodotti', { missingColsP });
        return [];
      }

      const lastRowP = shProdotti.getLastRow();
      const valuesP = shProdotti.getRange(headerRowP + 1, 1, lastRowP - headerRowP, shProdotti.getLastColumn()).getValues();
      
      const prodottiMap = new Map();
      
      valuesP.forEach(row => {
        const codice = String(row[idxP.CodiceInternoBreve] || '').trim();
        if (!codice) return;
        
        prodottiMap.set(codice, {
          categoria: String(row[idxP.CategoriaProdotto] || 'Non Categorizzato').trim(),
          umBase: String(row[idxP.UMBase] || 'PZ').trim().toUpperCase(),
          pzxCT: Number(row[idxP.PZxCT]) || 1,
          kgxPZ: Number(row[idxP.KGxPZ]) || 0
        });
      });

      LOG.info(runId, 'KPI_PRODUCTS_MAP', 'Mappa prodotti creata', {
        totalProducts: prodottiMap.size
      });

      // ✅ STEP 2: Leggi Righe
      const shRighe = SHEETS.get(SHEETS.SHEET_NAMES.Righe);
      if (!shRighe) {
        LOG.error(runId, 'KPI_NO_ROWS', 'Foglio Righe non trovato');
        return [];
      }

      const headerRowR = SHEETS._findHeaderRow(shRighe, SHEETS.SHEET_NAMES.Righe);
      const idxR = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Righe);
      
      const requiredColsR = ['DataFattura', 'CodiceInternoBreve', 'Quantita', 'UM', 'TotRigaLordo', 'Reparto'];
      const missingColsR = requiredColsR.filter(col => idxR[col] === undefined);
      
      if (missingColsR.length > 0) {
        LOG.error(runId, 'KPI_MISSING_ROWS_COLS', 'Colonne mancanti in Righe', { missingColsR });
        return [];
      }

      const lastRowR = shRighe.getLastRow();
      
      if (lastRowR <= headerRowR) {
        LOG.warn(runId, 'KPI_ROWS_EMPTY', 'Foglio Righe vuoto');
        return [];
      }
      
      const valuesR = shRighe.getRange(headerRowR + 1, 1, lastRowR - headerRowR, shRighe.getLastColumn()).getValues();
      
      const rawPurchases = [];
      let totalRowsProcessed = 0;
      let validDates = 0;
      let matchedDates = 0;

      // ✅ STEP 3: Processa righe
      valuesR.forEach((row, i) => {
        totalRowsProcessed++;
        const dataFattura = row[idxR.DataFattura];
        
        // Validazione data
        if (!(dataFattura instanceof Date) || isNaN(dataFattura.getTime())) {
          return;
        }
        validDates++;

        // ⭐ Normalizza date per confronto (ignora ore/minuti/secondi)
        const dataFatturaNorm = new Date(dataFattura.getFullYear(), dataFattura.getMonth(), dataFattura.getDate());
        const startNorm = new Date(dateFilter.start.getFullYear(), dateFilter.start.getMonth(), dateFilter.start.getDate());
        const endNorm = new Date(dateFilter.end.getFullYear(), dateFilter.end.getMonth(), dateFilter.end.getDate());
        
        // Filtro date
        if (dataFatturaNorm < startNorm || dataFatturaNorm > endNorm) {
          return;
        }
        matchedDates++;

        const codice = String(row[idxR.CodiceInternoBreve] || '').trim();
        const quantita = Number(row[idxR.Quantita]) || 0;
        const um = String(row[idxR.UM] || 'PZ').trim().toUpperCase();
        const euro = Number(row[idxR.TotRigaLordo]) || 0;
        const reparto = String(row[idxR.Reparto] || '').trim();

        // ⭐ Determina sede dal reparto con mappatura robusta
        let sede = 'Gelateria'; // Default
        const repartoUpper = reparto.toUpperCase();
        
        if (repartoUpper === 'HOTEL') {
          sede = 'Hotel';
        } else if (repartoUpper === 'ZAFFIRO' || repartoUpper === 'GEMMA') {
          sede = repartoUpper.charAt(0) + repartoUpper.slice(1).toLowerCase(); // "Zaffiro" o "Gemma"
        }
        // Altri valori (vuoto, "Gelateria", etc.) → "Gelateria"

        // Estrai mese (1-12)
        const mese = dataFattura.getMonth() + 1;

        // Cerca prodotto nella mappa
        const prodotto = prodottiMap.get(codice);
        if (!prodotto) {
          // Prodotto non trovato - usa valori di default
          rawPurchases.push({
            sede,
            mese,
            categoria: 'Non Categorizzato',
            pzBase: um === 'PZ' ? quantita : (um === 'CT' ? quantita : 0),
            kgBase: um === 'KG' ? quantita : 0,
            euro
          });
          return;
        }

        // ✅ Calcola quantità normalizzate
        let pzBase = 0;
        let kgBase = 0;

        if (prodotto.umBase === 'PZ') {
          // UMBase = PZ
          if (um === 'PZ') {
            pzBase = quantita;
          } else if (um === 'CT') {
            pzBase = quantita * prodotto.pzxCT;
          } else if (um === 'KG') {
            // KG acquistati, non convertibile in PZ senza fattore inverso
            pzBase = 0;
          }
          
          kgBase = pzBase * prodotto.kgxPZ;

        } else if (prodotto.umBase === 'KG') {
          // UMBase = KG
          if (um === 'KG') {
            kgBase = quantita;
          } else if (um === 'PZ') {
            kgBase = quantita * prodotto.kgxPZ;
          } else if (um === 'CT') {
            kgBase = quantita * prodotto.pzxCT * prodotto.kgxPZ;
          }
          
          pzBase = kgBase > 0 && prodotto.kgxPZ > 0 ? kgBase / prodotto.kgxPZ : 0;
        }

        rawPurchases.push({
          sede,
          mese,
          categoria: prodotto.categoria,
          pzBase,
          kgBase,
          euro
        });
      });

      LOG.info(runId, 'KPI_RAW_PURCHASES', 'Dati acquisti processati', {
        totalRows: rawPurchases.length,
        totalRowsInSheet: valuesR.length,
        totalRowsProcessed,
        validDates,
        matchedDates,
        dateFilterStart: dateFilter.start.toISOString(),
        dateFilterEnd: dateFilter.end.toISOString()
      });

      // ⚠️ Diagnostica se nessun dato trovato
      if (rawPurchases.length === 0) {
        LOG.warn(runId, 'KPI_NO_DATA_DETAILS', 'Nessun acquisto trovato - dettagli', {
          totalRowsInSheet: valuesR.length,
          rowsWithValidDates: validDates,
          rowsMatchingDateFilter: matchedDates,
          yearRequested: dateFilter.start.getFullYear()
        });
      }

      return rawPurchases;

    } catch (e) {
      LOG.error(runId, 'KPI_PURCHASES_ERROR', 'Errore recupero dati acquisti', {
        error: e.message,
        stack: e.stack
      });
      return [];
    }
  }

  /**
   * Scrive report KPI su foglio "KPI Consumi [ANNO]".
   * 
   * Colonne:
   * - Sede, Mese, Categoria
   * - N. Scontrini
   * - KG Tot, PZ Tot, € Tot
   * - KG/Scontrino, PZ/Scontrino, €/Scontrino (formattati 4 decimali)
   * 
   * @param {Object} aggregati - Dati aggregati per chiave Sede||Mese||Categoria
   * @param {Map} scontriniMap - Map<Sede, Map<Mese, NumScontrini>>
   * @param {string} anno - Anno di riferimento
   * @param {string} runId - ID esecuzione per logging
   * @private
   */
  function _writeKpiReport(aggregati, scontriniMap, anno, runId) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = `KPI Consumi ${anno}`;
    
    // Elimina foglio esistente
    let sh = ss.getSheetByName(sheetName);
    if (sh) {
      ss.deleteSheet(sh);
      LOG.info(runId, 'KPI_DELETE_OLD_SHEET', 'Foglio esistente eliminato', { sheetName });
    }

    // Crea nuovo foglio
    sh = ss.insertSheet(sheetName);

    // ✅ STEP 1: Intestazioni
    const headers = [
      'Sede',           // A
      'Mese',           // B
      'Categoria',      // C
      'N. Scontrini',   // D
      'KG Tot',         // E
      'PZ Tot',         // F
      '€ Tot',          // G
      'KG/Scontrino',   // H
      'PZ/Scontrino',   // I
      '€/Scontrino'     // J
    ];

    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    
    // Formattazione header
    const headerRange = sh.getRange(1, 1, 1, headers.length);
    headerRange.setBackground('#1155CC');
    headerRange.setFontColor('#FFFFFF');
    headerRange.setFontWeight('bold');
    headerRange.setHorizontalAlignment('center');

    // ✅ STEP 2: Prepara righe
    const rows = [];

    for (const key in aggregati) {
      const agg = aggregati[key];
      
      // Recupera numero scontrini
      let numScontrini = 0;
      if (scontriniMap.has(agg.sede)) {
        const meseMap = scontriniMap.get(agg.sede);
        numScontrini = meseMap.get(agg.mese) || 0;
      }

      // Calcola KPI
      const kgPerScontrino = numScontrini > 0 ? agg.kgTot / numScontrini : 0;
      const pzPerScontrino = numScontrini > 0 ? agg.pzTot / numScontrini : 0;
      const euroPerScontrino = numScontrini > 0 ? agg.euroTot / numScontrini : 0;

      rows.push([
        agg.sede,
        agg.mese,
        agg.categoria,
        numScontrini,
        agg.kgTot,
        agg.pzTot,
        agg.euroTot,
        kgPerScontrino,
        pzPerScontrino,
        euroPerScontrino
      ]);
    }

    // ✅ STEP 3: Ordina righe (Sede > Mese > Categoria)
    rows.sort((a, b) => {
      // Sede
      const sedeCompare = a[0].localeCompare(b[0]);
      if (sedeCompare !== 0) return sedeCompare;
      
      // Mese
      const meseCompare = a[1] - b[1];
      if (meseCompare !== 0) return meseCompare;
      
      // Categoria
      return a[2].localeCompare(b[2]);
    });

    // ✅ STEP 4: Scrivi righe
    if (rows.length > 0) {
      sh.getRange(2, 1, rows.length, headers.length).setValues(rows);

      // Formattazione colonne
      sh.getRange(2, 1, rows.length, 1).setHorizontalAlignment('left');   // Sede
      sh.getRange(2, 2, rows.length, 1).setNumberFormat('0');              // Mese
      sh.getRange(2, 3, rows.length, 1).setHorizontalAlignment('left');   // Categoria
      sh.getRange(2, 4, rows.length, 1).setNumberFormat('#,##0');          // N. Scontrini
      sh.getRange(2, 5, rows.length, 1).setNumberFormat('#,##0.00');       // KG Tot
      sh.getRange(2, 6, rows.length, 1).setNumberFormat('#,##0');          // PZ Tot
      sh.getRange(2, 7, rows.length, 1).setNumberFormat('#,##0.00 €');    // € Tot

      // ⭐ Formattazione KPI (4 decimali + colore)
      const kpiRange1 = sh.getRange(2, 8, rows.length, 1); // KG/Scontrino
      kpiRange1.setNumberFormat('0.0000');
      kpiRange1.setBackground('#FFF3E0');
      kpiRange1.setFontWeight('bold');

      const kpiRange2 = sh.getRange(2, 9, rows.length, 1); // PZ/Scontrino
      kpiRange2.setNumberFormat('0.0000');
      kpiRange2.setBackground('#E8F5E9');
      kpiRange2.setFontWeight('bold');

      const kpiRange3 = sh.getRange(2, 10, rows.length, 1); // €/Scontrino
      kpiRange3.setNumberFormat('0.0000 €');
      kpiRange3.setBackground('#E3F2FD');
      kpiRange3.setFontWeight('bold');

      // Formattazione zebrata
      for (let i = 0; i < rows.length; i++) {
        if (i % 2 === 0) {
          const rowRange = sh.getRange(i + 2, 1, 1, 7); // Solo colonne non-KPI
          rowRange.setBackground('#F8F8F8');
        }
      }
    }

    // ✅ STEP 5: Larghezza colonne
    sh.setColumnWidth(1, 100);  // Sede
    sh.setColumnWidth(2, 60);   // Mese
    sh.setColumnWidth(3, 180);  // Categoria
    sh.setColumnWidth(4, 110);  // N. Scontrini
    sh.setColumnWidth(5, 90);   // KG Tot
    sh.setColumnWidth(6, 90);   // PZ Tot
    sh.setColumnWidth(7, 100);  // € Tot
    sh.setColumnWidth(8, 120);  // KG/Scontrino
    sh.setColumnWidth(9, 120);  // PZ/Scontrino
    sh.setColumnWidth(10, 120); // €/Scontrino

    // Freeze header
    sh.setFrozenRows(1);

    // Attiva foglio
    sh.activate();

    LOG.info(runId, 'KPI_REPORT_WRITTEN', 'Report KPI scritto', {
      sheetName,
      totalRows: rows.length
    });
  }

  // API pubblica
  return {
    runConsumptionReport
  };
})();

// Registra KPI_ANALYSIS nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('KPI_ANALYSIS', ['SHEETS', 'LOG', 'UTIL']);
}

// Registra KPI_ANALYSIS nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('KPI_ANALYSIS', KPI_ANALYSIS);
}
