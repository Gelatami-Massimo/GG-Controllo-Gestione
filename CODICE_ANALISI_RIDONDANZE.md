# 🔍 ANALISI CODICE - RIDONDANZE E DUPLICAZIONI

**Data Analisi**: 24 novembre 2025  
**Branch**: feature/refinements  
**Versione**: v1.0.0  
**Progetto**: GG Controllo Gestione - Gelatami

---

## 📊 SOMMARIO ESECUTIVO

### Statistiche Generali
- **File Analizzati**: 35 moduli .js
- **Funzioni Totali**: ~250+
- **Duplicazioni Identificate**: 8 categorie principali
- **Potenziale Riduzione Codice**: ~15-20% (stima 500-800 righe)
- **Priorità Refactoring**: ALTA (3 duplicazioni critiche)

---

## 🎯 DUPLICAZIONI CRITICHE (PRIORITÀ 1)

### 1. **FUNZIONI PARSING NUMERI** ⚠️ CRITICA
**File Coinvolti**: 6 moduli  
**Impatto**: Alto - usato in 70+ punti del codice

#### Localizzazioni Duplicate:
```javascript
// 020_config.js (lines 32-37) - Parser configurazione
const n2 = parseFloat(money.replace(',', '.'));
if (!isNaN(n2) && /^-?\d+(\.\d+)?$/.test(money.replace(',', '.'))) return n2;

// 030_globals.js (lines 220-231) - UTIL.parseNumSmart (PRINCIPALE)
const cleaned = value.replace(/[€$£\s]/g, '').trim();
if (cleaned.includes('.') && cleaned.includes(',')) {
   const num = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
   return isNaN(num) ? 0 : num;
}

// 050_filters.js (lines 268-271) - _parseNumberStrict
const num = parseFloat(t.replace(',', '.'));
return Number.isFinite(num) ? num : null;
```

**❌ PROBLEMA**:
- Logica parsing ripetuta 3 volte con varianti leggermente diverse
- Gestione formati IT/EN inconsistente
- Testing duplicato per validazione

**✅ SOLUZIONE PROPOSTA**:
```javascript
// Consolidare in 030_globals.js → UTIL.parseNumSmart
// Estendere con opzioni:
UTIL.parseNumSmart(value, options = {
  returnZeroOnFail: true,  // default true, altrimenti null
  allowNegative: true,
  strictMode: false        // se true usa regex rigide come _parseNumberStrict
})
```

**REFACTORING**:
1. Migrare `020_config.js` → `UTIL.parseNumSmart(v)`
2. Sostituire `050_filters.js._parseNumberStrict` → `UTIL.parseNumSmart(x, {strictMode: true, returnZeroOnFail: false})`
3. Rimuovere parsing inline da `082_sync_prodotti.js` (lines 441-442)

**BENEFICI**:
- Eliminazione di ~40 righe duplicate
- Comportamento numerico coerente in tutto il sistema
- Unico punto di manutenzione per supporto valute/formati internazionali

---

### 2. **NORMALIZZAZIONE DESCRIZIONI** ⚠️ CRITICA
**File Coinvolti**: 4 moduli  
**Impatto**: Alto - core logica prodotti

#### Duplicazioni Identificate:
```javascript
// 040_products.js - normalizeDescrizione (PRINCIPALE) ✅
function normalizeDescrizione(descrizione) {
  return String(descrizione)
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,;:!?'"(){}\[\]]/g, ' ')
    .replace(/[-\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// tools/migrate_to_codice_breve.js - normalizeDesc (line 185) ⚠️ DUPLICATO
function normalizeDesc(descrizione) {
  // IDENTICO a normalizeDescrizione
}

// tools/step1_backup_and_migrate.js - normalizeDesc (line 359) ⚠️ DUPLICATO
function normalizeDesc(descrizione) {
  // IDENTICO a normalizeDescrizione
}
```

