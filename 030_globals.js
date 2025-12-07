// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 030_globals.js
// RUOLO: Globals - LOG, UTIL (core operations), XMLSAFE, STATE.
// NOTE: Utility generiche MIGRATE a 018_shared_utils.js per separazione Dati/Logica.
//       Qui rimangono solo: infrastruttura core, operations specifiche (XML, batch, Drive).
// =============================================================

/** Namespace FatturaPA (default v1.2 con fallback v1.0) */
const FPA_NS = XmlService.getNamespace('', 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2');
const FPA_NS10 = XmlService.getNamespace('', 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.0');

/**
 * Mostra una finestra di dialogo modale (popup) nella UI del foglio.
 * Funzione globale per evitare problemi di caricamento con UTIL.
 * 
 * @param {string} title - Titolo della finestra
 * @param {string} message - Messaggio da visualizzare (supporta \n per newline)
 * @returns {void}
 */
function showModalDialog(title, message) {
  try {
    const ui = SpreadsheetApp.getUi();
    // Sostituisce i newline (\n) con <br> per l'HTML
    const htmlMessage = `<p>${message.replace(/\n/g, '<br>')}</p>`;
    ui.showModalDialog(HtmlService.createHtmlOutput(htmlMessage).setWidth(400).setHeight(250), title);
  } catch (e) {
    // Fallback a un alert semplice se la UI non è disponibile
    try {
      SpreadsheetApp.getUi().alert(`${title}\n\n${message}`);
    } catch (e2) {
      console.error(`[showModalDialog FAIL] Impossibile mostrare UI. Titolo: ${title}, Msg: ${message}`, { error: e.message, fallbackError: e2.message });
    }
  }
}

const LOG = (function () {
  const logBuffer = [];
  const MAX_BUFFER_SIZE = 100;

  function _flush() {
    if (logBuffer.length === 0) return;
    try {
      const sh = SHEETS.get(SHEETS.SHEET_NAMES.Log);
      if (!sh) {
        console.error('[LOG FLUSH FAIL] Foglio Log non trovato.');
        return;
      }
      const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Log);
      const numCols = 6; // Schema Log: [Timestamp, RunId, Scope, Level, Message, Context]
      const nextRow = Math.max(headerRow + 1, sh.getLastRow() + 1);

      const rangeToWrite = sh.getRange(nextRow, 1, logBuffer.length, numCols);
      rangeToWrite.setValues(logBuffer);
      
      sh.getRange(nextRow, 1, logBuffer.length, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
      
      logBuffer.length = 0;
    } catch (e) {
      console.error('[LOG FLUSH FAIL]', e.message, e.stack);
    }
  }

  function _safeSerialize(context) {
    try {
      return JSON.stringify(
        context,
        (key, value) => {
          if (value && typeof value.getId === 'function') {
            try {
              if (typeof value.getName === 'function') {
                return `[AppsScript Object: ${value.getName()}]`;
              }
              return `[AppsScript Object ID: ${value.getId()}]`;
            } catch (e) {
              return `[AppsScript Object (errore serializzazione: ${e.message})]`;
            }
          }
          if (value instanceof Date) return value.toISOString();
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: String(value.stack || '').slice(0, 1500)
            };
          }
          return value;
        }, 2
      );
    } catch (e) {
      return `{"error":"Impossibile serializzare il contesto","message":"${e.message}"}`;
    }
  }

  function _log(level, runIdOrScope, scopeOrMessage, messageOrContext, contextOrUndefined) {
    try {
      // Overloading: supporta sia (level, scope, message, context) che (level, runId, scope, message, context)
      let runId = '';
      let scope, message, context;
      
      if (contextOrUndefined !== undefined) {
        // 5 argomenti: (level, runId, scope, message, context)
        runId = String(runIdOrScope || '');
        scope = scopeOrMessage;
        message = messageOrContext;
        context = contextOrUndefined;
      } else {
        // 4 argomenti: (level, scope, message, context)
        scope = runIdOrScope;
        message = scopeOrMessage;
        context = messageOrContext || {};
      }

      const cloudLogMessage = `[${level}] ${scope}: ${message}`;
      if (context && Object.keys(context).length > 0) {
           if (context.error instanceof Error) {
             console.error(cloudLogMessage, context.error.message, context.error.stack, context);
           } else if (level === 'ERROR') {
             console.error(cloudLogMessage, context);
           } else if (level === 'WARN') {
             console.warn(cloudLogMessage, context);
           } else {
             console.log(cloudLogMessage, context);
           }
      } else {
         if (level === 'ERROR') console.error(cloudLogMessage);
         else if (level === 'WARN') console.warn(cloudLogMessage);
         else console.log(cloudLogMessage);
      }

      let safeContext = _safeSerialize(context);
      if (safeContext.length > 49000) {
        safeContext = safeContext.substring(0, 49000) + '... [TRONCATO]"}';
      }
      
      logBuffer.push([new Date(), runId, scope || '-', level || 'INFO', message || '-', safeContext]);
      
      if (logBuffer.length >= MAX_BUFFER_SIZE) _flush();

    } catch (e) {
      console.error('[LOG FAIL] Errore critico nel logger!', level, runIdOrScope, scopeOrMessage, e?.message);
    }
  }

  /**
   * Genera un runId univoco per tracciare un'esecuzione completa.
   * Formato: YYYYMMDD_HHMMSS_SSS
   */
  function generateRunId() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const h = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');
    const ms = String(now.getMilliseconds()).padStart(3, '0');
    return `${y}${m}${d}_${h}${min}${s}_${ms}`;
  }

  return {
    generateRunId,
    info: (...args) => _log('INFO', ...args),
    warn: (...args) => _log('WARN', ...args),
    error: (...args) => _log('ERROR', ...args),
    debug: (...args) => {
      // Gate DEBUG: controlla CONFIG.MODALITA_DEBUG
      try {
        if (CONFIG && CONFIG.get('MODALITA_DEBUG', false) === true) {
          _log('DEBUG', ...args);
        }
      } catch (e) {
        // Fallback se CONFIG non è ancora pronto
        if (String(args[2] || '').includes('MODALITA_DEBUG')) {
          _log('DEBUG', ...args);
        }
      }
    },
    flush: _flush,
    
    /**
     * Pulisce i log vecchi mantenendo solo gli ultimi N giorni
     * @param {number} daysToKeep - Giorni da mantenere (default 30)
     */
    cleanup: function(daysToKeep = 30) {
      try {
        _flush(); // Svuota prima il buffer
        
        const sh = SHEETS.get(SHEETS.SHEET_NAMES.Log);
        if (!sh) {
          console.warn('[LOG CLEANUP] Foglio Log non trovato.');
          return { success: false, message: 'Foglio Log non trovato' };
        }
        
        const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Log);
        const lastRow = sh.getLastRow();
        
        if (lastRow <= headerRow) {
          return { success: true, message: 'Nessun log da pulire', deleted: 0 };
        }
        
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        
        const timestamps = sh.getRange(headerRow + 1, 1, lastRow - headerRow, 1).getValues();
        
        let firstRowToKeep = -1;
        for (let i = 0; i < timestamps.length; i++) {
          const timestamp = timestamps[i][0];
          if (timestamp instanceof Date && timestamp >= cutoffDate) {
            firstRowToKeep = headerRow + 1 + i;
            break;
          }
        }
        
        if (firstRowToKeep === -1 || firstRowToKeep === headerRow + 1) {
          return { success: true, message: 'Nessun log vecchio da eliminare', deleted: 0 };
        }
        
        const rowsToDelete = firstRowToKeep - headerRow - 1;
        sh.deleteRows(headerRow + 1, rowsToDelete);
        
        LOG.info('LOG_CLEANUP', `Puliti ${rowsToDelete} log vecchi (oltre ${daysToKeep} giorni)`);
        return { success: true, message: `${rowsToDelete} log eliminati`, deleted: rowsToDelete };
        
      } catch (e) {
        console.error('[LOG CLEANUP FAIL]', e.message, e.stack);
        return { success: false, message: e.message, deleted: 0 };
      }
    }
  };
})();

