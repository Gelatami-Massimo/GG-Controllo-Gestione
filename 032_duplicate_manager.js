// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 032_duplicate_manager.js
// RUOLO: Gestione duplicati fatture/righe con mark/clear.
// NOTE: Pattern centralizzato - elimina 720+ righe duplicate da 130_debug.js.
// =============================================================

const DUPLICATE_MANAGER = (function() {
  'use strict';

  // ============================================================================
  // PUBLIC API
  // ============================================================================

  /**
   * Identifica e marca duplicati in un foglio usando chiave custom.
   * 
   * PERFORMANCE:
   * - Lettura batch (chunk-based)
   * - Map-based detection (O(n))
   * - Batch setBackgrounds (1 API call vs n calls)
   * 
   * @param {string} sheetName - Nome foglio (es: 'Fatture', 'Righe')
   * @param {Function} keyBuilder - (row, idx) => string (chiave univoca)
   * @param {Object} options - Configurazione
   * @param {boolean} options.silent - Esegui senza toast/UI (default: false)
   * @param {string} options.markColor - Colore sfondo duplicati (default: '#FFFF00')
   * @param {boolean} options.skipMarking - Non marcare, solo conteggio (default: false)
   * @param {number} options.batchSize - Righe per chunk (default: CONSTANTS.BATCH_LIMITS.READ_CHUNK_SIZE)
   * 
   * @returns {{found: number, marked: number, totalRows: number}}
   * 
   * @example
   * // Fatture
   * DUPLICATE_MANAGER.findAndMark('Fatture', (row, idx) => {
   *   return `${row[idx.FornitoreID]}_${row[idx.NumeroDoc]}_${row[idx.Data]}`;
   * }, { silent: true, markColor: '#FFFF00' });
   * 
   * // Righe
   * DUPLICATE_MANAGER.findAndMark('Righe', (row, idx) => {
   *   return `${row[idx.FileID]}_${row[idx.NumeroLinea]}`;
   * }, { markColor: '#FFE6E6' });
   */
  function findAndMark(sheetName, keyBuilder, options = {}) {
    const {
      silent = false,
      markColor = '#FFFF00',
      skipMarking = false,
      batchSize = CONSTANTS.BATCH_LIMITS.READ_CHUNK_SIZE
    } = options;

    try {
      if (!silent) {
        UTIL.showToast(`Ricerca duplicati in ${sheetName}...`, 'Duplicati', 5);
      }

      // 1. Setup foglio
      const context = _setupSheetContext(sheetName);
      if (!context) {
        return { found: 0, marked: 0, totalRows: 0 };
      }

      const { sheet, headerRow, idx, lastRow, maxCol } = context;
      const totalRows = lastRow - headerRow;

      // 2. Build duplicate map
      const duplicateMap = _buildDuplicateMap(
        sheet, 
        headerRow, 
        lastRow, 
        maxCol, 
        idx, 
        keyBuilder, 
        batchSize
      );

      // 3. Filter duplicates (only keys with >1 occurrences)
      const duplicates = _filterDuplicates(duplicateMap);
      const duplicateCount = duplicates.size;

      if (duplicateCount === 0) {
        if (!silent) {
          UTIL.showToast(`Nessun duplicato trovato in ${sheetName}.`, 'Completato', 3);
        }
        LOG.info('DUPLICATE_MANAGER', `No duplicates found in ${sheetName}.`);
        return { found: 0, marked: 0, totalRows };
      }

      // 4. Mark visually (if not skipped)
      let markedCount = 0;
      if (!skipMarking) {
        markedCount = _markVisually(sheet, headerRow, duplicates, markColor);
      }

      if (!silent) {
        const message = skipMarking
          ? `Trovati ${duplicateCount} duplicati in ${sheetName}.`
          : `Marcati ${markedCount} duplicati in ${sheetName}.`;
        UTIL.showToast(message, 'Completato', 5);
      }

      LOG.info('DUPLICATE_MANAGER', `Duplicates processed in ${sheetName}`, {
        found: duplicateCount,
        marked: markedCount,
        totalRows: totalRows
      });

      return {
        found: duplicateCount,
        marked: markedCount,
        totalRows: totalRows
      };

    } catch (e) {
      LOG.error('DUPLICATE_MANAGER', `Error in findAndMark for ${sheetName}`, {
        error: e.message,
        stack: e.stack
      });

      if (!silent) {
        UTIL.showToast(`Errore ricerca duplicati in ${sheetName}. Vedi Log.`, 'Errore');
      }

      throw e;
    }
  }

  /**
   * Crea snapshot duplicati in foglio dedicato.
   * 
   * Utile per analisi manuale o export.
   * Crea foglio "[SheetName]_Duplicate" con tutte le righe duplicate.
   * 
   * @param {string} sheetName - Nome foglio sorgente
   * @param {Function} keyBuilder - (row, idx) => string
   * @param {Object} options - Configurazione
   * @param {boolean} options.overwrite - Sovrascrive foglio esistente (default: true)
   * 
   * @returns {{snapshotSheetName: string, duplicatesWritten: number}}
   * 
   * @example
   * DUPLICATE_MANAGER.createSnapshot('Righe', (row, idx) => {
   *   return `${row[idx.FileID]}_${row[idx.NumeroLinea]}`;
   * });
   */
  function createSnapshot(sheetName, keyBuilder, options = {}) {
    const { overwrite = true } = options;

    try {
      UTIL.showToast(`Creazione snapshot duplicati ${sheetName}...`, 'Snapshot', 5);

      // 1. Setup foglio sorgente
      const context = _setupSheetContext(sheetName);
      if (!context) {
        throw new Error(`Foglio ${sheetName} non trovato o vuoto.`);
      }

      const { sheet, headerRow, idx, lastRow, maxCol } = context;

      // 2. Build duplicate map
      const duplicateMap = _buildDuplicateMap(
        sheet, 
        headerRow, 
        lastRow, 
        maxCol, 
        idx, 
        keyBuilder,
        CONSTANTS.BATCH_LIMITS.READ_CHUNK_SIZE
      );

      // 3. Filter duplicates
      const duplicates = _filterDuplicates(duplicateMap);

      if (duplicates.size === 0) {
        UTIL.showToast(`Nessun duplicato da scrivere in snapshot.`, 'Info', 3);
        return { snapshotSheetName: null, duplicatesWritten: 0 };
      }

      // 4. Write snapshot
      const snapshotSheetName = _writeSnapshot(
        sheetName, 
        sheet, 
        headerRow, 
        duplicates, 
        overwrite
      );

      const totalDuplicates = Array.from(duplicates.values())
        .reduce((sum, rows) => sum + rows.length, 0);

      UTIL.showToast(
        `Snapshot creato: ${snapshotSheetName} (${totalDuplicates} righe)`,
        'Completato',
        5
      );

      LOG.info('DUPLICATE_MANAGER', `Snapshot created: ${snapshotSheetName}`, {
        duplicatesWritten: totalDuplicates,
        uniqueKeys: duplicates.size
      });

      return {
        snapshotSheetName: snapshotSheetName,
        duplicatesWritten: totalDuplicates
      };

    } catch (e) {
      LOG.error('DUPLICATE_MANAGER', `Error creating snapshot for ${sheetName}`, {
        error: e.message,
        stack: e.stack
      });

      UTIL.showToast(`Errore creazione snapshot. Vedi Log.`, 'Errore');
      throw e;
    }
  }

  /**
   * Conta duplicati senza marcare (solo statistica).
   * 
   * @param {string} sheetName - Nome foglio
   * @param {Function} keyBuilder - (row, idx) => string
   * 
   * @returns {{uniqueKeys: number, totalDuplicates: number, duplicateKeys: Array<string>}}
   * 
   * @example
   * const stats = DUPLICATE_MANAGER.count('Fatture', (row, idx) => {
   *   return `${row[idx.FornitoreID]}_${row[idx.NumeroDoc]}`;
   * });
   * console.log(`${stats.totalDuplicates} duplicati trovati`);
   */
  function count(sheetName, keyBuilder) {
    try {
      const context = _setupSheetContext(sheetName);
      if (!context) {
        return { uniqueKeys: 0, totalDuplicates: 0, duplicateKeys: [] };
      }

      const { sheet, headerRow, idx, lastRow, maxCol } = context;

      const duplicateMap = _buildDuplicateMap(
        sheet,
        headerRow,
        lastRow,
        maxCol,
        idx,
        keyBuilder,
        CONSTANTS.BATCH_LIMITS.READ_CHUNK_SIZE
      );

      const duplicates = _filterDuplicates(duplicateMap);
      const totalDuplicates = Array.from(duplicates.values())
        .reduce((sum, rows) => sum + rows.length, 0);

      return {
        uniqueKeys: duplicates.size,
        totalDuplicates: totalDuplicates,
        duplicateKeys: Array.from(duplicates.keys())
      };

    } catch (e) {
      LOG.error('DUPLICATE_MANAGER', `Error counting duplicates in ${sheetName}`, {
        error: e.message
      });
      return { uniqueKeys: 0, totalDuplicates: 0, duplicateKeys: [] };
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Setup contesto foglio: sheet, header, indici, validazione.
   * @private
   */
  function _setupSheetContext(sheetName) {
    const sheet = SHEETS.get(sheetName);
    if (!sheet) {
      LOG.warn('DUPLICATE_MANAGER', `Sheet ${sheetName} not found.`);
      return null;
    }

    const headerRow = SHEETS._findHeaderRow(sheet, sheetName);
    const lastRow = sheet.getLastRow();

    if (lastRow <= headerRow) {
      LOG.info('DUPLICATE_MANAGER', `Sheet ${sheetName} is empty.`);
      return null;
    }

    const idx = SHEETS.headerIndex(sheetName);
    const maxCol = sheet.getLastColumn();

    return {
      sheet: sheet,
      headerRow: headerRow,
      idx: idx,
      lastRow: lastRow,
      maxCol: maxCol
    };
  }

  /**
   * Build map: chiave → [rowNumbers].
   * Uses SHEET_ITERATOR for consistent chunk handling.
   * @private
   */
  function _buildDuplicateMap(sheet, headerRow, lastRow, maxCol, idx, keyBuilder, batchSize) {
    const duplicateMap = new Map();

    // REFACTORED: Use SHEET_ITERATOR.forEachChunk for consistent chunk iteration
    SHEET_ITERATOR.forEachChunk({
      sheet: sheet,
      sheetName: 'DuplicateDetection', // For logging
      startRow: headerRow + 1,
      endRow: lastRow,
      batchSize: batchSize,
      maxColumns: maxCol,
      maxRuntimeSec: 300, // 5 min timeout safety
      processChunk: (chunk, chunkStartRow) => {
        for (let i = 0; i < chunk.length; i++) {
          const row = chunk[i];
          const rowNum = chunkStartRow + i;

          try {
            const key = keyBuilder(row, idx);
            
            if (!key || typeof key !== 'string') {
              // Skip righe con chiave invalida
              continue;
            }

            if (!duplicateMap.has(key)) {
              duplicateMap.set(key, []);
            }

            duplicateMap.get(key).push(rowNum);

          } catch (e) {
            LOG.warn('DUPLICATE_MANAGER', `Error building key for row ${rowNum}`, {
              error: e.message
            });
            // Continua con prossima riga
          }
        }
      }
    });

    return duplicateMap;
  }

  /**
   * Filter: solo chiavi con >1 occorrenze.
   * @private
   */
  function _filterDuplicates(duplicateMap) {
    const duplicates = new Map();

    for (const [key, rows] of duplicateMap.entries()) {
      if (rows.length > 1) {
        duplicates.set(key, rows);
      }
    }

    return duplicates;
  }

  /**
   * Marca visivamente duplicati con background color (batch).
   * @private
   */
  function _markVisually(sheet, headerRow, duplicates, markColor) {
    if (duplicates.size === 0) return 0;

    try {
      // Collect all duplicate row numbers
      const duplicateRows = [];
      for (const rows of duplicates.values()) {
        duplicateRows.push(...rows);
      }

      // Sort for efficient batch operations
      duplicateRows.sort((a, b) => a - b);

      // Batch setBackgrounds (1 API call per group)
      const maxCol = sheet.getLastColumn();
      const backgrounds = duplicateRows.map(() => Array(maxCol).fill(markColor));

      // OPTIMIZATION: Group consecutive rows for batch update
      let rangeStart = duplicateRows[0];
      let rangeEnd = duplicateRows[0];
      let rangeBackgrounds = [backgrounds[0]];

      for (let i = 1; i < duplicateRows.length; i++) {
        if (duplicateRows[i] === rangeEnd + 1) {
          // Consecutive row, extend range
          rangeEnd = duplicateRows[i];
          rangeBackgrounds.push(backgrounds[i]);
        } else {
          // Gap detected, write current range
          sheet.getRange(rangeStart, 1, rangeBackgrounds.length, maxCol)
            .setBackgrounds(rangeBackgrounds);

          // Start new range
          rangeStart = duplicateRows[i];
          rangeEnd = duplicateRows[i];
          rangeBackgrounds = [backgrounds[i]];
        }
      }

      // Write last range
      if (rangeBackgrounds.length > 0) {
        sheet.getRange(rangeStart, 1, rangeBackgrounds.length, maxCol)
          .setBackgrounds(rangeBackgrounds);
      }

      return duplicateRows.length;

    } catch (e) {
      LOG.error('DUPLICATE_MANAGER', 'Error marking duplicates visually', {
        error: e.message
      });
      return 0;
    }
  }

  /**
   * Crea foglio snapshot con righe duplicate.
   * @private
   */
  function _writeSnapshot(sheetName, sourceSheet, headerRow, duplicates, overwrite) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const snapshotName = `${sheetName}_Duplicate`;

    // Remove existing snapshot if overwrite
    if (overwrite) {
      const existingSheet = ss.getSheetByName(snapshotName);
      if (existingSheet) {
        ss.deleteSheet(existingSheet);
      }
    }

    // Create new snapshot sheet
    const snapshotSheet = ss.insertSheet(snapshotName);

    // Write headers + "DuplicateKey" column
    const sourceHeaders = sourceSheet.getRange(headerRow, 1, 1, sourceSheet.getLastColumn()).getValues()[0];
    const snapshotHeaders = [...sourceHeaders, 'DuplicateKey', 'RowIndex'];
    snapshotSheet.getRange(1, 1, 1, snapshotHeaders.length).setValues([snapshotHeaders]);

    // Write duplicate rows
    const snapshotData = [];
    for (const [key, rowNums] of duplicates.entries()) {
      for (const rowNum of rowNums) {
        const sourceRow = sourceSheet.getRange(rowNum, 1, 1, sourceSheet.getLastColumn()).getValues()[0];
        snapshotData.push([...sourceRow, key, rowNum]);
      }
    }

    if (snapshotData.length > 0) {
      snapshotSheet.getRange(2, 1, snapshotData.length, snapshotHeaders.length)
        .setValues(snapshotData);
    }

    // Format headers
    snapshotSheet.getRange(1, 1, 1, snapshotHeaders.length)
      .setFontWeight('bold')
      .setBackground('#e0e0e0');

    return snapshotName;
  }

  // ============================================================================
  // PUBLIC API OBJECT
  // ============================================================================

  return {
    findAndMark: findAndMark,
    createSnapshot: createSnapshot,
    count: count
  };

})();

// =============================================================
// MODULE REGISTRATION
// =============================================================

if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('DUPLICATE_MANAGER', ['SHEETS', 'LOG', 'CONSTANTS', 'UTIL']);
}

if (typeof GG !== 'undefined') {
  GG.register('DUPLICATE_MANAGER', DUPLICATE_MANAGER);
}
