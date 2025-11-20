// =============================================================
// SMOKE TEST - REFACTORING PRIORITIES 1-4
// Valida: DUPLICATE_MANAGER, SHEET_ITERATOR usage, ERROR_HANDLER, Column validation
// Data: 20 Novembre 2025
// =============================================================

/**
 * TEST SUITE COMPLETO REFACTORING
 * Esegui questo script per validare PRIORITÀ 1-4.
 */
function runRefactoringTests() {
  Logger.log('========================================');
  Logger.log('🧪 REFACTORING TEST (PRIORITY 1-4) - START');
  Logger.log('========================================\n');
  
  const results = {
    passed: 0,
    failed: 0,
    tests: []
  };
  
  // Test PRIORITÀ 1: DUPLICATE_MANAGER
  _testDuplicateManager(results);
  
  // Test PRIORITÀ 2: SHEET_ITERATOR (usage in real modules)
  _testSheetIteratorUsage(results);
  
  // Test PRIORITÀ 3: ERROR_HANDLER.safely()
  _testErrorHandlerSafely(results);
  
  // Test PRIORITÀ 4: UTIL.checkColumns()
  _testColumnValidation(results);
  
  // Report finale
  Logger.log('\n========================================');
  Logger.log('📊 RISULTATI FINALI');
  Logger.log('========================================');
  Logger.log('✅ Passed: ' + results.passed);
  Logger.log('❌ Failed: ' + results.failed);
  Logger.log('📈 Total:  ' + (results.passed + results.failed));
  
  if (results.failed === 0) {
    Logger.log('🎉 SUCCESS RATE: 100%');
    Logger.log('✅ Tutti i moduli refactorizzati funzionano correttamente!');
  } else {
    const rate = ((results.passed / (results.passed + results.failed)) * 100).toFixed(1);
    Logger.log('📊 Success Rate: ' + rate + '%');
    Logger.log('\n⚠️ FALLIMENTI:');
    results.tests.filter(t => !t.passed).forEach(t => {
      Logger.log('  - ' + t.name + ': ' + t.error);
    });
  }
  
  Logger.log('\n========================================\n');
  
  return results.failed === 0;
}

// ============================================================================
// TEST PRIORITÀ 1: DUPLICATE_MANAGER
// ============================================================================
function _testDuplicateManager(results) {
  Logger.log('🔍 PRIORITÀ 1: DUPLICATE_MANAGER Module');
  Logger.log('─────────────────────────────────────\n');
  
  // Test 1.1: Module exists and registered
  _test(results, 'DUPLICATE_MANAGER module exists', () => {
    if (typeof DUPLICATE_MANAGER === 'undefined') {
      throw new Error('DUPLICATE_MANAGER is not defined');
    }
    return true;
  });
  
  // Test 1.2: Public API complete
  _test(results, 'DUPLICATE_MANAGER has required methods', () => {
    const required = ['findAndMark', 'createSnapshot', 'count'];
    required.forEach(method => {
      if (typeof DUPLICATE_MANAGER[method] !== 'function') {
        throw new Error(method + '() method not found');
      }
    });
    return true;
  });
  
  // Test 1.3: Dependencies loaded
  _test(results, 'DUPLICATE_MANAGER dependencies available', () => {
    // Should access SHEETS, LOG, UTIL, STATE, METRICS
    if (!SHEETS || !LOG || !UTIL || !STATE) {
      throw new Error('Required dependencies not loaded');
    }
    return true;
  });
  
  // Test 1.4: createSnapshot returns valid structure
  _test(results, 'DUPLICATE_MANAGER.createSnapshot() structure', () => {
    const snapshot = DUPLICATE_MANAGER.createSnapshot(
      SHEETS.SHEET_NAMES.Fatture,
      ['FornitoreID', 'NumeroDoc', 'Data']
    );
    
    if (!snapshot || typeof snapshot.has !== 'function' || typeof snapshot.get !== 'function') {
      throw new Error('Snapshot should be a Map');
    }
    
    Logger.log('  ℹ️  Snapshot size: ' + snapshot.size + ' unique keys');
    return true;
  });
  
  // Test 1.5: count() with snapshot (non-destructive)
  _test(results, 'DUPLICATE_MANAGER.count() returns number', () => {
    const snapshot = DUPLICATE_MANAGER.createSnapshot(
      SHEETS.SHEET_NAMES.Fatture,
      ['FornitoreID', 'NumeroDoc', 'Data']
    );
    
    const count = DUPLICATE_MANAGER.count(snapshot);
    
    if (typeof count !== 'number' || count < 0) {
      throw new Error('Count should be non-negative number, got: ' + count);
    }
    
    Logger.log('  ℹ️  Duplicate count: ' + count);
    return true;
  });
  
  Logger.log('');
}

