// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 090_dashboard.js
// RUOLO: Dashboard finanziaria con KPI, MOL, totali annuali/mensili.
// NOTE: REFACTORED v2 - Usa SHARED_UTILS per accesso fogli, date e sicurezza.
// =============================================================

const DASHBOARD = (function () {

  /**
   * Crea o aggiorna il foglio Dashboard con KPI finanziari, MOL e dati annuali/mensili.
   */
  function create() {
    // Wrapper SafeExecute: gestisce try-catch, logging errori e toast UI
    return SHARED_UTILS.safeExecute(
      () => {
        const ss = SpreadsheetApp.getActiveSpreadsheet();

        // Assicura esistenza fogli dipendenti
        _ensureDatiMensiliSheet(ss);

        let sh = ss.getSheetByName('Dashboard');
        if (!sh) sh = ss.insertSheet('Dashboard', 0);

        // Pulizia robusta
        sh.clear();
        try { sh.getCharts().forEach(chart => sh.removeChart(chart)); } catch (e) {}
        try { sh.setFrozenRows(0); sh.setFrozenColumns(0); } catch (e) {}
        try { sh.getDataRange().breakApart(); } catch (e) {}

        // --- FASE 1: Calcolo Dati ---
        // Calcola i dati aggregati per sede e poi combinati globalmente
        const pnlDataBySede    = _calculatePnlBySede();
        const combinedPnlData = _calculateCombinedPnl(pnlDataBySede);

        // --- FASE 2: Scrittura Report ---
        let currentRow = 1;
        
        const headers = [[
          'Mese',
          'Fatturato',
          'Costo Fornitori (Netto)',
          'Costo Fornitori (Totale)',
          'Costo Personale',
          'Inc. Costo Netto (%)',
          'Inc. Personale (%)',
          'MOL Netto'
        ]];
        
        const currencyFormat = '€ #,##0.00;[Red](€ #,##0.00);€ 0.00';
        const percentFormat  = '0.00%';

        // 2a. Sezione GLOBALE (Anni decrescenti)
        const anniGlobali = Object.keys(combinedPnlData).map(Number).sort((a, b) => b - a);
        anniGlobali.forEach((anno, index) => {
          if (index > 0) currentRow += 2;
          currentRow = _writeSection(sh, {
            title: `RIEPILOGO FINANZIARIO GLOBALE - ANNO ${anno}`,
            headers,
            pnlAnnualData: combinedPnlData[anno],
            startRow: currentRow,
            formatCurrency: currencyFormat,
            formatPercent: percentFormat
          });
        });

        // 2b. Sezioni per SEDE
        currentRow += 2;
        Object.keys(pnlDataBySede).sort().forEach(sede => {
          const anniSede = Object.keys(pnlDataBySede[sede]).map(Number).sort((a, b) => b - a);
          anniSede.forEach((anno, index) => {
            if (index > 0) currentRow += 2;
            const pnlData = pnlDataBySede[sede][anno];
            if (pnlData && pnlData.data && pnlData.data.length > 0) {
              currentRow = _writeSection(sh, {
                title: `DETTAGLIO FINANZIARIO - SEDE: ${sede} - ANNO ${anno}`,
                headers,
                pnlAnnualData: pnlData,
                startRow: currentRow,
                formatCurrency: currencyFormat,
                formatPercent: percentFormat
              });
            }
          });
          currentRow += 2;
        });

        // Autoresize finale
        if (sh.getLastRow() > 1) {
          try { sh.autoResizeColumns(1, headers[0].length); } catch (e) {}
        }

        ss.setActiveSheet(sh);
        return { success: true };
      },
      'DASHBOARD',
      {
        errorMessage: 'Errore aggiornamento Dashboard',
        showToast: true,
        onSuccess: () => LOG.info('DASHBOARD', 'Dashboard aggiornata con successo.')
      }
    );
  }

  /**
   * Scrive una sezione (Globale o Sede/Anno) sul foglio.
   * @private
   */
  function _writeSection(sh, config) {
    try {
      const { title, headers, pnlAnnualData, startRow, formatCurrency, formatPercent } = config;
      const headerNames    = headers[0];
      const numDataCols    = headerNames.length;
      const dataRows       = pnlAnnualData?.data || [];
      const dataRowsCount  = dataRows.length;

      // Mappa Nome Header -> Lettera Colonna (es. 'Fatturato' -> 'B')
      const headerMap = {};
      headerNames.forEach((name, index) => {
        if (name) headerMap[name] = SHARED_UTILS.getColumnLetter(index);
      });

      // Calcolo indici righe
      const startDataRow = startRow + 2;
      const endDataRow   = startDataRow + dataRowsCount - 1;
      const totalRowIndex    = endDataRow + 1;
      const molNettoRowIndex = totalRowIndex + 1;

      // Scrittura Titolo e Header
      const titleRange = numDataCols > 1 ? sh.getRange(startRow, 2, 1, numDataCols - 1).merge() : sh.getRange(startRow, 1);
      titleRange.setValue(title).setFontWeight('bold').setHorizontalAlignment('center').setBackground('#e0e0e0');
      sh.getRange(startRow + 1, 1, 1, numDataCols).setValues(headers).setFontWeight('bold');

      // Scrittura Dati Mensili
      if (dataRowsCount > 0) {
        sh.getRange(startDataRow, 1, dataRowsCount, numDataCols).setValues(dataRows);
        
        // Formattazione colonne
        const currencyCols = ['Fatturato', 'Costo Fornitori (Netto)', 'Costo Fornitori (Totale)', 'Costo Personale', 'MOL Netto'];
        const percentCols  = ['Inc. Costo Netto (%)', 'Inc. Personale (%)'];
        
        if (formatCurrency) {
          currencyCols.forEach(colName => {
            const colL = headerMap[colName];
            if(colL) sh.getRange(`${colL}${startDataRow}:${colL}${endDataRow}`).setNumberFormat(formatCurrency);
          });
        }
        if (formatPercent) {
          percentCols.forEach(colName => {
            const colL = headerMap[colName];
            if(colL) sh.getRange(`${colL}${startDataRow}:${colL}${endDataRow}`).setNumberFormat(formatPercent);
          });
        }
      }

      // Riga TOTALE ANNO
      const totalRow = sh.getRange(totalRowIndex, 1, 1, numDataCols);
      totalRow.getCell(1, 1).setValue('TOTALE ANNO').setFontWeight('bold').setBackground('#f3f3f3');

      if (dataRowsCount > 0) {
        // Formule Somma
        const colsToSum = ['Fatturato', 'Costo Fornitori (Netto)', 'Costo Fornitori (Totale)', 'Costo Personale', 'MOL Netto'];
        colsToSum.forEach(colName => {
          const colL = headerMap[colName];
          const colIdx = headerNames.indexOf(colName) + 1;
          if (colL && colIdx > 0) {
            totalRow.getCell(1, colIdx).setFormula(`=SUM(${colL}${startDataRow}:${colL}${endDataRow})`);
          }
        });

        // Formule Incidenze
        const totalFatt = `${headerMap['Fatturato']}${totalRowIndex}`;
        const totalCosto = `${headerMap['Costo Fornitori (Netto)']}${totalRowIndex}`;
        const totalPers  = `${headerMap['Costo Personale']}${totalRowIndex}`;
        
        const idxIncCosto = headerNames.indexOf('Inc. Costo Netto (%)') + 1;
        if (idxIncCosto > 0) totalRow.getCell(1, idxIncCosto).setFormula(`=IFERROR(${totalCosto}/${totalFatt},0)`);
        
        const idxIncPers = headerNames.indexOf('Inc. Personale (%)') + 1;
        if (idxIncPers > 0) totalRow.getCell(1, idxIncPers).setFormula(`=IFERROR(${totalPers}/${totalFatt},0)`);
      } else {
        totalRow.offset(0, 1, 1, numDataCols - 1).setValue(0);
      }
      
      // Formatta riga totale
      if (formatCurrency) totalRow.setNumberFormat(formatCurrency); // Applica genericamente poi sovrascrivi %
      const idxP1 = headerNames.indexOf('Inc. Costo Netto (%)') + 1;
      const idxP2 = headerNames.indexOf('Inc. Personale (%)') + 1;
      if(idxP1>0) totalRow.getCell(1, idxP1).setNumberFormat(formatPercent);
      if(idxP2>0) totalRow.getCell(1, idxP2).setNumberFormat(formatPercent);


      // Riga MOL NETTO
      const molRow = sh.getRange(molNettoRowIndex, 1, 1, numDataCols);
      molRow.getCell(1, 1).setValue('MOL NETTO').setFontWeight('bold').setFontStyle('italic').setBackground('#e0e0e0');

      if (dataRowsCount > 0) {
        const molColIdx = headerNames.indexOf('MOL Netto') + 1;
        if (molColIdx > 0) {
          const f = headerMap['Fatturato'];
          const c = headerMap['Costo Fornitori (Netto)'];
          const p = headerMap['Costo Personale'];
          molRow.getCell(1, molColIdx).setFormula(`=${f}${totalRowIndex}-${c}${totalRowIndex}-${p}${totalRowIndex}`);
        }
        // Pulisci celle intermedie
        for(let i=2; i<numDataCols; i++) {
             if(i !== molColIdx) molRow.getCell(1, i).setValue('-');
        }
      }
      if (formatCurrency && headerMap['MOL Netto']) {
         sh.getRange(`${headerMap['MOL Netto']}${molNettoRowIndex}`).setNumberFormat(formatCurrency);
      }

      return molNettoRowIndex + 2;

    } catch (e) {
      LOG.error('DASHBOARD_WRITE', `Errore scrittura sezione: ${config.title}`, { error: e.message });
      return config.startRow + 10; // Fallback per non sovrascrivere
    }
  }

  /**
   * Calcola P&L per Sede/Anno leggendo i dati dai fogli.
   * REFACTORED: Usa getSheetContext per lettura veloce in memoria.
   */
  function _calculatePnlBySede() {
    const dataAggregata = new Map(); 

    // 1. Lettura 'Dati Mensili'
    const ctxDM = SHARED_UTILS.getSheetContext(SHEETS.SHEET_NAMES.Dati_Mensili);
    if (ctxDM) {
      try {
        const data = ctxDM.sheet.getRange(ctxDM.headerRow + 1, 1, ctxDM.lastRow - ctxDM.headerRow, ctxDM.lastCol).getValues();
        const processedKeys = new Set(); // Anti-duplicati: traccia chiavi già processate
        
        data.forEach(row => {
          const sedeKey  = String(row[ctxDM.idx.Sede] ?? 'Non Assegnata').trim() || 'Non Assegnata';
          const annoMese = String(row[ctxDM.idx.AnnoMese] ?? '').trim();
          
          if (/^\d{4}-\d{2}$/.test(annoMese)) {
            // Controllo duplicati
            const checkKey = `${sedeKey}_${annoMese}`;
            if (processedKeys.has(checkKey)) {
              LOG.warn('DASHBOARD_DUPLICATE', `Trovato duplicato in Dati Mensili per ${sedeKey} nel mese ${annoMese}. I dati verranno sommati, verificare input manuale.`);
            }
            processedKeys.add(checkKey);
            
            if (!dataAggregata.has(sedeKey)) dataAggregata.set(sedeKey, new Map());
            let cur = dataAggregata.get(sedeKey).get(annoMese) || _createEmptyMonth();
            
            cur.fatturato += SHARED_UTILS.toNumber(row[ctxDM.idx.Fatturato]);
            if (ctxDM.idx.Costo_Personale !== undefined) {
              cur.personale += SHARED_UTILS.toNumber(row[ctxDM.idx.Costo_Personale]);
            }
            dataAggregata.get(sedeKey).set(annoMese, cur);
          }
        });
      } catch (e) { LOG.error('DASHBOARD_CALC', 'Errore lettura Dati Mensili', { error: e.message }); }
    }

    // 2. Lettura 'Fatture' (Costi Fornitori)
    const ctxF = SHARED_UTILS.getSheetContext(SHEETS.SHEET_NAMES.Fatture);
    if (ctxF) {
      try {
        // Verifica colonne minime
        if (ctxF.idx.TotImponibile === undefined || ctxF.idx.TotDocumento === undefined) {
           throw new Error("Colonne TotImponibile/TotDocumento mancanti in Fatture");
        }

        const data = ctxF.sheet.getRange(ctxF.headerRow + 1, 1, ctxF.lastRow - ctxF.headerRow, ctxF.lastCol).getValues();
        
        data.forEach(row => {
          const sedeKey = String(row[ctxF.idx.Sede] ?? 'Non Assegnata').trim() || 'Non Assegnata';
          const dataVal = row[ctxF.idx.Data];
          
          if (SHARED_UTILS.isValidDate(dataVal)) {
            const ymObj = SHARED_UTILS.date.extractYearMonth(dataVal);
            const annoMese = `${ymObj.anno}-${String(ymObj.mese).padStart(2, '0')}`;
            
            const costoNetto  = SHARED_UTILS.toNumber(row[ctxF.idx.TotImponibile]);
            const costoTotale = SHARED_UTILS.toNumber(row[ctxF.idx.TotDocumento]);
            
            if (!dataAggregata.has(sedeKey)) dataAggregata.set(sedeKey, new Map());
            let cur = dataAggregata.get(sedeKey).get(annoMese) || _createEmptyMonth();
            
            cur.costoFornitoriNetto  += costoNetto;
            cur.costoFornitoriTotale += costoTotale;
            dataAggregata.get(sedeKey).set(annoMese, cur);
          }
        });
      } catch (e) { LOG.error('DASHBOARD_CALC', 'Errore lettura Fatture', { error: e.message }); }
    }

    // 3. Formattazione Output
    const output = {};
    dataAggregata.forEach((datiMeseMap, sede) => {
      if (!output[sede]) output[sede] = {};
      const yearlyTotals = {}; 

      datiMeseMap.forEach((valori, annoMese) => {
        const [annoStr, meseStr] = annoMese.split('-');
        const anno = parseInt(annoStr, 10);

        if (!output[sede][anno]) {
          output[sede][anno] = { data: [], annualTotals: _createEmptyTotals() };
        }
        if (!yearlyTotals[anno]) yearlyTotals[anno] = _createEmptyTotals();

        _accumulateTotals(yearlyTotals[anno], valori);

        // Calcoli riga
        const incCostoNetto = valori.fatturato !== 0 ? (valori.costoFornitoriNetto / valori.fatturato) : 0;
        const incPersonale  = valori.fatturato !== 0 ? (valori.personale / valori.fatturato) : 0;
        const molMensile    = (valori.fatturato - valori.costoFornitoriNetto - valori.personale);

        output[sede][anno].data.push([
          meseStr, valori.fatturato, valori.costoFornitoriNetto, valori.costoFornitoriTotale, valori.personale,
          incCostoNetto, incPersonale, molMensile
        ]);
      });

      for (const anno in yearlyTotals) {
        if (output[sede][anno]) {
          const t = yearlyTotals[anno];
          t.mol = t.fatturato - t.costoFornitoriNetto - t.personale;
          output[sede][anno].annualTotals = t;
        }
      }

      for (const anno in output[sede]) {
        if (output[sede][anno].data) {
          output[sede][anno].data.sort((a, b) => a[0].localeCompare(b[0]));
        }
      }
    });

    return output;
  }

  /**
   * Calcola aggregato globale.
   */
  function _calculateCombinedPnl(pnlDataBySede) {
    const agg = new Map(); // Anno -> Map<Mese, Totals>

    for (const [, anniObj] of Object.entries(pnlDataBySede)) {
      for (const [annoStr, annoData] of Object.entries(anniObj)) {
        const anno = Number(annoStr);
        if (!agg.has(anno)) agg.set(anno, new Map());

        if (annoData?.data) {
          annoData.data.forEach(row => {
            const meseStr = row[0];
            let cur = agg.get(anno).get(meseStr) || _createEmptyTotals();
            
            cur.fatturato            += row[1];
            cur.costoFornitoriNetto  += row[2];
            cur.costoFornitoriTotale += row[3];
            cur.personale            += row[4];
            agg.get(anno).set(meseStr, cur);
          });
        }
      }
    }

    const output = {};
    for (const [anno, mesiMap] of agg.entries()) {
      const dataRows = [];
      const annualTotals = _createEmptyTotals();
      const mesiOrd = Array.from(mesiMap.keys()).sort((a, b) => a.localeCompare(b));
      
      mesiOrd.forEach(meseStr => {
        const v = mesiMap.get(meseStr);
        const incCostoNetto = v.fatturato !== 0 ? (v.costoFornitoriNetto / v.fatturato) : 0;
        const incPersonale  = v.fatturato !== 0 ? (v.personale / v.fatturato) : 0;
        const molMensile    = v.fatturato - v.costoFornitoriNetto - v.personale;

        dataRows.push([ meseStr, v.fatturato, v.costoFornitoriNetto, v.costoFornitoriTotale, v.personale, incCostoNetto, incPersonale, molMensile ]);
        _accumulateTotals(annualTotals, v);
      });
      
      annualTotals.mol = annualTotals.fatturato - annualTotals.costoFornitoriNetto - annualTotals.personale;
      output[anno] = { data: dataRows, annualTotals };
    }
    return output;
  }

  // --- Helpers interni ---
  function _createEmptyMonth() {
    return { fatturato: 0, personale: 0, costoFornitoriNetto: 0, costoFornitoriTotale: 0 };
  }
  function _createEmptyTotals() {
    return { fatturato: 0, costoFornitoriNetto: 0, costoFornitoriTotale: 0, personale: 0, mol: 0 };
  }
  function _accumulateTotals(target, source) {
    target.fatturato            += source.fatturato;
    target.costoFornitoriNetto  += source.costoFornitoriNetto;
    target.costoFornitoriTotale += source.costoFornitoriTotale;
    target.personale            += source.personale;
  }

  function _ensureDatiMensiliSheet(ss) {
    SHARED_UTILS.safeExecute(() => {
      const sheetName = SHEETS.SHEET_NAMES.Dati_Mensili;
      const schema = SHEETS.SCHEMAS[sheetName];
      if (!schema) throw new Error(`Schema non definito per '${sheetName}'.`);

      let sh = ss.getSheetByName(sheetName);
      if (!sh) {
        sh = ss.insertSheet(sheetName);
        LOG?.info('DASHBOARD_ENSURE', `Foglio '${sheetName}' creato.`);
      }
      SHEETS._ensureHeaders(sh, schema, sheetName);
    }, 'DASHBOARD_ENSURE', { showToast: false });
  }

  return { create };
})();

// Registra DASHBOARD
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('DASHBOARD', ['SHEETS', 'LOG', 'SHARED_UTILS']);
}
if (typeof GG !== 'undefined') {
  GG.register('DASHBOARD', DASHBOARD);
}