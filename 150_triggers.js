// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 150_triggers.js
// RUOLO: Gestione trigger time-based automatici con notifiche email.
// NOTE: runAutomatedImport() orchestrazione import, crea/cancella trigger.
// =============================================================

/**
 * Invia una notifica email all'admin quando il trigger viene disattivato
 * o quando si verificano eventi importanti.
 * 
 * @param {string} reason - Motivo della notifica (es. 'TRIGGER_OFF', 'ERROR', 'RESUMED')
 * @param {Object} details - Dettagli aggiuntivi da includere nel corpo email
 */
function _sendTriggerNotification(reason, details) {
  try {
    // Recupera email admin da CONFIG (fallback a stringa vuota se non disponibile)
    var adminEmail = CONFIG.get('ADMIN_EMAIL', '');
    
    // Se ADMIN_EMAIL vuoto, prova Session (può fallire se permessi mancanti)
    if (!adminEmail || adminEmail === '') {
      try {
        adminEmail = Session.getActiveUser().getEmail();
      } catch (e) {
        LOG.debug('TRIGGER_NOTIFY', 'Session.getActiveUser non disponibile (permessi mancanti), notifica saltata.');
        return;
      }
    }
    
    if (!adminEmail || adminEmail === '') {
      LOG.debug('TRIGGER_NOTIFY', 'Email admin non configurata, notifica saltata.');
      return;
    }

    var subject = '[GG Gestione] ';
    var bodyHtml = '';
    
    switch(reason) {
      case 'TRIGGER_OFF_COMPLETED':
        subject += 'Trigger Disattivato - Import Completata';
        bodyHtml = '<h2>✅ Importazione Completata</h2>' +
          '<p>Il trigger automatico è stato <strong>disattivato</strong> perché tutte le importazioni sono state completate.</p>' +
          '<p><strong>Nessun cursore attivo</strong> (HEADERS/ROWS).</p>';
        break;
        
      case 'TRIGGER_KEPT_ACTIVE':
        subject += 'Trigger Mantenuto Attivo - Lavoro in Corso';
        bodyHtml = '<h2>⏳ Lavoro in Corso</h2>' +
          '<p>Il trigger automatico rimane <strong>attivo</strong> perché ci sono ancora importazioni in sospeso.</p>' +
          '<ul>' +
          '<li>Cursor HEADERS: <strong>' + (details.hasHeadersCursor ? 'ATTIVO' : 'inattivo') + '</strong></li>' +
          '<li>Cursor ROWS: <strong>' + (details.hasRowsCursor ? 'ATTIVO' : 'inattivo') + '</strong></li>' +
          '</ul>' +
          '<p>Il sistema continuerà automaticamente al prossimo run.</p>';
        break;
        
      case 'TRIGGER_ERROR':
        subject += '⚠️ ERRORE nel Trigger Automatico';
        bodyHtml = '<h2 style="color: red;">❌ Errore Critico</h2>' +
          '<p>Si è verificato un <strong>errore grave</strong> durante l\'esecuzione del trigger automatico.</p>' +
          '<p><strong>Errore:</strong> ' + (details.error || 'N/A') + '</p>' +
          '<p><strong>Fase:</strong> ' + (details.phase || 'N/A') + '</p>' +
          '<p><strong>Azione richiesta:</strong> Verifica i log e risolvi il problema prima di riavviare il trigger.</p>';
        break;
        
      default:
        subject += 'Notifica Trigger';
        bodyHtml = '<h2>Notifica Trigger Automatico</h2>' +
          '<p>Motivo: ' + reason + '</p>';
    }
    
    // Aggiungi timestamp e dettagli completi
    bodyHtml += '<hr>' +
      '<p><small><strong>Timestamp:</strong> ' + new Date().toISOString() + '</small></p>' +
      '<p><small><strong>Dettagli completi:</strong></small></p>' +
      '<pre style="background: #f4f4f4; padding: 10px; border-radius: 4px; font-size: 11px;">' +
      JSON.stringify(details, null, 2) +
      '</pre>' +
      '<hr>' +
      '<p><small>Questa è una notifica automatica dal sistema GG Gestione Gelatami.</small></p>';
    
    MailApp.sendEmail({
      to: adminEmail,
      subject: subject,
      htmlBody: bodyHtml
    });
    
    LOG.info('TRIGGER_NOTIFY', 'Notifica email inviata con successo.', {
      reason: reason,
      recipient: adminEmail
    });
    
  } catch (e) {
    // Non bloccare il flusso principale se la notifica fallisce
    LOG.warn('TRIGGER_NOTIFY', 'Errore invio notifica email.', {
      error: e.message,
      stack: e.stack
    });
  }
}

