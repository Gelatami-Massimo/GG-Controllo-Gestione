# 🔄 Migration Guide: UTIL → SHARED_UTILS

**Obiettivo:** Guida pratica per refactoring moduli da UTIL a SHARED_UTILS  
**Target:** Sviluppatori che effettuano migrazione incrementale  
**Status:** ✅ Production Ready

---

## 📋 Quick Reference Table

| Vecchia API (UTIL) | Nuova API (SHARED_UTILS) | Status | Notes |
|--------------------|--------------------------|--------|-------|
| `UTIL.showToast()` | `SHARED_UTILS.showToast()` | ✅ Migrato | Wrapper deprecated disponibile |
| `UTIL.getColumnLetter()` | `SHARED_UTILS.getColumnLetter()` | ✅ Migrato | Wrapper deprecated disponibile |
| `UTIL.checkColumns()` | `SHARED_UTILS.checkColumns()` | ✅ Migrato | Wrapper deprecated disponibile |
| `UTIL.forceText()` | `SHARED_UTILS.forceText()` | ✅ Migrato | Wrapper deprecated disponibile |
| `UTIL.normKey()` | `SHARED_UTILS.normalizeString()` | ✅ Migrato | ⚠️ Nome cambiato |
| `UTIL.date.*` | `SHARED_UTILS.date.*` | ✅ Migrato | Namespace identity preserved |
| `UTIL.number.*` | `UTIL.parseNumSmart()` | ⚠️ Wrapper | Valutare migrazione futura |
| `UTIL.acquireLock()` | `UTIL.acquireLock()` | ✅ Invariato | Rimane in UTIL (core) |
| `UTIL.parseNumSmart()` | `UTIL.parseNumSmart()` | ✅ Invariato | Rimane in UTIL (advanced) |
| `UTIL.firstChild()` | `UTIL.firstChild()` | ✅ Invariato | Rimane in UTIL (FatturaPA) |
| `UTIL.writeBatched()` | `UTIL.writeBatched()` | ✅ Invariato | Rimane in UTIL (batch I/O) |

---

## 🆕 Nuove API (Pattern Consolidation)

| API | Sostituisce | Occorrenze | Risparmio |
|-----|-------------|------------|-----------|
| `SHARED_UTILS.getSheetContext()` | `SHEETS.get() + _findHeaderRow() + headerIndex()` | ~50 | ~1000 righe |
| `SHARED_UTILS.safeExecute()` | `try { ... } catch(e) { LOG.error + showToast }` | ~60 | ~600 righe |
| `SHARED_UTILS.isValidDate()` | `d instanceof Date && !isNaN(d.getTime())` | ~25 | ~75 righe |

---

## 🎯 Pattern di Migrazione

### Pattern 1: Sheet Access → getSheetContext()

#### ❌ PRIMA
```javascript
function myFunction() {
  const sheet = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
  if (!sheet) {
    LOG.error('MY_FUNCTION', 'Foglio non trovato');
    UTIL.showToast('Errore: foglio non trovato', 'Errore', 10);
    return;
  }
  
  const headerRow = SHEETS._findHeaderRow(sheet, SHEETS.SHEET_NAMES.Fatture);
  const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
  if (!idx || Object.keys(idx).length === 0) {
    LOG.error('MY_FUNCTION', 'Schema non trovato');
    return;
  }
  
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  
  const dataRange = sheet.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol);
  const data = dataRange.getValues();
  
  for (const row of data) {
    const valore = row[idx.NumeroDocumento];
    // ... logica
  }
}
```

#### ✅ DOPO
```javascript
function myFunction() {
  const ctx = SHARED_UTILS.getSheetContext(SHEETS.SHEET_NAMES.Fatture);
  if (!ctx) {
    LOG.error('MY_FUNCTION', 'Impossibile accedere al foglio Fatture');
    return;
  }
  
  const dataRange = ctx.sheet.getRange(ctx.headerRow + 1, 1, ctx.lastRow - ctx.headerRow, ctx.lastCol);
  const data = dataRange.getValues();
  
  for (const row of data) {
    const valore = row[ctx.idx.NumeroDocumento];
    // ... logica
  }
}
```

