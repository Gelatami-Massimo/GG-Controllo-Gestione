// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 070_import_rows.js
// RUOLO: Import righe fatture in foglio Righe con creazione prodotti.
// NOTE: Usa SHEET_ITERATOR, filtro spazzatura, TipoRiga, costi unitari UM.
// =============================================================

const IMPORT_ROWS = (function () {

  // Cache per righe esistenti (prevenzione duplicati)
  let existingRowsCache = null;

  // ============================================================
  // HELPER: Classificazione TipoRiga
  // ============================================================

  /**
   * Costante: Codici tipo che identificano righe di sconto.
   * Alcuni fornitori usano CodiceTipo specifici per gli sconti.
   */
  const DISCOUNT_CODE_TYPES = ['SC', 'S', 'DSC', 'SCONTO', 'DISCOUNT'];

  /**
   * Verifica se una descrizione contiene parole chiave di sconto.
   * @param {string} desc - Descrizione della riga (già uppercased)
   * @returns {boolean} TRUE se è una descrizione di sconto
   */
  function _isDiscountDescription(desc) {
    const descUpper = String(desc || '').toUpperCase();
    const discountKeywords = [
      'SCONTO', 'SCNT', 'S.C.', 'SC.', 'APP.SCONTI', 'APPLICAZIONE SCONTI',
      'ABBUONO', 'ABBONO', 'BONUS', 'RABATT', 'RAB.', 'RIDUZIONE',
      'DISCOUNT', 'REBATE', 'REDUCTION', 'PROMO', 'PROMOZIONALE'
    ];
    return discountKeywords.some(keyword => descUpper.includes(keyword));
  }

  /**
   * Verifica se un CodiceTipo appartiene ai codici sconto.
   * @param {string} code - CodiceTipo della riga
   * @returns {boolean} TRUE se è un codice sconto
   */
  function _isDiscountCodeType(code) {
    const codeUpper = String(code || '').toUpperCase().trim();
    return DISCOUNT_CODE_TYPES.includes(codeUpper);
  }

  /**
   * Classifica tipo riga fattura con logica multi-fornitore robusta.
   * 
   * REGOLE:
   * 1. OMAGGIO: Quantità > 0 e PrezzoTotale = 0
   * 2. SCONTO:
   *    - Quantità = 0 e PrezzoTotale ≠ 0, OPPURE
   *    - PrezzoTotale < 0 e descrizione/CodiceTipo contiene keyword sconto, OPPURE
   *    - CodiceTipo è codice sconto esplicito (SC, S, DSC, SCONTO, DISCOUNT)
   * 3. TESTO: Quantità = 0, PrezzoTotale = 0, nessuna keyword sconto
   * 4. ARTICOLO: default (Quantità > 0, PrezzoTotale > 0)
   * 
   * @param {number} quantita - Quantità riga fattura
   * @param {number} prezzoTotale - Prezzo totale riga
   * @param {string} descrizione - Descrizione riga
   * @param {string} codiceTipo - CodiceTipo (se presente)
   * @returns {string} "ARTICOLO" | "SCONTO" | "OMAGGIO" | "TESTO"
   * 
   * @example
   * // ARTICOLO: Prodotto normale
   * _classifyRowType(10, 15.00, "Latte Intero 1L", "ART") // → "ARTICOLO"
   * 
   * @example
   * // OMAGGIO: Quantità positiva ma prezzo zero
   * _classifyRowType(5, 0, "Campione omaggio yogurt", "PROMO") // → "OMAGGIO"
   * 
   * @example
   * // SCONTO: Quantità zero, prezzo negativo con keyword
   * _classifyRowType(0, -5.00, "Sconto cliente fedele", "") // → "SCONTO"
   * 
   * @example
   * // TESTO: Nota senza valore economico
   * _classifyRowType(0, 0, "Consegna prevista: 15/11/2025", "") // → "TESTO"
   */
  function _classifyRowType(quantita, prezzoTotale, descrizione, codiceTipo) {
    // Normalizza input (gestisce null/undefined)
    const qta = Number(quantita) || 0;
    const tot = Number(prezzoTotale) || 0;
    const desc = String(descrizione || '');
    const code = String(codiceTipo || '');

    // 1) OMAGGIO: Quantità > 0 ma prezzo = 0
    if (qta > 0 && tot === 0) {
      return 'OMAGGIO';
    }

    // 2) SCONTO: Varie casistiche
    const hasDiscountKeyword = _isDiscountDescription(desc);
    const hasDiscountCode = _isDiscountCodeType(code);

    // 2a) Quantità = 0 e prezzo ≠ 0 → sempre SCONTO
    if (qta === 0 && tot !== 0) {
      return 'SCONTO';
    }

    // 2b) Prezzo negativo + keyword/codice sconto → SCONTO
    if (tot < 0 && (hasDiscountKeyword || hasDiscountCode)) {
      return 'SCONTO';
    }

    // 2c) Codice tipo è esplicitamente sconto (indipendentemente da prezzo)
    if (hasDiscountCode && tot <= 0) {
      return 'SCONTO';
    }

    // 3) TESTO: Quantità = 0, prezzo = 0, nessuna keyword sconto
    if (qta === 0 && tot === 0 && !hasDiscountKeyword) {
      return 'TESTO';
    }

    // 4) ARTICOLO: default (prodotto normale con quantità e prezzo)
    return 'ARTICOLO';
  }

  // ============================================================
  // FINE HELPER TipoRiga
  // ============================================================

  /**
   * Aggiorna il costo unitario di un prodotto nel foglio Prodotti.
   * Utilizza PRODUCTS.calculateUnitCost() per calcolare €/KG o €/PZ.
   * Aggiorna anche RichiedeSetup se la configurazione è incompleta.
   * 
   * @param {string} codiceInterno - Codice interno del prodotto
   * @param {number} quantita - Quantità dalla fattura
   * @param {string} um - UM dalla fattura
   * @param {number} prezzoTotale - Prezzo totale riga fattura
   * @private
   */
  function _updateProductUnitCost(codiceInterno, quantita, um, prezzoTotale) {
    if (!codiceInterno || !quantita || !um || prezzoTotale === undefined) {
      return;
    }

    try {
      // Calcola costo unitario inline
      const costoUnitario = prezzoTotale / quantita;
      const umCosto = um;
      
      const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
      if (!sh) return;

      const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti);
      if (sh.getLastRow() <= headerRow) return;

      const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
      if (idx.CodiceInterno === undefined) return;

      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      const range = sh.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol);
      const values = range.getValues();

      for (let i = 0; i < values.length; i++) {
        const rowData = values[i];
        if (String(rowData[idx.CodiceInterno] || '').trim() === codiceInterno) {
          const targetRow = headerRow + 1 + i;
          let hasChanged = false;

          // Aggiorna CostoUnitario
          if (costoUnitario !== null && idx.CostoUnitario !== undefined) {
            // Arrotonda a 4 decimali per evitare scritture inutili per micro-differenze
            const roundedNewCost = parseFloat(costoUnitario.toFixed(4));
            const roundedOldCost = parseFloat(Number(rowData[idx.CostoUnitario] || 0).toFixed(4));
            if (roundedNewCost !== roundedOldCost) {
              rowData[idx.CostoUnitario] = roundedNewCost;
              hasChanged = true;
            }
          }

          // Aggiorna UMCosto
          if (umCosto && idx.UMCosto !== undefined) {
            if (rowData[idx.UMCosto] !== umCosto) {
              rowData[idx.UMCosto] = umCosto;
              hasChanged = true;
            }
          }

          // Aggiorna UltimoAgg solo se ci sono state modifiche
          if (hasChanged && idx.UltimoAgg !== undefined) {
            rowData[idx.UltimoAgg] = new Date();
          }

          // Scrivi l'intera riga in una sola operazione, solo se necessario
          if (hasChanged) {
            sh.getRange(targetRow, 1, 1, lastCol).setValues([rowData]);
            LOG?.debug('ROWS_UNIT_COST', `Aggiornato costo unitario per ${codiceInterno}`, {
              costoUnitario: rowData[idx.CostoUnitario],
              umCosto: rowData[idx.UMCosto]
            });
          }

          break; // Prodotto trovato, esci dal loop
        }
      }
    } catch (e) {
      // Aggiunge più contesto all'errore
      LOG?.error('ROWS_UNIT_COST', 'Errore aggiornamento costo unitario.', {
        codiceInterno,
        error: e.message,
        stack: e.stack,
        details: 'Questo errore può verificarsi per problemi di accesso concorrente al foglio. Il refactoring batch dovrebbe risolverlo.'
      });
      // Non rilanciare l'errore per non bloccare l'intero processo di importazione
    }
  }

  // ============================================================
  // MAIN LOGIC
  // ============================================================

  /**
   * Importa righe dettaglio fatture da XML, collegate al foglio Fatture.
   * 
   * Workflow:
   * 1. Filtra fatture con RigheImportate=FALSE dal foglio Fatture
   * 2. Per ogni fattura:
   *    a. Parse XML DettaglioLinee (NumeroLinea, Descrizione, Quantita, UnitaMisura, PrezzoTotale, AliquotaIVA)
   *    b. Classifica TipoRiga (_classifyRowType): ARTICOLO, SCONTO, OMAGGIO, TESTO
   *    c. Gestisce prodotti SENZA codice: assegna TipoRiga='ProdottoSenzaCodice'
   *    d. Chiama PRODUCTS.findOrCreateProduct() per creare/trovare CodiceInternoBreve
   *    e. Calcola CostoUnitario con PRODUCTS.calculateUnitCost() (conversioni UM)
   *    f. Copia DestReparto/Categoria da Fatture/Prodotti
   *    g. Scrive riga in Righe Fatture
   *    h. Marca fattura come RigheImportate=TRUE
   * 3. Prevenzione duplicati: cache FileId|NumeroLinea
   * 4. Gestione timeout: salva stato, riprendibile con prossima esecuzione
   * 
   * @param {boolean} [isSilent=false] - Se true, disabilita aggiornamenti UI progress
   * @returns {void}
   * @throws {Error} Se fogli Fatture/Prodotti/Righe non accessibili
   * 
   * @example
   * IMPORT_ROWS.run();
   */
  function run(isSilent = false) {
    if (!isSilent) STATE.clear(App.config.keys.progress);
    
    // Reset cache ad ogni import completo
    existingRowsCache = null;
    
    _mainLoop(isSilent);
  }

  /**
   * Carica tutte le chiavi FileID|NumeroLinea esistenti nel foglio Righe.
   * Usato per prevenire duplicati durante l'import.
   * @returns {Set<string>} Set di chiavi "FileID|NumeroLinea"
   */
  function _loadExistingRowsCache() {
    if (existingRowsCache !== null) {
      return existingRowsCache; // Cache già caricata
    }

    existingRowsCache = new Set();
    const shR = SHEETS.get(SHEETS.SHEET_NAMES.Righe);
    
    if (!shR) {
      LOG.warn('ROWS_DUP_CHECK', 'Foglio Righe non trovato. Cache duplicati vuota.');
      return existingRowsCache;
    }

    const lastRow = shR.getLastRow();
    const headerRow = SHEETS._findHeaderRow(shR, SHEETS.SHEET_NAMES.Righe);
    
    if (lastRow <= headerRow) {
      LOG.info('ROWS_DUP_CHECK', 'Foglio Righe vuoto. Cache duplicati vuota.');
      return existingRowsCache;
    }

    try {
      const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Righe);
      
      if (idx.FileID === undefined || idx.NumeroLinea === undefined) {
        LOG.warn('ROWS_DUP_CHECK', 'Colonne FileID/NumeroLinea non trovate. Prevenzione duplicati disattivata.');
        return existingRowsCache;
      }

      const maxCol = Math.max(idx.FileID, idx.NumeroLinea) + 1;
      const data = shR.getRange(headerRow + 1, 1, lastRow - headerRow, maxCol).getValues();
      
      data.forEach(row => {
        const fileId = String(row[idx.FileID] || '').trim();
        const numeroLinea = String(row[idx.NumeroLinea] || '').trim();
        
        if (fileId && numeroLinea) {
          const key = `${fileId}|${numeroLinea}`;
          existingRowsCache.add(key);
        }
      });

      LOG.info('ROWS_DUP_CHECK', `Cache duplicati caricata: ${existingRowsCache.size} righe esistenti.`);
    } catch (e) {
      LOG.error('ROWS_DUP_CHECK', 'Errore caricamento cache duplicati.', { error: e.message });
    }

    return existingRowsCache;
  }

  /**
   * Costruisce una Hash Map O(1) per lookup prodotti istantaneo.
   * Chiave: FornitoreID|CodiceProdottoNormalizzato
   * Valore: Oggetto prodotto completo
   * 
   * @param {Object} productCache - Cache prodotti da PRODUCTS.primeCache()
   * @returns {Map<string, Object>} Hash map per lookup O(1)
   * @private
   */
  function _buildProductHashMap(productCache) {
    const hashMap = new Map();
    
    if (!productCache || !productCache.byFornitoreCodice) {
      LOG.warn('PRODUCTS_HASH_MAP', 'Product cache vuota, hash map sarà vuota.');
      return hashMap;
    }

    // Copia diretta dalla cache byFornitoreCodice (già indicizzata per FornitoreID|Codice)
    for (const [key, product] of productCache.byFornitoreCodice.entries()) {
      hashMap.set(key, product);
    }

    LOG.info('PRODUCTS_HASH_MAP', `Hash Map costruita: ${hashMap.size} prodotti indicizzati per lookup O(1).`);
    return hashMap;
  }

  /**
   * Batch parsing XML: estrae tutte le righe da un XML in array di oggetti plain.
   * Separazione Fase 1 (parsing) da Fase 2 (business logic).
   * 
   * @param {string} fileId - Drive File ID dell'XML fattura
   * @returns {{success: boolean, rows: Array<Object>, error: string}} Risultato parsing
   * @private
   */
  function _parseXmlBatch(fileId) {
    const result = { success: false, rows: [], error: '' };

    try {
      const doc = XMLSAFE.parseDriveXml(fileId);
      if (!doc) {
        result.error = 'Parsing XML fallito';
        return result;
      }

      const root = doc.getRootElement();
      const body = UTIL.firstChild(root, 'FatturaElettronicaBody');
      const datiBeniServizi = UTIL.firstChild(body, 'DatiBeniServizi');

      const dettaglioLinee = datiBeniServizi
        ? (datiBeniServizi.getChildren() || []).filter(n => n.getName && n.getName() === 'DettaglioLinee')
        : [];

      if (dettaglioLinee.length === 0) {
        result.success = true; // Successo, ma nessuna riga
        return result;
      }

      // Estrai dati XML in array di plain objects
      for (const linea of dettaglioLinee) {
        const codiceArticolo = UTIL.firstChild(linea, 'CodiceArticolo');
        const codiceValoreRaw = codiceArticolo ? UTIL.firstText(codiceArticolo, 'CodiceValore') : '';
        const codiceTipo = codiceArticolo ? (UTIL.firstText(codiceArticolo, 'CodiceTipo') || '') : '';
        const descrizione = UTIL.firstText(linea, 'Descrizione') || '';
        const um = UTIL.firstText(linea, 'UnitaMisura');
        const numeroLinea = UTIL.firstText(linea, 'NumeroLinea');
        const qta = UTIL.parseNumSmart(UTIL.firstText(linea, 'Quantita'));
        const prezzoUnit = UTIL.parseNumSmart(UTIL.firstText(linea, 'PrezzoUnitario'));
        const prezzoTotaleRiga = UTIL.parseNumSmart(UTIL.firstText(linea, 'PrezzoTotale'));
        const aliquota = UTIL.parseNumSmart(UTIL.firstText(linea, 'AliquotaIVA'));

        // Genera codice TEMP se mancante (logica stabile)
        let codiceValore;
        let isTempGenerated = false;
        if (codiceValoreRaw) {
          codiceValore = codiceValoreRaw;
        } else {
          const descrizionePulita = (descrizione || '').replace(/\s/g, '').toUpperCase();
          codiceValore = `TEMP_${descrizionePulita.substring(0, 15)}`;
          isTempGenerated = true;
        }

        result.rows.push({
          numeroLinea,
          codiceValore,
          codiceTipo,
          descrizione,
          um,
          qta,
          prezzoUnit,
          prezzoTotaleRiga,
          aliquota,
          isTempGenerated
        });
      }

      result.success = true;
    } catch (e) {
      result.error = e.message;
      LOG.error('XML_BATCH_PARSE', `Errore parsing batch XML ${fileId}`, { error: e.message });
    }

    return result;
  }

  /**
   * Legge le parole chiave da ignorare dal foglio 'Filtro Righe Spazzatura'.
   * @returns {Set<string>} Un Set di parole chiave in minuscolo.
   */
  function _getJunkKeywords() {
    const junkSet = new Set();
    const sheetName = SHEETS.SHEET_NAMES.Filtro_Righe_Spazzatura;
    const sh = SHEETS.get(sheetName);
    
    if (!sh) {
      LOG.warn('ROWS_JUNK_FILTER', `Foglio ${sheetName} non trovato. Filtro righe spazzatura disattivato.`);
      return junkSet;
    }
    
    const headerRow = SHEETS._findHeaderRow(sh, sheetName);
    if (sh.getLastRow() <= headerRow) {
       LOG.info('ROWS_JUNK_FILTER', `Foglio ${sheetName} vuoto. Nessuna parola chiave caricata.`);
       return junkSet; // Foglio vuoto
    }

    try {
      const idx = SHEETS.headerIndex(sheetName);
      const colKey = 'ParolaChiaveDaIgnorare'; // Nome colonna dallo schema
      
      if (idx[colKey] === undefined) {
         LOG.error('ROWS_JUNK_FILTER', `Colonna '${colKey}' non trovata in ${sheetName}. Filtro disattivato.`);
         return junkSet;
      }
      
      const colIndex = idx[colKey];
      const data = sh.getRange(headerRow + 1, colIndex + 1, sh.getLastRow() - headerRow, 1).getValues();
      
      data.forEach(([keyword]) => {
        const kw = String(keyword || '').trim().toLowerCase();
        if (kw) junkSet.add(kw);
      });
      
      LOG.info('ROWS_JUNK_FILTER', `Caricate ${junkSet.size} parole chiave dal foglio ${sheetName}.`);
    } catch (e) {
      LOG.error('ROWS_JUNK_FILTER', `Errore lettura foglio ${sheetName}.`, { error: e.message });
    }
    return junkSet;
  }

  function _mainLoop(isSilent) {
    const runId = ENHANCED_LOGGER.generateRunId();
    ENHANCED_LOGGER.info(runId, 'IMPORT_ROWS_START', 'Inizio import righe', { isSilent });

    const startTime = new Date();
    const maxSec = CONFIG.get('MAX_RUNTIME_SEC', 240);

    const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    const shR = SHEETS.get(SHEETS.SHEET_NAMES.Righe);
    if (!shF || !shR) throw new Error("Fogli 'Fatture' o 'Righe' non trovati.");

    const headerRowF = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
    const idxF = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);

    const righeHeaders = SHEETS.SCHEMAS[SHEETS.SHEET_NAMES.Righe];
    if (!righeHeaders || righeHeaders.length === 0) {
      throw new Error("Schema Righe non trovato in SHEETS.SCHEMAS.");
    }
    
    ENHANCED_LOGGER.debug(runId, 'IMPORT_ROWS_SETUP', 'Header caricati', { 
      headerRowF, 
      righeHeadersCount: righeHeaders.length 
    });

    // Validazione indici critici
    const requiredKeys = [
      'FileID', 'FornitoreID', 'RigheImportate', 'ImportaRigheSrc',
      'TotImponibile', 'Famiglia', 'Categoria', 'Reparto', 'Sede', 'Data',
      'Anno', 'Mese', 'NumeroDoc', 'DenominazioneFornitore', 'TipoDoc'
    ];
    const missing = requiredKeys.filter(k => idxF[k] === undefined);
    if (missing.length > 0) {
      throw new Error("Colonne mancanti nel foglio Fatture: " + missing.join(', '));
    }
    const maxColNeeded = Math.max(...requiredKeys.map(k => idxF[k])) + 1;

    // Verifica colonne opzionali (nuove funzionalità)
    const optionalKeys = ['RigheImportateNum', 'TotRigheNetto'];
    const missingOptional = optionalKeys.filter(k => idxF[k] === undefined);
    if (missingOptional.length > 0) {
      LOG?.warn('ROWS_SETUP', `Colonne opzionali mancanti in Fatture (eseguire DEV_EnsureSheetsAndFormats): ${missingOptional.join(', ')}`);
    }

    // Carica filtro dinamico
    const junkKeywordsSet = _getJunkKeywords();
    const junkKeywordsArray = Array.from(junkKeywordsSet); // precompute per performance
    // Compila regex unica (case-insensitive) per match veloce delle parole chiave
    const _escapeRegex = s => String(s).replace(/[\-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const junkRegex = junkKeywordsArray.length ? new RegExp(junkKeywordsArray.map(_escapeRegex).join('|'), 'i') : null;
    ENHANCED_LOGGER.info(runId, 'IMPORT_ROWS_JUNK_FILTER', 'Filtro spazzatura caricato', { 
      junkKeywordsCount: junkKeywordsSet.size 
    });

    // Carica cache righe esistenti (prevenzione duplicati)
    const existingRows = _loadExistingRowsCache();
    ENHANCED_LOGGER.info(runId, 'IMPORT_ROWS_DUP_CACHE', 'Cache duplicati caricata', { 
      existingRowsCount: existingRows.size 
    });
    LOG?.info('ROWS_SETUP', `Prevenzione duplicati attiva. Righe esistenti in cache: ${existingRows.size}`);

    // Fornitori abilitati
    const suppliersData = _getSuppliersData();
    const enabledSupplierIds = new Set();
    suppliersData.forEach((data, id) => {
      if (data.importaRighe === true) {
        enabledSupplierIds.add(String(id).trim().replace(/^IT/i, '').replace(/^0+/, ''));
      }
    });
    ENHANCED_LOGGER.info(runId, 'IMPORT_ROWS_SUPPLIERS', 'Fornitori abilitati caricati', { 
      totalSuppliers: suppliersData.size,
      enabledSuppliers: enabledSupplierIds.size 
    });
    LOG?.info('ROWS', `Fornitori abilitati: ${enabledSupplierIds.size}`);

    // Cache prodotti
    const productCache = PRODUCTS.primeCache();

    // ✅ OTTIMIZZAZIONE: Costruisci Hash Map O(1) per lookup istantaneo
    const productHashMap = _buildProductHashMap(productCache);
    ENHANCED_LOGGER.info(runId, 'IMPORT_ROWS_HASH_MAP', 'Hash Map prodotti costruita', {
      productsIndexed: productHashMap.size
    });

    // Array temporaneo per nuovi prodotti (batch creation)
    const newProductsToCreate = [];

    // Cursor
    const CURSOR_KEY = App.config.keys.cursors.rows;
    const cursor = STATE.getJSON(CURSOR_KEY, { nextRow: headerRowF + 1 });
    let currentRow = Math.max(headerRowF + 1, Number(cursor.nextRow));
    const lastInvoiceRow = shF.getLastRow();

    if (currentRow > lastInvoiceRow) {
      if (!isSilent) SHARED_UTILS.showToast('Nessuna nuova riga da importare.', 'Info', 5);
      STATE.clear(CURSOR_KEY);
      return;
    }

    const rowsBuffer = [];
    const flagUpdates = {};
    let processedInvoices = 0;
    let skippedInvoices = 0;

    const CHUNK_SIZE = Number(CONFIG.get('ROWS_CHUNK_SIZE', 100)) || 100;
    const FLUSH_ROWS_EVERY = Number(CONFIG.get('ROWS_FLUSH_EVERY', 2000)) || 2000;

    // Stati finali che indicano fattura già processata CON righe scritte
    const finalStates = ['imported', 'total_mismatch'];

    if (!isSilent) {
      STATE.setJSON(App.config.keys.progress, {
        current: currentRow, total: lastInvoiceRow, message: 'Avvio import righe...'
      });
    }

    // REFACTORED: Use SHEET_ITERATOR for automatic chunk handling, timeout, progress
    const iteratorResult = SHEET_ITERATOR.forEachChunk({
      sheet: shF,
      sheetName: SHEETS.SHEET_NAMES.Fatture,
      startRow: currentRow,
      endRow: lastInvoiceRow,
      batchSize: CHUNK_SIZE,
      maxColumns: maxColNeeded,
      cursorKey: CURSOR_KEY,
      maxRuntimeSec: maxSec,
      onTimeout: () => {
        _flushAll(shR, rowsBuffer, shF, flagUpdates, productCache, headerRowF);
        LOG?.warn('ROWS', 'Timeout. Ripresa salvata.');
        if (!isSilent) {
          SHARED_UTILS.showToast('Timeout raggiunto. Clicca "Continua" per riprendere.', 'Pausa', 10);
        }
      },
      processChunk: (invoicesChunk, chunkStartRow) => {
        ENHANCED_LOGGER.debug(runId, 'IMPORT_ROWS_CHUNK_START', 'Inizio elaborazione chunk', {
          chunkStartRow,
          chunkSize: invoicesChunk.length
        });

        // Early-skip: se tutti i fornitori del chunk sono disabilitati, salta intero chunk
        let hasEnabledSupplier = false;
        for (let j = 0; j < invoicesChunk.length; j++) {
          const inv = invoicesChunk[j];
          const fid = String(inv[idxF.FornitoreID] ?? '').trim().replace(/^IT/i, '').replace(/^0+/, '');
          if (enabledSupplierIds.has(fid)) { hasEnabledSupplier = true; break; }
        }
        if (!hasEnabledSupplier) {
          for (let j = 0; j < invoicesChunk.length; j++) {
            const invRowNumJ = chunkStartRow + j;
            _addFlagUpdate(flagUpdates, invRowNumJ, idxF, {
              RigheImportate: false,
              ImportaRigheSrc: 'skipped'
            });
          }
          skippedInvoices += invoicesChunk.length;
          ENHANCED_LOGGER.debug(runId, 'IMPORT_ROWS_CHUNK_SKIP_DISABLED', 'Chunk saltato: tutti i fornitori disabilitati', {
            chunkStartRow,
            chunkSize: invoicesChunk.length
          });
          return; // niente da fare per questo chunk
        }

        // Elabora blocco
        for (let i = 0; i < invoicesChunk.length; i++) {
          const invData = invoicesChunk[i];
          const invRowNum = chunkStartRow + i;

          const fornitoreId = String(invData[idxF.FornitoreID] ?? '').trim().replace(/^IT/i, '').replace(/^0+/, '');
        const righeImportateFlag = invData[idxF.RigheImportate];
        const importaSrc = invData[idxF.ImportaRigheSrc];

        // 1. Se la fattura ha già righe importate con stato finale (imported/total_mismatch), non rielaborare
        if (righeImportateFlag === true && finalStates.includes(importaSrc)) {
          continue;
        }

        // 2. Fornitore abilitato/disabilitato
        if (enabledSupplierIds.has(fornitoreId)) {
          // Fornitore ABILITATO.
          // Processa la fattura; la funzione restituisce:
          //  - statusSrc: 'imported','total_mismatch','xml_error','processing_error','no_rows'
          //  - hasImportedRows: TRUE solo se sono state scritte righe in 'Righe'
          //  - importedRowsCount: numero righe scritte
          //  - sommaRigheNetto: somma PrezzoTotale righe
          const { statusSrc, hasImportedRows, importedRowsCount, sommaRigheNetto } = _processInvoice(
            invData,
            invRowNum,
            idxF,
            productCache,
            rowsBuffer,
            righeHeaders,
            junkRegex,
            existingRows,  // ✅ Cache duplicati
            runId,  // ✅ RunId per logging interno
            productHashMap,  // ✅ OTTIMIZZAZIONE: Hash Map O(1)
            newProductsToCreate  // ✅ OTTIMIZZAZIONE: Array batch nuovi prodotti
          );

          ENHANCED_LOGGER.info(runId, 'IMPORT_ROWS_INVOICE_PROCESSED', 'Fattura processata', {
            invRowNum,
            fileId: invData[idxF.FileID],
            statusSrc,
            importedRowsCount,
            sommaRigheNetto
          });

          _addFlagUpdate(flagUpdates, invRowNum, idxF, {
            RigheImportate: !!hasImportedRows,
            ImportaRigheSrc: statusSrc,
            RigheImportateNum: importedRowsCount || 0,
            TotRigheNetto: sommaRigheNetto || 0
          });

          processedInvoices++;
        } else {
          // Fornitore DISABILITATO.
          // Marca come 'skipped' ma lascia RigheImportate = FALSE
          // (TRUE significa sempre "righe esistono in Righe").
          ENHANCED_LOGGER.debug(runId, 'IMPORT_ROWS_SKIP_DISABLED', 'Fattura fornitore disabilitato', {
            invRowNum,
            fileId: invData[idxF.FileID],
            fornitoreId
          });
          _addFlagUpdate(flagUpdates, invRowNum, idxF, {
            RigheImportate: false,
            ImportaRigheSrc: 'skipped'
          });
          skippedInvoices++;
        }

        // Flush periodico
        if (rowsBuffer.length >= FLUSH_ROWS_EVERY) {
          _flushAll(shR, rowsBuffer, shF, flagUpdates, productCache, headerRowF);
        }
      }

      // UI progress update
      if (!isSilent && chunkStartRow % (CHUNK_SIZE * 2) === 0) {
        const progressRow = Math.min(chunkStartRow + invoicesChunk.length - 1, lastInvoiceRow);
        STATE.setJSON(App.config.keys.progress, {
          current: progressRow, total: lastInvoiceRow,
          message: `Importo righe: ${progressRow}/${lastInvoiceRow}...`
        });
        SHARED_UTILS.showToast(`Elaboro fattura ${progressRow}/${lastInvoiceRow}...`, 'Importazione Righe', 3);
      }
    }
    });

    // Check if iterator was interrupted by timeout
    if (iteratorResult.interrupted) {
      return;
    }

    // ✅ OTTIMIZZAZIONE: Batch creation nuovi prodotti (se accumulati)
    if (newProductsToCreate.length > 0) {
      ENHANCED_LOGGER.info(runId, 'IMPORT_ROWS_BATCH_CREATE', 'Avvio batch creation nuovi prodotti', {
        newProductsCount: newProductsToCreate.length
      });
      LOG?.info('ROWS_BATCH_CREATE', `Creazione batch di ${newProductsToCreate.length} nuovi prodotti...`);
      
      try {
        // ✅ Chiamata batch creation ottimizzata
        const createdProducts = PRODUCTS.createBatch(newProductsToCreate, productCache, runId);
        
        // ✅ Aggiorna Hash Map con nuovi prodotti creati
        createdProducts.forEach(product => {
          if (product.lookupKey) {
            productHashMap.set(product.lookupKey, product);
            ENHANCED_LOGGER.debug(runId, 'IMPORT_ROWS_HASH_UPDATE', 'Hash Map aggiornata con nuovo prodotto', {
              lookupKey: product.lookupKey,
              codiceInternoBreve: product.codiceInternoBreve
            });
          }
        });
        
        ENHANCED_LOGGER.info(runId, 'IMPORT_ROWS_BATCH_CREATE_DONE', 'Batch creation completata', {
          productsCreated: createdProducts.length,
          hashMapUpdated: true
        });
        LOG?.info('ROWS_BATCH_CREATE', `Creati ${createdProducts.length} nuovi prodotti. Hash Map aggiornata.`);
      } catch (e) {
        LOG?.error('ROWS_BATCH_CREATE', 'Errore batch creation prodotti.', { 
          error: e.message, 
          stack: e.stack,
          productsCount: newProductsToCreate.length 
        });
        ENHANCED_LOGGER.error(runId, 'IMPORT_ROWS_BATCH_CREATE_ERROR', 'Errore batch creation', {
          error: e.message,
          productsCount: newProductsToCreate.length
        });
      }
    }

    // Scrittura finale
    _flushAll(shR, rowsBuffer, shF, flagUpdates, productCache, headerRowF);
    STATE.clear(CURSOR_KEY);
    
    ENHANCED_LOGGER.info(runId, 'IMPORT_ROWS_COMPLETE', 'Importazione righe completata', {
      processedInvoices,
      skippedInvoices,
      totalInvoices: processedInvoices + skippedInvoices
    });

    if (!isSilent) {
      STATE.clear(App.config.keys.progress);
      const message = `Importazione righe completata.\n\nFatture processate: ${processedInvoices}\nFatture saltate: ${skippedInvoices}`;
      // UTIL.showModalDialog('Importazione Completata', message); // Rimosso per evitare errori in esecuzione non interattiva
      LOG?.info('ROWS_COMPLETE', message);
    }

    LOG?.info('ROWS', `Importazione righe completata. Processate: ${processedInvoices}, Saltate: ${skippedInvoices}.`);
  }

  /**
   * Processa le righe di una singola fattura.
   * OTTIMIZZATO: Usa Hash Map O(1) per lookup prodotti, parsing XML batch separato.
   * 
   * Ritorna:
   *  - statusSrc: 'imported','total_mismatch','xml_error','processing_error','no_rows'
   *  - hasImportedRows: TRUE solo se sono state scritte righe in rowsBuffer
   *  - importedRowsCount: numero di righe scritte nel buffer per quella fattura
   *  - sommaRigheNetto: somma PrezzoTotale delle righe importate
   */
  function _processInvoice(invData, invRowNum, idxF, productCache, rowsBuffer, righeHeaders, junkRegex, existingRows, runId, productHashMap, newProductsToCreate) {
    const fileId = invData[idxF.FileID];
    
    ENHANCED_LOGGER.debug(runId, 'IMPORT_ROWS_INVOICE_START', 'Inizio processamento fattura', {
      invRowNum,
      fileId
    });

    let statusSrc = 'imported'; // Default a successo

    const famigliaFornitore = invData[idxF.Famiglia];
    const categoriaFornitore = invData[idxF.Categoria];

    let sommaRigheImportate = 0; // Somma solo delle righe che verranno scritte
    let sommaTotaleRighe = 0; // Somma di TUTTE le righe, per il controllo finale
    let importedRowsCount = 0;
    let skippedDuplicates = 0;
    const imponibileFattura = UTIL.parseNumSmart(invData[idxF.TotImponibile]);
    const TOLLERANZA_EURO = Number(CONFIG.get('ROWS_TOLLERANZA_EURO', 1.00)) || 1.00;

    try {
      // ✅ FASE 1: Batch XML Parsing (separato dalla business logic)
      const parseResult = _parseXmlBatch(fileId);
      
      if (!parseResult.success) {
        statusSrc = 'xml_error';
        throw new Error(parseResult.error || 'Parsing XML fallito.');
      }

      const parsedRows = parseResult.rows;

      if (parsedRows.length === 0) {
        statusSrc = 'no_rows';
        if (Math.abs(imponibileFattura) > TOLLERANZA_EURO) {
          statusSrc = 'total_mismatch';
          LOG?.warn('ROWS_TOTAL_CHECK', `Discrepanza: Imponibile=${imponibileFattura} ma nessuna riga.`, { fileId });
        }
      } else {
        // ✅ FASE 2: Business Logic (su array di plain objects)
        const tipiDaEscludere = ['SCONTO', 'TESTO', 'OMAGGIO'];
        const fornitoreIdNorm = String(invData[idxF.FornitoreID] || '').trim().replace(/^IT/i, '').replace(/^0+/, '');

        for (const rowData of parsedRows) {
          const { numeroLinea, codiceValore, codiceTipo, descrizione, um, qta, prezzoUnit, prezzoTotaleRiga, aliquota, isTempGenerated } = rowData;
          
          if (!descrizione) {
            continue; // Salta righe senza descrizione
          }
          
          const isJunk = junkRegex ? junkRegex.test(String(descrizione)) : false;
          const codiceValoreForzato = UTIL.forceText(codiceValore);

          if (isTempGenerated) {
            ENHANCED_LOGGER.debug(runId, 'IMPORT_ROWS_TEMP_CODE', 'Codice TEMP generato', {
              fileId,
              descrizione: descrizione.substring(0, 50),
              codiceValore
            });
          }

          // Somma sempre al totale per il controllo di coerenza
          sommaTotaleRighe += prezzoTotaleRiga;

          // ✅ CONTROLLO DUPLICATI: Skip se riga già esiste (numeroLinea già estratto da rowData)
          const duplicateKey = `${fileId}|${numeroLinea}`;
          
          if (existingRows && existingRows.has(duplicateKey)) {
            skippedDuplicates++;
            ENHANCED_LOGGER.debug(runId, 'IMPORT_ROWS_DUP_SKIP', 'Riga duplicata skippata', {
              fileId,
              numeroLinea
            });
            continue; // ✅ Salta questa riga (già importata in precedenza)
          }

          // ✅ CALCOLO TIPORIGA - LOGICA ROBUSTA MULTI-FORNITORE
          const tipoRiga = _classifyRowType(qta, prezzoTotaleRiga, descrizione, codiceTipo);
          
          ENHANCED_LOGGER.debug(runId, 'IMPORT_ROWS_CLASSIFY', 'TipoRiga classificato', {
            fileId,
            numeroLinea,
            tipoRiga,
            qta,
            prezzoTotaleRiga
          });

          // >>> NUOVA LOGICA DI ESCLUSIONE <<<
          // Escludi righe spazzatura o tipi non desiderati (SCONTO, TESTO, OMAGGIO)
          const deveEssereEsclusa = isJunk || tipiDaEscludere.includes(tipoRiga);

          if (deveEssereEsclusa) {
            ENHANCED_LOGGER.debug(runId, 'IMPORT_ROWS_EXCLUDED', 'Riga esclusa', {
              fileId,
              numeroLinea,
              reason: isJunk ? 'junk' : tipoRiga,
              descrizione: descrizione.substring(0, 50)
            });
            continue; // Salta la riga, non verrà importata
          }
          // >>> FINE LOGICA DI ESCLUSIONE <<<

          // Da qui in poi, la riga è valida e verrà importata.
          sommaRigheImportate += prezzoTotaleRiga;

          // ✅ OTTIMIZZAZIONE: Lookup prodotti O(1) con Hash Map
          let codiceInterno = null;
          let codiceInternoBreve = null;
          if (tipoRiga === 'ARTICOLO') { // Omaggio è già escluso sopra
            // Normalizza codice fornitore per lookup
            const codiceNorm = String(codiceValore || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            const lookupKey = `${fornitoreIdNorm}|${codiceNorm}`;
            
            // Lookup O(1) nella Hash Map
            let foundProduct = productHashMap.get(lookupKey);
            
            if (foundProduct) {
              // Prodotto trovato in cache
              codiceInternoBreve = foundProduct.codiceInternoBreve;
              codiceInterno = foundProduct.codiceInterno || codiceInternoBreve; // Legacy fallback
              
              ENHANCED_LOGGER.debug(runId, 'IMPORT_ROWS_PRODUCT_FOUND', 'Prodotto trovato O(1)', {
                fileId,
                numeroLinea,
                lookupKey,
                codiceInternoBreve
              });
            } else if (!codiceValore.startsWith('TEMP_')) {
              // Prodotto NON trovato e NON è codice temporaneo → accumula per batch creation
              const newProduct = {
                fornitoreId: invData[idxF.FornitoreID],
                denominazioneFornitore: invData[idxF.DenominazioneFornitore],
                codiceValore,
                descrizione,
                um,
                categoriaFornitore,
                lookupKey // Per aggiornare Hash Map dopo creazione
              };
              newProductsToCreate.push(newProduct);
              
              // ✅ Genera codice temporaneo per questa riga (verrà sostituito dopo batch creation)
              // Per ora assegna codice placeholder per permettere import riga
              codiceInternoBreve = `PENDING_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
              codiceInterno = codiceInternoBreve; // Legacy fallback
              
              ENHANCED_LOGGER.debug(runId, 'IMPORT_ROWS_PRODUCT_NEW', 'Nuovo prodotto accumulato per batch creation', {
                fileId,
                numeroLinea,
                codiceValore,
                descrizione: descrizione.substring(0, 50),
                codicePending: codiceInternoBreve
              });
              
              // ⚠️ NOTA: Codice PENDING verrà sostituito con codice reale dopo batch creation
              // In alternativa, skippa questa riga e re-importa fattura dopo batch creation
            } else {
              // Codice TEMP: non creare prodotto, logga warning
              ENHANCED_LOGGER.warn(runId, 'IMPORT_ROWS_TEMP_SKIP', 'Prodotto con codice TEMP skippato', {
                fileId,
                numeroLinea,
                codiceValore
              });
              continue; // Skip righe con codice temporaneo
            }
          }

          // ✅ CALCOLO COSTO UNITARIO (solo per ARTICOLO con prezzo positivo)
          if (tipoRiga === 'ARTICOLO' && prezzoTotaleRiga > 0 && qta > 0 && codiceInternoBreve) {
            _updateProductUnitCost(codiceInternoBreve, qta, um, prezzoTotaleRiga);
          }

          // Mappa i dati secondo lo schema
          const dataDoc = invData[idxF.Data];
          
          const outputRowData = {
            'FileID': invData[idxF.FileID],
            'Sede': invData[idxF.Sede],
            'DataDoc': dataDoc,
            'Anno': invData[idxF.Anno],
            'Mese': invData[idxF.Mese],
            'NumeroDoc': invData[idxF.NumeroDoc],
            'FornitoreID': invData[idxF.FornitoreID],
            'DenominazioneFornitore': invData[idxF.DenominazioneFornitore],
            'Famiglia': famigliaFornitore,
            'Categoria': categoriaFornitore,
            'Reparto': invData[idxF.Reparto],
            'NumeroLinea': numeroLinea,
            'CodiceInternoBreve': codiceInternoBreve || '',
            'Codice Articolo Fornitore': codiceValoreForzato, // Mantiene il codice originale per tracciabilità
            'CodiceTipo': codiceTipo,
            'CodiceValore': codiceValoreForzato, // Mantiene il codice originale per tracciabilità
            'Descrizione': descrizione,
            'Quantita': qta,
            'PrezzoUnitario': prezzoUnit,
            'PrezzoTotale': prezzoTotaleRiga,
            'AliquotaIVA': String(aliquota),
            'TipoRiga': tipoRiga
          };

              const row = righeHeaders.map(header => {
             const dataKey = String(header).replace(/ /g, '').replace('ArticoloFornitore', 'ArticoloFornitore');
             return (outputRowData[header] !== undefined) ? outputRowData[header] : 
               (outputRowData[dataKey] !== undefined ? outputRowData[dataKey] : '');
              });
          
          // ✅ VALIDAZIONE FINALE: Verifica che la riga non sia vuota
          const isValidRow = (
            tipoRiga === 'ARTICOLO' && 
            codiceInternoBreve && 
            descrizione && 
            qta > 0
          );
          
          if (!isValidRow) {
            ENHANCED_LOGGER.warn(runId, 'IMPORT_ROWS_INVALID', 'Riga invalida skippata', {
              fileId,
              numeroLinea,
              tipoRiga,
              hasCodiceInterno: !!codiceInternoBreve,
              hasDescrizione: !!descrizione,
              qta
            });
            continue; // Salta questa riga vuota
          }
          
          // Logging centralizzato: riga valida aggiunta al buffer
          ENHANCED_LOGGER.debug(runId, 'IMPORT_ROWS_ROW_ADDED', 'Riga aggiunta al buffer', {
            fileId,
            numeroLinea,
            codiceInternoBreve,
            prezzoTotaleRiga,
            isTempCode: isTempGenerated
          });
          
          rowsBuffer.push(row);
          importedRowsCount++;
          
          // ✅ Aggiungi riga alla cache (prevenzione duplicati futuri nello stesso import)
          if (existingRows) {
            existingRows.add(duplicateKey);
          }
        } // fine loop for

        // Controllo totali
        if (Math.abs(sommaTotaleRighe - imponibileFattura) > TOLLERANZA_EURO) {
          statusSrc = 'total_mismatch';
          LOG?.warn(
            'ROWS_TOTAL_CHECK',
            `Mismatch > ${TOLLERANZA_EURO}€. Somma TUTTE le righe=${sommaTotaleRighe}, Imponibile fattura=${imponibileFattura}`,
            { fileId }
          );
        }
      }
    } catch (e) {
      statusSrc = 'processing_error';
      LOG?.error('ROWS', `Errore processamento righe per file ${fileId}`, { error: e.message, stack: e.stack });
    } finally {
      // Ignora mismatch per Parcelle e Note di Credito
      if (statusSrc === 'total_mismatch') {
        const docType = String(invData[idxF.TipoDoc] ?? '').toLowerCase();
        if (docType.includes('parcella') || docType.includes('nota di credito')) {
          statusSrc = 'imported'; // Consideralo importato con successo
          LOG?.info('ROWS_TOTAL_CHECK_IGNORE', `Discrepanza totali ignorata per ${docType}.`, { fileId });
        }
      }
    }

    // ✅ Log duplicati skippati
    if (skippedDuplicates > 0) {
      ENHANCED_LOGGER.info(runId, 'IMPORT_ROWS_DUP_SUMMARY', 'Duplicati skippati totali per fattura', {
        fileId,
        skippedDuplicates
      });
      LOG?.info('ROWS_DUP_SKIP', `Skippate ${skippedDuplicates} righe duplicate per fattura ${fileId}`);
    }

    ENHANCED_LOGGER.info(runId, 'IMPORT_ROWS_INVOICE_END', 'Fine processamento fattura', {
      fileId,
      statusSrc,
      importedRowsCount,
      sommaRigheNetto: sommaRigheImportate,
      skippedDuplicates
    });

    const hasImportedRows = importedRowsCount > 0;
    return { statusSrc, hasImportedRows, importedRowsCount, sommaRigheNetto: sommaRigheImportate };
  }

  // Scrive buffer righe + aggiorna flag + flush prodotti
  function _flushAll(shR, rowsBuffer, shF, flagUpdates, productCache, headerRowF) {
    if (rowsBuffer.length > 0) {
      try {
        const headerRowR = SHEETS._findHeaderRow(shR, SHEETS.SHEET_NAMES.Righe);
        const startRow = Math.max(shR.getLastRow() + 1, headerRowR + 1);
        UTIL.writeBatched(shR, startRow, rowsBuffer);
        LOG?.info('ROWS_FLUSH', `Scritte ${rowsBuffer.length} nuove righe prodotto.`);
      } catch (e) {
        LOG?.error('ROWS_FLUSH', 'Errore scrittura batch righe prodotto.', { error: e.message });
      } finally {
        rowsBuffer.length = 0;
      }
    }

    const updatedFlags = UTIL.updateSheetInPlace(shF, flagUpdates, headerRowF);
    if (updatedFlags > 0) {
      LOG?.info('ROWS_FLUSH', `Aggiornati flag di stato per ${Object.keys(flagUpdates).length} fatture.`);
    }
    for (const key in flagUpdates) delete flagUpdates[key];

    PRODUCTS.flushNewRows(productCache);
  }

  // Funzione _addFlagUpdate
  function _addFlagUpdate(flagUpdates, rowNum, idx, updates) {
    if (!flagUpdates[rowNum]) flagUpdates[rowNum] = {};
    for (const key in updates) {
      const safeKey = key.replace(/ /g, '_');
      if (idx[safeKey] !== undefined) {
        flagUpdates[rowNum][idx[safeKey]] = updates[key];
      } else {
        // Ignora silenziosamente le colonne non ancora presenti (es. dopo deploy ma prima di DEV_EnsureSheetsAndFormats)
        // LOG?.warn('ROWS_FLAG_UPDATE', `Indice non trovato per aggiornare flag: ${key}`, { rowNum });
      }
    }
  }

  // Carica dati fornitori
  function _getSuppliersData() {
    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Fornitori);
    const suppliers = new Map();
    if (!sh) return suppliers;

    const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Fornitori);
    if (sh.getLastRow() < headerRow + 1) return suppliers;

    try {
      const idxForn = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fornitori);
      const data = sh.getRange(headerRow + 1, 1, sh.getLastRow() - headerRow, sh.getLastColumn()).getValues();

      data.forEach(row => {
        const rawId = row[idxForn.FornitoreID];
        if (!rawId && rawId !== 0) return;

        const normalizedId = String(rawId).trim().replace(/^IT/i, '').replace(/^0+/, '');
        const rawImportFlag = row[idxForn.ImportaRighe];

        const importaRighe =
          (rawImportFlag === true) ||
          (String(rawImportFlag).trim().toLowerCase() === 'true') ||
          (String(rawImportFlag).trim().toLowerCase() === 'vero') ||
          (String(rawImportFlag).trim() === '1');

        suppliers.set(normalizedId, {
          nome: row[idxForn.Denominazione] || '',
          famiglia: row[idxForn.Famiglia] || '',
          categoria: row[idxForn.Categoria] || '',
          importaRighe
        });
      });
    } catch (e) {
      LOG?.error('ROWS_GET_SUPPLIERS', 'Errore lettura dati Fornitori.', { error: e.message });
    }
    return suppliers;
  }

  return { run };
})();

// Registra IMPORT_ROWS nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('IMPORT_ROWS', ['SHEETS', 'LOG', 'UTIL', 'SHARED_UTILS', 'PRODUCTS', 'STATE', 'CONFIG', 'SHEET_ITERATOR']);
}

// Registra IMPORT_ROWS nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('IMPORT_ROWS', IMPORT_ROWS);
}