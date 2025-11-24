# 🏗️ PROPOSTA DI MIGLIORAMENTI ARCHITETTURALI
## GG GESTIONE GELATAMI V1 — Google Apps Script

**Data:** 13 novembre 2025  
**Versione Analisi:** 1.0  
**Status:** Proposta strategica (implementazione graduale consigliata)

---

## 📋 SOMMARIO ESECUTIVO

Il progetto è **ben strutturato** ma presenta **rischi architetturali** che possono causare:
- ❌ Errori di caricamento moduli (dipendenze implicite)
- ❌ Difficoltà nel testing e debugging
- ❌ Versioning inconsistente tra file
- ❌ Global scope pollution

Questo documento propone **5 miglioramenti incrementali** a basso rischio di regressione.

---

## 1️⃣ PROBLEMA: Ordine di Caricamento Fragile

### 📌 Situazione Attuale

**File**: `.clasp.json`
```json
"filePushOrder": [],  // ← VUOTO! Apps Script decide l'ordine (non deterministico)
```

**Rischio**: Se `060_import_headers.js` carica prima di `030_globals.js`, la linea:
```javascript
const IMPORT_HEADERS = (() => {
  const { UTIL, LOG, SHEETS } = ... // ← UNDEFINED!
})();
```

### ✅ SOLUZIONE: Esplicita `filePushOrder`

**File da modificare**: `.clasp.json`

```json
{
  "scriptId": "1W_k0Zp-qUux1-mJLEhJqQnypr8l5kz9xCv1SC768Uv9hqjd4rZhx9hIk",
  "rootDir": "",
  "scriptExtensions": [".js", ".gs"],
  "htmlExtensions": [".html"],
  "jsonExtensions": [".json"],
  "filePushOrder": [
    "000_App.js",
    "010_main.js",
    "020_config.js",
    "030_globals.js",
    "040_products.js",
    "050_filters.js",
    "060_import_headers.js",
    "070_import_rows.js",
    "080_pdf_export.js",
    "090_dashboard.js",
    "100_reporting.js",
    "110_warehouse.js",
    "120_pnl.js",
    "130_debug.js",
    "140_status.js",
    "150_triggers.js",
    "170_setup.js",
    "appsscript.json"
  ],
  "skipSubdirectories": false
}
```

**Effetto:**
- ✅ Apps Script carica **sempre** in questo ordine
- ✅ Le dipendenze sono garantite

**Impatto:** 🟢 **ZERO rischio** — Nessun codice cambia, solo ordine di deploy

---

## 2️⃣ PROBLEMA: Module Dependencies Implicite

### 📌 Situazione Attuale

```javascript
// 060_import_headers.js
const IMPORT_HEADERS = (() => {
  const { UTIL, LOG, SHEETS } = ... // ← Speranza che 030_globals.js sia già caricato!
})();
```

**Rischio:**
- Difficile capire quali moduli dipendono da quali
- Se cambi 030_globals.js, non sai chi è affetto
- Nessun fallback se un modulo manca

### ✅ SOLUZIONE: Dependency Explicit Registration

**Nuovo file**: `001_module_registry.js` (aggiungere PRIMA di altri moduli)

