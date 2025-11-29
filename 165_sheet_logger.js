/**
 * @file 165_sheet_logger.js
 * @author Massimo Russo <massimo.russo@gelatami.it>
 * @version 1.0.0
 * @description Modulo per la gestione del logging su un foglio di calcolo dedicato.
 * Questo modulo centralizza la creazione e la scrittura su un foglio di log,
 * fornendo un'interfaccia semplice per registrare i risultati delle operazioni.
 */

const SHEET_LOGGER = (function () {
  const LOG_SHEET_NAME = 'Log Validazione';

  /**
   * Scrive un report su un foglio di log dedicato.
   * Se il foglio non esiste, viene creato.
   * Il foglio viene pulito prima di ogni scrittura.
   *
   * @param {string} reportTitle - Il titolo del report, che verrà inserito nella prima riga.
   * @param {string} reportContent - Il contenuto del report.
   */
  function log(reportTitle, reportContent) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let logSheet = ss.getSheetByName(LOG_SHEET_NAME);

      if (!logSheet) {
        logSheet = ss.insertSheet(LOG_SHEET_NAME);
        _formatHeader(logSheet);
      }

      // Pulisce il foglio escludendo la riga dell'intestazione
      logSheet.getRange(2, 1, logSheet.getMaxRows() - 1, logSheet.getMaxColumns()).clear();

      // Scrive il titolo e il contenuto
      const titleRange = logSheet.getRange('A1');
      titleRange.setValue(reportTitle);

      if (reportContent) {
        const contentRange = logSheet.getRange('A2');
        contentRange.setValue(reportContent);
      }

      // Adatta la larghezza delle colonne
      logSheet.autoResizeColumn(1);

      // Attiva il foglio per renderlo visibile all'utente
      logSheet.activate();

    } catch (e) {
      Logger.log(`Errore durante la scrittura sul foglio di log: ${e.toString()}`);
      // Fallback sul logger standard in caso di errore
      Logger.log(reportTitle);
      Logger.log(reportContent);
    }
  }

  /**
   * Formatta la riga di intestazione del foglio di log.
   * @private
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Il foglio di log.
   */
  function _formatHeader(sheet) {
    const headerRange = sheet.getRange('A1');
    headerRange.setFontWeight('bold').setBackground('#f3f3f3').setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
  }

  // Esposizione dei metodi pubblici
  return {
    log: log
  };

})();

// Registra SHEET_LOGGER nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('SHEET_LOGGER', []); // No dependencies
}

// Registra SHEET_LOGGER nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('SHEET_LOGGER', SHEET_LOGGER);
}

// Espone SHEET_LOGGER in globalThis per dependency tracking
if (typeof globalThis !== 'undefined') {
  globalThis.SHEET_LOGGER = SHEET_LOGGER;
}
