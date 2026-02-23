// =============================================================
// PROGETTO: GG-Controllo-Gestione
// FILE: 010_main.js
// VERSIONE: 27 (Hardening Granitico)
// DESCRIZIONE:
//  - Entry point unico per menu, UI e trigger manuali
//  - Usa App.ui.fn come "contratto" delle funzioni pubbliche
//  - Tutte le chiamate passano da _runSafely (lock + log + UI)
// =============================================================

/**
 * onOpen: crea il menu all'apertura del file.
 */
function onOpen(e) {
  try {
    _createMainMenu();
  } catch (err) {
    // Fallback minimale se LOG non è disponibile
    if (typeof LOG !== 'undefined') {
      LOG.error('ON_OPEN', err);
    } else {
      console && console.error && console.error('ON_OPEN ERROR', err);
    }
  }
}

/**
 * onInstall: richiama onOpen dopo installazione.
 */
function onInstall(e) {
  onOpen(e);
}

// =============================================================
// MENU
// =============================================================

function _createMainMenu() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('GG - Controllo Gestione');

  // Pannello & controllo
  menu.addItem('Apri Pannello di Controllo', App.ui.fn.openSidebar);
  menu.addItem('Continua ultimo processo', App.ui.fn.runContinue);
  menu.addSeparator();

  // Import
  menu.addItem('1) Importa Testate (XML)', App.ui.fn.runImportHeaders);
  menu.addItem('2) Importa Righe (XML)', App.ui.fn.runImportRows);
  menu.addItem('3) Genera PDF Fatture', App.ui.fn.runCreatePdfs);
  menu.addSeparator();

  // Report & analisi
  menu.addItem('Dashboard Controllo', App.ui.fn.runCreateDashboard);
  menu.addItem('Conto Economico Riclassificato', App.ui.fn.runCreatePnlSheet);
  menu.addItem('Magazzino Analitico', App.ui.fn.runCreateWarehouse);
  menu.addItem('Report Riconciliazione', App.ui.fn.runReconciliationReport);
  menu.addSeparator();

  // Setup & diagnostica
  menu.addItem('Setup iniziale', App.ui.fn.runInitialSetup);
  menu.addItem('Verifica / Crea Struttura', App.ui.fn.runSheetCheckAndSetup);
  menu.addItem('Sanity Check Sistema', App.ui.fn.runSanityCheck);
  menu.addSeparator();

  // Trigger
  menu.addItem('Crea Trigger Automatico', App.ui.fn.runCreateTrigger);
  menu.addItem('Elimina Trigger Automatici', App.ui.fn.runDeleteTriggers);
  menu.addSeparator();

  // Duplicati fatture
  menu.addItem('Segna Duplicati Fatture', App.ui.fn.runMarkDuplicateInvoices);
  menu.addItem('Pulisci Segnatura Duplicati', App.ui.fn.runClearDuplicateMarkings);
  menu.addItem('Snapshot Duplicati', App.ui.fn.createDuplicateSnapshot);
  menu.addSeparator();

  // Utility / Sync
  menu.addItem('Forza Formato Testo Codici', App.ui.fn.runForceTextFormatOnCodes);
  menu.addItem('Sync Fornitori', App.ui.fn.runSyncSuppliers);
  menu.addItem('Sync Categorie (Retroattivo)', App.ui.fn.runSyncCategoriesRetroactive);
  menu.addItem('Svuota Cache / Stato', App.ui.fn.runClearCache);
  menu.addSeparator();

  // Status
  menu.addItem('Mostra Stato Sistema', App.ui.fn.getSystemStatus);

  menu.addToUi();
}

// =============================================================
// WRAPPER PUBBLICI
// Ogni funzione qui:
//  - È referenziata in App.ui.fn
//  - Usa _runSafely
//  - Chiama il modulo logico dedicato
// =============================================================

// --- UI / Pannello ---

function openSidebar() {
  _runSafely('OPEN_SIDEBAR', function () {
    if (typeof UI !== 'undefined' && UI.openSidebar) {
      UI.openSidebar();
    } else if (typeof SIDEBAR !== 'undefined' && SIDEBAR.open) {
      SIDEBAR.open();
    } else {
      throw new Error('Modulo UI/Sidebar non trovato.');
    }
  });
}