```javascript
// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 001_module_registry.js
// VERSIONE: 1.0
// DESCRIZIONE: Registry esplicito di dipendenze tra moduli.
//              Caricato per primo per validare l'ordine.
// =============================================================

/**
 * Registro centrale di moduli e dipendenze.
 * Usato per validazione e debugging.
 */
const ModuleRegistry = {
  /**
   * Dichiara un modulo e le sue dipendenze.
   * @param {string} name - Nome modulo (es. "IMPORT_HEADERS")
   * @param {string[]} dependencies - Array di moduli richiesti (es. ["UTIL", "LOG"])
   * @throws {Error} Se una dipendenza non è soddisfatta
   */
  register: function(name, dependencies = []) {
    const missing = dependencies.filter(dep => {
      // Controlla se il modulo globale esiste
      return typeof window[dep] === 'undefined' && typeof globalThis[dep] === 'undefined';
    });
    
    if (missing.length > 0) {
      const msg = `Modulo "${name}" manca dipendenze: ${missing.join(', ')}. ` +
                  `Verifica filePushOrder in .clasp.json`;
      console.error(msg);
      throw new Error(msg);
    }
    
    Logger.log(`[ModuleRegistry] ✓ ${name} [dipende da: ${dependencies.join(', ')}]`);
  }
};

/**
 * Dichiara la mappa di dipendenze per validazione.
 * Aggiorna questa sezione quando aggiungi/modifichi moduli.
 */
const MODULE_DEPENDENCIES = {
  // Sequenza di caricamento e dipendenze
  "000_App": [],
  "010_main": ["App"],
  "020_config": ["App"],
  "030_globals": ["App"],
  "040_products": ["SHEETS", "LOG", "UTIL"],
  "050_filters": ["SHEETS"],
  "060_import_headers": ["SHEETS", "LOG", "UTIL", "XMLSAFE", "STATE", "CONFIG"],
  "070_import_rows": ["SHEETS", "LOG", "UTIL", "PRODUCTS", "STATE", "CONFIG"],
  "080_pdf_export": ["SHEETS", "LOG", "UTIL", "STATE", "CONFIG"],
  "090_dashboard": ["SHEETS", "LOG", "UTIL"],
  "100_reporting": ["SHEETS", "LOG", "UTIL", "STATE", "CONFIG"],
  "110_warehouse": ["SHEETS", "LOG", "UTIL", "CONFIG"],
  "120_pnl": ["SHEETS", "LOG", "UTIL"],
  "130_debug": ["SHEETS", "LOG", "UTIL", "STATE", "CONFIG", "DriveApp"],
  "140_status": ["SHEETS", "STATE"],
  "150_triggers": ["App", "CONFIG", "LOG"],
  "170_setup": ["SHEETS", "UTIL", "CONFIG", "LOG", "DEBUG", "DriveApp"]
};
```

**Uso nei file**: All'inizio di ogni modulo:

```javascript
// 060_import_headers.js
const IMPORT_HEADERS = (() => {
  // Valida dipendenze
  ModuleRegistry.register("IMPORT_HEADERS", MODULE_DEPENDENCIES["060_import_headers"]);
  
  const { SHEETS, LOG, UTIL, XMLSAFE, STATE, CONFIG } = { SHEETS, LOG, UTIL, XMLSAFE, STATE, CONFIG };
  // ... resto del codice
})();
```

**Effetto:**
- ✅ Errori chiari se dipendenza manca
- ✅ Documentazione auto-generata
- ✅ Facile debug di caricamento

**Impatto:** 🟡 **BASSO rischio** — Aggiunto file nuovo, nessun cambio logica

**Quando implementare:** Fase 2 (dopo `.clasp.json`)

---

## 3️⃣ PROBLEMA: Global Scope Pollution

### 📌 Situazione Attuale

Oltre 10 variabili globali:
```javascript
const App = { ... };
const LOG = (() => { ... })();
const UTIL = (() => { ... })();
const SHEETS = (() => { ... })();
const STATE = (() => { ... })();
const PRODUCTS = (() => { ... })();
// ... più 5-6 altri
```

**Rischio:**
- Nome globale collide con librerie esterne
- Difficile testare in isolamento
- Memory leak se moduli non puliti

### ✅ SOLUZIONE: Namespace Globale Singolo

**Nuovo file**: `005_namespace.js`