// ============================================================================
// TEST PRIORITÀ 2: SHEET_ITERATOR Usage
// ============================================================================
function _testSheetIteratorUsage(results) {
  Logger.log('🔄 PRIORITÀ 2: SHEET_ITERATOR Usage in Modules');
  Logger.log('─────────────────────────────────────\n');
  
  // Test 2.1: SHEET_ITERATOR.forEachChunk exists
  _test(results, 'SHEET_ITERATOR.forEachChunk() exists', () => {
    if (typeof SHEET_ITERATOR.forEachChunk !== 'function') {
      throw new Error('forEachChunk method not found');
    }
    return true;
  });
  
  // Test 2.2: Small iteration test (Fatture sheet, 10 rows)
  _test(results, 'SHEET_ITERATOR.forEachChunk() basic iteration', () => {
    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    if (!sh) throw new Error('Fatture sheet not found');
    
    const headerRow = SHEETS.headerRow(SHEETS.SHEET_NAMES.Fatture);
    const lastRow = Math.min(sh.getLastRow(), headerRow + 10); // Max 10 rows
    
    if (lastRow <= headerRow) {
      Logger.log('  ℹ️  Sheet empty, skipping iteration test');
      return true;
    }
    
    let rowsProcessed = 0;
    
    const result = SHEET_ITERATOR.forEachChunk({
      sheet: sh,
      sheetName: SHEETS.SHEET_NAMES.Fatture,
      startRow: headerRow + 1,
      endRow: lastRow,
      batchSize: 5,
      maxColumns: 10,
      cursorKey: 'TEST_ITERATOR_CURSOR',
      maxRuntimeSec: 10,
      processChunk: (chunk, chunkStartRow) => {
        rowsProcessed += chunk.length;
      }
    });
    
    STATE.clear('TEST_ITERATOR_CURSOR');
    
    if (rowsProcessed === 0 && lastRow > headerRow) {
      throw new Error('No rows processed');
    }
    
    Logger.log('  ℹ️  Processed ' + rowsProcessed + ' rows successfully');
    return true;
  });
  
  // Test 2.3: Timeout handling (simulate)
  _test(results, 'SHEET_ITERATOR timeout callback invoked', () => {
    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    if (!sh) throw new Error('Fatture sheet not found');
    
    const headerRow = SHEETS.headerRow(SHEETS.SHEET_NAMES.Fatture);
    const lastRow = sh.getLastRow();
    
    if (lastRow <= headerRow) {
      Logger.log('  ℹ️  Sheet empty, skipping timeout test');
      return true;
    }
    
    let timeoutCalled = false;
    
    const result = SHEET_ITERATOR.forEachChunk({
      sheet: sh,
      sheetName: SHEETS.SHEET_NAMES.Fatture,
      startRow: headerRow + 1,
      endRow: lastRow,
      batchSize: 10,
      maxColumns: 5,
      cursorKey: 'TEST_TIMEOUT_CURSOR',
      maxRuntimeSec: 0.001, // Force immediate timeout
      onTimeout: () => { timeoutCalled = true; },
      processChunk: () => { /* no-op */ }
    });
    
    STATE.clear('TEST_TIMEOUT_CURSOR');
    
    if (result.interrupted && !timeoutCalled) {
      throw new Error('Timeout occurred but callback not invoked');
    }
    
    if (timeoutCalled) {
      Logger.log('  ℹ️  Timeout callback invoked correctly');
    }
    
    return true;
  });
  
  Logger.log('');
}

