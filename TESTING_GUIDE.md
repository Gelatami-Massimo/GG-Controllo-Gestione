# TESTING GUIDE - REFACTORING PRIORITIES 1-4
**Data**: 20 Novembre 2025  
**Branch**: feature-xyz  
**Commit**: d979222

---

## 🎯 OVERVIEW

Questa guida copre il testing dei moduli refactorizzati durante PRIORITÀ 1-4:
- **PRIORITÀ 1**: DUPLICATE_MANAGER consolidation
- **PRIORITÀ 2**: SHEET_ITERATOR application
- **PRIORITÀ 3**: ERROR_HANDLER.safely() integration
- **PRIORITÀ 4**: UTIL.checkColumns() validation helper

---

## 📋 QUICK START

### Automated Tests (Recommended)

**Apri Google Apps Script Editor** → Esegui:

```javascript
// Test completo (20 tests automatici)
runRefactoringTests();

// Risultato atteso:
// ✅ Passed: 20
// ❌ Failed: 0
// 🎉 SUCCESS RATE: 100%
```

**Tempo stimato**: 10-15 secondi

---

## 🧪 AUTOMATED TEST SUITE

### File di Test

**`TEST_REFACTORING_PRIORITY_1_4.js`** (576 righe)
- 20 test automatici
- Test per ogni modulo refactorizzato
- Test di integrazione
- Performance benchmarks

### Esecuzione

#### Test Completo
```javascript
runRefactoringTests();
```

**Output atteso**:
```
========================================
🧪 REFACTORING TEST (PRIORITY 1-4) - START
========================================

🔍 PRIORITÀ 1: DUPLICATE_MANAGER Module
─────────────────────────────────────
✅ PASS: DUPLICATE_MANAGER module exists
✅ PASS: DUPLICATE_MANAGER has required methods
✅ PASS: DUPLICATE_MANAGER dependencies available
✅ PASS: DUPLICATE_MANAGER.createSnapshot() structure
  ℹ️  Snapshot size: XXX unique keys
✅ PASS: DUPLICATE_MANAGER.count() returns number
  ℹ️  Duplicate count: XX

🔄 PRIORITÀ 2: SHEET_ITERATOR Usage in Modules
─────────────────────────────────────
✅ PASS: SHEET_ITERATOR.forEachChunk() exists
✅ PASS: SHEET_ITERATOR.forEachChunk() basic iteration
  ℹ️  Processed XX rows successfully
✅ PASS: SHEET_ITERATOR timeout callback invoked
  ℹ️  Timeout callback invoked correctly

⚠️  PRIORITÀ 3: ERROR_HANDLER.safely()
─────────────────────────────────────
✅ PASS: ERROR_HANDLER.safely() exists
✅ PASS: ERROR_HANDLER.safely() - success case
✅ PASS: ERROR_HANDLER.safely() - error suppressed
  ℹ️  Error logged and suppressed correctly
✅ PASS: ERROR_HANDLER.safely() - error thrown
✅ PASS: ERROR_HANDLER tracks error statistics
  ℹ️  Total errors: XX

✔️  PRIORITÀ 4: UTIL.checkColumns()
─────────────────────────────────────
✅ PASS: UTIL.checkColumns() exists
✅ PASS: UTIL.checkColumns() - all present
✅ PASS: UTIL.checkColumns() - detects missing
✅ PASS: UTIL.checkColumns() - multiple missing
✅ PASS: UTIL.checkColumns() - real sheet (Fatture)
  ℹ️  All required Fatture columns present

========================================
📊 RISULTATI FINALI
========================================
✅ Passed: 20
❌ Failed: 0
📈 Total:  20
🎉 SUCCESS RATE: 100%
✅ Tutti i moduli refactorizzati funzionano correttamente!
```

#### Test Individuali

