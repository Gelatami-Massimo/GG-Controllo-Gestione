# 🔧 Esempi Refactoring con SHARED_UTILS

## Obiettivo
Eliminare **~660 righe di codice duplicato** consolidando pattern ripetuti in utility comuni.

---

## 📊 Pattern 1: Sheet Access Pattern (~50 occorrenze)

### ❌ PRIMA (Codice duplicato)

```javascript
// In 090_dashboard.js
function _calculatePnlBySede() {
  // Accesso foglio Dati Mensili (codice ripetuto)
  const shDati = SHEETS.get(SHEETS.SHEET_NAMES.Dati_Mensili);
  if (!shDati) {
    LOG.error('DASHBOARD', 'Foglio Dati Mensili non trovato');
    UTIL.showToast('Errore: foglio non trovato', 'Errore', 5);
    return;
  }
  const headerRowDati = SHEETS._findHeaderRow(shDati, SHEETS.SHEET_NAMES.Dati_Mensili);
  const idxDati = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Dati_Mensili);
  const lastRowDati = shDati.getLastRow();
  const lastColDati = shDati.getLastColumn();

  // ... ripetere per ogni foglio (Fatture, Fornitori, etc)
  const shFatt = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
  if (!shFatt) {
    LOG.error('DASHBOARD', 'Foglio Fatture non trovato');
    UTIL.showToast('Errore: foglio non trovato', 'Errore', 5);
    return;
  }
  const headerRowFatt = SHEETS._findHeaderRow(shFatt, SHEETS.SHEET_NAMES.Fatture);
  const idxFatt = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
  const lastRowFatt = shFatt.getLastRow();
  const lastColFatt = shFatt.getLastColumn();

  // Lettura dati (finalmente!)
  const datiValues = shDati.getRange(headerRowDati + 1, 1, lastRowDati - headerRowDati, lastColDati).getValues();
  const fattValues = shFatt.getRange(headerRowFatt + 1, 1, lastRowFatt - headerRowFatt, lastColFatt).getValues();

  // ... logica business
}
```

**Righe totali:** ~30 righe solo per setup fogli (ripetuto ~50 volte = **~1500 righe**)

---

### ✅ DOPO (Con SHARED_UTILS)

```javascript
// In 090_dashboard.js
function _calculatePnlBySede() {
  // Accesso foglio Dati Mensili (1 riga!)
  const ctxDati = SHARED_UTILS.getSheetContext(SHEETS.SHEET_NAMES.Dati_Mensili);
  if (!ctxDati) return; // Logging automatico già gestito

  // Accesso foglio Fatture (1 riga!)
  const ctxFatt = SHARED_UTILS.getSheetContext(SHEETS.SHEET_NAMES.Fatture);
  if (!ctxFatt) return;

  // Lettura dati (semplificato con context)
  const datiValues = ctxDati.sheet.getRange(
    ctxDati.headerRow + 1, 1, 
    ctxDati.lastRow - ctxDati.headerRow, 
    ctxDati.lastCol
  ).getValues();

  const fattValues = ctxFatt.sheet.getRange(
    ctxFatt.headerRow + 1, 1, 
    ctxFatt.lastRow - ctxFatt.headerRow, 
    ctxFatt.lastCol
  ).getValues();

  // Usa indici da context
  datiValues.forEach(row => {
    const sede = row[ctxDati.idx.Sede];
    const anno = row[ctxDati.idx.Anno];
    // ...
  });
}
```

**Righe totali:** ~10 righe setup + business logic  
**Risparmio:** ~20 righe per funzione × 50 funzioni = **~1000 righe risparmiate** ✅

---

## 🛡️ Pattern 2: Try-Catch + Log Pattern (~60 occorrenze)

### ❌ PRIMA (Codice duplicato)