// Registra LOG nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('LOG', ['App']);
}

// Registra LOG nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('LOG', LOG);
}

// Espone LOG in globalThis per dependency tracking
if (typeof globalThis !== 'undefined') {
  globalThis.LOG = LOG;
}


const UTIL = (function () {

  // Lazy load ERROR_HANDLER (declared later in GG namespace)
  const getErrorHandler = () => GG.get('ERROR_HANDLER');

  // ============================================================
  // LOCK MANAGEMENT (Script-level concurrency control)
  // ============================================================
  
  let activeLock = null;
  
  /**
   * Acquisisce un lock globale per prevenire esecuzioni concorrenti.
   * 
   * @param {number} [timeoutMs=10000] - Timeout acquisizione in millisecondi
   * @returns {boolean} True se lock acquisito, false se timeout o già locked
   */
  function acquireLock(timeoutMs = 10000) {
    if (activeLock?.hasLock()) return true;
    try {
      const lock = LockService.getScriptLock();
      if (lock.tryLock(timeoutMs)) {
        activeLock = lock;
        return true;
      }
      LOG.warn('LOCK_ACQUIRE', `Timeout acquisizione lock (${timeoutMs}ms). Un altro processo è in esecuzione.`);
      return false;
    } catch (e) {
      LOG.error('LOCK_ACQUIRE', 'Errore critico durante il tentativo di acquisizione del lock.', { error: e.message });
      return false;
    }
  }
  
  /**
   * Rilascia il lock globale precedentemente acquisito.
   * @returns {void}
   */
  function releaseLock() {
    if (activeLock?.hasLock()) {
      const ERROR_HANDLER = getErrorHandler();
      ERROR_HANDLER.safely(
        () => activeLock.releaseLock(),
        { scope: 'LOCK_RELEASE', message: 'Errore durante il rilascio del lock.' }
      );
    }
    activeLock = null;
  }

  // ============================================================
  // NUMBER PARSING (Advanced smart parsing for IT/EN formats)
  // ============================================================
  
  /**
   * Parsing robusto di numeri da stringhe con opzioni avanzate.
   * Supporta formati italiani (1.234,56), inglesi (1,234.56), valute (€ 123).
   * 
   * @param {*} value - Valore da parsare (string, number, null)
   * @param {Object} [options] - Opzioni parsing
   * @param {boolean} [options.returnZeroOnFail=true] - Se true ritorna 0, altrimenti null
   * @param {boolean} [options.allowNegative=true] - Permetti numeri negativi
   * @param {boolean} [options.strictMode=false] - Validazione rigida (solo numeri puri, no lettere)
   * @returns {number|null} Numero parsato o 0/null se non valido
   * 
   * @example
   * parseNumSmart('1.234,56'); // => 1234.56
   * parseNumSmart('€ 45,99');   // => 45.99
   * parseNumSmart('invalid');  // => 0
   * parseNumSmart('invalid', {returnZeroOnFail: false}); // => null
   * parseNumSmart('abc123', {strictMode: true}); // => null (lettere non permesse)
   */
  function parseNumSmart(value, options = {}) {
    const {
      returnZeroOnFail = true,
      allowNegative = true,
      strictMode = false
    } = options;
    
    const failValue = returnZeroOnFail ? 0 : null;
    
    if (value === null || value === undefined || value === '') return failValue;
    if (typeof value === 'number') return value;
    
    if (typeof value === 'string') {
      const cleaned = value.replace(/[€$£\s]/g, '').trim();
      
      // ✅ FIX: Rimuove TUTTE le virgolette (es. ""0"") prima del parsing
      const unquoted = cleaned.replace(/["']/g, '');

      if (!unquoted) return failValue;
      
      // Strict mode: validazione rigida (solo cifre, punto, virgola, segno opzionale)
      if (strictMode) {
        const strictPattern = allowNegative ? /^[-+]?\d+(?:[.,]\d+)?$/ : /^\d+(?:[.,]\d+)?$/;
        if (!strictPattern.test(unquoted)) return failValue;
      }
      
      // Gestione segno negativo
      const isNegative = unquoted.startsWith('-');
      if (isNegative && !allowNegative) return failValue;
      
      // Parsing formato IT/EN
      let num;
      if (unquoted.includes('.') && unquoted.includes(',')) {
        // Formato misto: determina quale è separatore migliaia e quale decimale
        if (unquoted.lastIndexOf('.') < unquoted.lastIndexOf(',')) {
          // Formato IT: 1.234,56
          num = parseFloat(unquoted.replace(/\./g, '').replace(',', '.'));
        } else {
          // Formato EN: 1,234.56
          num = parseFloat(unquoted.replace(/,/g, ''));
        }
      } else {
        // Un solo separatore o nessuno: tratta virgola come decimale
        num = parseFloat(unquoted.replace(',', '.'));
      }
      
      return (isNaN(num) || !Number.isFinite(num)) ? failValue : num;
    }
    
    return failValue;
  }

  // ============================================================
  // XML HELPERS (FatturaPA-specific namespace handling)
  // ============================================================
  
  /**
   * Ritorna getChild con priorità: namespace dell'elemento -> extraNs -> FPA_NS -> FPA_NS10 -> no ns
   * 
   * @param {GoogleAppsScript.XML_Service.Element} element - Elemento XML genitore
   * @param {string} name - Nome del child da cercare
   * @param {GoogleAppsScript.XML_Service.Namespace} [extraNs] - Namespace aggiuntivo da provare
   * @returns {GoogleAppsScript.XML_Service.Element|null} Primo child trovato o null
   */
  function firstChild(element, name, extraNs) {
    if (!element) return null;
    const elNs = element.getNamespace();
    let found = null;
    if (elNs) {
      try { found = element.getChild(name, elNs); } catch (_) { /* Ignora errore intenzionalmente: fallback namespace */ }
      if (found) return found;
    }
    if (extraNs) {
      try { found = element.getChild(name, extraNs); } catch (_) { /* Ignora errore intenzionalmente: fallback namespace */ }
      if (found) return found;
    }
    try { found = element.getChild(name, FPA_NS); } catch (_) { /* Ignora errore intenzionalmente: fallback namespace */ }
    if (found) return found;
    try { found = element.getChild(name, FPA_NS10); } catch (_) { /* Ignora errore intenzionalmente: fallback namespace */ }
    if (found) return found;
    try { found = element.getChild(name); } catch (_) { /* Ignora errore intenzionalmente: fallback senza namespace */ }
    return found;
  }
  
  /**
   * Testo sicuro: Apps Script non ha getTextTrim() → usa getText().trim()
   * 
   * @param {GoogleAppsScript.XML_Service.Element} element - Elemento XML genitore
   * @param {string} name - Nome del child da cercare
   * @param {GoogleAppsScript.XML_Service.Namespace} [ns] - Namespace opzionale
   * @returns {string} Testo del child o stringa vuota se non trovato
   */
  function firstText(element, name, ns) {
    const child = firstChild(element, name, ns);
    return child ? String(child.getText()).trim() : '';
  }
  
  /**
   * Testo di un nodo generico (Element/Text/String), mai null
   * 
   * @param {*} node - Nodo XML o valore da convertire
   * @returns {string} Testo estratto o stringa vuota
   */
  function textOf(node) {
    if (!node) return '';
    try {
      if (typeof node.getText === 'function') return String(node.getText()).trim();
      if (typeof node.getValue === 'function') return String(node.getValue()).trim();
    } catch (e) { /* Ignora errore intenzionalmente: fallback conversione stringa */ }
    return String(node).trim();
  }

  // ============================================================
  // BATCH OPERATIONS (Large data write operations)
  // ============================================================
  
  /**
   * Scrive dati in un foglio in modalità batch con chunking automatico.
   * Gestisce automaticamente espansione righe/colonne se necessario.
   * 
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Foglio di destinazione
   * @param {number} startRow - Riga iniziale (1-based)
   * @param {Array<Array>} data - Array 2D di dati da scrivere
   * @param {number} [batchSize=200] - Dimensione chunk per scrittura
   * @returns {void}
   * @throws {Error} Se la scrittura fallisce
   */
  function writeBatched(sheet, startRow, data, batchSize = 200) {
    if (!data || data.length === 0 || !data[0]) return;
    try {
      const numRows = data.length;
      const numCols = data[0].length;
      if (numCols === 0) return;

      const maxColsSheet = sheet.getMaxColumns();
      if (maxColsSheet < numCols) sheet.insertColumnsAfter(maxColsSheet, numCols - maxColsSheet);
       const neededLastRow = startRow + numRows - 1;
       const maxRowsSheet = sheet.getMaxRows();
       if (neededLastRow > maxRowsSheet) sheet.insertRowsAfter(maxRowsSheet, neededLastRow - maxRowsSheet);

      const validStartRow = Math.max(1, startRow);
      for (let i = 0; i < numRows; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        if (batch.length > 0) {
           sheet.getRange(validStartRow + i, 1, batch.length, numCols).setValues(batch);
        }
      }
    } catch (e) {
      LOG.error('UTIL_WRITE_BATCH', `Errore during scrittura batch.`, { sheet: sheet.getName(), error: e.message });
      throw e;
    }
  }

  /**
   * Ottiene tutti i file da una cartella Google Drive ricorsivamente.
   * Attraversa tutte le sottocartelle e gestisce gracefully errori di permessi.
   * 
   * @param {GoogleAppsScript.Drive.Folder} folder - Cartella radice da esplorare
   * @returns {Array<GoogleAppsScript.Drive.File>} Array di file trovati
   */
  function getAllFilesRecursive(folder) {
    const fileList = [];
    function _search(subFolder) {
      try {
        const files = subFolder.getFiles();
        while (files.hasNext()) fileList.push(files.next());
        const subfolders = subFolder.getFolders();
        while (subfolders.hasNext()) _search(subfolders.next());
      } catch (e) {
        if (String(e.message || '').indexOf('denied') === -1) {
           LOG.warn('UTIL_SEARCH', `Impossibile leggere contenuto di '${subFolder?.getName()}'.`, { folderId: subFolder?.getId(), error: e.message });
        } else {
             console.warn(`Accesso negato alla cartella '${subFolder?.getName()}' (ID: ${subFolder?.getId()}) - Saltata.`);
        }
      }
    }
    if (folder) _search(folder);
    return fileList;
  }

  /**
   * Aggiorna celle specifiche in un foglio minimizzando le API calls.
   * Legge tutto il range una volta, modifica in memoria, scrive in batch.
   * 
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Foglio da aggiornare
   * @param {Object<number, Object<number, *>>} updates - Mappa righe -> {colIndex: value}
   * @param {number} [headerRows=1] - Numero righe header da saltare
   * @returns {number} Numero celle effettivamente modificate
   * 
   * @example
   * const updates = {
   *   5: { 2: 'nuovo valore', 4: 123 },  // riga 5, colonne 2 e 4
   *   8: { 1: 'altro valore' }           // riga 8, colonna 1
   * };
   * UTIL.updateSheetInPlace(sheet, updates, 1);
   */
  function updateSheetInPlace(sheet, updates, headerRows = 1) {
    const rowNumbers = Object.keys(updates);
    if (rowNumbers.length === 0) return 0;
    try {
      const dataRange = sheet.getDataRange();
      const numSheetRows = dataRange.getNumRows();
      if (numSheetRows <= headerRows) return 0;

      const displayRange = dataRange.offset(headerRows, 0, numSheetRows - headerRows);
      const values = displayRange.getValues();
      const dataRowsCount = values.length;
      let updatedCount = 0;

      for (const rowNum of rowNumbers) {
        const rowIndex = Number(rowNum) - headerRows - 1;
        if (rowIndex >= 0 && rowIndex < dataRowsCount) {
          const rowUpdates = updates[rowNum];
          const currentRowData = values[rowIndex];
          for (const colIndexStr in rowUpdates) {
            const colIndex = Number(colIndexStr);
            if (colIndex >= 0 && colIndex < currentRowData.length) {
              if (currentRowData[colIndex] !== rowUpdates[colIndexStr]) {
                 currentRowData[colIndex] = rowUpdates[colIndexStr];
                 updatedCount++;
              }
            } else {
              LOG.warn('UTIL_UPDATE', `Indice colonna ${colIndex + 1} fuori limiti per riga ${rowNum} in ${sheet.getName()}.`);
            }
          }
        } else {
          LOG.warn('UTIL_UPDATE', `Indice riga ${rowNum} fuori dai limiti per ${sheet.getName()}. Dati letti: ${dataRowsCount} righe. (Forse il foglio è cambiato durante l'esecuzione?)`);
        }
      }

      if (updatedCount > 0) {
        displayRange.setValues(values);
        SpreadsheetApp.flush();
        LOG.debug('UTIL_UPDATE', `Aggiornamento in-place: ${updatedCount} celle modificate in ${sheet.getName()}.`);
      }
      return updatedCount;
    } catch (e) {
      LOG.error('UTIL_UPDATE', 'Aggiornamento in-place fallito. Fallback cella-per-cella (lento).', { error: e.message, sheet: sheet.getName() });
      let fallbackCount = 0;
      for (const rowNum in updates) {
        for (const colIndex in updates[rowNum]) {
          try {
            sheet.getRange(Number(rowNum), Number(colIndex) + 1).setValue(updates[rowNum][colIndex]);
            fallbackCount++;
          } catch (e2) {
             LOG.error('UTIL_UPDATE_FALLBACK', `Impossibile aggiornare cella ${rowNum}:${Number(colIndex)+1}`, { error: e2.message });
          }
        }
      }
      return fallbackCount;
    }
  }

  // ============================================================
  // BUSINESS-SPECIFIC UTILITIES (Supplier normalization)
  // ============================================================
  
  /**
   * Normalizza un ID fornitore (P.IVA) rimuovendo prefisso IT e zeri iniziali.
   * Utility DRY per evitare duplicazione logica normalizzazione P.IVA.
   * 
   * @param {string} id - P.IVA da normalizzare
   * @returns {string} P.IVA normalizzata (senza IT, senza zeri iniziali)
   * 
   * @example
   * normalizeSupplierId('IT01234567890'); // => '1234567890'
   * normalizeSupplierId('00123456');      // => '123456'
   */
  function normalizeSupplierId(id) {
    const normalized = String(id ?? '')
      .trim()
      .replace(/^IT/i, '')  // Rimuovi prefisso IT
      .replace(/^0+/, '');  // Rimuovi zeri iniziali
    return normalized;
  }

  // ============================================================
  // API PUBBLICA (Ridotta - utility generiche migrate a SHARED_UTILS)
  // ============================================================
  
  // NOTA: Per backward compatibility, mantengo alcuni wrapper che delegano a SHARED_UTILS
  // Una volta completato il refactoring globale, questi wrapper possono essere rimossi
  
  return {
    // === CORE OPERATIONS (Rimangono in UTIL) ===
    
    // Lock Management (Script-level state)
    acquireLock,
    releaseLock,
    
    // Number Parsing (Advanced IT/EN formats)
    parseNumSmart,
    
    // XML Helpers (FatturaPA-specific)
    firstChild,
    firstText,
    textOf,
    
    // Batch Operations (Large data I/O)
    writeBatched,
    getAllFilesRecursive,
    updateSheetInPlace,
    
    // Business-specific
    normalizeSupplierId,
    normKey: (str) => String(str ?? '').trim().toUpperCase(),
    
    // === BACKWARD COMPATIBILITY (Deprecated - use SHARED_UTILS) ===
    
    // @deprecated Use SHARED_UTILS.showToast
    showToast: (message, title = 'Info', timeout = 5) => {
      try {
        SpreadsheetApp.getActiveSpreadsheet().toast(message, title, timeout);
      } catch (e) {
        console.log(`[TOAST] ${title}: ${message}`);
      }
    },
    
    // @deprecated Use SHARED_UTILS.getColumnLetter
    getColumnLetter: (colIndex) => {
      if (typeof colIndex !== 'number' || colIndex < 0) return '';
      let letter = '';
      let num = colIndex + 1;
      while (num > 0) {
        let rem = (num - 1) % 26;
        letter = String.fromCharCode(65 + rem) + letter;
        num = Math.floor((num - 1) / 26);
      }
      return letter;
    },
    
    // @deprecated Use SHARED_UTILS.checkColumns
    checkColumns: (idx, required) => required.filter(col => idx[col] === undefined),
    
    // @deprecated Use SHARED_UTILS.forceText
    forceText: (value) => {
      const str = String(value ?? '');
      if (!str) return '';
      if (str.startsWith("'")) return str;
      const trimmedStr = str.trim();
      // Helper interno _looksNumericLike duplicato per backward compatibility
      const looksNumeric = (s) => {
        if (!s) return false;
        const cleaned = s.replace(/[€$£\s]/g, '');
        return /^-?[\d.,]+$/.test(cleaned);
      };
      if (/^0\d+$/.test(trimmedStr) || looksNumeric(trimmedStr)) {
        return "'" + str;
      }
      return str;
    },
    
    // === NAMESPACES (Delegate to SHARED_UTILS for new code) ===
    
    // @deprecated Use SHARED_UTILS.date (kept for backward compatibility)
    date: {
      // Wrappers che delegano a SHARED_UTILS quando disponibile
      parseXmlDate: (dateInput) => {
        try {
          return SHARED_UTILS?.date?.parseXmlDate(dateInput) ?? null;
        } catch (e) {
          // Fallback inline se SHARED_UTILS non caricato
          if (!dateInput) return null;
          if (dateInput instanceof Date) return isNaN(dateInput.getTime()) ? null : dateInput;
          return null;
        }
      },
      formatIsoDate: (date) => SHARED_UTILS?.date?.formatIsoDate(date) ?? '',
      formatItalianDate: (date) => SHARED_UTILS?.date?.formatItalianDate(date) ?? '',
      formatTimestamp: (date) => SHARED_UTILS?.date?.formatTimestamp(date) ?? '',
      extractYearMonth: (date) => SHARED_UTILS?.date?.extractYearMonth(date) ?? { anno: '', mese: 0 },
      getItalianMonthName: (monthNumber, yearSuffix) => SHARED_UTILS?.date?.getItalianMonthName(monthNumber, yearSuffix) ?? 'N/A',
      getShortMonthName: (monthNumber, yearSuffix) => SHARED_UTILS?.date?.getShortMonthName(monthNumber, yearSuffix) ?? 'N/A',
      isValidDate: (value) => SHARED_UTILS?.date ? SHARED_UTILS.isValidDate(value) : (value instanceof Date && !isNaN(value.getTime())),
      parseItalianDate: (italianDateStr) => SHARED_UTILS?.date?.parseItalianDate(italianDateStr) ?? null,
      formatLongItalian: (date) => SHARED_UTILS?.date?.formatLongItalian(date) ?? '',
      daysBetween: (date1, date2) => SHARED_UTILS?.date?.daysBetween(date1, date2) ?? 0,
      getFirstDayOfMonth: (date) => SHARED_UTILS?.date?.getFirstDayOfMonth(date) ?? null,
      getLastDayOfMonth: (date) => SHARED_UTILS?.date?.getLastDayOfMonth(date) ?? null
    },
    
    // @deprecated Use parseNumSmart or SHARED_UTILS.toNumber (kept for backward compatibility)
    number: {
      parse: (value) => parseNumSmart(value),
      parseStrict: (value) => parseNumSmart(value, { strictMode: true, returnZeroOnFail: false }),
      isNumericLike: (value) => {
        if (typeof value === 'number') return true;
        if (typeof value !== 'string') return false;
        const s = String(value).trim();
        if (!s) return false;
        const cleaned = s.replace(/[€$£\s]/g, '');
        return /^-?[\d.,]+$/.test(cleaned) && parseNumSmart(s) !== 0;
      }
    }
  };
})();

// Registra UTIL nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('UTIL', ['App']);
}

// Registra UTIL nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('UTIL', UTIL);
}

