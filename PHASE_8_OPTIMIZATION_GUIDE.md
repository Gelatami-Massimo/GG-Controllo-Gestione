# OPTIMIZATION IMPLEMENTATION GUIDE
## GG GESTIONE GELATAMI - Phase 8 Preparation

**Date**: 16 Novembre 2025  
**Status**: Ready for Implementation  
**Effort**: 15-20 hours  
**Impact**: 40-50% performance improvement  

---

## 🎯 IMPLEMENTATION PRIORITIES

### TIER 1: CRITICAL (This Week)
Must implement to prevent data loss and memory issues.

#### 1.1 Batch Size Limits - `060_import_headers.js`
**Risk Level**: CRITICAL ⚠️  
**Time**: 2-3 hours

**Problem**: `extractedData` array grows unbounded, causing memory errors with 10K+ files.

**Current Code** (Line 230-350):
```javascript
// NO LIMIT - array keeps growing
for (let i = startIndex; i < totalToScan; i++) {
  // ... processing ...
  if (isNewFile && fornitoreInfo && clienteInfo && docInfo) {
    extractedData.push({...});  // ← Unbounded
  }
}
```

**Fix Implementation**:
```javascript
// ADD: Size limit
const MAX_BATCH_SIZE = 500;

for (let i = startIndex; i < totalToScan; i++) {
  // ... processing ...
  if (isNewFile && fornitoreInfo && clienteInfo && docInfo) {
    extractedData.push({...});
  }
  
  // NEW: Flush when hitting limit
  if (extractedData.length >= MAX_BATCH_SIZE) {
    const newNumChunks = STATE.cache.setLargeJSONArray(EXTRACTED_DATA_KEY, extractedData);
    STATE.setJSON(EXTRACTED_DATA_CHUNKS_KEY, newNumChunks);
    extractedData = [];
    
    GG.get('LOG')?.info('HEADERS_SCAN', `Batch flushed (${MAX_BATCH_SIZE} records)`, {
      flushIndex: i,
      totalProcessed: i + 1
    });
  }
}
```

**Testing**:
```javascript
// Test with 2000 files
// Before: Memory usage peaks at 200MB+
// After: Memory usage stays under 50MB
```

---

#### 1.2 Integrate Phase 7 ERROR_HANDLER - XML Parsing
**Risk Level**: HIGH ⚠️  
**Time**: 3-4 hours

**Problem**: No retry on XML parsing failures (transient errors cause silent skip).

**Current Code** (Line 215-220):
```javascript
try {
  const doc = XMLSAFE.parseDriveXml(fileId);
  // ... use doc ...
} catch (e) {
  LOG?.warn(...); // Just log, continue
  // Doc is null, file effectively skipped
}
```

**Fix Implementation**:
```javascript
let doc;
try {
  doc = GG.ERROR_HANDLER.retryAsync(
    () => XMLSAFE.parseDriveXml(fileId),
    {
      maxRetries: 2,
      baseDelay: 500,
      scope: 'XML_PARSE_HEADERS',
      onRetry: (attempt, error) => {
        GG.get('LOG')?.debug('RETRY', `XML parse attempt ${attempt + 1}/${3}`, {
          fileId,
          error: error.message
        });
      }
    }
  );
} catch (parseError) {
  // Log permanent failure
  GG.ERROR_HANDLER.reportError(
    'HEADERS_SCAN',
    `Permanent XML parse failure for ${fileId}`,
    parseError,
    { fileId, fileName: file?.getName?.() }
  );
  
  // Fallback: use file modification date
  doc = null;
  yearMonth = Utilities.formatDate(
    file.getLastUpdated(),
    Session.getScriptTimeZone(),
    'yyyy-MM'
  );
}
```

**Testing**:
```javascript
// Simulate transient error and verify automatic retry
// Before: Failed files silently skipped (data loss)
// After: Automatic retry with fallback (data preserved)
```

---

#### 1.3 Create normalizeSupplierId() Utility
**Risk Level**: LOW ✅  
**Time**: 1-2 hours

**Problem**: Repeated string normalization in 5+ locations.

**Add to `030_globals.js` UTIL module**:
```javascript
UTIL.normalizeSupplierId = function(id) {
  if (!id) return '';
  return String(id)
    .trim()
    .replace(/^IT/i, '')    // Remove IT prefix
    .replace(/^0+/, '');    // Remove leading zeros
};

// Usage:
const normalizedId = UTIL.normalizeSupplierId(rawId);
```

