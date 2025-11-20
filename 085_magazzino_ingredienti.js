// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 085_magazzino_ingredienti.js
// VERSIONE: 2.0 (Magazzino Ingredienti per Anno)
// DESCRIZIONE: Report aggregato magazzino ingredienti per Anno+Ingrediente+Reparto.
//              Legge da Righe (fatture) + Prodotti e aggrega acquisti per anno.
// =============================================================

const MAGAZZINO_INGREDIENTI = (() => {

  const OUTPUT_SHEET_NAME = 'Magazzino_Ingredienti';

  /**
   * Costruisce il report Magazzino Ingredienti aggregando per Anno+Ingrediente+Reparto.
   * Legge da Righe (fatture ARTICOLO) + Prodotti (per ingrediente/conversioni).
   */
  function buildMagazzinoIngredientiByYear() {
    try {
      UTIL.showToast('Creazione Report Magazzino Ingredienti per Anno...', 'Magazzino Ingredienti', 10);

      const ss = SpreadsheetApp.getActiveSpreadsheet();

      // 1. Leggi foglio Prodotti
      const shProdotti = ss.getSheetByName('Prodotti');
      if (!shProdotti) {
        UTIL.showToast('Foglio Prodotti non trovato.', 'Errore', 5);
        LOG?.error('MAG_INGREDIENTI', 'Foglio Prodotti non trovato.');
        return;
      }

      const lastRowProd = shProdotti.getLastRow();
      if (lastRowProd <= 1) {
        UTIL.showToast('Foglio Prodotti vuoto.', 'Avviso', 5);
        return;
      }

      // 2. Leggi foglio Righe
      const shRighe = ss.getSheetByName('Righe');
      if (!shRighe) {
        UTIL.showToast('Foglio Righe non trovato.', 'Errore', 5);
        LOG?.error('MAG_INGREDIENTI', 'Foglio Righe non trovato.');
        return;
      }

      const lastRowRighe = shRighe.getLastRow();
      if (lastRowRighe <= 1) {
        UTIL.showToast('Foglio Righe vuoto.', 'Avviso', 5);
        return;
      }

      // 3. Costruisci mappa prodotti
      const prodottiMap = _buildProdottiMap(shProdotti, lastRowProd);
      if (prodottiMap.size === 0) {
        UTIL.showToast('Nessun prodotto valido trovato.', 'Avviso', 5);
        return;
      }

      LOG?.info('MAG_INGREDIENTI', `Mappa prodotti costruita: ${prodottiMap.size} prodotti.`);

      // 4. Leggi e aggrega righe fattura
      const aggregati = _aggregateRighe(shRighe, lastRowRighe, prodottiMap);

      const numGroups = Object.keys(aggregati).length;
      LOG?.info('MAG_INGREDIENTI', `Aggregazione completata: ${numGroups} gruppi.`);

      if (numGroups === 0) {
        UTIL.showToast('Nessun dato da aggregare.', 'Avviso', 5);
        return;
      }

      // 5. Crea/aggiorna foglio output
      _writeOutputSheet(ss, aggregati);

      UTIL.showToast(`Report completato: ${numGroups} righe scritte.`, 'Completato', 5);

    } catch (e) {
      UTIL.showToast('Errore durante la generazione del report.', 'Errore', 10);
      LOG?.error('MAG_INGREDIENTI', 'Errore in buildMagazzinoIngredientiByYear.', {
        error: e.message,
        stack: e.stack
      });
    }
  }

  /**
   * Costruisce una mappa prodotti: chiave = FornitoreID||CodiceFornitore
   * @private
   */
  function _buildProdottiMap(shProdotti, lastRow) {
    const headers = shProdotti.getRange(1, 1, 1, shProdotti.getLastColumn()).getValues()[0];
    const idx = {};
    headers.forEach((h, i) => {
      const cleanHeader = String(h).trim();
      if (cleanHeader) idx[cleanHeader] = i;
    });

    // Verifica colonne necessarie
    const requiredCols = ['CodiceInterno', 'CodiceFornitore', 'FornitoreID', 'Ingrediente', 'NonInUso', 'UMBase', 'PZxCT', 'KGxPZ'];
    const missingCols = requiredCols.filter(col => idx[col] === undefined);
    if (missingCols.length > 0) {
      LOG?.error('MAG_INGREDIENTI', `Colonne mancanti in Prodotti: ${missingCols.join(', ')}`);
      throw new Error(`Colonne mancanti in Prodotti: ${missingCols.join(', ')}`);
    }

    const data = shProdotti.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const prodottiMap = new Map();

    data.forEach(row => {
      const fornitoreID = String(row[idx.FornitoreID] || '').trim();
      const codiceFornitore = String(row[idx.CodiceFornitore] || '').trim();
      const ingrediente = String(row[idx.Ingrediente] || '').trim();
      const nonInUso = row[idx.NonInUso];
      
      if (!fornitoreID || !codiceFornitore) return;
      if (!ingrediente) return;
      if (nonInUso === true || String(nonInUso).toLowerCase() === 'true' || String(nonInUso).toLowerCase() === 'vero') return;

      const key = `${fornitoreID}||${codiceFornitore}`;
      const umBase = String(row[idx.UMBase] || '').trim().toUpperCase();
      const pzxct = Number(row[idx.PZxCT]) || 0;
      const kgxpz = Number(row[idx.KGxPZ]) || 0;

      prodottiMap.set(key, {
        ingrediente,
        umBase,
        pzxct,
        kgxpz
      });
    });

    return prodottiMap;
  }

  /**
   * Aggrega le righe fattura per Anno+Ingrediente+Reparto+UMBase
   * @private
   */
  function _aggregateRighe(shRighe, lastRow, prodottiMap) {
    const headers = shRighe.getRange(1, 1, 1, shRighe.getLastColumn()).getValues()[0];
    const idx = {};
    headers.forEach((h, i) => {
      const cleanHeader = String(h).trim();
      if (cleanHeader) idx[cleanHeader] = i;
    });

    // Verifica colonne necessarie
    const requiredCols = ['Anno', 'FornitoreID', 'Codice Articolo Fornitore', 'Quantita', 'PrezzoTotale', 'Reparto', 'TipoRiga'];
    const missingCols = requiredCols.filter(col => idx[col] === undefined);
    if (missingCols.length > 0) {
      LOG?.error('MAG_INGREDIENTI', `Colonne mancanti in Righe: ${missingCols.join(', ')}`);
      throw new Error(`Colonne mancanti in Righe: ${missingCols.join(', ')}`);
    }

    const data = shRighe.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const aggregati = {};

    let skippedNotArticolo = 0;
    let skippedNoMatch = 0;
    let skippedEmptyData = 0;

    data.forEach(row => {
      const anno = row[idx.Anno];
      const tipoRiga = String(row[idx.TipoRiga] || '').trim().toUpperCase();
      const fornitoreID = String(row[idx.FornitoreID] || '').trim();
      const codiceArticolo = String(row[idx['Codice Articolo Fornitore']] || '').trim();
      const quantita = Number(row[idx.Quantita]) || 0;
      const prezzoTotale = Number(row[idx.PrezzoTotale]) || 0;
      const reparto = String(row[idx.Reparto] || '').trim();

      // Filtri
      if (tipoRiga !== 'ARTICOLO') {
        skippedNotArticolo++;
        return;
      }

      if (!anno || quantita === 0 || prezzoTotale === 0) {
        skippedEmptyData++;
        return;
      }

      // JOIN con prodotti
      const key = `${fornitoreID}||${codiceArticolo}`;
      const prodInfo = prodottiMap.get(key);
      if (!prodInfo) {
        skippedNoMatch++;
        return;
      }

      // Calcola quantità base
      const { pzBase, kgBase } = _calculateBaseQuantities(quantita, prodInfo.umBase, prodInfo.pzxct, prodInfo.kgxpz);

      // Chiave aggregazione
      const aggKey = `${anno}||${prodInfo.ingrediente}||${reparto}||${prodInfo.umBase}`;

      if (!aggregati[aggKey]) {
        aggregati[aggKey] = {
          anno,
          ingrediente: prodInfo.ingrediente,
          reparto,
          umBase: prodInfo.umBase,
          pzTot: 0,
          kgTot: 0,
          totEuro: 0
        };
      }

      aggregati[aggKey].pzTot += pzBase;
      aggregati[aggKey].kgTot += kgBase;
      aggregati[aggKey].totEuro += prezzoTotale;
    });

    LOG?.info('MAG_INGREDIENTI', 'Aggregazione righe completata.', {
      totalRows: data.length,
      skippedNotArticolo,
      skippedNoMatch,
      skippedEmptyData,
      aggregatedGroups: Object.keys(aggregati).length
    });

    return aggregati;
  }

  /**
   * Calcola quantità base in PZ e KG in base all'UMBase
   * @private
   */
  function _calculateBaseQuantities(quantita, umBase, pzxct, kgxpz) {
    let pzBase = 0;
    let kgBase = 0;

    if (umBase === 'PZ') {
      if (pzxct > 0) {
        // Quantità è in cartoni
        pzBase = quantita * pzxct;
      } else {
        // Quantità già in pezzi
        pzBase = quantita;
      }

      if (kgxpz > 0) {
        kgBase = pzBase * kgxpz;
      }
    } else if (umBase === 'KG') {
      if (kgxpz > 0) {
        // Quantità è in pezzi
        kgBase = quantita * kgxpz;
      } else {
        // Quantità già in kg
        kgBase = quantita;
      }
    } else {
      // UM non gestita, saltiamo conversione
      pzBase = quantita;
    }

    return { pzBase, kgBase };
  }

  /**
   * Scrive il foglio di output
   * @private
   */
  function _writeOutputSheet(ss, aggregati) {
    let shOutput = ss.getSheetByName(OUTPUT_SHEET_NAME);
    if (!shOutput) {
      shOutput = ss.insertSheet(OUTPUT_SHEET_NAME);
      LOG?.info('MAG_INGREDIENTI', `Foglio ${OUTPUT_SHEET_NAME} creato.`);
    } else {
      shOutput.clear();
      LOG?.info('MAG_INGREDIENTI', `Foglio ${OUTPUT_SHEET_NAME} svuotato.`);
    }

    // Intestazioni
    const headers = [
      'Anno',
      'Ingrediente',
      'Reparto',
      'UMBase',
      'PZ TOT',
      'KG TOT',
      'Tot €',
      '€/KG medio',
      '€/PZ medio'
    ];

    shOutput.getRange(1, 1, 1, headers.length).setValues([headers]);
    shOutput.getRange(1, 1, 1, headers.length).setFontWeight('bold');

    // Prepara righe
    const rows = [];
    for (const key in aggregati) {
      const agg = aggregati[key];
      
      // Calcola medie
      const euroPerKg = (agg.kgTot > 0) ? (agg.totEuro / agg.kgTot) : '';
      const euroPerPz = (agg.pzTot > 0) ? (agg.totEuro / agg.pzTot) : '';

      rows.push([
        agg.anno,
        agg.ingrediente,
        agg.reparto,
        agg.umBase,
        agg.pzTot,
        agg.kgTot,
        agg.totEuro,
        euroPerKg,
        euroPerPz
      ]);
    }

    // Ordina per Anno, Ingrediente, Reparto
    rows.sort((a, b) => {
      const annoCompare = a[0] - b[0];
      if (annoCompare !== 0) return annoCompare;
      
      const ingredienteCompare = a[1].localeCompare(b[1]);
      if (ingredienteCompare !== 0) return ingredienteCompare;
      
      return a[2].localeCompare(b[2]);
    });

    // Scrivi righe
    if (rows.length > 0) {
      shOutput.getRange(2, 1, rows.length, headers.length).setValues(rows);

      // Formattazione
      // Anno (col 1) - numero intero
      shOutput.getRange(2, 1, rows.length, 1).setNumberFormat('0');
      
      // PZ TOT (col 5)
      shOutput.getRange(2, 5, rows.length, 1).setNumberFormat('#,##0.####');
      
      // KG TOT (col 6)
      shOutput.getRange(2, 6, rows.length, 1).setNumberFormat('#,##0.####');
      
      // Tot € (col 7)
      shOutput.getRange(2, 7, rows.length, 1).setNumberFormat('€ #,##0.00;[Red]-€ #,##0.00;€ 0.00');
      
      // €/KG medio (col 8)
      shOutput.getRange(2, 8, rows.length, 1).setNumberFormat('€ #,##0.0000;[Red]-€ #,##0.0000;€ 0.0000');
      
      // €/PZ medio (col 9)
      shOutput.getRange(2, 9, rows.length, 1).setNumberFormat('€ #,##0.0000;[Red]-€ #,##0.0000;€ 0.0000');

      LOG?.info('MAG_INGREDIENTI', `Scritte ${rows.length} righe in ${OUTPUT_SHEET_NAME}.`);
    }

    // Freeze header
    shOutput.setFrozenRows(1);

    // Attiva il foglio
    ss.setActiveSheet(shOutput);
  }

  // API pubblica
  return {
    buildMagazzinoIngredientiByYear
  };

})();

// Registra nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('MAGAZZINO_INGREDIENTI', ['UTIL', 'LOG']);
}

// Registra nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('MAGAZZINO_INGREDIENTI', MAGAZZINO_INGREDIENTI);
}

// Funzione globale per il menu
function buildMagazzinoIngredientiByYear() {
  MAGAZZINO_INGREDIENTI.buildMagazzinoIngredientiByYear();
}
