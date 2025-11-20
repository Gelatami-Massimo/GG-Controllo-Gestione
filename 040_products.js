// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 40_products.js
// VERSIONE: 31.0 (Product Manager + Unit Cost Calculation)
// DESCRIZIONE: Gestore del catalogo prodotti (cache, creazione univoca).
//              Supporto conversioni UM e calcolo €/KG, €/PZ.
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
      NonInUso: true,  // ✅ Nuovo prodotto parte bloccato (richiede attivazione manuale)
      UMBase: '',      // ✅ KG o PZ - da configurare manualmente
      PZxCT: '',       // ✅ Pezzi per cartone - da configurare se UM fattura è CT
      KGxPZ: '',       // ✅ KG per pezzo - da configurare per conversioni
      PZxFila: '',     // ✅ Logistica - opzionale
      FilePerCT: '',   // ✅ Logistica - opzionale
      RichiedeSetup: true,  // ✅ TRUE finché non sono configurati UMBase e conversioni
      CostoUnitario: '',    // ✅ Calcolato in fase di import
      UMCosto: ''           // ✅ KG o PZ - indica l'unità del CostoUnitario
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
   * Logica:
   * - Se Codice Articolo Fornitore presente → FornitoreID-CodiceFornitore
   * - Se vuoto → FornitoreID-slug(Descrizione)
   */
  function _proposeInternalCode(fornitoreId, codiceForn, descr) {
    const baseFor = UTIL.normKey(fornitoreId).replace(/\s+/g, '');
    const cleanCodiceForn = String(codiceForn ?? '')
      .trim()
      .replace(/^'+/, '') // Rimuove apostrofi iniziali di Sheets
      .replace(/[^a-zA-Z0-9-]/g, '');

    // ✅ CASO 1: Codice Articolo Fornitore presente
    if (cleanCodiceForn) {
      return `${baseFor}-${cleanCodiceForn}`.slice(0, 60);
    }

    // ✅ CASO 2: Codice vuoto → usa slug(Descrizione)
    // Normalizza descrizione: maiuscolo, solo [A-Z0-9-], max 50 caratteri
    const slug = String(descr ?? '')
      .normalize('NFD') // Decompose accenti
      .replace(/[\u0300-\u036f]/g, '') // Rimuove diacritici
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-') // Sostituisce non-alfanumerici con -
      .replace(/^-+|-+$/g, '') // Rimuove - iniziali/finali
      .slice(0, 50); // Limita lunghezza

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

  /**
   * Calcola il costo unitario di un prodotto in base alle conversioni UM.
   * 
   * REGOLE CONVERSIONE:
   * 1. Fattura in KG + UMBase=KG → €/KG = PrezzoTotale / QuantitaKG
   * 2. Fattura in PZ + UMBase=PZ → €/PZ = PrezzoTotale / QuantitaPZ
   * 3. Fattura in CT:
   *    a. PZ_TOT = QuantitaCT * PZxCT
   *    b. Se UMBase=KG: KG_TOT = PZ_TOT * KGxPZ → €/KG = PrezzoTotale / KG_TOT
   *    c. Se UMBase=PZ: €/PZ = PrezzoTotale / PZ_TOT
   * 
   * VINCOLI:
   * - Nessuna conversione "indovinata"
   * - Se mancano dati necessari → RichiedeSetup=TRUE, CostoUnitario non calcolato
   * 
   * @param {string} codiceInterno - Codice interno prodotto
   * @param {number} quantitaFattura - Quantità dalla fattura
   * @param {string} umFattura - UM dalla fattura (KG, PZ, CT, ecc.)
   * @param {number} prezzoTotale - Prezzo totale della riga fattura
   * @returns {{costoUnitario: number|null, umCosto: string|null, richiedeSetup: boolean}}
   */
  function calculateUnitCost(codiceInterno, quantitaFattura, umFattura, prezzoTotale) {
    const result = {
      costoUnitario: null,
      umCosto: null,
      richiedeSetup: false
    };

    // Validazione input base
    if (!codiceInterno || !quantitaFattura || !umFattura || prezzoTotale === undefined || prezzoTotale === null) {
      result.richiedeSetup = true;
      return result;
    }

    const qta = Number(quantitaFattura);
    const prezzo = Number(prezzoTotale);
    
    if (qta <= 0 || isNaN(qta) || isNaN(prezzo)) {
      result.richiedeSetup = true;
      return result;
    }

    // Legge dati prodotto
    const productData = _getProductData(codiceInterno);
    if (!productData) {
      result.richiedeSetup = true;
      return result;
    }

    const umBase = String(productData.UMBase || '').toUpperCase().trim();
    const pzxct = Number(productData.PZxCT) || null;
    const kgxpz = Number(productData.KGxPZ) || null;
    const umFatturaUpper = umFattura.toUpperCase().trim();

    // Caso 1: Fattura in KG, UMBase = KG
    if (umFatturaUpper === 'KG' && umBase === 'KG') {
      result.costoUnitario = prezzo / qta;
      result.umCosto = 'KG';
      result.richiedeSetup = false;
      return result;
    }

    // Caso 2: Fattura in PZ, UMBase = PZ
    if (umFatturaUpper === 'PZ' && umBase === 'PZ') {
      result.costoUnitario = prezzo / qta;
      result.umCosto = 'PZ';
      result.richiedeSetup = false;
      return result;
    }

    // Caso 3: Fattura in CT (cartoni)
    if (umFatturaUpper === 'CT') {
      // Serve PZxCT
      if (!pzxct || pzxct <= 0) {
        result.richiedeSetup = true;
        return result;
      }

      const pzTot = qta * pzxct;

      // Caso 3a: UMBase = KG → serve anche KGxPZ
      if (umBase === 'KG') {
        if (!kgxpz || kgxpz <= 0) {
          result.richiedeSetup = true;
          return result;
        }
        const kgTot = pzTot * kgxpz;
        result.costoUnitario = prezzo / kgTot;
        result.umCosto = 'KG';
        result.richiedeSetup = false;
        return result;
      }

      // Caso 3b: UMBase = PZ
      if (umBase === 'PZ') {
        result.costoUnitario = prezzo / pzTot;
        result.umCosto = 'PZ';
        result.richiedeSetup = false;
        return result;
      }

      // UMBase non configurato o non riconosciuto
      result.richiedeSetup = true;
      return result;
    }

    // Caso default: configurazione incompleta o UM non gestita
    result.richiedeSetup = true;
    return result;
  }

  /**
   * Legge i dati di un prodotto dal foglio Prodotti.
   * @param {string} codiceInterno
   * @returns {{UMBase: string, PZxCT: number, KGxPZ: number}|null}
   * @private
   */
  function _getProductData(codiceInterno) {
    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
    if (!sh) return null;

    const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti);
    if (sh.getLastRow() <= headerRow) return null;

    try {
      const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
      if (idx.CodiceInterno === undefined) return null;

      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      const values = sh.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();

      for (const r of values) {
        if (String(r[idx.CodiceInterno] || '').trim() === codiceInterno) {
          return {
            UMBase: r[idx.UMBase] || '',
            PZxCT: r[idx.PZxCT] || '',
            KGxPZ: r[idx.KGxPZ] || ''
          };
        }
      }
    } catch (e) {
      LOG?.error('PRODUCTS_GET_DATA', 'Errore lettura dati prodotto.', { codiceInterno, error: e.message });
    }

    return null;
  }

  // API pubblica
  return { primeCache, ensureProduct, flushNewRows, isProductActive, calculateUnitCost };
})();

// Registra PRODUCTS nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('PRODUCTS', ['SHEETS', 'LOG', 'UTIL']);
}

// Registra PRODUCTS nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('PRODUCTS', PRODUCTS);
}