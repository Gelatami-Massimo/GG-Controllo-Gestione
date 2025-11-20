// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 10_main.js
// VERSIONE: 28.0 (UI Cleanup - Simplified Menu & Sidebar)
// DESCRIZIONE: Menu principale pulito e sidebar riorganizzata.
// =============================================================

/**
 * onOpen()
 * Crea il menu principale "GELATAMI" nella UI del foglio.
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
  const menu = ui.createMenu('🧊 GELATAMI')
    .addItem('➡️ Pannello di Controllo', App.ui.fn.openSidebar)
    .addSeparator();

  // --- Importazione ---
  menu.addSubMenu(ui.createMenu('📥 Importazione')
    .addItem('▶️ Continua Import', App.ui.fn.runContinue)
    .addSeparator()
    .addItem('1️⃣ Importa Intestazioni', App.ui.fn.runImportHeaders)
    .addItem('2️⃣ Importa Righe', App.ui.fn.runImportRows)
    .addSeparator()
    .addItem('📄 Genera PDF Mancanti', App.ui.fn.runCreatePdfs)
  );

  // --- Report e Analisi ---
  menu.addSubMenu(ui.createMenu('📊 Report e Analisi')
    .addItem('📈 Dashboard', App.ui.fn.runCreateDashboard)
    .addItem('📑 Conto Economico (P&L)', App.ui.fn.runCreatePnlSheet)
    .addItem('📦 Magazzino', App.ui.fn.runCreateWarehouse)
    .addItem('🧪 Magazzino Ingredienti', 'buildMagazzinoIngredienti')
    .addSeparator()
    .addItem('🔍 Report di Audit', App.ui.fn.runReconciliationReport)
  );

  // --- Manutenzione ---
  menu.addSubMenu(ui.createMenu('🔧 Manutenzione')
    .addItem('✨ Manutenzione Completa', App.ui.fn.runCompleteMaintenance)
    .addSeparator()
    .addItem('🖨️ Sincronizza Fornitori', App.ui.fn.runSyncSuppliers)
    .addItem('🔄 Riallinea Categorie', App.ui.fn.runSyncCategoriesRetroactive)
    .addSeparator()
    .addItem('🟡 Gestisci Duplicati', App.ui.fn.runMarkDuplicateInvoices)
    .addItem('🧹 Pulisci Cache', App.ui.fn.runClearCache)
  );

  // --- Configurazione ---
  menu.addSubMenu(ui.createMenu('⚙️ Config')
    .addItem('🚀 Setup Iniziale', App.ui.fn.runInitialSetup)
    .addItem('⚙️ Impostazioni', runConfigDialog)
    .addSeparator()
    .addItem('🕐 Attiva Import Auto', App.ui.fn.runCreateTrigger)
    .addItem('🛑 Disattiva Import Auto', App.ui.fn.runDeleteTriggers)
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

function runClearCache() { _runSafely(() => DEBUG.clearCache(), 'Debug', 'Pulizia cache e cursori...', 'Cache e cursori azzerati.'); }
function runCreateDashboard() { _runSafely(() => DASHBOARD.create(), 'Dashboard', 'Aggiornamento dashboard...', 'Dashboard aggiornata.'); }
function runCreateWarehouse() { _runSafely(() => WAREHOUSE.create(), 'Warehouse', 'Creazione/Aggiornamento magazzino...', 'Magazzino aggiornato!'); }
function runCreateTrigger() { _runSafely(() => createTimeBasedTrigger(), 'Trigger', 'Installazione import automatico...', 'Operazione trigger completata.'); }
function runDeleteTriggers() { _runSafely(() => deleteTriggers(), 'Trigger', 'Rimozione import automatico...', 'Operazione trigger completata.'); }
function runCreatePnlSheet() { _runSafely(() => createPnlSheet(), 'PNL', 'Creazione/Aggiornamento P&L...', 'P&L aggiornato.'); }

// --- WRAPPER FUNCTIONS FOR DEBUG MODULE ---
function runMarkDuplicateInvoices() {
    _runSafely(() => DEBUG.markDuplicateInvoices(), 'Debug', 'Marcatura Duplicati in corso...', 'Marcatura completata!');
}
function runSyncSuppliers() { _runSafely(() => DEBUG.syncSuppliersFromInvoices(), 'Debug', 'Sincronizzazione fornitori (nuovi)...', 'Anagrafica fornitori sincronizzata!'); }
function runSyncCategoriesRetroactive() { _runSafely(() => DEBUG.syncCategoriesRetroactive(), 'Debug', 'Riallineamento categorie storiche...', 'Categorie storiche riallineate!'); }
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