function runContinue() {
  _runSafely('RUN_CONTINUE', function () {
    if (typeof STATUS !== 'undefined' && STATUS.continueLastProcess) {
      STATUS.continueLastProcess();
    } else {
      throw new Error('Funzione di continuazione non disponibile.');
    }
  });
}

// --- Import ---

function runImportHeaders() {
  _runSafely('IMPORT_HEADERS', function () {
    IMPORT_HEADERS.run();
  });
}

function runImportRows() {
  _runSafely('IMPORT_ROWS', function () {
    IMPORT_ROWS.run();
  });
}

function runCreatePdfs() {
  _runSafely('CREATE_PDFS', function () {
    if (typeof PDF !== 'undefined' && PDF.run) {
      PDF.run();
    } else if (typeof IMPORT_PDFS !== 'undefined' && IMPORT_PDFS.run) {
      IMPORT_PDFS.run();
    } else {
      throw new Error('Modulo generazione PDF non trovato.');
    }
  });
}

// --- Report & Analisi ---

function runCreateDashboard() {
  _runSafely('CREATE_DASHBOARD', function () {
    DASHBOARD.run();
  });
}

function runCreatePnlSheet() {
  _runSafely('CREATE_PNL', function () {
    if (typeof PNL !== 'undefined' && PNL.run) {
      PNL.run();
    } else if (typeof createPnlSheet === 'function') {
      createPnlSheet();
    } else {
      throw new Error('Modulo PNL non trovato.');
    }
  });
}

function runCreateWarehouse() {
  _runSafely('CREATE_WAREHOUSE', function () {
    WAREHOUSE.run();
  });
}

function runReconciliationReport() {
  _runSafely('RECONCILIATION_REPORT', function () {
    if (typeof RECONCILE !== 'undefined' && RECONCILE.run) {
      RECONCILE.run();
    } else {
      throw new Error('Modulo riconciliazione non trovato.');
    }
  });
}

// --- Setup & Diagnostica ---

function runInitialSetup() {
  _runSafely('INITIAL_SETUP', function () {
    if (typeof SETUP !== 'undefined' && SETUP.initialSetup) {
      SETUP.initialSetup();
    } else if (typeof SETUP !== 'undefined' && SETUP.run) {
      SETUP.run();
    } else {
      throw new Error('Modulo SETUP non trovato.');
    }
  });
}

function runSheetCheckAndSetup() {
  _runSafely('SHEET_CHECK_AND_SETUP', function () {
    if (typeof SETUP !== 'undefined' && SETUP.sheetCheckAndSetup) {
      SETUP.sheetCheckAndSetup();
    } else {
      throw new Error('Funzione di verifica struttura non trovata.');
    }
  });
}

function runSanityCheck() {
  _runSafely('SANITY_CHECK', function () {
    if (typeof DEBUG !== 'undefined' && DEBUG.sanityCheck) {
      DEBUG.sanityCheck();
    } else {
      throw new Error('Modulo DEBUG.sanityCheck non trovato.');
    }
  });
}

// --- Trigger ---

function runCreateTrigger() {
  _runSafely('CREATE_TRIGGER', function () {
    if (typeof TRIGGERS !== 'undefined' && TRIGGERS.create) {
      TRIGGERS.create(App.config.triggerHandler);
    } else if (typeof createTimeDrivenTrigger === 'function') {
      createTimeDrivenTrigger();
    } else {
      throw new Error('Gestione trigger non trovata.');
    }
  });
}

function runDeleteTriggers() {
  _runSafely('DELETE_TRIGGERS', function () {
    if (typeof TRIGGERS !== 'undefined' && TRIGGERS.removeAll) {
      TRIGGERS.removeAll();
    } else if (typeof deleteTimeDrivenTriggers === 'function') {
      deleteTimeDrivenTriggers();
    } else {
      throw new Error('Gestione trigger non trovata.');
    }
  });
}

// --- Duplicati ---

function runMarkDuplicateInvoices() {
  _runSafely('MARK_DUPLICATES', function () {
    DUPLICATES.mark();
  });
}

function runClearDuplicateMarkings() {
  _runSafely('CLEAR_DUPLICATE_MARKINGS', function () {
    DUPLICATES.clearMarks();
  });
}

function createDuplicateSnapshot() {
  _runSafely('DUPLICATE_SNAPSHOT', function () {
    DUPLICATES.snapshot();
  });
}