```javascript
// PRIORITÀ 1: DUPLICATE_MANAGER
testDuplicateManager();

// PRIORITÀ 2: SHEET_ITERATOR usage
testSheetIteratorUsage();

// PRIORITÀ 3: ERROR_HANDLER.safely()
testErrorHandlerSafely();

// PRIORITÀ 4: UTIL.checkColumns()
testColumnValidation();

// Integration tests
testIntegration();
```

### Performance Benchmarks

```javascript
// Benchmark duplicate detection
benchmarkDuplicateDetection();
// Output:
// Run 1: XXXms (XX duplicates)
// Run 2: XXXms (XX duplicates)
// Run 3: XXXms (XX duplicates)
// Average: XXXms
// ✅ Performance EXCELLENT

// Benchmark sheet iteration
benchmarkSheetIteration();
// Output:
// Processed: XX rows
// Duration:  XXXms
// Rate:      XXX rows/sec
// ✅ Performance EXCELLENT
```

---

## 🔧 MANUAL SMOKE TESTS

### PRIORITÀ 1: DUPLICATE_MANAGER

#### Test 1: Duplicate Detection (Fatture)
**Location**: Menù → Debug → Gestisci Duplicati Fatture

**Steps**:
1. Apri Google Sheet
2. Vai a **Menù Controllo Gestione** → **Debug** → **Gestisci Duplicati Fatture**
3. Attendi completamento (popup con conteggio)

**Expected**:
- ✅ Popup: "Trovati X duplicati su Y fatture"
- ✅ Righe duplicate marcate in giallo/arancione
- ✅ Log sheet: Entry con scope `DUPLICATE_MGMT`
- ✅ No errori di compilazione

**Validation**:
```javascript
// Verifica manualmente conteggio
const snapshot = DUPLICATE_MANAGER.createSnapshot(
  SHEETS.SHEET_NAMES.Fatture,
  ['FornitoreID', 'NumeroDoc', 'Data']
);
Logger.log('Duplicates: ' + DUPLICATE_MANAGER.count(snapshot));
```

#### Test 2: Clear Duplicate Markings
**Location**: Menù → Debug → Pulisci Marcatura Duplicati

**Steps**:
1. Vai a **Menù** → **Debug** → **Pulisci Marcatura Duplicati**
2. Attendi completamento

**Expected**:
- ✅ Tutti i background colorati rimossi
- ✅ Sheet Fatture ritorna a sfondo bianco
- ✅ Popup: "Marcatura duplicati rimossa"

---

### PRIORITÀ 2: SHEET_ITERATOR Usage

#### Test 3: Import Invoice Rows (with SHEET_ITERATOR)
**Location**: Menù → Importa Righe Fatture

**Steps**:
1. Assicurati di avere almeno 1 XML in `Fatture` sheet (colonna FileID)
2. Vai a **Menù** → **Importa Righe Fatture**
3. Attendi completamento (può richiedere diversi cicli se molti XML)

**Expected**:
- ✅ Progress toast: "Importazione righe... (riga X/Y)"
- ✅ Righe importate in sheet `Righe`
- ✅ Se timeout: Popup "Pausa per timeout. Riprendere."
- ✅ Cursore salvato in STATE per resume
- ✅ No errori di chunk reading

**Validation**:
```javascript
// Verifica righe importate
const shR = SHEETS.get(SHEETS.SHEET_NAMES.Righe);
Logger.log('Righe totali: ' + (shR.getLastRow() - SHEETS.headerRow(SHEETS.SHEET_NAMES.Righe)));
```

#### Test 4: Sync Categories Retroactive
**Location**: Menù → Debug → Sincronizza Categorie (Retroattivo)

**Steps**:
1. Vai a **Menù** → **Debug** → **Sincronizza Categorie (Retroattivo)**
2. Attendi completamento (multi-sheet operation)

**Expected**:
- ✅ Progress toast per ogni sheet (Fatture, Righe, Magazzino, Dati_Mensili)
- ✅ Colonne Famiglia/Categoria aggiornate
- ✅ Se timeout: Cursor salvato, ripresa automatica
- ✅ No errori di batch write

---

### PRIORITÀ 3: ERROR_HANDLER.safely()

