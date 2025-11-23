// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 124_prodotti_cleanup.js
// RUOLO: Pulizia prodotti duplicati nel foglio Prodotti
// =============================================================

/**
 * Identifica e risolve prodotti duplicati nel foglio Prodotti
 * Duplicati = stesso CodiceFornitore, diverso CodiceInterno
 * STRATEGIA: mantiene il più recente (UltimoAgg), marca gli altri come NonInUso=TRUE
 */
function cleanupProdottiDuplicati() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'Prodotti';
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    SpreadsheetApp.getUi().alert(`Foglio "${sheetName}" non trovato!`);
    return;
  }
  
  UTIL.showToast('Analisi prodotti duplicati in corso...', 'Pulizia', 10);
  
  try {
    // Leggi dati foglio Prodotti
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    // Trova indici colonne
    const idxCodiceInterno = headers.indexOf('CodiceInterno');
    const idxCodiceFornitore = headers.indexOf('CodiceFornitore');
    const idxDescrizione = headers.indexOf('Descrizione');
    const idxUltimoAgg = headers.indexOf('UltimoAgg');
    const idxNonInUso = headers.indexOf('NonInUso');
    
    if (idxCodiceFornitore === -1 || idxUltimoAgg === -1 || idxNonInUso === -1) {
      throw new Error('Colonne richieste non trovate: CodiceFornitore, UltimoAgg, NonInUso');
    }
    
    // Mappa: CodiceFornitore → Array di righe
    const mappaFornitori = new Map();
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const codiceFornitore = String(row[idxCodiceFornitore] || '').trim();
      const codiceInterno = String(row[idxCodiceInterno] || '').trim();
      
      // Skip righe vuote
      if (!codiceFornitore || !codiceInterno) continue;
      
      if (!mappaFornitori.has(codiceFornitore)) {
        mappaFornitori.set(codiceFornitore, []);
      }
      
      mappaFornitori.get(codiceFornitore).push({
        rowIndex: i + 1, // +1 perché sheet è 1-indexed
        codiceInterno: codiceInterno,
        descrizione: row[idxDescrizione],
        ultimoAgg: row[idxUltimoAgg],
        nonInUso: row[idxNonInUso]
      });
    }
    
    // Identifica duplicati
    const duplicati = [];
    const daMarcareNonInUso = [];
    
    mappaFornitori.forEach((righe, codiceFornitore) => {
      if (righe.length > 1) {
        // DUPLICATO TROVATO
        
        // Ordina per data (più recente prima)
        righe.sort((a, b) => {
          const dateA = a.ultimoAgg ? new Date(a.ultimoAgg) : new Date(0);
          const dateB = b.ultimoAgg ? new Date(b.ultimoAgg) : new Date(0);
          return dateB - dateA; // Decrescente
        });
        
        const piuRecente = righe[0];
        const vecchi = righe.slice(1);
        
        duplicati.push({
          codiceFornitore: codiceFornitore,
          descrizione: piuRecente.descrizione,
          totaleRighe: righe.length,
          mantieni: piuRecente.codiceInterno,
          elimina: vecchi.map(r => r.codiceInterno)
        });
        
        // Marca i vecchi come NonInUso
        vecchi.forEach(vecchio => {
          if (vecchio.nonInUso !== true && String(vecchio.nonInUso).toUpperCase() !== 'TRUE') {
            daMarcareNonInUso.push({
              rowIndex: vecchio.rowIndex,
              codiceInterno: vecchio.codiceInterno,
              codiceFornitore: codiceFornitore
            });
          }
        });
      }
    });
    
    // Report risultati
    if (duplicati.length === 0) {
      UTIL.showToast('✓ Nessun duplicato trovato!', 'Pulizia Completata', 5);
      LOG.info('PRODOTTI_CLEANUP', 'Nessun duplicato trovato.');
      return;
    }
    
    // Mostra dialog conferma
    const ui = SpreadsheetApp.getUi();
    const msg = `🔍 TROVATI ${duplicati.length} PRODOTTI DUPLICATI\n\n` +
                `Totale righe da marcare NonInUso: ${daMarcareNonInUso.length}\n\n` +
                `Esempi:\n` +
                duplicati.slice(0, 5).map(d => 
                  `• ${d.codiceFornitore} - ${d.descrizione}\n  Mantieni: ${d.mantieni} | Elimina: ${d.elimina.join(', ')}`
                ).join('\n\n') +
                `\n\n${duplicati.length > 5 ? `...e altri ${duplicati.length - 5} duplicati` : ''}` +
                `\n\nVuoi procedere a marcare i duplicati come NonInUso?`;
    
    const response = ui.alert('Conferma Pulizia Duplicati', msg, ui.ButtonSet.YES_NO);
    
    if (response !== ui.Button.YES) {
      UTIL.showToast('Operazione annullata', 'Info', 3);
      return;
    }
    
    // AGGIORNA FOGLIO: marca NonInUso = TRUE
    let contatore = 0;
    daMarcareNonInUso.forEach(item => {
      sheet.getRange(item.rowIndex, idxNonInUso + 1).setValue(true);
      contatore++;
    });
    
    // Crea foglio report
    _createDuplicatiReport(ss, duplicati, daMarcareNonInUso);
    
    const msgFinale = `✓ Pulizia completata!\n\n` +
                      `• ${contatore} prodotti marcati come NonInUso\n` +
                      `• Report dettagliato creato nel foglio "Report Duplicati Prodotti"`;
    
    UTIL.showToast(msgFinale, 'Completato', 10);
    LOG.info('PRODOTTI_CLEANUP', `Pulizia completata: ${contatore} prodotti marcati NonInUso`, { duplicati: duplicati.length });
    
  } catch (e) {
    LOG.error('PRODOTTI_CLEANUP', 'Errore durante pulizia duplicati', { error: e.message, stack: e.stack });
    SpreadsheetApp.getUi().alert('Errore durante la pulizia: ' + e.message);
  }
}