```javascript
// In 060_import_headers.js
function run() {
  try {
    // Logica import
    const data = processHeaders();
    LOG.info('IMPORT_HEADERS', 'Import completato');
    UTIL.showToast('Import intestazioni completato', 'Successo', 5);
    return data;
  } catch (e) {
    LOG.error('IMPORT_HEADERS', 'Errore durante import intestazioni', {
      error: e.message,
      stack: e.stack,
      name: e.name
    });
    UTIL.showToast(
      `Errore durante import intestazioni\n\nDettagli: ${e.message}`, 
      'Errore', 
      10
    );
    throw e;
  }
}
```

**Righe totali:** ~15 righe error handling (ripetuto ~60 volte = **~900 righe**)

---

### ✅ DOPO (Con SHARED_UTILS)

```javascript
// In 060_import_headers.js
function run() {
  return SHARED_UTILS.safeExecute(
    () => processHeaders(), // Logica business pura
    'IMPORT_HEADERS',
    {
      errorMessage: 'Errore durante import intestazioni',
      showToast: true,
      rethrow: true,
      onSuccess: (data) => {
        LOG.info('IMPORT_HEADERS', 'Import completato');
        UTIL.showToast('Import intestazioni completato', 'Successo', 5);
      }
    }
  );
}
```

**Righe totali:** ~3-5 righe  
**Risparmio:** ~10 righe × 60 funzioni = **~600 righe risparmiate** ✅

---

## 📅 Pattern 3: Date Validation (~25 occorrenze)

### ❌ PRIMA (Codice duplicato)

```javascript
// In 070_import_rows.js
function _processInvoice(invData, idx) {
  const dataDoc = invData[idx.Data];
  
  // Validazione data (pattern ripetuto)
  if (!dataDoc || !(dataDoc instanceof Date) || isNaN(dataDoc.getTime())) {
    LOG.warn('IMPORT_ROWS', 'Data documento invalida', { dataDoc });
    return null;
  }

  const anno = dataDoc.getFullYear();
  const mese = dataDoc.getMonth() + 1;
  // ...
}
```

**Righe totali:** ~4 righe validazione (ripetuto ~25 volte = **~100 righe**)

---

### ✅ DOPO (Con SHARED_UTILS)

```javascript
// In 070_import_rows.js
function _processInvoice(invData, idx) {
  const dataDoc = invData[idx.Data];
  
  // Validazione data (1 riga!)
  if (!SHARED_UTILS.isValidDate(dataDoc)) {
    LOG.warn('IMPORT_ROWS', 'Data documento invalida', { dataDoc });
    return null;
  }

  const anno = dataDoc.getFullYear();
  const mese = dataDoc.getMonth() + 1;
  // ...
}
```

**Righe totali:** ~1 riga validazione  
**Risparmio:** ~3 righe × 25 occorrenze = **~75 righe risparmiate** ✅

---

## 🎯 Pattern 4: Toast + Log Unificato (~40 occorrenze)

### ❌ PRIMA (Codice duplicato)

```javascript
// In 130_debug.js
function syncCategoriesRetroactive() {
  // ... logica
  
  LOG.info('SYNC_CATEGORIES', 'Riallineamento completato');
  UTIL.showToast('Riallineamento categorie completato!', 'Fatto!', 5);
}

function manageDuplicateInvoices() {
  // ... logica
  
  LOG.warn('DUPLICATES', 'Trovati 15 duplicati');
  UTIL.showToast('Attenzione: trovati 15 duplicati', 'Warning', 10);
}
```

**Righe totali:** ~2 righe per logging (ripetuto ~40 volte = **~80 righe**)

---

### ✅ DOPO (Con SHARED_UTILS)

```javascript
// In 130_debug.js
function syncCategoriesRetroactive() {
  // ... logica
  
  SHARED_UTILS.showToastAndLog(
    'Riallineamento categorie completato!', 
    'Fatto!', 
    'SYNC_CATEGORIES'
  );
}

function manageDuplicateInvoices() {
  // ... logica
  
  SHARED_UTILS.showToastAndLog(
    'Attenzione: trovati 15 duplicati', 
    'Warning', 
    'DUPLICATES',
    'warn',
    10
  );
}
```