// Espone UTIL in globalThis per dependency tracking
if (typeof globalThis !== 'undefined') {
  globalThis.UTIL = UTIL;
}



const XMLSAFE = (function () {
  const _stripBom = (s) => s.replace(/^\uFEFF/, '');

  function parseDriveXml(fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
      
      // ⚠️ SAFETY GUARD: Verifica dimensione file prima del parsing
      const fileSize = file.getSize();
      if (fileSize > 5242880) { // 5MB in bytes
        const errorMsg = `ERRORE CRITICO: Il file XML "${file.getName()}" supera i 5MB (${(fileSize / 1048576).toFixed(2)}MB). Impossibile parsare in Apps Script per limiti di memoria.`;
        LOG.error('XMLSAFE', errorMsg, { fileId, fileSizeBytes: fileSize, fileSizeMB: (fileSize / 1048576).toFixed(2) });
        throw new Error(errorMsg);
      }
      
      const blob = file.getBlob();
      let content;

      try {
        content = blob.getDataAsString('UTF-8');
        return XmlService.parse(_stripBom(content));
      } catch (eUtf8) {
        LOG.debug('XMLSAFE', `Parsing UTF-8 fallito per ${file.getName()}, tento ISO-8859-1.`, { fileId, error: String(eUtf8.message || '').substring(0,100) });
        try {
          content = blob.getDataAsString('ISO-8859-1');
          return XmlService.parse(_stripBom(content));
        } catch (eIso) {
           try {
             content = blob.getDataAsString('Windows-1252');
             return XmlService.parse(_stripBom(content));
           } catch(eWin) {
              LOG.error('XMLSAFE', `Parsing fallito (UTF-8, ISO-8859-1, Win-1252) per ${file.getName()}.`, { fileId, error: eWin.message });
              return null;
           }
        }
      }
    } catch (eDrive) {
      LOG.error('XMLSAFE', `Impossibile leggere file da Drive: ${fileId}.`, { error: eDrive.message });
      return null;
    }
  }
  return {
    /**
     * Parsa un file XML da Google Drive con gestione encoding multipli.
     * Prova in ordine: UTF-8, ISO-8859-1, Windows-1252.
     * Rimuove automaticamente BOM se presente.
     * 
     * @param {string} fileId - ID del file Drive da parsare
     * @returns {GoogleAppsScript.XML_Service.Document|null} Documento XML parsato o null se errore
     */
    parseDriveXml };
})();