**Benefici:**
- ✅ 21 righe → 12 righe (**-43% LOC**)
- ✅ Error handling centralizzato
- ✅ Logging automatico in getSheetContext()
- ✅ Accesso diretto a tutti i metadati foglio

---

### Pattern 2: Try-Catch + Log → safeExecute()

#### ❌ PRIMA
```javascript
function importHeaders() {
  try {
    LOG.info('IMPORT_HEADERS', 'Inizio import headers');
    
    // ... logica import (50 righe)
    
    LOG.info('IMPORT_HEADERS', 'Import completato');
    UTIL.showToast('Import headers completato', 'Successo', 5);
    
  } catch (e) {
    LOG.error('IMPORT_HEADERS', 'Errore durante import headers', { 
      error: e.message, 
      stack: e.stack 
    });
    UTIL.showToast('Errore durante import headers', 'Errore', 10);
  }
}
```

#### ✅ DOPO
```javascript
function importHeaders() {
  return SHARED_UTILS.safeExecute(
    () => {
      LOG.info('IMPORT_HEADERS', 'Inizio import headers');
      
      // ... logica import (50 righe)
      
      LOG.info('IMPORT_HEADERS', 'Import completato');
      return { success: true };
    },
    'IMPORT_HEADERS',
    {
      errorMessage: 'Errore durante import headers',
      showToast: true,
      onSuccess: (result) => {
        UTIL.showToast('Import headers completato', 'Successo', 5);
      }
    }
  );
}
```

**Benefici:**
- ✅ 60 righe → 55 righe (risparmio esponenziale su 60+ funzioni)
- ✅ Error logging strutturato (stack trace, fileName, lineNumber)
- ✅ Toast UI con fallback automatico (batch/trigger context)
- ✅ Callback success/error opzionali

---

### Pattern 3: Date Validation → isValidDate()

#### ❌ PRIMA
```javascript
function processInvoice(row, idx) {
  const dataDoc = row[idx.Data];
  
  // Validazione verbosa ripetuta 25+ volte nel codebase
  if (!dataDoc) {
    LOG.warn('PROCESS', 'Data mancante', { riga: row });
    return;
  }
  if (!(dataDoc instanceof Date)) {
    LOG.warn('PROCESS', 'Data invalida (tipo)', { riga: row, tipo: typeof dataDoc });
    return;
  }
  if (isNaN(dataDoc.getTime())) {
    LOG.warn('PROCESS', 'Data invalida (valore)', { riga: row, data: dataDoc });
    return;
  }
  
  // ... processa data valida
  const anno = dataDoc.getFullYear();
  const mese = dataDoc.getMonth() + 1;
}
```

#### ✅ DOPO
```javascript
function processInvoice(row, idx) {
  const dataDoc = row[idx.Data];
  
  if (!SHARED_UTILS.isValidDate(dataDoc)) {
    LOG.warn('PROCESS', 'Data invalida', { riga: row, data: dataDoc });
    return;
  }
  
  // ... processa data valida
  const { anno, mese } = SHARED_UTILS.date.extractYearMonth(dataDoc);
}
```

**Benefici:**
- ✅ 20 righe → 6 righe (**-70% LOC**)
- ✅ Validazione robusta centralizzata
- ✅ API date utilities consolidate

---

### Pattern 4: Date Formatting Consolidation

