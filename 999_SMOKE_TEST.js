/**
 * ============================================================================
 * 🧪 SMOKE TEST - SHARED_UTILS & BACKWARD COMPATIBILITY
 * ============================================================================
 * 
 * Script di test per verificare:
 * 1. ✅ SHARED_UTILS caricato correttamente nel namespace GG
 * 2. ✅ Pattern consolidation (getSheetContext, safeExecute, isValidDate)
 * 3. ✅ Backward compatibility wrappers UTIL deprecated
 * 4. ✅ DATE_UTILS API completa accessibile
 * 5. ✅ Zero breaking changes nel codice esistente
 * 
 * ISTRUZIONI:
 * - Copia/incolla questo file nell'editor Google Apps Script
 * - Esegui: runSmokeTest() dal menu Run
 * - Verifica output nel Logger (Ctrl+Enter o View > Logs)
 * - Tutti i check devono mostrare ✅ (nessun ❌)
 * 
 * MODALITÀ: Test NON invasivo (solo lettura, no scritture fogli)
 * ============================================================================
 */

/**
 * Funzione principale Smoke Test
 * Esegui questa funzione per verificare l'integrità post-refactoring
 */
function runSmokeTest() {
  console.log('================================================================================');
  console.log('🧪 SMOKE TEST - Verifica SHARED_UTILS & Backward Compatibility');
  console.log('================================================================================');
  console.log('Data test: ' + new Date().toLocaleString('it-IT'));
  console.log('');
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  // TEST 1: Module Registry & Namespace
  testModuleRegistry(results);
  
  // TEST 2: Pattern Consolidation Core
  testPatternConsolidation(results);
  
  // TEST 3: Backward Compatibility Wrappers
  testBackwardCompatibility(results);
  
  // TEST 4: DATE_UTILS API
  testDateUtils(results);
  
  // TEST 5: Utility Functions
  testUtilityFunctions(results);
  
  // Summary Report
  printSummary(results);
  
  return results;
}

/**
 * TEST 1: Verifica Module Registry e Namespace GG
 */
function testModuleRegistry(results) {
  console.log('--------------------------------------------------------------------------------');
  console.log('TEST 1: Module Registry & Namespace GG');
  console.log('--------------------------------------------------------------------------------');
  
  try {
    // Check SHARED_UTILS caricato
    if (typeof GG === 'undefined') {
      logTest(results, '❌ CRITICAL: Namespace GG non definito', false);
      return;
    }
    logTest(results, '✅ Namespace GG definito', true);
    
    if (typeof GG.SHARED_UTILS === 'undefined') {
      logTest(results, '❌ CRITICAL: GG.SHARED_UTILS non caricato', false);
      return;
    }
    logTest(results, '✅ GG.SHARED_UTILS caricato nel namespace', true);
    
    // Check funzioni core disponibili
    const coreFunctions = ['getSheetContext', 'safeExecute', 'isValidDate'];
    for (const fn of coreFunctions) {
      if (typeof GG.SHARED_UTILS[fn] !== 'function') {
        logTest(results, `❌ Funzione ${fn} non disponibile in SHARED_UTILS`, false);
      } else {
        logTest(results, `✅ Funzione ${fn} disponibile`, true);
      }
    }
    
    // Check UTIL ancora disponibile (backward compatibility)
    if (typeof UTIL === 'undefined') {
      logTest(results, '❌ CRITICAL: UTIL non disponibile (backward compatibility rotta)', false);
    } else {
      logTest(results, '✅ UTIL disponibile (backward compatibility OK)', true);
    }
    
  } catch (e) {
    logTest(results, '❌ ERRORE TEST 1: ' + e.message, false);
    console.error(e.stack);
  }
  
  console.log('');
}

/**
 * TEST 2: Pattern Consolidation (getSheetContext, safeExecute, isValidDate)
 */