/**
 * Funzione principale eseguita dall'attivatore automatico.
 * Esegue Headers, Rows e PDF generation.
 */
function runAutomatedImport() {
  const LOCK_TIMEOUT_MS = 5000; // attesa breve (5s)
  let hadError = false;
  const startTime = Date.now();
  const executionLog = {
    startTime: new Date().toISOString(),
    phases: {},
    endTime: null,
    duration: null,
    success: false
  };

  try {
    // L'automatico cede rapidamente se il sistema è occupato.
    if (!UTIL.acquireLock(LOCK_TIMEOUT_MS)) {
      LOG.info(
        'TRIGGER_LOCK',
        'Importazione automatica saltata: Lock occupato.',
        { lockTimeout: LOCK_TIMEOUT_MS }
      );
      return;
    }

    LOG.info('TRIGGER', 'AVVIO IMPORTAZIONE AUTOMATICA', {
      timestamp: executionLog.startTime,
      triggerSource: 'TIME_BASED'
    });

    // ==========================
    // Fase 1: Headers (resume)
    // ==========================
    try {
      const headersStart = Date.now();
      LOG.debug('TRIGGER', 'Esecuzione IMPORT_HEADERS.runContinue(true)...');
      
      // Usa RETRY per gestire errori transitori
      if (typeof RETRY !== 'undefined' && RETRY.withRetry) {
        RETRY.withRetry(IMPORT_HEADERS.runContinue, {
          context: IMPORT_HEADERS,
          args: [true],
          name: 'IMPORT_HEADERS.runContinue',
          maxRetries: 2
        });
      } else {
        IMPORT_HEADERS.runContinue(true); // Fallback senza retry
      }
      
      executionLog.phases.headers = {
        success: true,
        duration: Date.now() - headersStart
      };
      LOG.debug('TRIGGER', 'IMPORT_HEADERS completato.', {
        duration: executionLog.phases.headers.duration + 'ms'
      });
    } catch (e1) {
      executionLog.phases.headers = {
        success: false,
        error: e1.message,
        duration: Date.now() - (executionLog.phases.headers ? executionLog.phases.headers.duration : startTime)
      };
      LOG.error('TRIGGER_HEADERS', 'Errore in IMPORT_HEADERS.runContinue', {
        error: e1.message,
        stack: e1.stack,
        duration: executionLog.phases.headers.duration
      });
      throw e1; // interrompe il trigger (notifica via email di Apps Script)
    }

    // ==========================
    // Fase 2: Rows
    // ==========================
    try {
      const rowsStart = Date.now();
      LOG.debug('TRIGGER', 'Esecuzione IMPORT_ROWS.run(true)...');
      
      // Usa RETRY per gestire errori transitori
      if (typeof RETRY !== 'undefined' && RETRY.withRetry) {
        RETRY.withRetry(IMPORT_ROWS.run, {
          context: IMPORT_ROWS,
          args: [true],
          name: 'IMPORT_ROWS.run',
          maxRetries: 2
        });
      } else {
        IMPORT_ROWS.run(true); // Fallback senza retry
      }
      
      executionLog.phases.rows = {
        success: true,
        duration: Date.now() - rowsStart
      };
      LOG.debug('TRIGGER', 'IMPORT_ROWS completato.', {
        duration: executionLog.phases.rows.duration + 'ms'
      });
    } catch (e2) {
      executionLog.phases.rows = {
        success: false,
        error: e2.message,
        duration: Date.now() - (executionLog.phases.rows ? executionLog.phases.rows.duration : startTime)
      };
      LOG.error('TRIGGER_ROWS', 'Errore in IMPORT_ROWS.run', {
        error: e2.message,
        stack: e2.stack,
        duration: executionLog.phases.rows.duration
      });
      throw e2;
    }

    // ==========================
    // Fase 3: PDF Generation
    // ==========================
    try {
      const pdfStart = Date.now();
      LOG.debug('TRIGGER', 'Esecuzione PDF.run(true)...');
      
      // Usa RETRY per gestire errori transitori
      if (typeof RETRY !== 'undefined' && RETRY.withRetry) {
        RETRY.withRetry(PDF.run, {
          context: PDF,
          args: [true],
          name: 'PDF.run',
          maxRetries: 2
        });
      } else {
        PDF.run(true); // Fallback senza retry
      }
      
      executionLog.phases.pdf = {
        success: true,
        duration: Date.now() - pdfStart
      };
      LOG.debug('TRIGGER', 'PDF.run completato.', {
        duration: executionLog.phases.pdf.duration + 'ms'
      });
    } catch (e3) {
      executionLog.phases.pdf = {
        success: false,
        error: e3.message,
        duration: Date.now() - (executionLog.phases.pdf ? executionLog.phases.pdf.duration : startTime)
      };
      // Logga l'errore ma NON rilancia - la generazione PDF è meno critica dell'import
      LOG.error('TRIGGER_PDF', 'Errore during PDF.run automatico', {
        error: e3.message,
        stack: e3.stack,
        duration: executionLog.phases.pdf.duration
      });
      // Non fare 'throw e3;' per non bloccare il completamento e lastRun
    }

    executionLog.success = true;
    executionLog.endTime = new Date().toISOString();
    executionLog.duration = Date.now() - startTime;
    
    LOG.info('TRIGGER', 'FINE IMPORTAZIONE AUTOMATICA', {
      totalDuration: executionLog.duration + 'ms',
      phases: executionLog.phases
    });
    
    // Registra esecuzione in dashboard
    if (typeof TRIGGER_DASHBOARD !== 'undefined' && TRIGGER_DASHBOARD.recordExecution) {
      TRIGGER_DASHBOARD.recordExecution(executionLog);
    }
  } catch (e) {
    hadError = true;
    executionLog.success = false;
    executionLog.error = e.message;
    executionLog.endTime = new Date().toISOString();
    executionLog.duration = Date.now() - startTime;
    
    LOG.error(
      'TRIGGER_FAIL',
      "L'importazione automatica è fallita gravemente (HEADERS/ROWS)",
      {
        error: e.message,
        stack: e.stack,
      }
    );
    
    // Registra esecuzione fallita in dashboard
    if (typeof TRIGGER_DASHBOARD !== 'undefined' && TRIGGER_DASHBOARD.recordExecution) {
      TRIGGER_DASHBOARD.recordExecution(executionLog);
    }
    
    // Notifica admin dell'errore critico
    _sendTriggerNotification('TRIGGER_ERROR', {
      error: e.message,
      stack: e.stack,
      phase: e.message.includes('HEADERS') ? 'HEADERS' : (e.message.includes('ROWS') ? 'ROWS' : 'UNKNOWN'),
      timestamp: new Date().toISOString()
    });
    
    // Rilancia per notifica email Google
    throw e;
  } finally {
    // Rilascio lock (sempre)
    try {
      UTIL.releaseLock();
    } catch (ignored) {}

    // Registra l'ora di fine esecuzione (sempre)
    try {
      STATE.set(App.config.keys.lastRun, new Date().toISOString());
    } catch (ignored) {}

    // Se tutto è andato bene, disattiva automaticamente il trigger time-based
    // in modo che il job giri UNA SOLA VOLTA e poi si fermi
    if (!hadError) {
      _disableAutoTriggerSilently();
    }

    // Eventuale flush dei log
    try {
      LOG.flush();
    } catch (ignored) {}
  }
}

