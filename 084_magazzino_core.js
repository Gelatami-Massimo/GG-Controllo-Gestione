// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 084_magazzino_core.js
// RUOLO: Core magazzino unificato - genera vista per PRODOTTO e INGREDIENTE.
// NOTE: Legge RIGHE+PRODOTTI con JOIN, logica conversioni UM (PZxCT, KGxPZ).
// =============================================================

const MAGAZZINO_CORE = (() => {

  /**
   * Funzione interna: costruisce array base di righe da Righe + Prodotti.
   * @private
   * @param {Object} [dateFilter] - Filtro opzionale: {startDate: Date, endDate: Date}
   * @param {boolean} [filterByIngrediente=true] - Se TRUE filtra solo prodotti con Ingrediente valorizzato
   * @param {string} [runId=''] - RunId per logging granulare
   * @returns {Array} Array di oggetti rowBase con campi normalizzati
   */
  function buildMagazzinoBaseRows_(dateFilter = null, filterByIngrediente = true, runId = '') {
    if (runId) {
      LOG.info(runId, 'MAG_BUILD_START', 'Inizio costruzione righe magazzino', {
        filterByIngrediente,
        hasDateFilter: !!dateFilter
      });
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 1. Leggi foglio Prodotti
    const shProdotti = ss.getSheetByName('Prodotti');
    if (!shProdotti) {
      throw new Error('Foglio Prodotti non trovato.');
    }

    const lastRowProd = shProdotti.getLastRow();
    if (lastRowProd <= 1) {
      throw new Error('Foglio Prodotti vuoto.');
    }

    // 2. Leggi foglio Righe
    const shRighe = ss.getSheetByName('Righe');
    if (!shRighe) {
      throw new Error('Foglio Righe non trovato.');
    }

    const lastRowRighe = shRighe.getLastRow();
    if (lastRowRighe <= 1) {
      throw new Error('Foglio Righe vuoto.');
    }

    // 3. Costruisci mappa prodotti
    const { prodottiByKey, prodottiByKeyNoCode } = _buildProdottiMap(shProdotti, lastRowProd, filterByIngrediente, runId);
    LOG?.info('MAG_CORE', `Mappa prodotti costruita: ${prodottiByKey.size} con codice, ${prodottiByKeyNoCode.size} senza codice.`);
    
    if (runId) {
      LOG.info(runId, 'MAG_PRODUCT_MAP', 'Mappa prodotti costruita', {
        prodottiConCodice: prodottiByKey.size,
        prodottiSenzaCodice: prodottiByKeyNoCode.size
      });
    }
    
    // Logging già gestito da LOG in MAG_PRODUCT_MAP

    // 4. Processa righe fattura
    const rowsBase = _processRighe(shRighe, lastRowRighe, prodottiByKey, prodottiByKeyNoCode, dateFilter, runId);
    LOG?.info('MAG_CORE', `Righe base generate: ${rowsBase.length} righe.`);

    return rowsBase;
  }

  /**
   * Costruisce mappa prodotti da foglio Prodotti
   * @private
   * @param {boolean} [filterByIngrediente=true] - Se TRUE filtra solo prodotti con Ingrediente
   * @param {string} [runId=''] - RunId per logging
   * @returns {Object} { prodottiByKey: Map, prodottiByKeyNoCode: Map }
   */
  function _buildProdottiMap(shProdotti, lastRow, filterByIngrediente = true, runId = '') {
    const headers = shProdotti.getRange(1, 1, 1, shProdotti.getLastColumn()).getValues()[0];
    const idx = {};
    headers.forEach((h, i) => {
      const cleanHeader = String(h).trim();
      if (cleanHeader) idx[cleanHeader] = i;
    });

    // Verifica colonne necessarie
    const requiredCols = [
      'CodiceInterno', 'CodiceFornitore', 'Descrizione', 'UM',
      'FornitoreID', 'DenominazioneFornitore', 'CategoriaProdotto',
      'Ingrediente', 'NonInUso', 'UMBase', 'PZxCT', 'KGxPZ'
    ];
    const missingCols = requiredCols.filter(col => idx[col] === undefined);
    if (missingCols.length > 0) {
      throw new Error(`Colonne mancanti in Prodotti: ${missingCols.join(', ')}`);
    }

    const data = shProdotti.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const prodottiByKey = new Map();
    const prodottiByKeyNoCode = new Map();

    // Contatori debug
    let skippedNoFornitore = 0;
    let skippedNoIngrediente = 0;
    let skippedNonInUso = 0;
    let processed = 0;
    const nonInUsoSamples = []; // Sample di valori NonInUso per debug

    data.forEach(row => {
      const fornitoreID = String(row[idx.FornitoreID] || '').trim();
      const codiceFornitore = String(row[idx.CodiceFornitore] || '').trim();
      const codiceInterno = String(row[idx.CodiceInterno] || '').trim();
      const descrizione = String(row[idx.Descrizione] || '').trim();
      const um = String(row[idx.UM] || '').trim();
      const ingrediente = String(row[idx.Ingrediente] || '').trim();
      const nonInUso = row[idx.NonInUso];

      // Raccolta sample per debug (primi 5)
      if (nonInUsoSamples.length < 5) {
        nonInUsoSamples.push({
          codiceInterno,
          descrizione: descrizione.substring(0, 20),
          nonInUso,
          type: typeof nonInUso,
          stringValue: String(nonInUso)
        });
      }

      // Filtri base con contatori
      if (!fornitoreID) {
        skippedNoFornitore++;
        if (runId) {
          LOG.debug(runId, 'MAG_SKIP_NO_SUPPLIER', 'Prodotto senza FornitoreID', {
            codiceInterno,
            descrizione: descrizione.substring(0, 30)
          });
        }
        return;
      }
      if (filterByIngrediente && !ingrediente) {
        skippedNoIngrediente++;
        if (runId) {
          LOG.debug(runId, 'MAG_SKIP_NO_INGREDIENT', 'Prodotto senza Ingrediente', {
            codiceInterno,
            descrizione: descrizione.substring(0, 30)
          });
        }
        return;
      }
      if (nonInUso === true || String(nonInUso).toLowerCase() === 'true' || String(nonInUso).toLowerCase() === 'vero') {
        skippedNonInUso++;
        if (runId) {
          LOG.debug(runId, 'MAG_SKIP_DISABLED', 'Prodotto disabilitato (NonInUso)', {
            codiceInterno,
            descrizione: descrizione.substring(0, 30)
          });
        }
        return;
      }

      processed++;

      // Normalizza UMBase
      let umBaseNorm = String(row[idx.UMBase] || 'PZ').trim().toUpperCase();
      if (umBaseNorm !== 'PZ' && umBaseNorm !== 'KG') {
        umBaseNorm = 'PZ'; // Default
      }

      const prodData = {
        codiceInterno,
        codiceFornitore,
        descrizione,
        denominazioneFornitore: String(row[idx.DenominazioneFornitore] || '').trim(),
        categoriaProdotto: String(row[idx.CategoriaProdotto] || '').trim(),
        ingrediente,
        nonInUso,
        umBaseNorm,
        pzPerCt: Number(row[idx.PZxCT]) || 0,
        kgPerPz: Number(row[idx.KGxPZ]) || 0
      };

      // Mappa con codice fornitore
      if (codiceFornitore) {
        const codiceNorm = codiceFornitore.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const key = `${fornitoreID}||${codiceNorm}`;
        prodottiByKey.set(key, prodData);
      }

      // Mappa alternativa per prodotti senza codice (KeyNoCode)
      if (descrizione && um) {
        const keyNoCode = `${fornitoreID}||${descrizione.toUpperCase()}||${um.toUpperCase()}`;
        prodottiByKeyNoCode.set(keyNoCode, prodData);
      }
    });

    // Raccogli sample delle chiavi prodotti per debug
    const keysSample = Array.from(prodottiByKey.keys()).slice(0, 5);

    // Logging già gestito da LOG in MAG_SKIP_* scopes
    if (false) {
      try {
        const timestamp = new Date();
      } catch (e) {
        console.error('Errore log filtri prodotti:', e);
      }
    }

    return { prodottiByKey, prodottiByKeyNoCode };
  }

  /**
   * Processa righe fattura e genera array base
   * @private
   * @param {Object} [dateFilter] - Filtro opzionale: {startDate: Date, endDate: Date}
   * @param {string} [runId=''] - RunId per logging
   */
  function _processRighe(shRighe, lastRow, prodottiByKey, prodottiByKeyNoCode, dateFilter = null, runId = '') {
    const headers = shRighe.getRange(1, 1, 1, shRighe.getLastColumn()).getValues()[0];
    const idx = {};
    headers.forEach((h, i) => {
      const cleanHeader = String(h).trim();
      if (cleanHeader) idx[cleanHeader] = i;
    });

    // Verifica colonne necessarie
    const requiredCols = [
      'Anno', 'FornitoreID', 'DenominazioneFornitore', 'NumeroDoc',
      'Codice Articolo Fornitore', 'Descrizione',
      'Quantita', 'PrezzoTotale', 'Reparto'
    ];
    const missingCols = requiredCols.filter(col => idx[col] === undefined);
    if (missingCols.length > 0) {
      throw new Error(`Colonne mancanti in Righe: ${missingCols.join(', ')}`);
    }

    // Colonne opzionali
    const hasUM = idx['UM'] !== undefined;
    const hasDataDoc = idx['DataDoc'] !== undefined;
    const hasSede = idx['Sede'] !== undefined;

    const data = shRighe.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const rowsBase = [];

    let skippedNoMatch = 0;
    let skippedInvalidData = 0;
    let skippedByDateFilter = 0;
    let matchedByNoCode = 0;
    const noMatchSamples = []; // Sample di righe che non matchano

    data.forEach(row => {
      const anno = row[idx.Anno];
      const dataDoc = hasDataDoc ? row[idx.DataDoc] : null;
      const fornitoreID = String(row[idx.FornitoreID] || '').trim();
      const codiceArticolo = String(row[idx['Codice Articolo Fornitore']] || '').trim();
      const descrizione = String(row[idx.Descrizione] || '').trim();
      const um = hasUM ? String(row[idx.UM] || '').trim() : '';
      const quantita = Number(row[idx.Quantita]) || 0;
      const prezzoTotale = Number(row[idx.PrezzoTotale]) || 0;
      const reparto = String(row[idx.Reparto] || '').trim();
      const denominazioneFornitore = String(row[idx.DenominazioneFornitore] || '').trim();
      const sedeRaw = hasSede ? String(row[idx.Sede] || '').trim() : '';

      // Filtri base
      if (!anno || quantita <= 0 || prezzoTotale === 0) {
        skippedInvalidData++;
        if (runId) {
          LOG.debug(runId, 'MAG_ROW_SKIP_INVALID', 'Riga invalida', {
            anno,
            quantita,
            prezzoTotale,
            descrizione: descrizione.substring(0, 30)
          });
        }
        return;
      }

      // Filtro per data (se specificato e se la colonna esiste)
      if (dateFilter && hasDataDoc && dataDoc) {
        const docDate = new Date(dataDoc);
        if (isNaN(docDate.getTime()) || docDate < dateFilter.startDate || docDate > dateFilter.endDate) {
          skippedByDateFilter++;
          if (runId) {
            LOG.debug(runId, 'MAG_ROW_SKIP_DATE', 'Riga fuori intervallo date', {
              dataDoc,
              filterStart: dateFilter.startDate.toISOString().substring(0, 10),
              filterEnd: dateFilter.endDate.toISOString().substring(0, 10)
            });
          }
          return; // Salta questa riga, fuori dall'intervallo
        }
      }

      // JOIN con prodotti
      let prod = null;
      let matchReason = '';

      if (codiceArticolo) {
        // Normalizza codice articolo (rimuove underscore, trattini, ecc.)
        const codiceNorm = codiceArticolo.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const keyRiga = `${fornitoreID}||${codiceNorm}`;
        prod = prodottiByKey.get(keyRiga);
        matchReason = prod ? 'matched_by_code' : 'no_match_code';
      } else if (descrizione && um) {
        // Cerca con KeyNoCode (FornitoreID + Descrizione + UM)
        const keyNoCode = `${fornitoreID}||${descrizione.toUpperCase()}||${um.toUpperCase()}`;
        prod = prodottiByKeyNoCode.get(keyNoCode);
        if (prod) {
          matchedByNoCode++;
          matchReason = 'matched_by_desc';
        } else {
          matchReason = 'no_match_desc';
        }
      }

      if (!prod) {
        skippedNoMatch++;
        // Raccogli sample (primi 10)
        if (noMatchSamples.length < 10) {
          const keyAttempted = codiceArticolo 
            ? `${fornitoreID}||${codiceArticolo}`
            : `${fornitoreID}||${descrizione.toUpperCase()}||${um.toUpperCase()}`;
          noMatchSamples.push({
            fornitoreID,
            codiceArticolo,
            descrizione: descrizione.substring(0, 30),
            um,
            keyAttempted,
            hasCode: !!codiceArticolo
          });
        }
        
        if (runId) {
          LOG.debug(runId, 'MAG_ROW_NO_MATCH', 'Riga non trova prodotto', {
            fornitoreID,
            codiceArticolo,
            descrizione: descrizione.substring(0, 30),
            um,
            matchReason
          });
        }
        return;
      } else {
        if (runId) {
          LOG.debug(runId, 'MAG_ROW_MATCHED', 'Riga matched con prodotto', {
            fornitoreID,
            codiceArticolo,
            codiceInterno: prod.codiceInterno,
            matchReason
          });
        }
      }

      // Calcola quantità base
      const { pzBase, kgBase } = _calculateBaseQuantities(quantita, prod.umBaseNorm, prod.pzPerCt, prod.kgPerPz);

      // Estrai mese dalla data documento (se disponibile)
      let mese = null;
      if (dataDoc instanceof Date && !isNaN(dataDoc.getTime())) {
        mese = dataDoc.getMonth() + 1; // 1-12
      }

      // Aggiungi rowBase
      rowsBase.push({
        anno,
        mese,  // ⭐ Aggiunto per KPI_ANALYSIS
        dataDoc,  // ⭐ Aggiunto per riferimento completo
        sede: sedeRaw,
        codiceInterno: prod.codiceInterno,
        codiceFornitore: prod.codiceFornitore,
        denominazioneFornitore: prod.denominazioneFornitore || denominazioneFornitore,
        descrizione: prod.descrizione || descrizione,
        categoriaProdotto: prod.categoriaProdotto,
        ingrediente: prod.ingrediente,
        reparto,
        umBase: prod.umBaseNorm,
        pzBase,
        kgBase,
        euro: prezzoTotale
      });
    });

    LOG?.info('MAG_CORE', 'Processamento righe completato.', {
      totalRows: data.length,
      skippedNoMatch,
      skippedInvalidData,
      skippedByDateFilter,
      matchedByNoCode,
      validRows: rowsBase.length,
      hasDataDoc,
      dateFilterActive: !!dateFilter
    });
    
    // Log diretto nel foglio Log
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const logSheet = ss.getSheetByName('Log');
      if (logSheet) {
        // Logging già gestito da LOG in MAG_ROW_* scopes
      }
    } catch (e) {
      console.error('Errore scrittura log righe:', e);
    }

    return rowsBase;
  }

  /**
   * Calcola quantità base in PZ e KG
   * @private
   */
  function _calculateBaseQuantities(quantita, umBaseNorm, pzPerCt, kgPerPz) {
    let pzBase = 0;
    let kgBase = 0;

    if (umBaseNorm === 'PZ') {
      if (pzPerCt > 0) {
        // Quantità è in cartoni
        pzBase = quantita * pzPerCt;
      } else {
        // Quantità già in pezzi
        pzBase = quantita;
      }

      if (kgPerPz > 0) {
        kgBase = pzBase * kgPerPz;
      }
    } else if (umBaseNorm === 'KG') {
      if (kgPerPz > 0) {
        // Quantità è in pezzi che pesano kgPerPz
        kgBase = quantita * kgPerPz;
      } else {
        // Quantità già in kg
        kgBase = quantita;
      }
    }

    return { pzBase, kgBase };
  }

  /**
   * Verifica che una colonna esista nell'header, altrimenti la crea
   * @private
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sh - Foglio
   * @param {Array} headers - Array degli header (riga 1)
   * @param {string} colName - Nome della colonna da verificare/creare
   * @returns {number} Indice (0-based) della colonna
   */
  function _ensureColumn(sh, headers, colName) {
    let colIndex = headers.indexOf(colName);
    
    if (colIndex === -1) {
      // Colonna non esiste: aggiungila
      colIndex = headers.length;
      headers.push(colName);
      
      // Inserisci nuova colonna se necessario
      if (colIndex >= sh.getMaxColumns()) {
        sh.insertColumnsAfter(sh.getMaxColumns(), 1);
      }
      
      // Scrivi header
      sh.getRange(1, colIndex + 1).setValue(colName);
      sh.getRange(1, colIndex + 1).setFontWeight('bold');
      
      LOG?.info('MAG_CORE', `Colonna "${colName}" creata nel foglio ${sh.getName()} alla posizione ${colIndex + 1}`);
    }
    
    return colIndex;
  }

  /**
   * Calcola e imposta i prezzi medi direttamente come valori
   * @private
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sh - Foglio magazzino
   * @param {Array} headers - Array degli header corrente
   */
  function _setupPrezziMediFormulas(sh, headers) {
    try {
      // Assicura che le colonne necessarie esistano
      const idxKgTot = _ensureColumn(sh, headers, 'KG TOT');
      const idxPzTot = _ensureColumn(sh, headers, 'PZ TOT');
      const idxTotEuro = _ensureColumn(sh, headers, 'Tot €');
      const idxEuroKg = _ensureColumn(sh, headers, '€/KG medio');
      const idxEuroPz = _ensureColumn(sh, headers, '€/PZ medio');

      const lastRow = sh.getLastRow();
      if (lastRow <= 1) {
        LOG?.info('MAG_CORE', `Foglio ${sh.getName()} vuoto, skip prezzi medi.`);
        return;
      }

      // Leggi dati esistenti
      const numDataRows = lastRow - 1;
      const dataRange = sh.getRange(2, 1, numDataRows, headers.length);
      const data = dataRange.getValues();

      // Calcola prezzi medi
      const valuesEuroKg = [];
      const valuesEuroPz = [];

      data.forEach(row => {
        const kgTot = Number(row[idxKgTot]) || 0;
        const pzTot = Number(row[idxPzTot]) || 0;
        const totEuro = Number(row[idxTotEuro]) || 0;

        // €/KG medio
        if (kgTot > 0) {
          valuesEuroKg.push([totEuro / kgTot]);
        } else {
          valuesEuroKg.push(['']);
        }

        // €/PZ medio
        if (pzTot > 0) {
          valuesEuroPz.push([totEuro / pzTot]);
        } else {
          valuesEuroPz.push(['']);
        }
      });

      // Scrivi valori calcolati
      sh.getRange(2, idxEuroKg + 1, numDataRows, 1).setValues(valuesEuroKg);
      sh.getRange(2, idxEuroPz + 1, numDataRows, 1).setValues(valuesEuroPz);

      // Imposta formattazione numerica per le colonne dei prezzi medi
      sh.getRange(2, idxEuroKg + 1, numDataRows, 1).setNumberFormat('€ #,##0.00;[Red]-€ #,##0.00;€ 0.00');
      sh.getRange(2, idxEuroPz + 1, numDataRows, 1).setNumberFormat('€ #,##0.00;[Red]-€ #,##0.00;€ 0.00');

      LOG?.info('MAG_CORE', `Prezzi medi calcolati nel foglio ${sh.getName()}: ${numDataRows} righe.`);

    } catch (e) {
      LOG?.error('MAG_CORE', `Errore in _setupPrezziMediFormulas per foglio ${sh.getName()}`, {
        error: e.message,
        stack: e.stack
      });
      throw e;
    }
  }

  /**
   * Genera report Magazzino per PRODOTTO (Anno+Prodotto+Reparto)
   * @public
   */
  /**
   * Costruisce report magazzino aggregato per PRODOTTO.
   * 
   * Aggregazione:
   * - Per Anno, CodiceInterno, FornitoreID, Descrizione, CategoriaProdotto, Reparto, UMBase
   * - Somma: PZ totali, KG totali, Costo Totale €
   * - Calcola: Costo Medio €/UMBase
   * 
   * Conversioni UM:
   * - Se fattura in CT (cartoni): PZ_TOT = QuantitàCT * PZxCT
   * - Se UMBase=KG: KG_TOT = PZ_TOT * KGxPZ
   * - Se UMBase=PZ: KG_TOT non applicabile
   * 
   * Output: Scrive/aggiorna foglio "Magazzino" con dati aggregati
   * 
   * @returns {void}
   * 
   * @example
   * MAGAZZINO_CORE.buildMagazzinoByYear();
   */
  function buildMagazzinoByYear() {
    const runId = LOG.generateRunId();
    LOG.info(runId, 'MAG_PRODOTTI_START', 'Inizio report Magazzino Prodotti');

    try {
      // Richiedi intervallo di mesi all'utente
      const ui = SpreadsheetApp.getUi();
      const responseStart = ui.prompt(
        'Filtro Magazzino Prodotti',
        'Inserisci MESE/ANNO di INIZIO (es: 01/2025):',
        ui.ButtonSet.OK_CANCEL
      );
      
      if (responseStart.getSelectedButton() !== ui.Button.OK) {
        ui.alert('Operazione annullata.');
        LOG.info(runId, 'MAG_PRODOTTI_CANCELLED', 'Operazione annullata dall\'utente');
        return;
      }
      
      const responseEnd = ui.prompt(
        'Filtro Magazzino Prodotti',
        'Inserisci MESE/ANNO di FINE (es: 11/2025):',
        ui.ButtonSet.OK_CANCEL
      );
      
      if (responseEnd.getSelectedButton() !== ui.Button.OK) {
        ui.alert('Operazione annullata.');
        return;
      }
      
      // Parse date
      const startParts = responseStart.getResponseText().trim().split('/');
      const endParts = responseEnd.getResponseText().trim().split('/');
      
      if (startParts.length !== 2 || endParts.length !== 2) {
        ui.alert('Formato data non valido. Usa MM/AAAA (es: 01/2025)');
        return;
      }
      
      const startMonth = parseInt(startParts[0], 10);
      const startYear = parseInt(startParts[1], 10);
      const endMonth = parseInt(endParts[0], 10);
      const endYear = parseInt(endParts[1], 10);
      
      if (isNaN(startMonth) || isNaN(startYear) || isNaN(endMonth) || isNaN(endYear) ||
          startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) {
        ui.alert('Mese o anno non valido.');
        return;
      }
      
      // Costruisci date filtro (primo giorno del mese iniziale, ultimo giorno del mese finale)
      const startDate = new Date(startYear, startMonth - 1, 1);
      const endDate = new Date(endYear, endMonth, 0); // Ultimo giorno del mese
      
      const dateFilter = { startDate, endDate };
      
      // Logging già gestito da LOG in MAG_PRODOTTI_START
      
      SHARED_UTILS.showToast(`Creazione Report Magazzino (${startParts[0]}/${startParts[1]} - ${endParts[0]}/${endParts[1]})...`, 'Magazzino', 10);

      // 1. Ottieni righe base con filtro (SENZA filtro Ingrediente per vedere tutti i prodotti)
      const rowsBase = buildMagazzinoBaseRows_(dateFilter, false, runId);
      
      LOG.info(runId, 'MAG_PRODOTTI_ROWS', 'Righe base generate', {
        rowCount: rowsBase.length
      });

      if (rowsBase.length === 0) {
        SHARED_UTILS.showToast('Nessun dato da elaborare.', 'Avviso', 5);
        LOG.warn(runId, 'MAG_PRODOTTI_NO_DATA', 'Nessun dato trovato per intervallo selezionato');
        return;
      }

      // 2. Aggrega per PRODOTTO
      const aggregati = {};
      rowsBase.forEach(rb => {
        const key = [
          rb.anno,
          rb.codiceInterno,
          rb.codiceFornitore,
          rb.denominazioneFornitore,
          rb.descrizione,
          rb.categoriaProdotto,
          rb.ingrediente,
          rb.reparto,
          rb.umBase
        ].join('||');

        if (!aggregati[key]) {
          aggregati[key] = {
            anno: rb.anno,
            codiceInterno: rb.codiceInterno,
            codiceFornitore: rb.codiceFornitore,
            denominazioneFornitore: rb.denominazioneFornitore,
            descrizione: rb.descrizione,
            categoriaProdotto: rb.categoriaProdotto,
            ingrediente: rb.ingrediente,
            reparto: rb.reparto,
            umBase: rb.umBase,
            pzTot: 0,
            kgTot: 0,
            totEuro: 0
          };
        }

        aggregati[key].pzTot += rb.pzBase;
        aggregati[key].kgTot += rb.kgBase;
        aggregati[key].totEuro += rb.euro;
      });

      // 3. Scrivi foglio Magazzino
      _writeMagazzinoSheet(aggregati);

      const numRows = Object.keys(aggregati).length;
      SHARED_UTILS.showToast(`Report Magazzino completato: ${numRows} righe.`, 'Completato', 5);
      LOG?.info('MAG_CORE', `Report Magazzino per prodotto completato: ${numRows} righe.`);

    } catch (e) {
      SHARED_UTILS.showToast('Errore durante la generazione del report Magazzino.', 'Errore', 10);
      LOG?.error('MAG_CORE', 'Errore in buildMagazzinoByYear.', {
        error: e.message,
        stack: e.stack
      });
    }
  }

  /**
   * Scrive il foglio Magazzino
   * @private
   */
  function _writeMagazzinoSheet(aggregati) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('Magazzino');
    
    if (!sh) {
      sh = ss.insertSheet('Magazzino');
      LOG?.info('MAG_CORE', 'Foglio Magazzino creato.');
    } else {
      // Pulisci ma mantieni header
      if (sh.getLastRow() > 1) {
        sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clear();
      }
    }

    // Intestazioni
    const headers = [
      'Anno',
      'CodiceInterno',
      'CodiceFornitore',
      'DenominazioneFornitore',
      'Descrizione',
      'CategoriaProdotto',
      'Ingrediente',
      'Reparto',
      'UMBase',
      'PZ TOT',
      'KG TOT',
      'Tot €',
      '€/KG medio',
      '€/PZ medio'
    ];

    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');

    // Prepara righe
    const rows = [];
    for (const key in aggregati) {
      const agg = aggregati[key];
      rows.push([
        agg.anno,
        agg.codiceInterno,
        agg.codiceFornitore,
        agg.denominazioneFornitore,
        agg.descrizione,
        agg.categoriaProdotto,
        agg.ingrediente,
        agg.reparto,
        agg.umBase,
        agg.pzTot,
        agg.kgTot,
        agg.totEuro,
        '', // €/KG medio - lasciato a formule utente
        ''  // €/PZ medio - lasciato a formule utente
      ]);
    }

    // Ordina per Anno, CodiceInterno
    rows.sort((a, b) => {
      const annoCompare = a[0] - b[0];
      if (annoCompare !== 0) return annoCompare;
      return a[1].localeCompare(b[1]);
    });

    // Scrivi righe
    if (rows.length > 0) {
      sh.getRange(2, 1, rows.length, headers.length).setValues(rows);

      // Formattazione base
      sh.getRange(2, 1, rows.length, 1).setNumberFormat('0'); // Anno
      sh.getRange(2, 10, rows.length, 1).setNumberFormat('#,##0.####'); // PZ TOT
      sh.getRange(2, 11, rows.length, 1).setNumberFormat('#,##0.####'); // KG TOT
      sh.getRange(2, 12, rows.length, 1).setNumberFormat('€ #,##0.00;[Red]-€ #,##0.00;€ 0.00'); // Tot €
    }

    // Imposta ARRAYFORMULA per prezzi medi
    _setupPrezziMediFormulas(sh, headers);

    sh.setFrozenRows(1);
    ss.setActiveSheet(sh);
  }

  /**
   * Genera report Magazzino Ingredienti per INGREDIENTE (Anno+Ingrediente+Categoria)
   * @public
   */
  /**
   * Costruisce report magazzino ingredienti per gelateria (filtro Ingrediente=TRUE).
   * 
   * Aggregazione:
   * - Per Anno, Ingrediente, CategoriaProdotto, UMBase
   * - Somma: PZ totali, KG totali, Costo Totale €
   * - Calcola: Costo Medio €/UMBase, % Incidenza su totale costi ingredienti
   * 
   * Filtri:
   * - Solo prodotti con Ingrediente=TRUE (da foglio Prodotti)
   * - Esclusi NonInUso=TRUE
   * 
   * Output: Scrive/aggiorna foglio "Magazzino Ingredienti" con dati aggregati
   * 
   * @returns {void}
   * 
   * @example
   * MAGAZZINO_CORE.buildMagazzinoIngredientiByYear();
   */
  function buildMagazzinoIngredientiByYear() {
    const runId = LOG.generateRunId();
    LOG.info(runId, 'MAG_INGREDIENTI_START', 'Inizio report Magazzino Ingredienti');

    try {
      // Richiedi intervallo di mesi all'utente
      const ui = SpreadsheetApp.getUi();
      const responseStart = ui.prompt(
        'Filtro Magazzino Ingredienti',
        'Inserisci MESE/ANNO di INIZIO (es: 01/2025):',
        ui.ButtonSet.OK_CANCEL
      );
      
      if (responseStart.getSelectedButton() !== ui.Button.OK) {
        ui.alert('Operazione annullata.');
        LOG.info(runId, 'MAG_INGREDIENTI_CANCELLED', 'Operazione annullata dall\'utente');
        return;
      }
      
      const responseEnd = ui.prompt(
        'Filtro Magazzino Ingredienti',
        'Inserisci MESE/ANNO di FINE (es: 11/2025):',
        ui.ButtonSet.OK_CANCEL
      );
      
      if (responseEnd.getSelectedButton() !== ui.Button.OK) {
        ui.alert('Operazione annullata.');
        return;
      }
      
      // Parse date
      const startParts = responseStart.getResponseText().trim().split('/');
      const endParts = responseEnd.getResponseText().trim().split('/');
      
      if (startParts.length !== 2 || endParts.length !== 2) {
        ui.alert('Formato data non valido. Usa MM/AAAA (es: 01/2025)');
        return;
      }
      
      const startMonth = parseInt(startParts[0], 10);
      const startYear = parseInt(startParts[1], 10);
      const endMonth = parseInt(endParts[0], 10);
      const endYear = parseInt(endParts[1], 10);
      
      if (isNaN(startMonth) || isNaN(startYear) || isNaN(endMonth) || isNaN(endYear) ||
          startMonth < 1 || startMonth > 12 || endMonth < 1 || endMonth > 12) {
        ui.alert('Mese o anno non valido.');
        return;
      }
      
      // Costruisci date filtro (primo giorno del mese iniziale, ultimo giorno del mese finale)
      const startDate = new Date(startYear, startMonth - 1, 1);
      const endDate = new Date(endYear, endMonth, 0); // Ultimo giorno del mese
      
      const dateFilter = { startDate, endDate };
      
      // Logging già gestito da LOG in MAG_INGREDIENTI_START
      
      SHARED_UTILS.showToast(`Creazione Report Magazzino Ingredienti (${startParts[0]}/${startParts[1]} - ${endParts[0]}/${endParts[1]})...`, 'Magazzino Ingredienti', 10);

      // 1. Ottieni righe base con filtro (CON filtro Ingrediente per vedere solo ingredienti)
      const rowsBase = buildMagazzinoBaseRows_(dateFilter, true, runId);
      
      LOG.info(runId, 'MAG_INGREDIENTI_ROWS', 'Righe base generate', {
        rowCount: rowsBase.length
      });

      if (rowsBase.length === 0) {
        SHARED_UTILS.showToast('Nessun dato da elaborare.', 'Avviso', 5);
        LOG.warn(runId, 'MAG_INGREDIENTI_NO_DATA', 'Nessun dato trovato per intervallo selezionato');
        return;
      }

      // 2. Aggrega per INGREDIENTE
      const aggregati = {};
      rowsBase.forEach(rb => {
        const key = [rb.anno, rb.ingrediente, rb.categoriaProdotto, rb.umBase].join('||');

        if (!aggregati[key]) {
          aggregati[key] = {
            anno: rb.anno,
            ingrediente: rb.ingrediente,
            categoria: rb.categoriaProdotto,
            umBase: rb.umBase,
            pzTot: 0,
            kgTot: 0,
            totEuro: 0
          };
        }

        aggregati[key].pzTot += rb.pzBase;
        aggregati[key].kgTot += rb.kgBase;
        aggregati[key].totEuro += rb.euro;
      });

      // 3. Scrivi foglio Magazzino_Ingredienti
      _writeMagazzinoIngredientiSheet(aggregati);

      const numRows = Object.keys(aggregati).length;
      SHARED_UTILS.showToast(`Report Magazzino Ingredienti completato: ${numRows} righe.`, 'Completato', 5);
      LOG?.info('MAG_CORE', `Report Magazzino Ingredienti completato: ${numRows} righe.`);

    } catch (e) {
      SHARED_UTILS.showToast('Errore durante la generazione del report Magazzino Ingredienti.', 'Errore', 10);
      LOG?.error('MAG_CORE', 'Errore in buildMagazzinoIngredientiByYear.', {
        error: e.message,
        stack: e.stack
      });
    }
  }

  /**
   * Scrive il foglio Magazzino_Ingredienti
   * @private
   */
  function _writeMagazzinoIngredientiSheet(aggregati) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sh = ss.getSheetByName('Magazzino_Ingredienti');
    
    if (!sh) {
      sh = ss.insertSheet('Magazzino_Ingredienti');
      LOG?.info('MAG_CORE', 'Foglio Magazzino_Ingredienti creato.');
    } else {
      // Pulisci ma mantieni header
      if (sh.getLastRow() > 1) {
        sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).clear();
      }
    }

    // Intestazioni
    const headers = [
      'Anno',
      'Ingrediente',
      'Categoria',
      'UMBase',
      'PZ TOT',
      'KG TOT',
      'Tot €',
      '€/KG medio',
      '€/PZ medio'
    ];

    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold');

    // Prepara righe
    const rows = [];
    for (const key in aggregati) {
      const agg = aggregati[key];
      rows.push([
        agg.anno,
        agg.ingrediente,
        agg.categoria,
        agg.umBase,
        agg.pzTot,
        agg.kgTot,
        agg.totEuro,
        '', // €/KG medio - lasciato a formule utente
        ''  // €/PZ medio - lasciato a formule utente
      ]);
    }

    // Ordina per Anno, Ingrediente, Categoria
    rows.sort((a, b) => {
      const annoCompare = a[0] - b[0];
      if (annoCompare !== 0) return annoCompare;
      
      const ingredienteCompare = a[1].localeCompare(b[1]);
      if (ingredienteCompare !== 0) return ingredienteCompare;
      
      return a[2].localeCompare(b[2]);
    });

    // Scrivi righe
    if (rows.length > 0) {
      sh.getRange(2, 1, rows.length, headers.length).setValues(rows);

      // Formattazione base
      sh.getRange(2, 1, rows.length, 1).setNumberFormat('0'); // Anno
      sh.getRange(2, 5, rows.length, 1).setNumberFormat('#,##0.####'); // PZ TOT
      sh.getRange(2, 6, rows.length, 1).setNumberFormat('#,##0.####'); // KG TOT
      sh.getRange(2, 7, rows.length, 1).setNumberFormat('€ #,##0.00;[Red]-€ #,##0.00;€ 0.00'); // Tot €
    }

    // Imposta ARRAYFORMULA per prezzi medi
    _setupPrezziMediFormulas(sh, headers);

    sh.setFrozenRows(1);
    ss.setActiveSheet(sh);
  }

  /**
   * Aggiorna le formule dei prezzi medi su tutti i fogli magazzino esistenti
   * @public
   * @returns {void}
   */
  function updatePrezziMediMagazzino() {
    try {
      SHARED_UTILS.showToast('Aggiornamento prezzi medi magazzini...', 'Magazzino', 5);
      
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheetNames = ['Magazzino', 'Magazzino_Ingredienti'];
      let updated = 0;

      sheetNames.forEach(name => {
        const sh = ss.getSheetByName(name);
        if (!sh) {
          LOG?.warn('MAG_CORE', `Foglio ${name} non trovato, skip.`);
          return;
        }

        const lastRow = sh.getLastRow();
        if (lastRow <= 1) {
          LOG?.warn('MAG_CORE', `Foglio ${name} vuoto, skip.`);
          return;
        }

        // Leggi header esistenti
        const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
        
        // Imposta formule
        _setupPrezziMediFormulas(sh, headers);
        updated++;
        
        LOG?.info('MAG_CORE', `Prezzi medi aggiornati per foglio ${name}`);
      });

      SHARED_UTILS.showToast(`Prezzi medi aggiornati per ${updated} fogli.`, 'Completato', 5);
      LOG?.info('MAG_CORE', `updatePrezziMediMagazzino completato: ${updated} fogli aggiornati.`);

    } catch (e) {
      SHARED_UTILS.showToast('Errore durante aggiornamento prezzi medi.', 'Errore', 10);
      LOG?.error('MAG_CORE', 'Errore in updatePrezziMediMagazzino.', {
        error: e.message,
        stack: e.stack
      });
    }
  }

  // API pubblica
  return {
    buildMagazzinoByYear,
    buildMagazzinoIngredientiByYear,
    updatePrezziMediMagazzino,
    buildMagazzinoBaseRows_  // ⭐ Esposta per KPI_ANALYSIS
  };

})();

