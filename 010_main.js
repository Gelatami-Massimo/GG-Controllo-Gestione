// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 010_main.js
// RUOLO: Menu principale GELATAMI e sidebar UI.
// NOTE: Entry point UI con onOpen(), wrapper funzioni pubbliche.
// =============================================================

/**
 * Crea il menu principale "GELATAMI" nella UI del foglio.
 * Entry point principale per la UI, eseguito all'apertura del foglio.
 * Valida le dipendenze dei moduli e crea il menu con tutte le funzionalità disponibili.
 * 
 * @returns {void}
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

  // Protegge getUi() per contesti non interattivi (test, trigger)
  let ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    LOG?.warn('MAIN', 'onOpen() chiamato in contesto non interattivo - menu UI non disponibile');
    return; // Esci silenziosamente se getUi() non è disponibile
  }

  const menu = ui.createMenu('🧊 GELATAMI')
    .addItem('🎛️ Pannello di Controllo', App.ui.fn.openSidebar)
    .addSeparator();

  // --- Importazione ---
  menu.addSubMenu(ui.createMenu('📥 Import Fatture')
    .addItem('▶️ Continua Import', App.ui.fn.runContinue)
    .addSeparator()
    .addItem('📋 Import Intestazioni', App.ui.fn.runImportHeaders)
    .addItem('📦 Import Righe Prodotti', App.ui.fn.runImportRows)
    .addSeparator()
    .addItem('📄 Genera PDF', App.ui.fn.runCreatePdfs)
  );

  // --- Report e Analisi ---
  menu.addSubMenu(ui.createMenu('📊 Report')
    .addItem('📈 Dashboard Finanziaria', App.ui.fn.runCreateDashboard)
    .addItem('💰 Conto Economico (P&L)', App.ui.fn.runCreatePnlSheet)
    .addItem('📊 Confronto Sedi', 'runCreatePnlConfrontoGemmaZaffiro')
    .addSeparator()
    .addItem('📦 Magazzino Prodotti', 'buildMagazzinoByYear')
    .addItem('🧪 Magazzino Ingredienti', 'buildMagazzinoIngredientiByYear')
    .addSeparator()
    .addItem('🔍 Audit Integrità Dati', App.ui.fn.runReconciliationReport)
    .addItem('✅ Validazione Dati Completa', App.ui.fn.runDataValidation)
  );

  // --- Manutenzione ---
  menu.addSubMenu(ui.createMenu('🔧 Manutenzione')
    .addItem('✨ Manutenzione Completa', App.ui.fn.runCompleteMaintenance)
    .addSeparator()
    .addItem('👥 Aggiorna Fornitori', App.ui.fn.runSyncSuppliers)
    .addItem('🏷️ Riallinea Categorie', App.ui.fn.runSyncCategoriesRetroactive)
    .addItem('📦 Sincronizza Prodotti', 'runSyncProdotti')
    .addSeparator()
    .addItem('🔄 Duplicati Fatture', App.ui.fn.runMarkDuplicateInvoices)
    .addItem('🗑️ Pulisci Cache', App.ui.fn.runClearCache)
    .addItem('🗑️ Pulisci Righe Vuote', 'runDeleteEmptyRowsFromRigheSheet')
    .addSeparator()
  );

  // --- Configurazione ---
  menu.addSubMenu(ui.createMenu('⚙️ Configurazione')
    .addItem('🚀 Setup Iniziale', App.ui.fn.runInitialSetup)
    .addItem('⚙️ Impostazioni', runConfigDialog)
    .addSeparator()
    .addItem('▶️ Attiva Import Auto', App.ui.fn.runCreateTrigger)
    .addItem('⏸️ Disattiva Import Auto', App.ui.fn.runDeleteTriggers)
  );

  // --- Strumenti Avanzati (PERICOLOSI) ---
  menu.addSeparator();
  menu.addSubMenu(ui.createMenu('🛠️ Strumenti Avanzati')
    .addItem('🔥 Reset e Re-importa Tutto', 'runResetAndReimportAll')
  );

  menu.addToUi();
}

/**
 * Installa il menu al primo deploy dell'add-on.
 * Trigger di installazione che configura l'ambiente iniziale.
 * 
 * @param {Object} e - Evento di installazione fornito da Google Apps Script
 * @returns {void}
 */
