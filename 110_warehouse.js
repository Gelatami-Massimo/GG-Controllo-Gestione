// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 110_warehouse.js
// RUOLO: Wrapper backward compatibility - delega a MAGAZZINO_CORE.
// NOTE: Solo 39 righe, funzione legacy create() per compatibilità.
// =============================================================

const WAREHOUSE = (function () {

  /**
   * Funzione legacy: delega a MAGAZZINO_CORE.buildMagazzinoByYear()
   * @deprecated Usa direttamente buildMagazzinoByYear()
   */
  function create() {
    if (typeof MAGAZZINO_CORE !== 'undefined' && MAGAZZINO_CORE.buildMagazzinoByYear) {
      LOG?.info('WAREHOUSE', 'Delegando a MAGAZZINO_CORE.buildMagazzinoByYear()');
      MAGAZZINO_CORE.buildMagazzinoByYear();
    } else {
      throw new Error('MAGAZZINO_CORE non disponibile. Verifica che 084_magazzino_core.js sia caricato.');
    }
  }

  // API pubblica
  return {
    create
  };

})();

// Registra nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('WAREHOUSE', ['MAGAZZINO_CORE', 'UTIL', 'LOG']);
}

// Registra nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('WAREHOUSE', WAREHOUSE);
}