#### ❌ PRIMA (Sparso in 6+ moduli)
```javascript
// In 060_import_headers.js
const xmlDateStr = UTIL.firstText(element, 'Data');
const match = xmlDateStr.match(/^(\d{4})-(\d{2})-(\d{2})/);
if (match) {
  const date = new Date(+match[1], +match[2] - 1, +match[3]);
  // ... usa date
}

// In 070_import_rows.js
const dataStr = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');

// In 080_pdf_export.js
const dataItaliana = Utilities.formatDate(date, 'Europe/Rome', 'dd/MM/yyyy');

// In 090_dashboard.js
const anno = date.getFullYear();
const mese = date.getMonth() + 1;
const meseNome = ['Gen', 'Feb', 'Mar', ...][mese - 1];

// In 120_pnl.js
const primoGiornoMese = new Date(anno, mese - 1, 1);
const ultimoGiornoMese = new Date(anno, mese, 0);
```

#### ✅ DOPO (API unificata)
```javascript
// Parsing XML
const date = SHARED_UTILS.date.parseXmlDate(xmlDateStr);

// Formatting ISO
const dataStr = SHARED_UTILS.date.formatIsoDate(date);

// Formatting italiano
const dataItaliana = SHARED_UTILS.date.formatItalianDate(date);

// Estrazione anno/mese
const { anno, mese } = SHARED_UTILS.date.extractYearMonth(date);
const meseNome = SHARED_UTILS.date.getShortMonthName(mese);

// Range mese
const primoGiornoMese = SHARED_UTILS.date.getFirstDayOfMonth(date);
const ultimoGiornoMese = SHARED_UTILS.date.getLastDayOfMonth(date);
```

**Benefici:**
- ✅ API unificata cross-module
- ✅ Validazione centralizzata
- ✅ Zero duplicazione logica
- ✅ Testabilità migliorata

---

### Pattern 5: Toast + Log Unificato

#### ❌ PRIMA
```javascript
LOG.info('OPERATION', 'Operazione completata con successo');
UTIL.showToast('Operazione completata', 'Successo', 5);
```

#### ✅ DOPO
```javascript
SHARED_UTILS.showToastAndLog(
  'Operazione completata con successo',
  'Successo',
  'OPERATION',
  'info',
  5
);
```

**Benefici:**
- ✅ 2 righe → 1 riga chiamata
- ✅ Fallback automatico se Toast UI non disponibile

---

## 🔧 Refactoring Step-by-Step

### Step 1: Identificare Pattern nel Modulo

```bash
# Cerca pattern Sheet Access
grep -n "SHEETS.get(" 090_dashboard.js
grep -n "_findHeaderRow" 090_dashboard.js
grep -n "headerIndex" 090_dashboard.js

# Cerca pattern Try-Catch
grep -n "try {" 090_dashboard.js
grep -n "LOG.error" 090_dashboard.js

# Cerca pattern Date Validation
grep -n "instanceof Date" 090_dashboard.js
grep -n "isNaN.*getTime" 090_dashboard.js
```

### Step 2: Refactoring Prioritario

**Ordine consigliato:**
1. ✅ **Sheet Access** (impatto massimo: -30% LOC)
2. ✅ **Try-Catch wrapper** (impatto alto: -20% LOC)
3. ✅ **Date utilities** (impatto medio: -10% LOC)
4. ✅ **Utility generiche** (impatto basso: -5% LOC)

### Step 3: Testing Incrementale

```javascript
// Test 1: Verifica getSheetContext
function testSheetContext() {
  const ctx = SHARED_UTILS.getSheetContext(SHEETS.SHEET_NAMES.Fatture);
  Logger.log('Context: ' + JSON.stringify({
    hasSheet: !!ctx,
    hasIdx: ctx && Object.keys(ctx.idx).length > 0,
    lastRow: ctx?.lastRow,
    lastCol: ctx?.lastCol
  }));
}

// Test 2: Verifica safeExecute
function testSafeExecute() {
  const result = SHARED_UTILS.safeExecute(
    () => {
      Logger.log('Esecuzione test');
      return { success: true };
    },
    'TEST',
    { showToast: true }
  );
  Logger.log('Result: ' + JSON.stringify(result));
}

// Test 3: Verifica date utilities
function testDateUtils() {
  const date = new Date(2025, 10, 19); // 19 novembre 2025
  Logger.log('ISO: ' + SHARED_UTILS.date.formatIsoDate(date));
  Logger.log('IT: ' + SHARED_UTILS.date.formatItalianDate(date));
  Logger.log('Long: ' + SHARED_UTILS.date.formatLongItalian(date));
}
```