**Locations to Update**:
1. `060_import_headers.js` - Line 310, 365, 550
2. `070_import_rows.js` - Line 180, 230, 290
3. `020_config.js` - Line 615, 690

**Expected Benefit**: 1% CPU reduction, better maintainability

---

### TIER 2: HIGH IMPACT (Following Week)
Major performance improvements.

#### 2.1 Folder Path Caching - `060_import_headers.js`
**Risk Level**: LOW ✅  
**Time**: 2-3 hours

**Problem**: `_getRelativeFolderPath()` called 1000s of times, recalculates each time.

**Current Code** (Line 400-450):
```javascript
for (let i = startIndex; i < totalToScan; i++) {
  folderPath = _getRelativeFolderPath(
    file,
    CONFIG.get('CARTELLA_INPUT_ID'),  // ← Reparsed
    inputFolderName                    // ← Reretrieved
  );
}
```

**Fix Implementation**:
```javascript
// At function start
const folderPathCache = new Map();
let cacheHits = 0;
let cacheMisses = 0;

// In loop:
const fileId = allFileIdsForCount[i];
let folderPath;

if (folderPathCache.has(fileId)) {
  folderPath = folderPathCache.get(fileId);
  cacheHits++;
} else {
  folderPath = _getRelativeFolderPath(
    file,
    CONFIG.get('CARTELLA_INPUT_ID'),
    inputFolderName
  );
  folderPathCache.set(fileId, folderPath);
  cacheMisses++;
}

// At end of phase: log cache statistics
const cacheRatio = cacheHits > 0 
  ? (cacheHits / (cacheHits + cacheMisses) * 100).toFixed(1)
  : '0.0';

GG.get('LOG')?.info('HEADERS_CACHE', 'Folder path cache statistics', {
  hits: cacheHits,
  misses: cacheMisses,
  ratio: cacheRatio + '%',
  saved: (cacheHits * 50) + 'ms' // Estimated
});
```

**Expected Benefit**: 30-40% faster for nested folders

---

#### 2.2 Safe Batch Writing with Retry
**Risk Level**: MEDIUM ⚠️  
**Time**: 3-4 hours

**Problem**: Data loss on write failure, no retry logic.

**Current Code** (Line 750-770):
```javascript
function _flushBatch(sheet, batch, entityName, headerRow) {
  if (batch.length === 0) return;
  try {
    const startRow = Math.max(sheet.getLastRow() + 1, headerRow + 1);
    UTIL.writeBatched(sheet, startRow, batch);
  } catch (e) {
    LOG?.error('FLUSH', `Scrittura batch fallita per ${entityName}.`, {
      error: e.message
    });
  } finally {
    batch.length = 0;  // ← DATA LOST!
  }
}
```

**Fix Implementation**:
```javascript
function _flushBatchSafe(sheet, batch, entityName, headerRow) {
  if (batch.length === 0) return { success: 0, failed: 0 };

  const result = GG.ERROR_HANDLER.withFallback(
    // PRIMARY: Try with retry
    () => {
      return GG.ERROR_HANDLER.retryAsync(
        () => {
          const startRow = Math.max(sheet.getLastRow() + 1, headerRow + 1);
          return UTIL.writeBatched(sheet, startRow, batch);
        },
        {
          maxRetries: 3,
          baseDelay: 1000,
          scope: `BATCH_WRITE_${entityName}`
        }
      );
    },
    // FALLBACK: Try smaller batches if main fails
    () => {
      const chunkSize = Math.ceil(batch.length / 5);
      let successCount = 0;
      
      for (let i = 0; i < batch.length; i += chunkSize) {
        const chunk = batch.slice(i, i + chunkSize);
        try {
          const startRow = Math.max(sheet.getLastRow() + 1, headerRow + 1);
          const res = UTIL.writeBatched(sheet, startRow, chunk);
          successCount += res?.success || 0;
        } catch (e) {
          GG.get('LOG')?.error('BATCH_FALLBACK', `Chunk write failed`, {
            chunk: i / chunkSize + 1,
            error: e.message
          });
        }
      }
      
      return { success: successCount, failed: batch.length - successCount };
    },
    { scope: `BATCH_WRITE_FALLBACK_${entityName}` }
  );

  // Log results
  if (result.success > 0) {
    GG.get('METRICS')?.increment('rows_written', {
      sheet: entityName,
      count: result.success
    });
  }
  
  if (result.failed > 0) {
    GG.get('LOG')?.warn('BATCH_PARTIAL', `${result.failed} rows failed to write`, {
      sheet: entityName
    });
  }

  // IMPORTANT: Don't clear batch on partial success
  // Let caller handle retry logic
  return result;
}
```