// --- Utility / Sync ---

function runForceTextFormatOnCodes() {
  _runSafely('FORCE_TEXT_CODES', function () {
    if (typeof UTIL !== 'undefined' && UTIL.forceTextFormatOnCodes) {
      UTIL.forceTextFormatOnCodes();
    } else {
      throw new Error('Utility forceTextFormatOnCodes non trovata.');
    }
  });
}

function runSyncSuppliers() {
  _runSafely('SYNC_SUPPLIERS', function () {
    if (typeof SYNC !== 'undefined' && SYNC.suppliers) {
      SYNC.suppliers();
    } else if (typeof DEBUG !== 'undefined' && DEBUG.syncSuppliers) {
      DEBUG.syncSuppliers();
    } else {
      throw new Error('Funzione sync fornitori non trovata.');
    }
  });
}

function runSyncCategoriesRetroactive() {
  _runSafely('SYNC_CATEGORIES_RETRO', function () {
    if (typeof SYNC !== 'undefined' && SYNC.categoriesRetroactive) {
      SYNC.categoriesRetroactive();
    } else if (typeof DEBUG !== 'undefined' && DEBUG.syncCategoriesRetroactive) {
      DEBUG.syncCategoriesRetroactive();
    } else {
      throw new Error('Funzione sync categorie retroattive non trovata.');
    }
  });
}

function runClearCache() {
  _runSafely('CLEAR_CACHE', function () {
    if (typeof STATE !== 'undefined' && STATE.clearAll) {
      STATE.clearAll();
    } else if (typeof DEBUG !== 'undefined' && DEBUG.clearCacheAndState) {
      DEBUG.clearCacheAndState();
    } else {
      throw new Error('Funzione clear cache/state non trovata.');
    }
  });
}

// --- Status & Monitor ---

function getSystemStatus() {
  return _runSafely('GET_SYSTEM_STATUS', function () {
    if (typeof STATUS !== 'undefined' && STATUS.getSystemStatus) {
      return STATUS.getSystemStatus();
    }
    throw new Error('Modulo STATUS.getSystemStatus non trovato.');
  }, { silentUi: true });
}

function getRunningStatus() {
  return _runSafely('GET_RUNNING_STATUS', function () {
    if (typeof STATUS !== 'undefined' && STATUS.getRunningStatus) {
      return STATUS.getRunningStatus();
    }
    throw new Error('Modulo STATUS.getRunningStatus non trovato.');
  }, { silentUi: true });
}

// =============================================================
// _runSafely: wrapper centrale
// - Lock (se disponibile in UTIL)
// - Logging (LOG)
// - Alert utente su errore (se non silent)
// =============================================================

function _runSafely(action, callback, options) {
  options = options || {};
  const ui = SpreadsheetApp.getUi ? SpreadsheetApp.getUi() : null;
  const label = String(action || 'ACTION').toUpperCase();

  let lock = null;
  const hasUtilLock = (typeof UTIL !== 'undefined' && typeof UTIL.acquireLock === 'function');

  try {
    if (typeof LOG !== 'undefined' && typeof LOG.info === 'function') {
      LOG.info(label, 'Avvio operazione.');
    }

    if (hasUtilLock) {
      lock = UTIL.acquireLock(5000); // 5s
      if (!lock) {
        if (typeof LOG !== 'undefined' && LOG.warn) {
          LOG.warn(label, 'Lock occupato, operazione saltata.');
        }
        if (!options.silentUi && ui) {
          ui.alert('Sistema occupato, riprova tra qualche minuto.');
        }
        return;
      }
    }

    const result = callback && callback();

    if (typeof LOG !== 'undefined' && typeof LOG.info === 'function') {
      LOG.info(label, 'Operazione completata.');
    }

    return result;

  } catch (err) {

    if (typeof LOG !== 'undefined' && typeof LOG.error === 'function') {
      LOG.error(label, err);
    } else {
      console && console.error && console.error(label, err);
    }

    if (!options.silentUi && ui) {
      ui.alert('Errore durante "' + label + '": ' + (err && err.message ? err.message : err));
    }

    throw err;

  } finally {
    if (lock && typeof lock.releaseLock === 'function') {
      lock.releaseLock();
    }
  }
}