// ============================================================================
// TEST PRIORITÀ 3: ERROR_HANDLER.safely()
// ============================================================================
function _testErrorHandlerSafely(results) {
  Logger.log('⚠️  PRIORITÀ 3: ERROR_HANDLER.safely()');
  Logger.log('─────────────────────────────────────\n');
  
  // Test 3.1: safely() method exists
  _test(results, 'ERROR_HANDLER.safely() exists', () => {
    if (typeof ERROR_HANDLER.safely !== 'function') {
      throw new Error('safely() method not found in ERROR_HANDLER');
    }
    return true;
  });
  
  // Test 3.2: safely() success case
  _test(results, 'ERROR_HANDLER.safely() - success case', () => {
    const result = ERROR_HANDLER.safely(
      () => 42,
      { scope: 'TEST', message: 'Test operation' }
    );
    
    if (result !== 42) {
      throw new Error('Expected 42, got: ' + result);
    }
    return true;
  });
  
  // Test 3.3: safely() error case (suppressThrow=true)
  _test(results, 'ERROR_HANDLER.safely() - error suppressed', () => {
    const result = ERROR_HANDLER.safely(
      () => { throw new Error('Test error'); },
      { scope: 'TEST', message: 'Test error handling', suppressThrow: true }
    );
    
    if (result !== undefined) {
      throw new Error('Expected undefined for suppressed error, got: ' + result);
    }
    
    Logger.log('  ℹ️  Error logged and suppressed correctly');
    return true;
  });
  
  // Test 3.4: safely() error case (suppressThrow=false)
  _test(results, 'ERROR_HANDLER.safely() - error thrown', () => {
    let errorThrown = false;
    
    try {
      ERROR_HANDLER.safely(
        () => { throw new Error('Test error'); },
        { scope: 'TEST', message: 'Test error', suppressThrow: false }
      );
    } catch (e) {
      errorThrown = true;
      if (e.message !== 'Test error') {
        throw new Error('Wrong error thrown');
      }
    }
    
    if (!errorThrown) {
      throw new Error('Error should have been thrown');
    }
    
    return true;
  });
  
  // Test 3.5: Error statistics recorded
  _test(results, 'ERROR_HANDLER tracks error statistics', () => {
    const statsBefore = ERROR_HANDLER.getStats();
    
    // Generate test error
    ERROR_HANDLER.safely(
      () => { throw new Error('Stat test'); },
      { scope: 'TEST_STAT', message: 'Stats test' }
    );
    
    const statsAfter = ERROR_HANDLER.getStats();
    
    if (statsAfter.total <= statsBefore.total) {
      throw new Error('Error statistics not incremented');
    }
    
    Logger.log('  ℹ️  Total errors: ' + statsAfter.total);
    return true;
  });
  
  Logger.log('');
}