/**
 * PHASE 8.3 FIX: Disattiva condizionatamente il trigger time-based.
 *
 * Logica:
 * 1. Se esiste un cursor HEADERS o ROWS → MANTIENI il trigger attivo
 *    (c'è ancora lavoro in coda per il prossimo run)
 * 2. Se NESSUNO dei due cursori esiste → DISATTIVA il trigger
 *    (import completata, niente più da fare)
 *
 * Questo permette al trigger di continuare finché ci sono importazioni
 * in sospeso, e spegnersi solo quando il lavoro è veramente finito.
 *
 * - Non usa UI (può essere chiamata da trigger time-based).
 * - Scrive solo nei log.
 */
function _disableAutoTriggerSilently() {
  try {
    // STEP 1: Verifica se c'è ancora lavoro in coda (cursori attivi)
    var hasHeadersCursor = !!STATE.getJSON(App.config.keys.cursors.headers, null);
    var hasRowsCursor    = !!STATE.getJSON(App.config.keys.cursors.rows, null);

    if (hasHeadersCursor || hasRowsCursor) {
      // Ci sono ancora importazioni in sospeso → NON spegnere il trigger
      LOG.info('TRIGGER_AUTO_OFF', 'Trigger mantenuto attivo: lavoro ancora in corso.', {
        hasHeadersCursor: hasHeadersCursor,
        hasRowsCursor: hasRowsCursor
      });
      
      // Notifica admin che il trigger rimane attivo (solo in modalità verbose)
      var notifyOnActive = CONFIG.get('TRIGGER_NOTIFY_ON_ACTIVE', false);
      if (notifyOnActive) {
        _sendTriggerNotification('TRIGGER_KEPT_ACTIVE', {
          hasHeadersCursor: hasHeadersCursor,
          hasRowsCursor: hasRowsCursor,
          timestamp: new Date().toISOString()
        });
      }
      
      return;
    }

    // STEP 2: Nessun cursor attivo → import COMPLETATA → disattiva il trigger
    const handler =
      App && App.config && typeof App.config.triggerHandler === 'string'
        ? App.config.triggerHandler
        : null;

    if (!handler) {
      LOG.warn(
        'TRIGGER_AUTO_OFF',
        'Handler trigger non definito; auto-disattivazione ignorata.'
      );
      return;
    }

    const triggers = ScriptApp.getProjectTriggers();
    const toDelete = triggers.filter(function (t) {
      try {
        return (
          t.getHandlerFunction &&
          t.getHandlerFunction() === handler &&
          t.getEventType &&
          t.getEventType() === ScriptApp.EventType.CLOCK
        );
      } catch (e) {
        return false;
      }
    });

    if (!toDelete.length) {
      LOG.info(
        'TRIGGER_AUTO_OFF',
        'Nessun attivatore time-based da disattivare (import completata, nessun cursore attivo).'
      );
      return;
    }

    toDelete.forEach(function (t) {
      try {
        ScriptApp.deleteTrigger(t);
      } catch (e) {
        LOG.warn('TRIGGER_AUTO_OFF', 'Errore rimozione trigger automatico.', {
          error: e.message,
        });
      }
    });

    LOG.info(
      'TRIGGER_AUTO_OFF',
      'Trigger automatico disattivato: import COMPLETATA (nessun cursore attivo).',
      { removed: toDelete.length }
    );
    
    // Aggiorna dashboard: trigger inattivo
    if (typeof TRIGGER_DASHBOARD !== 'undefined' && TRIGGER_DASHBOARD.updateTriggerStatus) {
      TRIGGER_DASHBOARD.updateTriggerStatus(false);
    }
    
    // Notifica admin che il trigger è stato disattivato (import completata)
    _sendTriggerNotification('TRIGGER_OFF_COMPLETED', {
      removed: toDelete.length,
      handler: handler,
      timestamp: new Date().toISOString(),
      reason: 'Tutte le importazioni sono state completate con successo'
    });
    
  } catch (e) {
    LOG.warn(
      'TRIGGER_AUTO_OFF',
      'Errore inatteso durante auto-disattivazione condizionata trigger.',
      {
        error: e.message,
        stack: e.stack,
      }
    );
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
    ui.alert(
      'Errore configurazione',
      'Handler del trigger non definito in App.config.triggerHandler.',
      ui.ButtonSet.OK
    );
    LOG.error('TRIGGER_CFG', 'App.config.triggerHandler non definito.');
    return;
  }

  // Intervallo configurabile (usa la chiave corretta)
  let everyMin = Number(CONFIG.get('TRIGGER_EVERY_MIN', 15)); // <-- CHIAVE CORRETTA
  if (!Number.isFinite(everyMin)) everyMin = 15;

  // Arrotonda al valore valido più vicino supportato da Apps Script (1, 5, 10, 15, 30, ...)
  const validIntervals = [1, 5, 10, 15, 30];
  let closestMin = 15;
  let minDiff = Infinity;

  validIntervals.forEach(function (interval) {
    const diff = Math.abs(everyMin - interval);
    if (diff < minDiff) {
      minDiff = diff;
      closestMin = interval;
    }
  });

  // Per everyMinutes, usiamo l'intervallo valido più vicino trovato
  everyMin = closestMin;

  const existing = ScriptApp.getProjectTriggers();
  const already = existing.some(function (t) {
    try {
      return (
        t.getHandlerFunction &&
        t.getHandlerFunction() === handler &&
        t.getEventType &&
        t.getEventType() === ScriptApp.EventType.CLOCK
      );
    } catch (e) {
      return false;
    }
  });

  if (already) {
    ui.alert(
      'Attivatore già presente',
      "Un attivatore per l'importazione automatica è già installato.",
      ui.ButtonSet.OK
    );
    LOG.info('TRIGGER', 'Attivatore già presente: nessuna azione.');
    return;
  }

  try {
    ScriptApp.newTrigger(handler).timeBased().everyMinutes(everyMin).create();

    // Aggiorna dashboard: trigger attivo
    if (typeof TRIGGER_DASHBOARD !== 'undefined' && TRIGGER_DASHBOARD.updateTriggerStatus) {
      TRIGGER_DASHBOARD.updateTriggerStatus(true);
    }

    ui.alert(
      'Attivatore installato!',
      "L'importazione automatica verrà eseguita circa ogni " +
        everyMin +
        " minuti e verrà DISATTIVATA automaticamente a fine run.",
      ui.ButtonSet.OK
    );

    LOG.info(
      'TRIGGER',
      'Attivatore creato con successo (ogni ' + everyMin + ' min).'
    );
  } catch (e) {
    // Gestisce errore se l'utente non ha i permessi per creare trigger
    ui.alert(
      'Errore Creazione Trigger',
      "Impossibile installare l'attivatore.\nDettagli: " +
        e.message +
        '. Potrebbero mancare le autorizzazioni necessarie.',
      ui.ButtonSet.OK
    );
    LOG.error('TRIGGER_CREATE_FAIL', 'Fallita creazione trigger', {
      error: e.message,
    });
  }
}

