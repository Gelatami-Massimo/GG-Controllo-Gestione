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

  /**
   * Normalizza un codice fornitore per matching robusto.
   * - Rimuove tutti i caratteri non alfanumerici
   * - Converte in maiuscolo
   * 
   * @param {string} codFornitore - Codice fornitore raw
   * @returns {string} Codice fornitore normalizzato
   * 
   * @example
   * normalizeCodiceFornitore(" 5043+341-24 ")
   * // → "504334124"
   */
  function normalizeCodiceFornitore(codFornitore) {
    if (!codFornitore) return '';
    
    return String(codFornitore)
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, ''); // Rimuove tutto ciò che non è lettera o numero
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
        // ✅ NORMALIZZA FORNITORE: Rimuovi IT e zeri iniziali per coerenza chiavi
        const fornitoreIdRaw = String(r[idx.FornitoreID] ?? '').trim();
        const fornitoreIdNorm = fornitoreIdRaw.replace(/^IT/i, '').replace(/^0+/, '');
        
        const prodotto = {
          rowNum: headerRow + 1 + i,
          fornitoreId: fornitoreIdNorm,  // ✅ Salva versione normalizzata
          fornitoreIdOriginal: fornitoreIdRaw,  // Mantieni originale per riferimento
          codiceFornitore: String(r[idx.CodiceFornitore] ?? '').trim().replace(/^'+/, ''),
          descrizione: String(r[idx.Descrizione] ?? '').trim(),
          um: String(r[idx.UM] ?? '').trim(),
          categoriaProdotto: idx.CategoriaProdotto !== undefined ? String(r[idx.CategoriaProdotto] ?? '').trim() : '',
          codiceInterno: idx.CodiceInterno !== undefined ? String(r[idx.CodiceInterno] ?? '').trim() : '',
          codiceInternoBreve: idx.CodiceInternoBreve !== undefined ? String(r[idx.CodiceInternoBreve] ?? '').trim() : '',
          chiaveDescrizione: idx.ChiaveDescrizione !== undefined ? String(r[idx.ChiaveDescrizione] ?? '').trim() : ''
        };

        // Indicizza per CodiceFornitore (se presente)
        if (prodotto.fornitoreId && prodotto.codiceFornitore) {
          // ✅ FIX: Normalizza il codice come in fase di ricerca per garantire il match
          const codiceNorm = normalizeCodiceFornitore(prodotto.codiceFornitore);
          const keyCode = `${prodotto.fornitoreId}|${codiceNorm}`;
          cache.byFornitoreCodice.set(keyCode, prodotto);
        }

        // Indicizza per ChiaveDescrizione con FornitoreID NORMALIZZATO
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
   * @param {string} [runId=''] - RunId per logging granulare
   * @returns {{codiceInternoBreve: string, codiceInterno: string, isNew: boolean}} Prodotto trovato/creato
   */
  function findOrCreateProduct(fornitoreId, denominazioneFornitore, codFornitore, descrizione, um, cache, categoriaFornitore = '', runId = '') {
    // ✅ NORMALIZZA FORNITORE: Rimuovi IT e zeri iniziali (coerente con lookup keys)
    const normFornId = String(fornitoreId || '').trim().replace(/^IT/i, '').replace(/^0+/, '');
    // >>> USA LA NUOVA NORMALIZZAZIONE <<<
    const normCodForn = normalizeCodiceFornitore(codFornitore);
    const normDesc = String(descrizione || '').trim();
    let normUM = String(um || '').trim();
    
    // 1. Sicurezza: Un prodotto DEVE avere un Fornitore (P.IVA)
    if (!normFornId) {
      LOG.warn('PRODUCTS_SKIP', 'Tentativo creazione prodotto senza FornitoreID (P.IVA mancante). Salto.', { descrizione: normDesc });
      return null;
    }

    // 2. Sicurezza: Deve avere ALMENO un Codice OPPURE una Descrizione
    if (!normCodForn && !normDesc) {
      LOG.warn('PRODUCTS_SKIP', 'Riga senza né Codice né Descrizione. Salto.', { fornitore: normFornId });
      return null;
    }

    // Nota: Se manca il Codice ma c'è la Descrizione, procediamo (verrà generato un codice interno basato sulla descrizione).
    
    if (runId) {
      LOG.debug(runId, 'PRODUCTS_FIND_START', 'Inizio ricerca prodotto', {
        fornitoreId: normFornId,
        codFornitore,
        normCodForn,
        descrizione: normDesc.substring(0, 50)
      });
    }

    // ✅ FIX: Se UM è vuota, assegna 'PZ' come default e logga un warning
    if (!normUM) {
      normUM = 'PZ';
      LOG.warn('PRODUCTS_UM_FIX', `UM mancante per prodotto, assegnato default 'PZ'.`, {
        fornitoreId: normFornId,
        codFornitore: normCodForn,
        descrizione: normDesc
      });
    }

    // 1. Ricerca multi-chiave: cerca sia per codice che per descrizione
    let foundByCode = null;
    // Cerca per codice solo se non è un codice temporaneo
    if (normFornId && normCodForn && !normCodForn.startsWith('TEMP_')) {
      const keyCode = `${normFornId}|${normCodForn.toUpperCase()}`;
      foundByCode = cache.byFornitoreCodice.get(keyCode);
      
      if (runId) {
        LOG.debug(runId, 'PRODUCTS_SEARCH_CODE', foundByCode ? 'Prodotto trovato by code' : 'Prodotto NON trovato by code', {
          keyCode,
          found: !!foundByCode,
          codiceInternoBreve: foundByCode?.codiceInternoBreve
        });
      }
    }

    let foundByDesc = null;
    const chiaveDesc = normalizeDescrizione(normDesc);
    if (normFornId && chiaveDesc) {
      const keyDesc = `${normFornId}|${chiaveDesc}`;
      foundByDesc = cache.byFornitoreDescrizione.get(keyDesc);
      
      if (runId) {
        LOG.debug(runId, 'PRODUCTS_SEARCH_BY_DESC', 'Ricerca per descrizione', {
          keyDesc: keyDesc.substring(0, 60),
          found: !!foundByDesc,
          codiceInternoBreve: foundByDesc?.codiceInternoBreve
        });
      }
    }

    // 2. Logica di risoluzione
    
    // Caso 1: Trovato per codice reale. Questo è il match più forte.
    if (foundByCode) {
      _ensureCategoria(foundByCode, categoriaFornitore, cache, runId);
      // Se il prodotto trovato non ha ancora una chiave descrizione, la aggiungiamo.
      if (!foundByCode.chiaveDescrizione && chiaveDesc) {
        _updateProductField(foundByCode.codiceInternoBreve, 'ChiaveDescrizione', chiaveDesc);
        foundByCode.chiaveDescrizione = chiaveDesc;
        const keyDesc = `${normFornId}|${chiaveDesc}`;
        cache.byFornitoreDescrizione.set(keyDesc, foundByCode);
        
        if (runId) {
          LOG.info(runId, 'PRODUCTS_UPDATE_DESC_KEY', 'Aggiunta chiave descrizione a prodotto esistente', {
            codiceInternoBreve: foundByCode.codiceInternoBreve,
            chiaveDesc: chiaveDesc.substring(0, 50)
          });
        }
      }
      
      if (runId) {
        LOG.info(runId, 'PRODUCTS_FOUND_BY_CODE', 'Prodotto trovato per codice', {
          codiceInternoBreve: foundByCode.codiceInternoBreve
        });
      }
      
      return {
        codiceInternoBreve: foundByCode.codiceInternoBreve,
        codiceInterno: foundByCode.codiceInterno,
        isNew: false
      };
    }

    // Caso 2: Non trovato per codice reale, ma trovato per descrizione.
    if (foundByDesc) {
      _ensureCategoria(foundByDesc, categoriaFornitore, cache, runId);
      // Ora abbiamo un codice reale per un prodotto che prima era identificato solo dalla descrizione (o da un TEMP_ code).
      // Questo è il momento dell'"auto-correzione".
      const isTempCode = foundByDesc.codiceFornitore && foundByDesc.codiceFornitore.startsWith('TEMP_');
      const hasNewRealCode = normCodForn && !normCodForn.startsWith('TEMP_');

      if (hasNewRealCode && (!foundByDesc.codiceFornitore || isTempCode)) {
        _updateProductField(foundByDesc.codiceInternoBreve, 'CodiceFornitore', UTIL.forceText(normCodForn));
        
        // Aggiorna la cache in memoria
        foundByDesc.codiceFornitore = normCodForn;
        const keyCode = `${normFornId}|${normCodForn.toUpperCase()}`;
        cache.byFornitoreCodice.set(keyCode, foundByDesc);
        
        if (runId) {
          LOG.info(runId, 'PRODUCTS_AUTOCORRECT', 'Auto-correzione TEMP→real applicata', {
            codiceInternoBreve: foundByDesc.codiceInternoBreve,
            oldCode: isTempCode ? foundByDesc.codiceFornitore : '(vuoto)',
            newCode: normCodForn
          });
        }
        
        LOG.info('PRODUCTS_AUTOCORRECT', `Auto-correzione: Prodotto ${foundByDesc.codiceInternoBreve} aggiornato con codice reale ${normCodForn}.`);
      }
      
      if (runId) {
        LOG.info(runId, 'PRODUCTS_FOUND_BY_DESC', 'Prodotto trovato per descrizione', {
          codiceInternoBreve: foundByDesc.codiceInternoBreve
        });
      }
      
      return {
        codiceInternoBreve: foundByDesc.codiceInternoBreve,
        codiceInterno: foundByDesc.codiceInterno,
        isNew: false
      };
    }

    // 3. Non trovato → crea nuovo prodotto
    if (runId) {
      LOG.info(runId, 'PRODUCTS_CREATE_NEW', 'Nessun match - creazione nuovo prodotto', {
        fornitoreId: normFornId,
        codFornitore: normCodForn,
        descrizione: normDesc.substring(0, 50)
      });
    }
    
    return _createNewProduct(
      normFornId,
      denominazioneFornitore,
      normCodForn, // Può essere un codice reale o un TEMP_
      normDesc,
      normUM,
      cache,
      categoriaFornitore,
      runId  // Propaga runId
    );
  }

  /**
   * Crea un nuovo prodotto nel foglio Prodotti.
   * @private
   */
  function _createNewProduct(fornitoreId, denominazioneFornitore, codFornitore, descrizione, um, cache, categoriaFornitore, runId) {
    runId = runId || '';
    const chiaveDescrizione = normalizeDescrizione(descrizione);
    const codiceInternoBreve = _generateCodiceInternoBreve(fornitoreId, denominazioneFornitore, cache.shortCodes);
    
    if (runId) {
      LOG.info(runId, 'PRODUCTS_CREATED', 'Nuovo prodotto creato', {
        codiceInternoBreve,
        fornitoreId,
        codFornitore,
        descrizione: descrizione.substring(0, 50),
        um
      });
    }
    
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
      codiceFornitore: codFornitore,
      descrizione,
      um,
      categoriaProdotto: categoriaFornitore || '',
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

  // Se arriva una categoria valorizzata, aggiorna il prodotto solo se era vuota
  function _ensureCategoria(prodotto, categoriaFornitore, cache, runId) {
    const categoria = String(categoriaFornitore ?? '').trim();
    if (!prodotto || !categoria) return;

    const current = String(prodotto.categoriaProdotto ?? '').trim();
    if (current) return; // già presente, non sovrascrivere

    // Aggiorna lo sheet e la cache
    _updateProductField(prodotto.codiceInternoBreve, 'CategoriaProdotto', categoria);
    prodotto.categoriaProdotto = categoria;

    // Aggiorna cache byFornitoreCodice se disponibile
    if (prodotto.fornitoreId && prodotto.codiceFornitore && cache?.byFornitoreCodice) {
      const key = `${prodotto.fornitoreId}|${normalizeCodiceFornitore(prodotto.codiceFornitore)}`;
      const cached = cache.byFornitoreCodice.get(key);
      if (cached) cached.categoriaProdotto = categoria;
    }

    if (runId) {
      LOG.info(runId, 'PRODUCTS_CATEGORY_BACKFILL', 'Categoria prodotto aggiornata (era vuota)', {
        codiceInternoBreve: prodotto.codiceInternoBreve,
        categoria
      });
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

  /**
   * Crea batch di nuovi prodotti in una singola operazione di scrittura.
   * OTTIMIZZAZIONE: Scrive N prodotti con 1 sola chiamata a setValues().
   * 
   * @param {Array<Object>} productsArray - Array di oggetti prodotto da creare
   * @param {Object} cache - Cache prodotti per aggiornamento immediato
   * @param {string} [runId=''] - RunId per logging granulare
   * @returns {Array<Object>} Array prodotti creati con codici generati
   * 
   * @example
   * const newProducts = [
   *   { fornitoreId: '12345', denominazioneFornitore: 'Fornitore A', 
   *     codiceValore: 'ABC123', descrizione: 'Latte', um: 'LT', 
   *     categoriaFornitore: 'Latticini', lookupKey: '12345|ABC123' },
   *   { fornitoreId: '12345', denominazioneFornitore: 'Fornitore A',
   *     codiceValore: 'XYZ789', descrizione: 'Yogurt', um: 'KG',
   *     categoriaFornitore: 'Latticini', lookupKey: '12345|XYZ789' }
   * ];
   * const created = PRODUCTS.createBatch(newProducts, productCache, runId);
   * // created = [{ codiceInternoBreve: 'FOR-0001', lookupKey: '12345|ABC123', ... }, ...]
   */
  function createBatch(productsArray, cache, runId = '') {
    if (!productsArray || productsArray.length === 0) {
      LOG.info('PRODUCTS_BATCH_CREATE', 'Nessun prodotto da creare (array vuoto).');
      return [];
    }

    if (!cache) {
      LOG.error('PRODUCTS_BATCH_CREATE', 'Cache non fornita. Impossibile creare batch.');
      return [];
    }

    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
    if (!sh) {
      LOG.error('PRODUCTS_BATCH_CREATE', 'Foglio Prodotti non trovato.');
      return [];
    }

    const schema = SHEETS.SCHEMAS && SHEETS.SCHEMAS[SHEETS.SHEET_NAMES.Prodotti];
    if (!schema || !Array.isArray(schema)) {
      LOG.error('PRODUCTS_BATCH_CREATE', 'Schema Prodotti mancante.');
      return [];
    }

    const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti);
    const startRow = Math.max(headerRow + 1, sh.getLastRow() + 1);
    const now = new Date();
    const createdProducts = [];
    const rowsToWrite = [];

    if (runId) {
      LOG.info(runId, 'PRODUCTS_BATCH_CREATE_START', 'Avvio batch creation prodotti', {
        productsCount: productsArray.length
      });
    }

    // ✅ DEDUPLICAZIONE INPUT: Evita di processare lo stesso prodotto due volte
    const uniqueProducts = [];
    const seenKeys = new Set();
    let duplicatesSkipped = 0;
    
    for (const p of productsArray) {
      // Usa lookupKey se disponibile, altrimenti fallback su fornitoreId+codiceValore
      const key = p.lookupKey || `${p.fornitoreId}|${String(p.codiceValore || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')}`;
      
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        uniqueProducts.push(p);
      } else {
        duplicatesSkipped++;
      }
    }
    
    if (duplicatesSkipped > 0) {
      LOG.warn(runId, 'PRODUCTS_BATCH_DEDUP', 'Duplicati rimossi da batch input', {
        originalCount: productsArray.length,
        uniqueCount: uniqueProducts.length,
        duplicatesSkipped
      });
    }

    // Prepara righe per batch insert (usa uniqueProducts invece di productsArray)
    for (const productData of uniqueProducts) {
      const { fornitoreId, denominazioneFornitore, codiceValore, descrizione, um, categoriaFornitore, lookupKey } = productData;

      // Genera CodiceInternoBreve univoco
      const codiceInternoBreve = _generateCodiceInternoBreve(fornitoreId, denominazioneFornitore, cache.shortCodes);
      
      // Genera CodiceInterno legacy (per compatibilità)
      const normCodForn = normalizeCodiceFornitore(codiceValore);
      const chiaveDescrizione = normalizeDescrizione(descrizione);
      const codiceInterno = normCodForn
        ? `${fornitoreId}-${normCodForn}`.slice(0, 60)
        : `${fornitoreId}-${chiaveDescrizione.replace(/\\s+/g, '-')}`.slice(0, 60);

      // Costruisci riga secondo schema
      const newProductData = {
        CodiceInterno: codiceInterno,
        CodiceInternoBreve: codiceInternoBreve,
        ChiaveDescrizione: chiaveDescrizione,
        CodiceFornitore: UTIL.forceText(codiceValore),
        Descrizione: descrizione,
        UM: um || 'PZ', // Default PZ se mancante
        FornitoreID: fornitoreId,
        DenominazioneFornitore: denominazioneFornitore,
         CategoriaProdotto: categoriaFornitore || '', // Changed from categoriaFornitore to categoriaProdotto
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

      rowsToWrite.push(newRow);

      // Prepara oggetto per ritorno
        const prodotto = {
          fornitoreId,
          codiceFornitore: codiceValore,
          descrizione,
          um: um || 'PZ',
          categoriaProdotto: categoriaFornitore || '',
          codiceInterno,
          codiceInternoBreve,
          chiaveDescrizione,
          lookupKey // Mantieni lookup key per aggiornamento Hash Map
        };

      createdProducts.push(prodotto);

      // Aggiorna cache in memoria IMMEDIATAMENTE
      cache.shortCodes.add(codiceInternoBreve);
      
      if (normCodForn) {
        const keyCode = `${fornitoreId}|${normCodForn.toUpperCase()}`;
        cache.byFornitoreCodice.set(keyCode, prodotto);
      }

      const keyDesc = `${fornitoreId}|${chiaveDescrizione}`;
      cache.byFornitoreDescrizione.set(keyDesc, prodotto);
      cache.byCodeBreve.set(codiceInternoBreve, prodotto);

      if (runId) {
        LOG.debug(runId, 'PRODUCTS_BATCH_ITEM', 'Prodotto preparato per batch', {
          codiceInternoBreve,
          codiceValore,
          descrizione: descrizione.substring(0, 50)
        });
      }
    }

    // ✅ BATCH WRITE: 1 sola operazione per N prodotti
    try {
      const neededLastRow = startRow + rowsToWrite.length - 1;
      const maxRows = sh.getMaxRows();
      if (neededLastRow > maxRows) {
        sh.insertRowsAfter(maxRows, neededLastRow - maxRows);
      }

      UTIL.writeBatched(sh, startRow, rowsToWrite);
      
      LOG.info('PRODUCTS_BATCH_CREATE', `Batch creation completata: ${rowsToWrite.length} prodotti creati.`, {
        startRow,
        endRow: startRow + rowsToWrite.length - 1
      });

      if (runId) {
        LOG.info(runId, 'PRODUCTS_BATCH_CREATE_DONE', 'Batch creation completata', {
          productsCreated: rowsToWrite.length,
          startRow,
          endRow: startRow + rowsToWrite.length - 1
        });
      }
    } catch (e) {
      LOG.error('PRODUCTS_BATCH_CREATE', 'Errore batch write prodotti.', { 
        error: e.message, 
        stack: e.stack,
        productsCount: rowsToWrite.length 
      });
      return []; // Ritorna array vuoto in caso di errore
    }

    return createdProducts;
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
    createBatch, // ✅ NUOVA: Batch creation ottimizzata
    normalizeDescrizione,
    generateSupplierSigla: _generateSupplierSigla,  // Esposta per riuso in tools
    isProductActive,
    normalizeCodiceFornitore // Esponi per test e riuso
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

// Espone PRODUCTS in globalThis per dependency tracking
if (typeof globalThis !== 'undefined') {
  globalThis.PRODUCTS = PRODUCTS;
}
