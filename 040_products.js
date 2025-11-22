// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 040_products.js
// RUOLO: Gestore catalogo prodotti con cache e creazione univoca.
// NOTE: Genera CodiceInterno, supporta conversioni UM e calcolo costi unitari.
// =============================================================

const PRODUCTS = (() => {
  /**
   * Carica in memoria gli indici e i dati prodotti dal foglio Prodotti.
   * Costruisce mappa keyToData (fornitoreId+codiceFornitore -> prodotto) e
   * set internalCodes per gestione unicità codici interni.
   * 
   * @returns {{keyToData: Map<string, Object>, internalCodes: Set<string>, newRows: Array}} Cache prodotti
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
   * Assicura che un prodotto esista nel catalogo, creandolo se necessario.
   * Se il prodotto non esiste, genera automaticamente CodiceInterno univoco.
   * Se il prodotto esiste ma ha CodiceFornitore vuoto e ora arriva un codice valido, lo aggiorna.
   * 
   * LOGICA RICERCA PRODOTTO:
   * 1. Se codiceFornRaw presente → cerca con chiave CF:codice
   * 2. Se non trovato → cerca con chiave DS:descrizione|UM (prodotto creato senza codice)
   * 3. Se trovato con chiave DS e ora c'è codice → aggiorna CodiceFornitore
   * 
   * @param {string} fornitoreId - P.IVA fornitore
   * @param {string} fornitoreName - Denominazione fornitore
   * @param {string} codiceFornRaw - Codice articolo fornitore
   * @param {string} descrizione - Descrizione prodotto
   * @param {string} um - Unità di misura
   * @param {{keyToData: Map, internalCodes: Set, newRows: Array}} cache - Cache prodotti da primeCache()
   * @param {string} [categoriaFornitore=''] - Categoria del fornitore da copiare in CategoriaProdotto
   * @returns {string} Codice interno del prodotto (esistente o appena creato)
   */
  function ensureProduct(fornitoreId, fornitoreName, codiceFornRaw, descrizione, um, cache, categoriaFornitore = '') {
    const key = _getProductKey(fornitoreId, codiceFornRaw, descrizione, um);
    let existingProduct = cache.keyToData.get(key);

    // ✅ RICERCA FALLBACK: Se abbiamo codice ma non troviamo prodotto, cerca con descrizione+UM
    // (caso: prodotto creato senza codice in precedenza)
    if (!existingProduct && codiceFornRaw) {
      const fallbackKey = _getProductKey(fornitoreId, '', descrizione, um);
      existingProduct = cache.keyToData.get(fallbackKey);
      
      if (existingProduct && existingProduct.codiceInterno) {
        // ✅ Trovato con chiave descrizione → aggiorna con codice fornitore
        const newCodiceFornitore = String(codiceFornRaw || '').trim().replace(/^'+/, '');
        _updateProductCodiceFornitore(existingProduct.codiceInterno, newCodiceFornitore);
        existingProduct.codiceFornitore = newCodiceFornitore;
        
        // ✅ Aggiorna cache con nuova chiave (codice fornitore)
        cache.keyToData.set(key, existingProduct);
        
        LOG?.info('PRODUCTS_CODE_UPDATE', `Aggiornato prodotto da descrizione a codice: ${existingProduct.codiceInterno}`, {
          fornitoreId, codiceFornRaw: newCodiceFornitore
        });
        
        return existingProduct.codiceInterno;
      }
    }

    if (existingProduct && existingProduct.codiceInterno) {
      // ✅ Aggiorna CodiceFornitore se era vuoto e ora è disponibile
      const newCodiceFornitore = String(codiceFornRaw || '').trim().replace(/^'+/, '');
      if (newCodiceFornitore && !existingProduct.codiceFornitore) {
        _updateProductCodiceFornitore(existingProduct.codiceInterno, newCodiceFornitore);
        existingProduct.codiceFornitore = newCodiceFornitore; // Aggiorna cache
      }
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
   * Scrive i nuovi prodotti accumulati nel cache.newRows al foglio Prodotti.
   * Scrittura batch unica per performance.
   * 
   * @param {{newRows: Array}} cache - Cache prodotti con array newRows da scrivere
   * @returns {void}
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
   * Verifica se un prodotto è attivo (NonInUso = false/null/undefined).
   * Prodotto attivo: disponibile per import righe e calcoli.
   * Prodotto non attivo (NonInUso=true): ignorato durante import.
   * 
   * @param {Array|Object} productRow - Riga prodotto (array da getValues() o oggetto)
   * @param {number} [nonInUsoIndex] - Indice colonna NonInUso se productRow è array
   * @returns {boolean} True se prodotto attivo, false se disabilitato
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
   * Calcola il costo unitario di un prodotto in base alle conversioni UM configurate.
   * 
   * REGOLE CONVERSIONE:
   * 1. Fattura in KG + UMBase=KG → €/KG = PrezzoTotale / QuantitaKG
   * 2. Fattura in PZ + UMBase=PZ → €/PZ = PrezzoTotale / QuantitaPZ
   * 3. Fattura in CT (cartoni):
   *    a. PZ_TOT = QuantitaCT * PZxCT
   *    b. Se UMBase=KG: KG_TOT = PZ_TOT * KGxPZ → €/KG = PrezzoTotale / KG_TOT
   *    c. Se UMBase=PZ: €/PZ = PrezzoTotale / PZ_TOT
   * 
   * VINCOLI:
   * - Nessuna conversione "indovinata"
   * - Se mancano dati necessari → RichiedeSetup=true, CostoUnitario non calcolato
   * 
   * @param {string} codiceInterno - Codice interno prodotto
   * @param {number} quantitaFattura - Quantità dalla fattura
   * @param {string} umFattura - UM dalla fattura (KG, PZ, CT, ecc.)
   * @param {number} prezzoTotale - Prezzo totale della riga fattura
   * @returns {{costoUnitario: number|null, umCosto: string|null, richiedeSetup: boolean}} Risultato calcolo costo
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

  /**
   * Aggiorna il campo CodiceFornitore di un prodotto esistente.
   * Usato quando un prodotto creato senza codice riceve successivamente un codice valido.
   * 
   * @param {string} codiceInterno - Codice interno del prodotto da aggiornare
   * @param {string} newCodiceFornitore - Nuovo codice fornitore da assegnare
   * @private
   */
  function _updateProductCodiceFornitore(codiceInterno, newCodiceFornitore) {
    if (!codiceInterno || !newCodiceFornitore) return;

    try {
      const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
      if (!sh) return;

      const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti);
      if (sh.getLastRow() <= headerRow) return;

      const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
      if (idx.CodiceInterno === undefined || idx.CodiceFornitore === undefined) return;

      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      const values = sh.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();

      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        if (String(row[idx.CodiceInterno] || '').trim() === codiceInterno) {
          const targetRow = headerRow + 1 + i;
          const codiceFornCol = idx.CodiceFornitore + 1;
          const ultimoAggCol = idx.UltimoAgg !== undefined ? idx.UltimoAgg + 1 : null;

          // Forza formato TEXT per evitare reinterpretazioni
          const codiceForzato = UTIL.forceText(newCodiceFornitore);
          sh.getRange(targetRow, codiceFornCol).setValue(codiceForzato);

          // Aggiorna timestamp UltimoAgg
          if (ultimoAggCol) {
            sh.getRange(targetRow, ultimoAggCol).setValue(new Date());
          }

          LOG?.info('PRODUCTS_UPDATE_CODE', `Aggiornato CodiceFornitore per ${codiceInterno}: "${codiceForzato}"`);
          break;
        }
      }
    } catch (e) {
      LOG?.error('PRODUCTS_UPDATE_CODE', 'Errore aggiornamento CodiceFornitore.', {
        codiceInterno,
        newCodiceFornitore,
        error: e.message,
        stack: e.stack
      });
    }
  }

  /**
   * Scansiona tutti i prodotti esistenti e disattiva quelli con descrizioni "spazzatura".
   * Controlla ogni prodotto contro le parole chiave del foglio "Filtro Righe Spazzatura".
   * Se trovato match, imposta NonInUso=TRUE per disattivare il prodotto.
   * 
   * UTILIZZO: Eseguire periodicamente o dopo aggiornamento filtri spazzatura per pulire il catalogo.
   * 
   * @returns {{scanned: number, disabled: number, errors: number}} Statistiche operazione
   * 
   * @example
   * const result = PRODUCTS.markJunkAsUnused();
   * // → { scanned: 1523, disabled: 47, errors: 0 }
   */
  function markJunkAsUnused() {
    const stats = { scanned: 0, disabled: 0, errors: 0 };

    try {
      const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
      if (!sh) {
        LOG.error('PRODUCTS_JUNK_SCAN', 'Foglio Prodotti non trovato.');
        return stats;
      }

      const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti);
      if (sh.getLastRow() <= headerRow) {
        LOG.info('PRODUCTS_JUNK_SCAN', 'Foglio Prodotti vuoto. Nessuna scansione necessaria.');
        return stats;
      }

      const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
      const required = ['CodiceInterno', 'Descrizione', 'NonInUso', 'UltimoAgg'];
      const missing = required.filter(k => idx[k] === undefined);
      if (missing.length) {
        LOG.error('PRODUCTS_JUNK_SCAN', `Colonne mancanti in Prodotti: ${missing.join(', ')}`);
        return stats;
      }

      // Carica parole chiave spazzatura
      const junkKeywords = _getJunkKeywords();
      if (junkKeywords.size === 0) {
        LOG.warn('PRODUCTS_JUNK_SCAN', 'Nessuna parola chiave spazzatura trovata. Operazione annullata.');
        return stats;
      }

      LOG.info('PRODUCTS_JUNK_SCAN', `Caricate ${junkKeywords.size} parole chiave spazzatura per scansione.`);

      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      const values = sh.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();
      const junkKeywordsArray = Array.from(junkKeywords);

      const updates = {}; // { rowNum: { colIndex: newValue } }

      values.forEach((row, i) => {
        stats.scanned++;
        const codiceInterno = String(row[idx.CodiceInterno] || '').trim();
        const descrizione = String(row[idx.Descrizione] || '').toLowerCase();
        const nonInUso = row[idx.NonInUso];

        // Skip se già disattivato
        if (nonInUso === true || String(nonInUso).toLowerCase() === 'true' || String(nonInUso).toLowerCase() === 'vero') {
          return;
        }

        // Controlla se descrizione contiene keyword spazzatura
        const isJunk = junkKeywordsArray.some(keyword => descrizione.includes(keyword));
        
        if (isJunk) {
          const targetRow = headerRow + 1 + i;
          if (!updates[targetRow]) updates[targetRow] = {};
          updates[targetRow][idx.NonInUso] = true;
          updates[targetRow][idx.UltimoAgg] = new Date();
          stats.disabled++;
          
          LOG.info('PRODUCTS_JUNK_MARK', `Disattivato prodotto spazzatura: ${codiceInterno} - "${row[idx.Descrizione]}"`);
        }
      });

      // Scrittura batch degli aggiornamenti
      if (Object.keys(updates).length > 0) {
        const updatedCount = UTIL.updateSheetInPlace(sh, updates, headerRow);
        LOG.info('PRODUCTS_JUNK_SCAN', `Disattivati ${stats.disabled} prodotti spazzatura su ${stats.scanned} scansionati.`);
      } else {
        LOG.info('PRODUCTS_JUNK_SCAN', `Nessun prodotto spazzatura trovato su ${stats.scanned} scansionati.`);
      }

    } catch (e) {
      stats.errors++;
      LOG.error('PRODUCTS_JUNK_SCAN', 'Errore durante scansione prodotti spazzatura.', {
        error: e.message,
        stack: e.stack
      });
    }

    return stats;
  }

  /**
   * Carica parole chiave spazzatura dal foglio "Filtro Righe Spazzatura".
   * @returns {Set<string>} Set di parole chiave in minuscolo
   * @private
   */
  function _getJunkKeywords() {
    const junkSet = new Set();
    const sheetName = SHEETS.SHEET_NAMES.Filtro_Righe_Spazzatura;
    const sh = SHEETS.get(sheetName);
    
    if (!sh) {
      LOG.warn('PRODUCTS_JUNK_KEYWORDS', `Foglio ${sheetName} non trovato.`);
      return junkSet;
    }
    
    const headerRow = SHEETS._findHeaderRow(sh, sheetName);
    if (sh.getLastRow() <= headerRow) {
      LOG.info('PRODUCTS_JUNK_KEYWORDS', `Foglio ${sheetName} vuoto.`);
      return junkSet;
    }

    try {
      const idx = SHEETS.headerIndex(sheetName);
      const colKey = 'ParolaChiaveDaIgnorare';
      
      if (idx[colKey] === undefined) {
        LOG.error('PRODUCTS_JUNK_KEYWORDS', `Colonna '${colKey}' non trovata in ${sheetName}.`);
        return junkSet;
      }
      
      const colIndex = idx[colKey];
      const data = sh.getRange(headerRow + 1, colIndex + 1, sh.getLastRow() - headerRow, 1).getValues();
      
      data.forEach(([keyword]) => {
        const kw = String(keyword || '').trim().toLowerCase();
        if (kw) junkSet.add(kw);
      });
      
      LOG.info('PRODUCTS_JUNK_KEYWORDS', `Caricate ${junkSet.size} parole chiave.`);
    } catch (e) {
      LOG.error('PRODUCTS_JUNK_KEYWORDS', `Errore lettura foglio ${sheetName}.`, { error: e.message });
    }
    return junkSet;
  }

  /**
   * Aggiorna retroattivamente i CodiceFornitore vuoti cercando nelle Righe Fatture.
   * Per ogni prodotto senza CodiceFornitore, cerca nelle righe già importate
   * il codice articolo corrispondente (match per FornitoreID + Descrizione + UM).
   * 
   * UTILIZZO: Eseguire dopo aver importato righe per recuperare codici mancanti.
   * 
   * @returns {{scanned: number, updated: number, errors: number}} Statistiche operazione
   * 
   * @example
   * const result = PRODUCTS.backfillMissingCodes();
   * // → { scanned: 456, updated: 123, errors: 0 }
   */
  function backfillMissingCodes() {
    const stats = { scanned: 0, updated: 0, errors: 0 };

    try {
      const shProd = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
      const shRighe = SHEETS.get(SHEETS.SHEET_NAMES.Righe);
      
      if (!shProd || !shRighe) {
        LOG.error('PRODUCTS_BACKFILL', 'Fogli Prodotti o Righe non trovati.');
        return stats;
      }

      const headerRowP = SHEETS._findHeaderRow(shProd, SHEETS.SHEET_NAMES.Prodotti);
      const headerRowR = SHEETS._findHeaderRow(shRighe, SHEETS.SHEET_NAMES.Righe);
      
      if (shProd.getLastRow() <= headerRowP || shRighe.getLastRow() <= headerRowR) {
        LOG.info('PRODUCTS_BACKFILL', 'Fogli vuoti. Nessun backfill necessario.');
        return stats;
      }

      const idxP = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
      const idxR = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Righe);
      
      const requiredP = ['CodiceInterno', 'FornitoreID', 'CodiceFornitore', 'Descrizione', 'UM', 'UltimoAgg'];
      const requiredR = ['FornitoreID', 'Descrizione', 'Codice Articolo Fornitore'];
      
      const missingP = requiredP.filter(k => idxP[k] === undefined);
      const missingR = requiredR.filter(k => idxR[k] === undefined);
      
      if (missingP.length || missingR.length) {
        LOG.error('PRODUCTS_BACKFILL', 'Colonne mancanti.', { 
          Prodotti: missingP, 
          Righe: missingR 
        });
        return stats;
      }

      // Carica tutti i prodotti senza codice
      const lastRowP = shProd.getLastRow();
      const lastColP = shProd.getLastColumn();
      const valuesP = shProd.getRange(headerRowP + 1, 1, lastRowP - headerRowP, lastColP).getValues();
      
      const productsWithoutCode = [];
      valuesP.forEach((row, i) => {
        const codForn = String(row[idxP.CodiceFornitore] || '').trim();
        if (!codForn) {
          productsWithoutCode.push({
            rowIndex: i,
            rowNum: headerRowP + 1 + i,
            codiceInterno: String(row[idxP.CodiceInterno] || '').trim(),
            fornitoreId: String(row[idxP.FornitoreID] || '').trim(),
            descrizione: String(row[idxP.Descrizione] || '').trim().toUpperCase(),
            um: String(row[idxP.UM] || '').trim().toUpperCase()
          });
        }
      });

      if (productsWithoutCode.length === 0) {
        LOG.info('PRODUCTS_BACKFILL', 'Nessun prodotto senza CodiceFornitore trovato.');
        return stats;
      }

      LOG.info('PRODUCTS_BACKFILL', `Trovati ${productsWithoutCode.length} prodotti senza codice. Cerco nei dati Righe...`);

      // Carica tutte le righe e crea mappa Fornitore+Descrizione+UM → CodiceArticolo
      const lastRowR = shRighe.getLastRow();
      const lastColR = shRighe.getLastColumn();
      const valuesR = shRighe.getRange(headerRowR + 1, 1, lastRowR - headerRowR, lastColR).getValues();
      
      // Mappa doppia:
      // 1. Chiave esatta: "FornitoreID||Descrizione||UM" → CodiceArticolo
      // 2. Chiave normalizzata: "FornitoreID||DescrizioneNormalizzata||UM" → CodiceArticolo
      const codeMapExact = new Map();
      const codeMapNormalized = new Map();
      
      valuesR.forEach(row => {
        const fornId = String(row[idxR.FornitoreID] || '').trim();
        const descRaw = String(row[idxR.Descrizione] || '').trim().toUpperCase();
        const codArt = String(row[idxR['Codice Articolo Fornitore']] || '').trim().replace(/^'+/, '');
        
        // Colonna UM potrebbe non esistere in vecchie versioni
        const umIdx = idxR.UM !== undefined ? idxR.UM : idxR.UnitaMisura;
        const um = umIdx !== undefined ? String(row[umIdx] || '').trim().toUpperCase() : '';
        
        if (fornId && descRaw && codArt) {
          // Chiave esatta
          const keyExact = `${fornId}||${descRaw}||${um}`;
          if (!codeMapExact.has(keyExact)) {
            codeMapExact.set(keyExact, codArt);
          }
          
          // Chiave normalizzata: rimuove numeri iniziali, trattini, slash
          // Es: "18023 GAUFFRE WAFFEL" → "GAUFFRE WAFFEL"
          const descNorm = descRaw
            .replace(/^\d+[-\/\s]+/g, '')  // Rimuove numeri iniziali seguiti da separatori
            .replace(/^[-\/\s]+/g, '')     // Rimuove separatori iniziali rimasti
            .trim();
          
          if (descNorm && descNorm !== descRaw) {
            const keyNorm = `${fornId}||${descNorm}||${um}`;
            if (!codeMapNormalized.has(keyNorm)) {
              codeMapNormalized.set(keyNorm, codArt);
            }
          }
        }
      });

      LOG.info('PRODUCTS_BACKFILL', `Mappa codici creata: ${codeMapExact.size} esatte + ${codeMapNormalized.size} normalizzate.`);

      // Match e aggiorna
      const updates = {};
      productsWithoutCode.forEach(prod => {
        stats.scanned++;
        const keyExact = `${prod.fornitoreId}||${prod.descrizione}||${prod.um}`;
        
        // Prova match esatto
        let foundCode = codeMapExact.get(keyExact);
        
        // Se non trova match esatto, prova match normalizzato
        if (!foundCode) {
          foundCode = codeMapNormalized.get(keyExact);
        }
        
        if (foundCode) {
          const codiceForzato = UTIL.forceText(foundCode);
          if (!updates[prod.rowNum]) updates[prod.rowNum] = {};
          updates[prod.rowNum][idxP.CodiceFornitore] = codiceForzato;
          updates[prod.rowNum][idxP.UltimoAgg] = new Date();
          stats.updated++;
          
          LOG.info('PRODUCTS_BACKFILL_MATCH', `Match trovato: ${prod.codiceInterno} → "${foundCode}"`);
        }
      });

      // Scrittura batch
      if (Object.keys(updates).length > 0) {
        const updatedCount = UTIL.updateSheetInPlace(shProd, updates, headerRowP);
        LOG.info('PRODUCTS_BACKFILL', `Backfill completato: ${stats.updated} prodotti aggiornati su ${stats.scanned} scansionati.`);
      } else {
        LOG.info('PRODUCTS_BACKFILL', `Nessun match trovato nelle Righe per i ${stats.scanned} prodotti senza codice.`);
      }

    } catch (e) {
      stats.errors++;
      LOG.error('PRODUCTS_BACKFILL', 'Errore durante backfill codici fornitore.', {
        error: e.message,
        stack: e.stack
      });
    }

    return stats;
  }

  /**
   * Pulisce retroattivamente le descrizioni dei prodotti rimuovendo i codici articolo ridondanti.
   * Alcuni fornitori includono il codice nella descrizione (es: "80761761-KINDER BUENO...").
   * Questa funzione rimuove il codice se presente all'inizio della descrizione.
   * 
   * UTILIZZO: Eseguire dopo backfillMissingCodes() per pulire descrizioni sporche.
   * 
   * @returns {{scanned: number, cleaned: number, errors: number}} Statistiche operazione
   * 
   * @example
   * const result = PRODUCTS.cleanDescriptions();
   * // → { scanned: 1523, cleaned: 87, errors: 0 }
   */
  function cleanDescriptions() {
    const stats = { scanned: 0, cleaned: 0, errors: 0 };

    try {
      const shProd = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
      
      if (!shProd) {
        LOG.error('PRODUCTS_CLEAN_DESC', 'Foglio Prodotti non trovato.');
        return stats;
      }

      const headerRowP = SHEETS._findHeaderRow(shProd, SHEETS.SHEET_NAMES.Prodotti);
      
      if (shProd.getLastRow() <= headerRowP) {
        LOG.info('PRODUCTS_CLEAN_DESC', 'Foglio Prodotti vuoto.');
        return stats;
      }

      const idxP = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
      
      const required = ['CodiceInterno', 'CodiceFornitore', 'Descrizione', 'UltimoAgg'];
      const missing = required.filter(k => idxP[k] === undefined);
      
      if (missing.length) {
        LOG.error('PRODUCTS_CLEAN_DESC', `Colonne mancanti: ${missing.join(', ')}`);
        return stats;
      }

      const lastRowP = shProd.getLastRow();
      const lastColP = shProd.getLastColumn();
      const valuesP = shProd.getRange(headerRowP + 1, 1, lastRowP - headerRowP, lastColP).getValues();
      
      const updates = {};
      
      valuesP.forEach((row, i) => {
        stats.scanned++;
        const codForn = String(row[idxP.CodiceFornitore] || '').trim().replace(/^'+/, '');
        const descRaw = String(row[idxP.Descrizione] || '').trim();
        const codiceInterno = String(row[idxP.CodiceInterno] || '').trim();
        
        if (!codForn || !descRaw) return; // Skip se manca codice o descrizione
        
        // Pulisce descrizione
        const descCleaned = _cleanDescriptionProduct(descRaw, codForn);
        
        if (descCleaned !== descRaw) {
          const rowNum = headerRowP + 1 + i;
          if (!updates[rowNum]) updates[rowNum] = {};
          updates[rowNum][idxP.Descrizione] = descCleaned;
          updates[rowNum][idxP.UltimoAgg] = new Date();
          stats.cleaned++;
          
          LOG.info('PRODUCTS_CLEAN_DESC_MATCH', `Pulita: "${descRaw}" → "${descCleaned}" [${codiceInterno}]`);
        }
      });

      // Scrittura batch
      if (Object.keys(updates).length > 0) {
        const updatedCount = UTIL.updateSheetInPlace(shProd, updates, headerRowP);
        LOG.info('PRODUCTS_CLEAN_DESC', `Pulizia completata: ${stats.cleaned} descrizioni pulite su ${stats.scanned} prodotti.`);
      } else {
        LOG.info('PRODUCTS_CLEAN_DESC', `Nessuna descrizione da pulire su ${stats.scanned} prodotti.`);
      }

    } catch (e) {
      stats.errors++;
      LOG.error('PRODUCTS_CLEAN_DESC', 'Errore durante pulizia descrizioni.', {
        error: e.message,
        stack: e.stack
      });
    }

    return stats;
  }

  /**
   * Helper privato per pulire descrizioni (stessa logica di IMPORT_ROWS).
   * @private
   */
  function _cleanDescriptionProduct(descrizioneRaw, codiceArticolo) {
    if (!descrizioneRaw) return '';
    if (!codiceArticolo) return descrizioneRaw.trim();

    let desc = String(descrizioneRaw).trim();
    const codice = String(codiceArticolo).trim().replace(/^'+/, '');
    
    if (!codice) return desc;

    const escapedCode = codice.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Pattern 1: Codice all'inizio seguito da separatore
    const pattern1 = new RegExp(`^${escapedCode}\\s*[-/\\s]+`, 'i');
    desc = desc.replace(pattern1, '');
    
    // Pattern 2: Sequenze multiple di codici
    const pattern2 = new RegExp(`^.*${escapedCode}\\s*[-/\\s]+`, 'i');
    if (pattern2.test(desc)) {
      desc = desc.replace(pattern2, '');
    }
    
    return desc.trim();
  }

  // API pubblica
  return { primeCache, ensureProduct, flushNewRows, isProductActive, calculateUnitCost, markJunkAsUnused, backfillMissingCodes, cleanDescriptions };
})();

// Registra PRODUCTS nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('PRODUCTS', ['SHEETS', 'LOG', 'UTIL']);
}

// Registra PRODUCTS nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('PRODUCTS', PRODUCTS);
}