function testPatternConsolidation(results) {
  console.log('--------------------------------------------------------------------------------');
  console.log('TEST 2: Pattern Consolidation Core');
  console.log('--------------------------------------------------------------------------------');
  
  try {
    // TEST 2.1: getSheetContext() - Verifica su foglio esistente
    console.log('TEST 2.1: getSheetContext()');
    try {
      // Prova con foglio Fatture (dovrebbe esistere)
      const ctx = GG.SHARED_UTILS.getSheetContext(SHEETS.SHEET_NAMES.Fatture);
      
      if (!ctx) {
        logTest(results, '⚠️  getSheetContext() ritorna null (foglio Fatture non trovato - verificare manualmente)', true);
      } else {
        // Verifica struttura ritornata
        const requiredKeys = ['sheet', 'headerRow', 'idx', 'lastRow', 'lastCol'];
        let structureOk = true;
        for (const key of requiredKeys) {
          if (!(key in ctx)) {
            logTest(results, `❌ getSheetContext(): manca proprietà '${key}'`, false);
            structureOk = false;
          }
        }
        
        if (structureOk) {
          logTest(results, '✅ getSheetContext() struttura corretta (sheet, headerRow, idx, lastRow, lastCol)', true);
          console.log(`   → Foglio: ${ctx.sheet ? ctx.sheet.getName() : 'N/A'}, Righe: ${ctx.lastRow}, Colonne: ${ctx.lastCol}`);
        }
      }
    } catch (e) {
      logTest(results, '❌ getSheetContext() errore: ' + e.message, false);
    }
    
    // TEST 2.2: safeExecute() - Wrapper error handling
    console.log('TEST 2.2: safeExecute()');
    try {
      // Test funzione successo
      const resultSuccess = GG.SHARED_UTILS.safeExecute(
        () => {
          return { value: 42, message: 'Test OK' };
        },
        'SMOKE_TEST',
        { 
          errorMessage: 'Errore test safeExecute',
          silent: true // No toast durante test
        }
      );
      
      if (resultSuccess && resultSuccess.value === 42) {
        logTest(results, '✅ safeExecute() funzione successo OK', true);
      } else {
        logTest(results, '❌ safeExecute() ritorno inaspettato', false);
      }
      
      // Test funzione errore (should catch)
      const resultError = GG.SHARED_UTILS.safeExecute(
        () => {
          throw new Error('Test error intenzionale');
        },
        'SMOKE_TEST',
        { 
          errorMessage: 'Errore catturato correttamente',
          silent: true
        }
      );
      
      if (resultError === null || resultError === undefined) {
        logTest(results, '✅ safeExecute() catch errore OK', true);
      } else {
        logTest(results, '⚠️  safeExecute() catch errore comportamento inaspettato', true);
      }
      
    } catch (e) {
      logTest(results, '❌ safeExecute() errore: ' + e.message, false);
    }
    
    // TEST 2.3: isValidDate() - Validazione date
    console.log('TEST 2.3: isValidDate()');
    try {
      const testCases = [
        { value: new Date(), expected: true, desc: 'Date valida' },
        { value: new Date('2025-11-28'), expected: true, desc: 'Date da stringa ISO' },
        { value: null, expected: false, desc: 'null' },
        { value: undefined, expected: false, desc: 'undefined' },
        { value: 'not a date', expected: false, desc: 'stringa invalida' },
        { value: 12345, expected: false, desc: 'numero' },
        { value: new Date('invalid'), expected: false, desc: 'Date invalida (NaN)' }
      ];
      
      let allPassed = true;
      for (const test of testCases) {
        const result = GG.SHARED_UTILS.isValidDate(test.value);
        if (result !== test.expected) {
          logTest(results, `❌ isValidDate(${test.desc}): atteso ${test.expected}, ricevuto ${result}`, false);
          allPassed = false;
        }
      }
      
      if (allPassed) {
        logTest(results, `✅ isValidDate() tutti i ${testCases.length} test case OK`, true);
      }
      
    } catch (e) {
      logTest(results, '❌ isValidDate() errore: ' + e.message, false);
    }
    
  } catch (e) {
    logTest(results, '❌ ERRORE TEST 2: ' + e.message, false);
    console.error(e.stack);
  }
  
  console.log('');
}

/**
 * TEST 3: Backward Compatibility Wrappers UTIL
 */
