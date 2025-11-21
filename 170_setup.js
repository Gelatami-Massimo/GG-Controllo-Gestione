// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 170_setup.js
// RUOLO: Setup guidato iniziale con manutenzione completa automatica.
// NOTE: Crea fogli, applica formati, inizializza trigger dashboard.
// =============================================================

const SETUP = (function () {

  /**
   * Setup guidato iniziale con configurazione cartelle, trigger e manutenzione completa.
   * 
   * Workflow:
   * 1. Prompt utente per:
   *    a. ID Cartella INPUT (XML fatture)
   *    b. ID Cartella OUTPUT (PDF generati)
   *    c. Frequenza trigger automatico (minuti: 1, 5, 10, 15, 30)
   * 2. Verifica permessi accesso cartelle Drive
   * 3. Creazione struttura fogli:
   *    - SHEETS.ensureAll(): crea fogli mancanti (Config, Fatture, Righe, Prodotti, Fornitori, ecc.)
   *    - SHEETS.applyFormats(): applica formati personalizzati (valuta, date, ecc.)
   *    - TRIGGER_DASHBOARD.initSheet(): prepara foglio Trigger Status
   * 4. Scrittura configurazione nel foglio Config
   * 5. Manutenzione automatica:
   *    a. DEBUG.forceTextFormatOnCodes(): Forza formato testo su codici (FileID, CodiceInterno, ecc.)
   *    b. DEBUG.manageDuplicateInvoices(): Marca fatture duplicate (FileId duplicati)
   *    c. DEBUG.manageDuplicateRows(): Marca righe duplicate (FileId|NumeroLinea duplicati)
   *    d. DEBUG.sanityCheck(): Verifica integrità dati (setup completo)
   * 6. Mostra messaggio successo con riepilogo configurazione
   * 
   * NOTA: Se CONFIG già esiste, chiede conferma sovrascrittura.
   * 
   * @returns {void}
   * @throws {Error} Se ID cartelle non validi o permessi mancanti
   * 
   * @example
   * SETUP.run();
   */
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
    
    // 6.1) Inizializza Dashboard Trigger
    if (typeof TRIGGER_DASHBOARD !== 'undefined' && TRIGGER_DASHBOARD.initSheet) {
      UTIL.showToast('Inizializzazione Dashboard Trigger...', 'Setup');
      TRIGGER_DASHBOARD.initSheet();
    }

    // 7) Scrittura configurazione
    UTIL.showToast('Scrittura configurazione...', 'Setup');
    _writeConfiguration(inputId, outputId, triggerEveryMin);
    
    CONFIG.invalidateCache();
    SHEETS.invalidateHeaderIndexCache();

    // ✅ 8) Manutenzione completa finale (filtri, formati codici, duplicati, integrità)
    UTIL.showToast('Applicazione formati e verifica integrità...', 'Setup');
    DEBUG.forceTextFormatOnCodes();   // Forza testo su codici
    DEBUG.manageDuplicateInvoices();  // Marca duplicati fatture (silenzioso)
    DEBUG.manageDuplicateRows();      // Marca duplicati righe (silenzioso)
    DEBUG.sanityCheck();              // Verifica integrità dati

    // 9) Messaggio di successo
    const successMessage =
      `Setup completato con successo!\n\n` +
      `✅ Cartelle configurate:\n` +
      `• Input: "${inputFolder.getName()}"\n` +
      `• Output: "${outputFolder.getName()}"\n\n` +
      `✅ Trigger: ogni ~${triggerEveryMin} minuti\n` +
      `✅ Filtri applicati su tutti i fogli\n` +
      `✅ Formati codici verificati\n` +
      `✅ Duplicati verificati e marcati\n` +
      `✅ Integrità dati controllata\n\n` +
      `NOTA: Se necessario, usa "Pulisci Cache" dal menu prima della prima importazione.`;
    ui.alert('🎉 Setup Completato!', successMessage, ui.ButtonSet.OK);

    LOG.info('SETUP', 'Setup completato con manutenzione automatica.');
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
      ['PDF_ENABLED', true, 'Abilita creazione PDF durante import automatico? (true/false)'],
      ['PDF_CHUNK_SIZE', 80, 'Numero fatture da leggere in blocco (Crea PDF).'],
      ['PDF_FLUSH_EVERY', 200, 'Ogni quanti link PDF aggiornare sul foglio (Crea PDF).'],
      ['ROWS_TOLLERANZA_EURO', 1.00, 'Tolleranza (in €) per mismatch Totale Fattura vs Somma Righe (Import Righe).'],
      ['ADMIN_EMAIL', '', 'Email destinatario notifiche trigger (errori, import completata). CONFIGURARE manualmente.'],
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
  ModuleRegistry.register('SETUP', ['SHEETS', 'UTIL', 'CONFIG', 'LOG', 'DEBUG', 'TRIGGER_DASHBOARD']);
}

// Registra SETUP nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('SETUP', SETUP);
}
