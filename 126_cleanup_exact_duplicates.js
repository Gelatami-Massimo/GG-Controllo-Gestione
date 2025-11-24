// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 126_cleanup_exact_duplicates.js
// RUOLO: Rimuove duplicati ESATTI (stesso CodiceInterno)
// =============================================================

/**
 * Rimuove righe duplicate ESATTE dal foglio Prodotti.
 * Duplicato ESATTO = stesso CodiceInterno (non solo CodiceFornitore).
 * 
 * Strategia:
 * - Identifica righe con CodiceInterno identico
 * - Mantiene la PRIMA occorrenza
 * - CANCELLA le altre (non marca NonInUso, cancella proprio)
 * 
 * ATTENZIONE: Questa è un'operazione DISTRUTTIVA!
 * 
 * @returns {void}
 */
function cleanupExactDuplicates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'Prodotti';
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    SpreadsheetApp.getUi().alert(`Foglio "${sheetName}" non trovato!`);
    return;
  }
  
  try {
    UTIL.showToast('Analisi duplicati esatti in corso...', 'Cleanup', 10);
    
    // Leggi dati foglio Prodotti
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    
    // Trova indice colonna CodiceInterno
    const idxCodiceInterno = headers.indexOf('CodiceInterno');
    const idxCodiceFornitore = headers.indexOf('CodiceFornitore');
    const idxDescrizione = headers.indexOf('Descrizione');
    
    if (idxCodiceInterno === -1) {
      throw new Error('Colonna CodiceInterno non trovata');
    }
    
    // Mappa: CodiceInterno → Array di indici riga
    const mappaCodiciInterni = new Map();
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const codiceInterno = String(row[idxCodiceInterno] || '').trim();
      
      // Skip righe vuote
      if (!codiceInterno) continue;
      
      if (!mappaCodiciInterni.has(codiceInterno)) {
        mappaCodiciInterni.set(codiceInterno, []);
      }
      
      mappaCodiciInterni.get(codiceInterno).push({
        rowIndex: i + 1, // +1 perché sheet è 1-indexed
        codiceFornitore: row[idxCodiceFornitore],
        descrizione: row[idxDescrizione]
      });
    }
    
    // Identifica duplicati ESATTI
    const duplicatiEsatti = [];
    const righeDaCancellare = [];
    
    mappaCodiciInterni.forEach((righe, codiceInterno) => {
      if (righe.length > 1) {
        // DUPLICATO ESATTO TROVATO
        
        duplicatiEsatti.push({
          codiceInterno: codiceInterno,
          codiceFornitore: righe[0].codiceFornitore,
          descrizione: righe[0].descrizione,
          totaleRighe: righe.length
        });
        
        // Mantieni la PRIMA, cancella le altre
        for (let i = 1; i < righe.length; i++) {
          righeDaCancellare.push(righe[i].rowIndex);
        }
      }
    });
    
    // Report risultati
    if (duplicatiEsatti.length === 0) {
      UTIL.showToast('✓ Nessun duplicato esatto trovato!', 'Cleanup Completato', 5);
      LOG.info('EXACT_DUPLICATES_CLEANUP', 'Nessun duplicato esatto trovato.');
      return;
    }
    
    // Mostra dialog conferma
    const ui = SpreadsheetApp.getUi();
    const msg = `🚨 TROVATI ${duplicatiEsatti.length} DUPLICATI ESATTI\n\n` +
                `Totale RIGHE DA CANCELLARE: ${righeDaCancellare.length}\n\n` +
                `⚠️ ATTENZIONE: Questa operazione è IRREVERSIBILE!\n` +
                `Le righe verranno CANCELLATE (non marcate NonInUso).\n\n` +
                `Esempi:\n` +
                duplicatiEsatti.slice(0, 5).map(d => 
                  `• ${d.codiceInterno}\n  ${d.codiceFornitore} - ${d.descrizione}\n  (${d.totaleRighe} copie identiche)`
                ).join('\n\n') +
                `\n\n${duplicatiEsatti.length > 5 ? `...e altri ${duplicatiEsatti.length - 5} duplicati` : ''}` +
                `\n\nVuoi procedere a CANCELLARE le righe duplicate?`;
    
    const response = ui.alert('⚠️ Conferma Cancellazione Duplicati Esatti', msg, ui.ButtonSet.YES_NO);
    
    if (response !== ui.Button.YES) {
      UTIL.showToast('Operazione annullata', 'Info', 3);
      return;
    }
    
    // CANCELLA RIGHE (dal basso verso l'alto per non sballare gli indici)
    righeDaCancellare.sort((a, b) => b - a); // Ordine decrescente
    
    let contatore = 0;
    righeDaCancellare.forEach(rowIndex => {
      sheet.deleteRow(rowIndex);
      contatore++;
    });
    
    const msgFinale = `✓ Cleanup completato!\n\n` +
                      `• ${contatore} righe duplicate CANCELLATE\n` +
                      `• ${duplicatiEsatti.length} prodotti sistemati\n\n` +
                      `Verifica il foglio Prodotti.`;
    
    UTIL.showToast(msgFinale, 'Completato', 10);
    LOG.info('EXACT_DUPLICATES_CLEANUP', `Cleanup completato: ${contatore} righe cancellate`, { 
      duplicati: duplicatiEsatti.length 
    });
    
  } catch (e) {
    LOG.error('EXACT_DUPLICATES_CLEANUP', 'Errore durante cleanup duplicati esatti', { 
      error: e.message, 
      stack: e.stack 
    });
    SpreadsheetApp.getUi().alert('Errore durante la pulizia: ' + e.message);
  }
}

