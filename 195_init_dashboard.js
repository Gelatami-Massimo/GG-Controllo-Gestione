// =============================================================
// SCRIPT MANUALE: Inizializzazione Trigger Dashboard
// VERSIONE: 1.0
// USO: Esegui questa funzione da Apps Script Editor per creare
//      il foglio "Trigger Status" senza rieseguire Setup completo
// =============================================================

/**
 * MAIN: Crea il foglio "Trigger Status" Dashboard.
 * 
 * COME ESEGUIRE:
 * 1. Vai su Apps Script Editor del tuo spreadsheet
 * 2. Apri questo file: 195_init_dashboard.js
 * 3. Seleziona la funzione: initTriggerDashboardManually
 * 4. Clicca "Esegui" (▶️)
 * 5. Autorizza gli accessi se richiesto
 * 6. Verifica che il foglio "Trigger Status" sia stato creato
 */
function initTriggerDashboardManually() {
  try {
    console.log('=== INIZIALIZZAZIONE TRIGGER DASHBOARD ===');
    console.log('Timestamp: ' + new Date().toISOString());
    
    // Verifica modulo disponibile
    if (typeof TRIGGER_DASHBOARD === 'undefined') {
      throw new Error('TRIGGER_DASHBOARD module non caricato. Verifica deployment di 092_dashboard_trigger.js');
    }
    
    // Esegui inizializzazione
    console.log('Esecuzione TRIGGER_DASHBOARD.initSheet()...');
    const success = TRIGGER_DASHBOARD.initSheet();
    
    if (success) {
      console.log('✅ SUCCESSO! Foglio "Trigger Status" creato.');
      
      // Imposta status iniziale a INATTIVO
      TRIGGER_DASHBOARD.updateTriggerStatus(false);
      console.log('✅ Status iniziale impostato: 🔴 INATTIVO');
      
      // Mostra alert
      const ui = SpreadsheetApp.getUi();
      ui.alert(
        '✅ Dashboard Creata!',
        'Il foglio "Trigger Status" è stato creato con successo.\n\n' +
        'Componenti:\n' +
        '• Status Trigger (🟢/🔴)\n' +
        '• Ultima Esecuzione\n' +
        '• Health Score (0-100)\n' +
        '• Storico Esecuzioni\n' +
        '• Metriche Aggregate\n\n' +
        'Per attivare il trigger: Menu → GG Gestione → Attiva Trigger Automatico',
        ui.ButtonSet.OK
      );
      
      return true;
    } else {
      throw new Error('initSheet() returned false');
    }
    
  } catch (error) {
    console.error('❌ ERRORE:', error.message);
    console.error('Stack:', error.stack);
    
    const ui = SpreadsheetApp.getUi();
    ui.alert(
      '❌ Errore Creazione Dashboard',
      'Impossibile creare il foglio "Trigger Status".\n\n' +
      'Errore: ' + error.message + '\n\n' +
      'Verifica che 092_dashboard_trigger.js sia deployato correttamente.',
      ui.ButtonSet.OK
    );
    
    return false;
  }
}
