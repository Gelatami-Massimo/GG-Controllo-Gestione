// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 031_sheet_iterator.js
// VERSIONE: 26.0 (Sheet Iterator Utility)
// DESCRIZIONE: Utility per iterazione batch su fogli Google Sheets.
//              Elimina pattern duplicato "itera + processa righe".
//              Gestione automatica: header, validazione, chunking, errori.
// =============================================================

/**
 * SHEET_ITERATOR Module
 * 
 * Fornisce API high-level per iterare su fogli Google Sheets con:
 * - Chunking automatico per performance
 * - Validazione colonne richieste
 * - Skip righe vuote
 * - Error handling per singola riga
 * - Callback progresso
 * - Operazioni map/reduce/filter
 * 
 * ELIMINA PATTERN DUPLICATO TROVATO IN:
 * - 060_import_headers.js (linee 450-520)
 * - 070_import_rows.js (linee 280-350)
 * - 090_dashboard.js (linee 180-250)
 * - 100_reporting.js (linee 320-380)
 * - 110_warehouse.js (linee 150-220)
 * - 120_pnl.js (linee 120-180)
 * - 130_debug.js (linee 460-520, 780-840)
 * 
 * USAGE:
 *   const result = SHEET_ITERATOR.forEach('Fatture', {
 *     columns: ['FileID', 'NumeroDoc', 'Data'],
 *     processor: (row, rowNum, idx) => {
 *       const fileId = row[idx.FileID];
 *       // ... logica ...
 *     }
 *   });
 * 
 * DEPENDENCIES: SHEETS, LOG, CONSTANTS
 * VERSION: 26.0
 */