### Step 4: Git Commit Strategy

```bash
# Commit 1: Sheet Access refactoring
git add 090_dashboard.js
git commit -m "refactor(dashboard): use SHARED_UTILS.getSheetContext() for sheet access

- Replace ~10 occurrences of SHEETS.get() + _findHeaderRow() + headerIndex()
- Reduce boilerplate code by ~120 lines (-30% LOC)
- Improve error handling with centralized logging"

# Commit 2: Try-Catch refactoring
git add 090_dashboard.js
git commit -m "refactor(dashboard): use SHARED_UTILS.safeExecute() for error handling

- Wrap 5 main functions with safeExecute()
- Centralize error logging with stack traces
- Add Toast UI fallback for batch/trigger context"

# Commit 3: Date utilities refactoring
git add 090_dashboard.js
git commit -m "refactor(dashboard): use SHARED_UTILS.date.* for date operations

- Replace inline date parsing/formatting with unified API
- Consolidate DATE_UTILS usage cross-module
- Improve code readability and maintainability"
```

---

## 🎯 Moduli Priority Matrix

### High Priority (Refactor ASAP)

| Modulo | Pattern Frequency | Stima Risparmio | Complessità | Priority |
|--------|-------------------|-----------------|-------------|----------|
| `090_dashboard.js` | Sheet Access: 10×, Try-Catch: 5× | ~120 righe (-30%) | Media | 🔴 P1 |
| `130_debug.js` | Sheet Access: 15×, Try-Catch: 10× | ~150 righe (-8%) | Media | 🔴 P1 |
| `070_import_rows.js` | Try-Catch: 3×, Date: 5× | ~30 righe (-3%) | Bassa | 🟡 P2 |
| `060_import_headers.js` | Date: 8×, Try-Catch: 2× | ~40 righe (-10%) | Bassa | 🟡 P2 |

### Medium Priority (Refactor After P1)

| Modulo | Pattern Frequency | Stima Risparmio | Complessità | Priority |
|--------|-------------------|-----------------|-------------|----------|
| `084_magazzino_core.js` | Sheet Access: 8×, Date: 4× | ~60 righe (-15%) | Alta | 🟡 P2 |
| `120_pnl.js` | Date: 12×, Try-Catch: 4× | ~80 righe (-12%) | Media | 🟡 P2 |
| `100_reporting.js` | Sheet Access: 6×, Date: 6× | ~50 righe (-8%) | Media | 🟢 P3 |

### Low Priority (Nice to Have)

| Modulo | Pattern Frequency | Stima Risparmio | Complessità | Priority |
|--------|-------------------|-----------------|-------------|----------|
| `050_filters.js` | Date: 3×, Utility: 2× | ~15 righe (-5%) | Bassa | 🟢 P3 |
| `080_pdf_export.js` | Date: 4×, Utility: 1× | ~20 righe (-4%) | Bassa | 🟢 P3 |

---

## ⚠️ Migration Pitfalls (Errori Comuni)

### ❌ Errore 1: Breaking Change UTIL.normKey()

```javascript
// ❌ SBAGLIATO - API cambiata
const key = SHARED_UTILS.normKey(value); // TypeError: normKey is not a function

// ✅ CORRETTO
const key = SHARED_UTILS.normalizeString(value);

// 🔄 OPZIONE BACKWARD COMPATIBLE
const key = UTIL.normKey(value); // Wrapper deprecato funziona ancora
```

### ❌ Errore 2: Load Order Dependencies