function onInstall(e) {
  onOpen(e);
}

/**
 * Apre la sidebar "Pannello di Controllo" nell'interfaccia utente.
 * Carica il template HTML Sidebar.html e lo visualizza come pannello laterale.
 * 
 * @returns {void}
 * @throws {Error} Se il file Sidebar.html non è presente nel progetto
 */
function openSidebar() {
  const ui = SpreadsheetApp.getUi();
  try {
    // Verifica esistenza file prima di caricarlo
    let html;
    try {
      html = HtmlService.createHtmlOutputFromFile('Sidebar')
        .setTitle('Pannello di Controllo')
        .setWidth(300);
    } catch (fileErr) {
      // Se fallisce, prova con un messaggio di debug
      LOG?.error('UI', 'File Sidebar.html non trovato', { error: fileErr.message });
      throw new Error('File Sidebar.html non accessibile: ' + fileErr.message);
    }
    ui.showSidebar(html);
  } catch (e) {
    ui.alert(
      'Errore',
      'Impossibile aprire la Sidebar. Dettagli: ' + e.message,
      ui.ButtonSet.OK
    );
    LOG?.error('UI', 'Apertura Sidebar fallita', { error: e.message, stack: e.stack });
  }
}

// =============================================================
// GESTORE GLOBALE SICURO (_runSafely)
// =============================================================
/**
 * Esegue una funzione in modo sicuro con Lock globale,
 * messaggi di stato e gestione errori centralizzata.
 * Acquisisce un lock per evitare esecuzioni concorrenti, mostra toast di progresso
 * e gestisce automaticamente gli errori con alert all'utente.
 *
 * @param {Function} fn - Funzione da eseguire
 * @param {string} scope - Etichetta logica per logging (es: 'Import', 'PDF')
 * @param {string} startMsg - Messaggio toast di avvio operazione
 * @param {string} successMsg - Messaggio toast di completamento con successo
 * @returns {void}
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

/** Esegue il setup iniziale guidato del sistema. @returns {void} */
function runInitialSetup() { _runSafely(() => SETUP.run(), 'Setup', 'Avvio Setup Guidato...', 'Setup completato!'); }

/** Riprende l'importazione intestazioni dal punto di interruzione. @returns {void} */
function runContinue() { _runSafely(() => IMPORT_HEADERS.runContinue(), 'Import', 'Ripresa importazione...', 'Ciclo di importazione completato.'); }

/** Importa le intestazioni delle fatture XML. @returns {void} */
function runImportHeaders() { _runSafely(() => IMPORT_HEADERS.run(), 'Import', 'Avvio importazione/conteggio...', 'Importazione intestazioni e conteggio file completati.'); }

/** Importa le righe di dettaglio delle fatture. @returns {void} */
function runImportRows() { _runSafely(() => IMPORT_ROWS.run(), 'Import', 'Avvio importazione righe...', 'Importazione righe completata.'); }

/** Genera i PDF delle fatture mancanti. @returns {void} */
function runCreatePdfs() { _runSafely(() => PDF.run(), 'PDF', 'Creazione PDF in corso...', 'Creazione PDF completata.'); }

/** Riprende creazione PDF solo per fatture TODO/SKIPPED. @returns {void} */
function runResumePdfs() { _runSafely(() => PDF.runPdfOnly(), 'PDF', 'Ripresa creazione PDF...', 'PDF ripresi completati.'); }

/** Genera il report di audit e riconciliazione. @returns {void} */
function runReconciliationReport() { _runSafely(() => REPORTING.run(), 'Reporting', 'Generazione Report di Audit...', 'Report generato.'); }

/**
 * Esegue la manutenzione completa del sistema.
 * Include: verifica struttura fogli, applicazione formati, gestione duplicati,
 * sanity check integrità dati.
 * 
 * @returns {void}
 */
