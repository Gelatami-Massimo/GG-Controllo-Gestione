// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 40_products.js
// VERSIONE: 25.0 (Product Manager)
// DESCRIZIONE: Gestore del catalogo prodotti (cache, creazione univoca).
// =============================================================

const PRODUCTS = (() => {
  /**
   * Carica in memoria gli indici e i dati prodotti.
   * @returns {{keyToData: Map<string, any>, internalCodes: Set<string>, newRows: any[]}}
   */
  function primeCache() {
    const cache = {
      keyToData: new Map(),
      internalCodes: new Set(),
      newRows: []
    };

    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
    if (!sh) return cache;

    const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti);
    if (sh.getLastRow() <= headerRow) return cache;

    try {
      const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);

      // Verifica indici essenziali
      const required = ['FornitoreID', 'CodiceFornitore', 'Descrizione', 'UM', 'CodiceInterno'];
      const missing = required.filter(k => idx[k] === undefined);
      if (missing.length) {
        LOG.warn('PRODUCTS_CACHE', 'Intestazioni mancanti in Prodotti. Cache parziale.', { missing, idx });
        return cache;
      }

      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      const values = sh.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();

      values.forEach(r => {
        const rowData = {
          fornitoreId: String(r[idx.FornitoreID] ?? ''),
          codiceFornitore: String(r[idx.CodiceFornitore] ?? ''),
          descrizione: String(r[idx.Descrizione] ?? ''),
          um: String(r[idx.UM] ?? ''),
          codiceInterno: String(r[idx.CodiceInterno] ?? '')
        };

        const key = _getProductKey(rowData.fornitoreId, rowData.codiceFornitore, rowData.descrizione, rowData.um);
        cache.keyToData.set(key, rowData);
        if (rowData.codiceInterno) cache.internalCodes.add(rowData.codiceInterno);
      });
    } catch (e) {
      LOG.error('PRODUCTS_CACHE', 'Errore during la lettura della cache Prodotti.', { error: e.message, stack: e.stack });
    }

    return cache;
  }

  /**
   * Assicura che un prodotto esista, creandolo se necessario.
   * @param {string} fornitoreId
   * @param {string} fornitoreName
   * @param {string} codiceFornRaw
   * @param {string} descrizione
   * @param {string} um
   * @param {{keyToData: Map, internalCodes: Set, newRows: any[]}} cache
   * @param {string} categoriaFornitore - Categoria del fornitore da copiare in CategoriaProdotto
   * @returns {string} codice interno creato o esistente
   */
  function ensureProduct(fornitoreId, fornitoreName, codiceFornRaw, descrizione, um, cache, categoriaFornitore = '') {
    const key = _getProductKey(fornitoreId, codiceFornRaw, descrizione, um);
    const existingProduct = cache.keyToData.get(key);

    if (existingProduct && existingProduct.codiceInterno) {
      return existingProduct.codiceInterno;
    }

    // Forza testo per evitare reinterpretazioni di Sheets
    const codiceForn = UTIL.forceText(codiceFornRaw);

    // Genera codice interno univoco
    const proposedCode = _proposeInternalCode(fornitoreId, codiceFornRaw, descrizione);
    const internalCode = _makeUnique(proposedCode, cache.internalCodes);
    const now = new Date();

    const newProductData = {
      CodiceInterno: internalCode,
      CodiceFornitore: codiceForn,
      Descrizione: descrizione || '',
      UM: um || '',
      FornitoreID: fornitoreId || '',
      DenominazioneFornitore: fornitoreName || '',
      CategoriaProdotto: categoriaFornitore || '',
      Note: '',
      CreatoIl: now,
      UltimoAgg: now,
      Ingrediente: '',
      NonInUso: true  // ✅ Nuovo prodotto parte bloccato (richiede attivazione manuale)
    };

    // Allinea all'ordine colonne del foglio
    const schema = SHEETS.SCHEMAS && SHEETS.SCHEMAS[SHEETS.SHEET_NAMES.Prodotti];
    if (!schema || !Array.isArray(schema)) {
      LOG.error('PRODUCTS_ENSURE', 'Schema Prodotti mancante o non valido in SHEETS.SCHEMAS.');
      return internalCode;
    }

    const newRow = schema.map(header => {
      // Pulisce il nome dell'header per farlo corrispondere alle chiavi dell'oggetto
      const dataKey = String(header).replace(/ /g, '');
      return (dataKey in newProductData) ? newProductData[dataKey] : '';
    });

    cache.newRows.push(newRow);

    // Aggiorna cache in RAM
    const cacheData = {
      fornitoreId: String(fornitoreId ?? ''),
      codiceFornitore: String(codiceFornRaw ?? ''),
      descrizione: String(descrizione ?? ''),
      um: String(um ?? ''),
      codiceInterno: internalCode
    };
    cache.keyToData.set(key, cacheData);
    cache.internalCodes.add(internalCode);

    return internalCode;
  }

  /**
   * Scrive i nuovi prodotti accumulati nel foglio in un unico batch.
   * @param {{newRows:any[]}} cache
   */
  function flushNewRows(cache) {
    if (!cache || !cache.newRows || cache.newRows.length === 0) return;

    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
    if (!sh) {
      LOG.error('PRODUCTS_FLUSH', 'Impossibile trovare il foglio Prodotti.');
      return;
    }

    try {
      const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti);
      const startRow = Math.max(headerRow + 1, sh.getLastRow() + 1);

      // Pre-alloca righe se insufficienti
      const neededLastRow = startRow + cache.newRows.length - 1;
      const maxRows = sh.getMaxRows();
      if (neededLastRow > maxRows) {
        sh.insertRowsAfter(maxRows, neededLastRow - maxRows);
      }

      UTIL.writeBatched(sh, startRow, cache.newRows);
      LOG.info('PRODUCTS_FLUSH', `Aggiunti ${cache.newRows.length} nuovi prodotti al catalogo.`);
      cache.newRows.length = 0;
    } catch (e) {
      LOG.error('PRODUCTS_FLUSH', 'Fallita scrittura batch nuovi prodotti.', { error: e.message, stack: e.stack });
    }
  }

  // ------------------ Helpers privati ------------------

  /**
   * Genera una chiave univoca e stabile per il prodotto.
   */
  function _getProductKey(fornitoreId, codiceForn, descrizione, um) {
    const normalizedFornId = UTIL.normKey(fornitoreId);

    // Normalizza codice fornitore: toglie eventuali apostrofi d’obbligo di Sheets
    const rawCode = String(codiceForn ?? '').trim().replace(/^'+/, '');
    if (rawCode) {
      return `${normalizedFornId}|CF:${UTIL.normKey(rawCode)}`;
    }

    const descKey = String(descrizione ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    const umKey = String(um ?? 'U')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    return `${normalizedFornId}|DS:${descKey}|UM:${umKey}`;
  }

  /**
   * Propone un codice interno leggibile e conciso.
   */
  function _proposeInternalCode(fornitoreId, codiceForn, descr) {
    const baseFor = UTIL.normKey(fornitoreId).replace(/\s+/g, '');
    const cleanCodiceForn = String(codiceForn ?? '')
      .trim()
      .replace(/^'+/, '')
      .replace(/[^a-zA-Z0-9-]/g, '');

    if (cleanCodiceForn) {
      return `${baseFor}-${cleanCodiceForn}`.slice(0, 60);
    }

    const slug = String(descr ?? '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 20);

    return `${baseFor}-${slug || 'ITEM'}`;
  }

  /**
   * Rende un codice univoco rispetto all'insieme dei codici interni esistenti.
   */
  function _makeUnique(proposed, existingSet) {
    let code = proposed;
    let n = 2;
    while (existingSet.has(code)) {
      code = `${proposed.slice(0, 50)}-${n}`;
      n++;
    }
    return code;
  }

  /**
   * Verifica se un prodotto è attivo.
   * Un prodotto è considerato attivo se:
   * - NonInUso === FALSE (esplicitamente attivo)
   * - NonInUso === undefined/null/'' (compatibilità retroattiva con prodotti esistenti)
   * @param {any} productRow - Riga prodotto (array o oggetto con indice NonInUso)
   * @param {number} nonInUsoIndex - Indice della colonna NonInUso (se productRow è array)
   * @returns {boolean} TRUE se il prodotto è attivo
   */
  function isProductActive(productRow, nonInUsoIndex) {
    if (!productRow) return false;
    
    // Se productRow è un array (da getValues())
    if (Array.isArray(productRow)) {
      if (nonInUsoIndex === undefined) return true; // colonna non presente = attivo per compatibilità
      const nonInUsoValue = productRow[nonInUsoIndex];
      // Attivo se: FALSE, null, undefined, stringa vuota
      return nonInUsoValue !== true && 
             String(nonInUsoValue).toLowerCase() !== 'true' && 
             String(nonInUsoValue).toLowerCase() !== 'vero';
    }
    
    // Se productRow è un oggetto
    const nonInUsoValue = productRow.NonInUso;
    return nonInUsoValue !== true && 
           String(nonInUsoValue).toLowerCase() !== 'true' && 
           String(nonInUsoValue).toLowerCase() !== 'vero';
  }

  // API pubblica
  return { primeCache, ensureProduct, flushNewRows, isProductActive };
})();

// Registra PRODUCTS nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('PRODUCTS', ['SHEETS', 'LOG', 'UTIL']);
}

// Registra PRODUCTS nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('PRODUCTS', PRODUCTS);
}