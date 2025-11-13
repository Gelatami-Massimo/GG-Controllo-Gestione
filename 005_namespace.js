// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 005_namespace.js
// VERSIONE: 25.0
// LAST_UPDATED: 2025-11-13
// DESCRIZIONE: Namespace centralizzato GG per accesso a tutti i moduli.
//              Consolidamento dell'architettura per migliorare manutenibilità
//              e ridurre global scope pollution.
//              
//              Pattern: GG.register(name, module)
//                       GG.get(name)
//                       GG.modules (accesso diretto)
// =============================================================

/**
 * Namespace centrale GG (GG GESTIONE GELATAMI)
 * Centralizza accesso a tutti i moduli e gestisce il registro
 */
const GG = (() => {
  const modules = {};
  
  return {
    // Versione progetto
    version: '25.0',
    
    // Timestamp build
    buildDate: new Date().toISOString(),
    
    // Oggetto modules per accesso diretto (legacy)
    modules: modules,
    
    /**
     * Registra un modulo nel namespace GG
     * @param {string} name - Nome modulo (es. "LOG", "SHEETS")
     * @param {object} module - Modulo da registrare
     * @throws {Error} Se modulo è null o undefined
     */
    register: function(name, module) {
      if (!module) {
        const msg = `[GG.register] ❌ Tentativo registrazione modulo "${name}" null/undefined`;
        Logger.log(msg);
        throw new Error(msg);
      }
      
      if (modules[name]) {
        Logger.log(`[GG.register] ⚠️ Modulo "${name}" già registrato, sovrascritto.`);
      }
      
      modules[name] = module;
      Logger.log(`[GG.register] ✓ "${name}" registrato nel namespace GG`);
    },
    
    /**
     * Recupera un modulo dal namespace GG
     * @param {string} name - Nome modulo
     * @returns {object} Modulo richiesto
     * @throws {Error} Se modulo non esiste
     */
    get: function(name) {
      if (!modules[name]) {
        const msg = `[GG.get] ❌ Modulo "${name}" non registrato nel namespace GG`;
        Logger.log(msg);
        throw new Error(msg);
      }
      return modules[name];
    },
    
    /**
     * Verifica se un modulo è registrato
     * @param {string} name - Nome modulo
     * @returns {boolean} true se registrato, false altrimenti
     */
    has: function(name) {
      return name in modules;
    },
    
    /**
     * Restituisce lista di tutti i moduli registrati
     * @returns {string[]} Array di nomi moduli
     */
    list: function() {
      return Object.keys(modules);
    },
    
    /**
     * Restituisce numero di moduli registrati
     * @returns {number} Conteggio moduli
     */
    count: function() {
      return Object.keys(modules).length;
    },
    
    /**
     * Valida che tutti i moduli richiesti siano disponibili
     * @param {string[]} requiredModules - Array di nomi moduli richiesti
     * @returns {boolean} true se tutti disponibili, false altrimenti
     */
    validateRequired: function(requiredModules = []) {
      const missing = requiredModules.filter(name => !this.has(name));
      if (missing.length > 0) {
        Logger.log(`[GG.validateRequired] ❌ Moduli mancanti: ${missing.join(', ')}`);
        return false;
      }
      return true;
    },
    
    /**
     * Dump diagnostico di tutti i moduli registrati
     * Usato per debugging
     */
    diagnose: function() {
      const count = this.count();
      Logger.log(`[GG.diagnose] Namespace GG: ${count} moduli registrati`);
      this.list().forEach(name => {
        Logger.log(`  • ${name}`);
      });
    }
  };
})();

/**
 * SEZIONE RETROCOMPATIBILITÀ
 * 
 * Alias globali per transizione graduale dai moduli vecchi
 * verso il nuovo pattern GG.get()
 * 
 * Questi alias permettono al codice esistente di continuare a funzionare
 * mentre si transiziona gradualmente a GG.get('LOG'), GG.get('UTIL'), ecc.
 * 
 * NOTA: Questi alias verranno deprecati in v26.0
 * Migrare il codice a GG.get() progressivamente
 */

// Alias per GG.get - usati dai moduli che si registrano nel namespace
// Questi verranno inizializzati quando i moduli si registrano

Object.defineProperty(globalThis, 'GG_LEGACY_LOG', {
  get: function() {
    try {
      return GG.get('LOG');
    } catch (e) {
      Logger.log('[GG_LEGACY_LOG] ⚠️ LOG non ancora registrato, ritorno undefined');
      return undefined;
    }
  },
  configurable: true
});

Object.defineProperty(globalThis, 'GG_LEGACY_UTIL', {
  get: function() {
    try {
      return GG.get('UTIL');
    } catch (e) {
      Logger.log('[GG_LEGACY_UTIL] ⚠️ UTIL non ancora registrato, ritorno undefined');
      return undefined;
    }
  },
  configurable: true
});

Object.defineProperty(globalThis, 'GG_LEGACY_SHEETS', {
  get: function() {
    try {
      return GG.get('SHEETS');
    } catch (e) {
      Logger.log('[GG_LEGACY_SHEETS] ⚠️ SHEETS non ancora registrato, ritorno undefined');
      return undefined;
    }
  },
  configurable: true
});

/**
 * Utility helper per transizione graduale
 * Ritorna il modulo dal namespace GG o fallback a globale
 * @param {string} moduleName - Nome modulo
 * @returns {object|null} Modulo o null
 */
function GG_GET(moduleName) {
  try {
    return GG.get(moduleName);
  } catch (e) {
    // Fallback: prova a cercare come variabile globale (legacy)
    try {
      return eval(moduleName);
    } catch (e2) {
      Logger.log(`[GG_GET] ❌ Modulo "${moduleName}" non trovato nè in GG nè come globale`);
      return null;
    }
  }
}