/**
 * Preview duplicati esatti senza cancellare nulla.
 * Mostra solo quanti e quali sono.
 * 
 * @returns {void}
 */
function previewExactDuplicates() {
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
    
    if (idxCodiceInterno === -1) {
      throw new Error('Colonna CodiceInterno non trovata');
    }
    
    // Mappa: CodiceInterno → conteggio
    const mappaCodiciInterni = new Map();
    
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const codiceInterno = String(row[idxCodiceInterno] || '').trim();
      
      if (!codiceInterno) continue;
      
      if (!mappaCodiciInterni.has(codiceInterno)) {
        mappaCodiciInterni.set(codiceInterno, {
          count: 0,
          codiceFornitore: row[idxCodiceFornitore],
          descrizione: row[idxDescrizione]
        });
      }
      
      mappaCodiciInterni.get(codiceInterno).count++;
    }
    
    // Filtra solo duplicati
    const duplicati = [];
    let totaleRigheDaCancellare = 0;
    
    mappaCodiciInterni.forEach((info, codiceInterno) => {
      if (info.count > 1) {
        duplicati.push({
          codiceInterno: codiceInterno,
          codiceFornitore: info.codiceFornitore,
          descrizione: info.descrizione,
          count: info.count
        });
        totaleRigheDaCancellare += (info.count - 1); // Mantieni 1, cancella gli altri
      }
    });
    
    if (duplicati.length === 0) {
      SpreadsheetApp.getUi().alert('✓ Nessun duplicato esatto trovato!');
      return;
    }
    
    // Mostra preview
    const msg = `🔍 PREVIEW DUPLICATI ESATTI\n\n` +
                `Prodotti con duplicati: ${duplicati.length}\n` +
                `Righe da cancellare: ${totaleRigheDaCancellare}\n\n` +
                `Esempi:\n` +
                duplicati.slice(0, 10).map(d => 
                  `• ${d.codiceInterno}\n  ${d.codiceFornitore} - ${d.descrizione}\n  (${d.count} copie identiche)`
                ).join('\n\n') +
                `\n\n${duplicati.length > 10 ? `...e altri ${duplicati.length - 10} duplicati` : ''}` +
                `\n\nUSA cleanupExactDuplicates() per cancellare.`;
    
    SpreadsheetApp.getUi().alert('Preview Duplicati Esatti', msg, SpreadsheetApp.getUi().ButtonSet.OK);
    
    LOG.info('EXACT_DUPLICATES_CLEANUP', `Preview duplicati esatti: ${duplicati.length} prodotti, ${totaleRigheDaCancellare} righe da cancellare`);
    
  } catch (e) {
    LOG.error('EXACT_DUPLICATES_CLEANUP', 'Errore durante preview duplicati esatti', { error: e.message });
    SpreadsheetApp.getUi().alert('Errore: ' + e.message);
  }
}
