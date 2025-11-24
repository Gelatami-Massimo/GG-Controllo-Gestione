// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 000_App.js
// RUOLO: Hub configurazione centrale e mappa funzioni UI.
// NOTE: Contiene App.config (chiavi/cursori) e App.ui.fn (mapping funzioni).
// =============================================================

/**
 * @typedef {Object} AppConfig
 * @property {string} triggerHandler - Nome funzione globale per trigger automatici
 * @property {AppConfigKeys} keys - Chiavi per STATE/Cache e cursori di processo
 */

/**
 * @typedef {Object} AppConfigKeys
 * @property {string} progress - Chiave progresso import corrente
 * @property {string} goldenTotal - Chiave totale finanziario globale
 * @property {string} lastRun - Chiave timestamp ultima esecuzione trigger
 * @property {string} duplicateCount - Chiave contatore fatture duplicate
 * @property {string} auditCountsMonth - Chiave conteggi audit per mese (JSON)
 * @property {string} auditCountsFolder - Chiave conteggi audit per cartella (JSON)
 * @property {string} auditTotalCount - Chiave totale file XML contati
 * @property {AppConfigCursors} cursors - Cursori per ripresa processi lunghi
 */

/**
 * @typedef {Object} AppConfigCursors
 * @property {string} headers - Cursore import intestazioni fatture
 * @property {string} rows - Cursore import righe dettaglio
 * @property {string} pdf - Cursore generazione PDF
 * @property {string} markDuplicates - Cursore marcatura duplicati
 * @property {string} clearMarkDuplicates - Cursore pulizia marcature
 * @property {string} syncCategories - Cursore sincronizzazione categorie
 * @property {string} syncSuppliers - Cursore sincronizzazione fornitori
 * @property {string} forceText - Cursore formattazione testo colonne
 * @property {string} fileAuditMonth - Cursore audit file per mese
 */

/**
 * @typedef {Object} AppUIFunctions
 * @property {string} openSidebar - Nome funzione apertura sidebar controllo
 * @property {string} runContinue - Nome funzione ripresa import
 * @property {string} runImportHeaders - Nome funzione import intestazioni
 * @property {string} runImportRows - Nome funzione import righe
 * @property {string} runCreatePdfs - Nome funzione generazione PDF
 * @property {string} runCreateDashboard - Nome funzione dashboard
 * @property {string} runCreatePnlSheet - Nome funzione P&L
 * @property {string} runReconciliationReport - Nome funzione report audit
 * @property {string} runCreateWarehouse - Nome funzione magazzino
 * @property {string} runInitialSetup - Nome funzione setup iniziale
 * @property {string} runCompleteMaintenance - Nome funzione manutenzione completa
 * @property {string} runCreateTrigger - Nome funzione creazione trigger
 * @property {string} runDeleteTriggers - Nome funzione cancellazione trigger
 * @property {string} runMarkDuplicateInvoices - Nome funzione marcatura duplicati
 * @property {string} runSyncSuppliers - Nome funzione sync fornitori
 * @property {string} runSyncCategoriesRetroactive - Nome funzione sync categorie
 * @property {string} runClearCache - Nome funzione pulizia cache
 * @property {string} getSystemStatus - Nome funzione stato sistema
 * @property {string} getRunningStatus - Nome funzione stato esecuzione
 */

/**
 * @typedef {Object} AppMetadata
 * @property {string} project - Nome progetto
 * @property {string} updated - Data ultimo aggiornamento (YYYY-MM-DD)
 * @property {string} notes - Note versione corrente
 */

/**
 * Oggetto centrale di configurazione e mappatura funzioni UI.
 * 
 * Centralizza:
 * - Chiavi STATE/Cache per persistenza dati
 * - Cursori per ripresa processi lunghi dopo timeout
 * - Mapping funzioni UI esposte al menu e sidebar
 * - Metadata versione e progetto
 * 
 * L'oggetto è frozen per prevenire modifiche runtime accidentali.
 * 
 * @type {Object}
 * @property {string} version - Versione corrente del progetto
 * @property {AppMetadata} meta - Metadati progetto e versione
 * @property {AppConfig} config - Configurazioni centrali e chiavi STATE
 * @property {Object} ui - Configurazione UI
 * @property {AppUIFunctions} ui.fn - Mapping nomi funzioni esposte alla UI
 * 
 * @example
 * // Accesso chiavi STATE
 * const progressKey = App.config.keys.progress;
 * STATE.setJSON(progressKey, { current: 100, total: 500 });
 * 
 * @example
 * // Accesso cursori per ripresa
 * const cursorKey = App.config.keys.cursors.headers;
 * STATE.setJSON(cursorKey, { nextRow: 150 });
 * 
 * @example
 * // Mapping funzioni UI (usato in menu/sidebar)
 * ui.createMenu('Import')
 *   .addItem('Intestazioni', App.ui.fn.runImportHeaders);
 */
