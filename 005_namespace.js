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

// =============================================================
// FINE NAMESPACE GG
// =============================================================