```javascript
// ❌ SBAGLIATO - SHARED_UTILS usato prima del caricamento
// File: 015_debug_utils.js (caricato PRIMA di 018_shared_utils.js)
function debugFunction() {
  const ctx = SHARED_UTILS.getSheetContext(...); // ReferenceError!
}

// ✅ CORRETTO - Usare UTIL per moduli caricati prima
function debugFunction() {
  const sheet = SHEETS.get(...);
  const headerRow = SHEETS._findHeaderRow(...);
  const idx = SHEETS.headerIndex(...);
  // ... oppure aspettare refactoring globale con load order aggiornato
}
```

### ❌ Errore 3: safeExecute() Context Loss

```javascript
// ❌ SBAGLIATO - Context 'this' perso in arrow function
class MyClass {
  myMethod() {
    SHARED_UTILS.safeExecute(
      () => this.helperMethod(), // 'this' è undefined!
      'MY_METHOD'
    );
  }
}

// ✅ CORRETTO - Bind 'this' esplicitamente
class MyClass {
  myMethod() {
    SHARED_UTILS.safeExecute(
      function() { this.helperMethod(); }.bind(this),
      'MY_METHOD'
    );
  }
}

// ✅ CORRETTO - Capture 'this' in closure
class MyClass {
  myMethod() {
    const self = this;
    SHARED_UTILS.safeExecute(
      () => self.helperMethod(),
      'MY_METHOD'
    );
  }
}
```

---

## 📊 Progress Tracker Template

### Dashboard Refactoring (Esempio)

```markdown
## 090_dashboard.js Refactoring Progress

### Fase 1: Sheet Access ✅ DONE
- [x] `buildPnL()` - getSheetContext() per Fatture/Magazzino
- [x] `buildMagazzinoReport()` - getSheetContext() per Magazzino
- [x] `buildStockValueReport()` - getSheetContext() per Prodotti
- **Risparmio:** ~60 righe (-15%)

### Fase 2: Try-Catch Wrappers ✅ DONE
- [x] `buildPnL()` - safeExecute() wrapper
- [x] `buildMagazzinoReport()` - safeExecute() wrapper
- [x] `buildStockValueReport()` - safeExecute() wrapper
- **Risparmio:** ~40 righe (-10%)

### Fase 3: Date Utilities ✅ DONE
- [x] `buildPnL()` - SHARED_UTILS.date.extractYearMonth()
- [x] `buildMagazzinoReport()` - SHARED_UTILS.date.formatItalianDate()
- **Risparmio:** ~20 righe (-5%)

### Totale: ~120 righe (-30%)
### Test: ✅ Passed (manuale + smoke test)
### Git: ✅ Committed (3 commits separati)
```

---

## 🏁 Checklist Finale

### Pre-Refactoring
- [ ] Backup modulo originale (`git stash` o branch feature)
- [ ] Identificare pattern frequenti (grep search)
- [ ] Stimare LOC risparmiabili
- [ ] Verificare load order dependencies

### During Refactoring
- [ ] Sostituire pattern uno alla volta (incrementale)
- [ ] Mantenere logica business invariata
- [ ] Aggiungere commenti per decisioni non ovvie
- [ ] Test funzione per funzione

### Post-Refactoring
- [ ] Test manuale tutte le funzioni modificate
- [ ] Verificare 0 errori compilazione
- [ ] Smoke test end-to-end
- [ ] Git commit con messaggio descrittivo
- [ ] Aggiornare progress tracker

---

## 📚 Risorse

- **REFACTORING_SEPARATION_REPORT.md** - Report completo refactoring
- **REFACTORING_EXAMPLES_SHARED_UTILS.md** - 4 esempi "Prima e Dopo"
- **018_shared_utils.js** - Source SHARED_UTILS con JSDoc
- **030_globals.js** - Source UTIL refactored

---

**Versione:** 1.0  
**Ultima Modifica:** 28 novembre 2025  
**Status:** ✅ Production Ready