function runCompleteMaintenance() {
  _runSafely(() => {
    const runId = ENHANCED_LOGGER?.generateRunId ? ENHANCED_LOGGER.generateRunId() : Utilities.getUuid();
    ENHANCED_LOGGER?.info(runId, 'MAINT_START', 'Avvio manutenzione completa');

    // 0. Verifica e riallinea intestazioni fogli secondo SCHEMAS
    try {
      const summary = (typeof SETUP !== 'undefined' && SETUP.verifyAlignment) ? SETUP.verifyAlignment() : null;
      ENHANCED_LOGGER?.info(runId, 'MAINT_SETUP_VERIFY', 'Verifica setup eseguita', { summary });
    } catch (e) {
      ENHANCED_LOGGER?.warn(runId, 'MAINT_SETUP_VERIFY_FAIL', 'Errore verifica setup', { error: e.message });
    }

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

    ENHANCED_LOGGER?.info(runId, 'MAINT_DONE', 'Manutenzione completa terminata');
  }, 'Maintenance', 'Manutenzione completa in corso...', 'Manutenzione completata! Fogli verificati, codici formattati, duplicati marcati, integrità controllata.');
}

/** Pulisce la cache e azzera i cursori di ripresa import. @returns {void} */
function runClearCache() { 
  // Esecuzione diretta senza lock (operazione veloce read-only cache)
  const ui = SpreadsheetApp.getUi();
  try {
    DEBUG.clearCache();
  } catch (e) {
    ui.alert('Errore', `Impossibile pulire cache: ${e.message}`, ui.ButtonSet.OK);
  }
}

/** Aggiorna la dashboard finanziaria con i dati più recenti. @returns {void} */
function runCreateDashboard() { _runSafely(() => DASHBOARD.create(), 'Dashboard', 'Aggiornamento dashboard...', 'Dashboard aggiornata.'); }

/** Crea o aggiorna il report magazzino. @returns {void} */
function runCreateWarehouse() { _runSafely(() => MAGAZZINO_CORE.buildMagazzinoByYear(), 'Warehouse', 'Creazione/Aggiornamento magazzino...', 'Magazzino aggiornato!'); }

/** Attiva l'import automatico programmato. @returns {void} */
function runCreateTrigger() { _runSafely(() => createTimeBasedTrigger(), 'Trigger', 'Installazione import automatico...', 'Operazione trigger completata.'); }

/** Disattiva tutti i trigger di import automatico. @returns {void} */
function runDeleteTriggers() { _runSafely(() => deleteTriggers(), 'Trigger', 'Rimozione import automatico...', 'Operazione trigger completata.'); }

/** Genera il foglio Conto Economico (P&L). @returns {void} */
function runCreatePnlSheet() { _runSafely(() => createPnlSheet(), 'PNL', 'Creazione/Aggiornamento P&L...', 'P&L aggiornato.'); }

// --- WRAPPER FUNCTIONS FOR DEBUG MODULE ---

/** Marca visivamente le fatture duplicate nel foglio Fatture. @returns {void} */
function runMarkDuplicateInvoices() {
    _runSafely(() => DEBUG.markDuplicateInvoices(), 'Debug', 'Marcatura Duplicati in corso...', 'Marcatura completata!');
}

/** Sincronizza l'anagrafica fornitori con le nuove fatture importate. @returns {void} */
function runSyncSuppliers() { _runSafely(() => DEBUG.syncSuppliersFromInvoices(), 'Debug', 'Sincronizzazione fornitori (nuovi)...', 'Anagrafica fornitori sincronizzata!'); }

/** Riallinea le categorie prodotti storiche con la configurazione attuale. @returns {void} */
function runSyncCategoriesRetroactive() { _runSafely(() => DEBUG.syncCategoriesRetroactive(), 'Debug', 'Riallineamento categorie storiche...', 'Categorie storiche riallineate!'); }