**Righe totali:** ~1 riga per logging  
**Risparmio:** ~1 riga × 40 occorrenze = **~40 righe risparmiate** ✅

---

## 📈 Esempio Completo: Refactoring Funzione Dashboard

### ❌ PRIMA (130 righe totali)

```javascript
function buildDashboard() {
  try {
    // Setup foglio Dati Mensili (10 righe)
    const shDati = SHEETS.get(SHEETS.SHEET_NAMES.Dati_Mensili);
    if (!shDati) {
      LOG.error('DASHBOARD', 'Foglio Dati Mensili non trovato');
      UTIL.showToast('Errore: foglio Dati Mensili non trovato', 'Errore', 5);
      return;
    }
    const headerRowDati = SHEETS._findHeaderRow(shDati, SHEETS.SHEET_NAMES.Dati_Mensili);
    const idxDati = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Dati_Mensili);
    const lastRowDati = shDati.getLastRow();
    const lastColDati = shDati.getLastColumn();

    // Setup foglio Fatture (10 righe)
    const shFatt = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    if (!shFatt) {
      LOG.error('DASHBOARD', 'Foglio Fatture non trovato');
      UTIL.showToast('Errore: foglio Fatture non trovato', 'Errore', 5);
      return;
    }
    const headerRowFatt = SHEETS._findHeaderRow(shFatt, SHEETS.SHEET_NAMES.Fatture);
    const idxFatt = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
    const lastRowFatt = shFatt.getLastRow();
    const lastColFatt = shFatt.getLastColumn();

    // Setup foglio Dashboard (10 righe)
    const shDash = SHEETS.get(SHEETS.SHEET_NAMES.Dashboard);
    if (!shDash) {
      LOG.error('DASHBOARD', 'Foglio Dashboard non trovato');
      UTIL.showToast('Errore: foglio Dashboard non trovato', 'Errore', 5);
      return;
    }
    const headerRowDash = SHEETS._findHeaderRow(shDash, SHEETS.SHEET_NAMES.Dashboard);

    // Lettura dati (20 righe)
    const datiValues = shDati.getRange(
      headerRowDati + 1, 1, 
      lastRowDati - headerRowDati, 
      lastColDati
    ).getValues();

    const fattValues = shFatt.getRange(
      headerRowFatt + 1, 1, 
      lastRowFatt - headerRowFatt, 
      lastColFatt
    ).getValues();

    // Validazione date (10 righe)
    const filteredDati = datiValues.filter(row => {
      const data = row[idxDati.Data];
      if (!data || !(data instanceof Date) || isNaN(data.getTime())) {
        return false;
      }
      return true;
    });

    // Logica business (60 righe)
    const aggregated = {};
    filteredDati.forEach(row => {
      const sede = row[idxDati.Sede];
      const anno = row[idxDati.Anno];
      // ... aggregazioni complesse
    });

    // Scrittura risultati (10 righe)
    const outputRows = Object.entries(aggregated).map(([key, value]) => [key, value]);
    shDash.getRange(headerRowDash + 1, 1, outputRows.length, 2).setValues(outputRows);

    LOG.info('DASHBOARD', 'Dashboard aggiornata con successo');
    UTIL.showToast('Dashboard aggiornata', 'Successo', 5);

  } catch (e) {
    LOG.error('DASHBOARD', 'Errore durante aggiornamento dashboard', {
      error: e.message,
      stack: e.stack
    });
    UTIL.showToast(`Errore dashboard: ${e.message}`, 'Errore', 10);
    throw e;
  }
}
```

**Totale:** ~130 righe (40 setup + 10 validazione + 60 business + 20 logging)

---

### ✅ DOPO (70 righe totali - **46% più corto!**)