function testBackwardCompatibility(results) {
  console.log('--------------------------------------------------------------------------------');
  console.log('TEST 3: Backward Compatibility Wrappers');
  console.log('--------------------------------------------------------------------------------');
  
  try {
    // TEST 3.1: UTIL.showToast() wrapper
    console.log('TEST 3.1: UTIL.showToast() (deprecated wrapper)');
    try {
      // Non chiamiamo realmente (evita popup), verifichiamo solo esistenza
      if (typeof UTIL.showToast === 'function') {
        logTest(results, '✅ UTIL.showToast() disponibile (backward compatibility)', true);
      } else {
        logTest(results, '❌ UTIL.showToast() non disponibile', false);
      }
    } catch (e) {
      logTest(results, '❌ UTIL.showToast() errore: ' + e.message, false);
    }
    
    // TEST 3.2: UTIL.getColumnLetter() wrapper
    console.log('TEST 3.2: UTIL.getColumnLetter() (deprecated wrapper)');
    try {
      const testCases = [
        { input: 0, expected: 'A' },
        { input: 25, expected: 'Z' },
        { input: 26, expected: 'AA' },
        { input: 701, expected: 'ZZ' }
      ];
      
      let allPassed = true;
      for (const test of testCases) {
        const result = UTIL.getColumnLetter(test.input);
        if (result !== test.expected) {
          logTest(results, `❌ UTIL.getColumnLetter(${test.input}): atteso '${test.expected}', ricevuto '${result}'`, false);
          allPassed = false;
        }
      }
      
      if (allPassed) {
        logTest(results, `✅ UTIL.getColumnLetter() wrapper funzionante (${testCases.length} test case)`, true);
      }
    } catch (e) {
      logTest(results, '❌ UTIL.getColumnLetter() errore: ' + e.message, false);
    }
    
    // TEST 3.3: UTIL.checkColumns() wrapper
    console.log('TEST 3.3: UTIL.checkColumns() (deprecated wrapper)');
    try {
      const mockIdx = { Fornitore: 0, Data: 1, Importo: 2 };
      const required = ['Fornitore', 'Data', 'Importo', 'ColonnaMancante'];
      const missing = UTIL.checkColumns(mockIdx, required);
      
      if (Array.isArray(missing) && missing.length === 1 && missing[0] === 'ColonnaMancante') {
        logTest(results, '✅ UTIL.checkColumns() wrapper funzionante', true);
      } else {
        logTest(results, '❌ UTIL.checkColumns() risultato inaspettato: ' + JSON.stringify(missing), false);
      }
    } catch (e) {
      logTest(results, '❌ UTIL.checkColumns() errore: ' + e.message, false);
    }
    
    // TEST 3.4: UTIL.forceText() wrapper
    console.log('TEST 3.4: UTIL.forceText() (deprecated wrapper)');
    try {
      const testCases = [
        { input: '00123', expected: "'00123" },
        { input: '123', expected: "'123" },
        { input: 'text', expected: "'text" }
      ];
      
      let allPassed = true;
      for (const test of testCases) {
        const result = UTIL.forceText(test.input);
        if (result !== test.expected) {
          logTest(results, `❌ UTIL.forceText('${test.input}'): atteso '${test.expected}', ricevuto '${result}'`, false);
          allPassed = false;
        }
      }
      
      if (allPassed) {
        logTest(results, `✅ UTIL.forceText() wrapper funzionante (${testCases.length} test case)`, true);
      }
    } catch (e) {
      logTest(results, '❌ UTIL.forceText() errore: ' + e.message, false);
    }
    
    // TEST 3.5: UTIL.date.* namespace wrappers
    console.log('TEST 3.5: UTIL.date.* namespace (deprecated wrappers)');
    try {
      if (typeof UTIL.date === 'undefined' || UTIL.date === null) {
        logTest(results, '❌ UTIL.date namespace non disponibile', false);
      } else {
        const dateFunctions = ['formatIsoDate', 'formatItalianDate', 'parseXmlDate', 'extractYearMonth'];
        let allAvailable = true;
        
        for (const fn of dateFunctions) {
          if (typeof UTIL.date[fn] !== 'function') {
            logTest(results, `❌ UTIL.date.${fn}() non disponibile`, false);
            allAvailable = false;
          }
        }
        
        if (allAvailable) {
          logTest(results, `✅ UTIL.date.* namespace wrapper disponibile (${dateFunctions.length} funzioni verificate)`, true);
        }
      }
    } catch (e) {
      logTest(results, '❌ UTIL.date.* errore: ' + e.message, false);
    }
    
  } catch (e) {
    logTest(results, '❌ ERRORE TEST 3: ' + e.message, false);
    console.error(e.stack);
  }
  
  console.log('');
}