#### Test 5: P&L Generation (with ERROR_HANDLER)
**Location**: Menù → Conto Economico → Genera P&L

**Steps**:
1. Vai a **Menù** → **Conto Economico** → **Genera P&L**
2. Attendi completamento (può richiedere 10-30 secondi)

**Expected**:
- ✅ Sheet "Conto Economico Riclassificato" creato/aggiornato
- ✅ Tabelle P&L generate per ogni sede + globale
- ✅ **Se errori formatting**: LOG.warn() registrato ma script continua
- ✅ Popup finale: "P&L Dinamico aggiornato!"

**Validation - Check Logs**:
```javascript
// Verifica log per eventuali errori formatting
const shLog = SHEETS.get(SHEETS.SHEET_NAMES.Log);
const lastRow = shLog.getLastRow();
const logs = shLog.getRange(Math.max(1, lastRow - 20), 1, 20, 10).getValues();
// Cerca scope: PNL_RESIZE, PNL_FORMAT
// Se presenti: ERROR_HANDLER.safely() ha gestito correttamente l'errore
```

#### Test 6: Debug Sanity Check (with ERROR_HANDLER)
**Location**: Menù → Debug → Sanity Check

**Steps**:
1. Vai a **Menù** → **Debug** → **Sanity Check**
2. Attendi report

**Expected**:
- ✅ Popup con summary: "X errori, Y warnings"
- ✅ **Se cartelle inaccessibili**: LOG.error() ma script continua
- ✅ No crash anche con errori di accesso Drive
- ✅ Report completo di tutti i controlli

**Validation**:
```javascript
// Simula errore accesso cartella
ERROR_HANDLER.safely(
  () => DriveApp.getFolderById('invalid-id'),
  { scope: 'TEST', message: 'Test folder access' }
);
// Dovrebbe loggare warning ma non crashare
```

---

### PRIORITÀ 4: UTIL.checkColumns()

#### Test 7: Column Validation in P&L
**Location**: Menù → Conto Economico → Genera P&L

**Steps**:
1. **Setup**: Rinomina temporaneamente una colonna essenziale (es. `Sede` → `Sede_OLD`) in `Dati_Mensili`
2. Vai a **Menù** → **Conto Economico** → **Genera P&L**
3. Attendi errore

**Expected**:
- ✅ LOG.error() con messaggio: "Colonne mancanti in Fatture: Sede"
- ✅ Script termina gracefully (no crash)
- ✅ **Messaggio mostra TUTTE le colonne mancanti** (non solo la prima)

**Cleanup**: Ripristina nome colonna originale

**Validation**:
```javascript
// Test diretto
const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
const missing = UTIL.checkColumns(idx, ['Sede', 'Data', 'NonExistent', 'AnotherMissing']);
Logger.log('Missing columns: ' + JSON.stringify(missing));
// Expected: ["NonExistent", "AnotherMissing"]
```

---

## 🔗 INTEGRATION TESTS (Manual)

### Test 8: Full Import Workflow
**Scenario**: Importa XML → Rileva duplicati → Sincronizza categorie → Genera P&L

**Steps**:
1. **Import Headers**: Menù → Importa Fatture (Headers)
2. **Import Rows**: Menù → Importa Righe Fatture
3. **Detect Duplicates**: Menù → Debug → Gestisci Duplicati Fatture
4. **Sync Categories**: Menù → Debug → Sincronizza Categorie
5. **Generate P&L**: Menù → Conto Economico → Genera P&L

**Expected**:
- ✅ Ogni step completa senza errori
- ✅ SHEET_ITERATOR gestisce timeout/resume correttamente
- ✅ DUPLICATE_MANAGER rileva duplicati
- ✅ ERROR_HANDLER.safely() gestisce errori non-critici
- ✅ P&L finale generato con dati corretti

**Validation**:
- Confronta conteggi prima/dopo ogni step
- Verifica Log sheet per errori
- Controlla DATA integrity (no righe perse)

---

