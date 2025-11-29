// =============================================================
// SCRIPT MANUALE: Inizializzazione Trigger Dashboard
// USO: Esegui questo script da Apps Script Editor per creare
//      il foglio "Trigger Status" senza rieseguire Setup completo
// =============================================================

/**
 * Crea/resetta il foglio "Trigger Status" Dashboard.
 * 
 * ESECUZIONE:
 * 1. Apri Apps Script Editor
 * 2. Carica questo file (oppure copia/incolla in editor)
 * 3. Esegui la funzione: manualInitTriggerDashboard()
 * 4. Autorizza gli accessi se richiesto
 * 5. Verifica che il foglio "Trigger Status" sia stato creato
 */
function manualInitTriggerDashboard() {
  try {
    // Verifica che TRIGGER_DASHBOARD sia disponibile
    if (typeof TRIGGER_DASHBOARD === 'undefined') {
      throw new Error('TRIGGER_DASHBOARD module not loaded. Ensure 092_dashboard_trigger.js is deployed.');
    }
    
    // Log inizio
    console.log('=== INIZIALIZZAZIONE TRIGGER DASHBOARD ===');
    console.log('Data: ' + new Date().toISOString());
    
    // Esegui inizializzazione
    const success = TRIGGER_DASHBOARD.initSheet();
    
    if (success) {
      console.log('✅ Foglio "Trigger Status" creato con successo!');
      console.log('📊 Dashboard componenti:');
      console.log('   • Status Trigger (🟢 ATTIVO / 🔴 INATTIVO)');
      console.log('   • Ultima Esecuzione');
      console.log('   • Health Score (0-100)');
      console.log('   • Storico Esecuzioni (ultime 50)');
      console.log('   • Metriche Aggregate');
      
      // Mostra alert se in contesto UI
      try {
        const ui = SpreadsheetApp.getUi();
        ui.alert(
          '✅ Dashboard Creata!',
          'Il foglio "Trigger Status" è stato creato con successo.\n\n' +
          'Apri il foglio per visualizzare lo stato del trigger automatico.',
          ui.ButtonSet.OK
        );
      } catch (e) {
        // UI non disponibile (esecuzione da trigger/script standalone)
        console.log('ℹ️ UI non disponibile, usa console.log');
      }
      
      return true;
      
    } else {
      console.error('❌ Errore durante creazione foglio "Trigger Status"');
      console.error('Controlla i log per dettagli: LOG.getRecent() o DEBUG.openLogSheet()');
      return false;
    }
    
  } catch (error) {
    console.error('❌ ERRORE CRITICO:', error.message);
    console.error('Stack:', error.stack);
    
    // Mostra alert errore se in contesto UI
    try {
      const ui = SpreadsheetApp.getUi();
      ui.alert(
        '❌ Errore Creazione Dashboard',
        'Impossibile creare il foglio "Trigger Status".\n\n' +
        'Errore: ' + error.message + '\n\n' +
        'Verifica che il file 092_dashboard_trigger.js sia deployato correttamente.',
        ui.ButtonSet.OK
      );
    } catch (e) {
      // Nessuna UI disponibile
    }
    
    return false;
  }
}

/**
 * Verifica lo stato corrente del Trigger Dashboard.
 * Utile per diagnostica.
 */
function checkTriggerDashboardStatus() {
  console.log('=== DIAGNOSTICA TRIGGER DASHBOARD ===');
  
  // 1. Verifica modulo TRIGGER_DASHBOARD
  console.log('\n1. Verifica Modulo:');
  if (typeof TRIGGER_DASHBOARD === 'undefined') {
    console.error('   ❌ TRIGGER_DASHBOARD non caricato!');
    console.error('   Soluzione: Verifica che 092_dashboard_trigger.js sia deployato');
    return;
  } else {
    console.log('   ✅ TRIGGER_DASHBOARD caricato');
  }
  
  // 2. Verifica funzioni disponibili
  console.log('\n2. Funzioni Disponibili:');
  const requiredFunctions = ['initSheet', 'updateTriggerStatus', 'recordExecution', 'calculateHealthScore', 'getTriggerMetrics'];
  requiredFunctions.forEach(fn => {
    if (typeof TRIGGER_DASHBOARD[fn] === 'function') {
      console.log('   ✅ ' + fn);
    } else {
      console.error('   ❌ ' + fn + ' mancante!');
    }
  });
  
  // 3. Verifica foglio esistente
  console.log('\n3. Verifica Foglio:');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Trigger Status');
  
  if (sheet) {
    console.log('   ✅ Foglio "Trigger Status" trovato');
    console.log('   📊 Righe: ' + sheet.getLastRow());
    console.log('   📊 Colonne: ' + sheet.getLastColumn());
  } else {
    console.warn('   ⚠️ Foglio "Trigger Status" NON trovato');
    console.log('   💡 Esegui: manualInitTriggerDashboard() per crearlo');
  }
  
  // 4. Verifica metriche (se foglio esiste)
  if (sheet) {
    console.log('\n4. Metriche Correnti:');
    try {
      const metrics = TRIGGER_DASHBOARD.getTriggerMetrics();
      console.log('   📈 Success Rate: ' + metrics.successRate.toFixed(1) + '%');
      console.log('   ⏱️ Avg Duration: ' + metrics.avgDuration.toFixed(1) + 's');
      console.log('   ⏱️ Max Duration: ' + metrics.maxDuration.toFixed(1) + 's');
      console.log('   🔢 Total Runs: ' + metrics.totalRuns);
      
      if (metrics.lastError) {
        console.warn('   ⚠️ Last Error: ' + metrics.lastError.error);
        console.warn('      Timestamp: ' + metrics.lastError.timestamp);
      } else {
        console.log('   ✅ Nessun errore recente');
      }
    } catch (e) {
      console.error('   ❌ Errore recupero metriche: ' + e.message);
    }
  }
  
  console.log('\n=== FINE DIAGNOSTICA ===');
}

/**
 * QUICK FIX: Esegue inizializzazione e poi aggiorna status a INATTIVO.
 * Utile se hai appena deployato e vuoi vedere subito il dashboard.
 */
function quickFixTriggerDashboard() {
  console.log('=== QUICK FIX: Inizializzazione + Status Update ===\n');
  
  // 1. Inizializza foglio
  const initSuccess = manualInitTriggerDashboard();
  
  if (!initSuccess) {
    console.error('❌ Inizializzazione fallita, interrompo quick fix.');
    return;
  }
  
  // 2. Aspetta 1 secondo (per sicurezza)
  Utilities.sleep(1000);
  
  // 3. Imposta status iniziale a INATTIVO (default sicuro)
  console.log('\n3. Imposto status iniziale...');
  try {
    TRIGGER_DASHBOARD.updateTriggerStatus(false); // 🔴 INATTIVO
    console.log('✅ Status impostato a: 🔴 INATTIVO');
    console.log('\nℹ️ Per attivare il trigger, usa:');
    console.log('   Menu → GG Gestione → Attiva Trigger Automatico');
  } catch (e) {
    console.error('❌ Errore impostazione status:', e.message);
  }
  
  console.log('\n=== QUICK FIX COMPLETATO ===');
  console.log('📊 Apri il foglio "Trigger Status" per visualizzare il dashboard');
}
