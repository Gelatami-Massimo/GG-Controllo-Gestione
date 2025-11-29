/**
 * @OnlyCurrentDoc
 *
 * Questo script temporaneo corregge i prodotti esistenti nel foglio 'Prodotti'
 * che hanno il campo 'UM' (Unità di Misura) vuoto, impostandolo al valore
 * predefinito 'PZ'.
 *
 * Verrà eseguito una sola volta per sanare i dati pregressi.
 */
function fixMissingUmInProducts() {
  const SHEET_NAME = 'Prodotti';
  const COLUMN_NAME_UM = 'UM';
  const COLUMN_NAME_CIB = 'CodiceInternoBreve';
  const DEFAULT_UM = 'PZ';

  const ui = SpreadsheetApp.getUi();

  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
    if (!sh) {
      throw new Error(`Foglio '${SHEET_NAME}' non trovato.`);
    }

    const headerRow = SHEETS._findHeaderRow(sh, SHEET_NAME);
    if (headerRow < 1) {
      throw new Error(`Impossibile trovare la riga di intestazione in '${SHEET_NAME}'.`);
    }

    const headers = sh.getRange(headerRow, 1, 1, sh.getLastColumn()).getValues()[0];
    const umColIdx = headers.indexOf(COLUMN_NAME_UM);
    const cibColIdx = headers.indexOf(COLUMN_NAME_CIB);

    if (umColIdx === -1) {
      throw new Error(`Colonna '${COLUMN_NAME_UM}' non trovata nel foglio '${SHEET_NAME}'.`);
    }
     if (cibColIdx === -1) {
      throw new Error(`Colonna '${COLUMN_NAME_CIB}' non trovata. Impossibile identificare i prodotti.`);
    }

    const lastRow = sh.getLastRow();
    if (lastRow <= headerRow) {
      ui.alert('Nessun dato da elaborare nel foglio Prodotti.');
      return;
    }

    const dataRange = sh.getRange(headerRow + 1, 1, lastRow - headerRow, sh.getLastColumn());
    const values = dataRange.getValues();

    let updatedCount = 0;
    const updates = {}; // Oggetto per memorizzare gli aggiornamenti {riga: {colonna: valore}}

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      const currentUm = row[umColIdx];
      const productCode = row[cibColIdx];

      if (!currentUm || String(currentUm).trim() === '') {
        const sheetRowNum = headerRow + 1 + i;
        if (!updates[sheetRowNum]) {
            updates[sheetRowNum] = {};
        }
        updates[sheetRowNum][umColIdx] = DEFAULT_UM;
        updatedCount++;
        console.log(`Prodotto '${productCode}' (riga ${sheetRowNum}) aggiornato con UM = '${DEFAULT_UM}'.`);
      }
    }

    if (updatedCount > 0) {
      // Applica gli aggiornamenti in modo efficiente
      UTIL.updateSheetInPlace(sh, updates, headerRow);
      ui.alert('Correzione completata', `Sono stati aggiornati ${updatedCount} prodotti impostando l'Unità di Misura a '${DEFAULT_UM}'.`, ui.ButtonSet.OK);
      LOG.info('FIX_MISSING_UM', `Aggiornati ${updatedCount} prodotti con UM mancante.`);
    } else {
      ui.alert('Nessuna modifica necessaria', 'Tutti i prodotti hanno già un\'Unità di Misura.', ui.ButtonSet.OK);
    }

  } catch (e) {
    LOG.error('FIX_MISSING_UM', 'Errore durante la correzione delle UM mancanti.', { error: e.message, stack: e.stack });
    ui.alert('Errore', `Si è verificato un errore: ${e.message}`, ui.ButtonSet.OK);
  }
}