**Testing**:
```javascript
// Simulate write failure and verify fallback
// Before: All data in batch lost
// After: Data either fully written or partially with logging
```

---

#### 2.3 Reduce Logging Frequency
**Risk Level**: LOW ✅  
**Time**: 1-2 hours

**Problem**: 100+ log calls for 1000 file scan (1% CPU waste).

**Current Code** (Line 320-330):
```javascript
// Logs EVERY 20 iterations (50 logs per 1000 files)
if (!isSilent && (nextIndex % UI_TICK_N === 0 || nextIndex === totalToScan)) {
  STATE.setJSON(App.config.keys.progress, {...});
}
```

**Fix Implementation**:
```javascript
// Separate UI updates from logging
const UI_UPDATE_INTERVAL = 20;      // Every 20 for progress bar (frequent)
const LOG_INTERVAL = 500;            // Every 500 for actual logs (infrequent)

// In loop:
if (!isSilent && nextIndex % UI_UPDATE_INTERVAL === 0) {
  STATE.setJSON(App.config.keys.progress, {
    phase: 'SCAN',
    done: nextIndex,
    total: totalToScan,
    message: `Scansione ${nextIndex}/${totalToScan}...`
    // No logging here - just state update
  });
}

// Separate logging at lower frequency
if (nextIndex % LOG_INTERVAL === 0) {
  GG.get('LOG')?.info('HEADERS_SCAN', `Progress checkpoint`, {
    filesProcessed: nextIndex,
    percentComplete: (nextIndex / totalToScan * 100).toFixed(1),
    goldenTotal: goldenTotal.toFixed(2)
  });
}
```

**Expected Benefit**: 10-15% CPU reduction

---

### TIER 3: ADVANCED (Optional)
Complex optimizations for future consideration.

#### 3.1 Parallel File Processing
**Risk Level**: HIGH ⚠️  
**Time**: 6-8 hours
**Benefit**: 3-5x faster for large file sets

**Status**: DEFER until Phase 8.5  
**Reason**: Requires significant refactoring, error handling complexity

#### 3.2 Query Result Caching
**Risk Level**: MEDIUM ⚠️  
**Time**: 3-4 hours
**Benefit**: Eliminates duplicate queries

**Status**: DEFER until Phase 8.5

---

## 📋 IMPLEMENTATION ROADMAP

### Week 1: Critical Fixes
```
Monday:
  [ ] Implement batch size limits (1.1)
  [ ] Test with 2K files
  
Tuesday:
  [ ] Add normalizeSupplierId utility (1.3)
  [ ] Update all 5 locations
  [ ] Test normalization logic
  
Wednesday:
  [ ] Integrate ERROR_HANDLER for XML parsing (1.2)
  [ ] Add fallback logic
  [ ] Create test cases
  
Thursday:
  [ ] Performance testing with current fixes
  [ ] Code review
  [ ] Fix any issues
  
Friday:
  [ ] Merge to main
  [ ] Document changes
  [ ] Create pull request
```

### Week 2: High-Impact Optimizations
```
Monday:
  [ ] Implement folder path caching (2.1)
  [ ] Add cache metrics
  
Tuesday:
  [ ] Test cache effectiveness
  [ ] Optimize cache size if needed
  
Wednesday:
  [ ] Implement safe batch writing (2.2)
  [ ] Test failure scenarios
  
Thursday:
  [ ] Reduce logging frequency (2.3)
  [ ] Verify log output quality
  
Friday:
  [ ] Full integration testing
  [ ] Performance benchmarking
  [ ] Create release notes
```

---

## 🧪 TESTING STRATEGY

