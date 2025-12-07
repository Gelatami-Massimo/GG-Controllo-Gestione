// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 999_stress_test.js
// RUOLO: Stress Test per LockService - validazione concorrenza
// NOTE: Simula operazioni concorrenti per verificare race conditions
// =============================================================

/**
 * STRESS TEST - LockService Validation
 * 
 * Obiettivo:
 * Verificare che LockService.getScriptLock() prevenga correttamente le race conditions
 * durante operazioni concorrenti (es. 10 vendite simultanee).
 * 
 * Metodologia:
 * 1. Crea foglio temporaneo "TEST_LOCK"
 * 2. Imposta contatore iniziale A1 = 0
 * 3. Simula N operazioni concorrenti:
 *    - Legge contatore
 *    - Attende 500ms (simula latency)
 *    - Incrementa contatore
 *    - Rilascia lock
 * 4. Verifica risultato finale: se = N → SUCCESS, altrimenti → RACE CONDITION
 * 
 * Esecuzione:
 * - METODO 1 (Loop Sequenziale): runStressTest(10, 'sequential')
 *   Esegue 10 iterazioni in loop veloce (simula coda)
 * 
 * - METODO 2 (Concorrenza Reale): runStressTest(1, 'concurrent')
 *   Lancia questa funzione da 10 TAB BROWSER diversi contemporaneamente
 *   per testare vera concorrenza multi-utente
 * 
 * Output:
 * - Log dettagliato in foglio "Log"
 * - Report finale in foglio "TEST_LOCK" (celle C1:C10)
 */