// Registra XMLSAFE nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('XMLSAFE', ['LOG', 'UTIL']);
}

// Registra XMLSAFE nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('XMLSAFE', XMLSAFE);
}

// Espone XMLSAFE in globalThis per dependency tracking
if (typeof globalThis !== 'undefined') {
  globalThis.XMLSAFE = XMLSAFE;
}



const STATE = (function () {
  let _props = null;
  let _cache = null;
  const CACHE_EXPIRATION_SEC = 21600;
  const MAX_PROP_SIZE = 500000;
  const MAX_CACHE_CHUNK_SIZE = 95000;

  const getProps = () => {
    if (!_props) {
      _props = PropertiesService.getScriptProperties();
    }
    return _props;
  };

  const getCache = () => {
    if (!_cache) {
      _cache = CacheService.getScriptCache();
    }
    return _cache;
  };

  const standard = {
    /**
     * Legge un valore da PropertiesService.
     * 
     * @param {string} key - Chiave da leggere
     * @returns {string|null} Valore memorizzato o null se non esiste
     */
    get: (key) => getProps().getProperty(key),
    
    /**
     * Scrive un valore in PropertiesService.
     * Limite: 500KB per valore. Per dati più grandi usa STATE.cache.
     * 
     * @param {string} key - Chiave da scrivere
     * @param {string} value - Valore da memorizzare
     * @returns {void}
     * @throws {Error} Se il valore supera 500KB
     */
    set: (key, value) => {
       const strValue = String(value ?? '');
       if (strValue.length > MAX_PROP_SIZE) {
           LOG.error('STATE_SET', `Valore troppo grande (> ${MAX_PROP_SIZE / 1024}KB) per PropertiesService, chiave: ${key}.`, { size: strValue.length });
           throw new Error(`Valore troppo grande per ScriptProperties. Chiave: ${key}.`);
       }
      getProps().setProperty(key, strValue);
    },
    /**
     * Elimina una chiave da PropertiesService.
     * 
     * @param {string} key - Chiave da eliminare
     * @returns {void}
     */
    clear: (key) => getProps().deleteProperty(key),
    /**
     * Legge e parsa JSON da PropertiesService.
     * 
     * @param {string} key - Chiave da leggere
     * @param {*} [fallback=null] - Valore di default se chiave non esiste o JSON invalido
     * @returns {*} Oggetto parsato o fallback
     */
    getJSON(key, fallback = null) {
      const raw = getProps().getProperty(key);
      if (!raw) return fallback;
      try {
          return JSON.parse(raw);
      } catch (e) {
          LOG.warn('STATE_PARSE', `Impossibile parsare JSON da PropertiesService per chiave: ${key}. Valore grezzo: '${raw.substring(0,100)}...'`, { error: e.message });
          try { getProps().deleteProperty(key); } catch(_) {}
          return fallback;
      }
    },
    /**
     * Serializza e salva un oggetto come JSON in PropertiesService.
     * 
     * @param {string} key - Chiave dove salvare
     * @param {*} obj - Oggetto da serializzare
     * @returns {void}
     * @throws {Error} Se JSON serializzato supera 500KB
     */
    setJSON(key, obj) {
      try {
        const serialized = JSON.stringify(obj);
        if (serialized.length > MAX_PROP_SIZE) {
          LOG.error('STATE_SET_JSON', `JSON troppo grande (> ${MAX_PROP_SIZE / 1024}KB) per PropertiesService, chiave: ${key}. Usare STATE.cache?`, { size: serialized.length });
          throw new Error(`Dati JSON troppo grandi per ScriptProperties (${(serialized.length / 1024).toFixed(1)} KB). Chiave: ${key}.`);
        }
        getProps().setProperty(key, serialized);
      } catch (e) {
        LOG.error('STATE_SET_JSON', `Impossibile serializzare/salvare JSON in PropertiesService per chiave: ${key}`, { error: e.message });
        throw e;
      }
    }
  };

  const cache = {
    /**
     * Salva un array JSON di grandi dimensioni in CacheService con chunking automatico.
     * Supera il limite 100KB di CacheService dividendo in chunk multipli.
     * TTL: 6 ore (massimo CacheService).
     * 
     * @param {string} baseKey - Chiave base per i chunk (es: 'HEADERS_DATA')
     * @param {Array<*>} dataArray - Array di oggetti da salvare
     * @returns {number} Numero di chunk creati
     */
    setLargeJSONArray(baseKey, dataArray) {
      if (!dataArray) return 0;
      if (dataArray.length === 0) {
        const oldKeys = [];
        for (let i = 0; i < 50; i++) oldKeys.push(`${baseKey}_${i}`);
        try { getCache().removeAll(oldKeys); } catch (_) {}
        LOG.debug('STATE_CACHE_LARGE', `Array vuoto per ${baseKey}. Puliti chunk precedenti.`);
        return 0;
      }

      let chunkIndex = 0;
      let currentChunkItems = [];
      let currentChunkSize = 2; // '[' e ']'
      const chunksToSave = {};

      for (const item of dataArray) {
        let itemString;
        try {
          itemString = JSON.stringify(item);
        } catch (e) {
          LOG.warn('STATE_CACHE_LARGE', `Impossibile serializzare item per CacheService, chiave: ${baseKey}. Item saltato.`, { itemPreview: String(item).substring(0, 100), error: e.message });
          continue;
        }

        const itemSizeWithComma = itemString.length + (currentChunkItems.length > 0 ? 1 : 0);

        if (itemString.length + 2 > MAX_CACHE_CHUNK_SIZE) {
             LOG.error('STATE_CACHE_LARGE', `Item troppo grande (${itemString.length} bytes) per essere salvato in un chunk CacheService, chiave: ${baseKey}. Item saltato.`, { itemPreview: itemString.substring(0, 100) });
             continue;
        }

        if (currentChunkSize + itemSizeWithComma > MAX_CACHE_CHUNK_SIZE) {
          chunksToSave[`${baseKey}_${chunkIndex}`] = '[' + currentChunkItems.join(',') + ']';
          chunkIndex++;
          currentChunkItems = [itemString];
          currentChunkSize = itemString.length + 2;
        } else {
          currentChunkItems.push(itemString);
          currentChunkSize += itemSizeWithComma;
        }
      }

      if (currentChunkItems.length > 0) {
        chunksToSave[`${baseKey}_${chunkIndex}`] = '[' + currentChunkItems.join(',') + ']';
        chunkIndex++;
      }

      const keysToClean = [];
      for (let i = chunkIndex; i < chunkIndex + 50; i++) {
        keysToClean.push(`${baseKey}_${i}`);
      }
      try { if (keysToClean.length > 0) getCache().removeAll(keysToClean); } catch (_) {}

      try {
        if (Object.keys(chunksToSave).length > 0) {
          getCache().putAll(chunksToSave, CACHE_EXPIRATION_SEC);
        }
        LOG.debug('STATE_CACHE_LARGE', `Salvati ${dataArray.length} elementi in ${chunkIndex} chunk(s) per ${baseKey}.`);
        return chunkIndex;
      } catch (e) {
        LOG.error('STATE_CACHE_LARGE', `Errore during putAll in CacheService per ${baseKey}.`, { numChunks: Object.keys(chunksToSave).length, error: e.message });
        throw e;
      }
    },

    /**
     * Recupera un array JSON da CacheService precedentemente salvato con setLargeJSONArray.
     * 
     * @param {string} baseKey - Chiave base usata per salvare
     * @param {number} numChunks - Numero di chunk da recuperare
     * @returns {Array<*>} Array ricostruito o array vuoto se dati mancanti/scaduti
     */
    getLargeJSONArray(baseKey, numChunks) {
      if (!Number.isInteger(numChunks) || numChunks <= 0) return [];

      const keys = Array.from({ length: numChunks }, (_, i) => `${baseKey}_${i}`);
      let combinedArray = [];

      try {
        const chunksData = getCache().getAll(keys);

        for (let i = 0; i < numChunks; i++) {
          const chunkKey = keys[i];
          const chunkJsonString = chunksData[chunkKey];

          if (chunkJsonString) {
            try {
              const chunkArray = JSON.parse(chunkJsonString);
              if (Array.isArray(chunkArray)) {
                 combinedArray = combinedArray.concat(chunkArray);
              } else {
                 LOG.error('STATE_CACHE_LARGE', `Chunk ${chunkKey} non contiene un array valido. Dati parziali.`, { chunkPreview: chunkJsonString.substring(0, 100) });
              }
            } catch (parseError) {
              LOG.error('STATE_CACHE_LARGE', `Errore parsing JSON chunk: ${chunkKey}. Dati incompleti o persi.`, { error: parseError.message, chunkPreview: chunkJsonString.substring(0, 100) });
              return [];
            }
          } else {
            LOG.error('STATE_CACHE_LARGE', `Chunk mancante/scaduto durante recupero: ${chunkKey}. Dati incompleti o persi.`);
            return [];
          }
        }
        LOG.debug('STATE_CACHE_LARGE', `Recuperati ${combinedArray.length} elementi da ${numChunks} chunk(s) per ${baseKey}.`);
        return combinedArray;

      } catch (e) {
        LOG.error('STATE_CACHE_LARGE', `Errore during getAll da CacheService per ${baseKey}.`, { error: e.message });
        return [];
      }
    },

    /**
     * Rimuove i chunk di un array JSON da CacheService.
     * 
     * @param {string} baseKey - Chiave base dei chunk da rimuovere
     * @param {number} [numChunks] - Numero chunk conosciuti (se non specificato rimuove fino a 100)
     * @returns {void}
     */
    clearLargeJSON(baseKey, numChunks) {
      const chunksToTry = (Number.isInteger(numChunks) && numChunks > 0) ? numChunks + 50 : 100;
      const keys = Array.from({ length: chunksToTry }, (_, i) => `${baseKey}_${i}`);
      try {
          getCache().removeAll(keys);
          LOG.debug('STATE_CACHE_CLEAR', `Tentativo rimozione ${keys.length} chunk(s) per ${baseKey}.`);
      }
      catch (e) { LOG.warn('STATE_CACHE_CLEAR', `Errore (potrebbe essere normale) durante pulizia cache per ${baseKey}.`, { error: e.message }); }
    }
  };

  return { ...standard, cache: cache };
})();

// Registra STATE nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('STATE', ['LOG']);
}

// Registra STATE nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('STATE', STATE);
}

// Espone STATE in globalThis per dependency tracking
if (typeof globalThis !== 'undefined') {
  globalThis.STATE = STATE;
}