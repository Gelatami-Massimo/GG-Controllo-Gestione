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
   * @returns {Array} Array di oggetti rowBase con campi normalizzati
   */
  function buildMagazzinoBaseRows_() {
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
    const { prodottiByKey, prodottiByKeyNoCode } = _buildProdottiMap(shProdotti, lastRowProd);
    LOG?.info('MAG_CORE', `Mappa prodotti costruita: ${prodottiByKey.size} con codice, ${prodottiByKeyNoCode.size} senza codice.`);

    // 4. Processa righe fattura
    const rowsBase = _processRighe(shRighe, lastRowRighe, prodottiByKey, prodottiByKeyNoCode);
    LOG?.info('MAG_CORE', `Righe base generate: ${rowsBase.length} righe.`);

    return rowsBase;
  }

  /**
   * Costruisce mappa prodotti da foglio Prodotti
   * @private
   * @returns {Object} { prodottiByKey: Map, prodottiByKeyNoCode: Map }
   */
  function _buildProdottiMap(shProdotti, lastRow) {
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

    data.forEach(row => {
      const fornitoreID = String(row[idx.FornitoreID] || '').trim();
      const codiceFornitore = String(row[idx.CodiceFornitore] || '').trim();
      const codiceInterno = String(row[idx.CodiceInterno] || '').trim();
      const descrizione = String(row[idx.Descrizione] || '').trim();
      const um = String(row[idx.UM] || '').trim();
      const ingrediente = String(row[idx.Ingrediente] || '').trim();
      const nonInUso = row[idx.NonInUso];

      // Filtri base
      if (!fornitoreID) return;
      if (!ingrediente) return;
      if (nonInUso === true || String(nonInUso).toLowerCase() === 'true' || String(nonInUso).toLowerCase() === 'vero') return;

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
        const key = `${fornitoreID}||${codiceFornitore}`;
        prodottiByKey.set(key, prodData);
      }

      // Mappa alternativa per prodotti senza codice (KeyNoCode)
      if (descrizione && um) {
        const keyNoCode = `${fornitoreID}||${descrizione.toUpperCase()}||${um.toUpperCase()}`;
        prodottiByKeyNoCode.set(keyNoCode, prodData);
      }
    });

    return { prodottiByKey, prodottiByKeyNoCode };
  }

  /**
   * Processa righe fattura e genera array base
   * @private
   */
  function _processRighe(shRighe, lastRow, prodottiByKey, prodottiByKeyNoCode) {
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

    // Colonna UM è opzionale (potrebbe non esistere in Righe)
    const hasUM = idx['UM'] !== undefined;

    const data = shRighe.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const rowsBase = [];

    let skippedNoMatch = 0;
    let skippedInvalidData = 0;
    let matchedByNoCode = 0;

    data.forEach(row => {
      const anno = row[idx.Anno];
      const fornitoreID = String(row[idx.FornitoreID] || '').trim();
      const codiceArticolo = String(row[idx['Codice Articolo Fornitore']] || '').trim();
      const descrizione = String(row[idx.Descrizione] || '').trim();
      const um = hasUM ? String(row[idx.UM] || '').trim() : '';
      const quantita = Number(row[idx.Quantita]) || 0;
      const prezzoTotale = Number(row[idx.PrezzoTotale]) || 0;
      const reparto = String(row[idx.Reparto] || '').trim();
      const denominazioneFornitore = String(row[idx.DenominazioneFornitore] || '').trim();

      // Filtri
      if (!anno || quantita <= 0 || prezzoTotale === 0) {
        skippedInvalidData++;
        return;
      }

      // JOIN con prodotti
      let prod = null;

      if (codiceArticolo) {
        // Cerca con codice fornitore
        const keyRiga = `${fornitoreID}||${codiceArticolo}`;
        prod = prodottiByKey.get(keyRiga);
      } else if (descrizione && um) {
        // Cerca con KeyNoCode (FornitoreID + Descrizione + UM)
        const keyNoCode = `${fornitoreID}||${descrizione.toUpperCase()}||${um.toUpperCase()}`;
        prod = prodottiByKeyNoCode.get(keyNoCode);
        if (prod) {
          matchedByNoCode++;
        }
      }

      if (!prod) {
        skippedNoMatch++;
        return;
      }

      // Calcola quantità base
      const { pzBase, kgBase } = _calculateBaseQuantities(quantita, prod.umBaseNorm, prod.pzPerCt, prod.kgPerPz);

      // Aggiungi rowBase
      rowsBase.push({
        anno,
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
      matchedByNoCode,
      validRows: rowsBase.length
    });

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
    try {
      UTIL.showToast('Creazione Report Magazzino per Prodotto...', 'Magazzino', 10);

      // 1. Ottieni righe base
      const rowsBase = buildMagazzinoBaseRows_();

      if (rowsBase.length === 0) {
        UTIL.showToast('Nessun dato da elaborare.', 'Avviso', 5);
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
      UTIL.showToast(`Report Magazzino completato: ${numRows} righe.`, 'Completato', 5);
      LOG?.info('MAG_CORE', `Report Magazzino per prodotto completato: ${numRows} righe.`);

    } catch (e) {
      UTIL.showToast('Errore durante la generazione del report Magazzino.', 'Errore', 10);
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
    try {
      UTIL.showToast('Creazione Report Magazzino Ingredienti...', 'Magazzino Ingredienti', 10);

      // 1. Ottieni righe base
      const rowsBase = buildMagazzinoBaseRows_();

      if (rowsBase.length === 0) {
        UTIL.showToast('Nessun dato da elaborare.', 'Avviso', 5);
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
      UTIL.showToast(`Report Magazzino Ingredienti completato: ${numRows} righe.`, 'Completato', 5);
      LOG?.info('MAG_CORE', `Report Magazzino Ingredienti completato: ${numRows} righe.`);

    } catch (e) {
      UTIL.showToast('Errore durante la generazione del report Magazzino Ingredienti.', 'Errore', 10);
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
      UTIL.showToast('Aggiornamento prezzi medi magazzini...', 'Magazzino', 5);
      
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

      UTIL.showToast(`Prezzi medi aggiornati per ${updated} fogli.`, 'Completato', 5);
      LOG?.info('MAG_CORE', `updatePrezziMediMagazzino completato: ${updated} fogli aggiornati.`);

    } catch (e) {
      UTIL.showToast('Errore durante aggiornamento prezzi medi.', 'Errore', 10);
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
    updatePrezziMediMagazzino
  };

})();

// Registra nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('MAGAZZINO_CORE', ['UTIL', 'LOG']);
}

// Registra nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('MAGAZZINO_CORE', MAGAZZINO_CORE);
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