```javascript
// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 005_namespace.js
// VERSIONE: 1.0
// DESCRIZIONE: Namespace globale singolo per tutti i moduli.
//              Previene collision e centralizza accesso.
// =============================================================

/**
 * Namespace globale centrale.
 * Tutti i moduli sono registrati qui.
 */
const GG = {
  version: '25',
  modules: {}, // { name: module }
  config: App.config,
  
  /**
   * Registra un modulo nel namespace.
   * @param {string} name - Nome modulo (es. "UTIL")
   * @param {object} module - Esportazione modulo
   */
  register: function(name, module) {
    if (this.modules[name]) {
      Logger.log(`[GG.register] ⚠️ Modulo "${name}" già registrato, sovrascritto.`);
    }
    this.modules[name] = module;
    Logger.log(`[GG.register] ✓ "${name}" caricato`);
  },
  
  /**
   * Recupera un modulo.
   * @param {string} name - Nome modulo
   * @throws {Error} Se modulo non esiste
   */
  get: function(name) {
    if (!this.modules[name]) {
      throw new Error(`Modulo "${name}" non registrato. Esecuzione in ordine sbagliato?`);
    }
    return this.modules[name];
  }
};

// Mantieni alias globali per retrocompatibilità (TRANSITORIO)
// Rimuovere gradualmente con refactoring
Object.defineProperty(globalThis, 'LOG', {
  get: () => GG.get('LOG'),
  configurable: true
});
```

**Uso nei moduli**:

```javascript
// 030_globals.js
const LOG = (() => { ... })();
GG.register('LOG', LOG);

// 040_products.js
const PRODUCTS = (() => {
  const { SHEETS, LOG, UTIL } = {
    SHEETS: GG.get('SHEETS'),
    LOG: GG.get('LOG'),
    UTIL: GG.get('UTIL')
  };
  // ... resto codice
})();
GG.register('PRODUCTS', PRODUCTS);
```

**Effetto:**
- ✅ Singolo namespace globale `GG`
- ✅ Caricamento controllato e tracciato
- ✅ Errori chiari se dipendenza manca

**Impatto:** 🟡 **MEDIO rischio** — Richiede refactoring di importazioni

**Quando implementare:** Fase 3 (dopo solidificare ordine caricamento)

---

## 4️⃣ PROBLEMA: Versioning Inconsistente

### 📌 Situazione Attuale

```javascript
// 000_App.js
const App = { version: '25', ... };

// 030_globals.js
// VERSIONE: 25.1

// 060_import_headers.js
// VERSIONE: 26

// 070_import_rows.js
// VERSIONE: 25
```

**Rischio:**
- Non è chiaro quale versione sia "corrente"
- Difficile tracciare se un file è stato aggiornato
- Problemi di sync tra dev e prod

### ✅ SOLUZIONE: Schema di Versioning Centrale

**Aggiornare**: `000_App.js`

```javascript
const App = {
  version: '25.0', // Versione rilascio
  buildDate: '2025-11-13',
  changelog: {
    '25.0': ['Architettura modulare IIFE', 'Stato con CacheService', 'Import resumibile'],
    // Aggiornato con ogni rilascio
  },
  
  modules: {
    // Versioni per modulo (aggiornate al rilascio)
    APP: '25.0',
    MAIN: '25.0',
    CONFIG: '25.0',
    GLOBALS: '25.1',
    PRODUCTS: '25.0',
    // ... etc
  },
  
  /**
   * Valida coerenza versioni.
   * Chiama in onOpen() per diagnostica.
   */
  validateVersions: function() {
    const allSame = Object.values(this.modules).every(v => v === this.version);
    if (!allSame) {
      Logger.log('[App.validateVersions] ⚠️ Versioni moduli incoerenti:');
      Object.entries(this.modules).forEach(([mod, ver]) => {
        Logger.log(`  ${mod}: ${ver}`);
      });
    }
    return allSame;
  }
};
```

**Nei singoli file** (header standard):

```javascript
// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 060_import_headers.js
// VERSIONE: 25.0  // ← Sincronizzata con App.version
// LAST_UPDATED: 2025-11-13
// DESCRIZIONE: Import testate fatture (XML parsing)
// =============================================================
```

**Effetto:**
- ✅ Versioning coerente e tracciabile
- ✅ Changelog centralizzato
- ✅ Facile identificare file aggiornati

**Impatto:** 🟢 **ZERO rischio** — Cambio metadati, nessuna logica

---

## 5️⃣ PROBLEMA: Testing & Debugging Complessi

### 📌 Situazione Attuale

**Difficile fare testing** perché:
```javascript
// Non è possibile testare IMPORT_ROWS in isolamento
// perché dipende da SHEETS, PRODUCTS, STATE caricati globalmente
```

