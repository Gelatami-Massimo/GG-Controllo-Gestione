// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 017_enhanced_logger.js
// RUOLO: Sistema di logging centralizzato e granulare
// NOTE: Ogni operazione viene tracciata nel foglio Log con runId univoco
// =============================================================

const ENHANCED_LOGGER = (() => {
  // Buffer in memoria per scrittura batch
  const logBuffer = [];
  const BUFFER_SIZE = 50;

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

  /**
   * Scrive un log nel foglio Log con formato standardizzato.
   * Usa buffer in memoria per performance; flush automatico ogni BUFFER_SIZE righe.
   * @param {string} runId - ID univoco esecuzione
   * @param {string} scope - Modulo/funzione (es. IMPORT_ROWS, PRODUCTS_CREATE)
   * @param {string} level - Livello: DEBUG, INFO, WARN, ERROR
   * @param {string} message - Messaggio descrittivo
   * @param {Object} [context={}] - Contesto JSON con dettagli
   */
  function log(runId, scope, level, message, context = {}) {
    try {
      // Gate dei log DEBUG per performance quando non in modalità debug
      try {
        if (String(level).toUpperCase() === 'DEBUG') {
          if (!(typeof CONFIG !== 'undefined' && CONFIG && CONFIG.get && CONFIG.get('MODALITA_DEBUG', false) === true)) {
            return; // salta DEBUG se non abilitato
          }
        }
      } catch (_) { /* ignora se CONFIG non ancora pronto */ }

      // Soglia log globale: CONFIG.ROWS_LOG_LEVEL (DEBUG|INFO|WARN|ERROR|OFF)
      try {
        const toVal = (lvl) => {
          switch (String(lvl).toUpperCase()) {
            case 'OFF': return 100;
            case 'ERROR': return 40;
            case 'WARN': return 30;
            case 'INFO': return 20;
            case 'DEBUG': return 10;
            default: return 20;
          }
        };
        if (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.get) {
          const threshold = CONFIG.get('ROWS_LOG_LEVEL', 'INFO');
          if (String(threshold).toUpperCase() === 'OFF') return;
          if (toVal(level) < toVal(threshold)) return; // sotto soglia ⇒ non scrivere
        }
      } catch (_) { /* best-effort: se CONFIG non pronto, prosegui */ }

      const timestamp = new Date();
      const contextStr = Object.keys(context).length > 0 ? JSON.stringify(context) : '';
      
      // Aggiungi al buffer
      logBuffer.push([
        timestamp,
        runId,
        scope,
        level,
        message,
        contextStr
      ]);

      // Flush automatico se buffer pieno
      if (logBuffer.length >= BUFFER_SIZE) {
        _flush();
      }
    } catch (e) {
      // Fallback: usa console come ultima risorsa
      console.error(`[LOGGER_ERROR] ${runId} | ${scope} | ${level} | ${message}`, e);
    }
  }

  /**
   * Scrive il buffer su foglio in un colpo solo (batch write per performance).
   * @private
   */
  function _flush() {
    if (logBuffer.length === 0) return;

    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const logSheet = ss.getSheetByName('Log');
      
      if (!logSheet) {
        console.warn('[ENHANCED_LOGGER] Foglio Log non trovato, buffer perso');
        logBuffer.length = 0; // Svuota comunque per evitare accumulo
        return;
      }

      const nextRow = logSheet.getLastRow() + 1;
      const numRows = logBuffer.length;
      const numCols = 6;

      // Batch write: una sola chiamata setValues
      logSheet.getRange(nextRow, 1, numRows, numCols).setValues(logBuffer);

      // Svuota buffer dopo scrittura
      logBuffer.length = 0;
    } catch (e) {
      console.error('[ENHANCED_LOGGER] Errore flush buffer:', e);
      // Svuota comunque per evitare loop infiniti
      logBuffer.length = 0;
    }
  }

  /**
   * Flush pubblico: forza scrittura immediata del buffer.
   * Chiamare nel finally() dei main script per garantire che tutti i log vengano scritti.
   */
  function flush() {
    _flush();
  }

  /**
   * Helper methods per livelli comuni
   */
  function debug(runId, scope, message, context) {
    log(runId, scope, 'DEBUG', message, context);
  }

  function info(runId, scope, message, context) {
    log(runId, scope, 'INFO', message, context);
  }

  function warn(runId, scope, message, context) {
    log(runId, scope, 'WARN', message, context);
  }

  function error(runId, scope, message, context) {
    log(runId, scope, 'ERROR', message, context);
  }

  /**
   * Assicura che il foglio Log abbia le intestazioni corrette
   */
  function ensureLogHeaders() {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let logSheet = ss.getSheetByName('Log');
      
      if (!logSheet) {
        logSheet = ss.insertSheet('Log');
        logSheet.getRange(1, 1, 1, 6).setValues([['Timestamp', 'RunId', 'Scope', 'Level', 'Message', 'Context']]);
        logSheet.getRange(1, 1, 1, 6).setFontWeight('bold');
        logSheet.setFrozenRows(1);
        return;
      }

      // Verifica se headers esistono
      if (logSheet.getLastRow() === 0) {
        logSheet.getRange(1, 1, 1, 6).setValues([['Timestamp', 'RunId', 'Scope', 'Level', 'Message', 'Context']]);
        logSheet.getRange(1, 1, 1, 6).setFontWeight('bold');
        logSheet.setFrozenRows(1);
      }
    } catch (e) {
      console.error('Errore inizializzazione foglio Log:', e);
    }
  }

  return {
    generateRunId,
    log,
    debug,
    info,
    warn,
    error,
    flush, // Espone flush pubblico per chiamata nei finally
    ensureLogHeaders
  };
})();

// Registra nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('ENHANCED_LOGGER', []);
}

// Registra nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('ENHANCED_LOGGER', ENHANCED_LOGGER);
}
