// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 030_globals.js
// RUOLO: Utility globali - LOG, UTIL, XMLSAFE, STATE.
// NOTE: Modulo monolite (969 righe) con helper date, string, XML, PropertiesService.
// =============================================================

/** Namespace FatturaPA (default v1.2 con fallback v1.0) */
const FPA_NS = XmlService.getNamespace('', 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2');
const FPA_NS10 = XmlService.getNamespace('', 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.0');

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
      const numCols = 5; // Schema Log fisso
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

  function _log(level, scope, message, context) {
    try {
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
      logBuffer.push([new Date(), level || 'INFO', scope || '-', message || '-', safeContext]);
      
      if (logBuffer.length >= MAX_BUFFER_SIZE) _flush();

    } catch (e) {
      console.error('[LOG FAIL] Errore critico nel logger!', level, scope, message, e?.message);
    }
  }

  return {
    info: (scope, message, context = {}) => _log('INFO', scope, message, context),
    warn: (scope, message, context = {}) => _log('WARN', scope, message, context),
    error: (scope, message, context = {}) => _log('ERROR', scope, message, context),
    debug: (scope, message, context = {}) => {
      // Assicurati che CONFIG sia definito prima di chiamare LOG.debug
      try {
        if (CONFIG && CONFIG.get('MODALITA_DEBUG', false) === true) _log('DEBUG', scope, message, context);
      } catch (e) {
        // Fallback se CONFIG non è ancora pronto durante l'init
        if (String(message || '').includes('MODALITA_DEBUG')) {
          _log('DEBUG', scope, message, context);
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



const UTIL = (function () {

  // Lazy load ERROR_HANDLER (declared later in GG namespace)
  const getErrorHandler = () => GG.get('ERROR_HANDLER');

  let activeLock = null;
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

  function parseNumSmart(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[€$£\s]/g, '').trim();
      if (!cleaned) return 0;
      if (cleaned.includes('.') && cleaned.includes(',') && cleaned.lastIndexOf('.') < cleaned.lastIndexOf(',')) {
         const num = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
         return isNaN(num) ? 0 : num;
      }
      if (cleaned.includes(',') && cleaned.includes('.') && cleaned.lastIndexOf(',') < cleaned.lastIndexOf('.')) {
         const num = parseFloat(cleaned.replace(/,/g, ''));
         return isNaN(num) ? 0 : num;
      }
      const num = parseFloat(cleaned.replace(',', '.'));
      return isNaN(num) ? 0 : num;
    }
    return 0;
  }

  // === XML HELPERS (Fix critico) ===
  /** Ritorna getChild con priorità: namespace dell'elemento -> extraNs -> FPA_NS -> FPA_NS10 -> no ns */
  function firstChild(element, name, extraNs) {
    if (!element) return null;
    const elNs = element.getNamespace();
    let found = null;
    if (elNs) {
      try { found = element.getChild(name, elNs); } catch (_) {}
      if (found) return found;
    }
    if (extraNs) {
      try { found = element.getChild(name, extraNs); } catch (_) {}
      if (found) return found;
    }
    try { found = element.getChild(name, FPA_NS); } catch (_) {}
    if (found) return found;
    try { found = element.getChild(name, FPA_NS10); } catch (_) {}
    if (found) return found;
    try { found = element.getChild(name); } catch (_) {}
    return found;
  }
  /** Testo sicuro: Apps Script non ha getTextTrim() → usa getText().trim() */
  function firstText(element, name, ns) {
    const child = firstChild(element, name, ns);
    return child ? String(child.getText()).trim() : '';
  }
  /** Testo di un nodo generico (Element/Text/String), mai null */
  function textOf(node) {
    if (!node) return '';
    try {
      if (typeof node.getText === 'function') return String(node.getText()).trim();
      if (typeof node.getValue === 'function') return String(node.getValue()).trim();
    } catch (e) {}
    return String(node).trim();
  }

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

  function _looksNumericLike(str) {
    const s = String(str ?? '').trim();
    if (!s) return false;
    const cleaned = s.replace(/[€$£\s]/g, '');
    return /^-?[\d.,]+$/.test(cleaned) && !isNaN(parseNumSmart(s));
  }
  const forceText = (value) => {
    const str = String(value ?? '');
    if (!str) return '';
    if (str.startsWith("'")) return str;
    const trimmedStr = str.trim();
    if (/^0\d+$/.test(trimmedStr) || _looksNumericLike(trimmedStr)) {
      return "'" + str;
    }
    return str;
  };

  function getColumnLetter(colIndex) {
    if (typeof colIndex !== 'number' || colIndex < 0) return '';
    let letter = '';
    let num = colIndex + 1;
    while (num > 0) {
      let rem = (num - 1) % 26;
      letter = String.fromCharCode(65 + rem) + letter;
      num = Math.floor((num - 1) / 26);
    }
    return letter;
  }

  // ============================================================================
  // DATE_UTILS - Utility centralizzate per gestione date
  // ============================================================================
  
  /**
   * DATE_UTILS
   * 
   * Centralizza tutte le operazioni date sparse nel progetto.
   * 
   * ELIMINA DUPLICAZIONI IN:
   * - 060_import_headers.js (parsing XML date)
   * - 070_import_rows.js (formatting date)
   * - 050_filters.js (regex date parsing)
   * - 090_dashboard.js, 100_reporting.js, 120_pnl.js (formatting)
   * - 080_pdf_export.js (Italian date display)
   * - 092_dashboard_trigger.js (timestamp formatting)
   * 
   * PERFORMANCE: Usa Intl.DateTimeFormat per locale italiano.
   * 
   * @namespace DATE_UTILS
   * @memberof UTIL
   */
  const DATE_UTILS = {
    
    /**
     * Parsa data da stringa XML (formato ISO 8601).
     * Supporta: YYYY-MM-DD, YYYY-MM-DDTHH:MM:SS, YYYY-MM-DDTHH:MM:SS.sssZ
     * 
     * @param {string|Date} dateInput - Data formato ISO o Date object
     * @returns {Date|null} Date object o null se invalida
     * 
     * @example
     * UTIL.date.parseXmlDate('2025-11-19') // => Date(2025, 10, 19)
     * UTIL.date.parseXmlDate('2025-11-19T15:30:00') // => Date(2025, 10, 19, 15, 30)
     */
    parseXmlDate(dateInput) {
      if (!dateInput) return null;
      
      // Se già Date object, valida e ritorna
      if (dateInput instanceof Date) {
        return isNaN(dateInput.getTime()) ? null : dateInput;
      }
      
      if (typeof dateInput !== 'string') return null;
      
      const trimmed = dateInput.trim();
      const isoMatch = trimmed.match(CONSTANTS.DATE_PATTERNS.ISO_DATE);
      
      if (!isoMatch) return null;
      
      const groups = CONSTANTS.DATE_REGEX_GROUPS.ISO;
      const year = +isoMatch[groups.YEAR];
      const month = +isoMatch[groups.MONTH] - 1; // JS months are 0-based
      const day = +isoMatch[groups.DAY];
      
      const date = new Date(year, month, day);
      
      return isNaN(date.getTime()) ? null : date;
    },

    /**
     * Formatta Date come stringa YYYY-MM-DD (ISO).
     * 
     * @param {Date} date - Date object
     * @returns {string} Data formattata o stringa vuota se invalida
     * 
     * @example
     * UTIL.date.formatIsoDate(new Date(2025, 10, 19)) // => '2025-11-19'
     */
    formatIsoDate(date) {
      if (!(date instanceof Date) || isNaN(date.getTime())) return '';
      
      try {
        return Utilities.formatDate(
          date, 
          Session.getScriptTimeZone(), 
          CONSTANTS.DATE_FORMATS.ISO
        );
      } catch (e) {
        LOG?.warn('DATE_UTILS', 'Error formatting ISO date', { error: e.message });
        return '';
      }
    },

    /**
     * Formatta Date come stringa DD/MM/YYYY (locale IT).
     * 
     * @param {Date} date - Date object
     * @returns {string} Data formattata italiana
     * 
     * @example
     * UTIL.date.formatItalianDate(new Date(2025, 10, 19)) // => '19/11/2025'
     */
    formatItalianDate(date) {
      if (!(date instanceof Date) || isNaN(date.getTime())) return '';
      
      try {
        // Performance: usa Intl.DateTimeFormat (più veloce di formatDate)
        const formatter = new Intl.DateTimeFormat('it-IT', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        return formatter.format(date);
      } catch (e) {
        // Fallback a Utilities.formatDate
        try {
          return Utilities.formatDate(
            date, 
            Session.getScriptTimeZone(), 
            CONSTANTS.DATE_FORMATS.ITALIAN
          );
        } catch (e2) {
          LOG?.warn('DATE_UTILS', 'Error formatting Italian date', { error: e2.message });
          return '';
        }
      }
    },

    /**
     * Formatta Date come timestamp completo (YYYY-MM-DD HH:MM:SS).
     * 
     * @param {Date} date - Date object (default: now)
     * @returns {string} Timestamp formattato
     * 
     * @example
     * UTIL.date.formatTimestamp(new Date(2025, 10, 19, 15, 30)) // => '2025-11-19 15:30:00'
     * UTIL.date.formatTimestamp() // => timestamp corrente
     */
    formatTimestamp(date) {
      const d = date || new Date();
      if (!(d instanceof Date) || isNaN(d.getTime())) return '';
      
      try {
        return Utilities.formatDate(
          d, 
          Session.getScriptTimeZone(), 
          CONSTANTS.DATE_FORMATS.TIMESTAMP
        );
      } catch (e) {
        LOG?.warn('DATE_UTILS', 'Error formatting timestamp', { error: e.message });
        return '';
      }
    },

    /**
     * Estrae anno e mese da Date.
     * 
     * @param {Date} date - Date object
     * @returns {{anno: string, mese: number}} Anno (YYYY) e mese (1-12)
     * 
     * @example
     * UTIL.date.extractYearMonth(new Date(2025, 10, 19)) // => { anno: '2025', mese: 11 }
     */
    extractYearMonth(date) {
      if (!(date instanceof Date) || isNaN(date.getTime())) {
        return { anno: '', mese: 0 };
      }
      
      return {
        anno: String(date.getFullYear()),
        mese: date.getMonth() + 1 // JS months are 0-based, business logic is 1-based
      };
    },

    /**
     * Ottiene nome mese italiano completo da numero (1-12).
     * 
     * @param {number} monthNumber - Numero mese (1-12)
     * @param {string} [yearSuffix] - Suffisso anno opzionale (es: "'24")
     * @returns {string} Nome mese italiano
     * 
     * @example
     * UTIL.date.getItalianMonthName(1) // => 'Gennaio'
     * UTIL.date.getItalianMonthName(11, "'25") // => "Novembre '25"
     */
    getItalianMonthName(monthNumber, yearSuffix = '') {
      const monthNames = [
        'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
        'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
      ];
      
      const month = Number(monthNumber);
      if (month < 1 || month > 12 || isNaN(month)) {
        LOG?.warn('DATE_UTILS', `Invalid month number: ${monthNumber}`);
        return 'N/A';
      }
      
      const name = monthNames[month - 1];
      return yearSuffix ? `${name} ${yearSuffix}` : name;
    },

    /**
     * Ottiene nome mese italiano abbreviato da numero (1-12).
     * 
     * @param {number} monthNumber - Numero mese (1-12)
     * @param {string} [yearSuffix] - Suffisso anno opzionale
     * @returns {string} Nome mese abbreviato (3 lettere)
     * 
     * @example
     * UTIL.date.getShortMonthName(1) // => 'Gen'
     * UTIL.date.getShortMonthName(11, "'25") // => "Nov '25"
     */
    getShortMonthName(monthNumber, yearSuffix = '') {
      const shortNames = [
        'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
        'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'
      ];
      
      const month = Number(monthNumber);
      if (month < 1 || month > 12 || isNaN(month)) {
        return 'N/A';
      }
      
      const name = shortNames[month - 1];
      return yearSuffix ? `${name} ${yearSuffix}` : name;
    },

    /**
     * Verifica se valore è una Date valida.
     * 
     * @param {*} value - Valore da verificare
     * @returns {boolean} True se è una Date valida
     * 
     * @example
     * UTIL.date.isValidDate(new Date()) // => true
     * UTIL.date.isValidDate('invalid') // => false
     */
    isValidDate(value) {
      return value instanceof Date && !isNaN(value.getTime());
    },

    /**
     * Parsa data italiana DD/MM/YYYY in Date object.
     * 
     * @param {string} italianDateStr - Data formato DD/MM/YYYY
     * @returns {Date|null} Date object o null se invalida
     * 
     * @example
     * UTIL.date.parseItalianDate('19/11/2025') // => Date(2025, 10, 19)
     */
    parseItalianDate(italianDateStr) {
      if (!italianDateStr || typeof italianDateStr !== 'string') return null;
      
      const trimmed = italianDateStr.trim();
      const match = trimmed.match(CONSTANTS.DATE_PATTERNS.ITALIAN_DATE);
      
      if (!match) return null;
      
      const groups = CONSTANTS.DATE_REGEX_GROUPS.ITALIAN;
      const day = +match[groups.DAY];
      const month = +match[groups.MONTH] - 1; // JS 0-based
      const year = +match[groups.YEAR];
      
      const date = new Date(year, month, day);
      
      return isNaN(date.getTime()) ? null : date;
    },

    /**
     * Formatta Date in formato lungo italiano.
     * 
     * @param {Date} date - Date object
     * @returns {string} Formato: "19 novembre 2025"
     * 
     * @example
     * UTIL.date.formatLongItalian(new Date(2025, 10, 19)) // => '19 novembre 2025'
     */
    formatLongItalian(date) {
      if (!(date instanceof Date) || isNaN(date.getTime())) return '';
      
      try {
        const formatter = new Intl.DateTimeFormat('it-IT', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        return formatter.format(date);
      } catch (e) {
        LOG?.warn('DATE_UTILS', 'Error formatting long Italian date', { error: e.message });
        return '';
      }
    },

    /**
     * Calcola differenza in giorni tra due date.
     * 
     * @param {Date} date1 - Prima data
     * @param {Date} date2 - Seconda data
     * @returns {number} Giorni di differenza (può essere negativo)
     * 
     * @example
     * UTIL.date.daysBetween(new Date(2025, 0, 1), new Date(2025, 0, 10)) // => 9
     */
    daysBetween(date1, date2) {
      if (!this.isValidDate(date1) || !this.isValidDate(date2)) return 0;
      
      const MS_PER_DAY = 1000 * 60 * 60 * 24;
      const utc1 = Date.UTC(date1.getFullYear(), date1.getMonth(), date1.getDate());
      const utc2 = Date.UTC(date2.getFullYear(), date2.getMonth(), date2.getDate());
      
      return Math.floor((utc2 - utc1) / MS_PER_DAY);
    },

    /**
     * Ottiene primo giorno del mese per una data.
     * 
     * @param {Date} date - Date object
     * @returns {Date|null} Primo giorno del mese
     * 
     * @example
     * UTIL.date.getFirstDayOfMonth(new Date(2025, 10, 19)) // => Date(2025, 10, 1)
     */
    getFirstDayOfMonth(date) {
      if (!this.isValidDate(date)) return null;
      return new Date(date.getFullYear(), date.getMonth(), 1);
    },

    /**
     * Ottiene ultimo giorno del mese per una data.
     * 
     * @param {Date} date - Date object
     * @returns {Date|null} Ultimo giorno del mese
     * 
     * @example
     * UTIL.date.getLastDayOfMonth(new Date(2025, 10, 19)) // => Date(2025, 10, 30)
     */
    getLastDayOfMonth(date) {
      if (!this.isValidDate(date)) return null;
      // Trick: giorno 0 del mese successivo = ultimo giorno del mese corrente
      return new Date(date.getFullYear(), date.getMonth() + 1, 0);
    }
  };

  // ============================================================================
  // COLUMN VALIDATION HELPER (Optional micro-utility)
  // ============================================================================
  /**
   * Validates required columns exist in header index.
   * Returns missing columns array, or empty array if all present.
   * Usage: const missing = UTIL.checkColumns(idx, ['Col1', 'Col2']);
   *        if (missing.length) { LOG.error(...); return; }
   * 
   * @param {Object} idx - Header index from SHEETS.headerIndex()
   * @param {string[]} required - Required column names
   * @returns {string[]} Array of missing column names
   */
  function checkColumns(idx, required) {
    return required.filter(col => idx[col] === undefined);
  }

  // ============================================================================
  // RETURN PUBLIC API
  // ============================================================================
  return {
    /**
     * Mostra un messaggio toast temporaneo nella UI del foglio.
     * 
     * @param {string} message - Messaggio da visualizzare
     * @param {string} [title='Info'] - Titolo del toast
     * @param {number} [timeout=5] - Durata in secondi (-1 per permanente)
     * @returns {void}
     */
    showToast: (message, title = 'Info', timeout = 5) => SpreadsheetApp.getActiveSpreadsheet().toast(message, title, timeout),
    /**
     * Parsing robusto di numeri da stringhe.
     * Supporta: formati italiani (1.234,56), inglesi (1,234.56), valute (€ 123).
     * 
     * @param {*} value - Valore da parsare (string, number, null)
     * @returns {number} Numero parsato o 0 se non valido
     * 
     * @example
     * parseNumSmart('1.234,56'); // => 1234.56
     * parseNumSmart('€ 45,99');   // => 45.99
     * parseNumSmart('invalid'); // => 0
     */
    parseNumSmart,
    // XML helpers pubblici
    /**
     * Ottiene il primo child element XML con supporto multi-namespace.
     * Prova in ordine: namespace elemento, extraNs, FPA_NS, FPA_NS10, no namespace.
     * 
     * @param {GoogleAppsScript.XML_Service.Element} element - Elemento XML genitore
     * @param {string} name - Nome del child da cercare
     * @param {GoogleAppsScript.XML_Service.Namespace} [extraNs] - Namespace aggiuntivo da provare
     * @returns {GoogleAppsScript.XML_Service.Element|null} Primo child trovato o null
     */
    firstChild,
    /**
     * Ottiene il testo del primo child element XML.
     * Wrapper di firstChild() + getText() con fallback a stringa vuota.
     * 
     * @param {GoogleAppsScript.XML_Service.Element} element - Elemento XML genitore
     * @param {string} name - Nome del child da cercare
     * @param {GoogleAppsScript.XML_Service.Namespace} [ns] - Namespace opzionale
     * @returns {string} Testo del child o stringa vuota se non trovato
     */
    firstText,
    /**
     * Estrae testo da un nodo XML generico.
     * Supporta Element, Text node, o conversione diretta a stringa.
     * 
     * @param {*} node - Nodo XML o valore da convertire
     * @returns {string} Testo estratto o stringa vuota
     */
    textOf,
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
    writeBatched,
    /**
     * Normalizza una stringa per uso come chiave.
     * Trim + UpperCase per confronti case-insensitive.
     * 
     * @param {string} str - Stringa da normalizzare
     * @returns {string} Stringa normalizzata (trimmed e uppercase)
     */
    normKey: (str) => String(str ?? '').trim().toUpperCase(),
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
    normalizeSupplierId: (id) => {
      const normalized = String(id ?? '')
        .trim()
        .replace(/^IT/i, '')  // Rimuovi prefisso IT
        .replace(/^0+/, '');  // Rimuovi zeri iniziali
      return normalized;
    },
    /**
     * Ottiene tutti i file da una cartella Google Drive ricorsivamente.
     * Attraversa tutte le sottocartelle e gestisce gracefully errori di permessi.
     * 
     * @param {GoogleAppsScript.Drive.Folder} folder - Cartella radice da esplorare
     * @returns {Array<GoogleAppsScript.Drive.File>} Array di file trovati
     */
    getAllFilesRecursive,
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
    updateSheetInPlace,
    /**
     * Forza una cella Google Sheets a interpretare il valore come testo.
     * Aggiunge apostrofo iniziale se necessario (numeri con zeri iniziali, codici).
     * 
     * @param {*} value - Valore da forzare come testo
     * @returns {string} Valore con apostrofo se necessario, altrimenti stringa originale
     * 
     * @example
     * forceText('001');  // => "'001" (previene conversione a numero 1)
     * forceText('ABC');  // => "ABC" (già testo, nessun apostrofo)
     */
    forceText,
    /**
     * Acquisisce un lock globale per prevenire esecuzioni concorrenti.
     * 
     * @param {number} [timeoutMs=10000] - Timeout acquisizione in millisecondi
     * @returns {boolean} True se lock acquisito, false se timeout o già locked
     */
    acquireLock,
    
    /**
     * Rilascia il lock globale precedentemente acquisito.
     * @returns {void}
     */
    releaseLock,
    /**
     * Converte un indice colonna (0-based) in lettera colonna stile A1.
     * 
     * @param {number} colIndex - Indice colonna (0 = 'A', 1 = 'B', ...)
     * @returns {string} Lettera colonna ('A', 'B', ..., 'Z', 'AA', 'AB', ...)
     * 
     * @example
     * getColumnLetter(0);  // => 'A'
     * getColumnLetter(25); // => 'Z'
     * getColumnLetter(26); // => 'AA'
     */
    getColumnLetter,
    /**
     * Valida che tutte le colonne richieste esistano nell'indice header.
     * 
     * @param {Object<string, number>} idx - Indice header da SHEETS.headerIndex()
     * @param {Array<string>} required - Array nomi colonne richieste
     * @returns {Array<string>} Array nomi colonne mancanti (vuoto se tutte presenti)
     * 
     * @example
     * const missing = UTIL.checkColumns(idx, ['FileID', 'NumeroDoc']);
     * if (missing.length) {
     *   throw new Error('Colonne mancanti: ' + missing.join(', '));
     * }
     */
    checkColumns,  // Column validation helper
    // DATE_UTILS namespace
    date: DATE_UTILS
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



const XMLSAFE = (function () {
  const _stripBom = (s) => s.replace(/^\uFEFF/, '');

  function parseDriveXml(fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
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



const STATE = (function () {
  const P = PropertiesService.getScriptProperties();
  const CACHE = CacheService.getScriptCache();
  const CACHE_EXPIRATION_SEC = 21600;
  const MAX_PROP_SIZE = 500000;
  const MAX_CACHE_CHUNK_SIZE = 95000;

  const standard = {
    /**
     * Legge un valore da PropertiesService.
     * 
     * @param {string} key - Chiave da leggere
     * @returns {string|null} Valore memorizzato o null se non esiste
     */
    get: (key) => P.getProperty(key),
    
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
       P.setProperty(key, strValue);
    },
    /**
     * Elimina una chiave da PropertiesService.
     * 
     * @param {string} key - Chiave da eliminare
     * @returns {void}
     */
    clear: (key) => P.deleteProperty(key),
    /**
     * Legge e parsa JSON da PropertiesService.
     * 
     * @param {string} key - Chiave da leggere
     * @param {*} [fallback=null] - Valore di default se chiave non esiste o JSON invalido
     * @returns {*} Oggetto parsato o fallback
     */
    getJSON(key, fallback = null) {
      const raw = P.getProperty(key);
      if (!raw) return fallback;
      try {
          return JSON.parse(raw);
      } catch (e) {
          LOG.warn('STATE_PARSE', `Impossibile parsare JSON da PropertiesService per chiave: ${key}. Valore grezzo: '${raw.substring(0,100)}...'`, { error: e.message });
          try { P.deleteProperty(key); } catch(_) {}
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
        P.setProperty(key, serialized);
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
        try { CACHE.removeAll(oldKeys); } catch (_) {}
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
      try { if (keysToClean.length > 0) CACHE.removeAll(keysToClean); } catch (_) {}

      try {
        if (Object.keys(chunksToSave).length > 0) {
          CACHE.putAll(chunksToSave, CACHE_EXPIRATION_SEC);
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
        const chunksData = CACHE.getAll(keys);

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
          CACHE.removeAll(keys);
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