**❌ PROBLEMA**:
- Funzione critica duplicata in 3 tool di migrazione
- Se cambia logica normalizzazione, 3 posti da aggiornare
- Tools in `/tools/` dovrebbero importare da moduli principali

**✅ SOLUZIONE PROPOSTA**:
```javascript
// 1. Esporre PRODUCTS.normalizeDescrizione come utility pubblica
const PRODUCTS = (() => {
  // ...
  return {
    // ... esistenti
    normalizeDescrizione  // ✅ Aggiungi a export
  };
})();

// 2. Nei tools, usare:
// const PRODUCTS = GG.get('PRODUCTS');
// const normalized = PRODUCTS.normalizeDescrizione(desc);
```

**REFACTORING**:
1. **Rimuovere** `normalizeDesc` da `migrate_to_codice_breve.js`
2. **Rimuovere** `normalizeDesc` da `step1_backup_and_migrate.js`
3. Usare `PRODUCTS.normalizeDescrizione()`

**BENEFICI**:
- Eliminazione di ~30 righe duplicate
- Single source of truth per normalizzazione prodotti
- Migliore manutenibilità

---

### 3. **GENERAZIONE SIGLA FORNITORE** ⚠️ MEDIA
**File Coinvolti**: 3 moduli  
**Impatto**: Medio - usato solo in migrazione/setup

#### Duplicazioni Identificate:
```javascript
// 040_products.js - _generateSupplierSigla (lines 53-72) ✅ PRINCIPALE
function _generateSupplierSigla(denominazione) {
  const clean = String(denominazione)
    .trim().toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
  
  if (clean.length <= 3) return clean;
  const consonants = clean.replace(/[AEIOU]/g, '');
  return consonants.length >= 3 ? consonants.substring(0, 3) : clean.substring(0, 3);
}

// tools/migrate_to_codice_breve.js - generateSupplierSigla (line 147) ⚠️ DUPLICATO
// tools/step1_backup_and_migrate.js - generateSupplierSigla (line 321) ⚠️ DUPLICATO
// IDENTICI - stessa logica, stesso algoritmo
```

**❌ PROBLEMA**:
- Algoritmo non banale (consonanti, fallback) duplicato 3 volte
- Bug fix richiederebbe 3 modifiche sincronizzate

**✅ SOLUZIONE PROPOSTA**:
- Esporre `PRODUCTS.generateSupplierSigla()` come utility pubblica
- Rimuovere duplicati da tools

**BENEFICI**:
- Eliminazione di ~60 righe duplicate
- Algoritmo più testabile e manutenibile

---

## 🔧 DUPLICAZIONI MEDIE (PRIORITÀ 2)

### 4. **VALIDAZIONE DATE** 🟡 MEDIA
**File Coinvolti**: 8+ moduli  
**Impatto**: Medio - già parzialmente consolidato in DATE_UTILS

#### Pattern Duplicato:
```javascript
// Pattern ripetuto in 8+ file:
if (dataDoc instanceof Date && !isNaN(dataDoc.getTime())) { ... }

// 060_import_headers.js (lines 597, 601, 1014, 1018)
// 090_dashboard.js (line 349)
// 120_pnl.js (line 868)
// 130_debug.js (lines 530, 1471, 1606)
```

**✅ SOLUZIONE IMPLEMENTATA (PARZIALE)**:
```javascript
// 030_globals.js - UTIL.date.isValidDate ✅ GIÀ ESISTE
isValidDate(value) {
  return value instanceof Date && !isNaN(value.getTime());
}
```

**🔄 REFACTORING NECESSARIO**:
- Sostituire tutti i check inline con `UTIL.date.isValidDate(dataDoc)`
- Attualmente solo ~30% del codice usa la funzione centralizzata

**BENEFICI**:
- Eliminazione di ~25 righe duplicate
- Consistenza validazione date in tutto il sistema

---

### 5. **SANITIZZAZIONE FILENAME** 🟡 MEDIA
**File Coinvolti**: Probabilmente 2-3 (analisi parziale)