**Difficile debuggare** perché:
- Log distribuiti in vari moduli
- Nessun hook per intercettare chiamate
- Stack trace complesso

### ✅ SOLUZIONE: Debug Module Centralizzato

**Nuovo file**: `015_debug_utils.js`

```javascript
// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 015_debug_utils.js
// VERSIONE: 25.0
// DESCRIZIONE: Utilità di debug e profiling per sviluppatori.
// =============================================================

/**
 * Modulo di debug con:
 * - Profiling del tempo di esecuzione
 * - Tracing di chiamate funzione
 * - Raccolta metriche
 */
const DebugUtils = (() => {
  const traces = [];
  const metrics = {};
  
  return {
    /**
     * Profila esecuzione di una funzione.
     * @param {string} name - Nome operazione
     * @param {Function} fn - Funzione da eseguire
     * @returns {*} Risultato funzione
     */
    profile: function(name, fn) {
      const start = Date.now();
      try {
        const result = fn();
        const elapsed = Date.now() - start;
        this.recordMetric(name, elapsed);
        Logger.log(`[PROFILE] ${name}: ${elapsed}ms ✓`);
        return result;
      } catch (e) {
        const elapsed = Date.now() - start;
        Logger.log(`[PROFILE] ${name}: ${elapsed}ms ✗ ${e.message}`);
        throw e;
      }
    },
    
    /**
     * Trace di una chiamata.
     * @param {string} scope - Scope (es. "IMPORT_HEADERS")
     * @param {string} message - Messaggio
     * @param {object} data - Dati opzionali
     */
    trace: function(scope, message, data = {}) {
      const entry = {
        timestamp: new Date().toISOString(),
        scope,
        message,
        data
      };
      traces.push(entry);
      Logger.log(`[${scope}] ${message}`, data);
    },
    
    /**
     * Registra metrica.
     */
    recordMetric: function(name, value) {
      if (!metrics[name]) metrics[name] = [];
      metrics[name].push(value);
    },
    
    /**
     * Esporta report di debug.
     */
    exportReport: function() {
      return {
        traces: traces.slice(-100), // Ultimi 100
        metrics: Object.entries(metrics).reduce((acc, [k, v]) => {
          acc[k] = {
            count: v.length,
            min: Math.min(...v),
            max: Math.max(...v),
            avg: (v.reduce((a, b) => a + b) / v.length).toFixed(2)
          };
          return acc;
        }, {})
      };
    }
  };
})();

// Esporta come modulo globale
GG.register('DebugUtils', DebugUtils);
```

**Uso nei moduli**:

```javascript
// 060_import_headers.js
function runSingleCycle(startTime, maxMs) {
  return DebugUtils.profile('IMPORT_HEADERS.runSingleCycle', () => {
    DebugUtils.trace('IMPORT_HEADERS', 'Inizio ciclo');
    // ... logica ...
  });
}
```

**Effetto:**
- ✅ Profiling centralizzato
- ✅ Metriche di performance
- ✅ Debugging più facile

**Impatto:** 🟡 **BASSO rischio** — Aggiunto opzionale, nessun cambio logica

---

## 📊 TABELLA DI IMPLEMENTAZIONE

| Fase | Priorità | Miglioramento | Sforzo | Rischio | Timeline |
|------|----------|---------------|--------|---------|----------|
| **1** | 🔴 CRITICO | `.clasp.json` filePushOrder | 5 min | 🟢 ZERO | Immediatamente |
| **2** | 🟠 ALTO | Module Registry (diagnostica) | 30 min | 🟡 BASSO | Questa settimana |
| **3** | 🟠 ALTO | Namespace Globale `GG` | 2-3 ore | 🟡 MEDIO | Prossima settimana |
| **4** | 🟡 MEDIO | Versioning Coerente | 20 min | 🟢 ZERO | Questa settimana |
| **5** | 🟡 MEDIO | Debug Utils | 1 ora | 🟡 BASSO | Opzionale |

---

## 🎯 ROADMAP CONSIGLIATA