const SHEET_ITERATOR = (function() {
  'use strict';

  // ============================================================================
  // PUBLIC API: forEach
  // ============================================================================

  /**
   * Itera su tutte le righe di un foglio con callback processor.
   * Gestisce automaticamente: header, chunking, validazione, errori.
   * 
   * @param {string} sheetName - Nome foglio da SHEETS.SHEET_NAMES
   * @param {Object} options - Configurazione iterazione
   * @param {Array<string>} options.columns - Colonne richieste (es: ['FileID', 'NumeroDoc'])
   * @param {Function} options.processor - Callback per ogni riga: (row, rowNum, idx) => {}
   * @param {number} [options.batchSize] - Dimensione chunk (default: 500)
   * @param {boolean} [options.skipEmpty] - Skippa righe vuote (default: true)
   * @param {Function} [options.onProgress] - Callback progresso: (current, total) => {}
   * @param {Function} [options.onError] - Callback errore: (error, rowNum) => {}
   * @param {boolean} [options.stopOnError] - Ferma iterazione al primo errore (default: false)
   * 
   * @returns {{processed: number, skipped: number, errors: number, errorDetails: Array}}
   * 
   * @throws {Error} Se sheetName non valido o processor mancante
   * 
   * @example
   * // Itera Fatture e processa FileID
   * const result = SHEET_ITERATOR.forEach('Fatture', {
   *   columns: ['FileID', 'NumeroDoc', 'Data'],
   *   processor: (row, rowNum, idx) => {
   *     const fileId = row[idx.FileID];
   *     processInvoice(fileId);
   *   },
   *   onProgress: (curr, tot) => console.log(`${curr}/${tot}`)
   * });
   * // => { processed: 850, skipped: 12, errors: 3 }
   */
  function forEach(sheetName, options = {}) {
    // Validazione input
    _validateForEachOptions(sheetName, options);

    const {
      columns = [],
      processor,
      batchSize = CONSTANTS.BATCH_LIMITS.READ_CHUNK_SIZE,
      skipEmpty = true,
      onProgress = null,
      onError = null,
      stopOnError = false
    } = options;

    // Setup foglio e indici
    const context = _setupSheetContext(sheetName, columns);
    if (!context) {
      // Foglio vuoto o non trovato, già loggato
      return { processed: 0, skipped: 0, errors: 0, errorDetails: [] };
    }

    const { sheet, headerRow, idx, lastRow, maxCol } = context;
    const result = { processed: 0, skipped: 0, errors: 0, errorDetails: [] };

    // Itera in chunk per memoria efficiente
    let currentRow = headerRow + 1;
    const totalRows = lastRow - headerRow;

    while (currentRow <= lastRow) {
      const chunkRows = Math.min(batchSize, lastRow - currentRow + 1);
      
      // Lettura chunk batch
      let chunk;
      try {
        chunk = sheet.getRange(currentRow, 1, chunkRows, maxCol).getValues();
      } catch (e) {
        LOG?.error('SHEET_ITERATOR', `Errore lettura chunk riga ${currentRow}`, {
          sheet: sheetName,
          error: e.message
        });
        
        // Skip chunk e continua (non bloccare tutto per 1 chunk corrotto)
        currentRow += chunkRows;
        result.errors += chunkRows;
        continue;
      }

      // Processa ogni riga del chunk
      for (let i = 0; i < chunk.length; i++) {
        const row = chunk[i];
        const rowNum = currentRow + i;

        // Skip righe vuote se richiesto
        if (skipEmpty && _isRowEmpty(row, columns, idx)) {
          result.skipped++;
          continue;
        }

        // Processa riga con error handling
        try {
          processor(row, rowNum, idx);
          result.processed++;

          // Callback progresso ogni N righe (configurable)
          if (onProgress && result.processed % CONSTANTS.UI_UPDATE_FREQUENCY.PROGRESS_BAR === 0) {
            onProgress(result.processed, totalRows);
          }
        } catch (e) {
          result.errors++;
          
          const errorDetail = {
            rowNum: rowNum,
            error: e.message,
            stack: e.stack
          };
          result.errorDetails.push(errorDetail);

          LOG?.error('SHEET_ITERATOR', `Errore processing riga ${rowNum}`, {
            sheet: sheetName,
            error: e.message,
            stack: e.stack
          });

          // Callback errore personalizzato
          if (onError) {
            try {
              onError(e, rowNum, row, idx);
            } catch (cbError) {
              LOG?.warn('SHEET_ITERATOR', 'Error in onError callback', {
                error: cbError.message
              });
            }
          }

          // Stop su errore se richiesto
          if (stopOnError) {
            LOG?.warn('SHEET_ITERATOR', `Stopped at row ${rowNum} due to error (stopOnError=true)`);
            return result;
          }
        }
      }

      currentRow += chunkRows;
    }

    // Progresso finale (100%)
    if (onProgress) {
      onProgress(result.processed, totalRows);
    }

    LOG?.info('SHEET_ITERATOR', `Completed iteration on ${sheetName}`, {
      processed: result.processed,
      skipped: result.skipped,
      errors: result.errors
    });

    return result;
  }

  // ============================================================================
  // PUBLIC API: map
  // ============================================================================

  /**
   * Map operation: trasforma righe foglio in array risultati.
   * Come Array.map() ma su Google Sheet.
   * 
   * @param {string} sheetName - Nome foglio
   * @param {Object} options - Configurazione (come forEach + mapper)
   * @param {Function} options.mapper - Function(row, rowNum, idx) che ritorna valore mappato
   * 
   * @returns {Array} Array di risultati dalla mapper function
   * 
   * @example
   * // Estrai tutti i FileID dal foglio Fatture
   * const fileIds = SHEET_ITERATOR.map('Fatture', {
   *   columns: ['FileID'],
   *   mapper: (row, rowNum, idx) => row[idx.FileID]
   * });
   * // => ['fileId1', 'fileId2', 'fileId3', ...]
   */
  function map(sheetName, options = {}) {
    if (!options.mapper || typeof options.mapper !== 'function') {
      throw new Error('SHEET_ITERATOR.map requires "mapper" function in options');
    }

    const results = [];
    const mapper = options.mapper;
    
    // Sostituisci mapper con processor che accumula risultati
    options.processor = (row, rowNum, idx) => {
      const result = mapper(row, rowNum, idx);
      if (result !== undefined) {
        results.push(result);
      }
    };

    // Remove mapper from options (non serve a forEach)
    delete options.mapper;

    forEach(sheetName, options);
    return results;
  }

  // ============================================================================
  // PUBLIC API: filter
  // ============================================================================

  /**
   * Filter operation: filtra righe foglio secondo predicato.
   * Come Array.filter() ma su Google Sheet.
   * 
   * @param {string} sheetName - Nome foglio
   * @param {Object} options - Configurazione (come forEach + predicate)
   * @param {Function} options.predicate - Function(row, rowNum, idx) che ritorna boolean
   * 
   * @returns {Array<{row: Array, rowNum: number}>} Array di righe che passano filtro
   * 
   * @example
   * // Trova tutte le fatture del 2024
   * const fatture2024 = SHEET_ITERATOR.filter('Fatture', {
   *   columns: ['Anno', 'NumeroDoc'],
   *   predicate: (row, rowNum, idx) => row[idx.Anno] === '2024'
   * });
   */
  function filter(sheetName, options = {}) {
    if (!options.predicate || typeof options.predicate !== 'function') {
      throw new Error('SHEET_ITERATOR.filter requires "predicate" function in options');
    }

    const results = [];
    const predicate = options.predicate;
    
    options.processor = (row, rowNum, idx) => {
      if (predicate(row, rowNum, idx)) {
        results.push({ row: row, rowNum: rowNum });
      }
    };

    delete options.predicate;

    forEach(sheetName, options);
    return results;
  }

  // ============================================================================
  // PUBLIC API: reduce
  // ============================================================================

  /**
   * Reduce operation: aggrega dati foglio in singolo valore.
   * Come Array.reduce() ma su Google Sheet.
   * 
   * @param {string} sheetName - Nome foglio
   * @param {Function} reducer - Function(accumulator, row, rowNum, idx) che ritorna nuovo accumulator
   * @param {*} initialValue - Valore iniziale accumulatore
   * @param {Object} options - Configurazione (columns, batchSize, etc.)
   * 
   * @returns {*} Valore accumulato finale
   * 
   * @example
   * // Calcola totale importi fatture
   * const totalAmount = SHEET_ITERATOR.reduce('Fatture', 
   *   (sum, row, rowNum, idx) => sum + (row[idx.TotImponibile] || 0),
   *   0,
   *   { columns: ['TotImponibile'] }
   * );
   * // => 125430.50
   */
  function reduce(sheetName, reducer, initialValue, options = {}) {
    if (!reducer || typeof reducer !== 'function') {
      throw new Error('SHEET_ITERATOR.reduce requires "reducer" function');
    }

    let accumulator = initialValue;
    
    options.processor = (row, rowNum, idx) => {
      accumulator = reducer(accumulator, row, rowNum, idx);
    };

    forEach(sheetName, options);
    return accumulator;
  }

  // ============================================================================
  // PUBLIC API: count
  // ============================================================================

  /**
   * Conta righe che soddisfano condizione.
   * Shortcut per reduce con contatore.
   * 
   * @param {string} sheetName - Nome foglio
   * @param {Object} options - Configurazione
   * @param {Function} options.predicate - Function(row, rowNum, idx) che ritorna boolean
   * 
   * @returns {number} Numero righe che soddisfano predicato
   * 
   * @example
   * // Conta fatture 2024
   * const count2024 = SHEET_ITERATOR.count('Fatture', {
   *   columns: ['Anno'],
   *   predicate: (row, rowNum, idx) => row[idx.Anno] === '2024'
   * });
   */
  function count(sheetName, options = {}) {
    if (!options.predicate) {
      // No predicato = conta tutte le righe non vuote
      options.predicate = () => true;
    }

    return reduce(
      sheetName,
      (acc, row, rowNum, idx) => {
        return options.predicate(row, rowNum, idx) ? acc + 1 : acc;
      },
      0,
      options
    );
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Valida opzioni forEach
   * @private
   */
  function _validateForEachOptions(sheetName, options) {
    if (!sheetName || typeof sheetName !== 'string') {
      throw new Error('SHEET_ITERATOR: sheetName must be a non-empty string');
    }

    if (!SHEETS.SHEET_NAMES[sheetName]) {
      throw new Error(`SHEET_ITERATOR: unknown sheet name "${sheetName}". Must be one of SHEETS.SHEET_NAMES`);
    }

    if (!options.processor || typeof options.processor !== 'function') {
      throw new Error('SHEET_ITERATOR: "processor" function is required in options');
    }

    if (options.columns && !Array.isArray(options.columns)) {
      throw new Error('SHEET_ITERATOR: "columns" must be an array');
    }
  }

  /**
   * Setup contesto foglio: sheet, header, indici, validazione
   * @private
   */
  function _setupSheetContext(sheetName, columns) {
    const sheet = SHEETS.get(SHEETS.SHEET_NAMES[sheetName]);
    
    if (!sheet) {
      LOG?.error('SHEET_ITERATOR', `Sheet "${sheetName}" not found`);
      return null;
    }

    const headerRow = SHEETS._findHeaderRow(sheet, SHEETS.SHEET_NAMES[sheetName]);
    const lastRow = sheet.getLastRow();

    // Foglio vuoto
    if (lastRow < headerRow + 1) {
      LOG?.info('SHEET_ITERATOR', `Sheet "${sheetName}" is empty, skipping`);
      return null;
    }

    const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES[sheetName]);

    // Validazione colonne richieste
    if (columns && columns.length > 0) {
      const missingCols = columns.filter(col => idx[col] === undefined);
      if (missingCols.length > 0) {
        throw new Error(
          `SHEET_ITERATOR: Missing columns in ${sheetName}: ${missingCols.join(', ')}`
        );
      }
    }

    // Calcola range minimo necessario (ottimizzazione)
    let maxCol;
    if (columns && columns.length > 0) {
      const colIndices = columns.map(col => idx[col]);
      maxCol = Math.max(...colIndices) + 1;
    } else {
      // Nessuna colonna specificata = leggi tutte
      maxCol = sheet.getLastColumn();
    }

    return {
      sheet: sheet,
      headerRow: headerRow,
      idx: idx,
      lastRow: lastRow,
      maxCol: maxCol
    };
  }

  /**
   * Verifica se riga è vuota (tutti i campi richiesti sono vuoti)
   * @private
   */
  function _isRowEmpty(row, columns, idx) {
    if (!columns || columns.length === 0) {
      // No colonne specificate = verifica se TUTTA la riga è vuota
      return row.every(cell => !cell || String(cell).trim() === '');
    }
    
    // Verifica solo colonne richieste
    return columns.every(col => {
      const value = row[idx[col]];
      return !value || String(value).trim() === '';
    });
  }

  // ============================================================================
  // PUBLIC API: forEachChunk (Advanced iteration with timeout and cursor)
  // ============================================================================

  /**
   * Itera su righe con gestione avanzata: timeout, cursor, progress tracking.
   * Usato per operazioni lunghe che potrebbero superare il limite di esecuzione.
   * 
   * @param {Object} options - Configurazione avanzata
   * @param {GoogleAppsScript.Spreadsheet.Sheet} options.sheet - Oggetto Sheet
   * @param {string} options.sheetName - Nome foglio (per logging)
   * @param {number} options.startRow - Riga iniziale (1-based, dopo header)
   * @param {number} options.endRow - Riga finale (1-based)
   * @param {number} [options.batchSize] - Dimensione chunk (default: 100)
   * @param {number} [options.maxColumns] - Numero max colonne da leggere
   * @param {string} [options.cursorKey] - Chiave STATE per salvare progresso
   * @param {number} [options.maxRuntimeSec] - Timeout in secondi (default: 240)
   * @param {Function} options.onTimeout - Callback eseguito prima di timeout
   * @param {Function} options.processChunk - Callback: (chunk, chunkStartRow) => {}
   * 
   * @returns {{processed: number, interrupted: boolean, lastRow: number}}
   * 
   * @example
   * const result = SHEET_ITERATOR.forEachChunk({
   *   sheet: shFatture,
   *   sheetName: 'Fatture',
   *   startRow: 2,
   *   endRow: 1000,
   *   batchSize: 100,
   *   maxColumns: 25,
   *   cursorKey: 'import_cursor',
   *   maxRuntimeSec: 240,
   *   onTimeout: () => { saveState(); },
   *   processChunk: (chunk, startRow) => {
   *     chunk.forEach((row, i) => processRow(row, startRow + i));
   *   }
   * });
   * if (result.interrupted) return; // Handle timeout
   */
  function forEachChunk(options = {}) {
    const {
      sheet,
      sheetName,
      startRow,
      endRow,
      batchSize = 100,
      maxColumns,
      cursorKey = null,
      maxRuntimeSec = 240,
      onTimeout = null,
      processChunk
    } = options;

    // Validazione
    if (!sheet || !processChunk) {
      throw new Error('SHEET_ITERATOR.forEachChunk: sheet and processChunk are required');
    }

    const startTime = Date.now();
    const maxRuntimeMs = maxRuntimeSec * 1000;
    let currentRow = startRow;
    let processed = 0;
    let interrupted = false;

    while (currentRow <= endRow) {
      // Check timeout
      const elapsed = Date.now() - startTime;
      if (elapsed > maxRuntimeMs - 10000) { // Safety margin: 10s before timeout
        interrupted = true;
        
        // Save cursor if provided
        if (cursorKey && typeof STATE !== 'undefined') {
          STATE.setJSON(cursorKey, { nextRow: currentRow });
          LOG?.info('SHEET_ITERATOR', `Timeout: salvato cursor a riga ${currentRow}`, {
            sheet: sheetName,
            elapsed: (elapsed / 1000).toFixed(1) + 's'
          });
        }
        
        // Execute timeout callback
        if (onTimeout) {
          try {
            onTimeout();
          } catch (e) {
            LOG?.error('SHEET_ITERATOR', 'Errore in onTimeout callback', {
              error: e.message
            });
          }
        }
        
        break;
      }

      // Calculate chunk size
      const chunkRows = Math.min(batchSize, endRow - currentRow + 1);
      const cols = maxColumns || sheet.getLastColumn();

      // Read chunk
      let chunk;
      try {
        chunk = sheet.getRange(currentRow, 1, chunkRows, cols).getValues();
      } catch (e) {
        LOG?.error('SHEET_ITERATOR', `Errore lettura chunk riga ${currentRow}`, {
          sheet: sheetName,
          error: e.message
        });
        // Skip chunk and continue
        currentRow += chunkRows;
        continue;
      }

      // Process chunk
      try {
        processChunk(chunk, currentRow);
        processed += chunk.length;
      } catch (e) {
        LOG?.error('SHEET_ITERATOR', `Errore processChunk riga ${currentRow}`, {
          sheet: sheetName,
          error: e.message,
          stack: e.stack
        });
        // Continue with next chunk
      }

      currentRow += chunkRows;
    }

    // Clear cursor if completed
    if (!interrupted && cursorKey && typeof STATE !== 'undefined') {
      STATE.clear(cursorKey);
    }

    return {
      processed: processed,
      interrupted: interrupted,
      lastRow: currentRow - 1
    };
  }

  // ============================================================================
  // PUBLIC API OBJECT
  // ============================================================================

  return {
    forEach: forEach,
    forEachChunk: forEachChunk,
    map: map,
    filter: filter,
    reduce: reduce,
    count: count
  };
})();

// =============================================================
// MODULE REGISTRATION
// =============================================================

if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('SHEET_ITERATOR', ['SHEETS', 'LOG', 'CONSTANTS']);
}

if (typeof GG !== 'undefined') {
  GG.register('SHEET_ITERATOR', SHEET_ITERATOR);
}