// Registra nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('MAGAZZINO_CORE', ['UTIL', 'SHARED_UTILS', 'LOG']);
}

// Registra nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('MAGAZZINO_CORE', MAGAZZINO_CORE);
}

// Espone MAGAZZINO_CORE in globalThis per dependency tracking
if (typeof globalThis !== 'undefined') {
  globalThis.MAGAZZINO_CORE = MAGAZZINO_CORE;
}

// Funzioni globali per il menu

/**
 * Costruisce il report magazzino per prodotto raggruppato per anno.
 * Wrapper pubblico chiamato dal menu GELATAMI.
 * 
 * @returns {void}
 * 
 * @example
 * buildMagazzinoByYear(); // Chiamato dal menu
 */
function buildMagazzinoByYear() {
  MAGAZZINO_CORE.buildMagazzinoByYear();
}

/**
 * Costruisce il report magazzino ingredienti raggruppato per anno.
 * Wrapper pubblico chiamato dal menu GELATAMI.
 * 
 * @returns {void}
 * 
 * @example
 * buildMagazzinoIngredientiByYear(); // Chiamato dal menu
 */
function buildMagazzinoIngredientiByYear() {
  MAGAZZINO_CORE.buildMagazzinoIngredientiByYear();
}

/**
 * Aggiorna le formule dei prezzi medi (€/KG medio, €/PZ medio) sui fogli magazzino.
 * Wrapper pubblico chiamato dal menu GELATAMI.
 * 
 * @returns {void}
 * 
 * @example
 * updatePrezziMediMagazzino(); // Chiamato dal menu
 */
function updatePrezziMediMagazzino() {
  MAGAZZINO_CORE.updatePrezziMediMagazzino();
}