## 📊 REGRESSION TESTS

### Test 9: Compare with Production
**Scenario**: Confronta output refactorizzato vs. produzione

**Prerequisite**: Backup del foglio di produzione

**Steps**:
1. **Backup**: Duplica sheet produzione → "Backup_PreRefactoring"
2. **Deploy**: Feature-xyz refactoring
3. **Import**: Esegui import completo su sheet refactorizzato
4. **Compare**: Confronta dati tra backup e nuovo

**Comparison Points**:
- Numero totale fatture importate
- Numero righe per fattura (sample 10 fatture)
- Conteggio duplicati
- P&L totals (GLOBALE)
- Dati_Mensili sums per mese

**Expected**:
- ✅ **Identical results**: Stessi totali, stessi duplicati
- ✅ **No data loss**: Nessuna riga persa
- ✅ **Performance**: Tempo simile o migliore

---

## ⚡ PERFORMANCE VALIDATION

### Test 10: Performance Benchmarks

#### Duplicate Detection Performance
**Target**: <1000ms per 1000 fatture

```javascript
benchmarkDuplicateDetection();
```

**Expected**:
- Average: <1000ms
- ✅ Performance EXCELLENT

#### Sheet Iteration Performance
**Target**: >500 rows/sec

```javascript
benchmarkSheetIteration();
```

**Expected**:
- Rate: >500 rows/sec
- ✅ Performance EXCELLENT

#### P&L Generation Performance
**Target**: <30s per P&L completo

**Manual Test**:
1. Start timer
2. Menù → Conto Economico → Genera P&L
3. Stop timer quando popup finale

**Expected**:
- Duration: <30s (dipende da dimensione dati)
- ✅ No degradation vs. pre-refactoring

---

## 🐛 ERROR SCENARIOS (Edge Cases)

### Test 11: Empty Sheets
**Scenario**: Sheet vuoti o solo header

**Steps**:
1. Crea test sheet con solo header row
2. Esegui operazioni su sheet vuoto:
   - `DUPLICATE_MANAGER.createSnapshot()`
   - `SHEET_ITERATOR.forEachChunk()`
   - `UTIL.checkColumns()`

**Expected**:
- ✅ No crash
- ✅ Graceful handling (empty results)
- ✅ Appropriate log messages

### Test 12: Missing Columns
**Scenario**: Schema changes (colonne rinominate/rimosse)

**Steps**:
1. Rinomina colonna essenziale
2. Esegui import/sync operations

**Expected**:
- ✅ `UTIL.checkColumns()` rileva colonne mancanti
- ✅ LOG.error() con lista completa
- ✅ Script termina gracefully
- ✅ User-friendly error message

### Test 13: Timeout Handling
**Scenario**: Operazioni lunghe con timeout

**Steps**:
1. Import grande batch XML (>100 file)
2. Lascia eseguire fino a timeout

**Expected**:
- ✅ SHEET_ITERATOR salva cursor
- ✅ Popup: "Pausa per timeout. Riprendere."
- ✅ Resume execution riprende da dove interrotto
- ✅ No data loss

---

## ✅ TEST CHECKLIST

### Automated Tests
- [ ] `runRefactoringTests()` → 20/20 passed
- [ ] `benchmarkDuplicateDetection()` → <1000ms average
- [ ] `benchmarkSheetIteration()` → >500 rows/sec

### Manual Smoke Tests (PRIORITÀ 1)
- [ ] Duplicate detection completes
- [ ] Duplicates marked correctly
- [ ] Clear markings works

### Manual Smoke Tests (PRIORITÀ 2)
- [ ] Import rows with SHEET_ITERATOR
- [ ] Timeout/resume mechanism works
- [ ] Sync categories completes

### Manual Smoke Tests (PRIORITÀ 3)
- [ ] P&L generation completes
- [ ] Formatting errors handled gracefully
- [ ] Sanity check runs without crash

### Manual Smoke Tests (PRIORITÀ 4)
- [ ] Column validation detects missing
- [ ] Error messages list all missing columns
- [ ] Validation in P&L works

