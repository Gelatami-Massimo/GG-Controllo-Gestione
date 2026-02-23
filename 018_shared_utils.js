// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 018_shared_utils.js
// RUOLO: Utility condivise per eliminazione codice duplicato (Debito Tecnico).
// NOTE: Consolidamento utility generiche da 030_globals.js + pattern ripetuti.
//       Separa LOGICA (utility) da DATI (globals/state).
//       DIPENDENZE: SHEETS, LOG, CONSTANTS (verificare ordine caricamento in .clasp.json)
// =============================================================

const SHARED_UTILS = (function () {

  /**
   * Esegue una callback protetta da ScriptLock con rilascio garantito.
   * @param {Function} callback - Funzione da eseguire sotto lock.
   * @param {number} [timeoutMs=30000] - Timeout acquisizione lock.
   * @returns {*} Risultato della callback.
   * @throws {Error} Se il lock non è ottenibile entro il timeout.
   */
  function withScriptLock(callback, timeoutMs = 30000) {
    const lock = LockService.getScriptLock();
    try {
      const success = lock.tryLock(timeoutMs);
      if (!success) {
        throw new Error('Impossibile ottenere il Lock: sistema occupato.');
      }
      return callback();
    } finally {
      // Rilascio lock garantito
      lock.releaseLock();
    }
  }

  // ============================================================
  // PATTERN #1: SHEET ACCESS CONSOLIDATION (~50 occorrenze)
  // ============================================================
  
  /**
   * Ottiene contesto completo di un foglio in una sola chiamata.
   * Elimina pattern ripetuto ~50 volte: SHEETS.get() + _findHeaderRow() + headerIndex().
   * 
   * @param {string} sheetName - Nome del foglio (da SHEETS.SHEET_NAMES)
   * @returns {{sheet: GoogleAppsScript.Spreadsheet.Sheet, headerRow: number, idx: Object, lastRow: number, lastCol: number, sheetName: string}|null}
   * @throws Non rilancia errori, ritorna null e logga
   * 
   * @example
   * const ctx = SHARED_UTILS.getSheetContext(SHEETS.SHEET_NAMES.Fatture);
   * if (!ctx) {
   *   LOG.error('MY_MODULE', 'Impossibile accedere al foglio Fatture');
   *   return;
   * }
   * const data = ctx.sheet.getRange(ctx.headerRow + 1, 1, ctx.lastRow - ctx.headerRow, ctx.lastCol).getValues();
   */
  function getSheetContext(sheetName) {
    try {
      // Validazione input
      if (!sheetName) {
        LOG.warn('SHARED_UTILS', 'getSheetContext chiamato senza sheetName');
        return null;
      }

      // Accesso foglio
      const sh = SHEETS.get(sheetName);
      if (!sh) {
        LOG.warn('SHARED_UTILS', `Foglio "${sheetName}" non trovato.`);
        return null;
      }

      // Header row (può essere 1 o custom se definito in SCHEMAS)
      const headerRow = SHEETS._findHeaderRow(sh, sheetName);
      
      // Indici colonne
      const idx = SHEETS.headerIndex(sheetName);
      if (!idx || Object.keys(idx).length === 0) {
        LOG.warn('SHARED_UTILS', `Schema non trovato per foglio "${sheetName}"`);
        return null;
      }

      // Dimensioni foglio
      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();

      // Contesto completo
      return {
        sheet: sh,
        headerRow,
        idx,
        lastRow,
        lastCol,
        sheetName // Utile per logging
      };
    } catch (e) {
      LOG.error('SHARED_UTILS', `Errore critico in getSheetContext("${sheetName}")`, { 
        error: e.message, 
        stack: e.stack 
      });
      return null;
    }
  }

  /**
   * Wrapper try-catch unificato con logging e Toast UI automatico.
   * Elimina pattern ripetuto ~60 volte: try { ... } catch(e) { LOG.error + showToast }.
   * 
   * @param {Function} fn - Funzione da eseguire in modo sicuro
   * @param {string} contextName - Nome contesto/modulo per logging (es: 'IMPORT_ROWS', 'DASHBOARD')
   * @param {Object} [options={}] - Opzioni: { errorMessage, showToast, rethrow, onSuccess, onError }
   * @returns {*} Risultato della funzione o null in caso di errore
   * @throws Solo se options.rethrow === true
   * 
   * @example
   * // Caso 1: Esecuzione semplice con error handling automatico
   * const result = SHARED_UTILS.safeExecute(
   *   () => IMPORT_HEADERS.run(),
   *   'IMPORT_HEADERS'
   * );
   * 
   * @example
   * // Caso 2: Con messaggio custom e callback success
   * SHARED_UTILS.safeExecute(
   *   () => {
   *     const data = processData();
   *     return data;
   *   },
   *   'DATA_PROCESSING',
   *   {
   *     errorMessage: 'Errore durante elaborazione dati',
   *     showToast: true,
   *     onSuccess: (result) => LOG.info('PROCESS', `Elaborati ${result.length} records`)
   *   }
   * );
   * 
   * @example
   * // Caso 3: Senza Toast, con rilancio errore
   * try {
   *   SHARED_UTILS.safeExecute(
   *     () => criticalOperation(),
   *     'CRITICAL_OP',
   *     { showToast: false, rethrow: true }
   *   );
   * } catch (e) {
   *   // Handle error
   * }
   */
  function safeExecute(fn, contextName, options = {}) {
    const {
      errorMessage = 'Si è verificato un errore',
      showToast = true,
      rethrow = false,
      onSuccess = null,
      onError = null
    } = options;

    try {
      // Esegui funzione
      const result = fn();

      // Callback success (opzionale)
      if (typeof onSuccess === 'function') {
        try {
          onSuccess(result);
        } catch (callbackError) {
          LOG.warn('SHARED_UTILS', `Errore in callback onSuccess di ${contextName}`, { 
            error: callbackError.message 
          });
        }
      }

      return result;
    } catch (e) {
      // Logging errore strutturato
      if (typeof LOG !== 'undefined' && LOG && LOG.error) {
        LOG.error(contextName, errorMessage, { 
          error: e.message, 
          stack: e.stack,
          name: e.name,
          fileName: e.fileName || 'unknown',
          lineNumber: e.lineNumber || 'unknown'
        });
      } else {
        console.error(`[FALLBACK LOG] ${contextName}: ${errorMessage}`, e);
      }

      // Toast UI (se abilitato e disponibile)
      if (showToast) {
        try {
          const toastMessage = `${errorMessage}\n\nDettagli: ${e.message}`;
          UTIL.showToast(toastMessage, 'Errore', 10);
        } catch (toastError) {
          // Fallback silenzioso se UI non disponibile (esecuzione trigger/batch)
          console.log(`[ERROR] ${contextName}: ${errorMessage} - ${e.message}`);
        }
      }

      // Callback error (opzionale)
      if (typeof onError === 'function') {
        try {
          onError(e);
        } catch (callbackError) {
          if (typeof LOG !== 'undefined' && LOG && LOG.error) {
            LOG.error('SHARED_UTILS', `Errore critico in callback onError di ${contextName}`, { 
              error: callbackError.message 
            });
          } else {
            console.error(`[FALLBACK LOG] SHARED_UTILS: Errore critico in callback onError di ${contextName}`, callbackError);
          }
        }
      }

      // Rilancio errore (se richiesto)
      if (rethrow) {
        throw e;
      }

      return null; // Default: assorbi errore e ritorna null
    }
  }

  /**
   * Valida se un valore è una data valida.
   * Elimina pattern ripetuto ~25 volte: (d instanceof Date && !isNaN(d.getTime())).
   * 
   * @param {*} dateValue - Valore da validare
   * @returns {boolean} TRUE se data valida, FALSE altrimenti
   * 
   * @example
   * const dataDoc = row[idx.Data];
   * if (SHARED_UTILS.isValidDate(dataDoc)) {
   *   const anno = dataDoc.getFullYear();
   *   // ... processa data
   * } else {
   *   LOG.warn('VALIDATION', 'Data invalida nella riga', { data: dataDoc });
   * }
   */
  function isValidDate(dateValue) {
    // Null/undefined check
    if (!dateValue) return false;
    
    // Type check
    if (!(dateValue instanceof Date)) return false;
    
    // Invalid Date check (es: new Date('invalid') → Invalid Date)
    if (isNaN(dateValue.getTime())) return false;
    
    return true;
  }

  // ============================================================
  // UTILITY GENERICHE DA 030_globals.js (MIGRATED)
  // ============================================================

  /**
   * Mostra un messaggio toast temporaneo nella UI del foglio.
   * 
   * @param {string} message - Messaggio da visualizzare
   * @param {string} [title='Info'] - Titolo del toast
   * @param {number} [timeout=5] - Durata in secondi (-1 per permanente)
   * @returns {void}
   */
  function showToast(message, title = 'Info', timeout = 5) {
    try {
      SpreadsheetApp.getActiveSpreadsheet().toast(message, title, timeout);
    } catch (e) {
      console.log(`[TOAST] ${title}: ${message}`);
    }
  }

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

  /**
   * Valida che tutte le colonne richieste esistano nell'indice header.
   * 
   * @param {Object<string, number>} idx - Indice header da SHEETS.headerIndex()
   * @param {Array<string>} required - Array nomi colonne richieste
   * @returns {Array<string>} Array nomi colonne mancanti (vuoto se tutte presenti)
   * 
   * @example
   * const missing = SHARED_UTILS.checkColumns(idx, ['FileID', 'NumeroDoc']);
   * if (missing.length) {
   *   throw new Error('Colonne mancanti: ' + missing.join(', '));
   * }
   */
  function checkColumns(idx, required) {
    return required.filter(col => idx[col] === undefined);
  }

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
  function forceText(value) {
    const str = String(value ?? '');
    if (!str) return '';
    if (str.startsWith("'")) return str;
    const trimmedStr = str.trim();
    // Se inizia con 0 seguito da cifre, o sembra numerico → forza testo
    if (/^0\d+$/.test(trimmedStr) || _looksNumericLike(trimmedStr)) {
      return "'" + str;
    }
    return str;
  }

  /**
   * Helper interno: verifica se stringa sembra un numero.
   * @private
   */
  function _looksNumericLike(str) {
    const s = String(str ?? '').trim();
    if (!s) return false;
    const cleaned = s.replace(/[€$£\s]/g, '');
    return /^-?[\d.,]+$/.test(cleaned);
  }

  // ============================================================
  // UTILITY BONUS (Pattern frequenti)
  // ============================================================

  /**
   * Mostra Toast e logga in modo unificato (pattern ~40 occorrenze).
   * 
   * @param {string} message - Messaggio
   * @param {string} title - Titolo toast
   * @param {string} contextName - Nome contesto per log
   * @param {string} [level='info'] - Livello: 'info', 'warn', 'error', 'debug'
   * @param {number} [duration=5] - Durata toast (-1 = persistente)
   */
  function showToastAndLog(message, title, contextName, level = 'info', duration = 5) {
    // Toast UI
    showToast(message, title, duration);

    // Log
    if (LOG && typeof LOG[level] === 'function') {
      LOG[level](contextName, message);
    } else {
      console.log(`[${level.toUpperCase()}] ${contextName}: ${message}`);
    }
  }

  /**
   * Normalizza stringa per confronti (uppercase, trim, spazi singoli).
   * 
   * @param {*} value - Valore da normalizzare
   * @returns {string} Stringa normalizzata
   */
  function normalizeString(value) {
    if (!value && value !== 0) return '';
    return String(value).trim().toUpperCase().replace(/\s+/g, ' ');
  }

  /**
   * Converte a numero con fallback.
   * 
   * @param {*} value - Valore da convertire
   * @param {number} [defaultValue=0] - Default se conversione fallisce
   * @returns {number} Numero o default
   */
  function toNumber(value, defaultValue = 0) {
    if (value === null || value === undefined || value === '') return defaultValue;
    const num = Number(value);
    return isNaN(num) ? defaultValue : num;
  }

  /**
   * Converte a booleano (supporta 'true', 'vero', '1', 'si', etc).
   * 
   * @param {*} value - Valore da convertire
   * @param {boolean} [defaultValue=false] - Default se non riconosciuto
   * @returns {boolean} Booleano o default
   */
  function toBoolean(value, defaultValue = false) {
    if (value === null || value === undefined || value === '') return defaultValue;
    if (typeof value === 'boolean') return value;
    const str = String(value).trim().toLowerCase();
    if (str === 'true' || str === 'vero' || str === '1' || str === 'si' || str === 'yes') return true;
    if (str === 'false' || str === 'falso' || str === '0' || str === 'no') return false;
    return defaultValue;
  }

  // ============================================================
  // DATE_UTILS - Utility centralizzate per gestione date
  // MIGRATED FROM: 030_globals.js (UTIL.date namespace)
  // ============================================================
  
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
   * @namespace DATE_UTILS
   */
  const DATE_UTILS = {
    
    /**
     * Parsa data da stringa XML (formato ISO 8601).
     * Supporta: YYYY-MM-DD, YYYY-MM-DDTHH:MM:SS, YYYY-MM-DDTHH:MM:SS.sssZ
     * 
     * @param {string|Date} dateInput - Data formato ISO o Date object
     * @returns {Date|null} Date object o null se invalida
     */
    parseXmlDate(dateInput) {
      if (!dateInput) return null;
      
      if (dateInput instanceof Date) {
        return isNaN(dateInput.getTime()) ? null : dateInput;
      }
      
      if (typeof dateInput !== 'string') return null;
      
      const trimmed = dateInput.trim();
      const isoMatch = trimmed.match(CONSTANTS.DATE_PATTERNS.ISO_DATE);
      
      if (!isoMatch) return null;
      
      const groups = CONSTANTS.DATE_REGEX_GROUPS.ISO;
      const year = +isoMatch[groups.YEAR];
      const month = +isoMatch[groups.MONTH] - 1; // 0-based
      const day = +isoMatch[groups.DAY];

      // Range check rapido
      if (month < 0 || month > 11 || day < 1 || day > 31 || year < 1970 || year > 2100) return null;

      const date = new Date(year, month, day);
      // Round-trip check: rileva overflow (es: 30/02 → 02/03)
      if (isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
      return date;
    },

    /**
     * Formatta Date come stringa YYYY-MM-DD (ISO).
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
     */
    formatItalianDate(date) {
      if (!(date instanceof Date) || isNaN(date.getTime())) return '';
      
      try {
        const formatter = new Intl.DateTimeFormat('it-IT', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        });
        return formatter.format(date);
      } catch (e) {
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
     * @returns {{anno: string, mese: number}} Anno (YYYY) e mese (1-12)
     */
    extractYearMonth(date) {
      if (!(date instanceof Date) || isNaN(date.getTime())) {
        return { anno: '', mese: 0 };
      }
      
      return {
        anno: String(date.getFullYear()),
        mese: date.getMonth() + 1
      };
    },

    /**
     * Ottiene nome mese italiano completo da numero (1-12).
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
     */
    getShortMonthName(monthNumber, yearSuffix = '') {
      const shortNames = [
        'Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu',
        'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'
      ];
      
      const month = Number(monthNumber);
      if (month < 1 || month > 12 || isNaN(month)) return 'N/A';
      
      const name = shortNames[month - 1];
      return yearSuffix ? `${name} ${yearSuffix}` : name;
    },

    /**
     * Parsa data italiana DD/MM/YYYY in Date object.
     */
    parseItalianDate(italianDateStr) {
      if (!italianDateStr || typeof italianDateStr !== 'string') return null;
      
      const trimmed = italianDateStr.trim();
      const match = trimmed.match(CONSTANTS.DATE_PATTERNS.ITALIAN_DATE);
      
      if (!match) return null;
      
      const groups = CONSTANTS.DATE_REGEX_GROUPS.ITALIAN;
      const day = +match[groups.DAY];
      const month = +match[groups.MONTH] - 1; // 0-based
      const year = +match[groups.YEAR];

      // Range check rapido
      if (month < 0 || month > 11 || day < 1 || day > 31 || year < 1970 || year > 2100) return null;

      const date = new Date(year, month, day);
      // Round-trip check: rileva overflow (es: 30/02 → 02/03)
      if (isNaN(date.getTime()) || date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null;
      return date;
    },

    /**
     * Formatta Date in formato lungo italiano ("19 novembre 2025").
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
     */
    daysBetween(date1, date2) {
      if (!isValidDate(date1) || !isValidDate(date2)) return 0;
      
      const MS_PER_DAY = 1000 * 60 * 60 * 24;
      const utc1 = Date.UTC(date1.getFullYear(), date1.getMonth(), date1.getDate());
      const utc2 = Date.UTC(date2.getFullYear(), date2.getMonth(), date2.getDate());
      
      return Math.floor((utc2 - utc1) / MS_PER_DAY);
    },

    /**
     * Ottiene primo giorno del mese per una data.
     */
    getFirstDayOfMonth(date) {
      if (!isValidDate(date)) return null;
      return new Date(date.getFullYear(), date.getMonth(), 1);
    },

    /**
     * Ottiene ultimo giorno del mese per una data.
     */
    getLastDayOfMonth(date) {
      if (!isValidDate(date)) return null;
      return new Date(date.getFullYear(), date.getMonth() + 1, 0);
    }
  };

  // ============================================================
  // API PUBBLICA
  // ============================================================
  return {
    // Pattern #1: Sheet Access Consolidation
    getSheetContext,
    
    // Pattern #2: Try-Catch + Log Wrapper
    safeExecute,
    
    // Pattern #3: Date Validation
    isValidDate,
    
    // Utility Generiche (da UTIL migrated)
    showToast,
    getColumnLetter,
    checkColumns,
    forceText,
    
    // Utility Bonus
    showToastAndLog,
    normalizeString,
    toNumber,
    toBoolean,
    
    // Namespace Date (completo da UTIL.date)
    date: DATE_UTILS
  };
})();

// ============================================================
// REGISTRAZIONE MODULO
// ============================================================

// Registra SHARED_UTILS nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('SHARED_UTILS', ['SHEETS', 'LOG', 'CONSTANTS']);
}

// Registra SHARED_UTILS nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('SHARED_UTILS', SHARED_UTILS);
}

// Espone SHARED_UTILS in globalThis per dependency tracking
if (typeof globalThis !== 'undefined') {
  globalThis.SHARED_UTILS = SHARED_UTILS;
}