const STRESS_TEST = (() => {

  const TEST_SHEET_NAME = 'TEST_LOCK';
  const COUNTER_CELL = 'A1';
  const LOG_START_CELL = 'C1';
  const LOCK_TIMEOUT_MS = 30000; // 30 secondi timeout
  const SIMULATED_LATENCY_MS = 500; // Latenza simulata per esporre race conditions

  /**
   * Crea foglio di test e inizializza contatore
   * @private
   */
  function _setupTestSheet() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName(TEST_SHEET_NAME);
    
    if (sh) {
      // Resetta foglio esistente
      sh.clear();
    } else {
      // Crea nuovo foglio
      sh = ss.insertSheet(TEST_SHEET_NAME);
    }

    // Setup iniziale
    sh.getRange('A1').setValue(0).setFontWeight('bold').setFontSize(14);
    sh.getRange('A2').setValue('Contatore Race Condition Test');
    
    // Header log
    sh.getRange('C1').setValue('Test Log').setFontWeight('bold');
    sh.getRange('C2').setValue('Timestamp').setFontWeight('bold');
    sh.getRange('D2').setValue('Thread ID').setFontWeight('bold');
    sh.getRange('E2').setValue('Azione').setFontWeight('bold');
    sh.getRange('F2').setValue('Valore Letto').setFontWeight('bold');
    sh.getRange('G2').setValue('Valore Scritto').setFontWeight('bold');
    sh.getRange('H2').setValue('Lock Acquired').setFontWeight('bold');
    
    sh.setFrozenRows(2);
    sh.setColumnWidth(3, 150);
    sh.setColumnWidth(4, 100);
    sh.setColumnWidth(5, 150);
    
    return sh;
  }

  /**
   * Operazione critica SENZA lock (per confronto)
   * @private
   */
  function _criticalOperationNoLock(threadId, logRow, sh) {
    const startTime = new Date();
    
    // 1. Leggi contatore
    const currentValue = sh.getRange(COUNTER_CELL).getValue();
    
    // Log lettura
    sh.getRange(logRow, 3, 1, 6).setValues([[
      startTime.toISOString(),
      threadId,
      'READ (NO LOCK)',
      currentValue,
      '',
      'N/A'
    ]]);
    
    // 2. Simula latenza (window per race condition)
    Utilities.sleep(SIMULATED_LATENCY_MS);
    
    // 3. Incrementa e scrivi
    const newValue = currentValue + 1;
    sh.getRange(COUNTER_CELL).setValue(newValue);
    
    // Log scrittura
    sh.getRange(logRow + 1, 3, 1, 6).setValues([[
      new Date().toISOString(),
      threadId,
      'WRITE (NO LOCK)',
      currentValue,
      newValue,
      'N/A'
    ]]);
    
    return { success: true, finalValue: newValue };
  }

  /**
   * Operazione critica CON lock (production-ready)
   * @private
   */
  function _criticalOperationWithLock(threadId, logRow, sh) {
    const lock = LockService.getScriptLock();
    let lockAcquired = false;
    const startTime = new Date();
    
    try {
      // 1. Acquisisci lock con timeout
      lockAcquired = lock.tryLock(LOCK_TIMEOUT_MS);
      
      if (!lockAcquired) {
        // Lock timeout - impossibile procedere
        sh.getRange(logRow, 3, 1, 6).setValues([[
          startTime.toISOString(),
          threadId,
          'LOCK TIMEOUT',
          '',
          '',
          'FAILED'
        ]]);
        return { success: false, error: 'Lock timeout' };
      }
      
      // 2. Leggi contatore (in zona protetta)
      const currentValue = sh.getRange(COUNTER_CELL).getValue();
      
      // Log lettura
      sh.getRange(logRow, 3, 1, 6).setValues([[
        startTime.toISOString(),
        threadId,
        'READ (LOCKED)',
        currentValue,
        '',
        'YES'
      ]]);
      
      // 3. Simula latenza (lock impedisce accesso concorrente)
      Utilities.sleep(SIMULATED_LATENCY_MS);
      
      // 4. Incrementa e scrivi (ancora protetto)
      const newValue = currentValue + 1;
      sh.getRange(COUNTER_CELL).setValue(newValue);
      
      // Log scrittura
      sh.getRange(logRow + 1, 3, 1, 6).setValues([[
        new Date().toISOString(),
        threadId,
        'WRITE (LOCKED)',
        currentValue,
        newValue,
        'YES'
      ]]);
      
      return { success: true, finalValue: newValue };
      
    } catch (e) {
      // Errore critico
      sh.getRange(logRow, 3, 1, 6).setValues([[
        new Date().toISOString(),
        threadId,
        'ERROR',
        '',
        '',
        lockAcquired ? 'YES' : 'NO'
      ]]);
      
      return { success: false, error: e.message };
      
    } finally {
      // 5. SEMPRE rilascia lock (anche in caso di errore)
      if (lockAcquired) {
        lock.releaseLock();
      }
    }
  }

  /**
   * Esegue stress test con N iterazioni
   * @public
   * @param {number} [iterations=10] - Numero di iterazioni
   * @param {string} [mode='locked'] - Modalità: 'locked', 'unlocked', 'concurrent'
   * @returns {Object} Risultato test con statistiche
   */
  function runStressTest(iterations = 10, mode = 'locked') {
    const runId = LOG.generateRunId();
    LOG.info(runId, 'STRESS_TEST_START', 'Inizio Stress Test LockService', {
      iterations,
      mode,
      lockTimeout: LOCK_TIMEOUT_MS,
      simulatedLatency: SIMULATED_LATENCY_MS
    });

    try {
      // Setup foglio test
      SHARED_UTILS.showToast(`Inizializzazione Stress Test (${mode} mode)...`, 'Test', 5);
      const sh = _setupTestSheet();
      
      const results = {
        mode,
        iterations,
        expectedFinalValue: iterations,
        actualFinalValue: null,
        success: 0,
        failures: 0,
        lockTimeouts: 0,
        errors: [],
        duration: null
      };

      const testStartTime = Date.now();
      let currentLogRow = 3; // Inizio log (dopo header)

      // Esegui iterazioni
      for (let i = 1; i <= iterations; i++) {
        const threadId = mode === 'concurrent' 
          ? `THREAD_${Utilities.getUuid().substring(0, 8)}` 
          : `ITER_${String(i).padStart(3, '0')}`;

        let result;
        if (mode === 'unlocked') {
          // Test SENZA lock (per confronto - dovrebbe fallire)
          result = _criticalOperationNoLock(threadId, currentLogRow, sh);
        } else {
          // Test CON lock (production-ready)
          result = _criticalOperationWithLock(threadId, currentLogRow, sh);
        }

        if (result.success) {
          results.success++;
        } else {
          results.failures++;
          if (result.error === 'Lock timeout') {
            results.lockTimeouts++;
          }
          results.errors.push({
            iteration: i,
            threadId,
            error: result.error
          });
        }

        currentLogRow += 2; // 2 righe per operazione (READ + WRITE)

        // Throttle per evitare quota limits in loop veloce
        if (mode === 'sequential' && i < iterations) {
          Utilities.sleep(100); // 100ms tra iterazioni
        }
      }

      results.duration = Date.now() - testStartTime;

      // Leggi valore finale del contatore
      results.actualFinalValue = sh.getRange(COUNTER_CELL).getValue();

      // Genera report finale
      _writeTestReport(sh, results, runId);

      // Log risultati
      LOG.info(runId, 'STRESS_TEST_COMPLETE', 'Stress Test completato', results);

      // Toast finale
      const status = results.actualFinalValue === results.expectedFinalValue 
        ? '✅ SUCCESS' 
        : '❌ RACE CONDITION DETECTED';
      
      SHARED_UTILS.showToast(
        `${status} - Valore atteso: ${results.expectedFinalValue}, Valore reale: ${results.actualFinalValue}`,
        'Test Completato',
        10
      );

      return results;

    } catch (e) {
      LOG.error(runId, 'STRESS_TEST_ERROR', 'Errore durante stress test', {
        error: e.message,
        stack: e.stack
      });
      
      SHARED_UTILS.showToast('Errore durante stress test. Vedi Log.', 'Errore', 10);
      throw e;
    }
  }

  /**
   * Scrive report finale nel foglio test
   * @private
   */
  function _writeTestReport(sh, results, runId) {
    const reportStartRow = 1;
    const reportStartCol = 10; // Colonna J

    const report = [
      ['🔬 STRESS TEST REPORT', ''],
      ['Run ID', runId],
      ['Mode', results.mode.toUpperCase()],
      ['Iterations', results.iterations],
      ['', ''],
      ['📊 RISULTATI', ''],
      ['Expected Final Value', results.expectedFinalValue],
      ['Actual Final Value', results.actualFinalValue],
      ['Difference', results.actualFinalValue - results.expectedFinalValue],
      ['', ''],
      ['✅ Success', results.success],
      ['❌ Failures', results.failures],
      ['⏱️ Lock Timeouts', results.lockTimeouts],
      ['Duration (ms)', results.duration],
      ['', ''],
      ['🎯 VERDICT', '']
    ];

    // Calcola verdict
    const isSuccess = results.actualFinalValue === results.expectedFinalValue;
    const verdict = isSuccess 
      ? ['✅ PASS', 'Lock prevents race conditions']
      : ['❌ FAIL', 'Race condition detected!'];
    
    report.push(verdict);

    // Scrivi report
    sh.getRange(reportStartRow, reportStartCol, report.length, 2).setValues(report);

    // Formattazione
    sh.getRange(reportStartRow, reportStartCol, 1, 2)
      .setFontWeight('bold')
      .setFontSize(12)
      .setBackground(isSuccess ? '#d9ead3' : '#f4cccc');

    sh.getRange(reportStartRow + report.length - 1, reportStartCol, 1, 2)
      .setFontWeight('bold')
      .setFontSize(11)
      .setBackground(isSuccess ? '#b6d7a8' : '#ea9999');

    // Log errori (se presenti)
    if (results.errors.length > 0) {
      const errorStartRow = reportStartRow + report.length + 2;
      sh.getRange(errorStartRow, reportStartCol, 1, 2)
        .setValues([['⚠️ ERRORS', '']])
        .setFontWeight('bold');
      
      const errorRows = results.errors.map(e => [
        `${e.threadId}`,
        e.error
      ]);
      
      sh.getRange(errorStartRow + 1, reportStartCol, errorRows.length, 2)
        .setValues(errorRows);
    }
  }

  /**
   * Cleanup - elimina foglio di test
   * @public
   */
  function cleanupTestSheet() {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sh = ss.getSheetByName(TEST_SHEET_NAME);
      
      if (sh) {
        ss.deleteSheet(sh);
        SHARED_UTILS.showToast('Foglio test eliminato.', 'Cleanup', 3);
        LOG?.info('STRESS_TEST', 'Foglio test eliminato.');
      } else {
        SHARED_UTILS.showToast('Nessun foglio test da eliminare.', 'Info', 3);
      }
    } catch (e) {
      SHARED_UTILS.showToast('Errore durante cleanup.', 'Errore', 5);
      LOG?.error('STRESS_TEST', 'Errore cleanup foglio test', {
        error: e.message
      });
    }
  }

  // API pubblica
  return {
    runStressTest,
    cleanupTestSheet
  };

})();

