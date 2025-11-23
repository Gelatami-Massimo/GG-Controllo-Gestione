// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 130_debug.js
// RUOLO: Suite strumenti manutenzione e diagnostica.
// NOTE: Usa DUPLICATE_MANAGER, SHEET_ITERATOR, ERROR_HANDLER.safely().
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
      const accessible = ERROR_HANDLER.safely(
        () => DriveApp.getFolderById(inputFolderId),
        { scope: 'SANITY_CHECK', message: `Impossibile accedere a CARTELLA_INPUT_ID: ${inputFolderId}` }
      );
      if (!accessible) errors++;
    }

    // Controllo Cartella Output (per PDF)
    const outputFolderId = CONFIG.get('CARTELLA_OUTPUT_ID');
      if (!outputFolderId) {
      LOG.warn('SANITY_CHECK', 'CARTELLA_OUTPUT_ID non configurata (necessaria per PDF).'); // Warning, non bloccante
      warnings++;
    } else {
      const accessible = ERROR_HANDLER.safely(
        () => DriveApp.getFolderById(outputFolderId),
        { scope: 'SANITY_CHECK', message: `Impossibile accedere a CARTELLA_OUTPUT_ID: ${outputFolderId}` }
      );
      if (!accessible) errors++;
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
   * AGGIORNATO: Sovrascrive SEMPRE i campi con i valori aggiornati dai Fornitori.
   */
  function syncCategoriesRetroactive() {
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

      let updates = {};
      // Include anche Reparto se esiste
      const maxColNeeded = idx.Reparto !== undefined
        ? Math.max(idx.FornitoreID, idx.Famiglia, idx.Categoria, idx.Reparto) + 1
        : Math.max(idx.FornitoreID, idx.Famiglia, idx.Categoria) + 1;

      // REFACTORED: Use SHEET_ITERATOR for automatic chunk handling
      const iteratorResult = SHEET_ITERATOR.forEachChunk({
        sheet: sh,
        sheetName: sheetName,
        startRow: cursor.nextRow,
        endRow: lastRow,
        batchSize: CHUNK_SIZE,
        maxColumns: maxColNeeded,
        cursorKey: SYNC_CAT_CURSOR_KEY,
        maxRuntimeSec: maxSec,
        onTimeout: () => {
          if (Object.keys(updates).length > 0) {
            UTIL.updateSheetInPlace(sh, updates, headerRow);
            updates = {};
          }
          cursor.sheetIndex = i;
          STATE.setJSON(SYNC_CAT_CURSOR_KEY, cursor);
          UTIL.showToast(`Timeout. Pausa (${sheetName}). Clicca di nuovo per riprendere.`, 'Pausa', 10);
          LOG.warn('SYNC_CATEGORIES', `Timeout ${sheetName}. Ripresa salvata.`);
        },
        processChunk: (chunkData, chunkStartRow) => {
          // --- LOGICA AGGIORNAMENTO FORZATO (SOVRASCRIVE SEMPRE DAI FORNITORI) ---
          for (let j = 0; j < chunkData.length; j++) {
            const rowData = chunkData[j];
            const rowNum = chunkStartRow + j;

            const idNorm = UTIL.normKey(rowData[idx.FornitoreID]).replace(/^0+/, '');
            if (!idNorm) continue;

            const curr = supplierMap.get(idNorm);
            if (!curr) continue; // Fornitore non in mappa

            const existingFamiglia = String(rowData[idx.Famiglia] ?? '').trim();
            const existingCategoria = String(rowData[idx.Categoria] ?? '').trim();
            const existingReparto = idx.Reparto !== undefined 
              ? String(rowData[idx.Reparto] ?? '').trim() 
              : null;
            
            let needsUpdate = false;
            let rowUpdates = {}; // Aggiornamenti solo per questa riga

            // Condizione 1: Famiglia diversa dal fornitore → aggiorna sempre
            if (curr.famiglia && existingFamiglia !== curr.famiglia) {
              rowUpdates[idx.Famiglia] = curr.famiglia;
              needsUpdate = true;
            }

            // Condizione 2: Categoria diversa dal fornitore → aggiorna sempre
            if (curr.categoria && existingCategoria !== curr.categoria) {
              rowUpdates[idx.Categoria] = curr.categoria;
              needsUpdate = true;
            }
            
            // Condizione 3: Reparto diverso dal fornitore → aggiorna sempre (solo per Fatture)
            if (existingReparto !== null && curr.reparto && curr.reparto !== '' && existingReparto !== curr.reparto && sheetName === SHEETS.SHEET_NAMES.Fatture) {
              rowUpdates[idx.Reparto] = curr.reparto;
              needsUpdate = true;
            }
            
            // Se la riga deve essere aggiornata (uno o più campi)
            if (needsUpdate) {
              if (!updates[rowNum]) updates[rowNum] = {};
              Object.assign(updates[rowNum], rowUpdates);
            }
          }

          // Flush periodico
          if (Object.keys(updates).length >= CHUNK_SIZE * 2) {
            const flushed = UTIL.updateSheetInPlace(sh, updates, headerRow);
            LOG.info('SYNC_CATEGORIES', `Aggiornate ${flushed} celle in ${sheetName}.`);
            updates = {};
          }

          // UI progress
          if (chunkStartRow % (CHUNK_SIZE * 2) === 0) {
            UTIL.showToast(`Riallineo ${sheetName}: riga ${chunkStartRow}/${lastRow}...`, 'Manutenzione', -1);
          }
        }
      });

      // Check if interrupted
      if (iteratorResult.interrupted) {
        return;
      }

      // Flush finale per questo foglio
      if (Object.keys(updates).length > 0) {
        const flushed = UTIL.updateSheetInPlace(sh, updates, headerRow);
        LOG.info('SYNC_CATEGORIES', `Aggiornate ${flushed} celle in ${sheetName} (finale).`);
        updates = {};
      }

      cursor.sheetIndex = i + 1; cursor.nextRow = 0;
      STATE.setJSON(SYNC_CAT_CURSOR_KEY, cursor);
    }

    STATE.clear(SYNC_CAT_CURSOR_KEY);
    UTIL.showToast('Riallineamento categorie completato!', 'Fatto!');
    LOG.info('SYNC_CATEGORIES', 'Completato per tutti i fogli.');
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
          famiglia: String(r[idx.Famiglia] ?? '').trim() || 'Non Categorizzato',
          categoria: String(r[idx.Categoria] ?? '').trim() || '',
          reparto: idx.Reparto !== undefined ? String(r[idx.Reparto] ?? '').trim() : ''
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
    const maxSec = Math.max(30, Number(CONFIG.get('MAX_RUNTIME_SEC', 240)) - 30);
    const CHUNK_SIZE = 1000;

    const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    const shFor = SHEETS.get(SHEETS.SHEET_NAMES.Fornitori);
    if (!shF || !shFor) { UTIL.showToast("Fogli 'Fatture' o 'Fornitori' non trovati.", 'Errore'); return; }

    const headerRowF = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
    const headerRowFor = SHEETS._findHeaderRow(shFor, SHEETS.SHEET_NAMES.Fornitori);
    const lastRowF = shF.getLastRow();

    let cursor = STATE.getJSON(SYNC_SUPPLIERS_CURSOR_KEY, { nextRow: headerRowF + 1 });

    if (cursor.nextRow > lastRowF) { UTIL.showToast('Nessuna nuova fattura da cui sincronizzare fornitori.', 'Info'); STATE.clear(SYNC_SUPPLIERS_CURSOR_KEY); return; }

    const idxF = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
    const requiredF = ['FornitoreID', 'DenominazioneFornitore', 'RegimeFiscale'];
    const missingF = UTIL.checkColumns(idxF, requiredF);
    if (missingF.length) { UTIL.showToast(`Colonne mancanti in Fatture: ${missingF.join(', ')}`, 'Errore'); return; }

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
    const lastColNeeded = Math.max(idxF.FornitoreID, idxF.DenominazioneFornitore, idxF.RegimeFiscale) + 1;

    UTIL.showToast('Sincronizzazione Fornitori da Fatture...', 'Manutenzione', -1);

    // REFACTORED: Use SHEET_ITERATOR for automatic chunk handling
    const iteratorResult = SHEET_ITERATOR.forEachChunk({
      sheet: shF,
      sheetName: SHEETS.SHEET_NAMES.Fatture,
      startRow: cursor.nextRow,
      endRow: lastRowF,
      batchSize: CHUNK_SIZE,
      maxColumns: lastColNeeded,
      cursorKey: SYNC_SUPPLIERS_CURSOR_KEY,
      maxRuntimeSec: maxSec,
      onTimeout: () => {
        if (newRowsBatch.length > 0) {
          const written = ERROR_HANDLER.safely(
            () => { UTIL.writeBatched(shFor, Math.max(shFor.getLastRow() + 1, headerRowFor + 1), newRowsBatch); return newRowsBatch.length; },
            { scope: 'DEBUG_SYNC_SUP_FROM_INV', message: 'Errore scrittura batch fornitori.' }
          );
          if (written) added += written;
          newRowsBatch = [];
        }
        UTIL.showToast(`Pausa per timeout: aggiunti finora ${added} fornitori. Riprendere.`, 'Pausa', 10);
        LOG.warn('DEBUG_SYNC_SUP_FROM_INV', `Timeout dopo ${added} nuovi fornitori. Ripresa salvata.`);
      },
      processChunk: (chunk, chunkStartRow) => {
        chunk.forEach(row => {
          const idNorm = UTIL.normKey(row[idxF.FornitoreID]).replace(/^0+/, '');
          const denom = String(row[idxF.DenominazioneFornitore] ?? '').trim();
          if (!idNorm || !denom) return;
          if (!existingIds.has(idNorm)) {
            newRowsBatch.push([idNorm, denom, '', '', defaultImportRows]);
            existingIds.add(idNorm);
          }
        });

        // Flush batch periodico
        if (newRowsBatch.length >= 1000) {
          const written = ERROR_HANDLER.safely(
            () => { UTIL.writeBatched(shFor, Math.max(shFor.getLastRow() + 1, headerRowFor + 1), newRowsBatch); return newRowsBatch.length; },
            { scope: 'DEBUG_SYNC_SUP_FROM_INV', message: 'Errore scrittura batch fornitori.' }
          );
          if (written) added += written;
          newRowsBatch = [];
        }

        // UI progress
        if (chunkStartRow % (CHUNK_SIZE * 2) === 0) {
          UTIL.showToast(`Sincronizzo fornitori... (riga ${chunkStartRow}/${lastRowF})`, 'Manutenzione', -1);
        }
      }
    });

    // Check if interrupted
    if (iteratorResult.interrupted) {
      return;
    }

    // Flush finale
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

      const maxColNeeded = Math.max(...colIndices) + 1;

      // REFACTORED: Use SHEET_ITERATOR for automatic chunk handling
      const iteratorResult = SHEET_ITERATOR.forEachChunk({
        sheet: sh,
        sheetName: sheetName,
        startRow: cursor.nextRow,
        endRow: lastRow,
        batchSize: CHUNK_SIZE,
        maxColumns: maxColNeeded,
        cursorKey: FORCE_TEXT_CURSOR_KEY,
        maxRuntimeSec: maxSec,
        onTimeout: () => {
          cursor.sheetIndex = i;
          STATE.setJSON(FORCE_TEXT_CURSOR_KEY, cursor);
          UTIL.showToast(`Timeout. Pausa (${sheetName}).`, 'Pausa', 10);
          LOG.warn('FORCE_TEXT', `Timeout ${sheetName}. Ripresa salvata.`);
        },
        processChunk: (chunkData, chunkStartRow) => {
          let changed = false;
          chunkData.forEach(rowData => {
            colIndices.forEach(ci => {
              const o = rowData[ci];
              const v = UTIL.forceText(o);
              if (o !== v) { rowData[ci] = v; changed = true; }
            });
          });

          if (changed) {
            ERROR_HANDLER.safely(
              () => {
                const range = sh.getRange(chunkStartRow, 1, chunkData.length, maxColNeeded);
                range.setValues(chunkData);
              },
              { scope: 'FORCE_TEXT', message: `Errore scrittura chunk in ${sheetName}, riga ${chunkStartRow}` }
            );
          }

          // UI progress
          if (chunkStartRow % (CHUNK_SIZE * 2) === 0) {
            UTIL.showToast(`Applico formato testo ${sheetName}: riga ${chunkStartRow}/${lastRow}...`, 'Manutenzione', -1);
          }
        }
      });

      // Check if interrupted
      if (iteratorResult.interrupted) {
        return;
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
    const maxSec = Math.max(30, Number(CONFIG.get('MAX_RUNTIME_SEC', 240)) - 30);
    const BATCH_SIZE_CLEAR = 500;

    const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    if (!shF) throw new Error('Foglio Fatture non trovato.');
    const headerRowF = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
    const lastRowF = shF.getLastRow();
    const lastColF = shF.getLastColumn();

    if (lastRowF <= headerRowF) return;

    let cursor = STATE.getJSON(CLEAR_CURSOR_KEY, { nextRow: headerRowF + 1 });

    UTIL.showToast('Pulizia marcatura duplicati...', 'Manutenzione', -1);
    LOG.info('DEBUG_CLEAR_MARKING', `Avvio pulizia da riga ${cursor.nextRow}.`);

    // REFACTORED: Use SHEET_ITERATOR for automatic chunk handling
    const iteratorResult = SHEET_ITERATOR.forEachChunk({
      sheet: shF,
      sheetName: SHEETS.SHEET_NAMES.Fatture,
      startRow: cursor.nextRow,
      endRow: lastRowF,
      batchSize: BATCH_SIZE_CLEAR,
      maxColumns: lastColF,
      cursorKey: CLEAR_CURSOR_KEY,
      maxRuntimeSec: maxSec,
      onTimeout: () => {
        UTIL.showToast('Timeout pulizia. Riprendere.', 'Pausa', 10);
        LOG.warn('DEBUG_CLEAR_MARKING', 'Timeout. Ripresa salvata.');
      },
      processChunk: (chunkData, chunkStartRow) => {
        const range = shF.getRange(chunkStartRow, 1, chunkData.length, lastColF);
        ERROR_HANDLER.safely(
          () => range.setBackground(null),
          { scope: 'DEBUG_CLEAR_MARKING', message: `Errore reset sfondo da riga ${chunkStartRow}` }
        );

        // UI progress
        if (chunkStartRow % (BATCH_SIZE_CLEAR * 2) === 0) {
          UTIL.showToast(`Pulisco marcatura: riga ${chunkStartRow}/${lastRowF}...`, 'Manutenzione', -1);
        }
      }
    });

    // Check if interrupted
    if (iteratorResult.interrupted) {
      return;
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
   * DEV_DiagnoseHotelCosts()
   * Diagnostica il problema dei costi Hotel nel P&L.
   * Verifica:
   * - Nomi sedi in Fatture vs Aziende
   * - Mapping Reparto Hotel
   * - Totali aggregati
   */
  function DEV_DiagnoseHotelCosts() {
    LOG.info('DEV_HOTEL_DIAG', '=== DIAGNOSI COSTI HOTEL ===');
    
    const ui = SpreadsheetApp.getUi();
    let report = '📊 DIAGNOSI COSTI HOTEL\n\n';
    
    try {
      // 1. Verifica foglio Aziende
      const shAziende = SHEETS.get('Aziende');
      if (!shAziende) {
        report += '❌ Foglio "Aziende" non trovato!\n';
        ui.alert('Errore', report, ui.ButtonSet.OK);
        return;
      }
      
      const headerRowAz = SHEETS._findHeaderRow(shAziende, 'Aziende');
      const idxAz = SHEETS.headerIndex('Aziende');
      
      if (idxAz.P_IVA_Azienda === undefined || idxAz.Nome_Sede === undefined) {
        report += '❌ Colonne P_IVA_Azienda o Nome_Sede mancanti in Aziende!\n';
        ui.alert('Errore', report, ui.ButtonSet.OK);
        return;
      }
      
      const rowsAz = shAziende.getRange(headerRowAz + 1, 1, shAziende.getLastRow() - headerRowAz, Math.max(idxAz.P_IVA_Azienda, idxAz.Nome_Sede) + 1).getValues();
      
      report += '✅ FOGLIO AZIENDE:\n';
      rowsAz.forEach(row => {
        const pIva = String(row[idxAz.P_IVA_Azienda] || '').trim();
        const sede = String(row[idxAz.Nome_Sede] || '').trim();
        const azienda = pIva === '4230940167' ? 'Gemma' : pIva === '4489830986' ? 'Zaffiro' : 'Sconosciuto';
        report += `  • Sede: "${sede}" → ${azienda} (P.IVA: ${pIva})\n`;
      });
      report += '\n';
      
      // 2. Verifica fatture Hotel
      const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
      if (!shF) {
        report += '❌ Foglio Fatture non trovato!\n';
        ui.alert('Errore', report, ui.ButtonSet.OK);
        return;
      }
      
      const headerRowF = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
      const idxF = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
      
      if (idxF.Reparto === undefined) {
        report += '❌ Colonna Reparto mancante in Fatture!\n';
        ui.alert('Errore', report, ui.ButtonSet.OK);
        return;
      }
      
      if (idxF.Sede === undefined) {
        report += '⚠️ ATTENZIONE: Colonna Sede mancante in Fatture!\n';
        report += '   Il P&L non potrà determinare l\'azienda (Gemma/Zaffiro).\n\n';
      }
      
      const maxCol = Math.max(
        idxF.Reparto,
        idxF.Sede ?? 0,
        idxF.TotImponibile ?? 0,
        idxF.FornitoreID ?? 0,
        idxF.Famiglia ?? 0,
        idxF.Anno ?? 0,
        idxF.Mese ?? 0
      ) + 1;
      
      const rowsF = shF.getRange(headerRowF + 1, 1, Math.min(shF.getLastRow() - headerRowF, 1000), maxCol).getValues();
      
      const hotelInvoices = rowsF.filter(row => {
        const reparto = String(row[idxF.Reparto] || '').trim();
        return reparto.toLowerCase() === 'hotel';
      });
      
      report += `✅ FATTURE CON REPARTO="Hotel": ${hotelInvoices.length}\n\n`;
      
      if (hotelInvoices.length === 0) {
        report += '⚠️ NESSUNA FATTURA TROVATA CON REPARTO="Hotel"!\n';
        report += '   Verifica che il campo Reparto sia popolato correttamente.\n';
        ui.alert('Diagnosi Completata', report, ui.ButtonSet.OK);
        return;
      }
      
      // Mostra sample fatture Hotel
      report += 'CAMPIONE FATTURE HOTEL (prime 5):\n';
      const sediDistinte = new Set();
      const totaliPerSede = new Map();
      
      hotelInvoices.slice(0, 5).forEach((row, i) => {
        const sede = idxF.Sede !== undefined ? String(row[idxF.Sede] || '').trim() : 'N/A';
        const totImp = idxF.TotImponibile !== undefined ? UTIL.parseNumSmart(row[idxF.TotImponibile]) : 0;
        const forn = idxF.FornitoreID !== undefined ? String(row[idxF.FornitoreID] || '').trim() : 'N/A';
        const fam = idxF.Famiglia !== undefined ? String(row[idxF.Famiglia] || '').trim() : 'N/A';
        const anno = idxF.Anno !== undefined ? row[idxF.Anno] : 'N/A';
        const mese = idxF.Mese !== undefined ? row[idxF.Mese] : 'N/A';
        
        report += `  ${i+1}. Sede="${sede}" | Famiglia="${fam}" | Anno=${anno} Mese=${mese} | Tot=€${totImp.toFixed(2)}\n`;
        
        if (sede !== 'N/A') sediDistinte.add(sede);
      });
      report += '\n';
      
      // Aggrega totali per sede
      hotelInvoices.forEach(row => {
        const sede = idxF.Sede !== undefined ? String(row[idxF.Sede] || 'Sconosciuta').trim() : 'Sconosciuta';
        const totImp = idxF.TotImponibile !== undefined ? UTIL.parseNumSmart(row[idxF.TotImponibile]) : 0;
        
        if (!totaliPerSede.has(sede)) totaliPerSede.set(sede, 0);
        totaliPerSede.set(sede, totaliPerSede.get(sede) + totImp);
      });
      
      report += 'TOTALI HOTEL PER SEDE:\n';
      totaliPerSede.forEach((tot, sede) => {
        report += `  • "${sede}": €${tot.toFixed(2)}\n`;
      });
      report += '\n';
      
      // 3. Verifica matching Sede → Azienda
      if (idxF.Sede !== undefined) {
        report += 'VERIFICA MATCHING SEDE → AZIENDA:\n';
        const sediAziende = new Set(rowsAz.map(r => String(r[idxAz.Nome_Sede] || '').trim()));
        
        sediDistinte.forEach(sede => {
          const trovata = sediAziende.has(sede);
          report += `  • "${sede}": ${trovata ? '✅ TROVATA' : '❌ NON TROVATA in foglio Aziende'}\n`;
        });
        report += '\n';
      }
      
      // 4. Consigli
      report += '💡 SUGGERIMENTI:\n';
      if (idxF.Sede === undefined) {
        report += '  1. Aggiungi colonna "Sede" al foglio Fatture\n';
        report += '  2. Popola la colonna con il nome della sede\n';
        report += '  3. Assicurati che i nomi corrispondano al foglio Aziende\n';
      } else if (sediDistinte.size === 0) {
        report += '  1. La colonna Sede esiste ma è vuota nelle fatture Hotel\n';
        report += '  2. Popola il campo Sede per ogni fattura Hotel\n';
      } else {
        let mismatch = false;
        const sediAziende = new Set(rowsAz.map(r => String(r[idxAz.Nome_Sede] || '').trim()));
        sediDistinte.forEach(sede => {
          if (!sediAziende.has(sede)) mismatch = true;
        });
        
        if (mismatch) {
          report += '  1. NOMI SEDI NON CORRISPONDONO tra Fatture e Aziende\n';
          report += '  2. Verifica maiuscole/minuscole e spazi\n';
          report += '  3. Allinea i nomi esattamente (case-sensitive!)\n';
        } else {
          report += '  ✅ Tutto sembra OK! Se il P&L ancora non mostra i costi:\n';
          report += '     1. Rigenera il P&L (Menu → Report)\n';
          report += '     2. Verifica il filtro anno/sede applicato\n';
        }
      }
      
      LOG.info('DEV_HOTEL_DIAG', report);
      ui.alert('📊 Diagnosi Costi Hotel', report, ui.ButtonSet.OK);
      
    } catch (e) {
      report += `\n❌ ERRORE: ${e.message}\n`;
      LOG.error('DEV_HOTEL_DIAG', 'Errore diagnosi', { error: e.message, stack: e.stack });
      ui.alert('Errore Diagnosi', report, ui.ButtonSet.OK);
    }
  }

  /**
   * DEV_CompareHotelCostsWithPnL()
   * Confronta i costi Hotel dal foglio Fatture con quelli mostrati nel P&L.
   * Identifica discrepanze e fatture mancanti.
   */
  function DEV_CompareHotelCostsWithPnL() {
    LOG.info('DEV_HOTEL_COMPARE', '=== CONFRONTO COSTI HOTEL FATTURE VS P&L ===');
    
    const ui = SpreadsheetApp.getUi();
    let report = '📊 CONFRONTO COSTI HOTEL: FATTURE VS P&L\n\n';
    
    try {
      const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
      if (!shF) {
        report += '❌ Foglio Fatture non trovato!\n';
        ui.alert('Errore', report, ui.ButtonSet.OK);
        return;
      }
      
      const headerRowF = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
      const idxF = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
      
      const maxCol = Math.max(
        idxF.Reparto ?? 0,
        idxF.Sede ?? 0,
        idxF.TotImponibile ?? 0,
        idxF.Anno ?? 0,
        idxF.Mese ?? 0,
        idxF.Famiglia ?? 0,
        idxF.FornitoreID ?? 0,
        idxF.DenominazioneFornitore ?? 0
      ) + 1;
      
      const rowsF = shF.getRange(headerRowF + 1, 1, shF.getLastRow() - headerRowF, maxCol).getValues();
      
      // Filtra fatture Hotel per Gemma 2025
      const hotelGemma2025 = rowsF.filter(row => {
        const reparto = String(row[idxF.Reparto] || '').trim().toLowerCase();
        const sede = String(row[idxF.Sede] || '').trim();
        const anno = row[idxF.Anno];
        return reparto === 'hotel' && sede === 'Gemma' && anno === 2025;
      });
      
      report += `FATTURE HOTEL GEMMA 2025: ${hotelGemma2025.length} fatture\n\n`;
      
      // Aggrega per mese
      const totaliPerMese = new Map();
      const fatturePerMese = new Map();
      
      hotelGemma2025.forEach(row => {
        const mese = row[idxF.Mese];
        const totImp = UTIL.parseNumSmart(row[idxF.TotImponibile]);
        const famiglia = String(row[idxF.Famiglia] || '').trim();
        const forn = String(row[idxF.DenominazioneFornitore] || '').trim();
        
        if (!totaliPerMese.has(mese)) {
          totaliPerMese.set(mese, 0);
          fatturePerMese.set(mese, []);
        }
        
        totaliPerMese.set(mese, totaliPerMese.get(mese) + totImp);
        fatturePerMese.get(mese).push({
          fornitore: forn,
          famiglia: famiglia,
          importo: totImp
        });
      });
      
      // Totale generale
      const totaleGenerale = Array.from(totaliPerMese.values()).reduce((sum, v) => sum + v, 0);
      
      report += 'TOTALI HOTEL GEMMA 2025 PER MESE:\n';
      report += '(Dal foglio Fatture - dati RAW)\n\n';
      
      const mesi = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
      
      for (let m = 1; m <= 12; m++) {
        const tot = totaliPerMese.get(m) || 0;
        const fatture = fatturePerMese.get(m) || [];
        
        report += `${mesi[m-1]} 25: €${tot.toFixed(2)}`;
        
        if (fatture.length > 0) {
          report += ` (${fatture.length} fatture)\n`;
          fatture.forEach(f => {
            report += `    • ${f.fornitore} - ${f.famiglia}: €${f.importo.toFixed(2)}\n`;
          });
        } else {
          report += '\n';
        }
      }
      
      report += `\n✅ TOTALE GENERALE (FATTURE): €${totaleGenerale.toFixed(2)}\n\n`;
      
      // Confronto con P&L
      const pnlHotelCosts = [
        { mese: 'gen', valore: 1271.30 },
        { mese: 'feb', valore: 0 },
        { mese: 'mar', valore: 0 },
        { mese: 'apr', valore: 2360.39 },
        { mese: 'mag', valore: 0 },
        { mese: 'giu', valore: 0 },
        { mese: 'lug', valore: 33535.10 },
        { mese: 'ago', valore: 349.60 },
        { mese: 'set', valore: 11370.24 },
        { mese: 'ott', valore: 770.00 }
      ];
      
      const totalePnL = pnlHotelCosts.reduce((sum, m) => sum + m.valore, 0);
      
      report += '📋 TOTALE P&L GENERATO: €' + totalePnL.toFixed(2) + '\n\n';
      
      report += '⚠️ DISCREPANZA:\n';
      const diff = totaleGenerale - totalePnL;
      const diffPercent = ((diff / totaleGenerale) * 100).toFixed(1);
      report += `Mancano: €${diff.toFixed(2)} (${diffPercent}% delle fatture)\n\n`;
      
      report += '💡 ANALISI MENSILE (Fatture vs P&L):\n';
      for (let m = 1; m <= 10; m++) {
        const totFatture = totaliPerMese.get(m) || 0;
        const totPnL = pnlHotelCosts[m-1].valore;
        const diffMese = totFatture - totPnL;
        
        if (Math.abs(diffMese) > 0.01) {
          report += `${mesi[m-1]}: Fatture €${totFatture.toFixed(2)} vs P&L €${totPnL.toFixed(2)} `;
          report += `→ ${diffMese > 0 ? 'MANCANO' : 'EXTRA'} €${Math.abs(diffMese).toFixed(2)}\n`;
        }
      }
      
      report += '\n🔍 POSSIBILI CAUSE:\n';
      report += '1. Filtro Anno/Mese nel P&L diverso da quello delle Fatture\n';
      report += '2. Campo Anno o Mese mancante/errato in alcune fatture\n';
      report += '3. Logica aggregazione esclude alcune famiglie\n';
      report += '4. Bug nella funzione _getAggregatedCostsBySede()\n';
      
      LOG.info('DEV_HOTEL_COMPARE', report);
      ui.alert('📊 Confronto Costi Hotel', report, ui.ButtonSet.OK);
      
    } catch (e) {
      report += `\n❌ ERRORE: ${e.message}\n`;
      LOG.error('DEV_HOTEL_COMPARE', 'Errore confronto', { error: e.message, stack: e.stack });
      ui.alert('Errore Confronto', report, ui.ButtonSet.OK);
    }
  }

  /**
   * DEV_InspectAggregatedCosts()
   * Ispeziona il risultato della funzione _getAggregatedCostsBySede() del P&L.
   * Mostra esattamente cosa viene aggregato prima del filtraggio Hotel.
   */
  function DEV_InspectAggregatedCosts() {
    LOG.info('DEV_INSPECT_AGG', '=== ISPEZIONE AGGREGAZIONE COSTI ===');
    
    const ui = SpreadsheetApp.getUi();
    let report = '🔍 ISPEZIONE AGGREGAZIONE COSTI P&L\n\n';
    
    try {
      // 1. Leggi aziendaMap
      const shAziende = SHEETS.get('Aziende');
      if (!shAziende) {
        report += '❌ Foglio "Aziende" non trovato!\n';
        ui.alert('Errore', report, ui.ButtonSet.OK);
        return;
      }
      
      const headerRowAz = SHEETS._findHeaderRow(shAziende, 'Aziende');
      const idxAz = SHEETS.headerIndex('Aziende');
      const rowsAz = shAziende.getRange(headerRowAz + 1, 1, shAziende.getLastRow() - headerRowAz, Math.max(idxAz.P_IVA_Azienda, idxAz.Nome_Sede) + 1).getValues();
      
      const pIvaToAzienda = {
        '4230940167': 'Gemma',
        '4489830986': 'Zaffiro'
      };
      
      const aziendaMap = new Map();
      rowsAz.forEach(row => {
        const pIva = String(row[idxAz.P_IVA_Azienda] || '').trim();
        const sede = String(row[idxAz.Nome_Sede] || '').trim();
        if (pIva && sede && pIvaToAzienda[pIva]) {
          aziendaMap.set(sede, pIvaToAzienda[pIva]);
        }
      });
      
      // 2. Leggi famiglie fornitori
      const shFor = SHEETS.get(SHEETS.SHEET_NAMES.Fornitori);
      if (!shFor) {
        report += '❌ Foglio "Fornitori" non trovato!\n';
        ui.alert('Errore', report, ui.ButtonSet.OK);
        return;
      }
      
      const headerRowFor = SHEETS._findHeaderRow(shFor, SHEETS.SHEET_NAMES.Fornitori);
      const idxFor = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fornitori);
      const rowsFor = shFor.getRange(headerRowFor + 1, 1, shFor.getLastRow() - headerRowFor, Math.max(idxFor.FornitoreID, idxFor.Famiglia, idxFor.Reparto ?? 0) + 1).getValues();
      
      const famiglieFornitori = new Map();
      rowsFor.forEach(r => {
        const idNorm = UTIL.normKey(r[idxFor.FornitoreID]).replace(/^0+/, '');
        if (!idNorm) return;
        const fam = String(r[idxFor.Famiglia] ?? '').trim() || 'Non Categorizzato';
        const reparto = idxFor.Reparto !== undefined ? String(r[idxFor.Reparto] ?? '').trim() : null;
        famiglieFornitori.set(idNorm, { famiglia: fam, reparto, azienda: null });
      });
      
      // 3. Aggrega manualmente (replica logica P&L)
      const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
      const headerRowF = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
      const idxF = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
      
      const lastCol = Math.max(idxF.Sede, idxF.Data, idxF.TotImponibile, idxF.FornitoreID, idxF.Reparto ?? 0) + 1;
      const rowsF = shF.getRange(headerRowF + 1, 1, shF.getLastRow() - headerRowF, lastCol).getValues();
      
      const aggregati = new Map();
      
      rowsF.forEach(r => {
        const sede = String(r[idxF.Sede] ?? 'Non Assegnata').trim() || 'Non Assegnata';
        const data = r[idxF.Data];
        if (!(data instanceof Date) || isNaN(data.getTime())) return;
        
        const anno = data.getFullYear();
        const mese = data.getMonth() + 1;
        const ym = `${anno}-${('0' + mese).slice(-2)}`;
        
        const idNorm = UTIL.normKey(r[idxF.FornitoreID]).replace(/^0+/, '');
        const infoFornitore = famiglieFornitori.get(idNorm) || { famiglia: 'Non Categorizzato', reparto: null };
        
        const repartoFattura = idxF.Reparto !== undefined ? String(r[idxF.Reparto] ?? '').trim() : null;
        const reparto = repartoFattura || infoFornitore.reparto;
        const azienda = aziendaMap.get(sede) || infoFornitore.azienda;
        const costoNetto = UTIL.parseNumSmart(r[idxF.TotImponibile]);
        
        const key = `${sede}|${ym}|${reparto}|${azienda}`;
        
        if (!aggregati.has(key)) {
          aggregati.set(key, { sede, anno, mese, reparto, azienda, costo: 0, count: 0 });
        }
        
        const curr = aggregati.get(key);
        curr.costo += costoNetto;
        curr.count++;
      });
      
      // 4. Filtra solo Hotel Gemma 2025
      report += 'AGGREGAZIONE COSTI HOTEL GEMMA 2025:\n';
      report += '(Come li vede la funzione _getAggregatedCostsBySede)\n\n';
      
      const hotelGemma2025 = Array.from(aggregati.values())
        .filter(x => x.reparto && x.reparto.toLowerCase() === 'hotel' && x.azienda === 'Gemma' && x.anno === 2025)
        .sort((a, b) => a.mese - b.mese);
      
      if (hotelGemma2025.length === 0) {
        report += '❌ NESSUN COSTO HOTEL GEMMA 2025 AGGREGATO!\n\n';
        report += '🔍 Possibili cause:\n';
        report += '1. Campo "Reparto" vuoto nelle fatture\n';
        report += '2. Campo "Azienda" non mappato correttamente\n';
        report += '3. Sede non trovata in aziendaMap\n';
      } else {
        const mesi = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
        hotelGemma2025.forEach(x => {
          report += `${mesi[x.mese-1]} 25: €${x.costo.toFixed(2)} (${x.count} fatture, Sede: ${x.sede})\n`;
        });
        
        const totale = hotelGemma2025.reduce((sum, x) => sum + x.costo, 0);
        report += `\n✅ TOTALE AGGREGATO: €${totale.toFixed(2)}\n\n`;
      }
      
      // 5. Conta fatture Hotel per debug
      const tutteLeFattureHotel = Array.from(aggregati.values())
        .filter(x => x.reparto && x.reparto.toLowerCase() === 'hotel');
      
      report += `📊 STATISTICHE COMPLESSIVE:\n`;
      report += `Totale righe aggregate: ${aggregati.size}\n`;
      report += `Fatture Hotel (tutti gli anni): ${tutteLeFattureHotel.length}\n`;
      report += `Fatture Hotel Gemma 2025: ${hotelGemma2025.length}\n`;
      
      LOG.info('DEV_INSPECT_AGG', report);
      ui.alert('🔍 Ispezione Aggregazione', report, ui.ButtonSet.OK);
      
    } catch (e) {
      report += `\n❌ ERRORE: ${e.message}\n`;
      LOG.error('DEV_INSPECT_AGG', 'Errore ispezione', { error: e.message, stack: e.stack });
      ui.alert('Errore Ispezione', report, ui.ButtonSet.OK);
    }
  }

  /**
   * DEV_DebugCostiHotelLoop()
   * Debug del loop di aggregazione costi Hotel nel P&L.
   * Verifica esattamente cosa succede nel loop alle righe 202-238 di 120_pnl.js
   */
  function DEV_DebugCostiHotelLoop() {
    LOG.info('DEV_HOTEL_LOOP', '=== DEBUG LOOP AGGREGAZIONE HOTEL ===');
    
    const ui = SpreadsheetApp.getUi();
    let report = '🐛 DEBUG LOOP AGGREGAZIONE HOTEL\n\n';
    
    try {
      // Replica esatta della logica P&L per capire il bug
      
      // 1. aziendaMap
      const shAziende = SHEETS.get('Aziende');
      const headerRowAz = SHEETS._findHeaderRow(shAziende, 'Aziende');
      const idxAz = SHEETS.headerIndex('Aziende');
      const rowsAz = shAziende.getRange(headerRowAz + 1, 1, shAziende.getLastRow() - headerRowAz, Math.max(idxAz.P_IVA_Azienda, idxAz.Nome_Sede) + 1).getValues();
      
      const pIvaToAzienda = {
        '4230940167': 'Gemma',
        '4489830986': 'Zaffiro'
      };
      
      const aziendaMap = new Map();
      rowsAz.forEach(row => {
        const pIva = String(row[idxAz.P_IVA_Azienda] || '').trim();
        const sede = String(row[idxAz.Nome_Sede] || '').trim();
        if (pIva && sede && pIvaToAzienda[pIva]) {
          aziendaMap.set(sede, pIvaToAzienda[pIva]);
        }
      });
      
      report += `✅ AZIENDA MAP:\n`;
      aziendaMap.forEach((az, sede) => {
        report += `  • "${sede}" → "${az}"\n`;
      });
      report += '\n';
      
      // 2. Leggi costiAggregati
      const shFor = SHEETS.get(SHEETS.SHEET_NAMES.Fornitori);
      const headerRowFor = SHEETS._findHeaderRow(shFor, SHEETS.SHEET_NAMES.Fornitori);
      const idxFor = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fornitori);
      const rowsFor = shFor.getRange(headerRowFor + 1, 1, shFor.getLastRow() - headerRowFor, Math.max(idxFor.FornitoreID, idxFor.Famiglia, idxFor.Reparto ?? 0) + 1).getValues();
      
      const famiglieFornitori = new Map();
      rowsFor.forEach(r => {
        const idNorm = UTIL.normKey(r[idxFor.FornitoreID]).replace(/^0+/, '');
        if (!idNorm) return;
        const fam = String(r[idxFor.Famiglia] ?? '').trim() || 'Non Categorizzato';
        const reparto = idxFor.Reparto !== undefined ? String(r[idxFor.Reparto] ?? '').trim() : null;
        famiglieFornitori.set(idNorm, { famiglia: fam, reparto, azienda: null });
      });
      
      const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
      const headerRowF = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
      const idxF = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
      
      const lastCol = Math.max(idxF.Sede, idxF.Data, idxF.TotImponibile, idxF.FornitoreID, idxF.Reparto ?? 0) + 1;
      const rowsF = shF.getRange(headerRowF + 1, 1, shF.getLastRow() - headerRowF, lastCol).getValues();
      
      const costiAggregati = new Map();
      
      rowsF.forEach(r => {
        const sede = String(r[idxF.Sede] ?? 'Non Assegnata').trim() || 'Non Assegnata';
        const data = r[idxF.Data];
        if (!(data instanceof Date) || isNaN(data.getTime())) return;
        
        const ym = `${data.getFullYear()}-${('0' + (data.getMonth() + 1)).slice(-2)}`;
        const idNorm = UTIL.normKey(r[idxF.FornitoreID]).replace(/^0+/, '');
        const infoFornitore = famiglieFornitori.get(idNorm) || { famiglia: 'Non Categorizzato', reparto: null };
        const famiglia = infoFornitore.famiglia;
        
        const repartoFattura = idxF.Reparto !== undefined ? String(r[idxF.Reparto] ?? '').trim() : null;
        const reparto = repartoFattura || infoFornitore.reparto;
        const azienda = aziendaMap.get(sede) || infoFornitore.azienda;
        const costoNetto = UTIL.parseNumSmart(r[idxF.TotImponibile]);
        
        if (!costiAggregati.has(sede)) costiAggregati.set(sede, new Map());
        const m = costiAggregati.get(sede);
        if (!m.has(ym)) m.set(ym, new Map());
        const famMap = m.get(ym);
        
        // CHIAVE: Famiglia + Reparto (come nel P&L fixato)
        const chiaveAggregazione = `${famiglia}|${reparto || 'NoReparto'}`;
        
        if (!famMap.has(chiaveAggregazione)) {
          famMap.set(chiaveAggregazione, { costoNetto: 0, reparto, azienda, famiglia });
        }
        const curr = famMap.get(chiaveAggregazione);
        curr.costoNetto += costoNetto;
        // Non sovrascrivere reparto/azienda
      });
      
      // 3. Simula il loop del P&L
      report += '🔄 SIMULAZIONE LOOP P&L (solo Hotel Gemma 2025):\n\n';
      
      const costiHotelGemma = new Map();
      costiHotelGemma.set('COSTI HOTEL', new Map());
      
      let processed = 0;
      let aggregated = 0;
      
      costiAggregati.forEach((mesi, sede) => {
        mesi.forEach((costiPerChiave, annoMese) => {
          const anno = annoMese.split('-')[0];
          if (anno !== '2025') return; // Filtra solo 2025
          
          costiPerChiave.forEach((infoFamiglia, chiaveAggregazione) => {
            const { costoNetto, reparto, azienda, famiglia } = infoFamiglia;
            
            // Replica logica P&L
            const repartoEffettivo = (azienda === 'Zaffiro') ? 'Gelateria' : reparto;
            const isHotelCheck = repartoEffettivo && String(repartoEffettivo).toLowerCase() === 'hotel';
            
            if (isHotelCheck) {
              processed++;
              report += `${annoMese} | Chiave="${chiaveAggregazione}" | Sede="${sede}" | Fam="${famiglia}" | Rep="${reparto}" | Az="${azienda}" | €${costoNetto.toFixed(2)}\n`;
              report += `  → repartoEffettivo="${repartoEffettivo}" | isHotel=${isHotelCheck}\n`;
              
              if (azienda === 'Gemma') {
                aggregated++;
                costiHotelGemma.get('COSTI HOTEL').set(annoMese, (costiHotelGemma.get('COSTI HOTEL').get(annoMese) ?? 0) + costoNetto);
                report += `  ✅ AGGREGATO in costiHotelGemma\n`;
              } else {
                report += `  ❌ NON AGGREGATO: azienda="${azienda}" (non === "Gemma")\n`;
              }
              report += '\n';
            }
          });
        });
      });
      
      report += `\n📊 RISULTATO SIMULAZIONE:\n`;
      report += `Righe Hotel 2025 processate: ${processed}\n`;
      report += `Righe aggregate in costiHotelGemma: ${aggregated}\n\n`;
      
      report += `💰 TOTALE costiHotelGemma:\n`;
      const mesi = ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'];
      let totale = 0;
      costiHotelGemma.get('COSTI HOTEL').forEach((costo, annoMese) => {
        const [anno, mese] = annoMese.split('-');
        report += `${mesi[parseInt(mese)-1]} ${anno.slice(-2)}: €${costo.toFixed(2)}\n`;
        totale += costo;
      });
      report += `\n✅ TOTALE: €${totale.toFixed(2)}\n`;
      
      LOG.info('DEV_HOTEL_LOOP', report);
      ui.alert('🐛 Debug Loop Hotel', report, ui.ButtonSet.OK);
      
    } catch (e) {
      report += `\n❌ ERRORE: ${e.message}\n`;
      LOG.error('DEV_HOTEL_LOOP', 'Errore debug loop', { error: e.message, stack: e.stack });
      ui.alert('Errore Debug', report, ui.ButtonSet.OK);
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
    DEV_ResetAllImportFlags: DEV_ResetAllImportFlags,
    DEV_DiagnoseHotelCosts: DEV_DiagnoseHotelCosts,
    DEV_CompareHotelCostsWithPnL: DEV_CompareHotelCostsWithPnL,
    DEV_InspectAggregatedCosts: DEV_InspectAggregatedCosts,
    DEV_DebugCostiHotelLoop: DEV_DebugCostiHotelLoop
  };
})();

// Registra DEBUG nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('DEBUG', ['SHEETS', 'LOG', 'UTIL', 'STATE', 'CONFIG', 'DUPLICATE_MANAGER', 'SHEET_ITERATOR', 'ERROR_HANDLER']);
}

// Registra DEBUG nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('DEBUG', DEBUG);
}