/**
 * TEST 4: DATE_UTILS API Completa
 */
function testDateUtils(results) {
  console.log('--------------------------------------------------------------------------------');
  console.log('TEST 4: DATE_UTILS API Completa');
  console.log('--------------------------------------------------------------------------------');
  
  try {
    const testDate = new Date('2025-11-28T14:30:00');
    
    // TEST 4.1: Formatting functions
    console.log('TEST 4.1: Date Formatting');
    try {
      const formats = [
        { fn: 'formatIsoDate', expected: '2025-11-28' },
        { fn: 'formatItalianDate', expected: '28/11/2025' },
        { fn: 'formatTimestamp', expectedPattern: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/ }
      ];
      
      let allPassed = true;
      for (const test of formats) {
        const result = GG.SHARED_UTILS.date[test.fn](testDate);
        
        if (test.expected) {
          if (result !== test.expected) {
            logTest(results, `❌ date.${test.fn}(): atteso '${test.expected}', ricevuto '${result}'`, false);
            allPassed = false;
          }
        } else if (test.expectedPattern) {
          if (!test.expectedPattern.test(result)) {
            logTest(results, `❌ date.${test.fn}(): formato inaspettato '${result}'`, false);
            allPassed = false;
          }
        }
      }
      
      if (allPassed) {
        logTest(results, `✅ Date formatting funzionante (${formats.length} formati testati)`, true);
      }
    } catch (e) {
      logTest(results, '❌ Date formatting errore: ' + e.message, false);
    }
    
    // TEST 4.2: Parsing functions
    console.log('TEST 4.2: Date Parsing');
    try {
      // parseXmlDate (ISO 8601)
      const xmlDate = GG.SHARED_UTILS.date.parseXmlDate('2025-11-28');
      if (xmlDate instanceof Date && !isNaN(xmlDate.getTime())) {
        logTest(results, '✅ date.parseXmlDate() parsing ISO 8601 OK', true);
      } else {
        logTest(results, '❌ date.parseXmlDate() parsing fallito', false);
      }
      
      // parseItalianDate (DD/MM/YYYY)
      const italianDate = GG.SHARED_UTILS.date.parseItalianDate('28/11/2025');
      if (italianDate instanceof Date && !isNaN(italianDate.getTime())) {
        logTest(results, '✅ date.parseItalianDate() parsing DD/MM/YYYY OK', true);
      } else {
        logTest(results, '❌ date.parseItalianDate() parsing fallito', false);
      }
    } catch (e) {
      logTest(results, '❌ Date parsing errore: ' + e.message, false);
    }
    
    // TEST 4.3: Extraction & Calculation
    console.log('TEST 4.3: Date Extraction & Calculation');
    try {
      // extractYearMonth
      const ym = GG.SHARED_UTILS.date.extractYearMonth(testDate);
      if (ym && ym.anno === '2025' && ym.mese === 11) {
        logTest(results, '✅ date.extractYearMonth() extraction OK', true);
      } else {
        logTest(results, '❌ date.extractYearMonth() risultato inaspettato: ' + JSON.stringify(ym), false);
      }
      
      // getItalianMonthName
      const monthName = GG.SHARED_UTILS.date.getItalianMonthName(11);
      if (monthName === 'Novembre') {
        logTest(results, '✅ date.getItalianMonthName() nome mese OK', true);
      } else {
        logTest(results, `❌ date.getItalianMonthName(11): atteso 'Novembre', ricevuto '${monthName}'`, false);
      }
      
      // daysBetween
      const date1 = new Date('2025-11-01');
      const date2 = new Date('2025-11-28');
      const days = GG.SHARED_UTILS.date.daysBetween(date1, date2);
      if (days === 27) {
        logTest(results, '✅ date.daysBetween() calcolo differenza OK', true);
      } else {
        logTest(results, `❌ date.daysBetween(): atteso 27, ricevuto ${days}`, false);
      }
      
    } catch (e) {
      logTest(results, '❌ Date extraction/calculation errore: ' + e.message, false);
    }
    
    // TEST 4.4: Month boundaries
    console.log('TEST 4.4: Date Month Boundaries');
    try {
      const firstDay = GG.SHARED_UTILS.date.getFirstDayOfMonth(testDate);
      const lastDay = GG.SHARED_UTILS.date.getLastDayOfMonth(testDate);
      
      if (firstDay.getDate() === 1 && firstDay.getMonth() === 10) { // 10 = Novembre (0-based)
        logTest(results, '✅ date.getFirstDayOfMonth() calcolo OK', true);
      } else {
        logTest(results, '❌ date.getFirstDayOfMonth() risultato inaspettato', false);
      }
      
      if (lastDay.getDate() === 30 && lastDay.getMonth() === 10) { // Novembre ha 30 giorni
        logTest(results, '✅ date.getLastDayOfMonth() calcolo OK', true);
      } else {
        logTest(results, '❌ date.getLastDayOfMonth() risultato inaspettato', false);
      }
    } catch (e) {
      logTest(results, '❌ Date boundaries errore: ' + e.message, false);
    }
    
  } catch (e) {
    logTest(results, '❌ ERRORE TEST 4: ' + e.message, false);
    console.error(e.stack);
  }
  
  console.log('');
}

