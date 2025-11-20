// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 000_App.js
// RUOLO: Hub configurazione centrale e mappa funzioni UI.
// NOTE: Contiene App.config (chiavi/cursori) e App.ui.fn (mapping funzioni).
// =============================================================

/**
 * Oggetto centrale di configurazione e mappatura funzioni.
 * - App.config contiene chiavi, cursori e identificatori globali.
 * - App.ui.fn contiene i nomi delle funzioni esposte alla UI.
 * - Mantieni i nomi esposti (compatibilità con menu/trigger/UI).
 */

const App = {
  version: '25.0', // Versione aggiornata
  meta: {
    project: 'GG GESTIONE GELATAMI V1', // Nome progetto aggiornato
    updated: '2025-11-04', // Data odierna
    notes: 'Versione 25 - Avvio pulito del progetto.' // Note aggiornate
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

      // Conteggio duplicati (esposto in UI/Report)
      duplicateCount: 'DUPLICATE_INVOICE_COUNT_V1',

      // --- NUOVE CHIAVI PER I CONTEGGI SALVATI ---
      auditCountsMonth: 'AUDIT_COUNTS_MONTH_V1',   // Risultato finale { 'YYYY-MM': count }
      auditCountsFolder: 'AUDIT_COUNTS_FOLDER_V1', // Risultato finale { 'Path': count }
      auditTotalCount: 'AUDIT_TOTAL_COUNT_V1',     // Risultato finale (numero totale file XML)
      // --- FINE NUOVE CHIAVI ---

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
        fileAuditMonth: 'FILE_AUDIT_MONTH_CURSOR_V1' // Cursore (ora obsoleto, ma non dannoso)
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

      // --- Manutenzione e Debug UI ---
      runInitialSetup: 'runInitialSetup',
      runSheetCheckAndSetup: 'runSheetCheckAndSetup',
      runCompleteMaintenance: 'runCompleteMaintenance',
      runSanityCheck: 'runSanityCheck',
      runCreateTrigger: 'runCreateTrigger',
      runDeleteTriggers: 'runDeleteTriggers',
      createDuplicateSnapshot: 'createDuplicateSnapshot',
      runMarkDuplicateInvoices: 'runMarkDuplicateInvoices',
      runClearDuplicateMarkings: 'runClearDuplicateMarkings',
      runFindRigheDuplicate: 'runFindRigheDuplicate',
      runDeleteRigheDuplicate: 'runDeleteRigheDuplicate',
      runCountDuplicates: 'runCountDuplicates',
      runResetAllImportFlags: 'runResetAllImportFlags',
      // Le funzioni runCountFiles... sono state rimosse perché ora integrate in "Importa Intestazioni"
      runForceTextFormatOnCodes: 'runForceTextFormatOnCodes',
      runSyncSuppliers: 'runSyncSuppliers',
      runSyncCategoriesRetroactive: 'runSyncCategoriesRetroactive',
      runClearCache: 'runClearCache',

      // --- Funzioni di Stato (per Sidebar/UI) ---
      getSystemStatus: 'getSystemStatus',
      getRunningStatus: 'getRunningStatus'
    }
  }
};

// Facoltativo: protezione da modifiche accidentali (non obbligatoria)
try {
  Object.freeze(App.ui.fn);
  Object.freeze(App.config.keys.cursors);
  Object.freeze(App.config.keys);
  Object.freeze(App.config);
  Object.freeze(App);
} catch (_) {
  // Ignora in caso di ambiente limitato
}
