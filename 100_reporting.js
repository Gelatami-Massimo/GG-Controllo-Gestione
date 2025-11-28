// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 100_reporting.js
// RUOLO: Report audit e riconciliazione dati (folder vs sheets).
// NOTE: Legge conteggi pre-calcolati da IMPORT_HEADERS, usa UTIL.date.
// =============================================================

const REPORTING = (function () {

  const REPORT_SHEET_NAME = 'Report Controllo';

  /**
   * Genera report audit completo con riconciliazione dati Drive/Sheets.
   * 
   * Sezioni report:
   * 1. RIEPILOGO GENERALE: fatture, righe, fornitori, prodotti totali
   * 2. AUDIT FINANZIARIO:
   *    - Conteggio file XML vs fatture nel foglio (discrepanza)
   *    - Somma totali certificata (da XML) vs totali foglio Fatture (discrepanza importi)
   * 3. AUDIT INTEGRITÀ DATI:
   *    - Righe con RichiedeSetup=TRUE (mancanza dati conversione UM)
   *    - Fatture senza righe importate (RigheImportate=FALSE)
   *    - Prodotti senza codice (TipoRiga='ProdottoSenzaCodice')
   *    - Duplicati fatture (FileId duplicati)
   *    - Duplicati righe (FileId|NumeroLinea duplicati)
   * 4. CONTEGGIO FILE PER MESE: Aggregazione per Anno-Mese (da Data Fattura)
   * 5. CONTEGGIO FILE PER CARTELLA: Aggregazione per percorso cartella Drive
   * 6. CONTROLLO STRUTTURA FOGLI: Verifica esistenza colonne richieste in ogni foglio
   * 
   * Output: Foglio "Report Controllo" con tabelle formattate e link ai fogli
   * 
   * @returns {void}
   * 
   * @example
   * REPORTING.run();
   */
  function run() {
    SHARED_UTILS.showToast('Generazione Report di Audit in corso...', 'Reporting', 10);

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(REPORT_SHEET_NAME);
    if (!sh) sh = ss.insertSheet(REPORT_SHEET_NAME, 0);

    // Pulizia robusta
    try { sh.clear(); } catch (_){}
    try { sh.getCharts().forEach(c => sh.removeChart(c)); } catch (_){}
    try { sh.getRange('1:1').clearFormat(); sh.getDataRange().breakApart(); } catch (_){}
    sh.activate(); // Porta il foglio in primo piano

    // Esegue i controlli
    const reports = {
      summary: _generateSummary(),
      financial: _performFinancialReconciliation(), // Ora legge il conteggio file da STATE
      integrity: _performDataIntegrityChecks(),
      schema: _performSchemaCheck(),
      // --- NUOVO: Legge i conteggi dettagliati ---
      auditCounts: _getAuditCountsFromState() // { month: Map, folder: Map }
      // --- FINE NUOVO ---
    };

    // Scrive il report
    _writeReport(sh, reports);

    SHARED_UTILS.showToast('Report di Audit generato con successo!', 'Completato', 5);
    LOG.info('REPORTING', 'Report di audit completato.');
  }

  /**
   * Scrive tutte le sezioni del report sul foglio.
   */
  function _writeReport(sh, reports) {
    let row = 1;
    const now = new Date();
    const formattedTimestamp = UTIL.date.formatTimestamp(now);
    sh.getRange(row++, 1, 1, 3) // Usa 3 colonne per coerenza
      .merge()
      .setValue(`Report di Audit Completo - ${formattedTimestamp}`)
      .setFontWeight('bold').setFontSize(14).setHorizontalAlignment('center');
    row++; // spazio

    // Helper link
    const createFilterLink = (sheetName) => {
       try {
         const ss = SpreadsheetApp.getActiveSpreadsheet();
         const shTarget = ss.getSheetByName(sheetName);
         if (!shTarget) return 'Foglio mancante';
         const url = `${ss.getUrl()}#gid=${shTarget.getSheetId()}`;
         return `=HYPERLINK("${url}";"Apri")`;
       } catch (e) {
         LOG?.warn('REPORTING_LINK', 'Impossibile creare link.', { sheetName, error: e.message });
         return 'Link non disponibile';
       }
     };

    // Mappa per formattazione valuta
    const financialEuroRows = {
        'Somma Totali Certificata (da Import)': true,
        'Somma Totali dal Foglio "Fatture"': true,
        'Discrepanza Importi': true
    };

    // --- STRUTTURA REPORT ---
    const reportSections = [
      { title: 'RIEPILOGO GENERALE', headers: [['Metrica', 'Valore']], data: [] },
      { title: 'AUDIT FINANZIARIO', headers: [['Controllo', 'Valore', 'Stato']], background: '#FFF2CC', isFinancial: true, data: [] }, // Sfondo Giallo chiaro
      { title: 'AUDIT INTEGRITÀ DATI', headers: [['Controllo', 'Quantità', 'Azione']], background: '#FCE8E6', data: [] }, // Sfondo Rosso chiaro
      { title: 'CONTEGGIO FILE PER MESE (da Data Fattura)', headers: [['Anno-Mese', 'Numero File XML']], background: '#E8F0FE', data: [] }, // Sfondo Blu chiaro
      { title: 'CONTEGGIO FILE PER CARTELLA', headers: [['Percorso Cartella', 'Numero File XML']], background: '#E6F4EA', data: [] }, // Sfondo Verde chiaro
      { title: 'CONTROLLO STRUTTURA FOGLI', headers: [['Foglio', 'Stato', 'Dettagli']], background: '#F1F3F4', isSchema: true, data: reports.schema } // Sfondo Grigio chiaro
    ];
    // --- FINE STRUTTURA REPORT ---

    // Popola dati dinamici
    reportSections[0].data = [
      ['Fatture Importate',       reports.summary.totalFatture],
      ['Righe Importate',         reports.summary.totalRighe],
      ['Fornitori in Anagrafica', reports.summary.totalFornitori],
      ['Prodotti in Catalogo',    reports.summary.totalProdotti],
    ];
    reportSections[1].data = [
      ['Conteggio File XML Totali (da Import)', reports.financial.driveFileCount, ''], // Etichetta aggiornata
      ['Conteggio Fatture nel Foglio',        reports.financial.sheetInvoiceCount, ''],
      ['Differenza Conteggio',                reports.financial.countDifference, reports.financial.countDifference !== 0 ? 'ATTENZIONE' : 'OK'],
      ['Somma Totali Certificata (da Import)',reports.financial.totalXml, ''],
      ['Somma Totali dal Foglio "Fatture"',   reports.financial.totalSheet, ''],
      ['Discrepanza Importi',                 reports.financial.amountDifference, (typeof reports.financial.amountDifference === 'number' && Math.abs(reports.financial.amountDifference) > 0.01) ? 'ATTENZIONE' : 'OK'],
      ['Fatture Duplicate Rilevate',          reports.financial.duplicates, (typeof reports.financial.duplicates === 'number' && reports.financial.duplicates > 0) ? 'ATTENZIONE' : (reports.financial.duplicates === 'Non Calcolato' ? 'ESEGUI "Marca Duplicati"' : 'OK')],
    ];
    reportSections[2].data = [
        ['Fatture con "Sede Non Assegnata"',     reports.integrity.unassignedSedi,           reports.integrity.unassignedSedi > 0 ? createFilterLink(SHEETS.SHEET_NAMES.Fatture)   : 'OK'],
        ['Fornitori non categorizzati',          reports.integrity.uncategorizedSuppliers, reports.integrity.uncategorizedSuppliers > 0 ? createFilterLink(SHEETS.SHEET_NAMES.Fornitori) : 'OK'],
        ['Prodotti non categorizzati',           reports.integrity.uncategorizedProducts,  reports.integrity.uncategorizedProducts > 0 ? createFilterLink(SHEETS.SHEET_NAMES.Prodotti)   : 'OK'],
        ['Righe Orfane (FileID non in Fatture)', reports.integrity.orphanRows,             reports.integrity.orphanRows > 0 ? 'CRITICO' : 'OK'],
        ['Righe Duplicate (Stesso FileID+Linea)', reports.integrity.duplicateRows,          reports.integrity.duplicateRows > 0 ? 'ATTENZIONE' : 'OK'],
    ];

    // --- POPOLA DATI CONTEGGI ---
    // Conteggio per Mese
    const monthCounts = reports.auditCounts.month;
    reportSections[3].data = Object.keys(monthCounts)
                                      .sort((a, b) => b.localeCompare(a)) // Ordine decrescente YYYY-MM
                                      .map(key => [key, monthCounts[key]]);
    // Conteggio per Cartella
    const folderCounts = reports.auditCounts.folder;
    reportSections[4].data = Object.keys(folderCounts)
                                        .sort((a, b) => a.localeCompare(b)) // Ordine alfabetico percorso
                                        .map(key => [key, folderCounts[key]]);
    // --- FINE POPOLAMENTO ---

    // Scrittura sezioni
    reportSections.forEach(section => {
      // Non scrivere sezioni conteggio/schema se non ci sono dati
      if ((section.title.startsWith('CONTEGGIO FILE') || section.title.startsWith('CONTROLLO STRUTTURA')) && (!section.data || section.data.length === 0)) {
           LOG.debug('REPORTING_WRITE', `Sezione '${section.title}' saltata perché vuota.`);
           return; // Salta questa sezione
      }

      const numCols = section.headers[0].length;
      const titleRange = sh.getRange(row, 1, 1, numCols > 1 ? numCols : 1);
      if (numCols > 1) titleRange.merge();
      titleRange.setValue(section.title).setFontWeight('bold').setBackground(section.background || '#e0e0e0');
      row++;

      const headerRange = sh.getRange(row, 1, 1, numCols);
      headerRange.setValues(section.headers).setFontStyle('italic');
      row++;

      if (section.data && section.data.length > 0) {
        const dataRowsCount = section.data.length;
        const dataRange = sh.getRange(row, 1, dataRowsCount, numCols);
        const dataToWrite = section.isSchema
          ? section.data.map(r => [r.sheet, r.status, r.details])
          : section.data;

        dataRange.setValues(dataToWrite);

        // Formattazione speciale
        const lastColIndex = numCols;
        const valueColIndex = 2;

        for (let i = 0; i < dataRowsCount; i++) {
            const currentRow = row + i;
            // Formato Stato/Azione (ultima colonna)
            const statusCell = sh.getRange(currentRow, lastColIndex);
            const statusValue = String(dataToWrite[i][lastColIndex - 1] ?? '').toUpperCase();
            if (statusValue === 'ATTENZIONE' || statusValue === 'CRITICO' || statusValue.startsWith('ERRORE') || statusValue === 'MANCANTE' || statusValue === 'DISALLINEATO') {
              statusCell.setFontColor('#D93025').setFontWeight('bold'); // Rosso
            } else if (statusValue === 'OK') {
              statusCell.setFontColor('#1E8E3E'); // Verde
            } else if (statusValue.startsWith('=HYPERLINK')) {
               statusCell.setFontColor('#1A73E8'); // Blu per i link
            }
            statusCell.setHorizontalAlignment('center');

            // Formato Valore/Quantità (colonna 2)
            if (section.isFinancial) {
                const valueCell = sh.getRange(currentRow, valueColIndex);
                const checkName = String(dataToWrite[i][0]);
                 if (financialEuroRows[checkName]) {
                   valueCell.setNumberFormat('€ #,##0.00;[Red]-€ #,##0.00;€ 0.00');
                 } else {
                   valueCell.setNumberFormat('#,##0'); // Conteggi
                 }
            } else if (section.title === 'AUDIT INTEGRITÀ DATI' || section.title.startsWith('CONTEGGIO FILE')) {
                sh.getRange(currentRow, valueColIndex).setNumberFormat('#,##0');
            }
        }
        row += dataRowsCount;
      } else {
        sh.getRange(row, 1).setValue('Nessun dato o controllo applicabile.').setFontStyle('italic');
        row++;
      }
      row += 2; // spazio tra sezioni
    });

    // Ridimensiona colonne
    try {
           const lastColUsed = sh.getLastColumn();
           if (lastColUsed > 0) sh.autoResizeColumns(1, lastColUsed);
    } catch(e) { LOG?.warn('REPORTING_WRITE', 'Errore autoresize colonne.', { error: e.message }); }
  }

  /** Conta righe dati nei fogli principali */
  function _getSheetRowCount(sheetName) {
    try {
      const sh = SHEETS.get(sheetName);
      if (!sh) return 0;
      const headerRow = SHEETS._findHeaderRow(sh, sheetName);
      return Math.max(0, sh.getLastRow() - headerRow);
    } catch (e) {
      LOG?.error('REPORTING_COUNT', `Impossibile contare righe per ${sheetName}`, {error: e.message});
      return 'ERRORE';
    }
  }

  /** Genera riepilogo conteggi fogli */
  function _generateSummary() {
    return {
      totalFatture:   _getSheetRowCount(SHEETS.SHEET_NAMES.Fatture),
      totalRighe:     _getSheetRowCount(SHEETS.SHEET_NAMES.Righe),
      totalFornitori: _getSheetRowCount(SHEETS.SHEET_NAMES.Fornitori),
      totalProdotti:  _getSheetRowCount(SHEETS.SHEET_NAMES.Prodotti),
    };
  }

  /**
   * Riconciliazione finanziaria.
   * CORRETTO: Legge conteggio file totali da STATE.
   */
  function _performFinancialReconciliation() {
    // --- CONTEGGIO FILE DA STATE ---
    let driveFileCount = STATE.get(App.config.keys.auditTotalCount);
    if (driveFileCount === null || driveFileCount === undefined) {
         driveFileCount = 'Non Calcolato';
         LOG.info('REPORTING_FIN', 'Conteggio file totali non trovato in STATE. Eseguire Import Headers per calcolarlo.');
    } else {
         driveFileCount = Number(driveFileCount); // Converte in numero
         if (isNaN(driveFileCount)) {
            LOG.warn('REPORTING_FIN', `Valore non numerico per auditTotalCount in STATE: ${STATE.get(App.config.keys.auditTotalCount)}`);
            driveFileCount = 'Errore Stato';
         }
    }
    // --- FINE CONTEGGIO DA STATE ---

    const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    const sheetInvoiceCount = _getSheetRowCount(SHEETS.SHEET_NAMES.Fatture);

    let totalSheet = 'N/A';
    if (typeof sheetInvoiceCount === 'number' && sheetInvoiceCount > 0 && shF) {
      try {
        const headerRow = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
        const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
        if (idx.TotDocumento === undefined) throw new Error('Colonna TotDocumento mancante.');
        const totalsRange = shF.getRange(headerRow + 1, idx.TotDocumento + 1, sheetInvoiceCount, 1);
        const totals = totalsRange.getValues();
        totalSheet = totals.reduce((sum, [val]) => sum + UTIL.parseNumSmart(val), 0);
      } catch(e) {
        LOG?.error('REPORTING_FIN', 'Errore somma TotDocumento.', {error: e.message});
        totalSheet = 'ERRORE';
      }
    } else if (sheetInvoiceCount === 0) {
      totalSheet = 0;
    }

    // Conteggio duplicati (legge da STATE)
    let duplicates = STATE.get(App.config.keys.duplicateCount);
    if (duplicates === null || duplicates === undefined) {
        duplicates = 'Non Calcolato';
    } else {
        duplicates = Number(duplicates);
        if (isNaN(duplicates)) duplicates = 'Errore Stato';
    }

    // Golden Total (legge da STATE)
    const totalXmlRaw = STATE.get(App.config.keys.goldenTotal);
    let totalXml = 0;
    if (totalXmlRaw !== null && totalXmlRaw !== undefined) {
      totalXml = Number(totalXmlRaw) || 0;
    }

    const countDifference  = (typeof driveFileCount === 'number' && typeof sheetInvoiceCount === 'number') ? (driveFileCount - sheetInvoiceCount) : 'N/A';
    const amountDifference = (typeof totalXml === 'number' && typeof totalSheet === 'number') ? (totalXml - totalSheet) : 'N/A';

    return {
      driveFileCount, sheetInvoiceCount, countDifference,
      totalXml, totalSheet, amountDifference,
      duplicates,
    };
  }

  /** Controllo integrità dati (logica invariata, compattata) */
  function _performDataIntegrityChecks() {
      const res = { unassignedSedi: 0, uncategorizedSuppliers: 0, uncategorizedProducts: 0, orphanRows: 0, duplicateRows: 0 };
      try { /* Sedi */
           const sh = SHEETS.get(SHEETS.SHEET_NAMES.Fatture); if (!sh) return res; const hr = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Fatture); if (sh.getLastRow() <= hr) return res;
           const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture); if (idx.Sede === undefined) return res;
           res.unassignedSedi = sh.getRange(hr + 1, idx.Sede + 1, sh.getLastRow() - hr, 1).getValues()
             .reduce((a, [v]) => a + ((!v || String(v).trim().toLowerCase() === 'non assegnata') ? 1 : 0), 0);
      } catch(e){ LOG?.error('REPORTING_INTEGRITY', 'Err sedi', {e:e.message}); }
       try { /* Fornitori */
           const sh = SHEETS.get(SHEETS.SHEET_NAMES.Fornitori); if (!sh) return res; const hr = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Fornitori); if (sh.getLastRow() <= hr) return res;
           const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fornitori); if (idx.Famiglia === undefined || idx.Categoria === undefined) return res;
           res.uncategorizedSuppliers = sh.getRange(hr + 1, 1, sh.getLastRow() - hr, Math.max(idx.Famiglia, idx.Categoria) + 1).getValues()
               .reduce((a, r) => a + ((!r[idx.Famiglia] || !r[idx.Categoria]) ? 1 : 0), 0);
      } catch(e){ LOG?.error('REPORTING_INTEGRITY', 'Err forn', {e:e.message}); }
       try { /* Prodotti */
           const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti); if (!sh) return res; const hr = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti); if (sh.getLastRow() <= hr) return res;
           const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti); if (idx.CategoriaProdotto === undefined) return res;
           res.uncategorizedProducts = sh.getRange(hr + 1, idx.CategoriaProdotto + 1, sh.getLastRow() - hr, 1).getValues()
               .reduce((a, [v]) => a + (!v ? 1 : 0), 0);
      } catch(e){ LOG?.error('REPORTING_INTEGRITY', 'Err prod', {e:e.message}); }
       try { /* Righe Orfane */
           const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture); const shR = SHEETS.get(SHEETS.SHEET_NAMES.Righe); if (!shF || !shR) return res;
           const hrF = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture); const hrR = SHEETS._findHeaderRow(shR, SHEETS.SHEET_NAMES.Righe); if (shF.getLastRow() <= hrF || shR.getLastRow() <= hrR) return res;
           const idxF = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture); const idxR = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Righe); if (idxF.FileID === undefined || idxR.FileID === undefined) return res;
           const idsF = new Set(shF.getRange(hrF + 1, idxF.FileID + 1, shF.getLastRow() - hrF, 1).getValues().map(([v]) => String(v ?? '').trim()).filter(Boolean));
           res.orphanRows = shR.getRange(hrR + 1, idxR.FileID + 1, shR.getLastRow() - hrR, 1).getValues()
               .reduce((a, [v]) => { const id = String(v ?? '').trim(); return a + (id && !idsF.has(id) ? 1 : 0); }, 0);
      } catch(e){ LOG?.error('REPORTING_INTEGRITY', 'Err orfane', {e:e.message}); }
       try { /* Righe Duplicate */
           const shR = SHEETS.get(SHEETS.SHEET_NAMES.Righe); if (!shR) return res; const hrR = SHEETS._findHeaderRow(shR, SHEETS.SHEET_NAMES.Righe); if (shR.getLastRow() <= hrR) return res;
           const idxR = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Righe); if (idxR.FileID === undefined || idxR.NumeroLinea === undefined) return res;
           const seen = new Map();
           shR.getRange(hrR + 1, 1, shR.getLastRow() - hrR, Math.max(idxR.FileID, idxR.NumeroLinea) + 1).getValues()
               .forEach(r => { const k = `${r[idxR.FileID] || ''}||${r[idxR.NumeroLinea] || ''}`; if (k !== '||') seen.set(k, (seen.get(k) || 0) + 1); });
           res.duplicateRows = Array.from(seen.values()).reduce((a, c) => a + (c > 1 ? c - 1 : 0), 0);
      } catch(e){ LOG?.error('REPORTING_INTEGRITY', 'Err righe dup', {e:e.message}); }
      return res;
  }

  /** Controllo struttura fogli (logica invariata, compattata) */
  function _performSchemaCheck() {
      const results = [];
      try {
        const ss = SpreadsheetApp.getActiveSpreadsheet(); const schemas = SHEETS.SCHEMAS;
        for (const sheetName in schemas) {
          if (!schemas.hasOwnProperty(sheetName)) continue;
          const expectedHeaders = (schemas[sheetName] || []).map(h => String(h).trim()); const sh = ss.getSheetByName(sheetName);
          if (!sh) { results.push({ sheet: sheetName, status: 'MANCANTE', details: 'Foglio non trovato.' }); continue; }
          let actualHeaders = [];
          try {
            const hr = SHEETS._findHeaderRow(sh, sheetName); const lc = Math.max(1, sh.getLastColumn());
            actualHeaders = sh.getRange(hr, 1, 1, lc).getValues()[0].map(h => String(h ?? '').trim()).filter(Boolean);
          } catch (e) { LOG?.warn('REPORTING_SCHEMA', 'Err lettura headers.', { sheetName, e: e.message }); }
          const setExpected = new Set(expectedHeaders); const setActual = new Set(actualHeaders);
          const missing = expectedHeaders.filter(h => !setActual.has(h)); const extra = actualHeaders.filter(h => !setExpected.has(h));
          if (missing.length === 0 && extra.length === 0) { results.push({ sheet: sheetName, status: 'OK', details: 'Schema allineato.' }); }
          else { const d = []; if (missing.length > 0) d.push(`Mancano: ${missing.join(', ')}`); if (extra.length > 0) d.push(`Extra: ${extra.join(', ')}`); results.push({ sheet: sheetName, status: 'DISALLINEATO', details: d.join(' | ') }); }
        }
      } catch (e) { LOG?.error('REPORTING_SCHEMA', 'Errore controllo schema.', { e: e.message }); results.push({ sheet: '—', status: 'ERRORE', details: e.message }); }
      return results;
  }

  // --- NUOVA FUNZIONE ---
  /**
   * Recupera i conteggi audit salvati da IMPORT_HEADERS.
   * @returns {{ month: object, folder: object }}
   */
  function _getAuditCountsFromState() {
      const monthData = STATE.getJSON(App.config.keys.auditCountsMonth, {});
      const folderData = STATE.getJSON(App.config.keys.auditCountsFolder, {});

      // Assicura che siano oggetti validi
      const month = (typeof monthData === 'object' && monthData !== null) ? monthData : {};
      const folder = (typeof folderData === 'object' && folderData !== null) ? folderData : {};

      if (Object.keys(month).length === 0 && Object.keys(folder).length === 0) {
          LOG.info('REPORTING_COUNTS', 'Conteggi file non trovati in STATE. Eseguire Import Headers per generarli.');
      }

      return { month, folder };
  }
  // --- FINE NUOVA FUNZIONE ---

  // Esporta solo la funzione run pubblica
  return { run };
})();

// Registra REPORTING nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('REPORTING', ['SHEETS', 'LOG', 'UTIL', 'SHARED_UTILS', 'STATE', 'CONFIG']);
}

// Registra REPORTING nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('REPORTING', REPORTING);
}