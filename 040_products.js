// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 040_products.js (V2 - CodiceInternoBreve)
// RUOLO: Gestore catalogo prodotti con chiave CodiceInternoBreve.
// NOTE: Sistema robusto con matching by code e by description.
// =============================================================

const PRODUCTS = (() => {
  
  // ============================================================
  // NORMALIZZAZIONE DESCRIZIONE
  // ============================================================
  
  /**
   * Normalizza una descrizione per matching robusto.
   * - Maiuscolo
   * - Trim spazi iniziali/finali
   * - Riduce spazi multipli a singolo
   * - Rimuove punteggiatura e caratteri speciali non significativi
   * 
   * @param {string} descrizione - Descrizione raw
   * @returns {string} Descrizione normalizzata
   * 
   * @example
   * normalizeDescrizione("  Latte  Intero,  1L!!  ")
   * // → "LATTE INTERO 1L"
   */
  function normalizeDescrizione(descrizione) {
    if (!descrizione) return '';
    
    return String(descrizione)
      .trim()
      .toUpperCase()
      .normalize('NFD')                    // Decompose accenti
      .replace(/[\u0300-\u036f]/g, '')     // Rimuove diacritici
      .replace(/[.,;:!?'"(){}\[\]]/g, ' ') // Punteggiatura → spazio
      .replace(/[-\/]+/g, ' ')             // Trattini/slash → spazio
      .replace(/\s+/g, ' ')                // Spazi multipli → singolo
      .trim();
  }

  // ============================================================
  // GENERAZIONE CODICE INTERNO BREVE
  // ============================================================
  
  /**
   * Genera sigla fornitore (2-3 caratteri) da denominazione.
   * 
   * @param {string} denominazione - Nome fornitore
   * @returns {string} Sigla (es: "DAV", "FER", "MAG")
   * @private
   */
  function _generateSupplierSigla(denominazione) {
    if (!denominazione) return 'GEN';
    
    const clean = String(denominazione)
      .trim()
      .toUpperCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]/g, '');
    
    if (clean.length === 0) return 'GEN';
    if (clean.length <= 3) return clean;
    
    // Prime 3 consonanti o prime 3 lettere
    const consonants = clean.replace(/[AEIOU]/g, '');
    if (consonants.length >= 3) {
      return consonants.substring(0, 3);
    }
    
    return clean.substring(0, 3);
  }

  /**
   * Genera CodiceInternoBreve univoco nel formato: AAA-0001
   * 
   * @param {string} fornitoreId - P.IVA fornitore
   * @param {string} denominazioneFornitore - Nome fornitore
   * @param {Set<string>} existingCodes - Set di codici già esistenti
   * @returns {string} Nuovo CodiceInternoBreve
   * @private
   */
  function _generateCodiceInternoBreve(fornitoreId, denominazioneFornitore, existingCodes) {
    const sigla = _generateSupplierSigla(denominazioneFornitore);
    
    // Trova il massimo progressivo esistente per questa sigla
    let maxNum = 0;
    const pattern = new RegExp(`^${sigla}-(\\d{4})$`, 'i');
    
    existingCodes.forEach(code => {
      const match = code.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    });
    
    // Incrementa e formatta
    const newNum = maxNum + 1;
    const paddedNum = String(newNum).padStart(4, '0');
    const newCode = `${sigla}-${paddedNum}`;
    
    // Verifica unicità (safety check)
    if (existingCodes.has(newCode)) {
      // Fallback: aggiungi timestamp
      return `${sigla}-${paddedNum}-${Date.now() % 10000}`;
    }
    
    return newCode;
  }

  // ============================================================
  // CACHE E MAPPE
  // ============================================================
  
  /**
   * Carica e indicizza il foglio Prodotti in memoria.
   * Crea 3 mappe per lookup veloce:
   * - byFornitoreCodice: FornitoreID|CodiceFornitore → Prodotto
   * - byFornitoreDescrizione: FornitoreID|ChiaveDescrizione → Prodotto
   * - byCodeBreve: CodiceInternoBreve → Prodotto
   * 
   * @returns {{byFornitoreCodice: Map, byFornitoreDescrizione: Map, byCodeBreve: Map, shortCodes: Set, newRows: Array}}
   */
  function primeCache() {
    const cache = {
      byFornitoreCodice: new Map(),
      byFornitoreDescrizione: new Map(),
      byCodeBreve: new Map(),
      shortCodes: new Set(),  // Set di CodiceInternoBreve esistenti
      newRows: []
    };

    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
    if (!sh) return cache;

    const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti);
    if (sh.getLastRow() <= headerRow) return cache;

    try {
      const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);

      const required = ['FornitoreID', 'CodiceFornitore', 'Descrizione', 'UM'];
      const missing = required.filter(k => idx[k] === undefined);
      if (missing.length) {
        LOG.warn('PRODUCTS_CACHE', 'Intestazioni mancanti in Prodotti.', { missing });
        return cache;
      }

      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      const values = sh.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();

      values.forEach((r, i) => {
        const prodotto = {
          rowNum: headerRow + 1 + i,
          fornitoreId: String(r[idx.FornitoreID] ?? '').trim(),
          codiceFornitore: String(r[idx.CodiceFornitore] ?? '').trim().replace(/^'+/, ''),
          descrizione: String(r[idx.Descrizione] ?? '').trim(),
          um: String(r[idx.UM] ?? '').trim(),
          codiceInterno: idx.CodiceInterno !== undefined ? String(r[idx.CodiceInterno] ?? '').trim() : '',
          codiceInternoBreve: idx.CodiceInternoBreve !== undefined ? String(r[idx.CodiceInternoBreve] ?? '').trim() : '',
          chiaveDescrizione: idx.ChiaveDescrizione !== undefined ? String(r[idx.ChiaveDescrizione] ?? '').trim() : ''
        };

        // Indicizza per CodiceFornitore (se presente)
        if (prodotto.fornitoreId && prodotto.codiceFornitore) {
          const keyCode = `${prodotto.fornitoreId}|${prodotto.codiceFornitore.toUpperCase()}`;
          cache.byFornitoreCodice.set(keyCode, prodotto);
        }

        // Indicizza per ChiaveDescrizione
        if (prodotto.fornitoreId && prodotto.chiaveDescrizione) {
          const keyDesc = `${prodotto.fornitoreId}|${prodotto.chiaveDescrizione}`;
          cache.byFornitoreDescrizione.set(keyDesc, prodotto);
        }

        // Indicizza per CodiceInternoBreve
        if (prodotto.codiceInternoBreve) {
          cache.byCodeBreve.set(prodotto.codiceInternoBreve, prodotto);
          cache.shortCodes.add(prodotto.codiceInternoBreve);
        }
      });

      LOG.info('PRODUCTS_CACHE', `Cache caricata: ${cache.byFornitoreCodice.size} by code, ${cache.byFornitoreDescrizione.size} by desc, ${cache.shortCodes.size} codici brevi.`);
    } catch (e) {
      LOG.error('PRODUCTS_CACHE', 'Errore caricamento cache Prodotti.', { error: e.message, stack: e.stack });
    }

    return cache;
  }

  // ============================================================
  // FIND OR CREATE PRODUCT (FUNZIONE PRINCIPALE)
  // ============================================================
  
  /**
   * Trova o crea un prodotto nel catalogo.
   * 
   * LOGICA:
   * 1. Se codFornitore presente → cerca by FornitoreCodice
   * 2. Se non trovato → cerca by FornitoreDescrizione (normalizzata)
   * 3. Se non trovato → crea nuovo prodotto
   * 
   * @param {string} fornitoreId - P.IVA fornitore
   * @param {string} denominazioneFornitore - Nome fornitore
   * @param {string} codFornitore - Codice articolo fornitore (può essere vuoto)
   * @param {string} descrizione - Descrizione prodotto
   * @param {string} um - Unità di misura
   * @param {Object} cache - Cache da primeCache()
   * @param {string} [categoriaFornitore=''] - Categoria fornitore
   * @returns {{codiceInternoBreve: string, codiceInterno: string, isNew: boolean}} Prodotto trovato/creato
   */
  function findOrCreateProduct(fornitoreId, denominazioneFornitore, codFornitore, descrizione, um, cache, categoriaFornitore = '') {
    const normFornId = String(fornitoreId || '').trim();
    const normCodForn = String(codFornitore || '').trim().replace(/^'+/, '');
    const normDesc = String(descrizione || '').trim();
    const normUM = String(um || '').trim();

    // 1. Cerca by CodiceFornitore (se presente)
    if (normFornId && normCodForn) {
      const keyCode = `${normFornId}|${normCodForn.toUpperCase()}`;
      const found = cache.byFornitoreCodice.get(keyCode);
      if (found) {
        return {
          codiceInternoBreve: found.codiceInternoBreve,
          codiceInterno: found.codiceInterno,
          isNew: false
        };
      }
    }

    // 2. Cerca by ChiaveDescrizione (fallback)
    if (normFornId && normDesc) {
      const chiaveDesc = normalizeDescrizione(normDesc);
      const keyDesc = `${normFornId}|${chiaveDesc}`;
      const found = cache.byFornitoreDescrizione.get(keyDesc);
      
      if (found) {
        // Se trovato con descrizione ma ora arriva codice → aggiorna CodiceFornitore
        if (normCodForn && !found.codiceFornitore) {
          _updateProductField(found.codiceInternoBreve, 'CodiceFornitore', UTIL.forceText(normCodForn));
          found.codiceFornitore = normCodForn;
          // Aggiorna anche mappa byFornitoreCodice
          const keyCode = `${normFornId}|${normCodForn.toUpperCase()}`;
          cache.byFornitoreCodice.set(keyCode, found);
        }
        
        return {
          codiceInternoBreve: found.codiceInternoBreve,
          codiceInterno: found.codiceInterno,
          isNew: false
        };
      }
    }

    // 3. Non trovato → crea nuovo prodotto
    return _createNewProduct(
      normFornId,
      denominazioneFornitore,
      normCodForn,
      normDesc,
      normUM,
      cache,
      categoriaFornitore
    );
  }

  /**
   * Crea un nuovo prodotto nel foglio Prodotti.
   * @private
   */
  function _createNewProduct(fornitoreId, denominazioneFornitore, codFornitore, descrizione, um, cache, categoriaFornitore) {
    const chiaveDescrizione = normalizeDescrizione(descrizione);
    const codiceInternoBreve = _generateCodiceInternoBreve(fornitoreId, denominazioneFornitore, cache.shortCodes);
    
    // Genera anche CodiceInterno legacy (per compatibilità)
    const codiceInterno = codFornitore 
      ? `${fornitoreId}-${codFornitore}`.slice(0, 60)
      : `${fornitoreId}-${chiaveDescrizione.replace(/\s+/g, '-')}`.slice(0, 60);
    
    const now = new Date();

    const schema = SHEETS.SCHEMAS && SHEETS.SCHEMAS[SHEETS.SHEET_NAMES.Prodotti];
    if (!schema || !Array.isArray(schema)) {
      LOG.error('PRODUCTS_CREATE', 'Schema Prodotti mancante.');
      return { codiceInternoBreve, codiceInterno, isNew: true };
    }

    const newProductData = {
      CodiceInterno: codiceInterno,
      CodiceInternoBreve: codiceInternoBreve,
      ChiaveDescrizione: chiaveDescrizione,
      CodiceFornitore: UTIL.forceText(codFornitore),
      Descrizione: descrizione,
      UM: um,
      FornitoreID: fornitoreId,
      DenominazioneFornitore: denominazioneFornitore,
      CategoriaProdotto: categoriaFornitore,
      Note: '',
      CreatoIl: now,
      UltimoAgg: now,
      Ingrediente: '',
      NonInUso: true,  // Parte bloccato
      UMBase: '',
      PZxCT: '',
      KGxPZ: '',
      PZxFila: '',
      FilePerCT: '',
      RichiedeSetup: true,
      CostoUnitario: '',
      UMCosto: ''
    };

    const newRow = schema.map(header => {
      const dataKey = String(header).replace(/ /g, '');
      return (dataKey in newProductData) ? newProductData[dataKey] : '';
    });

    cache.newRows.push(newRow);
    cache.shortCodes.add(codiceInternoBreve);

    // Aggiorna mappe in memoria
    const prodotto = {
      fornitoreId,
      codiceFornitore,
      descrizione,
      um,
      codiceInterno,
      codiceInternoBreve,
      chiaveDescrizione
    };

    if (codFornitore) {
      const keyCode = `${fornitoreId}|${codFornitore.toUpperCase()}`;
      cache.byFornitoreCodice.set(keyCode, prodotto);
    }

    const keyDesc = `${fornitoreId}|${chiaveDescrizione}`;
    cache.byFornitoreDescrizione.set(keyDesc, prodotto);
    cache.byCodeBreve.set(codiceInternoBreve, prodotto);

    LOG.info('PRODUCTS_CREATE', `Nuovo prodotto creato: ${codiceInternoBreve}`, { codFornitore, descrizione });

    return { codiceInternoBreve, codiceInterno, isNew: true };
  }

  /**
   * Aggiorna un campo specifico di un prodotto esistente.
   * @private
   */
  function _updateProductField(codiceInternoBreve, fieldName, newValue) {
    try {
      const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
      if (!sh) return;

      const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti);
      const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
      
      if (idx.CodiceInternoBreve === undefined || idx[fieldName] === undefined) return;

      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      const values = sh.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();

      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        if (String(row[idx.CodiceInternoBreve] || '').trim() === codiceInternoBreve) {
          const targetRow = headerRow + 1 + i;
          sh.getRange(targetRow, idx[fieldName] + 1).setValue(newValue);
          sh.getRange(targetRow, idx.UltimoAgg + 1).setValue(new Date());
          LOG.info('PRODUCTS_UPDATE', `Aggiornato ${fieldName} per ${codiceInternoBreve}`);
          break;
        }
      }
    } catch (e) {
      LOG.error('PRODUCTS_UPDATE', 'Errore aggiornamento campo.', { error: e.message });
    }
  }

  /**
   * Scrive i nuovi prodotti accumulati nel cache.newRows.
   */
  function flushNewRows(cache) {
    if (!cache || !cache.newRows || cache.newRows.length === 0) return;

    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
    if (!sh) {
      LOG.error('PRODUCTS_FLUSH', 'Foglio Prodotti non trovato.');
      return;
    }

    try {
      const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti);
      const startRow = Math.max(headerRow + 1, sh.getLastRow() + 1);

      const neededLastRow = startRow + cache.newRows.length - 1;
      const maxRows = sh.getMaxRows();
      if (neededLastRow > maxRows) {
        sh.insertRowsAfter(maxRows, neededLastRow - maxRows);
      }

      UTIL.writeBatched(sh, startRow, cache.newRows);
      LOG.info('PRODUCTS_FLUSH', `Aggiunti ${cache.newRows.length} nuovi prodotti.`);
      cache.newRows.length = 0;
    } catch (e) {
      LOG.error('PRODUCTS_FLUSH', 'Errore flush prodotti.', { error: e.message });
    }
  }

  // ============================================================
  // FUNZIONI DI UTILITÀ (MANTENIAMO PER COMPATIBILITÀ)
  // ============================================================
  
  function isProductActive(productRow, nonInUsoIndex) {
    if (!productRow) return false;
    
    if (Array.isArray(productRow)) {
      if (nonInUsoIndex === undefined) return true;
      const nonInUsoValue = productRow[nonInUsoIndex];
      return nonInUsoValue !== true && 
             String(nonInUsoValue).toLowerCase() !== 'true' && 
             String(nonInUsoValue).toLowerCase() !== 'vero';
    }
    
    const nonInUsoValue = productRow.NonInUso;
    return nonInUsoValue !== true && 
           String(nonInUsoValue).toLowerCase() !== 'true' && 
           String(nonInUsoValue).toLowerCase() !== 'vero';
  }

  // API pubblica
  return { 
    primeCache, 
    findOrCreateProduct, 
    flushNewRows, 
    normalizeDescrizione,
    isProductActive
  };
})();

// Registra PRODUCTS nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('PRODUCTS', ['SHEETS', 'LOG', 'UTIL']);
}

// Registra PRODUCTS nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('PRODUCTS', PRODUCTS);
}
