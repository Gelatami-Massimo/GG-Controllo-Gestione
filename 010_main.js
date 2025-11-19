// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 10_main.js
// VERSIONE: 26.0 (Main Menu + Complete Maintenance Orchestration)
// DESCRIZIONE: Menu, sidebar, trigger dispatcher + manutenzione completa automatizzata.
// =============================================================

/**
 * onOpen()
 * Crea il menu principale "FATTURE XML" nella UI del foglio.
 */
function onOpen() {
  // --- VALIDAZIONE DIPENDENZE MODULI ---
  if (typeof ModuleRegistry !== 'undefined') {
    const allDepsOk = ModuleRegistry.validateAll();
    if (!allDepsOk) {
      LOG?.warn('MAIN', 'Alcuni moduli hanno dipendenze non soddisfatte');
    }
  }
  // --- FINE VALIDAZIONE ---

  // --- DIAGNOSTICA NAMESPACE GG ---
  if (typeof GG !== 'undefined') {
    LOG?.info('MAIN', `Namespace GG disponibile con ${GG.count()} moduli registrati`);
  }
  // --- FINE DIAGNOSTICA ---

  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('FATTURE XML') // Puoi rinominare "FATTURE XML" se vuoi
    .addItem('➡️ Apri Pannello di Controllo', App.ui.fn.openSidebar)
    .addSeparator();

  // --- Menu Importazione Dati ---
  menu.addSubMenu(ui.createMenu('Importazione Dati')
    .addItem('▶️ Continua Import Interrotto', App.ui.fn.runContinue)
    .addItem('1. Importa Intestazioni Fatture', App.ui.fn.runImportHeaders)
    .addItem('2. Importa Righe Prodotti', App.ui.fn.runImportRows)
  );

  // --- Menu Report e Utility ---
  menu.addSubMenu(ui.createMenu('Report e Utility')
    .addItem('📊 Esegui Report di Audit', App.ui.fn.runReconciliationReport)
    .addItem('📈 Crea/Aggiorna Dashboard', App.ui.fn.runCreateDashboard)
    .addItem('📑 Crea/Aggiorna P&L', App.ui.fn.runCreatePnlSheet)
    .addItem('📄 Crea PDF Mancanti', App.ui.fn.runCreatePdfs)
    .addSeparator()
    .addItem('📦 Crea/Aggiorna Magazzino', App.ui.fn.runCreateWarehouse)
  );

  // --- Menu Strumenti Avanzati ---
  menu.addSubMenu(ui.createMenu('Strumenti Avanzati')
    .addItem('⚙️ Esegui Setup Guidato', App.ui.fn.runInitialSetup)
    .addItem('⚙️ Configurazione Sistema', runConfigDialog)
    .addSeparator()
    .addItem('🖨️ Sincronizza Anagrafica Fornitori (Nuovi)', App.ui.fn.runSyncSuppliers)
    .addItem('🔄 Riallinea Categorie Storiche', App.ui.fn.runSyncCategoriesRetroactive)
    .addSeparator()
    .addItem('🟡 Marca Fatture Duplicate', App.ui.fn.runMarkDuplicateInvoices)
    .addItem('📸 Crea Snapshot Duplicati', App.ui.fn.createDuplicateSnapshot)
    .addItem('⚪ Pulisci Marcatura Duplicati', App.ui.fn.runClearDuplicateMarkings)
    .addSeparator()
    .addItem('� Conta Righe Duplicate', App.ui.fn.runCountDuplicates)
    .addItem('�🔍 Trova Righe Duplicate', App.ui.fn.runFindRigheDuplicate)
    .addItem('🗑️ Elimina Righe Duplicate', App.ui.fn.runDeleteRigheDuplicate)
    .addItem('🔄 Reset Flag Import (Tutte)', App.ui.fn.runResetAllImportFlags)
    .addSeparator()
    .addSeparator()
    .addItem('🕜 Installa Import Automatico', App.ui.fn.runCreateTrigger)
    .addItem('🛑 Rimuovi Import Automatico', App.ui.fn.runDeleteTriggers)
    .addSeparator()
    .addItem('✨ Manutenzione Completa', App.ui.fn.runCompleteMaintenance)
    .addItem('🧹 Pulisci Cache e Cursori', App.ui.fn.runClearCache)
  );

  menu.addToUi();
}

/**
 * onInstall(e)
 * Installa il menu anche al primo deploy da Editor.
 */
function onInstall(e) {
  onOpen(e);
}

/**
 * openSidebar()
 * Apre la sidebar "Pannello di Controllo" se presente nel progetto.
 */
