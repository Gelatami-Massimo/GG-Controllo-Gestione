// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 001_module_registry.js
// RUOLO: Registry dipendenze moduli con validazione caricamento.
// NOTE: Caricato per primo dopo App, valida ordine filePushOrder.
// =============================================================

/**
 * Registro centrale di moduli e dipendenze.
 * Usato per validazione e debugging.
 */
const ModuleRegistry = (() => {
  const registry = {};
  
  return {
    /**
     * Registra un modulo e valida le sue dipendenze.
     * @param {string} name - Nome modulo (es. "IMPORT_HEADERS")
     * @param {string[]} dependencies - Array di moduli richiesti (es. ["UTIL", "LOG"])
     * @throws {Error} Se una dipendenza non è soddisfatta
     */
    register: function(name, dependencies = []) {
      // Controlla dipendenze
      const missing = dependencies.filter(dep => {
        // Controlla se il modulo globale esiste
        return typeof eval('typeof ' + dep) === 'undefined' && 
               typeof globalThis[dep] === 'undefined';
      });
      
      if (missing.length > 0) {
        const msg = `❌ ERRORE: Modulo "${name}" manca dipendenze: ${missing.join(', ')}. ` +
                    `Verifica filePushOrder in .clasp.json`;
        Logger.log(msg);
        throw new Error(msg);
      }
      
      // Registra il modulo
      registry[name] = {
        name: name,
        dependencies: dependencies,
        loadedAt: new Date().toISOString()
      };
      
      Logger.log(`[ModuleRegistry] ✓ ${name} [dipende da: ${dependencies.length > 0 ? dependencies.join(', ') : 'nessuno'}]`);
    },
    
    /**
     * Recupera info di un modulo registrato.
     * @param {string} name - Nome modulo
     * @returns {object|null} Info modulo o null se non trovato
     */
    get: function(name) {
      return registry[name] || null;
    },
    
    /**
     * Restituisce lista di tutti i moduli registrati.
     * @returns {object} Registry di moduli
     */
    getAll: function() {
      return { ...registry };
    },
    
    /**
     * Valida tutte le dipendenze registrate.
     * Usato in onOpen() per diagnostica.
     * @returns {boolean} true se tutto OK, false se errori
     */
    validateAll: function() {
      let hasErrors = false;
      const moduleNames = Object.keys(registry);
      
      Logger.log(`[ModuleRegistry.validateAll] Verifica ${moduleNames.length} moduli...`);
      
      moduleNames.forEach(name => {
        const info = registry[name];
        const missing = info.dependencies.filter(dep => {
          return typeof eval('typeof ' + dep) === 'undefined' && 
                 typeof globalThis[dep] === 'undefined';
        });
        
        if (missing.length > 0) {
          Logger.log(`  ❌ ${name} manca: ${missing.join(', ')}`);
          hasErrors = true;
        } else {
          Logger.log(`  ✓ ${name}`);
        }
      });
      
      if (!hasErrors) {
        Logger.log(`[ModuleRegistry.validateAll] ✅ Tutte dipendenze OK`);
      } else {
        Logger.log(`[ModuleRegistry.validateAll] ⚠️ Trovati errori di dipendenze!`);
      }
      
      return !hasErrors;
    }
  };
})();