const App = {
  version: '25.0',
  meta: {
    project: 'GG GESTIONE GELATAMI V1',
    updated: '2025-11-04',
    notes: 'Versione 25 - Avvio pulito del progetto.'
  },

  config: {
    // Funzione handler per i trigger time-based (deve esistere come globale)
    triggerHandler: 'runAutomatedImport',

    // Chiavi di stato e cursori principali (STATE / Cache)
    keys: {
      // Stato e telemetria
      progress: 'IMPORT_PROGRESS',
      goldenTotal: 'FINANCIAL_GOLDEN_TOTAL',
      lastRun: 'LAST_AUTOMATED_RUN_TIMESTAMP',
      duplicateCount: 'DUPLICATE_INVOICE_COUNT_V1',

      // Conteggi audit file XML
      auditCountsMonth: 'AUDIT_COUNTS_MONTH_V1',
      auditCountsFolder: 'AUDIT_COUNTS_FOLDER_V1',
      auditTotalCount: 'AUDIT_TOTAL_COUNT_V1',

      // Cursori di processo (ripartenza sicura)
      cursors: {
        headers: 'HEADERS_CURSOR_V2_RECURSIVE',
        rows: 'ROWS_CURSOR',
        pdf: 'PDFS_CURSOR',
        markDuplicates: 'MARK_DUPLICATES_CURSOR_V1',
        clearMarkDuplicates: 'CLEAR_MARKING_CURSOR_V1',
        syncCategories: 'SYNC_CATEGORIES_CURSOR_V1',
        syncSuppliers: 'SYNC_SUPPLIERS_CURSOR_V1',
        forceText: 'FORCE_TEXT_CURSOR_V1',
        fileAuditMonth: 'FILE_AUDIT_MONTH_CURSOR_V1'
      }
    }
  },

  ui: {
    fn: {
      // --- Azioni UI Principali ---
      openSidebar: 'openSidebar',
      runContinue: 'runContinue',
      runImportHeaders: 'runImportHeaders',
      runImportRows: 'runImportRows',

      // --- Report e Utility UI ---
      runCreatePdfs: 'runCreatePdfs',
      runCreateDashboard: 'runCreateDashboard',
      runCreatePnlSheet: 'runCreatePnlSheet',
      runReconciliationReport: 'runReconciliationReport',
      runCreateWarehouse: 'runCreateWarehouse',
      runDataValidation: 'runDataValidation',

      // --- Manutenzione e Debug UI ---
      runInitialSetup: 'runInitialSetup',
      runCompleteMaintenance: 'runCompleteMaintenance',
      runCreateTrigger: 'runCreateTrigger',
      runDeleteTriggers: 'runDeleteTriggers',
      runMarkDuplicateInvoices: 'runMarkDuplicateInvoices',
      runSyncSuppliers: 'runSyncSuppliers',
      runSyncCategoriesRetroactive: 'runSyncCategoriesRetroactive',
      runClearCache: 'runClearCache',

      // --- Funzioni di Stato (per Sidebar/UI) ---
      getSystemStatus: 'getSystemStatus',
      getRunningStatus: 'getRunningStatus'
    }
  }
};

/**
 * Protezione immutabilità oggetto App.
 * 
 * Applica Object.freeze() ricorsivo su App e tutte le sue proprietà
 * per prevenire modifiche accidentali a runtime.
 * 
 * Questo garantisce che:
 * - Nessun modulo possa alterare chiavi STATE
 * - I nomi funzioni UI restino coerenti
 * - Le configurazioni siano read-only
 * 
 * Se l'ambiente non supporta freeze (es. alcuni runtime limitati),
 * l'errore viene ignorato silenziosamente.
 * 
 * @throws {Error} Ignorato se Object.freeze non disponibile
 */
try {
  Object.freeze(App.ui.fn);
  Object.freeze(App.config.keys.cursors);
  Object.freeze(App.config.keys);
  Object.freeze(App.config);
  Object.freeze(App);
} catch (_) {
  // Ignora in caso di ambiente limitato
}
