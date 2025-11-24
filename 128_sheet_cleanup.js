/**
 * @file 128_sheet_cleanup.js
 * @author Massimo Russo <massimo.russo@gelatami.it>
 * @version 1.0.0
 * @description Modulo per la pulizia e manutenzione dei fogli di calcolo.
 */

const SHEET_CLEANUP = (function () {

  /**
   * Controlla se una riga è completamente vuota.
   * @private
   * @param {Array<any>} row - L'array di celle della riga.
   * @returns {boolean} True se la riga è vuota, altrimenti false.
   */
  function _isRowEmpty(row) {
    return row.every(cell => String(cell || '').trim() === '');
  }

  /**
   * Rimuove le righe vuote da un foglio di calcolo specificato.
   * Scansiona il foglio dal basso verso l'alto per evitare problemi con gli indici durante l'eliminazione.
   *
   * @param {string} sheetName - Il nome del foglio da cui rimuovere le righe vuote.
   */
  function deleteEmptyRows(sheetName) {
    if (!sheetName) {
      throw new Error('Il nome del foglio è obbligatorio.');
    }

    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(sheetName);

      if (!sheet) {
        UTIL.showToast(`Foglio "${sheetName}" non trovato.`, 'Errore', 5);
        Logger.log(`[SHEET_CLEANUP] Foglio non trovato: ${sheetName}`);
        return;
      }

      const lastRow = sheet.getLastRow();
      // Se il foglio ha solo l'intestazione o è vuoto, non fare nulla.
      if (lastRow <= 1) {
        UTIL.showToast(`Il foglio "${sheetName}" è già pulito.`, 'Informazione', 5);
        return;
      }
      
      UTIL.showToast(`Avvio pulizia righe vuote dal foglio "${sheetName}"...`, 'Pulizia in corso', 5);

      const range = sheet.getRange(1, 1, lastRow, sheet.getMaxColumns());
      const values = range.getValues();
      let rowsDeleted = 0;

      // Scansiona dal basso verso l'alto per eliminare le righe
      for (let i = values.length - 1; i >= 1; i--) { // i >= 1 per saltare l'intestazione
        if (_isRowEmpty(values[i])) {
          sheet.deleteRow(i + 1); // +1 perché l'array è 0-based
          rowsDeleted++;
        }
      }

      if (rowsDeleted > 0) {
        const message = `Pulizia completata. Rimosse ${rowsDeleted} righe vuote dal foglio "${sheetName}".`;
        UTIL.showToast(message, 'Successo', 10);
        LOG.info('SHEET_CLEANUP', message);
      } else {
        UTIL.showToast(`Nessuna riga vuota trovata nel foglio "${sheetName}".`, 'Informazione', 5);
      }

    } catch (e) {
      const errorMessage = `Errore durante la pulizia del foglio "${sheetName}": ${e.message}`;
      Logger.log(errorMessage);
      UTIL.showToast(errorMessage, 'Errore Critico', 10);
      LOG.error('SHEET_CLEANUP', errorMessage, { stack: e.stack });
    }
  }

  // Esposizione dei metodi pubblici
  return {
    deleteEmptyRows: deleteEmptyRows
  };

})();

// Registra nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('SHEET_CLEANUP', ['UTIL', 'LOG']);
}

// Registra nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('SHEET_CLEANUP', SHEET_CLEANUP);
}
