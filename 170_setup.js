// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 170_setup.js
// VERSIONE: 25.0 (Setup Assistant)
// DESCRIZIONE: Setup guidato (cartelle, fogli, configurazione).
// =============================================================

const SETUP = (function () {

  function run() {
    const ui = SpreadsheetApp.getUi();

    // 1) Se esiste già una configurazione valida, chiedi conferma sovrascrittura
    const cfgSheet = SHEETS.get(SHEETS.SHEET_NAMES.Config);
    if (cfgSheet && cfgSheet.getLastRow() > 1 && _safeFindConfigValue(cfgSheet, 'CARTELLA_INPUT_ID')) {
      const overwrite = ui.alert('Attenzione!', 'Setup già eseguito. Vuoi sovrascrivere le impostazioni?', ui.ButtonSet.YES_NO);
      if (overwrite !== ui.Button.YES) return;
    }

    // 2) ID Cartella INPUT
    const inputIdPrompt = ui.prompt(
      'Setup (1/3): Cartella Input',
      'Crea una cartella "1. XML Input" su Drive e incolla qui l\'ID o l\'intero link:',
      ui.ButtonSet.OK_CANCEL
    );
    if (inputIdPrompt.getSelectedButton() !== ui.Button.OK) return;
    const inputId = _extractIdFromInput(inputIdPrompt.getResponseText());
    if (!inputId) throw new Error('ID cartella input non valido.');

    // 3) ID Cartella OUTPUT
    const outputIdPrompt = ui.prompt(
      'Setup (2/3): Cartella Output',
      'Crea una cartella "2. PDF Output" su Drive e incolla qui il suo ID o link:',
      ui.ButtonSet.OK_CANCEL
    );
    if (outputIdPrompt.getSelectedButton() !== ui.Button.OK) return;
    const outputId = _extractIdFromInput(outputIdPrompt.getResponseText());
    if (!outputId) throw new Error('ID cartella output non valido.');

    // 4) Frequenza trigger (minuti)
    const trigPrompt = ui.prompt(
      'Setup (3/3): Frequenza Import Automatico',
      // --- TESTO MODIFICATO ---
      'Inserisci i minuti per l\'attivatore automatico (consigliati: 15). Valori consentiti: 1, 5, 10, 15, 30. Il sistema arrotonderà al valore consentito più vicino.',
      // --- FINE MODIFICA ---
      ui.ButtonSet.OK_CANCEL
    );
    if (trigPrompt.getSelectedButton() !== ui.Button.OK) return;
    const rawMin = Number((trigPrompt.getResponseText() || '').trim());
    const triggerEveryMin = (Number.isFinite(rawMin) && rawMin > 0) ? rawMin : 15; // Logica invariata, Apps Script arrotonda da solo

    // 5) Verifica permessi cartelle
    UTIL.showToast('Verifico gli ID delle cartelle...', 'Setup');
    let inputFolder, outputFolder;
    try { inputFolder = DriveApp.getFolderById(inputId); }
    catch (e) { throw new Error('ID cartella INPUT non valido o permessi mancanti.'); }
    try { outputFolder = DriveApp.getFolderById(outputId); }
    catch (e) { throw new Error('ID cartella OUTPUT non valido o permessi mancanti.'); }

    // 6) Preparazione fogli
    UTIL.showToast('Creazione e formattazione fogli...', 'Setup');
    SHEETS.ensureAll();
    SHEETS.applyFormats();

    // 7) Scrittura configurazione
    UTIL.showToast('Scrittura configurazione...', 'Setup');
    _writeConfiguration(inputId, outputId, triggerEveryMin);
    
    // --- CORREZIONE ---
    // Rimuoviamo la chiamata a DEBUG.clearCache() da qui perché
    // DEBUG.clearCache() usa ui.alert, che va in conflitto con i prompt.
    // L'utente deve premere "Pulisci Cache" manualmente DOPO il setup.
    CONFIG.invalidateCache();
    SHEETS.invalidateHeaderIndexCache();
    // --- FINE CORREZIONE ---


    // 8) Messaggio di successo + sanity check
    const successMessage =
      `Setup completato!\n\n` +
      `• Input: "${inputFolder.getName()}"\n` +
      `• Output: "${outputFolder.getName()}"\n` +
      `• Trigger: ogni ~${triggerEveryMin} minuti (verrà normalizzato da Apps Script al valore consentito più vicino)\n\n` +
      `IMPORTANTE: Esegui "Pulisci Cache e Cursori" manualmente prima di avviare la prima importazione.`;
    ui.alert('Setup Completato!', successMessage, ui.ButtonSet.OK);

    LOG.info('SETUP', 'Setup eseguito con successo.');
    DEBUG.sanityCheck();
  }

  function _extractIdFromInput(input) {
    const trimmed = (input || '').trim();
    let match = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{20,})/);
    if (match && match[1]) return match[1];
    match = trimmed.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
    if (match && match[1]) return match[1];
    match = trimmed.match(/id=([a-zA-Z0-9_-]{20,})/);
    if (match && match[1]) return match[1];
    // Riconosce anche solo l'ID incollato direttamente
    if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
    return null;
  }

  function _writeConfiguration(inputId, outputId, triggerEveryMin) {
    const cfgSheet = SHEETS.get(SHEETS.SHEET_NAMES.Config);
    if (!cfgSheet) throw new Error("Impossibile trovare/creare il foglio 'Config'.");

    const headerRow = SHEETS._findHeaderRow(cfgSheet, SHEETS.SHEET_NAMES.Config);
    if (cfgSheet.getLastRow() > headerRow) {
      cfgSheet.getRange(headerRow + 1, 1, cfgSheet.getLastRow() - headerRow, 3).clearContent();
    }

    // Dati di configurazione
    const configData = [
      ['CARTELLA_INPUT_ID', inputId, "ID della cartella '1. XML Input'."],
      ['CARTELLA_OUTPUT_ID', outputId, "ID della cartella '2. PDF Output'."],
      ['TRIGGER_EVERY_MIN', triggerEveryMin, 'Frequenza (minuti) import automatico. Valori: 1,5,10,15,30 (arrotondato al più vicino).'],
      ['MAX_RUNTIME_SEC', 240, 'Secondi massimi di esecuzione per un processo (consigliato 240-300).'],
      ['IMPORT_RIGHE_DEFAULT', false, "Importare le righe per i nuovi fornitori? (true/false)."],
      ['CATEGORIE_ESCLUSE_MAGAZZINO', 'sconto, attrezzatura, canvass, omaggio, servizi', 'Categorie Prodotto da escludere dal Magazzino (separate da virgola).'],
      ['MODALITA_DEBUG', false, 'Abilita log dettagliati? (true/false)'],
      ['ROWS_CHUNK_SIZE', 100, 'Numero fatture da leggere in blocco (Import Righe).'],
      ['ROWS_FLUSH_EVERY', 2000, 'Ogni quante righe salvare sul foglio (Import Righe).'],
      ['PDF_CHUNK_SIZE', 80, 'Numero fatture da leggere in blocco (Crea PDF).'],
      ['PDF_FLUSH_EVERY', 200, 'Ogni quanti link PDF aggiornare sul foglio (Crea PDF).'],
      ['ROWS_TOLLERANZA_EURO', 1.00, 'Tolleranza (in €) per mismatch Totale Fattura vs Somma Righe (Import Righe).'],
      ['ADMIN_EMAIL', Session.getActiveUser().getEmail(), 'Email destinatario notifiche trigger (errori, import completata).'],
      ['TRIGGER_NOTIFY_ON_ACTIVE', 'FALSE', 'Inviare email anche quando trigger rimane attivo? (true/false). Default: FALSE.']
    ];

    cfgSheet.getRange(headerRow + 1, 1, configData.length, 3).setValues(configData);
    CONFIG.invalidateCache();
  }

  function _safeFindConfigValue(cfgSheet, keyName) {
    try {
      if (!cfgSheet || cfgSheet.getLastRow() < 2) return false;
      const headerRow = SHEETS._findHeaderRow(cfgSheet, SHEETS.SHEET_NAMES.Config);
      if (cfgSheet.getLastRow() <= headerRow) return false;
      const values = cfgSheet.getRange(headerRow + 1, 1, cfgSheet.getLastRow() - headerRow, 1).getValues();
      // Usiamo find invece di some per efficienza (si ferma al primo trovato)
      return values.flat().find(key => String(key ?? '').trim() === keyName) !== undefined;
    } catch (e) {
      LOG.warn('SETUP_SAFE_FIND', 'Errore durante _safeFindConfigValue', { error: e.message });
      return false;
    }
  }

  return { run };
})();

// Registra SETUP nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('SETUP', ['SHEETS', 'UTIL', 'CONFIG', 'LOG', 'DEBUG']);
}

// Registra SETUP nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('SETUP', SETUP);
}