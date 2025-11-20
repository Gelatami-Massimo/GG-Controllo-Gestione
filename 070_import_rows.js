// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 70_import_rows.js
// VERSIONE: 31.0 (Row Import + TipoRiga + Unit Cost Calculation)
// DESCRIZIONE: Importa le righe. Filtro righe "spazzatura" dinamico
//              • Logica di skip corretta (non blocca import futuri)
//              • RigheImportate = TRUE solo se le righe sono state scritte
//              • TipoRiga robusto: ARTICOLO, SCONTO, OMAGGIO, TESTO
//              • Calcolo costi unitari (€/KG, €/PZ) con conversioni UM
//              REFACTORED: Manual loop replaced with SHEET_ITERATOR.forEachChunk()
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
   * Classifica il tipo di riga secondo logica robusta multi-fornitore.
   * 
   * Regole:
   * 1. OMAGGIO: Quantità > 0 e PrezzoTotale = 0
   * 2. SCONTO: 
   *    - Quantità = 0 e PrezzoTotale ≠ 0, OPPURE
   *    - PrezzoTotale < 0 e descrizione/codice contiene keyword sconto, OPPURE
   *    - CodiceTipo è un codice sconto (SC, S, DSC)
   * 3. TESTO: Quantità = 0, PrezzoTotale = 0, nessuna keyword sconto
   * 4. ARTICOLO: default (Quantità > 0, PrezzoTotale > 0, non OMAGGIO)
   * 
   * @param {number} quantita - Quantità della riga
   * @param {number} prezzoTotale - Prezzo totale della riga
   * @param {string} descrizione - Descrizione della riga
   * @param {string} codiceTipo - CodiceTipo (se presente)
   * @returns {string} "ARTICOLO" | "SCONTO" | "OMAGGIO" | "TESTO"
   * 
   * @example
   * // ARTICOLO: Prodotto normale
   * _classifyRowType(10, 15.00, "Latte Intero 1L", "ART")
   * // → "ARTICOLO"
   * 
   * @example
   * // OMAGGIO: Quantità positiva ma prezzo zero
   * _classifyRowType(5, 0, "Campione omaggio yogurt", "PROMO")
   * // → "OMAGGIO"
   * 
   * @example
   * // SCONTO: Quantità zero, prezzo negativo
   * _classifyRowType(0, -5.00, "Sconto cliente fedele", "")
   * // → "SCONTO"
   * 
   * @example
   * // SCONTO: Prezzo negativo con keyword
   * _classifyRowType(1, -2.50, "APPLICAZIONE SCONTI PIEDE", "")
   * // → "SCONTO"
   * 
   * @example
   * // SCONTO: CodiceTipo esplicito
   * _classifyRowType(0, -10.00, "Riduzione per volume", "SC")
   * // → "SCONTO"
   * 
   * @example
   * // TESTO: Nota senza valore economico
   * _classifyRowType(0, 0, "Consegna prevista: 15/11/2025", "")
   * // → "TESTO"
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
      const costData = PRODUCTS.calculateUnitCost(codiceInterno, quantita, um, prezzoTotale);
      if (!costData) return;

      const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
      if (!sh) return;

      const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti);
      if (sh.getLastRow() <= headerRow) return;

      const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
      if (idx.CodiceInterno === undefined) return;

      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      const values = sh.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();

      for (let i = 0; i < values.length; i++) {
        const row = values[i];
        if (String(row[idx.CodiceInterno] || '').trim() === codiceInterno) {
          const targetRow = headerRow + 1 + i;
          const updates = [];

          // Aggiorna CostoUnitario
          if (costData.costoUnitario !== null && idx.CostoUnitario !== undefined) {
            updates.push({ col: idx.CostoUnitario + 1, value: costData.costoUnitario });
          }

          // Aggiorna UMCosto
          if (costData.umCosto && idx.UMCosto !== undefined) {
            updates.push({ col: idx.UMCosto + 1, value: costData.umCosto });
          }

          // Aggiorna RichiedeSetup
          if (idx.RichiedeSetup !== undefined) {
            updates.push({ col: idx.RichiedeSetup + 1, value: costData.richiedeSetup });
          }

          // Aggiorna UltimoAgg
          if (idx.UltimoAgg !== undefined) {
            updates.push({ col: idx.UltimoAgg + 1, value: new Date() });
          }

          // Scrivi tutti gli aggiornamenti
          updates.forEach(update => {
            sh.getRange(targetRow, update.col).setValue(update.value);
          });

          LOG?.debug('ROWS_UNIT_COST', `Aggiornato costo unitario per ${codiceInterno}`, {
            costoUnitario: costData.costoUnitario,
            umCosto: costData.umCosto,
            richiedeSetup: costData.richiedeSetup
          });

          break;
        }
      }
    } catch (e) {
      LOG?.error('ROWS_UNIT_COST', 'Errore aggiornamento costo unitario.', {
        codiceInterno,
        error: e.message,
        stack: e.stack
      });
    }
  }

  // ============================================================
  // MAIN LOGIC
  // ============================================================

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

    // Carica cache righe esistenti (prevenzione duplicati)
    const existingRows = _loadExistingRowsCache();
    LOG?.info('ROWS_SETUP', `Prevenzione duplicati attiva. Righe esistenti in cache: ${existingRows.size}`);

    // Fornitori abilitati
    const suppliersData = _getSuppliersData();
    const enabledSupplierIds = new Set();
    suppliersData.forEach((data, id) => {
      if (data.importaRighe === true) {
        enabledSupplierIds.add(String(id).trim().replace(/^IT/i, '').replace(/^0+/, ''));
      }
    });
    LOG?.info('ROWS', `Fornitori abilitati: ${enabledSupplierIds.size}`);

    // Cache prodotti
    const productCache = PRODUCTS.primeCache();

    // Cursor
    const CURSOR_KEY = App.config.keys.cursors.rows;
    const cursor = STATE.getJSON(CURSOR_KEY, { nextRow: headerRowF + 1 });
    let currentRow = Math.max(headerRowF + 1, Number(cursor.nextRow));
    const lastInvoiceRow = shF.getLastRow();

    if (currentRow > lastInvoiceRow) {
      if (!isSilent) UTIL.showToast('Nessuna nuova riga da importare.', 'Info', 5);
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
          UTIL.showToast('Timeout raggiunto. Clicca "Continua" per riprendere.', 'Pausa', 10);
        }
      },
      processChunk: (invoicesChunk, chunkStartRow) => {
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
            junkKeywordsSet,
            existingRows  // ✅ Aggiungo cache duplicati
          );

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
        UTIL.showToast(`Elaboro fattura ${progressRow}/${lastInvoiceRow}...`, 'Importazione Righe', 3);
      }
    }
    });

    // Check if iterator was interrupted by timeout
    if (iteratorResult.interrupted) {
      return;
    }

    // Scrittura finale
    _flushAll(shR, rowsBuffer, shF, flagUpdates, productCache, headerRowF);
    STATE.clear(CURSOR_KEY);
    if (!isSilent) STATE.clear(App.config.keys.progress);

    LOG?.info('ROWS', `Importazione righe completata. Processate: ${processedInvoices}, Saltate: ${skippedInvoices}.`);
  }

  /**
   * Processa le righe di una singola fattura.
   * Ritorna:
   *  - statusSrc: 'imported','total_mismatch','xml_error','processing_error','no_rows'
   *  - hasImportedRows: TRUE solo se sono state scritte righe in rowsBuffer
   *  - importedRowsCount: numero di righe scritte nel buffer per quella fattura
   *  - sommaRigheNetto: somma PrezzoTotale delle righe importate
   */
  function _processInvoice(invData, invRowNum, idxF, productCache, rowsBuffer, righeHeaders, junkKeywordsSet, existingRows) {
    const fileId = invData[idxF.FileID];
    let statusSrc = 'imported'; // Default a successo

    const famigliaFornitore = invData[idxF.Famiglia];
    const categoriaFornitore = invData[idxF.Categoria];

    let sommaRigheNetto = 0;
    let importedRowsCount = 0;
    let skippedDuplicates = 0;  // ✅ Conta duplicati skippati
    const imponibileFattura = UTIL.parseNumSmart(invData[idxF.TotImponibile]);
    const TOLLERANZA_EURO = Number(CONFIG.get('ROWS_TOLLERANZA_EURO', 1.00)) || 1.00;

    try {
      const doc = XMLSAFE.parseDriveXml(fileId);
      if (!doc) {
        statusSrc = 'xml_error';
        throw new Error('Parsing XML fallito.');
      }

      const root = doc.getRootElement();
      const body = UTIL.firstChild(root, 'FatturaElettronicaBody');
      const datiBeniServizi = UTIL.firstChild(body, 'DatiBeniServizi');

      const dettaglioLinee = datiBeniServizi
        ? (datiBeniServizi.getChildren() || []).filter(n => n.getName && n.getName() === 'DettaglioLinee')
        : [];

      if (dettaglioLinee.length === 0) {
        statusSrc = 'no_rows';
        if (Math.abs(imponibileFattura) > TOLLERANZA_EURO) {
          statusSrc = 'total_mismatch';
          LOG?.warn('ROWS_TOTAL_CHECK', `Discrepanza: Imponibile=${imponibileFattura} ma nessuna riga.`, { fileId });
        }
      } else {
        // Converti il Set in Array una sola volta per usare .some()
        const junkKeywordsArray = Array.from(junkKeywordsSet);

        for (const linea of dettaglioLinee) {
          const descrizione = UTIL.firstText(linea, 'Descrizione') || '';
          
          if (!descrizione) {
            continue; // Salta righe senza descrizione
          }
          
          const descLower = descrizione.toLowerCase();
          const isJunk = junkKeywordsArray.some(keyword => descLower.includes(keyword));

          const codiceArticolo = UTIL.firstChild(linea, 'CodiceArticolo');
          const codiceValoreRaw = codiceArticolo ? UTIL.firstText(codiceArticolo, 'CodiceValore') : '';
          const codiceTipo = codiceArticolo ? (UTIL.firstText(codiceArticolo, 'CodiceTipo') || '') : '';

          const um = UTIL.firstText(linea, 'UnitaMisura');
          const codiceValoreForzato = UTIL.forceText(codiceValoreRaw);

          const qta = UTIL.parseNumSmart(UTIL.firstText(linea, 'Quantita'));
          const prezzoUnit = UTIL.parseNumSmart(UTIL.firstText(linea, 'PrezzoUnitario'));
          const prezzoTotaleRiga = UTIL.parseNumSmart(UTIL.firstText(linea, 'PrezzoTotale'));
          const aliquota = UTIL.parseNumSmart(UTIL.firstText(linea, 'AliquotaIVA'));

          sommaRigheNetto += prezzoTotaleRiga;

          // ✅ CONTROLLO DUPLICATI: Skip se riga già esiste
          const numeroLinea = UTIL.firstText(linea, 'NumeroLinea');
          const duplicateKey = `${fileId}|${numeroLinea}`;
          
          if (existingRows && existingRows.has(duplicateKey)) {
            skippedDuplicates++;
            continue; // ✅ Salta questa riga (già importata in precedenza)
          }

          // ✅ CALCOLO TIPORIGA - LOGICA ROBUSTA MULTI-FORNITORE
          const tipoRiga = _classifyRowType(qta, prezzoTotaleRiga, descrizione, codiceTipo);

          // ✅ Gestione Prodotti (SOLO per ARTICOLO/OMAGGIO e se non è spazzatura)
          let codiceInterno = null;
          if (!isJunk && (tipoRiga === 'ARTICOLO' || tipoRiga === 'OMAGGIO')) {
            codiceInterno = PRODUCTS.ensureProduct(
              invData[idxF.FornitoreID], invData[idxF.DenominazioneFornitore],
              codiceValoreRaw, descrizione, um, productCache, categoriaFornitore
            );
          }

          // ✅ CALCOLO COSTO UNITARIO (solo per ARTICOLO con prezzo positivo)
          if (tipoRiga === 'ARTICOLO' && prezzoTotaleRiga > 0 && qta > 0 && codiceInterno) {
            _updateProductUnitCost(codiceInterno, qta, um, prezzoTotaleRiga);
          }

          // Mappa i dati secondo lo schema
          const rowData = {
            'FileID': invData[idxF.FileID],
            'Sede': invData[idxF.Sede],
            'DataDoc': invData[idxF.Data],
            'Anno': invData[idxF.Anno],
            'Mese': invData[idxF.Mese],
            'NumeroDoc': invData[idxF.NumeroDoc],
            'FornitoreID': invData[idxF.FornitoreID],
            'DenominazioneFornitore': invData[idxF.DenominazioneFornitore],
            'Famiglia': famigliaFornitore,
            'Categoria': categoriaFornitore,
            'Reparto': invData[idxF.Reparto],
            'NumeroLinea': numeroLinea,
            'Codice Articolo Fornitore': codiceValoreForzato,
            'CodiceTipo': codiceTipo,
            'CodiceValore': codiceValoreForzato,
            'Descrizione': descrizione,
            'Quantita': qta,
            'PrezzoUnitario': prezzoUnit,
            'PrezzoTotale': prezzoTotaleRiga,
            'AliquotaIVA': String(aliquota),
            'TipoRiga': tipoRiga
          };

          const row = righeHeaders.map(header => {
             // Pulisce il nome dell'header per farlo corrispondere alle chiavi
             const dataKey = String(header).replace(/ /g, '').replace('ArticoloFornitore', 'ArticoloFornitore');
             return (rowData[header] !== undefined) ? rowData[header] : 
                   (rowData[dataKey] !== undefined ? rowData[dataKey] : '');
          });
          rowsBuffer.push(row);
          importedRowsCount++;
          
          // ✅ Aggiungi riga alla cache (prevenzione duplicati futuri nello stesso import)
          if (existingRows) {
            existingRows.add(duplicateKey);
          }
        } // fine loop for

        // Controllo totali
        if (Math.abs(sommaRigheNetto - imponibileFattura) > TOLLERANZA_EURO) {
          statusSrc = 'total_mismatch';
          LOG?.warn(
            'ROWS_TOTAL_CHECK',
            `Mismatch > ${TOLLERANZA_EURO}€. Somma righe=${sommaRigheNetto}, Imponibile fattura=${imponibileFattura}`,
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
      LOG?.info('ROWS_DUP_SKIP', `Skippate ${skippedDuplicates} righe duplicate per fattura ${fileId}`);
    }

    const hasImportedRows = importedRowsCount > 0;
    return { statusSrc, hasImportedRows, importedRowsCount, sommaRigheNetto };
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
  ModuleRegistry.register('IMPORT_ROWS', ['SHEETS', 'LOG', 'UTIL', 'PRODUCTS', 'STATE', 'CONFIG', 'SHEET_ITERATOR']);
}

// Registra IMPORT_ROWS nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('IMPORT_ROWS', IMPORT_ROWS);
}