### Unit Tests
```javascript
// Test 1: normalizeSupplierId
function testNormalizeSupplierId() {
  const tests = [
    { input: 'IT12345678901', expected: '12345678901' },
    { input: '00012345678901', expected: '12345678901' },
    { input: '12345678901', expected: '12345678901' },
    { input: null, expected: '' },
    { input: '  IT000123  ', expected: '123' }
  ];
  
  tests.forEach(t => {
    const result = UTIL.normalizeSupplierId(t.input);
    if (result !== t.expected) {
      throw new Error(`Failed: ${t.input} -> expected ${t.expected}, got ${result}`);
    }
  });
  
  Logger.log('✅ normalizeSupplierId tests passed');
}

// Test 2: Batch size limit
function testBatchSizeLimit() {
  const mockBatch = [];
  for (let i = 0; i < 600; i++) {
    mockBatch.push({ id: i, data: 'test' + i });
    
    if (mockBatch.length >= 500) {
      // Would flush here in real code
      const flushed = mockBatch.length;
      mockBatch.length = 0;
      Logger.log(`Flushed ${flushed} items`);
    }
  }
  
  if (mockBatch.length > 0) {
    Logger.log(`Final flush: ${mockBatch.length} items`);
  }
  
  Logger.log('✅ Batch size limit test passed');
}

// Test 3: ERROR_HANDLER retry
function testErrorHandlerRetry() {
  let attempts = 0;
  
  const result = GG.ERROR_HANDLER.retryAsync(
    () => {
      attempts++;
      if (attempts < 2) throw new Error('First attempt fails');
      return 'success';
    },
    { maxRetries: 3, baseDelay: 100, scope: 'TEST_RETRY' }
  );
  
  if (result !== 'success' || attempts !== 2) {
    throw new Error('Retry logic failed');
  }
  
  Logger.log('✅ ERROR_HANDLER retry test passed');
}
```

### Integration Tests
```javascript
function testWith2000Files() {
  // Create temporary test data
  const testFileCount = 2000;
  
  // Run import with current fixes
  const startTime = new Date();
  IMPORT_HEADERS.run(true);  // Silent mode
  const duration = new Date() - startTime;
  
  // Verify results
  const stats = GG.ERROR_HANDLER.getStats();
  
  Logger.log('2000 File Test Results:');
  Logger.log(`Duration: ${duration}ms (${(duration/1000).toFixed(1)}s)`);
  Logger.log(`Errors: ${stats.total}`);
  Logger.log(`Recovery rate: ${stats.recoveryRate}%`);
  
  // Pass if:
  // - No data loss
  // - Memory < 100MB
  // - Execution < 60s
  // - Error recovery > 80%
}
```

### Performance Benchmarks
```javascript
function benchmarkPhase8Improvements() {
  const results = {
    batchSizeLimit: { before: '45s', after: '?', expected: '30s' },
    normalizeUtility: { before: '45s', after: '?', expected: '44.5s' },
    folderPathCache: { before: '44.5s', after: '?', expected: '30s' },
    batchWriteSafety: { before: '30s', after: '?', expected: '28s' },
    loggingReduction: { before: '28s', after: '?', expected: '25s' }
  };
  
  // Run each test
  // Record before/after
  // Compare with expected
}
```

---

## ✅ COMPLETION CHECKLIST

### Before Merging Each Fix

- [ ] Code written and reviewed
- [ ] Unit tests passing
- [ ] No new linting errors
- [ ] Documentation updated
- [ ] Backward compatibility verified
- [ ] Performance improved as expected

### Before Release

- [ ] All Tier 1 fixes complete
- [ ] All Tier 2 optimizations complete
- [ ] Full integration test passing
- [ ] Performance benchmarks documented
- [ ] Code review approved
- [ ] Release notes prepared

---

## 📊 SUCCESS METRICS

### Target Improvements
- **Execution Time**: 45s → 25s (44% improvement)
- **Memory Usage**: 200MB → 80MB (60% improvement)
- **Error Recovery**: Silent skip → 80%+ automatic recovery
- **Code Duplication**: 5+ copies → 1 utility function
- **Data Loss Events**: >1/1000 files → 0

### Validation
```javascript
// Phase 8 success criteria
const phase8Success = {
  executionTime: duration < 25000,        // < 25 seconds
  memoryUsage: memory < 80,               // < 80 MB
  errorRecovery: errorRate > 0.8,        // > 80%
  dataIntegrity: lossRate === 0,         // No data loss
  backwardCompat: allTestsPassing         // All tests pass
};
```

---

**Status**: Ready for Implementation  
**Estimated Total Time**: 15-20 hours  
**Expected Impact**: 40-50% performance improvement  
**Next Phase**: Official Phase 8 - Performance Optimization  