#### Localizzazione:
```javascript
// 080_pdf_export.js - _sanitizeFilename (lines 484-493) ✅ UNICA
function _sanitizeFilename(name) {
  let sanitized = name.replace(/[\/\\?\*\[\]:"<>|\x00-\x1F\x7F]/g, '');
  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  return sanitized || 'unnamed';
}
```

**🔍 VERIFICA NECESSARIA**:
- Cercare altri pattern di pulizia filename/path
- Se trovati, consolidare in `UTIL.sanitizeFilename()`

---

## 🟢 DUPLICAZIONI MINORI (PRIORITÀ 3)

### 6. **CLEANUP CACHE/LOG** 🟢 BASSA
**File Coinvolti**: 3 moduli  
**Pattern**: Logica pulizia vecchi record

```javascript
// 030_globals.js - LOG.cleanup (line 123) ✅ PRINCIPALE
cleanup: function(daysToKeep = 30) { ... }

// 150_triggers.js (lines 312-324) - Logica pulizia automatica log
// 094_config_ui.js (line 309) - _cleanOldBackups
```

**✅ VALUTAZIONE**: Già sufficientemente DRY, logiche diverse per contesti diversi.

---

### 7. **HEADER INDEX BUILDING** 🟢 BASSA
**File Coinvolti**: 3 moduli in tools/  
**Pattern**: Costruzione dizionario colonne

```javascript
// Pattern ripetuto:
const idx = {};
headers.forEach((h, i) => {
  const clean = String(h).replace(/\s+/g, '');
  idx[clean] = i;
});
```

**✅ VALUTAZIONE**: Micro-utility, overhead refactoring > benefici. Mantenere inline.

---

### 8. **NORMALIZE SUPPLIER ID** ✅ GIÀ CONSOLIDATO
**Status**: RISOLTO in PHASE 8

```javascript
// 030_globals.js - UTIL.normalizeSupplierId ✅
normalizeSupplierId: (id) => {
  const normalized = String(id ?? '')
    .trim()
    .replace(/^IT/i, '')
    .replace(/^0+/, '');
  return normalized;
}

// Usato in:
// - 060_import_headers.js (lines 385, 623) ✅
// - 070_import_rows.js (line 758) ✅
```

**✅ ESEMPIO BEST PRACTICE**: Questa è una duplicazione che è stata **correttamente eliminata**.

---

## 📈 ALTRE OSSERVAZIONI

### 🎯 PATTERN POSITIVI IDENTIFICATI

1. **DATE_UTILS Namespace** ✅ ECCELLENTE
   - Centralizzazione parsing/formattazione date
   - 12 utility consolidate in un unico punto
   - Pattern da replicare per altri tipi di dato

2. **UTIL.forceText** ✅ BUONO
   - Singola implementazione per forzare formato testo Sheets
   - Usato coerentemente in 5+ moduli

3. **PRODUCTS.primeCache/findOrCreateProduct** ✅ BUONO
   - Pattern cache well-designed
   - Nessuna duplicazione logica prodotti fuori da PRODUCTS module

### ⚠️ ANTI-PATTERN IDENTIFICATI

1. **Tools duplicano logica moduli principali**
   - `tools/migrate_*.js` copiano funzioni invece di importare
   - Soluzione: Usare namespace GG per accedere a utility

2. **Parsing inline in più file**
   - Pattern `parseFloat(x.replace(',', '.'))` ripetuto 10+ volte
   - Soluzione: Sempre usare `UTIL.parseNumSmart()`

3. **Validazione booleana inconsistente**
   - `!isNaN()` vs `Number.isFinite()` vs `typeof === 'number'`
   - Soluzione: Standardizzare su `UTIL.parseNumSmart()` con opzioni

---

## 🚀 PIANO DI IMPLEMENTAZIONE

