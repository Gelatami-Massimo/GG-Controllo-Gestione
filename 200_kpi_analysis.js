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
   * Recupera numero scontrini da Dati Mensili (struttura cedolini) per azienda e mese.
   * Esclude Hotel, supporta AnnoMese o Anno+Mese, e colonne "N. Scontrini" o "N. Doc".
   * @returns {Map<string, Map<number, number>>} Map<Azienda, Map<Mese, N.Scontrini>>
   */
  function _getReceiptCounts(anno, runId) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetName = 'Dati Mensili';
    const sh = ss.getSheetByName(sheetName);
    if (!sh) {
      LOG.warn(runId, 'KPI_NO_RECEIPTS_SHEET', `Foglio "${sheetName}" non trovato`);
      return new Map();
    }

    try {
      const headerRow = (typeof SHEETS !== 'undefined' && SHEETS._findHeaderRow)
        ? SHEETS._findHeaderRow(sh, sheetName)
        : 1;
      const idx = (typeof SHEETS !== 'undefined' && SHEETS.headerIndex)
        ? SHEETS.headerIndex(sheetName)
        : null;
      const lastCol = sh.getLastColumn();
      const headers = sh.getRange(headerRow, 1, 1, lastCol).getValues()[0];

      let sedeCol = -1, annoMeseCol = -1, annoCol = -1, meseCol = -1, repCol = -1, azCol = -1, scontriniCol = -1;
      if (idx) {
        sedeCol = idx.Sede ?? -1;
        annoMeseCol = idx.AnnoMese ?? -1;
        annoCol = idx.Anno ?? -1;
        meseCol = idx.Mese ?? -1;
        repCol = idx.Reparto ?? -1;
        azCol = idx.Azienda ?? -1;
        scontriniCol = (idx['N._Scontrini'] !== undefined) ? idx['N._Scontrini'] : (idx['N._Doc'] ?? -1);
      } else {
        headers.forEach((h, i) => {
          const key = String(h).trim().toUpperCase().replace(/\s+/g, '');
          if (key === 'SEDE') sedeCol = i;
          else if (key === 'ANNOMESE' || key === 'ANNO-MESE' || key === 'ANNO_MESE') annoMeseCol = i;
          else if (key === 'ANNO') annoCol = i;
          else if (key === 'MESE') meseCol = i;
          else if (key === 'REPARTO') repCol = i;
          else if (key === 'AZIENDA') azCol = i;
          else if (key === 'N.SCONTRINI' || key === 'NSCONTRINI' || key === 'N.DOC' || key === 'NDOC') scontriniCol = i;
        });
      }

      const lastRow = sh.getLastRow();
      if (lastRow <= headerRow) {
        LOG.warn(runId, 'KPI_RECEIPTS_EMPTY', `Foglio "${sheetName}" vuoto`);
        return new Map();
      }

      LOG.info(runId, 'KPI_RECEIPTS_HEADERS', 'Headers foglio Dati Mensili', {
        headerRow,
        totalHeaders: headers.length,
        sedeCol, annoMeseCol, annoCol, meseCol, repCol, azCol, scontriniCol,
        firstHeaders: headers.slice(0, 15).map((h, i) => `${i}: ${String(h).trim()}`)
      });

      if (sedeCol === -1) {
        LOG.error(runId, 'KPI_NO_SEDE_COL', 'Colonna "Sede" non trovata in Dati Mensili');
        return new Map();
      }
      if (scontriniCol === -1) {
        LOG.warn(runId, 'KPI_NO_RECEIPTS_COL', 'Colonna scontrini non trovata (cerca N. Scontrini o N. Doc)');
        return new Map();
      }

      let companyMap = null;
      try { if (typeof SHEETS !== 'undefined' && SHEETS.getCompanyMap) companyMap = SHEETS.getCompanyMap(); } catch(_) {}

      const numRows = lastRow - headerRow;
      const data = sh.getRange(headerRow + 1, 1, numRows, lastCol).getValues();
      const scontriniMap = new Map();
      let rowsProcessed = 0;
      let rowsSkipped = 0;

      data.forEach(row => {
        const sede = String(row[sedeCol] ?? '').trim();
        if (!sede) { rowsSkipped++; return; }
        const annoMeseVal = annoMeseCol !== -1 ? String(row[annoMeseCol] ?? '').trim() : '';
        const annoVal = annoCol !== -1 ? String(row[annoCol] ?? '').trim() : '';
        const meseVal = meseCol !== -1 ? row[meseCol] : '';
        const repartoVal = repCol !== -1 ? String(row[repCol] ?? '').trim().toUpperCase() : '';
        const aziendaVal = azCol !== -1 ? String(row[azCol] ?? '').trim() : '';
        const rawScontrini = row[scontriniCol];

        if (repartoVal === 'HOTEL') { rowsSkipped++; return; }

        let monthNum = null; let okYear = false;
        if (annoMeseVal && /^\d{4}-\d{2}$/.test(annoMeseVal)) {
          okYear = annoMeseVal.startsWith(anno);
          monthNum = parseInt(annoMeseVal.split('-')[1], 10);
        } else if (annoVal) {
          okYear = (annoVal === anno);
          if (meseVal !== '') {
            monthNum = typeof meseVal === 'number' ? meseVal : parseInt(String(meseVal).trim(), 10);
          }
        }
        if (!okYear || !monthNum || isNaN(monthNum) || monthNum < 1 || monthNum > 12) { rowsSkipped++; return; }

        let azienda = aziendaVal || null;
        if (!azienda && companyMap) azienda = companyMap.get(sede) || null;
        if (!azienda) {
          const sUp = sede.toUpperCase();
          if (sUp.includes('GEMMA')) azienda = 'Gemma'; else if (sUp.includes('ZAFFIRO')) azienda = 'Zaffiro';
        }
        if (!azienda) { rowsSkipped++; return; }

        const numScontrini = (typeof rawScontrini === 'number') ? rawScontrini : parseInt(String(rawScontrini).replace(/[^0-9]/g, ''), 10) || 0;
        if (!scontriniMap.has(azienda)) scontriniMap.set(azienda, new Map());
        scontriniMap.get(azienda).set(monthNum, numScontrini);
        rowsProcessed++;
      });

      LOG.info(runId, 'KPI_RECEIPTS_LOADED', 'Conteggi scontrini caricati', {
        totalSeats: scontriniMap.size,
        totalRecords: data.length,
        rowsProcessed,
        rowsSkipped
      });

      return scontriniMap;

    } catch (e) {
      LOG.error(runId, 'KPI_RECEIPTS_ERROR', 'Errore lettura conteggi scontrini', { error: e.message, stack: e.stack });
      return new Map();
    }
  }

  /**
   * Recupera dati acquisti normalizzati usando la logica di MAGAZZINO_CORE.
   * 
   * Workflow:
   * 1. Usa buildMagazzinoBaseRows_ con filtro date
   * 2. Aggrega per Sede, Mese, Categoria
   * 3. Calcola totali: KG, PZ, €
   * 
   * @param {Object} dateFilter - Filtro date {start: Date, end: Date}
   * @param {string} runId - ID esecuzione per logging
   * @returns {Array<Object>} Array di oggetti acquisto normalizzati
   * @private
   */
  function _getRawPurchaseData(dateFilter, runId) {
    try {
      LOG.info(runId, 'KPI_USE_MAGAZZINO', 'Utilizzo logica MAGAZZINO_CORE per recupero dati');

      // ✅ Usa la funzione di MAGAZZINO_CORE con filtro date
      const magazzinoDateFilter = {
        startDate: dateFilter.start,
        endDate: dateFilter.end
      };

      // Chiama buildMagazzinoBaseRows_ senza filtro ingrediente (tutti i prodotti)
      const rowsBase = MAGAZZINO_CORE.buildMagazzinoBaseRows_(
        magazzinoDateFilter,
        false, // filterByIngrediente = false (vogliamo TUTTI i prodotti)
        runId
      );

      LOG.info(runId, 'KPI_MAGAZZINO_ROWS', 'Righe base magazzino recuperate', {
        totalRows: rowsBase.length
      });

      if (rowsBase.length === 0) {
        LOG.warn(runId, 'KPI_NO_MAGAZZINO_DATA', 'Nessuna riga base dal magazzino', {
          dateFilterStart: dateFilter.start.toISOString(),
          dateFilterEnd: dateFilter.end.toISOString()
        });
        return [];
      }

      // ✅ Trasforma rowsBase in formato KPI
      const rawPurchases = [];
      // Mappa Sede -> Azienda (Gemma/Zaffiro) se disponibile
      let companyMap = null;
      try {
        if (typeof SHEETS !== 'undefined' && SHEETS.getCompanyMap) {
          companyMap = SHEETS.getCompanyMap();
        }
      } catch (_) {}

      rowsBase.forEach(rb => {
        // Salta righe senza mese (dati incompleti)
        if (!rb.mese) {
          return;
        }

        // Escludi Hotel dal KPI (richiesta: niente aggregati Hotel)
        const repartoUpper = String(rb.reparto || '').trim().toUpperCase();
        if (repartoUpper === 'HOTEL') {
          return;
        }

        // Determina azienda (Gemma/Zaffiro) dalla sede delle righe magazzino
        let azienda = null;
        const sedeRaw = String(rb.sede || '').trim();
        if (companyMap && sedeRaw) {
          azienda = companyMap.get(sedeRaw) || null;
        }
        if (!azienda && sedeRaw) {
          const sUp = sedeRaw.toUpperCase();
          if (sUp.includes('GEMMA')) azienda = 'Gemma';
          else if (sUp.includes('ZAFFIRO')) azienda = 'Zaffiro';
        }
        // Fallback prudente: usa direttamente sedeRaw se già è Gemma/Zaffiro
        if (!azienda && (sedeRaw.toUpperCase() === 'GEMMA' || sedeRaw.toUpperCase() === 'ZAFFIRO')) {
          azienda = sedeRaw;
        }
        // Se ancora non determinata, metti come 'Sede Non Assegnata' per evitare mismatch silenziosi
        const sede = azienda || 'Sede Non Assegnata';

        rawPurchases.push({
          sede,
          mese: rb.mese,  // ⭐ Ora disponibile da buildMagazzinoBaseRows_
          categoria: rb.categoriaProdotto || 'Non Categorizzato',
          pzBase: rb.pzBase || 0,
          kgBase: rb.kgBase || 0,
          euro: rb.euro || 0
        });
      });

      LOG.info(runId, 'KPI_RAW_PURCHASES', 'Dati acquisti processati da magazzino', {
        totalRows: rawPurchases.length
      });

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