function openSidebar() {
  const ui = SpreadsheetApp.getUi();
  try {
    const template = HtmlService.createTemplateFromFile('Sidebar');
    template.App = App; // Passa l'oggetto App al template
    const html = template.evaluate()
      .setTitle('Pannello di Controllo')
      .setWidth(300);
    ui.showSidebar(html);
  } catch (e) {
    ui.alert(
      'Errore',
      'Impossibile aprire la Sidebar. File "Sidebar.html" mancante nel progetto?',
      ui.ButtonSet.OK
    );
    LOG?.error('UI', 'Apertura Sidebar fallita', { error: e.message });
  }
}

// =============================================================
// GESTORE GLOBALE SICURO (_runSafely)
// =============================================================
/**
 * Esegue una funzione in modo sicuro con Lock globale,
 * messaggi di stato e gestione errori centralizzata.
 *
 * @param {Function} fn         Funzione da eseguire
 * @param {string}   scope      Etichetta logica per logging
 * @param {string}   startMsg   Messaggio di avvio
 * @param {string}   successMsg Messaggio finale di completamento
 */
function _runSafely(fn, scope, startMsg, successMsg) {
  const LOCK_TIMEOUT_MS = 30000; // 30s timeout per lock manuali
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  try {
    ss.toast('Richiesta esecuzione, attendo processi in corso...', 'Attendere...', LOCK_TIMEOUT_MS / 1000);

    if (!UTIL.acquireLock(LOCK_TIMEOUT_MS)) {
      const busyMsg = 'Un altro processo è attualmente in esecuzione. Riprova tra qualche minuto.';
      LOG?.warn(scope, `Tentativo di esecuzione fallito (Lock attivo): ${startMsg}`);
      ui.alert('Sistema Occupato', busyMsg, ui.ButtonSet.OK);
      return;
    }

    LOG?.info(scope, startMsg);
    ss.toast(startMsg, 'In corso...', -1); // Toast infinito
    fn(); // Esecuzione effettiva
    LOG?.info(scope, successMsg);
    ss.toast(successMsg, 'Fatto!', 5); // Toast per 5 secondi

  } catch (e) {
    const message = `Dettagli: ${e.message}\nFile: ${e.fileName || 'Sconosciuto'}\nRiga: ${e.lineNumber || 'Sconosciuta'}`;
    LOG?.error(scope, `ERRORE: ${e.message}`, {
      stack: e.stack,
      file: e.fileName,
      line: e.lineNumber
    });
    ui.alert(`Errore in [${scope}]`, message, ui.ButtonSet.OK);
  } finally {
    UTIL.releaseLock();
    // Flush dei log nel finally
    if (typeof LOG !== 'undefined' && LOG.flush) {
        try { LOG.flush(); } catch(eFlush) { console.error("Errore flush log:", eFlush); }
    }
    ss.toast('', '', 1); // Pulisce il toast precedente
  }
}

// =============================================================
// WRAPPER FUNZIONALI — Disaccoppiati e centralizzati
// =============================================================

function runInitialSetup() { _runSafely(() => SETUP.run(), 'Setup', 'Avvio Setup Guidato...', 'Setup completato!'); }
function runContinue() { _runSafely(() => IMPORT_HEADERS.runContinue(), 'Import', 'Ripresa importazione...', 'Ciclo di importazione completato.'); }
function runImportHeaders() { _runSafely(() => IMPORT_HEADERS.run(), 'Import', 'Avvio importazione/conteggio...', 'Importazione intestazioni e conteggio file completati.'); }
function runImportRows() { _runSafely(() => IMPORT_ROWS.run(), 'Import', 'Avvio importazione righe...', 'Importazione righe completata.'); }
function runCreatePdfs() { _runSafely(() => PDF.run(), 'PDF', 'Creazione PDF in corso...', 'Creazione PDF completata.'); }
function runReconciliationReport() { _runSafely(() => REPORTING.run(), 'Reporting', 'Generazione Report di Audit...', 'Report generato.'); }

// ✅ FUNZIONE MASTER: Manutenzione Completa (Filtri + Formati + Integrità + Duplicati)
function runCompleteMaintenance() {
  _runSafely(() => {
    // 1. Verifica struttura fogli e applica filtri su TUTTI i fogli
    SHEETS.ensureAll();
    SHEETS.applyFormats();
    
    // 2. Forza formato testo su colonne codici (evita '001' → 1)
    DEBUG.forceTextFormatOnCodes();
    
    // 3. Gestione duplicati (silenzioso, solo log) - PROTEZIONE AUTOMATICA
    DEBUG.manageDuplicateInvoices(); // Marca fatture duplicate (giallo)
    DEBUG.manageDuplicateRows();     // Marca righe duplicate (rosa)
    
    // 4. Controlla integrità dati (sanity check)
    DEBUG.sanityCheck();
  }, 'Maintenance', 'Manutenzione completa in corso...', 'Manutenzione completata! Fogli verificati, codici formattati, duplicati marcati, integrità controllata.');
}

