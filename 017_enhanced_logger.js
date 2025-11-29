// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 017_enhanced_logger.js
// RUOLO: Sistema di logging centralizzato e granulare
// NOTE: Ogni operazione viene tracciata nel foglio Log con runId univoco
// =============================================================

const ENHANCED_LOGGER = (() => {
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

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const logSheet = ss.getSheetByName('Log');
      if (!logSheet) return; // Fallback silenzioso se foglio Log non esiste

      const timestamp = new Date();
      const contextStr = Object.keys(context).length > 0 ? JSON.stringify(context) : '';
      
      logSheet.appendRow([
        timestamp,
        runId,
        scope,
        level,
        message,
        contextStr
      ]);
    } catch (e) {
      // Fallback: usa console come ultima risorsa (dovrebbe essere raro)
      console.error(`[LOGGER_ERROR] ${runId} | ${scope} | ${level} | ${message}`, e);
    }
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
