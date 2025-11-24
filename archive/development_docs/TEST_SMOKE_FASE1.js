// =============================================================
// SMOKE TEST - FASE 1 FOUNDATIONS
// Valida: CONSTANTS, SHEET_ITERATOR, DATE_UTILS, DASHBOARD_TRIGGER
// =============================================================

/**
 * TEST SUITE COMPLETO FASE 1
 * Esegui questo script da Google Apps Script Editor per validare tutte le modifiche.
 */
function runAllSmokeTests() {
  Logger.log('========================================');
  Logger.log('🧪 SMOKE TEST FASE 1 - START');
  Logger.log('========================================\n');
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  // Test 1: CONSTANTS
  _testConstants(results);
  
  // Test 2: DATE_UTILS
  _testDateUtils(results);
  
  // Test 3: SHEET_ITERATOR (structure only)
  _testSheetIterator(results);
  
  // Test 4: DASHBOARD_TRIGGER
  _testDashboardTrigger(results);
  
  // Report finale
  Logger.log('\n========================================');
  Logger.log('📊 RISULTATI FINALI');
  Logger.log('========================================');
  Logger.log('✅ Passed: ' + results.passed);
  Logger.log('❌ Failed: ' + results.failed);
  Logger.log('📈 Total:  ' + (results.passed + results.failed));
  Logger.log('Success Rate: ' + ((results.passed / (results.passed + results.failed)) * 100).toFixed(1) + '%');
  
  if (results.failed > 0) {
    Logger.log('\n⚠️ FALLIMENTI:');
    results.tests.filter(t => !t.passed).forEach(t => {
      Logger.log('  - ' + t.name + ': ' + t.error);
    });
  }
  
  Logger.log('\n========================================\n');
  
  return results.failed === 0;
}

// ============================================================================
// TEST 1: CONSTANTS
// ============================================================================
function _testConstants(results) {
  Logger.log('📦 TEST 1: CONSTANTS Module');
  Logger.log('─────────────────────────────────────\n');
  
  // Test 1.1: Module exists
  _test(results, 'CONSTANTS module exists', () => {
    if (typeof CONSTANTS === 'undefined') {
      throw new Error('CONSTANTS is not defined');
    }
    return true;
  });
  
  // Test 1.2: DATE_PATTERNS exists
  _test(results, 'CONSTANTS.DATE_PATTERNS exists', () => {
    if (!CONSTANTS.DATE_PATTERNS) {
      throw new Error('DATE_PATTERNS not found in CONSTANTS');
    }
    if (!CONSTANTS.DATE_PATTERNS.ISO_DATE) {
      throw new Error('ISO_DATE pattern missing');
    }
    return true;
  });
  
  // Test 1.3: DATE_REGEX_GROUPS exists
  _test(results, 'CONSTANTS.DATE_REGEX_GROUPS exists', () => {
    if (!CONSTANTS.DATE_REGEX_GROUPS) {
      throw new Error('DATE_REGEX_GROUPS not found');
    }
    if (!CONSTANTS.DATE_REGEX_GROUPS.ISO) {
      throw new Error('ISO groups missing');
    }
    return true;
  });
  
  // Test 1.4: DATE_FORMATS exists
  _test(results, 'CONSTANTS.DATE_FORMATS exists', () => {
    if (!CONSTANTS.DATE_FORMATS) {
      throw new Error('DATE_FORMATS not found');
    }
    if (!CONSTANTS.DATE_FORMATS.ISO || !CONSTANTS.DATE_FORMATS.ITALIAN) {
      throw new Error('Required date formats missing');
    }
    return true;
  });
  
  // Test 1.5: TRIGGER_STATUS_COLUMNS exists
  _test(results, 'CONSTANTS.TRIGGER_STATUS_COLUMNS exists', () => {
    if (!CONSTANTS.TRIGGER_STATUS_COLUMNS) {
      throw new Error('TRIGGER_STATUS_COLUMNS not found');
    }
    const required = ['TIMESTAMP', 'DURATION', 'STATUS', 'MESSAGE'];
    required.forEach(key => {
      if (typeof CONSTANTS.TRIGGER_STATUS_COLUMNS[key] !== 'number') {
        throw new Error(key + ' column index missing or invalid');
      }
    });
    return true;
  });
  
  Logger.log('');
}

