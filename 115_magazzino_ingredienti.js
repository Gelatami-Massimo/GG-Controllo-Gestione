// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 115_magazzino_ingredienti.js
// VERSIONE: 1.0 (Magazzino per Ingrediente)
// DESCRIZIONE: Report aggregato magazzino per ingrediente.
//              Legge dal foglio Magazzino e aggrega per Ingrediente+Reparto+UMBase.
// =============================================================

const MAGAZZINO_INGREDIENTI = (() => {

  /**
   * Costruisce il report Magazzino Ingredienti aggregando i dati dal foglio Magazzino.
   * Aggrega per: Ingrediente, Reparto, UMBase
   * Calcola: PZ TOT, KG TOT, Tot €, €/KG medio, €/PZ medio
   */
  function buildMagazzinoIngredienti() {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      
      // 1. Leggi foglio Magazzino
      const shMagazzino = ss.getSheetByName('Magazzino');
      if (!shMagazzino) {
        UTIL.showToast('Foglio Magazzino non trovato.', 'Errore', 5);
        LOG?.error('MAG_INGREDIENTI', 'Foglio Magazzino non trovato.');
        return;
      }

      const lastRow = shMagazzino.getLastRow();
      if (lastRow <= 1) {
        UTIL.showToast('Foglio Magazzino vuoto.', 'Avviso', 5);
        return;
      }

      // 2. Leggi header e dati
      const headerRow = 1;
      const headers = shMagazzino.getRange(headerRow, 1, 1, shMagazzino.getLastColumn()).getValues()[0];
      
      // Mappa indici colonne
      const idx = {};
      headers.forEach((h, i) => {
        const cleanHeader = String(h).trim();
        if (cleanHeader) {
          idx[cleanHeader] = i;
        }
      });

      // Verifica colonne necessarie
      const requiredCols = ['Ingrediente', 'Reparto', 'UMBase', 'NonInUso', 'PZ TOT', 'KG TOT', 'Tot €'];
      const missingCols = requiredCols.filter(col => idx[col] === undefined);
      if (missingCols.length > 0) {
        UTIL.showToast(`Colonne mancanti in Magazzino: ${missingCols.join(', ')}`, 'Errore', 10);
        LOG?.error('MAG_INGREDIENTI', 'Colonne mancanti in Magazzino.', { missingCols });
        return;
      }

      // Leggi tutte le righe dati
      const data = shMagazzino.getRange(headerRow + 1, 1, lastRow - headerRow, headers.length).getValues();

      // 3. Aggrega dati
      const aggregati = {};
      let skippedNonInUso = 0;
      let skippedEmptyIngrediente = 0;

      data.forEach(row => {
        const ingrediente = String(row[idx.Ingrediente] || '').trim();
        const nonInUso = row[idx.NonInUso];
        
        // Ignora righe vuote o non in uso
        if (!ingrediente) {
          skippedEmptyIngrediente++;
          return;
        }
        
        if (nonInUso === true || String(nonInUso).toLowerCase() === 'true' || String(nonInUso).toLowerCase() === 'vero') {
          skippedNonInUso++;
          return;
        }

        const reparto = String(row[idx.Reparto] || '').trim();
        const umBase = String(row[idx.UMBase] || '').trim();
        const pzTot = Number(row[idx['PZ TOT']]) || 0;
        const kgTot = Number(row[idx['KG TOT']]) || 0;
        const totEuro = Number(row[idx['Tot €']]) || 0;

        // Chiave aggregazione: ingrediente|reparto|umbase
        const key = `${ingrediente}|${reparto}|${umBase}`;

        if (!aggregati[key]) {
          aggregati[key] = {
            ingrediente,
            reparto,
            umBase,
            pzTot: 0,
            kgTot: 0,
            totEuro: 0
          };
        }

        aggregati[key].pzTot += pzTot;
        aggregati[key].kgTot += kgTot;
        aggregati[key].totEuro += totEuro;
      });

      const numGroupsAggregated = Object.keys(aggregati).length;
      LOG?.info('MAG_INGREDIENTI', `Aggregazione completata: ${numGroupsAggregated} gruppi.`, {
        skippedNonInUso,
        skippedEmptyIngrediente,
        totalRows: data.length
      });

      // 4. Crea/svuota foglio Magazzino_Ingredienti
      let shIngredienti = ss.getSheetByName('Magazzino_Ingredienti');
      if (!shIngredienti) {
        shIngredienti = ss.insertSheet('Magazzino_Ingredienti');
        LOG?.info('MAG_INGREDIENTI', 'Foglio Magazzino_Ingredienti creato.');
      } else {
        shIngredienti.clear();
        LOG?.info('MAG_INGREDIENTI', 'Foglio Magazzino_Ingredienti svuotato.');
      }

      // 5. Scrivi intestazioni
      const newHeaders = [
        'Ingrediente',
        'Reparto',
        'UMBase',
        'PZ TOT',
        'KG TOT',
        'Tot €',
        '€/KG medio',
        '€/PZ medio'
      ];

      shIngredienti.getRange(1, 1, 1, newHeaders.length).setValues([newHeaders]);
      shIngredienti.getRange(1, 1, 1, newHeaders.length).setFontWeight('bold');

      // 6. Prepara righe output
      const outputRows = [];
      for (const key in aggregati) {
        const agg = aggregati[key];
        
        // Calcola medie
        const euroPerKg = (agg.kgTot > 0) ? (agg.totEuro / agg.kgTot) : '';
        const euroPerPz = (agg.pzTot > 0) ? (agg.totEuro / agg.pzTot) : '';

        outputRows.push([
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

      // Ordina per ingrediente, poi reparto
      outputRows.sort((a, b) => {
        const ingredienteCompare = a[0].localeCompare(b[0]);
        if (ingredienteCompare !== 0) return ingredienteCompare;
        return a[1].localeCompare(b[1]);
      });

      // 7. Scrivi righe
      if (outputRows.length > 0) {
        shIngredienti.getRange(2, 1, outputRows.length, newHeaders.length).setValues(outputRows);
        
        // Formatta colonne numeriche
        const lastOutputRow = outputRows.length + 1;
        
        // PZ TOT (col 4)
        shIngredienti.getRange(2, 4, outputRows.length, 1).setNumberFormat('#,##0.####');
        
        // KG TOT (col 5)
        shIngredienti.getRange(2, 5, outputRows.length, 1).setNumberFormat('#,##0.####');
        
        // Tot € (col 6)
        shIngredienti.getRange(2, 6, outputRows.length, 1).setNumberFormat('€ #,##0.00;[Red]-€ #,##0.00;€ 0.00');
        
        // €/KG medio (col 7)
        shIngredienti.getRange(2, 7, outputRows.length, 1).setNumberFormat('€ #,##0.0000;[Red]-€ #,##0.0000;€ 0.0000');
        
        // €/PZ medio (col 8)
        shIngredienti.getRange(2, 8, outputRows.length, 1).setNumberFormat('€ #,##0.0000;[Red]-€ #,##0.0000;€ 0.0000');

        LOG?.info('MAG_INGREDIENTI', `Scritte ${outputRows.length} righe in Magazzino_Ingredienti.`);
      }

      // 8. Freeze header
      shIngredienti.setFrozenRows(1);

      UTIL.showToast(`Report Magazzino Ingredienti aggiornato: ${outputRows.length} righe.`, 'Completato', 5);

    } catch (e) {
      UTIL.showToast('Errore durante la generazione del report.', 'Errore', 10);
      LOG?.error('MAG_INGREDIENTI', 'Errore in buildMagazzinoIngredienti.', {
        error: e.message,
        stack: e.stack
      });
    }
  }

  // API pubblica
  return {
    buildMagazzinoIngredienti
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
function buildMagazzinoIngredienti() {
  MAGAZZINO_INGREDIENTI.buildMagazzinoIngredienti();
}