/** Diagnostica costi Hotel - verifica configurazione e dati. @returns {void} */
function runDiagnoseHotelCosts() { _runSafely(() => DEBUG.DEV_DiagnoseHotelCosts(), 'Debug Hotel', 'Analisi configurazione costi Hotel...', 'Diagnosi completata!'); }

/** Confronta costi Hotel tra Fatture e P&L generato. @returns {void} */
function runCompareHotelCostsWithPnL() { _runSafely(() => DEBUG.DEV_CompareHotelCostsWithPnL(), 'Debug Hotel', 'Confronto Fatture vs P&L...', 'Analisi completata!'); }

/** Ispeziona aggregazione costi dal foglio Fatture. @returns {void} */
function runInspectAggregatedCosts() { _runSafely(() => DEBUG.DEV_InspectAggregatedCosts(), 'Debug Hotel', 'Ispezione aggregazione...', 'Analisi completata!'); }

/** Debug dettagliato loop aggregazione costi Hotel. @returns {void} */
function runDebugCostiHotelLoop() { _runSafely(() => DEBUG.DEV_DebugCostiHotelLoop(), 'Debug Hotel', 'Debug loop in corso...', 'Debug completato!'); }

/**
 * Scansiona il catalogo Prodotti e disattiva quelli con descrizioni "spazzatura".
 * Controlla le descrizioni contro il foglio "Filtro Righe Spazzatura" e imposta NonInUso=TRUE.
 * @returns {void}
 */
function runMarkJunkProducts() {
  _runSafely(() => {
    const result = PRODUCTS.markJunkAsUnused();
    const message = `Scansione completata!\n\n` +
                   `✅ Prodotti scansionati: ${result.scanned}\n` +
                   `🧹 Prodotti disattivati: ${result.disabled}\n` +
                   `❌ Errori: ${result.errors}`;
    SpreadsheetApp.getUi().alert('🧹 Pulizia Prodotti Spazzatura', message, SpreadsheetApp.getUi().ButtonSet.OK);
  }, 'Products', 'Scansione prodotti spazzatura in corso...', 'Scansione completata!');
}

/**
 * Recupera retroattivamente i codici fornitore mancanti dal foglio Righe.
 * Per prodotti senza CodiceFornitore, cerca il codice nelle righe già importate.
 * @returns {void}
 */
function runBackfillProductCodes() {
  _runSafely(() => {
    const result = PRODUCTS.backfillMissingCodes();
    const message = `Recupero codici completato!\n\n` +
                   `✅ Prodotti analizzati: ${result.scanned}\n` +
                   `🔧 Codici recuperati: ${result.updated}\n` +
                   `❌ Errori: ${result.errors}`;
    SpreadsheetApp.getUi().alert('🔧 Recupero Codici Fornitore', message, SpreadsheetApp.getUi().ButtonSet.OK);
  }, 'Products', 'Recupero codici fornitore in corso...', 'Recupero completato!');
}

/**
 * Pulisce retroattivamente le descrizioni prodotti rimuovendo codici ridondanti.
 * Alcuni fornitori includono il codice nella descrizione (es: "80761761-KINDER BUENO...").
 * @returns {void}
 */
function runCleanProductDescriptions() {
  _runSafely(() => {
    const result = PRODUCTS.cleanDescriptions();
    const message = `Pulizia descrizioni completata!\n\n` +
                   `✅ Prodotti analizzati: ${result.scanned}\n` +
                   `🧼 Descrizioni pulite: ${result.cleaned}\n` +
                   `❌ Errori: ${result.errors}`;
    SpreadsheetApp.getUi().alert('🧼 Pulizia Descrizioni', message, SpreadsheetApp.getUi().ButtonSet.OK);
  }, 'Products', 'Pulizia descrizioni in corso...', 'Pulizia completata!');
}

/** Apre il dialog di configurazione delle impostazioni sistema. @returns {void} */
function runConfigDialog() { _runSafely(() => CONFIG_UI.openDialog(), 'Config', 'Apertura dialog configurazione...', 'Dialog chiuso.'); }

/**
 * Pulisce i log vecchi mantenendo solo gli ultimi 30 giorni.
 * Chiede conferma prima di procedere all'eliminazione.
 * @returns {void}
 */