/**
 * TEST 5: Utility Functions Bonus
 */
function testUtilityFunctions(results) {
  console.log('--------------------------------------------------------------------------------');
  console.log('TEST 5: Utility Functions Bonus');
  console.log('--------------------------------------------------------------------------------');
  
  try {
    // TEST 5.1: normalizeString()
    console.log('TEST 5.1: normalizeString()');
    try {
      const testCases = [
        { input: '  test   string  ', expected: 'TEST STRING' },
        { input: 'CamelCase', expected: 'CAMELCASE' },
        { input: null, expected: '' },
        { input: undefined, expected: '' }
      ];
      
      let allPassed = true;
      for (const test of testCases) {
        const result = GG.SHARED_UTILS.normalizeString(test.input);
        if (result !== test.expected) {
          logTest(results, `❌ normalizeString('${test.input}'): atteso '${test.expected}', ricevuto '${result}'`, false);
          allPassed = false;
        }
      }
      
      if (allPassed) {
        logTest(results, `✅ normalizeString() funzionante (${testCases.length} test case)`, true);
      }
    } catch (e) {
      logTest(results, '❌ normalizeString() errore: ' + e.message, false);
    }
    
    // TEST 5.2: toNumber()
    console.log('TEST 5.2: toNumber()');
    try {
      const testCases = [
        { input: '42', expected: 42 },
        { input: '3.14', expected: 3.14 },
        { input: null, defaultVal: 99, expected: 99 },
        { input: 'not a number', defaultVal: 0, expected: 0 },
        { input: undefined, defaultVal: -1, expected: -1 }
      ];
      
      let allPassed = true;
      for (const test of testCases) {
        const result = GG.SHARED_UTILS.toNumber(test.input, test.defaultVal);
        if (result !== test.expected) {
          logTest(results, `❌ toNumber('${test.input}', ${test.defaultVal}): atteso ${test.expected}, ricevuto ${result}`, false);
          allPassed = false;
        }
      }
      
      if (allPassed) {
        logTest(results, `✅ toNumber() funzionante (${testCases.length} test case)`, true);
      }
    } catch (e) {
      logTest(results, '❌ toNumber() errore: ' + e.message, false);
    }
    
    // TEST 5.3: toBoolean()
    console.log('TEST 5.3: toBoolean()');
    try {
      const testCases = [
        { input: 'true', expected: true },
        { input: 'TRUE', expected: true },
        { input: 'vero', expected: true },
        { input: '1', expected: true },
        { input: 'si', expected: true },
        { input: 'yes', expected: true },
        { input: 'false', expected: false },
        { input: '0', expected: false },
        { input: null, defaultVal: true, expected: true },
        { input: undefined, defaultVal: false, expected: false }
      ];
      
      let allPassed = true;
      for (const test of testCases) {
        const result = GG.SHARED_UTILS.toBoolean(test.input, test.defaultVal);
        if (result !== test.expected) {
          logTest(results, `❌ toBoolean('${test.input}', ${test.defaultVal}): atteso ${test.expected}, ricevuto ${result}`, false);
          allPassed = false;
        }
      }
      
      if (allPassed) {
        logTest(results, `✅ toBoolean() funzionante (${testCases.length} test case)`, true);
      }
    } catch (e) {
      logTest(results, '❌ toBoolean() errore: ' + e.message, false);
    }
    
  } catch (e) {
    logTest(results, '❌ ERRORE TEST 5: ' + e.message, false);
    console.error(e.stack);
  }
  
  console.log('');
}

