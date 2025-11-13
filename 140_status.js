// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 140_status.js
// VERSIONE: 25.0 (System Status)
// DESCRIZIONE: Moduli Status per Sidebar UI.
// =============================================================

/**
 * Funzione chiamata dalla sidebar per ottenere lo stato statico del sistema.
 * CORRETTO: Legge il conteggio totale dei file e l'intervallo del trigger
 * da STATE/CONFIG invece di ricalcolarli (causando timeout).
 */
function getSystemStatus() {
  try {
    // 1. Controlla se un processo è in pausa (needsContinue)
    const allCursors = App.config.keys.cursors;
    let needsContinue = false;
      for (const key in allCursors) {
        if (allCursors.hasOwnProperty(key)) {
            if (STATE.get(allCursors[key])) {
                needsContinue = true;
                break;
            }
        }
      }

    // 2. Conta i file processati (letti dal foglio Fatture)
    const processedCount = SHEETS.getProcessedFileIds().size;

    // --- INIZIO CORREZIONE: Lettura conteggio da STATE ---
    // 3. Legge il conteggio totale dei file (calcolato da m30_import_headers)
    const totalXmlCountRaw = STATE.get(App.config.keys.auditTotalCount);
    let totalXmlCount = 0;
    
    if (totalXmlCountRaw !== null && totalXmlCountRaw !== undefined) {
       totalXmlCount = Number(totalXmlCountRaw);
       if (isNaN(totalXmlCount)) {
           LOG.warn('STATUS', `Valore non numerico per auditTotalCount in STATE: ${totalXmlCountRaw}`);
           totalXmlCount = 0; // Fallback
       }
    } else {
       // È normale se l'importazione non è mai stata completata
       LOG.debug('STATUS', 'auditTotalCount non trovato in STATE. Eseguire Import Headers per calcolarlo.');
    }
    // --- FINE CORREZIONE ---

    // 4. Controlla se il trigger automatico è installato
    const triggerExists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === App.config.triggerHandler);

    // 5. Legge l'intervallo del trigger (per la UI)
    const triggerMins = CONFIG.get('TRIGGER_EVERY_MIN', 15); // <-- AGGIUNTO PER LA SIDEBAR

    // 6. Calcola il tempo trascorso dall'ultima esecuzione
    const lastRunTimestamp = STATE.get(App.config.keys.lastRun);
    let lastRunInfo = "Mai eseguito";
    if (lastRunTimestamp) {
       try {
         const lastRunDate = new Date(lastRunTimestamp);
         const now = new Date();
         const minutesAgo = Math.round((now.getTime() - lastRunDate.getTime()) / 60000);

         if (minutesAgo < 1) {
             lastRunInfo = "Poco fa";
         } else if (minutesAgo < 60) {
             lastRunInfo = `${minutesAgo} min fa`;
         } else {
             const hoursAgo = Math.floor(minutesAgo / 60);
             lastRunInfo = `${hoursAgo} ore fa`;
         }
       } catch(e) {
           lastRunInfo = "Data illeggibile";
       }
    }

    return {
      success: true,
      needsContinue: needsContinue,
      processedFiles: processedCount,
      totalFiles: totalXmlCount, // Ora legge il valore veloce
      triggerActive: triggerExists,
      triggerEveryMinutes: triggerMins, // <-- DATO AGGIUNTO PER LA SIDEBAR
      lastRun: lastRunInfo
    };
  } catch (e) {
    LOG.error('getSystemStatus', 'Errore recupero stato sistema.', {error: e.message, stack: e.stack});
    return { success: false, error: e.message };
  }
}

/**
 * Funzione chiamata in polling dalla sidebar per ottenere l'avanzamento IN TEMPO REALE.
 */
function getRunningStatus() {
  // Questa funzione è corretta, legge solo la chiave di progresso
  return STATE.getJSON(App.config.keys.progress);
}