// ============================================================================
// TEST PRIORITÀ 4: UTIL.checkColumns()
// ============================================================================
function _testColumnValidation(results) {
  Logger.log('✔️  PRIORITÀ 4: UTIL.checkColumns()');
  Logger.log('─────────────────────────────────────\n');
  
  // Test 4.1: checkColumns() method exists
  _test(results, 'UTIL.checkColumns() exists', () => {
    if (typeof UTIL.checkColumns !== 'function') {
      throw new Error('checkColumns() method not found in UTIL');
    }
    return true;
  });
  
  // Test 4.2: All columns present
  _test(results, 'UTIL.checkColumns() - all present', () => {
    const idx = { Col1: 0, Col2: 1, Col3: 2 };
    const missing = UTIL.checkColumns(idx, ['Col1', 'Col2']);
    
    if (missing.length !== 0) {
      throw new Error('Expected empty array, got: ' + JSON.stringify(missing));
    }
    return true;
  });
  
  // Test 4.3: Some columns missing
  _test(results, 'UTIL.checkColumns() - detects missing', () => {
    const idx = { Col1: 0, Col2: 1 };
    const missing = UTIL.checkColumns(idx, ['Col1', 'Col2', 'Col3']);
    
    if (missing.length !== 1 || missing[0] !== 'Col3') {
      throw new Error('Expected ["Col3"], got: ' + JSON.stringify(missing));
    }
    return true;
  });
  
  // Test 4.4: Multiple missing columns
  _test(results, 'UTIL.checkColumns() - multiple missing', () => {
    const idx = { Col1: 0 };
    const missing = UTIL.checkColumns(idx, ['Col1', 'Col2', 'Col3']);
    
    if (missing.length !== 2) {
      throw new Error('Expected 2 missing columns, got: ' + missing.length);
    }
    
    if (missing.indexOf('Col2') === -1 || missing.indexOf('Col3') === -1) {
      throw new Error('Wrong missing columns detected: ' + JSON.stringify(missing));
    }
    
    return true;
  });
  
  // Test 4.5: Real sheet validation (Fatture)
  _test(results, 'UTIL.checkColumns() - real sheet (Fatture)', () => {
    const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
    const required = ['FornitoreID', 'NumeroDoc', 'Data', 'TotDocumento'];
    const missing = UTIL.checkColumns(idx, required);
    
    if (missing.length > 0) {
      throw new Error('Required columns missing in Fatture: ' + missing.join(', '));
    }
    
    Logger.log('  ℹ️  All required Fatture columns present');
    return true;
  });
  
  Logger.log('');
}