### Integration Tests
- [ ] Full import workflow completes
- [ ] All modules work together
- [ ] No cross-module conflicts

### Regression Tests
- [ ] Results match production backup
- [ ] No data loss
- [ ] Performance maintained/improved

### Edge Cases
- [ ] Empty sheets handled
- [ ] Missing columns detected
- [ ] Timeout handling works

---

## 📝 TEST RESULTS TEMPLATE

```
========================================
TEST EXECUTION REPORT
========================================
Date: _____________
Tester: _____________
Environment: Google Apps Script
Branch: feature-xyz
Commit: d979222

AUTOMATED TESTS
---------------
✅ runRefactoringTests(): __/20 passed
✅ benchmarkDuplicateDetection(): ___ms avg
✅ benchmarkSheetIteration(): ___ rows/sec

MANUAL SMOKE TESTS
------------------
PRIORITÀ 1 (DUPLICATE_MANAGER):
  ✅ Test 1: Duplicate detection       [PASS/FAIL]
  ✅ Test 2: Clear markings            [PASS/FAIL]

PRIORITÀ 2 (SHEET_ITERATOR):
  ✅ Test 3: Import rows               [PASS/FAIL]
  ✅ Test 4: Sync categories           [PASS/FAIL]

PRIORITÀ 3 (ERROR_HANDLER):
  ✅ Test 5: P&L generation            [PASS/FAIL]
  ✅ Test 6: Sanity check              [PASS/FAIL]

PRIORITÀ 4 (UTIL.checkColumns):
  ✅ Test 7: Column validation         [PASS/FAIL]

INTEGRATION:
  ✅ Test 8: Full workflow             [PASS/FAIL]

REGRESSION:
  ✅ Test 9: Compare with production   [PASS/FAIL]

PERFORMANCE:
  ✅ Test 10: Benchmarks               [PASS/FAIL]

EDGE CASES:
  ✅ Test 11: Empty sheets             [PASS/FAIL]
  ✅ Test 12: Missing columns          [PASS/FAIL]
  ✅ Test 13: Timeout handling         [PASS/FAIL]

OVERALL RESULT: [PASS/FAIL]
Notes: ____________________________
```

---

## 🚀 DEPLOYMENT READINESS

### Pre-Deployment Checklist
- [ ] All automated tests pass (20/20)
- [ ] All manual smoke tests pass
- [ ] Performance benchmarks meet targets
- [ ] Regression tests show no data loss
- [ ] Edge cases handled gracefully
- [ ] Production backup created
- [ ] Rollback plan documented

### Deployment Steps
1. ✅ Merge feature-xyz → main
2. ✅ Tag release: `v2.0-refactoring-complete`
3. ✅ Deploy to production: `clasp push`
4. ✅ Monitor first 24h: Check Log sheet for errors
5. ✅ Run post-deployment tests
6. ✅ Document lessons learned

---

## 📚 ADDITIONAL RESOURCES

- **Test Files**:
  - `TEST_REFACTORING_PRIORITY_1_4.js` (questo file)
  - `TEST_SMOKE_FASE1.js` (foundations tests)

- **Documentation**:
  - `PRIORITY_1_COMPLETION_REPORT.md` (DUPLICATE_MANAGER)
  - `PRIORITY_2_COMPLETION_REPORT.md` (SHEET_ITERATOR)
  - `PRIORITY_3_COMPLETION_REPORT.md` (ERROR_HANDLER)
  - `PRIORITY_3_4_ASSESSMENT.md` (ROI analysis)

- **Support**:
  - Check Log sheet: `SHEETS.SHEET_NAMES.Log`
  - Error statistics: `ERROR_HANDLER.getStats()`
  - Module registry: `ModuleRegistry.getDependencies(moduleName)`

---

**Report Generated**: 20 Novembre 2025  
**Status**: Ready for Testing  
**Next Action**: Execute `runRefactoringTests()` in Apps Script Editor