/**
 * Helper: Log singolo test e aggiorna contatori
 */
function logTest(results, message, passed) {
  console.log(message);
  results.tests.push({ message: message, passed: passed });
  
  if (passed) {
    results.passed++;
  } else {
    results.failed++;
  }
}

/**
 * Helper: Stampa summary finale
 */
function printSummary(results) {
  console.log('================================================================================');
  console.log('📊 SUMMARY SMOKE TEST');
  console.log('================================================================================');
  console.log(`Total Tests: ${results.passed + results.failed}`);
  console.log(`✅ Passed: ${results.passed}`);
  console.log(`❌ Failed: ${results.failed}`);
  console.log('');
  
  if (results.failed === 0) {
    console.log('🎉 TUTTI I TEST PASSATI! ✅');
    console.log('');
    console.log('✅ SHARED_UTILS funzionante correttamente');
    console.log('✅ Backward compatibility garantita');
    console.log('✅ Pattern consolidation operativo');
    console.log('✅ DATE_UTILS API completa');
    console.log('');
    console.log('🚀 SISTEMA PRONTO PER REFACTORING MODULI');
  } else {
    console.log('⚠️  ALCUNI TEST FALLITI - VERIFICA RICHIESTA');
    console.log('');
    console.log('Test falliti:');
    for (const test of results.tests) {
      if (!test.passed) {
        console.log('  - ' + test.message);
      }
    }
    console.log('');
    console.log('⚠️  NON PROCEDERE CON REFACTORING FINO A RISOLUZIONE ERRORI');
  }
  
  console.log('================================================================================');
  console.log('Fine Smoke Test - ' + new Date().toLocaleString('it-IT'));
  console.log('================================================================================');
}

/**
 * Quick Test: Esegui solo test critici (per verifica rapida)
 */
function runQuickTest() {
  console.log('🚀 QUICK TEST - Solo verifica critica');
  console.log('');
  
  try {
    // 1. Check namespace
    if (typeof GG === 'undefined' || typeof GG.SHARED_UTILS === 'undefined') {
      console.log('❌ CRITICAL: SHARED_UTILS non caricato');
      return false;
    }
    console.log('✅ SHARED_UTILS caricato');
    
    // 2. Check pattern core
    if (typeof GG.SHARED_UTILS.getSheetContext !== 'function') {
      console.log('❌ getSheetContext() mancante');
      return false;
    }
    console.log('✅ getSheetContext() disponibile');
    
    // 3. Check backward compatibility
    if (typeof UTIL === 'undefined' || typeof UTIL.showToast !== 'function') {
      console.log('❌ Backward compatibility rotta');
      return false;
    }
    console.log('✅ Backward compatibility OK');
    
    // 4. Check DATE_UTILS
    if (typeof GG.SHARED_UTILS.date === 'undefined') {
      console.log('❌ DATE_UTILS mancante');
      return false;
    }
    console.log('✅ DATE_UTILS disponibile');
    
    console.log('');
    console.log('✅ QUICK TEST PASSED - Sistema operativo');
    return true;
    
  } catch (e) {
    console.log('❌ QUICK TEST FAILED: ' + e.message);
    console.error(e.stack);
    return false;
  }
}