// ============================================================================
// TEST 2: DATE_UTILS
// ============================================================================
function _testDateUtils(results) {
  Logger.log('📅 TEST 2: DATE_UTILS (UTIL.date)');
  Logger.log('─────────────────────────────────────\n');
  
  // Test 2.1: Module exists
  _test(results, 'UTIL.date exists', () => {
    if (!UTIL || !UTIL.date) {
      throw new Error('UTIL.date namespace not found');
    }
    return true;
  });
  
  // Test 2.2: parseXmlDate - valid input
  _test(results, 'parseXmlDate() - valid ISO date', () => {
    const result = UTIL.date.parseXmlDate('2025-11-19');
    if (!(result instanceof Date)) {
      throw new Error('Expected Date object, got: ' + typeof result);
    }
    if (result.getFullYear() !== 2025 || result.getMonth() !== 10 || result.getDate() !== 19) {
      throw new Error('Parsed date incorrect: ' + result);
    }
    return true;
  });
  
  // Test 2.3: parseXmlDate - invalid input
  _test(results, 'parseXmlDate() - invalid input returns null', () => {
    const result = UTIL.date.parseXmlDate('invalid-date');
    if (result !== null) {
      throw new Error('Expected null for invalid date, got: ' + result);
    }
    return true;
  });
  
  // Test 2.4: formatIsoDate
  _test(results, 'formatIsoDate() - formats to YYYY-MM-DD', () => {
    const date = new Date(2025, 10, 19); // November 19, 2025
    const result = UTIL.date.formatIsoDate(date);
    if (result !== '2025-11-19') {
      throw new Error('Expected "2025-11-19", got: "' + result + '"');
    }
    return true;
  });
  
  // Test 2.5: formatItalianDate
  _test(results, 'formatItalianDate() - formats to DD/MM/YYYY', () => {
    const date = new Date(2025, 10, 19);
    const result = UTIL.date.formatItalianDate(date);
    if (result !== '19/11/2025') {
      throw new Error('Expected "19/11/2025", got: "' + result + '"');
    }
    return true;
  });
  
  // Test 2.6: formatTimestamp
  _test(results, 'formatTimestamp() - returns timestamp', () => {
    const date = new Date(2025, 10, 19, 15, 30, 45);
    const result = UTIL.date.formatTimestamp(date);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(result)) {
      throw new Error('Timestamp format invalid: ' + result);
    }
    return true;
  });
  
  // Test 2.7: getItalianMonthName
  _test(results, 'getItalianMonthName() - returns correct month', () => {
    const result = UTIL.date.getItalianMonthName(11);
    if (result !== 'Novembre') {
      throw new Error('Expected "Novembre", got: "' + result + '"');
    }
    return true;
  });
  
  // Test 2.8: getItalianMonthName - with suffix
  _test(results, 'getItalianMonthName() - with year suffix', () => {
    const result = UTIL.date.getItalianMonthName(11, "'25");
    if (result !== "Novembre '25") {
      throw new Error('Expected "Novembre \'25", got: "' + result + '"');
    }
    return true;
  });
  
  // Test 2.9: extractYearMonth
  _test(results, 'extractYearMonth() - extracts year and month', () => {
    const date = new Date(2025, 10, 19);
    const result = UTIL.date.extractYearMonth(date);
    if (result.anno !== '2025' || result.mese !== 11) {
      throw new Error('Expected {anno: "2025", mese: 11}, got: ' + JSON.stringify(result));
    }
    return true;
  });
  
  // Test 2.10: isValidDate
  _test(results, 'isValidDate() - validates dates correctly', () => {
    if (!UTIL.date.isValidDate(new Date())) {
      throw new Error('Valid date rejected');
    }
    if (UTIL.date.isValidDate('not a date')) {
      throw new Error('Invalid input accepted');
    }
    if (UTIL.date.isValidDate(new Date('invalid'))) {
      throw new Error('Invalid Date object accepted');
    }
    return true;
  });
  
  // Test 2.11: parseItalianDate
  _test(results, 'parseItalianDate() - parses DD/MM/YYYY', () => {
    const result = UTIL.date.parseItalianDate('19/11/2025');
    if (!(result instanceof Date)) {
      throw new Error('Expected Date object');
    }
    if (result.getDate() !== 19 || result.getMonth() !== 10 || result.getFullYear() !== 2025) {
      throw new Error('Parsed date incorrect');
    }
    return true;
  });
  
  // Test 2.12: daysBetween
  _test(results, 'daysBetween() - calculates difference', () => {
    const date1 = new Date(2025, 0, 1);
    const date2 = new Date(2025, 0, 10);
    const result = UTIL.date.daysBetween(date1, date2);
    if (result !== 9) {
      throw new Error('Expected 9 days, got: ' + result);
    }
    return true;
  });
  
  Logger.log('');
}

// ============================================================================
// TEST 3: SHEET_ITERATOR
// ============================================================================
function _testSheetIterator(results) {
  Logger.log('🔄 TEST 3: SHEET_ITERATOR Module');
  Logger.log('─────────────────────────────────────\n');
  
  // Test 3.1: Module exists
  _test(results, 'SHEET_ITERATOR module exists', () => {
    if (typeof SHEET_ITERATOR === 'undefined') {
      throw new Error('SHEET_ITERATOR is not defined');
    }
    return true;
  });
  
  // Test 3.2: API methods exist
  _test(results, 'SHEET_ITERATOR has required methods', () => {
    const requiredMethods = ['forEach', 'map', 'filter', 'reduce', 'count'];
    requiredMethods.forEach(method => {
      if (typeof SHEET_ITERATOR[method] !== 'function') {
        throw new Error(method + '() method not found');
      }
    });
    return true;
  });
  
  Logger.log('');
}