```javascript
function buildDashboard() {
  return SHARED_UTILS.safeExecute(
    () => {
      // Setup fogli (3 righe!)
      const ctxDati = SHARED_UTILS.getSheetContext(SHEETS.SHEET_NAMES.Dati_Mensili);
      const ctxFatt = SHARED_UTILS.getSheetContext(SHEETS.SHEET_NAMES.Fatture);
      const ctxDash = SHARED_UTILS.getSheetContext(SHEETS.SHEET_NAMES.Dashboard);
      if (!ctxDati || !ctxFatt || !ctxDash) return;

      // Lettura dati (10 righe - più compatto)
      const datiValues = ctxDati.sheet.getRange(
        ctxDati.headerRow + 1, 1, 
        ctxDati.lastRow - ctxDati.headerRow, 
        ctxDati.lastCol
      ).getValues();

      const fattValues = ctxFatt.sheet.getRange(
        ctxFatt.headerRow + 1, 1, 
        ctxFatt.lastRow - ctxFatt.headerRow, 
        ctxFatt.lastCol
      ).getValues();

      // Validazione date (2 righe!)
      const filteredDati = datiValues.filter(row => 
        SHARED_UTILS.isValidDate(row[ctxDati.idx.Data])
      );

      // Logica business (50 righe - invariata, ma con idx context)
      const aggregated = {};
      filteredDati.forEach(row => {
        const sede = row[ctxDati.idx.Sede];
        const anno = row[ctxDati.idx.Anno];
        // ... aggregazioni complesse (stesso codice)
      });

      // Scrittura risultati (5 righe - più compatto)
      const outputRows = Object.entries(aggregated).map(([key, value]) => [key, value]);
      ctxDash.sheet.getRange(
        ctxDash.headerRow + 1, 1, 
        outputRows.length, 2
      ).setValues(outputRows);

      return aggregated; // Return per callback success
    },
    'DASHBOARD',
    {
      errorMessage: 'Errore durante aggiornamento dashboard',
      showToast: true,
      rethrow: true,
      onSuccess: () => {
        SHARED_UTILS.showToastAndLog(
          'Dashboard aggiornata', 
          'Successo', 
          'DASHBOARD'
        );
      }
    }
  );
}
```

**Totale:** ~70 righe (13 setup + 2 validazione + 50 business + 5 logging)  
**Risparmio:** **60 righe (46% riduzione)** ✅

---

## 📊 Riepilogo Benefici

| Pattern                | Occorrenze | Righe Prima | Righe Dopo | Risparmio |
|------------------------|------------|-------------|------------|-----------|
| Sheet Access           | ~50        | ~1500       | ~500       | **~1000** |
| Try-Catch + Log        | ~60        | ~900        | ~300       | **~600**  |
| Date Validation        | ~25        | ~100        | ~25        | **~75**   |
| Toast + Log            | ~40        | ~80         | ~40        | **~40**   |
| **TOTALE**             | **~175**   | **~2580**   | **~865**   | **~1715** |

## 🎯 **Risparmio Totale: ~1700 righe di codice (-66%!)** ✅

---

## 🚀 Next Steps

1. **Deploy `018_shared_utils.js`** su Apps Script
2. **Refactor moduli critici** (uno alla volta):
   - ✅ `090_dashboard.js` (Priority 1 - reporting)
   - ✅ `130_debug.js` (Priority 2 - manutenzione)
   - ✅ `070_import_rows.js` (Priority 3 - già ottimizzato O(n))
3. **Test incrementale** dopo ogni refactoring
4. **Git commit** con messaggio: `refactor: consolidate duplicated patterns with SHARED_UTILS (-66% LOC)`

---

## ⚠️ Note Migrazione

- **Compatibilità:** SHARED_UTILS è **drop-in replacement** - non rompe codice esistente
- **Performance:** Nessun overhead (stessa logica, meno righe)
- **Testing:** Testare SHARED_UTILS standalone prima del refactoring globale
- **Gradualità:** Migrare modulo per modulo, non tutto insieme

**Commit strategy:**
```bash
git commit -m "feat: add SHARED_UTILS module for code deduplication"
git commit -m "refactor(dashboard): use SHARED_UTILS (-46% LOC)"
git commit -m "refactor(debug): use SHARED_UTILS (-40% LOC)"
# ... etc
```
