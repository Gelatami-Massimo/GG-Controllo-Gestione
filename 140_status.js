// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 140_status.js
// RUOLO: Telemetria sistema per Sidebar UI (stato cursori, trigger, quota).
// NOTE: Chiamato da Sidebar.html, legge STATE/CONFIG senza ricalcoli.
// =============================================================

/**
 * Recupera stato statico del sistema per Sidebar UI (chiamata rapida, no timeout).
 * 
 * Dati restituiti:
 * - needsContinue: {boolean} - true se esistono cursori attivi (import in pausa)
 * - processedFiles: {number} - File XML già processati (conteggio da foglio Fatture)
 * - totalFiles: {number} - Totale file XML trovati in cartella input (da STATE cache)
 * - triggerActive: {boolean} - true se trigger automatico installato
 * - triggerEveryMinutes: {number} - Intervallo trigger in minuti (da CONFIG)
 * - lastRun: {string} - Tempo trascorso dall'ultima esecuzione (es. "15 min fa")
 * 
 * NOTA: Lettura veloce, nessuna scansione Drive/calcolo pesante.
 * 
 * @returns {{success: boolean, needsContinue: boolean, processedFiles: number, totalFiles: number, triggerActive: boolean, triggerEveryMinutes: number, lastRun: string}|{success: boolean, error: string}} Stato sistema o errore
 * 
 * @example
 * const status = getSystemStatus();
 * if (status.success) {
 *   console.log(`Processati: ${status.processedFiles}/${status.totalFiles}`);
 * }
 */
function getSystemStatus() {
  try {
    // 1. Controlla se un processo è in pausa (needsContinue) - VELOCE
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

    // 2. Conta i file processati - OTTIMIZZATO: Usa lastRow invece di Set
    let processedCount = 0;
    try {
      const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
      if (shF) {
        const headerRow = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
        processedCount = Math.max(0, shF.getLastRow() - headerRow);
      }
    } catch (e) {
      // Ignora errore, lascia 0
    }

    // 3. Legge il conteggio totale dei file (calcolato da import_headers) - VELOCE
    const totalXmlCountRaw = STATE.get(App.config.keys.auditTotalCount);
    let totalXmlCount = 0;
    
    if (totalXmlCountRaw !== null && totalXmlCountRaw !== undefined) {
       totalXmlCount = Number(totalXmlCountRaw);
       if (isNaN(totalXmlCount)) {
           totalXmlCount = 0;
       }
    }

    // 4. Controlla se il trigger automatico è installato - VELOCE
    const triggerExists = ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === App.config.triggerHandler);

    // 5. Legge l'intervallo del trigger (per la UI) - VELOCE
    const triggerMins = CONFIG.get('TRIGGER_EVERY_MIN', 15);

    // 6. Calcola il tempo trascorso dall'ultima esecuzione - VELOCE
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
      totalFiles: totalXmlCount,
      triggerActive: triggerExists,
      triggerEveryMinutes: triggerMins,
      lastRun: lastRunInfo
    };
  } catch (e) {
    LOG.error('getSystemStatus', 'Errore recupero stato sistema.', {error: e.message, stack: e.stack});
    return { success: false, error: e.message };
  }
}

/**
 * Recupera stato avanzamento IN TEMPO REALE per polling Sidebar (barra progresso).
 * 
 * Dati restituiti (se processo attivo):
 * - phase: {string} - Fase corrente (es. 'DISCOVERY', 'SCAN_EXTRACT', 'WRITE')
 * - current: {number} - Riga/file corrente processato
 * - total: {number} - Totale righe/file da processare
 * - message: {string} - Messaggio descrittivo (es. 'Fase 2: Estrazione dati...')
 * 
 * @returns {Object|null} Oggetto progress da STATE o null se nessun processo attivo
 * 
 * @example
 * const progress = getRunningStatus();
 * if (progress) {
 *   console.log(`${progress.phase}: ${progress.current}/${progress.total}`);
 * }
 */
function getRunningStatus() {
  // Questa funzione è corretta, legge solo la chiave di progresso
  return STATE.getJSON(App.config.keys.progress);
}