// ============================================================================
// TEST 4: DASHBOARD_TRIGGER
// ============================================================================
function _testDashboardTrigger(results) {
  Logger.log('🎛️ TEST 4: TRIGGER_DASHBOARD Module');
  Logger.log('─────────────────────────────────────\n');
  
  // Test 4.1: Module exists
  _test(results, 'TRIGGER_DASHBOARD module exists', () => {
    if (typeof TRIGGER_DASHBOARD === 'undefined') {
      throw new Error('TRIGGER_DASHBOARD is not defined');
    }
    return true;
  });
  
  // Test 4.2: Public API exists
  _test(results, 'TRIGGER_DASHBOARD has required methods', () => {
    const requiredMethods = ['initSheet', 'updateTriggerStatus', 'recordExecution', 'calculateHealthScore', 'getTriggerMetrics'];
    requiredMethods.forEach(method => {
      if (typeof TRIGGER_DASHBOARD[method] !== 'function') {
        throw new Error(method + '() method not found');
      }
    });
    return true;
  });
  
  // Test 4.3: initSheet performance (should be <2s)
  _test(results, 'TRIGGER_DASHBOARD.initSheet() performance <2s', () => {
    const start = Date.now();
    TRIGGER_DASHBOARD.initSheet();
    const duration = Date.now() - start;
    
    Logger.log('  ⏱️  Duration: ' + duration + 'ms');
    
    if (duration > 2000) {
      throw new Error('Performance degraded: ' + duration + 'ms (expected <2000ms)');
    }
    return true;
  });
  
  // Test 4.4: calculateHealthScore returns valid score
  _test(results, 'TRIGGER_DASHBOARD.calculateHealthScore() returns 0-100', () => {
    const score = TRIGGER_DASHBOARD.calculateHealthScore();
    if (typeof score !== 'number' || score < 0 || score > 100) {
      throw new Error('Invalid health score: ' + score);
    }
    return true;
  });
  
  // Test 4.5: getTriggerMetrics returns valid structure
  _test(results, 'TRIGGER_DASHBOARD.getTriggerMetrics() returns valid object', () => {
    const metrics = TRIGGER_DASHBOARD.getTriggerMetrics();
    const required = ['successRate', 'avgDuration', 'maxDuration', 'totalRuns'];
    required.forEach(key => {
      if (typeof metrics[key] !== 'number') {
        throw new Error('Missing or invalid metric: ' + key);
      }
    });
    return true;
  });
  
  Logger.log('');
}

// ============================================================================
// TEST HELPERS
// ============================================================================
function _test(results, name, testFn) {
  try {
    testFn();
    results.passed++;
    results.tests.push({ name: name, passed: true });
    Logger.log('✅ PASS: ' + name);
  } catch (e) {
    results.failed++;
    results.tests.push({ name: name, passed: false, error: e.message });
    Logger.log('❌ FAIL: ' + name);
    Logger.log('   Error: ' + e.message);
  }
}

// ============================================================================
// INDIVIDUAL TEST RUNNERS (per test singoli)
// ============================================================================

function testConstants() {
  const results = { passed: 0, failed: 0, tests: [] };
  _testConstants(results);
  Logger.log('Results: ' + results.passed + ' passed, ' + results.failed + ' failed');
}

function testDateUtils() {
  const results = { passed: 0, failed: 0, tests: [] };
  _testDateUtils(results);
  Logger.log('Results: ' + results.passed + ' passed, ' + results.failed + ' failed');
}

function testSheetIterator() {
  const results = { passed: 0, failed: 0, tests: [] };
  _testSheetIterator(results);
  Logger.log('Results: ' + results.passed + ' passed, ' + results.failed + ' failed');
}

function testDashboardTrigger() {
  const results = { passed: 0, failed: 0, tests: [] };
  _testDashboardTrigger(results);
  Logger.log('Results: ' + results.passed + ' passed, ' + results.failed + ' failed');
}

// ============================================================================
// PERFORMANCE BENCHMARK (opzionale)
// ============================================================================

/**
 * Benchmark performance dashboard init (v1.0 vs v2.0).
 * NOTA: Richiede entrambe le versioni per confronto.
 */
function benchmarkDashboardPerformance() {
  Logger.log('⚡ PERFORMANCE BENCHMARK: Dashboard Init');
  Logger.log('=========================================\n');
  
  const runs = 3;
  let totalDuration = 0;
  
  for (let i = 0; i < runs; i++) {
    const start = Date.now();
    TRIGGER_DASHBOARD.initSheet();
    const duration = Date.now() - start;
    totalDuration += duration;
    
    Logger.log('Run ' + (i + 1) + ': ' + duration + 'ms');
  }
  
  const avgDuration = totalDuration / runs;
  Logger.log('\nAverage: ' + avgDuration.toFixed(0) + 'ms');
  Logger.log('Target: <1000ms');
  
  if (avgDuration < 1000) {
    Logger.log('✅ Performance target MET (-95% vs v1.0 expected ~15000ms)');
  } else if (avgDuration < 2000) {
    Logger.log('⚠️  Performance ACCEPTABLE but below target');
  } else {
    Logger.log('❌ Performance FAILED - investigate');
  }
}