function runCleanupLogs() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.alert(
    '🗑️ Pulizia Log',
    'Vuoi eliminare i log più vecchi di 30 giorni?\n\nQuesta operazione non può essere annullata.',
    ui.ButtonSet.YES_NO
  );
  
  if (response === ui.Button.YES) {
    _runSafely(() => {
      const result = LOG.cleanup(30);
      const message = result.success 
        ? `✅ ${result.message}\n\nLog eliminati: ${result.deleted}`
        : `❌ Errore: ${result.message}`;
      ui.alert('🗑️ Pulizia Log', message, ui.ButtonSet.OK);
    }, 'Log', 'Pulizia log in corso...', 'Pulizia completata!');
  }
}

/**
 * Apre il foglio Trigger Status per visualizzare lo stato dei trigger automatici.
 * @returns {void}
 */
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

/**
 * Wrapper per menu: crea confronto P&L Gemma vs Zaffiro
 * @returns {void}
 */
function runCreatePnlConfrontoGemmaZaffiro() {
  try {
    createPnlConfrontoGemmaZaffiro();
  } catch (e) {
    LOG?.error('UI', 'Errore creazione confronto Gemma-Zaffiro', { error: e.message });
    SpreadsheetApp.getUi().alert('Errore durante la creazione del confronto: ' + e.message);
  }
}

/**
 * Esegue validazione completa di tutti i dati (Fatture, Righe, Prodotti, Magazzino).
 * Mostra report dettagliato con integrità, coerenza e completezza dei dati.
 * @returns {void}
 */
function runDataValidation() {
  _runSafely(
    () => DATA_VALIDATOR.runCompleteValidation(),
    'DataValidation',
    'Validazione dati completa in corso...',
    'Validazione completata! Controlla i log per il report dettagliato.'
  );
}

/** Pulisce le righe vuote dal foglio 'Righe'. @returns {void} */
function runDeleteEmptyRowsFromRigheSheet() {
  _runSafely(
    () => SHEET_CLEANUP.deleteEmptyRows('Righe'),
    'SheetCleanup',
    'Pulizia righe vuote dal foglio "Righe" in corso...',
    'Pulizia del foglio "Righe" completata!'
  );
}

/**
 * Sincronizza il catalogo prodotti con i dati delle righe importate.
 * Aggiorna informazioni prodotti esistenti e crea nuovi prodotti se necessario.
 * @returns {void}
 */
function runSyncProdotti() {
  _runSafely(
    () => {
      // Richiama la funzione di riallineamento prodotti dal modulo PRODUCTS
      if (typeof PRODUCTS !== 'undefined' && PRODUCTS.realignAll) {
        PRODUCTS.realignAll();
      } else {
        // Fallback: usa la cache prime per forzare refresh
        LOG?.info('SYNC_PRODOTTI', 'Esecuzione refresh cache prodotti');
        PRODUCTS.primeCache();
        SpreadsheetApp.getUi().alert('✅ Cache prodotti aggiornata!');
      }
    },
    'Products',
    'Sincronizzazione prodotti in corso...',
    'Sincronizzazione prodotti completata!'
  );
}

/**
 * Esegue il reset completo del sistema e la re-importazione.
 * Funzione ad alto rischio, da usare con cautela.
 * @returns {void}
 */
function runResetAndReimportAll() {
  try {
    // La funzione `resetAndReimportAll` gestisce internamente UI e lock.
    resetAndReimportAll();
  } catch (e) {
    LOG?.error('RESET', `Errore durante l'avvio del reset: ${e.message}`, { stack: e.stack });
    SpreadsheetApp.getUi().alert(`Impossibile avviare il processo di reset: ${e.message}`);
  }
}

// =============================================================
// FUNZIONI DEFINITE IN ALTRI FILE (NON INCLUDERE QUI)
// =============================================================
// Le funzioni getSystemStatus, getRunningStatus, createTimeBasedTrigger,
// deleteTriggers, runAutomatedImport sono definite nei rispettivi file
