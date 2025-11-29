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
   * Rimuove le righe vuote da un foglio di calcolo specificato in modo efficiente.
   * Legge tutti i dati, filtra le righe non vuote in memoria e le riscrive,
   * minimizzando le chiamate all'API di Spreadsheet.
   *
   * @param {string} sheetName - Il nome del foglio da cui rimuovere le righe vuote.
   */
  function deleteEmptyRows(sheetName) {
    if (!sheetName) {
      throw new Error('Il nome del foglio è obbligatorio.');
    }

    const PROTECTED_SHEETS = ['Dashboard', 'Conto Economico', 'Report Controllo', 'Config'];
    if (PROTECTED_SHEETS.some(protectedName => sheetName.includes(protectedName))) {
      UTIL.showToast(`Operazione annullata: Il foglio "${sheetName}" è protetto (contiene formule).`, 'Sicurezza', 10);
      LOG.warn('SHEET_CLEANUP', `Tentativo di pulizia bloccato su foglio protetto: ${sheetName}`);
      return;
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
      const maxCols = sheet.getMaxColumns();
      
      // Se il foglio ha solo l'intestazione o è vuoto, non fare nulla.
      if (lastRow <= 1) {
        UTIL.showToast(`Il foglio "${sheetName}" è già pulito.`, 'Informazione', 5);
        return;
      }
      
      UTIL.showToast(`Avvio pulizia efficiente del foglio "${sheetName}"...`, 'Pulizia in corso', 10);

      const range = sheet.getRange(1, 1, lastRow, maxCols);
      const allValues = range.getValues();
      
      const header = allValues[0];
      const dataRows = allValues.slice(1);

      // Filtra le righe mantenendo solo quelle che non sono vuote
      const nonEmptyRows = dataRows.filter(row => !_isRowEmpty(row));
      
      const originalDataRowsCount = dataRows.length;
      const finalDataRowsCount = nonEmptyRows.length;
      const rowsDeleted = originalDataRowsCount - finalDataRowsCount;

      if (rowsDeleted > 0) {
        // Pulisci l'intero foglio (dati)
        if (lastRow > 1) {
            sheet.getRange(2, 1, lastRow - 1, maxCols).clearContent();
        }

        // Se ci sono righe di dati rimaste, scrivile di nuovo
        if (finalDataRowsCount > 0) {
          sheet.getRange(2, 1, finalDataRowsCount, header.length).setValues(nonEmptyRows);
        }
        
        // Se il numero di righe è cambiato, elimina le righe fisiche in eccesso alla fine
        const newMaxRows = finalDataRowsCount + 1;
        if (sheet.getMaxRows() > newMaxRows) {
            sheet.deleteRows(newMaxRows + 1, sheet.getMaxRows() - newMaxRows);
        }

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