/**
 * Crea foglio report con dettagli duplicati
 * @private
 */
function _createDuplicatiReport(ss, duplicati, daMarcareNonInUso) {
  const reportName = 'Report Duplicati Prodotti';
  let reportSheet = ss.getSheetByName(reportName);
  
  if (reportSheet) {
    reportSheet.clear();
  } else {
    reportSheet = ss.insertSheet(reportName);
  }
  
  // Header
  const headers = [
    'CodiceFornitore',
    'Descrizione',
    'Totale Righe Duplicate',
    'CodiceInterno Mantenuto',
    'CodiciInterni Eliminati (NonInUso)',
    'Data Report'
  ];
  
  reportSheet.getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold')
    .setBackground('#4a86e8')
    .setFontColor('#ffffff');
  
  // Dati
  const rows = duplicati.map(d => [
    d.codiceFornitore,
    d.descrizione,
    d.totaleRighe,
    d.mantieni,
    d.elimina.join(', '),
    new Date()
  ]);
  
  if (rows.length > 0) {
    reportSheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  
  // Formattazione
  reportSheet.autoResizeColumns(1, headers.length);
  reportSheet.setFrozenRows(1);
  
  // Nota esplicativa
  const noteRow = rows.length + 3;
  reportSheet.getRange(noteRow, 1, 1, headers.length).merge()
    .setValue(`📌 Questo report mostra i prodotti duplicati trovati (stesso CodiceFornitore). ` +
              `È stato mantenuto il prodotto più recente (UltimoAgg), gli altri sono stati marcati come NonInUso=TRUE.`)
    .setFontStyle('italic')
    .setBackground('#f3f3f3')
    .setWrap(true);
  
  // Statistiche
  const statsRow = noteRow + 2;
  reportSheet.getRange(statsRow, 1).setValue('STATISTICHE:').setFontWeight('bold');
  reportSheet.getRange(statsRow + 1, 1).setValue(`Prodotti con duplicati: ${duplicati.length}`);
  reportSheet.getRange(statsRow + 2, 1).setValue(`Righe marcate NonInUso: ${daMarcareNonInUso.length}`);
  reportSheet.getRange(statsRow + 3, 1).setValue(`Data pulizia: ${new Date().toLocaleString('it-IT')}`);
  
  ss.setActiveSheet(reportSheet);
}

/**
 * Verifica prodotti duplicati SENZA modificare (solo preview)
 */
function previewProdottiDuplicati() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'Prodotti';
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    SpreadsheetApp.getUi().alert(`Foglio "${sheetName}" non trovato!`);
    return;
  }
  
  try {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    const idxCodiceInterno = headers.indexOf('CodiceInterno');
    const idxCodiceFornitore = headers.indexOf('CodiceFornitore');
    const idxDescrizione = headers.indexOf('Descrizione');
    const idxUltimoAgg = headers.indexOf('UltimoAgg');
    
    if (idxCodiceFornitore === -1) {
      throw new Error('Colonna CodiceFornitore non trovata');
    }
    
    // Mappa: CodiceFornitore → conteggio
    const mappaFornitori = new Map();
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const codiceFornitore = String(row[idxCodiceFornitore] || '').trim();
      const codiceInterno = String(row[idxCodiceInterno] || '').trim();
      
      if (!codiceFornitore || !codiceInterno) continue;
      
      if (!mappaFornitori.has(codiceFornitore)) {
        mappaFornitori.set(codiceFornitore, []);
      }
      
      mappaFornitori.get(codiceFornitore).push({
        codiceInterno: codiceInterno,
        descrizione: row[idxDescrizione],
        ultimoAgg: row[idxUltimoAgg]
      });
    }
    
    // Filtra solo duplicati
    const duplicati = [];
    mappaFornitori.forEach((righe, codiceFornitore) => {
      if (righe.length > 1) {
        duplicati.push({
          codiceFornitore: codiceFornitore,
          descrizione: righe[0].descrizione,
          count: righe.length,
          codici: righe.map(r => r.codiceInterno).join(', ')
        });
      }
    });
    
    if (duplicati.length === 0) {
      SpreadsheetApp.getUi().alert('✓ Nessun duplicato trovato!');
      return;
    }
    
    // Mostra preview
    const msg = `🔍 PREVIEW DUPLICATI (${duplicati.length} prodotti)\n\n` +
                duplicati.slice(0, 10).map(d => 
                  `• ${d.codiceFornitore} - ${d.descrizione}\n  Codici: ${d.codici} (${d.count} righe)`
                ).join('\n\n') +
                `\n\n${duplicati.length > 10 ? `...e altri ${duplicati.length - 10} duplicati` : ''}` +
                `\n\nUSA cleanupProdottiDuplicati() per pulire.`;
    
    SpreadsheetApp.getUi().alert('Preview Duplicati', msg, SpreadsheetApp.getUi().ButtonSet.OK);
    
    LOG.info('PRODOTTI_CLEANUP', `Preview duplicati: ${duplicati.length} prodotti con duplicati`);
    
  } catch (e) {
    LOG.error('PRODOTTI_CLEANUP', 'Errore durante preview duplicati', { error: e.message });
    SpreadsheetApp.getUi().alert('Errore: ' + e.message);
  }
}