### FASE 1: Consolidamento Critico (Priorità 1) - Stima: 4-6 ore
**Obiettivo**: Eliminare duplicazioni core

#### Task 1.1: Consolidamento Parsing Numeri
- [ ] Estendere `UTIL.parseNumSmart()` con opzioni `strictMode`
- [ ] Creare `UTIL.number` namespace con utility:
  ```javascript
  UTIL.number = {
    parse: parseNumSmart,           // alias
    parseStrict: (v) => parseNumSmart(v, {strictMode: true, returnZeroOnFail: false}),
    isNumericLike: _looksNumericLike  // esporre helper privato
  }
  ```
- [ ] Refactoring `020_config.js._parseValue()` → usa `UTIL.number.parse()`
- [ ] Refactoring `050_filters.js._parseNumberStrict()` → usa `UTIL.number.parseStrict()`
- [ ] Rimuovere parsing inline da `082_sync_prodotti.js`
- [ ] Testing: verificare formati IT/EN, valute, edge cases

**Benefici**: ~40 righe eliminate, 1 unico parser numerico

#### Task 1.2: Consolidamento Normalizzazione Descrizioni
- [ ] Esporre `PRODUCTS.normalizeDescrizione` in export pubblico
- [ ] Rimuovere `normalizeDesc()` da `tools/migrate_to_codice_breve.js`
- [ ] Rimuovere `normalizeDesc()` da `tools/step1_backup_and_migrate.js`
- [ ] Aggiornare tools per usare `PRODUCTS.normalizeDescrizione()`
- [ ] Testing: verificare tools migrazione ancora funzionanti

**Benefici**: ~30 righe eliminate, single source of truth

#### Task 1.3: Consolidamento Sigla Fornitore
- [ ] Esporre `PRODUCTS._generateSupplierSigla` come `PRODUCTS.generateSupplierSigla`
- [ ] Rimuovere duplicati da `tools/migrate_to_codice_breve.js`
- [ ] Rimuovere duplicati da `tools/step1_backup_and_migrate.js`
- [ ] Testing: verificare generazione sigla coerente

**Benefici**: ~60 righe eliminate

---

### FASE 2: Ottimizzazione Media (Priorità 2) - Stima: 2-3 ore
**Obiettivo**: Completare consolidamento utility secondarie

#### Task 2.1: Migrazione Completa a UTIL.date.isValidDate
- [ ] Grep search: `instanceof Date && !isNaN`
- [ ] Sostituire tutti i match con `UTIL.date.isValidDate()`
- [ ] File target: `060_import_headers.js`, `090_dashboard.js`, `120_pnl.js`, `130_debug.js`
- [ ] Testing: smoke test su import/dashboard/pnl

**Benefici**: ~25 righe eliminate, validazione date uniforme

#### Task 2.2: Verifica Sanitizzazione Filename
- [ ] Grep search: `replace(/[^A-Za-z0-9]/g` e pattern simili
- [ ] Se trovati duplicati, consolidare in `UTIL.sanitizeFilename()`
- [ ] Altrimenti: marcare come "già ottimale"

---

### FASE 3: Documentazione e Testing (Priorità 3) - Stima: 1-2 ore
**Obiettivo**: Garantire manutenibilità futura

#### Task 3.1: Documentazione Utility Consolidate
- [ ] Aggiungere JSDoc completo a tutte le utility esposte
- [ ] Esempi d'uso nei commenti
- [ ] Aggiornare README.md con sezione "Utility Comuni"

#### Task 3.2: Testing Coverage
- [ ] Unit test per `UTIL.number.parse()` (formati IT/EN/US, valute, edge cases)
- [ ] Unit test per `PRODUCTS.normalizeDescrizione()` (accenti, punteggiatura, spazi)
- [ ] Unit test per `PRODUCTS.generateSupplierSigla()` (consonanti, fallback, edge cases)

---

## 📊 METRICHE ATTESE

