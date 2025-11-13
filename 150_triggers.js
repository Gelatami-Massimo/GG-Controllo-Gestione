// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 150_triggers.js
// VERSIONE: 25.0 (Trigger Manager)
// DESCRIZIONE: Modulo Triggers (esecuzione automatica + gestione attivatori)
// =============================================================

/**
 * Funzione principale eseguita dall'attivatore automatico.
 * Esegue Headers, Rows e PDF generation.
 */
function runAutomatedImport() {
  const LOCK_TIMEOUT_MS = 5000; // attesa breve (5s)

  let hadError = false;
  try {
    // L'automatico cede rapidamente se il sistema è occupato.
    if (!UTIL.acquireLock(LOCK_TIMEOUT_MS)) {
      LOG.info('TRIGGER_LOCK', 'Importazione automatica saltata: Lock occupato.');
      return;
    }

    LOG.info('TRIGGER', 'AVVIO IMPORTAZIONE AUTOMATICA');

    // Fase 1: Headers (resume)
    try {
      LOG.debug('TRIGGER', 'Esecuzione IMPORT_HEADERS.runContinue(true)...');
      IMPORT_HEADERS.runContinue(true); // true = silent mode
      LOG.debug('TRIGGER', 'IMPORT_HEADERS completato.');
    } catch (e1) {
      LOG.error('TRIGGER_HEADERS', 'Errore in IMPORT_HEADERS.runContinue', { error: e1.message, stack: e1.stack });
      throw e1; // interrompe il trigger (notifica via email di Apps Script)
    }

    // Fase 2: Rows
    try {
      LOG.debug('TRIGGER', 'Esecuzione IMPORT_ROWS.run(true)...');
      IMPORT_ROWS.run(true); // true = silent mode
      LOG.debug('TRIGGER', 'IMPORT_ROWS completato.');
    } catch (e2) {
      LOG.error('TRIGGER_ROWS', 'Errore in IMPORT_ROWS.run', { error: e2.message, stack: e2.stack });
      throw e2;
    }

    // Fase 3: PDF Generation (Aggiunta)
    try {
       LOG.debug('TRIGGER', 'Esecuzione PDF.run(true)...');
       PDF.run(true); // true = silent mode
       LOG.debug('TRIGGER', 'PDF.run completato.');
     } catch (e3) {
       // Logga l'errore ma NON rilancia - la generazione PDF è meno critica dell'import
       LOG.error('TRIGGER_PDF', 'Errore during PDF.run automatico', { error: e3.message, stack: e3.stack });
       // Non fare 'throw e3;' per non bloccare il completamento e lastRun
     }

    LOG.info('TRIGGER', 'FINE IMPORTAZIONE AUTOMATICA');
  } catch (e) {
    hadError = true;
    LOG.error('TRIGGER_FAIL', 'L\'importazione automatica è fallita gravemente (HEADERS/ROWS)', { error: e.message, stack: e.stack });
    throw e; // Rilancia per notifica email Google
  } finally {
    try { UTIL.releaseLock(); } catch (_) {}
    // Registra l'ora di fine esecuzione (sempre)
    try { STATE.set(App.config.keys.lastRun, new Date().toISOString()); } catch (_) {}
    // Eventuale flush dei log
    try { LOG.flush(); } catch (_) {}
  }
}

/**
 * Crea un attivatore time-based per l'import automatico (idempotente).
 * Legge l'intervallo da Config: TRIGGER_EVERY_MIN (default 15, min 1, max 60).
 * CORRETTO: Usa chiave 'TRIGGER_EVERY_MIN'
 */
function createTimeBasedTrigger() {
  const ui = SpreadsheetApp.getUi();
  const handler = App.config.triggerHandler;
  if (!handler || typeof handler !== 'string') {
    ui.alert('Errore configurazione', 'Handler del trigger non definito in App.config.triggerHandler.', ui.ButtonSet.OK);
    LOG.error('TRIGGER_CFG', 'App.config.triggerHandler non definito.');
    return;
  }

  // Intervallo configurabile (usa la chiave corretta)
  let everyMin = Number(CONFIG.get('TRIGGER_EVERY_MIN', 15)); // <-- CHIAVE CORRETTA
  if (!Number.isFinite(everyMin)) everyMin = 15;

  // Arrotonda al valore valido più vicino supportato da Apps Script (1, 5, 10, 15, 30, ...)
  const validIntervals = [1, 5, 10, 15, 30]; // Puoi estendere se serve ogni ora, etc.
  let closestMin = 15; // default
  let minDiff = Infinity;
  validIntervals.forEach(interval => {
      const diff = Math.abs(everyMin - interval);
      if (diff < minDiff) {
          minDiff = diff;
          closestMin = interval;
      }
  });
  // Per everyMinutes, usiamo l'intervallo valido più vicino trovato
  everyMin = closestMin;

  const existing = ScriptApp.getProjectTriggers();
  const already = existing.some(t =>
    t.getHandlerFunction() === handler &&
    t.getEventType && t.getEventType() === ScriptApp.EventType.CLOCK
  );

  if (already) {
    ui.alert('Attivatore già presente', 'Un attivatore per l\'importazione automatica è già installato.', ui.ButtonSet.OK);
    LOG.info('TRIGGER', 'Attivatore già presente: nessuna azione.');
    return;
  }

  try {
    ScriptApp.newTrigger(handler)
      .timeBased()
      .everyMinutes(everyMin) // Usa il valore arrotondato
      .create();

    ui.alert('Attivatore installato!', `L'importazione automatica verrà eseguita circa ogni ${everyMin} minuti.`, ui.ButtonSet.OK);
    LOG.info('TRIGGER', `Attivatore creato con successo (ogni ${everyMin} min).`);
  } catch (e) {
      // Gestisce errore se l'utente non ha i permessi per creare trigger
      ui.alert('Errore Creazione Trigger', `Impossibile installare l'attivatore. Dettagli: ${e.message}. Potrebbero mancare le autorizzazioni necessarie.`, ui.ButtonSet.OK);
      LOG.error('TRIGGER_CREATE_FAIL', 'Fallita creazione trigger', { error: e.message });
  }
}

/**
 * Elimina tutti gli attivatori associati all'handler configurato.
 */
function deleteTriggers() {
  const ui = SpreadsheetApp.getUi();
  const handler = App.config.triggerHandler;
  if (!handler || typeof handler !== 'string') {
    ui.alert('Errore configurazione', 'Handler del trigger non definito in App.config.triggerHandler.', ui.ButtonSet.OK);
    LOG.error('TRIGGER_CFG', 'App.config.triggerHandler non definito.');
    return;
  }

  const triggers = ScriptApp.getProjectTriggers();
  const toDelete = triggers.filter(t => t.getHandlerFunction() === handler);

  if (toDelete.length === 0) {
    ui.alert('Nessun attivatore trovato', 'Non sono presenti attivatori installati.', ui.ButtonSet.OK);
    LOG.info('TRIGGER', 'Nessun attivatore da rimuovere.');
    return;
  }

  toDelete.forEach(t => {
    try { ScriptApp.deleteTrigger(t); }
    catch (e) { LOG.warn('TRIGGER_DELETE', 'Errore rimozione trigger', { error: e.message }); }
  });

  ui.alert('Attivatori rimossi', 'L\'importazione automatica è stata disattivata.', ui.ButtonSet.OK);
  LOG.info('TRIGGER', `Rimossi ${toDelete.length} attivatori.`);
}