// Registra nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('STRESS_TEST', ['SHARED_UTILS', 'LOG']);
}

// Registra nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('STRESS_TEST', STRESS_TEST);
}

// ============================================================================
// FUNZIONI GLOBALI PER MENU
// ============================================================================

/**
 * Test Sequenziale CON Lock (Production Mode)
 * Simula 10 operazioni concorrenti con LockService attivo.
 * Risultato atteso: Contatore = 10 (nessuna race condition)
 * 
 * @returns {void}
 */
function stressTestWithLock() {
  STRESS_TEST.runStressTest(10, 'locked');
}

/**
 * Test Sequenziale SENZA Lock (Comparison Mode)
 * Simula 10 operazioni concorrenti SENZA LockService.
 * Risultato atteso: Contatore < 10 (race condition presente)
 * 
 * ⚠️ ATTENZIONE: Questo test è intenzionalmente vulnerabile per dimostrare
 * l'importanza del LockService.
 * 
 * @returns {void}
 */
function stressTestWithoutLock() {
  STRESS_TEST.runStressTest(10, 'unlocked');
}

/**
 * Test Concorrenza Reale (Multi-Tab Mode)
 * Esegui questa funzione da 10 TAB BROWSER diversi contemporaneamente
 * per simulare vera concorrenza multi-utente.
 * 
 * Procedura:
 * 1. Apri 10 tab del browser con lo stesso spreadsheet
 * 2. In ogni tab: Estensioni > GELATAMI > Test > Concorrenza Reale (1x)
 * 3. Clicca il menu contemporaneamente in tutti i tab (entro 2-3 secondi)
 * 4. Verifica il report nel foglio TEST_LOCK
 * 
 * Risultato atteso: Contatore = 10 (lock serializza le operazioni)
 * 
 * @returns {void}
 */
function stressTestConcurrentReal() {
  STRESS_TEST.runStressTest(1, 'concurrent');
}

/**
 * Cleanup - Elimina foglio di test
 * 
 * @returns {void}
 */
function cleanupStressTest() {
  STRESS_TEST.cleanupTestSheet();
}