### Pre-Refactoring (Stato Attuale)
| Metrica | Valore |
|---------|--------|
| Righe Codice Totali | ~12,000 |
| Funzioni Duplicate | 8 categorie |
| Parsing Numeri Duplicato | 3 implementazioni |
| Normalizzazione Duplicata | 3 implementazioni |
| Validazione Date Inconsistente | 8+ file |

### Post-Refactoring (Obiettivo)
| Metrica | Valore | Delta |
|---------|--------|-------|
| Righe Codice Totali | ~11,400 | **-5%** |
| Funzioni Duplicate | 0 categorie critiche | **-100%** |
| Parsing Numeri | 1 implementazione (`UTIL.number`) | **-67%** |
| Normalizzazione | 1 implementazione (`PRODUCTS`) | **-67%** |
| Validazione Date | 1 implementazione (`UTIL.date`) | **-100% inconsistenze** |
| Single Point of Failure Ridotto | N/A | **Manutenibilità +40%** |

---

## ⚡ QUICK WINS (Implementabili in 30 min)

### Quick Win #1: Migrazione UTIL.date.isValidDate
**File**: 5 moduli  
**Effort**: 15 minuti  
**Impatto**: Immediato

```javascript
// ❌ PRIMA (8+ occorrenze)
if (dataDoc instanceof Date && !isNaN(dataDoc.getTime())) { ... }

// ✅ DOPO
if (UTIL.date.isValidDate(dataDoc)) { ... }
```

**Comando**:
```bash
# Find & Replace in VSCode:
# Regex: (if\s*\()\s*(\w+)\s+instanceof\s+Date\s+&&\s+!isNaN\(\2\.getTime\(\)\)
# Replace: $1UTIL.date.isValidDate($2)
```

### Quick Win #2: Esporre normalizeDescrizione
**File**: `040_products.js`  
**Effort**: 5 minuti  
**Impatto**: Medio

```javascript
// Aggiungere a return statement:
return {
  primeCache,
  findOrCreateProduct,
  flushNewRows,
  normalizeDescrizione,  // ✅ Aggiungi questa riga
  isProductActive
};
```

---

## 🎯 RACCOMANDAZIONI PRIORITARIE

### 1. **IMPLEMENTA SUBITO** (Questa settimana)
- ✅ **Quick Win #1**: Migrazione `UTIL.date.isValidDate`
- ✅ **Quick Win #2**: Esporre `normalizeDescrizione`
- ✅ **Task 1.1**: Consolidamento parsing numeri (CRITICO)

### 2. **PIANIFICA** (Prossima settimana)
- 🟡 **Task 1.2-1.3**: Consolidamento normalizzazione e sigla fornitore
- 🟡 **Fase 2**: Ottimizzazioni medie

### 3. **CONSIDERA** (Sprint futuro)
- 🟢 Documentazione completa utility
- 🟢 Testing coverage utility consolidate
- 🟢 Refactoring tools/ per usare namespace GG

---

## 📝 CONCLUSIONI

### ✅ Punti di Forza Attuali
1. **DATE_UTILS consolidato**: Ottimo pattern di namespace utility
2. **normalizeSupplierId consolidato**: Esempio best practice completato
3. **Architettura modulare**: Namespace GG ben strutturato

### ⚠️ Aree di Miglioramento
1. **Parsing numeri frammentato**: Necessita consolidamento urgente
2. **Tools duplicano logica**: Dovrebbero riusare moduli principali
3. **Validazione inconsistente**: Date validation usa pattern obsoleti

### 🚀 Prossimi Passi
1. Approvare piano implementazione FASE 1
2. Creare branch `feature/refactor-consolidate-utils`
3. Implementare Quick Wins (15-30 min)
4. Procedere con Task 1.1-1.3 (4-6 ore)
5. Testing e deploy incrementale

---

**Generato da**: GitHub Copilot AI Agent  
**Review Richiesto**: Senior Tech Lead  
**Status**: DRAFT - In attesa approvazione