// Funzione legacy mantenuta per compatibilità (ora richiama runCompleteMaintenance)
function runSheetCheckAndSetup() { runCompleteMaintenance(); }
function runClearCache() { _runSafely(() => DEBUG.clearCache(), 'Debug', 'Pulizia cache e cursori...', 'Cache e cursori azzerati.'); }
function runSanityCheck() { _runSafely(() => DEBUG.sanityCheck(), 'Debug', 'Controllo integrità sistema...', 'Controllo completato.'); }
function runCreateDashboard() { _runSafely(() => DASHBOARD.create(), 'Dashboard', 'Aggiornamento dashboard...', 'Dashboard aggiornata.'); }
function runCreateWarehouse() { _runSafely(() => WAREHOUSE.create(), 'Warehouse', 'Creazione/Aggiornamento magazzino...', 'Magazzino aggiornato!'); }
function runCreateTrigger() { _runSafely(() => createTimeBasedTrigger(), 'Trigger', 'Installazione import automatico...', 'Operazione trigger completata.'); }
function runDeleteTriggers() { _runSafely(() => deleteTriggers(), 'Trigger', 'Rimozione import automatico...', 'Operazione trigger completata.'); }
function runCreatePnlSheet() { _runSafely(() => createPnlSheet(), 'PNL', 'Creazione/Aggiornamento P&L...', 'P&L aggiornato.'); }

// --- WRAPPER FUNCTIONS FOR DEBUG MODULE ---
function createDuplicateSnapshot() {
   _runSafely(() => DEBUG.createDuplicateSnapshot(), 'Debug', 'Creazione Snapshot Duplicati...', 'Snapshot creato!');
}

function runMarkDuplicateInvoices() {
    _runSafely(() => DEBUG.markDuplicateInvoices(), 'Debug', 'Marcatura Duplicati in corso...', 'Marcatura completata!');
}
function runClearDuplicateMarkings() { _runSafely(() => DEBUG.clearDuplicateMarkings(), 'Debug', 'Pulizia Marcatura Duplicati...', 'Marcatura rimossa!'); }
function runForceTextFormatOnCodes() { _runSafely(() => DEBUG.forceTextFormatOnCodes(), 'Debug', 'Forzo formato testo codici...', 'Formato testo applicato!'); }
function runSyncSuppliers() { _runSafely(() => DEBUG.syncSuppliersFromInvoices(), 'Debug', 'Sincronizzazione fornitori (nuovi)...', 'Anagrafica fornitori sincronizzata!'); }
function runSyncCategoriesRetroactive() { _runSafely(() => DEBUG.syncCategoriesRetroactive(), 'Debug', 'Riallineamento categorie storiche...', 'Categorie storiche riallineate!'); }
function runFindRigheDuplicate() { _runSafely(() => DEBUG.DEV_FindRigheDuplicate(), 'Debug', 'Ricerca righe duplicate...', 'Ricerca completata!'); }
function runDeleteRigheDuplicate() { _runSafely(() => DEBUG.DEV_DeleteRigheDuplicate(), 'Debug', 'Eliminazione righe duplicate...', 'Eliminazione completata!'); }
function runCountDuplicates() { _runSafely(() => DEBUG.DEV_CountDuplicates(), 'Debug', 'Conteggio duplicati...', 'Conteggio completato!'); }
function runResetAllImportFlags() { _runSafely(() => DEBUG.DEV_ResetAllImportFlags(), 'Debug', 'Reset flag import...', 'Reset completato!'); }
function runConfigDialog() { _runSafely(() => CONFIG_UI.openDialog(), 'Config', 'Apertura dialog configurazione...', 'Dialog chiuso.'); }
function openTriggerStatusSheet() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Trigger Status');
    if (sheet) {
      sheet.activate();
      LOG?.info('UI', 'Foglio Trigger Status aperto dalla sidebar.');
    } else {
      SpreadsheetApp.getUi().alert('Foglio "Trigger Status" non trovato. Esegui prima il Setup.');
      LOG?.warn('UI', 'Foglio Trigger Status non trovato.');
    }
  } catch (e) {
    LOG?.error('UI', 'Errore apertura Trigger Status', { error: e.message });
    throw e;
  }
}

// =============================================================
// FUNZIONI DEFINITE IN ALTRI FILE (NON INCLUDERE QUI)
// =============================================================
// Le funzioni getSystemStatus, getRunningStatus, createTimeBasedTrigger,
// deleteTriggers, runAutomatedImport sono definite nei rispettivi file