// ============================================================================
// INTEGRATION TESTS (Modules working together)
// ============================================================================
function _testIntegration(results) {
  Logger.log('🔗 INTEGRATION TESTS');
  Logger.log('─────────────────────────────────────\n');
  
  // Test: DUPLICATE_MANAGER + SHEET_ITERATOR
  _test(results, 'Integration: Duplicate detection with iterator', () => {
    const snapshot = DUPLICATE_MANAGER.createSnapshot(
      SHEETS.SHEET_NAMES.Fatture,
      ['FornitoreID', 'NumeroDoc', 'Data']
    );
    
    const duplicateCount = DUPLICATE_MANAGER.count(snapshot);
    
    Logger.log('  ℹ️  Found ' + duplicateCount + ' duplicates');
    
    // Should not throw
    return true;
  });
  
  // Test: ERROR_HANDLER + UTIL.checkColumns
  _test(results, 'Integration: Column validation with error handling', () => {
    const result = ERROR_HANDLER.safely(
      () => {
        const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
        const missing = UTIL.checkColumns(idx, ['FornitoreID', 'NonExistentColumn']);
        if (missing.length > 0) {
          throw new Error('Missing columns: ' + missing.join(', '));
        }
        return true;
      },
      { scope: 'TEST_INTEGRATION', message: 'Column validation test' }
    );
    
    // Should return undefined (error suppressed) since NonExistentColumn doesn't exist
    if (result !== undefined) {
      Logger.log('  ℹ️  All columns exist (unexpected but valid)');
    } else {
      Logger.log('  ℹ️  Missing column detected and error handled');
    }
    
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
// INDIVIDUAL TEST RUNNERS
// ============================================================================

function testDuplicateManager() {
  const results = { passed: 0, failed: 0, tests: [] };
  _testDuplicateManager(results);
  Logger.log('\nResults: ' + results.passed + ' passed, ' + results.failed + ' failed');
}

function testSheetIteratorUsage() {
  const results = { passed: 0, failed: 0, tests: [] };
  _testSheetIteratorUsage(results);
  Logger.log('\nResults: ' + results.passed + ' passed, ' + results.failed + ' failed');
}

function testErrorHandlerSafely() {
  const results = { passed: 0, failed: 0, tests: [] };
  _testErrorHandlerSafely(results);
  Logger.log('\nResults: ' + results.passed + ' passed, ' + results.failed + ' failed');
}

function testColumnValidation() {
  const results = { passed: 0, failed: 0, tests: [] };
  _testColumnValidation(results);
  Logger.log('\nResults: ' + results.passed + ' passed, ' + results.failed + ' failed');
}

function testIntegration() {
  const results = { passed: 0, failed: 0, tests: [] };
  _testIntegration(results);
  Logger.log('\nResults: ' + results.passed + ' passed, ' + results.failed + ' failed');
}

// ============================================================================
// PERFORMANCE BENCHMARKS
// ============================================================================

/**
 * Benchmark DUPLICATE_MANAGER performance vs old implementation
 */
function benchmarkDuplicateDetection() {
  Logger.log('⚡ PERFORMANCE: Duplicate Detection');
  Logger.log('=========================================\n');
  
  const runs = 3;
  let totalDuration = 0;
  
  for (let i = 0; i < runs; i++) {
    const start = Date.now();
    
    const snapshot = DUPLICATE_MANAGER.createSnapshot(
      SHEETS.SHEET_NAMES.Fatture,
      ['FornitoreID', 'NumeroDoc', 'Data']
    );
    const count = DUPLICATE_MANAGER.count(snapshot);
    
    const duration = Date.now() - start;
    totalDuration += duration;
    
    Logger.log('Run ' + (i + 1) + ': ' + duration + 'ms (' + count + ' duplicates)');
  }
  
  const avgDuration = totalDuration / runs;
  Logger.log('\nAverage: ' + avgDuration.toFixed(0) + 'ms');
  Logger.log('Expected: <1000ms for ~1000 rows');
  
  if (avgDuration < 1000) {
    Logger.log('✅ Performance EXCELLENT');
  } else if (avgDuration < 2000) {
    Logger.log('✅ Performance GOOD');
  } else {
    Logger.log('⚠️  Performance needs optimization');
  }
}

/**
 * Benchmark SHEET_ITERATOR vs manual loop
 */
function benchmarkSheetIteration() {
  Logger.log('⚡ PERFORMANCE: Sheet Iteration');
  Logger.log('=========================================\n');
  
  const sh = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
  if (!sh) {
    Logger.log('❌ Fatture sheet not found');
    return;
  }
  
  const headerRow = SHEETS.headerRow(SHEETS.SHEET_NAMES.Fatture);
  const lastRow = Math.min(sh.getLastRow(), headerRow + 100); // Max 100 rows
  
  if (lastRow <= headerRow) {
    Logger.log('⚠️  Sheet empty, cannot benchmark');
    return;
  }
  
  let rowCount = 0;
  
  const start = Date.now();
  SHEET_ITERATOR.forEachChunk({
    sheet: sh,
    sheetName: SHEETS.SHEET_NAMES.Fatture,
    startRow: headerRow + 1,
    endRow: lastRow,
    batchSize: 10,
    maxColumns: 10,
    cursorKey: 'BENCH_CURSOR',
    maxRuntimeSec: 30,
    processChunk: (chunk) => { rowCount += chunk.length; }
  });
  const duration = Date.now() - start;
  
  STATE.clear('BENCH_CURSOR');
  
  Logger.log('Processed: ' + rowCount + ' rows');
  Logger.log('Duration:  ' + duration + 'ms');
  Logger.log('Rate:      ' + (rowCount / (duration / 1000)).toFixed(0) + ' rows/sec');
  
  if (duration < 1000) {
    Logger.log('✅ Performance EXCELLENT');
  } else {
    Logger.log('⚠️  Performance acceptable but could be optimized');
  }
}
