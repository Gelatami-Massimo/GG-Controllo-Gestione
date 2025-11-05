// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 110_warehouse.js
// VERSIONE: 25 (Schema-aware write, netto quantità, ID fornitore allineati, conversioni UM robuste)
// DESCRIZIONE: Motore di calcolo magazzino.
// =============================================================

const WAREHOUSE = (function () {

  const SHEET_NAME = SHEETS.SHEET_NAMES.Magazzino;     // Usa la costante da SHEETS
  const RULES_SHEET_NAME = SHEETS.SHEET_NAMES.Regole_UM;

  /**
   * Carica dinamicamente le categorie escluse dal foglio Config.
   * Formato atteso in Config: "carne, bevande, ...".
   * @private
   */
  function _getExcludedCategories() {
    const rawConfig = CONFIG.get('CATEGORIE_ESCLUSE_MAGAZZINO', '');
    if (!rawConfig) return new Set();
    const excludedSet = new Set(
      String(rawConfig)
        .split(',')
        .map(cat => cat.trim().toLowerCase())
        .filter(Boolean)
    );
    LOG.debug('WAREHOUSE_CONFIG', `Categorie escluse: ${[...excludedSet].join(', ')}`);
    return excludedSet;
  }

  function create() {
    try {
      UTIL.showToast('Creazione/Aggiornamento Magazzino...', 'Magazzino', 15);

      // Assicura struttura
      SHEETS.ensureAll();

      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sh = ss.getSheetByName(SHEET_NAME);
      if (!sh) {
        sh = ss.insertSheet(SHEET_NAME);
        SHEETS._ensureHeaders(sh, SHEETS.SCHEMAS[SHEET_NAME], SHEET_NAME);
        LOG.info('WAREHOUSE_CREATE', `Foglio ${SHEET_NAME} creato.`);
      }

      // Calcolo
      const finalDataResult = _populateAndCalculate(); // { headers, data: object[] }

      // Scrittura
      _writeDataToSheet(sh, finalDataResult);

      // Formati
      SHEETS.applyFormats();

      ss.setActiveSheet(sh);
      UTIL.showToast('Magazzino aggiornato con successo!', 'Completato', 5);
    } catch (e) {
      LOG.error('WAREHOUSE_CREATE', 'Errore fatale during la creazione del magazzino.', { error: e.message, stack: e.stack });
      throw e;
    }
  }

  /**
   * Legge le regole di conversione dal foglio 'Regole_UM'.
   * @private
   */
  function _readConversionRules() {
    const rulesMap = new Map();
    const shRules = SHEETS.get(RULES_SHEET_NAME);
    if (!shRules) {
      LOG.warn('WAREHOUSE_RULES', `Foglio ${RULES_SHEET_NAME} non trovato.`);
      return rulesMap;
    }

    const headerRow = SHEETS._findHeaderRow(shRules, RULES_SHEET_NAME);
    if (shRules.getLastRow() <= headerRow) return rulesMap;

    try {
      const idx = SHEETS.headerIndex(RULES_SHEET_NAME);
      const weightColKey = 'Peso_per_Pezzo_(KG)';
      const piecesColKey = 'Pezzi_per_Unità';
      const umFinaleKey  = 'UM_Finale';

      if (idx.CodiceInterno === undefined || idx[piecesColKey] === undefined || idx[weightColKey] === undefined || idx[umFinaleKey] === undefined) {
        LOG.error('WAREHOUSE_RULES', `Colonne critiche mancanti in ${RULES_SHEET_NAME} (richieste: CodiceInterno, ${piecesColKey}, ${weightColKey}, ${umFinaleKey}).`);
        return rulesMap;
      }

      const numColsToRead = Math.max(idx.CodiceInterno, idx[piecesColKey], idx[weightColKey], idx[umFinaleKey]) + 1;
      const rulesData = shRules.getRange(headerRow + 1, 1, shRules.getLastRow() - headerRow, numColsToRead).getValues();

      rulesData.forEach(row => {
        const internalCode = String(row[idx.CodiceInterno] ?? '').trim();
        if (!internalCode) return;
        rulesMap.set(internalCode, {
          piecesPerUnit: row[idx[piecesColKey]],
          weightPerPiece: row[idx[weightColKey]],
          toUm: String(row[idx[umFinaleKey]] ?? '').trim()
        });
      });

      LOG.info('WAREHOUSE_RULES', `Caricate ${rulesMap.size} regole di conversione.`);
    } catch (e) {
      LOG.error('WAREHOUSE_RULES', `Errore lettura foglio ${RULES_SHEET_NAME}.`, { error: e.message, stack: e.stack });
    }
    return rulesMap;
  }

  /**
   * Popola l'inventario, applica regole e calcola standardizzazioni.
   * CORRETTO: Restituisce array di oggetti { 'Nome Colonna': valore, ... }
   * @private
   * @returns {{ headers: string[], data: object[] }}
   */
  function _populateAndCalculate() {
    const headers = SHEETS.SCHEMAS[SHEET_NAME];
    if (!headers || headers.length === 0) throw new Error(`Schema per il foglio ${SHEET_NAME} non definito.`);

    const conversionRules = _readConversionRules();
    const baseInventory = _calculateBaseInventory(); // Map<internalCode, { info, quantita, prezzo, um, ... }>
    const finalDataObjects = []; // Cambiato nome per chiarezza

    for (const [internalCode, data] of baseInventory.entries()) {
      const rule = conversionRules.get(internalCode) || {};

      const piecesPerUnit = UTIL.parseNumSmart(rule.piecesPerUnit);
      const weightPerPiece = UTIL.parseNumSmart(rule.weightPerPiece);
      const toUmRaw = rule.toUm;

      const umOriginale = data.um;
      const quantitaAcquistata = data.quantita;
      const ultimoPrezzoNetto = data.prezzo;

      const umFinale = toUmRaw || umOriginale;

      let quantitaStandard = quantitaAcquistata;
      let prezzoStandardizzato = ultimoPrezzoNetto;

      // Applica conversione per pezzi se definita
      if (piecesPerUnit > 0) {
        quantitaStandard *= piecesPerUnit;
        if (prezzoStandardizzato > 0) prezzoStandardizzato /= piecesPerUnit;
      }

      // Applica conversione per peso se definita E l'UM finale è KG
      if (weightPerPiece > 0 && String(umFinale).toUpperCase() === 'KG') {
        quantitaStandard *= weightPerPiece;
        if (prezzoStandardizzato > 0) prezzoStandardizzato /= weightPerPiece;
      }

      // --- CORREZIONE: Crea Oggetto ---
      const rowDataObject = {
        'Codice Interno': internalCode,
        'Denominazione Fornitore': data.fornitore,
        'Codice Articolo Fornitore': UTIL.forceText(data.codiceFornitore),
        'Descrizione': data.descrizione,
        'Categoria Prodotto': data.categoria,
        'Quantità Acquistata': quantitaAcquistata,
        'UM Originale': umOriginale,
        'Ultimo Prezzo Netto': ultimoPrezzoNetto,
        'Pezzi per Unità (Calc)': rule.piecesPerUnit ?? '',
        'Peso per Pezzo (KG) (Calc)': rule.weightPerPiece ?? '',
        'UM Finale (Calc)': umFinale,
        'Quantità Standard': quantitaStandard,
        'Prezzo Standardizzato': prezzoStandardizzato
      };
      // Assicurati che le chiavi qui sopra corrispondano *esattamente* ai nomi in SHEETS.SCHEMAS[SHEET_NAME]

      finalDataObjects.push(rowDataObject);
      // --- FINE CORREZIONE ---
    }

    // --- CORREZIONE: Ordina array di oggetti ---
    finalDataObjects.sort((a, b) => {
      // Usa i nomi esatti delle colonne/chiavi per l'ordinamento
      const keyFornitore = 'Denominazione Fornitore';
      const keyDescrizione = 'Descrizione';
      const c1 = String(a[keyFornitore]).localeCompare(String(b[keyFornitore]));
      return c1 !== 0 ? c1 : String(a[keyDescrizione]).localeCompare(String(b[keyDescrizione]));
    });
    // --- FINE CORREZIONE ---

    return { headers, data: finalDataObjects }; // Restituisce oggetti
  }

  /**
   * Aggrega quantità e determina l’ultimo prezzo valido per ogni prodotto.
   * Filtra categorie escluse e abbina Righe↔Prodotti su (FornitoreID normalizzato + Codice/Descrizione).
   * @private
   */
  function _calculateBaseInventory() {
    const excludedCategories = _getExcludedCategories();

    const productPurchases = new Map(); // K: internalCode -> { info, purchases: [{qty, price, date}] }
    const shProd  = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
    const shRighe = SHEETS.get(SHEETS.SHEET_NAMES.Righe);

    if (!shRighe || !shProd) {
      LOG.error('WAREHOUSE_CALC', 'Foglio Prodotti o Righe non trovato.');
      return new Map();
    }

    const headerProd  = SHEETS._findHeaderRow(shProd,  SHEETS.SHEET_NAMES.Prodotti);
    const headerRighe = SHEETS._findHeaderRow(shRighe, SHEETS.SHEET_NAMES.Righe);

    if (shRighe.getLastRow() <= headerRighe || shProd.getLastRow() <= headerProd) {
      LOG.warn('WAREHOUSE_CALC', 'Foglio Prodotti o Righe vuoto.');
      return new Map();
    }

    // --- 1) Mappa prodotti validi (non esclusi per categoria) ---
    const productKeyMap = new Map(); // K: fornID|codForn (o descr) -> info prodotto
    const idxProd = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
    const requiredProdCols = ['CodiceInterno', 'FornitoreID', 'CodiceFornitore', 'Descrizione', 'DenominazioneFornitore', 'UM', 'CategoriaProdotto'];
    for (const c of requiredProdCols) {
      if (idxProd[c] === undefined) throw new Error(`Colonna ${c} mancante in Prodotti, necessaria per Magazzino.`);
    }
    const lastColProd = Math.max(...requiredProdCols.map(c => idxProd[c])) + 1;

    try {
      const productData = shProd.getRange(headerProd + 1, 1, shProd.getLastRow() - headerProd, lastColProd).getValues();
      productData.forEach(r => {
        const categoria = String(r[idxProd.CategoriaProdotto] ?? '').trim().toLowerCase();
        if (excludedCategories.has(categoria)) return;

        // Normalizza FornitoreID come negli altri moduli: rimuovi prefisso IT e zeri
        const fornIdRaw = String(r[idxProd.FornitoreID] ?? '').trim();
        const fornIdNorm = fornIdRaw.replace(/^IT/i, '').replace(/^0+/, '').toUpperCase();
        if (!fornIdNorm) return;

        const codiceFornNorm = UTIL.normKey(r[idxProd.CodiceFornitore]);
        const descrNorm = UTIL.normKey(r[idxProd.Descrizione]);

        // Chiave di lookup: preferisce il codice fornitore se esiste
        const lookupKey = `${fornIdNorm}|${codiceFornNorm || descrNorm}`;
        if (lookupKey.endsWith('|')) return;

        // Preferisci la riga con CodiceFornitore non vuoto se la chiave è duplicata
        if (!productKeyMap.has(lookupKey) || codiceFornNorm) {
          productKeyMap.set(lookupKey, {
            internalCode: String(r[idxProd.CodiceInterno] ?? ''),
            fornitore: String(r[idxProd.DenominazioneFornitore] ?? ''),
            codiceFornitore: String(r[idxProd.CodiceFornitore] ?? ''),
            descrizione: String(r[idxProd.Descrizione] ?? ''),
            um: String(r[idxProd.UM] ?? 'PZ').trim() || 'PZ',
            categoria: String(r[idxProd.CategoriaProdotto] ?? '')
          });
        }
      });
      LOG.info('WAREHOUSE_CALC', `Prodotti attivi per magazzino: ${productKeyMap.size}`);
    } catch (e) {
      LOG.error('WAREHOUSE_CALC', 'Errore lettura Prodotti.', { error: e.message, stack: e.stack });
      return new Map();
    }

    // --- 2) Scorri Righe e abbina ai prodotti ---
    const idxRighe = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Righe);
    const requiredRigheCols = ['Descrizione', 'FornitoreID', 'CodiceValore', 'Quantita', 'PrezzoUnitario', 'DataDoc'];
    for (const c of requiredRigheCols) {
      if (idxRighe[c] === undefined) {
        LOG.error('WAREHOUSE_CALC', `Colonna ${c} mancante in Righe, necessaria per Magazzino.`);
        return new Map();
      }
    }
    const lastColRighe = Math.max(...requiredRigheCols.map(c => idxRighe[c])) + 1;

    try {
      const righeData = shRighe.getRange(headerRighe + 1, 1, shRighe.getLastRow() - headerRighe, lastColRighe).getValues();
      LOG.info('WAREHOUSE_CALC', `Lette ${righeData.length} righe dal foglio Righe.`);

      righeData.forEach((row) => {
        const descrizioneRiga = String(row[idxRighe.Descrizione] ?? '');
        const descLower = descrizioneRiga.toLowerCase();
        // Escludi sconti/omaggi/canvass dalla logica di magazzino
        if (descLower.includes('sconto') || descLower.includes('canvass') || descLower.includes('omaggio')) return;

        // Normalizza FornitoreID come altrove
        const fornIdRaw = String(row[idxRighe.FornitoreID] ?? '').trim();
        const fornIdNorm = fornIdRaw.replace(/^IT/i, '').replace(/^0+/, '').toUpperCase();
        if (!fornIdNorm) return;

        const codiceValoreNorm = UTIL.normKey(row[idxRighe.CodiceValore]);
        const descrNormRiga = UTIL.normKey(descrizioneRiga);
        // Chiave di lookup: usa il codice se presente, altrimenti la descrizione
        const lookupKeyRiga = `${fornIdNorm}|${codiceValoreNorm || descrNormRiga}`;
        if (lookupKeyRiga.endsWith('|')) return;

        const productInfo = productKeyMap.get(lookupKeyRiga);
        if (!productInfo?.internalCode) return; // non mappato/escluso

        // Quantità: includi anche negative (resi/NC) -> quantità netta
        const qty = UTIL.parseNumSmart(row[idxRighe.Quantita]);
        // Prezzo unitario (può essere negativo su NC; per il "last price" useremo solo > 0)
        const price = UTIL.parseNumSmart(row[idxRighe.PrezzoUnitario]);
        const date = row[idxRighe.DataDoc] instanceof Date ? row[idxRighe.DataDoc] : new Date(0);

        if (!productPurchases.has(productInfo.internalCode)) {
          productPurchases.set(productInfo.internalCode, {
            info: productInfo,
            purchases: []
          });
        }
        // Accetta sia qty > 0 che qty < 0 (netto); scarta solo qty == 0 e date invalide
        if (qty !== 0 && date.getFullYear() > 1970) {
          productPurchases.get(productInfo.internalCode).purchases.push({ qty, price, date });
        }
      });
    } catch (e) {
      LOG.error('WAREHOUSE_CALC', 'Errore lettura/processo Righe.', { error: e.message, stack: e.stack });
      return new Map();
    }

    // --- 3) Aggrega quantità e trova ultimo prezzo valido (>0) ---
    const finalInventory = new Map();
    for (const [internalCode, data] of productPurchases.entries()) {
      const purchases = data.purchases || [];
      if (purchases.length === 0) continue;

      const totalQty = purchases.reduce((s, p) => s + p.qty, 0); // qty netta

      // Ultimo prezzo > 0 per data DESC
      const lastPurchaseWithPrice = purchases
        .filter(p => p.price > 0)
        .sort((a, b) => b.date.getTime() - a.date.getTime())[0];

      finalInventory.set(internalCode, {
        fornitore: data.info.fornitore,
        codiceFornitore: data.info.codiceFornitore,
        descrizione: data.info.descrizione,
        categoria: data.info.categoria,
        um: data.info.um,
        quantita: totalQty,
        prezzo: lastPurchaseWithPrice ? lastPurchaseWithPrice.price : 0
      });
    }

    LOG.info('WAREHOUSE_CALC', `Inventario base calcolato per ${finalInventory.size} prodotti.`);
    return finalInventory;
  }

  /**
   * Scrive i dati calcolati nel foglio Magazzino.
   * CORRETTO: Mappa oggetti -> array usando l'ordine degli header.
   * @private
   */
  function _writeDataToSheet(sh, finalDataResult) {
    const { headers, data: dataObjects } = finalDataResult; // Riceve oggetti

    try { if (sh.getFilter()) sh.getFilter().remove(); } catch (_) {}
    sh.clearContents();
    sh.clearFormats();

    // Header (invariato)
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);

    if (dataObjects.length > 0) {
      // --- CORREZIONE: Mappa oggetti -> array bidimensionale ---
      const dataToWrite = dataObjects.map(obj => {
        return headers.map(header => (obj[header] !== undefined ? obj[header] : ''));
      });
      // --- FINE CORREZIONE ---

      sh.getRange(2, 1, dataToWrite.length, headers.length).setValues(dataToWrite); // Scrive l'array mappato
      try { sh.getDataRange().createFilter(); } catch (_) {}
      try { sh.autoResizeColumns(1, headers.length); } catch (e) {
        LOG.warn('WAREHOUSE_WRITE', 'Errore autoresize colonne Magazzino.', { error: e.message });
      }
    } else {
      sh.getRange('A2').setValue('Nessun dato inventariabile trovato (verifica categorie escluse in Config/Prodotti e corrispondenze con Righe).');
    }

    LOG.info('WAREHOUSE_WRITE', `Scritti ${dataObjects.length} prodotti in ${SHEET_NAME}.`);
  }

  return { create };
})();