### Sprint 1 (Oggi) — Stabilizzazione
- ✅ Aggiornare `.clasp.json` con `filePushOrder`
- ✅ Verifica esecuzione senza errori di dipendenza
- ✅ Test: esegui `runImportHeaders` e `runImportRows`

### Sprint 2 (Prossimi 3 giorni) — Tracciabilità
- ✅ Aggiungere `001_module_registry.js`
- ✅ Aggiungere registration call in ogni modulo
- ✅ Eseguire sanity check per verificare dipendenze

### Sprint 3 (Prossima settimana) — Refactoring Namespace
- ✅ Aggiungere `005_namespace.js`
- ✅ Refactorare imports gradualmente (modulo per modulo)
- ✅ Mantenere alias globali per retrocompatibilità (durante transizione)

### Sprint 4+ (Dopo stabilizzazione)
- ✅ Aggiungere Debug Utils
- ✅ Implementare test suite
- ✅ Documentare API pubblica

---

## ✅ CHECKLIST DI IMPLEMENTAZIONE

### Fase 1: `.clasp.json` 🟢
- [ ] Aggiornare `.clasp.json` con `filePushOrder`
- [ ] Eseguire `clasp push`
- [ ] Verificare in Apps Script Editor che ordine è corretto

### Fase 2: Module Registry 🟡
- [ ] Creare `001_module_registry.js`
- [ ] Aggiungere `ModuleRegistry.register()` call in `030_globals.js`
- [ ] Aggiungere in `040_products.js`, `060_import_headers.js`, `070_import_rows.js`
- [ ] Test: eseguire `runImportHeaders` e verificare log

### Fase 3: Namespace
- [ ] Creare `005_namespace.js`
- [ ] Aggiungere `GG.register()` nei moduli
- [ ] Refactorare imports con `GG.get()`
- [ ] Mantenere alias globali per transizione
- [ ] Test completo di tutte funzioni

### Fase 4: Versioning
- [ ] Aggiornare header di ogni file con versione coerente
- [ ] Aggiornare `App.modules` con versioni
- [ ] Aggiornare `App.changelog`
- [ ] Implementare `App.validateVersions()`

### Fase 5: Debug Utils (Opzionale)
- [ ] Creare `015_debug_utils.js`
- [ ] Aggiungere `DebugUtils.profile()` nei task lunghi
- [ ] Implementare export report
- [ ] Aggiungere menu UI per esportare report

---

## 🔍 POSSIBILI RISCHI E MITIGAZIONI

| Rischio | Probabilità | Impatto | Mitigazione |
|---------|------------|--------|-------------|
| Rottura dipendenze durante refactoring | 🟡 MEDIA | 🔴 ALTO | Mantenere alias globali, test completo |
| Ordine caricamento ancora sbagliato | 🟢 BASSA | 🟡 MEDIO | Validazione automatica in `001_module_registry.js` |
| Performance peggiore per accesso GG.get() | 🟢 BASSA | 🟢 BASSO | Caching, non è critico |
| User non vede miglioramenti immediati | 🟠 MEDIA | 🟢 BASSO | Comunicare benefici (debuggability, stability) |

---

## 📚 RISORSE E RIFERIMENTI

**Google Apps Script Best Practices:**
- [GAS Module Pattern](https://developers.google.com/apps-script/concepts/modules)
- [GAS Optimization](https://developers.google.com/apps-script/best-practices)

**Pattern usati:**
- IIFE per moduli privati
- Namespace pattern per ridurre collision
- Registry pattern per dependency tracking

---

## 📝 CONCLUSIONE

Questi miglioramenti **non cambiano la funzionalità**, ma rendono il codice:
- 🟢 **Più stabile** (ordine caricamento garantito)
- 🟢 **Più debuggabile** (dipendenze esplicite)
- 🟢 **Più mantenibile** (versioning coerente)
- 🟢 **Più testabile** (moduli isolati)

**Tempo totale implementazione:** ~4-5 ore per tutte le fasi
**ROI:** Significativo per stabilità e development velocity

---

**Domande?** Sono pronto a implementare qualsiasi fase! 🚀