/**
 * Elimina tutti gli attivatori associati all'handler configurato.
 */
function deleteTriggers() {
  // Try to get UI, but don't fail if not available
  let ui = null;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    // UI not available (e.g., called from trigger context)
    LOG.debug('TRIGGER_DELETE', 'UI non disponibile, modalità silent');
  }

  const handler = App.config.triggerHandler;

  if (!handler || typeof handler !== 'string') {
    if (ui) {
      ui.alert(
        'Errore configurazione',
        'Handler del trigger non definito in App.config.triggerHandler.',
        ui.ButtonSet.OK
      );
    }
    LOG.error('TRIGGER_CFG', 'App.config.triggerHandler non definito.');
    return;
  }

  const triggers = ScriptApp.getProjectTriggers();
  const toDelete = triggers.filter(function (t) {
    try {
      return t.getHandlerFunction && t.getHandlerFunction() === handler;
    } catch (e) {
      return false;
    }
  });

  if (toDelete.length === 0) {
    if (ui) {
      ui.alert(
        'Nessun attivatore trovato',
        'Non sono presenti attivatori installati.',
        ui.ButtonSet.OK
      );
    }
    LOG.info('TRIGGER', 'Nessun attivatore da rimuovere.');
    return;
  }

  toDelete.forEach(function (t) {
    try {
      ScriptApp.deleteTrigger(t);
    } catch (e) {
      LOG.warn('TRIGGER_DELETE', 'Errore rimozione trigger', {
        error: e.message,
      });
    }
  });

  // Aggiorna dashboard: trigger inattivo
  if (typeof TRIGGER_DASHBOARD !== 'undefined' && TRIGGER_DASHBOARD.updateTriggerStatus) {
    TRIGGER_DASHBOARD.updateTriggerStatus(false);
  }

  if (ui) {
    ui.alert(
      'Attivatori rimossi',
      "L'importazione automatica è stata disattivata.",
      ui.ButtonSet.OK
    );
  }
  LOG.info('TRIGGER', 'Rimossi ' + toDelete.length + ' attivatori.');
}
