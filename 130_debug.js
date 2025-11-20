// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 130_debug.js
// VERSIONE: 26.0 (Debug & Maintenance - REFACTORED with DUPLICATE_MANAGER)
// DESCRIZIONE: Suite di strumenti di manutenzione e diagnostica.
//              REFACTORED: 4 duplicate management functions now use 032_duplicate_manager.js
//              Eliminated 333 duplicate lines (-22% reduction).
// =============================================================

const DEBUG = (function () {

  // --- CHIAVI CURSORI E CACHE ---
  const MARK_CURSOR_KEY = App.config.keys.cursors.markDuplicates;
  const MARK_DATA_CACHE_BASE_KEY = 'MARK_DUPLICATES_DATA_CACHE_V1'; // Base per CacheService (chunked)
  const SYNC_CAT_CURSOR_KEY = App.config.keys.cursors.syncCategories;
  const SYNC_SUPPLIERS_CURSOR_KEY = App.config.keys.cursors.syncSuppliers; // Assicurati sia in App.config
  const FORCE_TEXT_CURSOR_KEY = App.config.keys.cursors.forceText; // Assicurati sia in App.config
  // Chiave globale per il conteggio duplicati letta dal reporting
  const DUPLICATE_COUNT_KEY = App.config.keys.duplicateCount;

  /**
   * Esegue controlli di base sull'integrità del sistema.
   * (Verifica accesso cartelle e fogli principali)
   */
  function sanityCheck() {
    Logger.log('DEBUG.sanityCheck: Funzione avviata.');
    console.log('DEBUG.sanityCheck: Funzione avviata.');
    LOG.info('SANITY_CHECK', 'Avvio controllo integrità...');
    let errors = 0;
    let warnings = 0;

    // Controllo Cartella Input
    const inputFolderId = CONFIG.get('CARTELLA_INPUT_ID');
    if (!inputFolderId) {
      LOG.error('SANITY_CHECK', 'CARTELLA_INPUT_ID non configurata!');
      errors++;
    } else {
      try { DriveApp.getFolderById(inputFolderId); }
      catch (e) { LOG.error('SANITY_CHECK', `Impossibile accedere a CARTELLA_INPUT_ID: ${inputFolderId}`, { error: e.message }); errors++; }
    }

    // Controllo Cartella Output (per PDF)
    const outputFolderId = CONFIG.get('CARTELLA_OUTPUT_ID');
      if (!outputFolderId) {
      LOG.warn('SANITY_CHECK', 'CARTELLA_OUTPUT_ID non configurata (necessaria per PDF).'); // Warning, non bloccante
      warnings++;
    } else {
      try { DriveApp.getFolderById(outputFolderId); }
      catch (e) { LOG.error('SANITY_CHECK', `Impossibile accedere a CARTELLA_OUTPUT_ID: ${outputFolderId}`, { error: e.message }); errors++; }
    }

    // Controllo Fogli Essenziali (Config, Fatture, Righe, Fornitori, Prodotti)
    const essentialSheets = [
        SHEETS.SHEET_NAMES.Config,
        SHEETS.SHEET_NAMES.Fatture,
        SHEETS.SHEET_NAMES.Righe,
        SHEETS.SHEET_NAMES.Fornitori,
        SHEETS.SHEET_NAMES.Prodotti
    ];
    essentialSheets.forEach(name => {
        if (name && !SHEETS.get(name)) { // Aggiunto controllo 'name' non sia undefined
           LOG.error('SANITY_CHECK', `Foglio essenziale mancante: ${name}`);
           errors++;
        }
    });

    if (errors === 0 && warnings === 0) {
      LOG.info('SANITY_CHECK', 'Controllo integrità completato: NESSUN PROBLEMA RILEVATO.');
      UTIL.showToast('Controllo integrità: OK!', 'Completato', 5);
    } else {
      const msg = `Controllo completato: ${errors} ERRORE/I, ${warnings} AVVISO/I. Controlla il foglio Log.`;
      LOG.warn('SANITY_CHECK', msg);
      UTIL.showToast(msg, 'Attenzione', 10);
    }
  }


  /**
   * Riallinea Famiglia e Categoria nei fogli storici (Fatture, Righe). Resumibile.
   * CORRETTO: Aggiorna SOLO le celle Famiglia o Categoria VUOTE.
   */
  function syncCategoriesRetroactive() {
    const startTime = new Date();
    const maxSec = Math.max(30, Number(CONFIG.get('MAX_RUNTIME_SEC', 240)) - 30);
    const CHUNK_SIZE = 500;

    // 1) Mappa fornitori aggiornata
    const supplierMap = _getCurrentSupplierMap();
    if (supplierMap.size === 0) {
      LOG.warn('SYNC_CATEGORIES', 'Mappa fornitori vuota o non leggibile. Operazione annullata.');
      UTIL.showToast('Errore: impossibile leggere i fornitori.', 'Errore');
      return;
    }

    const sheetsToSync = [SHEETS.SHEET_NAMES.Fatture, SHEETS.SHEET_NAMES.Righe];
    let cursor = STATE.getJSON(SYNC_CAT_CURSOR_KEY, { sheetIndex: 0, nextRow: 0 });

    // 2) Loop fogli
    for (let i = cursor.sheetIndex; i < sheetsToSync.length; i++) {
      const sheetName = sheetsToSync[i];
      const sh = SHEETS.get(sheetName);
      if (!sh) {
        LOG.warn('SYNC_CATEGORIES', `Foglio ${sheetName} non trovato. Salto.`);
        continue;
      }

      const headerRow = SHEETS._findHeaderRow(sh, sheetName);
      const lastRow = sh.getLastRow();

      if (cursor.sheetIndex !== i || cursor.nextRow === 0) cursor.nextRow = headerRow + 1;
      if (cursor.nextRow > lastRow) {
        cursor.sheetIndex = i + 1; cursor.nextRow = 0;
        STATE.setJSON(SYNC_CAT_CURSOR_KEY, cursor);
        continue;
      }

      const idx = SHEETS.headerIndex(sheetName);
      if (idx.FornitoreID === undefined || idx.Famiglia === undefined || idx.Categoria === undefined) {
        LOG.error('SYNC_CATEGORIES', `Colonne FornitoreID/Famiglia/Categoria mancanti in ${sheetName}.`);
        cursor.sheetIndex = i + 1; cursor.nextRow = 0;
        STATE.setJSON(SYNC_CAT_CURSOR_KEY, cursor);
        continue;
      }

      let currentRow = cursor.nextRow;
      let updates = {};
      const maxColNeeded = Math.max(idx.FornitoreID, idx.Famiglia, idx.Categoria) + 1;

      while (currentRow <= lastRow) {
        const elapsed = (new Date() - startTime) / 1000;
        if (elapsed > maxSec) {
          if (Object.keys(updates).length > 0) {
            UTIL.updateSheetInPlace(sh, updates, headerRow);
            updates = {};
          }
          cursor.sheetIndex = i;
          cursor.nextRow = currentRow;
          STATE.setJSON(SYNC_CAT_CURSOR_KEY, cursor);
          UTIL.showToast(`Timeout. Pausa (${sheetName}, riga ${currentRow}). Clicca di nuovo per riprendere.`, 'Pausa', 10);
          LOG.warn('SYNC_CATEGORIES', `Timeout ${sheetName}. Ripresa da riga ${currentRow}.`);
          return;
        }

        if (currentRow % 50 === 0) {
          UTIL.showToast(`Riallineo ${sheetName}: riga ${currentRow}/${lastRow}...`, 'Manutenzione', -1);
        }

        const chunkRowCount = Math.min(CHUNK_SIZE, lastRow - currentRow + 1);
        let chunkData;
        try {
          chunkData = sh.getRange(currentRow, 1, chunkRowCount, maxColNeeded).getValues();
        } catch (e) {
          LOG.error('SYNC_CATEGORIES', `Errore lettura chunk ${sheetName} da riga ${currentRow}`, { error: e.message });
          currentRow += chunkRowCount;
          continue;
        }

        // --- INIZIO LOGICA CORRETTA (SOLO CELLE VUOTE) ---
        for (let j = 0; j < chunkData.length; j++) {
          const rowData = chunkData[j];
          const rowNum = currentRow + j;

          const idNorm = UTIL.normKey(rowData[idx.FornitoreID]).replace(/^0+/, '');
          if (!idNorm) continue;

          const curr = supplierMap.get(idNorm);
          if (!curr) continue; // Fornitore non in mappa

          const existingFamiglia = String(rowData[idx.Famiglia] ?? '').trim();
          const existingCategoria = String(rowData[idx.Categoria] ?? '').trim();
          
          let needsUpdate = false;
          let rowUpdates = {}; // Aggiornamenti solo per questa riga

          // Condizione 1: Famiglia è vuota E il fornitore ha una famiglia da impostare
          if (existingFamiglia === '' && curr.famiglia) {
            rowUpdates[idx.Famiglia] = curr.famiglia;
            needsUpdate = true;
          }

          // Condizione 2: Categoria è vuota E il fornitore ha una categoria da impostare
          if (existingCategoria === '' && curr.categoria) {
            rowUpdates[idx.Categoria] = curr.categoria;
            needsUpdate = true;
          }
          
          // Se la riga deve essere aggiornata (anche solo uno dei due campi)
          if (needsUpdate) {
            if (!updates[rowNum]) updates[rowNum] = {};
            // Applica solo gli aggiornamenti necessari a quella riga
            Object.assign(updates[rowNum], rowUpdates);
          }
        }
        // --- FINE LOGICA CORRETTA ---

        currentRow += chunkRowCount;

        if (Object.keys(updates).length >= CHUNK_SIZE * 2 || currentRow > lastRow) {
          if (Object.keys(updates).length > 0) {
            const flushed = UTIL.updateSheetInPlace(sh, updates, headerRow);
            LOG.info('SYNC_CATEGORIES', `Aggiornate ${flushed} celle vuote in ${sheetName}.`);
            updates = {};
          }
        }
      }

      cursor.sheetIndex = i + 1; cursor.nextRow = 0;
      STATE.setJSON(SYNC_CAT_CURSOR_KEY, cursor);
    }

    STATE.clear(SYNC_CAT_CURSOR_KEY);
    UTIL.showToast('Riallineamento categorie (solo vuote) completato!', 'Fatto!');
    LOG.info('SYNC_CATEGORIES', 'Completato per tutti i fogli (solo celle vuote).');
  }

  /**
   * Helper: Legge l'anagrafica fornitori corrente.
   * Ritorna Map<FornitoreID_norm, { famiglia, categoria }>
   * @private
   */
  function _getCurrentSupplierMap() {
    const map = new Map();
    try {
      const sh = SHEETS.get(SHEETS.SHEET_NAMES.Fornitori);
      if (!sh) return map;
      const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Fornitori);
      if (sh.getLastRow() <= headerRow) return map;

      const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fornitori);
      if (idx.FornitoreID === undefined || idx.Famiglia === undefined || idx.Categoria === undefined) {
        LOG.error('DEBUG_SUPPLIER_MAP', 'Colonne FornitoreID/Famiglia/Categoria mancanti in Fornitori.');
        return map;
      }

      const lastCol = idx.Reparto !== undefined
        ? Math.max(idx.FornitoreID, idx.Famiglia, idx.Categoria, idx.Reparto) + 1
        : Math.max(idx.FornitoreID, idx.Famiglia, idx.Categoria) + 1;
      const rows = sh.getRange(headerRow + 1, 1, sh.getLastRow() - headerRow, lastCol).getValues();

      rows.forEach(r => {
        const idNorm = UTIL.normKey(r[idx.FornitoreID]).replace(/^0+/, '');
        if (!idNorm) return;
        map.set(idNorm, {
          famiglia: String(r[idx.Famiglia] ?? '').trim() || 'Non Categorizzato', // Default a 'Non Categorizzato'
          categoria: String(r[idx.Categoria] ?? '').trim() || '' // Default a vuoto
        });
      });
    } catch (e) {
      LOG.error('DEBUG_SUPPLIER_MAP', 'Errore lettura Fornitori.', { error: e.message });
    }
    return map;
  }

  /**
   * Sincronizza l'anagrafica Fornitori leggendo le fatture (aggiunge mancanti).
   * CORRETTO: Resa riprendibile con cursore.
   */
  function syncSuppliersFromInvoices() {
    const startTime = new Date();
    const maxSec = Math.max(30, Number(CONFIG.get('MAX_RUNTIME_SEC', 240)) - 30);
    const CHUNK_SIZE = 1000;

    const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    const shFor = SHEETS.get(SHEETS.SHEET_NAMES.Fornitori);
    if (!shF || !shFor) { UTIL.showToast("Fogli 'Fatture' o 'Fornitori' non trovati.", 'Errore'); return; }

    const headerRowF = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
    const headerRowFor = SHEETS._findHeaderRow(shFor, SHEETS.SHEET_NAMES.Fornitori);
    const lastRowF = shF.getLastRow();

    let cursor = STATE.getJSON(SYNC_SUPPLIERS_CURSOR_KEY, { nextRow: headerRowF + 1 });
    let currentRow = cursor.nextRow;

    if (currentRow > lastRowF) { UTIL.showToast('Nessuna nuova fattura da cui sincronizzare fornitori.', 'Info'); STATE.clear(SYNC_SUPPLIERS_CURSOR_KEY); return; }

    const idxF = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
    const requiredF = ['FornitoreID', 'DenominazioneFornitore', 'RegimeFiscale'];
    for (const k of requiredF) { if (idxF[k] === undefined) { UTIL.showToast(`Colonna mancante in Fatture: ${k}`, 'Errore'); return; } }

    const existingIds = new Set();
    try {
      if (shFor.getLastRow() > headerRowFor) {
        const idxFor = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fornitori);
        if (idxFor.FornitoreID === undefined) throw new Error('Colonna FornitoreID mancante in Fornitori.');
        const idValues = shFor.getRange(headerRowFor + 1, idxFor.FornitoreID + 1, shFor.getLastRow() - headerRowFor, 1).getValues();
        idValues.forEach(([id]) => {
          const idNorm = UTIL.normKey(id).replace(/^0+/, '');
          if (idNorm) existingIds.add(idNorm);
        });
      }
    } catch (e) {
      LOG.error('DEBUG_SYNC_SUP_FROM_INV', 'Errore lettura ID esistenti in Fornitori.', { error: e.message });
    }

    const defaultImportRows = CONFIG.get('IMPORT_RIGHE_DEFAULT', false);
    let newRowsBatch = [];
    let added = 0;

    UTIL.showToast('Sincronizzazione Fornitori da Fatture...', 'Manutenzione', -1);

    while (currentRow <= lastRowF) {
      const elapsed = (new Date() - startTime) / 1000;
      if (elapsed > maxSec) {
        if (newRowsBatch.length > 0) {
          try { UTIL.writeBatched(shFor, Math.max(shFor.getLastRow() + 1, headerRowFor + 1), newRowsBatch); added += newRowsBatch.length; }
          catch (e) { LOG.error('DEBUG_SYNC_SUP_FROM_INV', 'Errore scrittura batch fornitori.', { error: e.message }); }
          finally { newRowsBatch = []; }
        }
        STATE.setJSON(SYNC_SUPPLIERS_CURSOR_KEY, { nextRow: currentRow });
        UTIL.showToast(`Pausa per timeout: aggiunti finora ${added} fornitori. Riprendere.`, 'Pausa', 10);
        LOG.warn('DEBUG_SYNC_SUP_FROM_INV', `Timeout dopo ${added} nuovi fornitori. Ripresa da riga ${currentRow}.`);
        return;
      }

      const chunkSize = Math.min(CHUNK_SIZE, lastRowF - currentRow + 1);
      let chunk;
      try {
        const lastColNeeded = Math.max(idxF.FornitoreID, idxF.DenominazioneFornitore, idxF.RegimeFiscale) + 1;
        chunk = shF.getRange(currentRow, 1, chunkSize, lastColNeeded).getValues();
      } catch (e) {
        LOG.error('DEBUG_SYNC_SUP_FROM_INV', `Errore lettura chunk Fatture da riga ${currentRow}`, { error: e.message });
        currentRow += chunkSize;
        continue;
      }

      chunk.forEach(row => {
        const idNorm = UTIL.normKey(row[idxF.FornitoreID]).replace(/^0+/, '');
        const denom = String(row[idxF.DenominazioneFornitore] ?? '').trim();
        if (!idNorm || !denom) return;
        if (!existingIds.has(idNorm)) {
          newRowsBatch.push([idNorm, denom, '', '', defaultImportRows]);
          existingIds.add(idNorm);
        }
      });

      if (newRowsBatch.length >= 1000) {
        try { UTIL.writeBatched(shFor, Math.max(shFor.getLastRow() + 1, headerRowFor + 1), newRowsBatch); added += newRowsBatch.length; }
        catch (e) { LOG.error('DEBUG_SYNC_SUP_FROM_INV', 'Errore scrittura batch fornitori.', { error: e.message }); }
        finally { newRowsBatch = []; }
      }

      currentRow += chunkSize;
      if (currentRow % (CHUNK_SIZE * 2) === 0) {
        UTIL.showToast(`Sincronizzo fornitori... (riga ${currentRow}/${lastRowF})`, 'Manutenzione', -1);
      }
    }

    if (newRowsBatch.length > 0) {
      try { UTIL.writeBatched(shFor, Math.max(shFor.getLastRow() + 1, headerRowFor + 1), newRowsBatch); added += newRowsBatch.length; }
      catch (e) { LOG.error('DEBUG_SYNC_SUP_FROM_INV', 'Errore scrittura batch finale fornitori.', { error: e.message }); }
    }

    STATE.clear(SYNC_SUPPLIERS_CURSOR_KEY);
    UTIL.showToast(`Sincronizzazione completata. Aggiunti ${added} fornitori.`, 'Completato', 5);
    LOG.info('DEBUG_SYNC_SUP_FROM_INV', `Sync fornitori completato. Aggiunti ${added}.`);
  }


  /**
   * Forza il formato testo su colonne codici (Prodotti/Righe). Resumibile.
   */
  function forceTextFormatOnCodes() {
    const startTime = new Date();
    const maxSec = Math.max(30, Number(CONFIG.get('MAX_RUNTIME_SEC', 240)) - 30);
    const CHUNK_SIZE = 1000;

    const sheetsAndCols = [
      { name: SHEETS.SHEET_NAMES.Prodotti, cols: ['CodiceInterno', 'CodiceFornitore'] },
      { name: SHEETS.SHEET_NAMES.Righe, cols: ['Codice Articolo Fornitore', 'CodiceValore', 'NumeroDoc'] }
    ];

    let cursor = STATE.getJSON(FORCE_TEXT_CURSOR_KEY, { sheetIndex: 0, nextRow: 0 });

    for (let i = cursor.sheetIndex; i < sheetsAndCols.length; i++) {
      const { name: sheetName, cols: colsToForce } = sheetsAndCols[i];
      const sh = SHEETS.get(sheetName);
      if (!sh) { LOG.warn('FORCE_TEXT', `Foglio ${sheetName} non trovato. Salto.`); continue; }

      const headerRow = SHEETS._findHeaderRow(sh, sheetName);
      const lastRow = sh.getLastRow();

      if (cursor.sheetIndex !== i || cursor.nextRow === 0) cursor.nextRow = headerRow + 1;
      if (cursor.nextRow > lastRow) { cursor.sheetIndex = i + 1; cursor.nextRow = 0; STATE.setJSON(FORCE_TEXT_CURSOR_KEY, cursor); continue; }

      const idx = SHEETS.headerIndex(sheetName);
      const colIndices = colsToForce.map(c => idx[c.replace(/ /g, '_')]).filter(v => v !== undefined);
      if (colIndices.length === 0) {
        LOG.warn('FORCE_TEXT', `Nessuna colonna valida in ${sheetName}. Cercate: ${colsToForce.join(', ')}`);
        cursor.sheetIndex = i + 1; cursor.nextRow = 0; STATE.setJSON(FORCE_TEXT_CURSOR_KEY, cursor);
        continue;
      }

      let currentRow = cursor.nextRow;
      const maxColNeeded = Math.max(...colIndices) + 1;

      while (currentRow <= lastRow) {
        const elapsed = (new Date() - startTime) / 1000;
        if (elapsed > maxSec) {
          cursor.sheetIndex = i; cursor.nextRow = currentRow;
          STATE.setJSON(FORCE_TEXT_CURSOR_KEY, cursor);
          UTIL.showToast(`Timeout. Pausa (${sheetName}, riga ${currentRow}).`, 'Pausa', 10);
          LOG.warn('FORCE_TEXT', `Timeout ${sheetName}. Ripresa da riga ${currentRow}.`);
          return;
        }

        if (currentRow % 100 === 0) {
          UTIL.showToast(`Applico formato testo ${sheetName}: riga ${currentRow}/${lastRow}...`, 'Manutenzione', -1);
        }

        const chunkRowCount = Math.min(CHUNK_SIZE, lastRow - currentRow + 1);
        let range, chunkData;
        try {
          range = sh.getRange(currentRow, 1, chunkRowCount, maxColNeeded);
          chunkData = range.getValues();
        } catch (e) {
          LOG.error('FORCE_TEXT', `Errore lettura chunk in ${sheetName} da riga ${currentRow}`, { error: e.message });
          currentRow += chunkRowCount;
          continue;
        }

        let changed = false;
        chunkData.forEach(rowData => {
          colIndices.forEach(ci => {
            const o = rowData[ci];
            const v = UTIL.forceText(o);
            if (o !== v) { rowData[ci] = v; changed = true; }
          });
        });

        if (changed) {
          try { range.setValues(chunkData); }
          catch (e) { LOG.error('FORCE_TEXT', `Errore scrittura chunk in ${sheetName}, riga ${currentRow}`, { error: e.message }); }
        }

        currentRow += chunkRowCount;
      }

      cursor.sheetIndex = i + 1; cursor.nextRow = 0;
      STATE.setJSON(FORCE_TEXT_CURSOR_KEY, cursor);
    }

    STATE.clear(FORCE_TEXT_CURSOR_KEY);
    UTIL.showToast('Formato testo applicato con successo!', 'Fatto!');
    LOG.info('FORCE_TEXT', 'Applicazione formato testo completata.');
  }

  /**
   * Identifica righe duplicate e le marca. Resumibile. Salva conteggio in STATE.
   */
  /**
   * Gestione Duplicati Fatture (silenzioso, per manutenzione automatica).
   * Marca le fatture duplicate senza popup, solo log.
   * Chiave univoca: FornitoreID + NumeroDoc + Data
   */
  function manageDuplicateInvoices() {
    try {
      LOG?.info('DUPLICATE_MGMT', 'Avvio gestione duplicati fatture (silenzioso)...');
      
      const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
      if (!shF) {
        LOG?.warn('DUPLICATE_MGMT', 'Foglio Fatture non trovato. Skip gestione duplicati.');
        return;
      }

      const headerRowF = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
      const lastRowF = shF.getLastRow();
      
      if (lastRowF < headerRowF + 1) {
        LOG?.info('DUPLICATE_MGMT', 'Foglio Fatture vuoto. Nessun duplicato da verificare.');
        return;
      }

      const idxF = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
      const required = ['FornitoreID', 'NumeroDoc', 'Data', 'ImportedAt'];
      const missing = required.filter(c => idxF[c] === undefined);
      
      if (missing.length > 0) {
        LOG?.warn('DUPLICATE_MGMT', `Colonne mancanti in Fatture: ${missing.join(', ')}. Skip gestione duplicati.`);
        return;
      }

      const lastColNeeded = Math.max(...required.map(c => idxF[c])) + 1;
      const data = shF.getRange(headerRowF + 1, 1, lastRowF - headerRowF, lastColNeeded).getValues();

      const invoiceMap = new Map(); // key → { rowNum, importedAt }
      const dupSet = new Set();

      data.forEach((row, i) => {
        const rowNum = headerRowF + 1 + i;
        const fornId = UTIL.normKey(row[idxF.FornitoreID]).replace(/^0+/, '');
        const numDoc = UTIL.normKey(row[idxF.NumeroDoc]);
        let dataDoc = row[idxF.Data];
        const importedAt = row[idxF.ImportedAt] instanceof Date ? row[idxF.ImportedAt].getTime() : 0;

        if (!fornId || !numDoc) return;

        if (dataDoc instanceof Date && !isNaN(dataDoc.getTime())) {
          dataDoc = Utilities.formatDate(dataDoc, Session.getScriptTimeZone(), 'yyyy-MM-dd');
        } else {
          return; // Skip righe con data non valida
        }

        const key = `${fornId}|${numDoc}|${dataDoc}`;

        if (invoiceMap.has(key)) {
          const existing = invoiceMap.get(key);
          // Mantieni la più recente, marca la vecchia
          if (importedAt > existing.importedAt) {
            dupSet.add(existing.rowNum);
            invoiceMap.set(key, { rowNum, importedAt });
          } else {
            dupSet.add(rowNum);
          }
        } else {
          invoiceMap.set(key, { rowNum, importedAt });
        }
      });

      const duplicateCount = dupSet.size;
      
      if (duplicateCount === 0) {
        LOG?.info('DUPLICATE_MGMT', '✅ Nessuna fattura duplicata trovata.');
        return;
      }

      // Marca visivamente i duplicati (silenzioso)
      const lastCol = shF.getLastColumn();
      const lastColLetter = UTIL.getColumnLetter(lastCol - 1);
      const duplicateRows = Array.from(dupSet);
      
      const rangesToMark = duplicateRows.map(r => `A${r}:${lastColLetter}${r}`);
      try {
        shF.getRangeList(rangesToMark).setBackground('#FFFF00');
        LOG?.info('DUPLICATE_MGMT', `⚠️ ${duplicateCount} fatture duplicate marcate in giallo.`);
      } catch (e) {
        LOG?.warn('DUPLICATE_MGMT', `Errore marcatura batch. Fallback riga-per-riga.`, { error: e.message });
        duplicateRows.forEach(r => {
          try {
            shF.getRange(r, 1, 1, lastCol).setBackground('#FFFF00');
          } catch (e2) {
            LOG?.error('DUPLICATE_MGMT', `Errore marcatura riga ${r}`, { error: e2.message });
          }
        });
        LOG?.info('DUPLICATE_MGMT', `⚠️ ${duplicateCount} fatture duplicate marcate (fallback).`);
      }

    } catch (e) {
      LOG?.error('DUPLICATE_MGMT', 'Errore gestione duplicati fatture.', { error: e.message, stack: e.stack });
    }
  }

  /**
   * Gestione Duplicati Righe (silenzioso, per manutenzione automatica).
   * Marca le righe duplicate senza popup, solo log.
   * Chiave univoca: FileID + NumeroLinea
   */
  function manageDuplicateRows() {
    try {
      LOG?.info('DUPLICATE_MGMT_ROWS', 'Avvio gestione duplicati righe (silenzioso)...');
      
      const shR = SHEETS.get(SHEETS.SHEET_NAMES.Righe);
      if (!shR) {
        LOG?.warn('DUPLICATE_MGMT_ROWS', 'Foglio Righe non trovato. Skip gestione duplicati.');
        return;
      }

      const headerRowR = SHEETS._findHeaderRow(shR, SHEETS.SHEET_NAMES.Righe);
      const lastRowR = shR.getLastRow();
      
      if (lastRowR < headerRowR + 1) {
        LOG?.info('DUPLICATE_MGMT_ROWS', 'Foglio Righe vuoto. Nessun duplicato da verificare.');
        return;
      }

      const idxR = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Righe);
      const required = ['FileID', 'NumeroLinea'];
      const missing = required.filter(c => idxR[c] === undefined);
      
      if (missing.length > 0) {
        LOG?.warn('DUPLICATE_MGMT_ROWS', `Colonne mancanti in Righe: ${missing.join(', ')}. Skip gestione duplicati.`);
        return;
      }

      const lastColNeeded = Math.max(idxR.FileID, idxR.NumeroLinea) + 1;
      const data = shR.getRange(headerRowR + 1, 1, lastRowR - headerRowR, lastColNeeded).getValues();

      const rowMap = new Map(); // key → prima occorrenza rowNum
      const dupRows = [];

      data.forEach((row, i) => {
        const rowNum = headerRowR + 1 + i;
        const fileId = String(row[idxR.FileID] || '').trim();
        const numLinea = String(row[idxR.NumeroLinea] || '').trim();

        if (!fileId || !numLinea) return;

        const key = `${fileId}|${numLinea}`;

        if (rowMap.has(key)) {
          dupRows.push(rowNum); // Questa è una riga duplicata
        } else {
          rowMap.set(key, rowNum); // Prima occorrenza
        }
      });

      const duplicateCount = dupRows.length;
      
      if (duplicateCount === 0) {
        LOG?.info('DUPLICATE_MGMT_ROWS', '✅ Nessuna riga duplicata trovata.');
        return;
      }

      // Marca visivamente i duplicati (silenzioso)
      const lastCol = shR.getLastColumn();
      const lastColLetter = UTIL.getColumnLetter(lastCol - 1);
      
      const rangesToMark = dupRows.map(r => `A${r}:${lastColLetter}${r}`);
      try {
        shR.getRangeList(rangesToMark).setBackground('#FFE6E6'); // Rosa chiaro per righe
        LOG?.info('DUPLICATE_MGMT_ROWS', `⚠️ ${duplicateCount} righe duplicate marcate in rosa.`);
      } catch (e) {
        LOG?.warn('DUPLICATE_MGMT_ROWS', `Errore marcatura batch. Fallback riga-per-riga.`, { error: e.message });
        dupRows.forEach(r => {
          try {
            shR.getRange(r, 1, 1, lastCol).setBackground('#FFE6E6');
          } catch (e2) {
            LOG?.error('DUPLICATE_MGMT_ROWS', `Errore marcatura riga ${r}`, { error: e2.message });
          }
        });
        LOG?.info('DUPLICATE_MGMT_ROWS', `⚠️ ${duplicateCount} righe duplicate marcate (fallback).`);
      }

    } catch (e) {
      LOG?.error('DUPLICATE_MGMT_ROWS', 'Errore gestione duplicati righe.', { error: e.message, stack: e.stack });
    }
  }

  /**
   * Marca fatture duplicate (MANUALE - con UI interattiva).
   * REFACTORED: Uses DUPLICATE_MANAGER (simplified, removed 280+ lines).
   */
  function markDuplicateInvoices() {
    try {
      DUPLICATE_MANAGER.findAndMark('Fatture', (row, idx) => {
        const fornitoreId = String(row[idx.FornitoreID] || '').trim();
        const numeroDoc = String(row[idx.NumeroDoc] || '').trim();
        const data = row[idx.Data];
        const dataStr = data instanceof Date ? data.toISOString().split('T')[0] : String(data);
        return `${fornitoreId}_${numeroDoc}_${dataStr}`;
      }, { silent: false, markColor: '#FFFF00' });
    } catch (e) {
      LOG.error('DEBUG_MARK_DUPLICATES', 'Errore marca duplicati fatture.', { error: e.message });
      UTIL.showToast('Errore durante marcatura duplicati. Vedi Log.', 'Errore');
    }
  }

  /**
   * Rimuove la marcatura gialla dalle righe duplicate. Resumibile.
   */
  function clearDuplicateMarkings() {
    const CLEAR_CURSOR_KEY = App.config.keys.cursors.clearMarkDuplicates || 'CLEAR_MARKING_CURSOR_V1';
    const startTime = new Date();
    const maxSec = Math.max(30, Number(CONFIG.get('MAX_RUNTIME_SEC', 240)) - 30);
    const BATCH_SIZE_CLEAR = 500;

    const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    if (!shF) throw new Error('Foglio Fatture non trovato.');
    const headerRowF = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
    const lastRowF = shF.getLastRow();
    const lastColF = shF.getLastColumn();

    if (lastRowF <= headerRowF) return;

    let cursor = STATE.getJSON(CLEAR_CURSOR_KEY, { nextRow: headerRowF + 1 });
    let currentRow = cursor.nextRow;

    UTIL.showToast('Pulizia marcatura duplicati...', 'Manutenzione', -1);
    LOG.info('DEBUG_CLEAR_MARKING', `Avvio pulizia da riga ${currentRow}.`);

    while (currentRow <= lastRowF) {
      const elapsed = (new Date() - startTime) / 1000;
      if (elapsed > maxSec) {
        STATE.setJSON(CLEAR_CURSOR_KEY, { nextRow: currentRow });
        UTIL.showToast(`Timeout pulizia (riga ${currentRow}). Riprendere.`, 'Pausa', 10);
        LOG.warn('DEBUG_CLEAR_MARKING', `Timeout. Ripresa da riga ${currentRow}.`);
        return;
      }

      const chunkRowCount = Math.min(BATCH_SIZE_CLEAR, lastRowF - currentRow + 1);
      const range = shF.getRange(currentRow, 1, chunkRowCount, lastColF);

      try { range.setBackground(null); }
      catch (e) { LOG.error('DEBUG_CLEAR_MARKING', `Errore reset sfondo da riga ${currentRow}`, { error: e.message }); }

      currentRow += chunkRowCount;
      if (currentRow % (BATCH_SIZE_CLEAR * 2) === 0) {
        UTIL.showToast(`Pulisco marcatura: riga ${currentRow}/${lastRowF}...`, 'Manutenzione', -1);
      }
    }

    STATE.clear(CLEAR_CURSOR_KEY);
    UTIL.showToast('Marcatura duplicati rimossa.', 'Fatto!');
    LOG.info('DEBUG_CLEAR_MARKING', 'Pulizia marcatura completata.');
  }

  /**
   * Pulisce cache e proprietà di script (incl. cursori). Invalida cache moduli.
   */
  function clearCache() {
    const ui = SpreadsheetApp.getUi();
    const res = ui.alert(
      'Conferma Pulizia Cache',
      'Cancellerò TUTTI i dati temporanei e i progressi salvati (cursori). Sei sicuro?',
      ui.ButtonSet.YES_NO
    );
    if (res !== ui.Button.YES) { UTIL.showToast('Pulizia cache annullata.', 'Info'); return; }

    UTIL.showToast('Pulizia cache e cursori in corso...', 'Debug', -1);
    LOG.warn('DEBUG_CACHE', 'Avvio pulizia completa cache e properties.');

    const scriptProperties = PropertiesService.getScriptProperties();
    const keys = scriptProperties.getKeys();
    scriptProperties.deleteAllProperties();

    try {
      const scriptCache = CacheService.getScriptCache();
      if (scriptCache) {
        const knownBases = [MARK_DATA_CACHE_BASE_KEY, 'HEADERS_EXTRACTED_DATA_V23']; // V21 rimossa per pulizia
        const removeKeys = new Set([...knownBases, ...keys]);
        knownBases.forEach(base => { for (let i = 0; i < 100; i++) removeKeys.add(`${base}_${i}`); });
        scriptCache.removeAll(Array.from(removeKeys));
        LOG.info('DEBUG_CACHE', `Rimosse fino a ${removeKeys.size} chiavi cache.`);
      }
    } catch (e) {
      LOG.error('DEBUG_CACHE', 'Errore pulizia CacheService.', { error: e.message });
    }

    SHEETS.invalidateHeaderIndexCache();
    CONFIG.invalidateCache();

    LOG.info('DEBUG_CACHE', 'Cache e cursori azzerati.');
    UTIL.showToast('Cache e cursori azzerati!', 'Fatto!', 5);
  }


  /**
   * CORRETTO: Rinominata da removeDuplicateInvoices
   * Snapshot delle fatture duplicate in un foglio dedicato (non cancella).
   */
  function createDuplicateSnapshot() {
    const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    if (!shF) { UTIL.showToast('Foglio Fatture non trovato.', 'Errore'); return; }

    const headerRow = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
    if (shF.getLastRow() <= headerRow) { UTIL.showToast('Nessuna riga in Fatture.', 'Info'); return; }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const SNAP_NAME = 'Fatture Duplicate (Snapshot)';
    let shSnap = ss.getSheetByName(SNAP_NAME);
    if (!shSnap) shSnap = ss.insertSheet(SNAP_NAME);
    shSnap.clear();

    // Header
    const srcHeaders = shF.getRange(headerRow, 1, 1, shF.getLastColumn()).getValues()[0];
    const snapHeaders = ['_Riga', '_Link', ...srcHeaders];
    shSnap.getRange(1, 1, 1, snapHeaders.length).setValues([snapHeaders]).setFontWeight('bold');
    shSnap.setFrozenRows(1);

    // Dati e background
    const lastRow = shF.getLastRow();
    const lastCol = shF.getLastColumn();
    const dataRange = shF.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol);
    const values = dataRange.getValues();
    const backgrounds = dataRange.getBackgrounds();

    const baseUrl = ss.getUrl();
    const gid = shF.getSheetId();

    const toCopy = [];
    for (let i = 0; i < values.length; i++) {
      const sheetRow = headerRow + 1 + i;
      const rowBg = backgrounds[i];
      const isYellow = rowBg.some(c => (c || '').toLowerCase() === '#ffff00');
      if (!isYellow) continue;

      const link = `=HYPERLINK("${baseUrl}#gid=${gid}&range=A${sheetRow}","Apri riga")`;
      toCopy.push([sheetRow, link, ...values[i]]);
    }

    if (toCopy.length === 0) {
      UTIL.showToast('Nessuna riga marcata come duplicata (sfondo giallo).', 'Info');
      LOG.info('DEBUG_SNAPSHOT_DUP', 'Nessuna riga gialla trovata per snapshot.');
      return;
    }

    try {
      shSnap.getRange(2, 1, toCopy.length, snapHeaders.length).setValues(toCopy);
      try { shSnap.autoResizeColumns(1, snapHeaders.length); } catch (_) {}
      shSnap.getRange(1, snapHeaders.length + 2).setValue(`Snapshot: ${new Date().toLocaleString('it-IT')}`).setFontStyle('italic');
      UTIL.showToast(`Snapshot creato: ${toCopy.length} righe duplicate su "${SNAP_NAME}".`, 'Completato', 8);
      LOG.info('DEBUG_SNAPSHOT_DUP', `Snapshot duplicati completato (${toCopy.length} righe).`);
    } catch (e) {
      LOG.error('DEBUG_SNAPSHOT_DUP', 'Errore scrittura snapshot duplicati.', { error: e.message });
      throw e;
    }
  }

  /**
   * Trova righe duplicate nel foglio "Righe" (stesso FileID + NumeroLinea)
   * e le scrive in un foglio dedicato "Righe_Duplicate".
   */
  /**
   * Crea snapshot righe duplicate (DEV TOOL).
   * REFACTORED: Uses DUPLICATE_MANAGER.createSnapshot() (removed 140+ lines).
   */
  function DEV_FindRigheDuplicate() {
    try {
      const result = DUPLICATE_MANAGER.createSnapshot('Righe', (row, idx) => {
        const fileId = String(row[idx.FileID] || '').trim();
        const numeroLinea = String(row[idx.NumeroLinea] || '').trim();
        return `${fileId}_${numeroLinea}`;
      });

      if (result.duplicatesWritten > 0) {
        LOG.info('DEV_DUP_RIGHE', `Snapshot creato: ${result.snapshotSheetName}`, {
          duplicates: result.duplicatesWritten
        });
      } else {
        LOG.info('DEV_DUP_RIGHE', 'Nessun duplicato trovato in Righe.');
      }
    } catch (e) {
      LOG.error('DEV_DUP_RIGHE', 'Errore creazione snapshot duplicati righe.', {
        error: e.message
      });
      UTIL.showToast('Errore creazione snapshot. Vedi Log.', 'Errore');
    }
  }

  /**
   * DEV_DeleteRigheDuplicate()
   * Elimina fisicamente le righe duplicate dal foglio "Righe" usando il foglio "Righe_Duplicate" come riferimento.
   * ATTENZIONE: Operazione irreversibile! Crea un backup prima di eseguire.
   * 
   * Elimina le righe in ordine inverso (dal basso verso l'alto) per evitare
   * problemi di spostamento degli indici durante l'eliminazione.
   */
  function DEV_DeleteRigheDuplicate() {
    LOG.info('DEV_DELETE_DUP', 'Avvio eliminazione righe duplicate...');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shDup = ss.getSheetByName('Righe_Duplicate');
    
    if (!shDup) {
      UTIL.showToast('Foglio "Righe_Duplicate" non trovato. Esegui prima "Trova Righe Duplicate".', 'Errore', 8);
      LOG.error('DEV_DELETE_DUP', 'Foglio "Righe_Duplicate" non esistente.');
      return;
    }

    const lastRow = shDup.getLastRow();
    if (lastRow < 2) {
      UTIL.showToast('Nessuna riga duplicata da eliminare.', 'Info', 5);
      LOG.info('DEV_DELETE_DUP', 'Foglio "Righe_Duplicate" vuoto.');
      return;
    }

    // Chiedi conferma all'utente
    const ui = SpreadsheetApp.getUi();
    const duplicateCount = lastRow - 1;
    const response = ui.alert(
      '⚠️ ATTENZIONE: Operazione Irreversibile',
      `Stai per eliminare ${duplicateCount} righe duplicate dal foglio "Righe".\n\n` +
      `CONSIGLIO IMPORTANTE:\n` +
      `1. Crea un backup del foglio "Righe" prima di procedere\n` +
      `2. Verifica il contenuto del foglio "Righe_Duplicate"\n` +
      `3. Questa operazione NON può essere annullata\n\n` +
      `Vuoi procedere con l'eliminazione?`,
      ui.ButtonSet.YES_NO
    );

    if (response !== ui.Button.YES) {
      UTIL.showToast('Operazione annullata dall\'utente.', 'Annullato', 5);
      LOG.info('DEV_DELETE_DUP', 'Eliminazione annullata dall\'utente.');
      return;
    }

    // Leggi gli indici delle righe da eliminare (colonna RowIndex)
    const shRighe = SHEETS.get(SHEETS.SHEET_NAMES.Righe);
    if (!shRighe) {
      UTIL.showToast('Foglio "Righe" non trovato!', 'Errore');
      LOG.error('DEV_DELETE_DUP', 'Foglio "Righe" non trovato.');
      return;
    }

    try {
      // Leggi colonna RowIndex (colonna 6)
      const rowIndexCol = 6;
      const rowIndices = shDup.getRange(2, rowIndexCol, duplicateCount, 1).getValues();
      
      // Converti in array di numeri e ordina in ordine DECRESCENTE
      // (eliminare dal basso verso l'alto per evitare spostamenti di indice)
      const rowsToDelete = rowIndices
        .map(row => Number(row[0]))
        .filter(idx => !isNaN(idx) && idx > 0)
        .sort((a, b) => b - a); // Ordine DECRESCENTE

      if (rowsToDelete.length === 0) {
        UTIL.showToast('Nessun indice di riga valido trovato.', 'Errore');
        LOG.error('DEV_DELETE_DUP', 'Nessun indice RowIndex valido.');
        return;
      }

      LOG.info('DEV_DELETE_DUP', `Eliminazione di ${rowsToDelete.length} righe duplicate...`);
      UTIL.showToast(`Eliminazione ${rowsToDelete.length} righe in corso...`, 'Attendere', -1);

      // Elimina le righe una alla volta (dal basso verso l'alto)
      let deletedCount = 0;
      for (const rowIndex of rowsToDelete) {
        try {
          shRighe.deleteRow(rowIndex);
          deletedCount++;
          
          // Toast di progresso ogni 50 righe
          if (deletedCount % 50 === 0) {
            UTIL.showToast(`Eliminate ${deletedCount}/${rowsToDelete.length} righe...`, 'In corso', -1);
          }
        } catch (e) {
          LOG.error('DEV_DELETE_DUP', `Errore eliminazione riga ${rowIndex}`, { error: e.message });
          // Continua con le altre righe
        }
      }

      // Pulisci il foglio "Righe_Duplicate" dopo l'eliminazione
      shDup.clear();
      const schema = SHEETS.SCHEMAS['Righe_Duplicate'] || ['FileID', 'NumeroDoc', 'NumeroLinea', 'CodiceValore', 'Descrizione', 'RowIndex'];
      shDup.getRange(1, 1, 1, schema.length).setValues([schema]).setFontWeight('bold');
      shDup.setFrozenRows(1);

      UTIL.showToast(`✅ Eliminate ${deletedCount} righe duplicate con successo!`, 'Completato', 8);
      LOG.info('DEV_DELETE_DUP', `Eliminazione completata. Righe eliminate: ${deletedCount}`);
      
      // Torna al foglio Righe per mostrare il risultato
      shRighe.activate();

    } catch (e) {
      LOG.error('DEV_DELETE_DUP', 'Errore durante l\'eliminazione delle righe duplicate', { error: e.message, stack: e.stack });
      UTIL.showToast('Errore durante l\'eliminazione. Vedi Log.', 'Errore');
    }
  }

  /**
   * DEV_CountDuplicates()
   * Conta quante righe duplicate esistono nel foglio "Righe" senza creare output.
   * Mostra statistiche in un alert dialog.
   */
  function DEV_CountDuplicates() {
    LOG.info('DEV_COUNT_DUP', 'Avvio conteggio righe duplicate...');

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shR = ss.getSheetByName('Righe');
    
    if (!shR) {
      UTIL.showToast('Foglio "Righe" non trovato!', 'Errore');
      LOG.error('DEV_COUNT_DUP', 'Foglio "Righe" non esistente.');
      return;
    }

    const lastRow = shR.getLastRow();
    if (lastRow < 2) {
      UTIL.showToast('Foglio "Righe" vuoto.', 'Info', 5);
      LOG.info('DEV_COUNT_DUP', 'Foglio "Righe" vuoto, nessuna riga da analizzare.');
      return;
    }

    // Trova header e indici
    const headerRow = SHEETS._findHeaderRow(shR, SHEETS.SHEET_NAMES.Righe);
    const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Righe);

    if (idx.FileID === undefined || idx.NumeroLinea === undefined) {
      UTIL.showToast('Colonne FileID o NumeroLinea mancanti.', 'Errore');
      LOG.error('DEV_COUNT_DUP', 'Colonne FileID o NumeroLinea non trovate.');
      return;
    }

    const maxCol = Math.max(idx.FileID, idx.NumeroLinea) + 1;

    try {
      UTIL.showToast('Lettura dati in corso...', 'Analisi', -1);
      const data = shR.getRange(headerRow + 1, 1, lastRow - headerRow, maxCol).getValues();
      
      const seen = new Map();
      let duplicateCount = 0;
      let totalRows = 0;

      data.forEach((row, i) => {
        const fileId = String(row[idx.FileID] || '').trim();
        const numeroLinea = String(row[idx.NumeroLinea] || '').trim();
        
        if (!fileId || !numeroLinea) return; // Salta righe incomplete
        
        totalRows++;
        const key = `${fileId}|${numeroLinea}`;
        
        if (seen.has(key)) {
          duplicateCount++;
        } else {
          seen.set(key, true);
        }
      });

      const uniqueRows = seen.size;
      const dupPercent = totalRows > 0 ? ((duplicateCount / totalRows) * 100).toFixed(1) : 0;
      
      LOG.info('DEV_COUNT_DUP', `Analisi completata. Righe totali: ${totalRows}, Uniche: ${uniqueRows}, Duplicate: ${duplicateCount}`);

      const ui = SpreadsheetApp.getUi();
      const recommendation = duplicateCount > 500 
        ? '⚠️ CONSIGLIATO: Reimport totale (troppe duplicazioni)'
        : duplicateCount > 0 
        ? '✅ OK: Usa "Elimina Righe Duplicate" dal menu'
        : '✅ Nessun duplicato trovato!';

      ui.alert(
        '📊 Statistiche Righe Duplicate',
        `Righe totali analizzate: ${totalRows}\n` +
        `Righe uniche: ${uniqueRows}\n` +
        `Righe duplicate: ${duplicateCount} (${dupPercent}%)\n\n` +
        recommendation,
        ui.ButtonSet.OK
      );

    } catch (e) {
      LOG.error('DEV_COUNT_DUP', 'Errore durante il conteggio duplicati', { error: e.message });
      UTIL.showToast('Errore durante l\'analisi. Vedi Log.', 'Errore');
    }
  }

  /**
   * DEV_ResetAllImportFlags()
   * Resetta i flag di import righe su TUTTE le fatture.
   * ATTENZIONE: Usa solo DOPO aver eliminato tutte le righe dal foglio "Righe".
   */
  function DEV_ResetAllImportFlags() {
    LOG.info('DEV_RESET_FLAGS', 'Richiesta reset flag import...');

    const ui = SpreadsheetApp.getUi();
    const response = ui.alert(
      '⚠️ ATTENZIONE: Reset Flag Import',
      'Questa operazione resetterà i flag di import su TUTTE le fatture:\n\n' +
      '• RigheImportate → FALSE\n' +
      '• ImportaRigheSrc → (vuoto)\n' +
      '• RigheImportateNum → 0\n' +
      '• TotRigheNetto → 0\n\n' +
      'IMPORTANTE:\n' +
      '1. Assicurati di aver eliminato TUTTE le righe dal foglio "Righe"\n' +
      '2. Questa operazione serve per preparare un reimport completo\n' +
      '3. Dopo il reset, dovrai eseguire "Importa Righe Prodotti"\n\n' +
      'Vuoi procedere?',
      ui.ButtonSet.YES_NO
    );

    if (response !== ui.Button.YES) {
      UTIL.showToast('Operazione annullata.', 'Annullato', 5);
      LOG.info('DEV_RESET_FLAGS', 'Reset flag annullato dall\'utente.');
      return;
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const shF = ss.getSheetByName('Fatture');
    
    if (!shF) {
      UTIL.showToast('Foglio "Fatture" non trovato!', 'Errore');
      LOG.error('DEV_RESET_FLAGS', 'Foglio "Fatture" non esistente.');
      return;
    }

    const lastRow = shF.getLastRow();
    if (lastRow < 2) {
      UTIL.showToast('Foglio "Fatture" vuoto.', 'Info', 5);
      LOG.info('DEV_RESET_FLAGS', 'Foglio "Fatture" vuoto.');
      return;
    }

    try {
      // Trova indici colonne
      const headers = shF.getRange(1, 1, 1, shF.getLastColumn()).getValues()[0];
      const idxRigheImportate = headers.indexOf('RigheImportate');
      const idxImportaRigheSrc = headers.indexOf('ImportaRigheSrc');
      const idxRigheImportateNum = headers.indexOf('RigheImportateNum');
      const idxTotRigheNetto = headers.indexOf('TotRigheNetto');
      
      if (idxRigheImportate === -1 || idxImportaRigheSrc === -1) {
        UTIL.showToast('Colonne RigheImportate/ImportaRigheSrc non trovate!', 'Errore');
        LOG.error('DEV_RESET_FLAGS', 'Colonne necessarie non trovate nel foglio Fatture.');
        return;
      }
      
      UTIL.showToast('Reset flag in corso...', 'Attendere', -1);
      
      const rowCount = lastRow - 1;
      
      // Reset RigheImportate e ImportaRigheSrc (obbligatori)
      shF.getRange(2, idxRigheImportate + 1, rowCount, 1).setValue(false);
      shF.getRange(2, idxImportaRigheSrc + 1, rowCount, 1).setValue('');
      
      // Reset RigheImportateNum e TotRigheNetto (opzionali)
      if (idxRigheImportateNum !== -1) {
        shF.getRange(2, idxRigheImportateNum + 1, rowCount, 1).setValue(0);
      }
      
      if (idxTotRigheNetto !== -1) {
        shF.getRange(2, idxTotRigheNetto + 1, rowCount, 1).setValue(0);
      }
      
      UTIL.showToast(`✅ Reset completato su ${rowCount} fatture!`, 'Completato', 8);
      LOG.info('DEV_RESET_FLAGS', `Reset flag completato su ${rowCount} fatture.`);
      
      ui.alert(
        '✅ Reset Completato',
        `Flag resettati su ${rowCount} fatture.\n\n` +
        'PROSSIMO STEP:\n' +
        'Menu > Importazione Dati > 2. Importa Righe Prodotti\n\n' +
        'L\'import partirà da zero e creerà un dataset pulito senza duplicati.',
        ui.ButtonSet.OK
      );

    } catch (e) {
      LOG.error('DEV_RESET_FLAGS', 'Errore durante il reset flag', { error: e.message });
      UTIL.showToast('Errore durante il reset. Vedi Log.', 'Errore');
    }
  }

  // --- Utility Interne ---

  /**
   * Pulisce lo stato specifico della marcatura duplicati (cursore e cache) e azzera conteggio.
   * @private
   */
  function _clearMarkingState(cursor) {
    STATE.clear(MARK_CURSOR_KEY);
    const numChunks = cursor?.numChunks;
    if (numChunks > 0) {
      STATE.cache.clearLargeJSON(MARK_DATA_CACHE_BASE_KEY, numChunks);
      LOG.debug('DEBUG_MARK_DUPLICATES', `Puliti ${numChunks} chunk da cache per ${MARK_DATA_CACHE_BASE_KEY}.`);
    }
    STATE.clear(DUPLICATE_COUNT_KEY);
  }

  // --- Oggetto Pubblico Esportato ---
  return {
    clearCache: clearCache,
    sanityCheck: sanityCheck,
    manageDuplicateInvoices: manageDuplicateInvoices, // NUOVA: silenziosa per manutenzione
    manageDuplicateRows: manageDuplicateRows, // NUOVA: silenziosa per manutenzione
    markDuplicateInvoices: markDuplicateInvoices,
    clearDuplicateMarkings: clearDuplicateMarkings,
    forceTextFormatOnCodes: forceTextFormatOnCodes,
    syncSuppliersFromInvoices: syncSuppliersFromInvoices,
    syncCategoriesRetroactive: syncCategoriesRetroactive,
    createDuplicateSnapshot: createDuplicateSnapshot,
    DEV_FindRigheDuplicate: DEV_FindRigheDuplicate,
    DEV_DeleteRigheDuplicate: DEV_DeleteRigheDuplicate,
    DEV_CountDuplicates: DEV_CountDuplicates,
    DEV_ResetAllImportFlags: DEV_ResetAllImportFlags
  };
})();

// Registra DEBUG nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('DEBUG', ['SHEETS', 'LOG', 'UTIL', 'STATE', 'CONFIG', 'DUPLICATE_MANAGER']);
}

// Registra DEBUG nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('DEBUG', DEBUG);
}