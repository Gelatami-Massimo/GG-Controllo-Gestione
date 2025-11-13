// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 90_dashboard.js
// VERSIONE: 25.0 (Dashboard & Analytics)
// DESCRIZIONE: Dashboard finanziaria con Totali Annuali e MOL Netto Annuale/Mensile.
// =============================================================

const DASHBOARD = (function () {

  function create() {
    UTIL.showToast('Aggiornamento Dashboard...', 'Dashboard', 10);
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    _ensureDatiMensiliSheet(ss); // Assicura che 'Dati Mensili' esista

    let sh = ss.getSheetByName('Dashboard');
    if (!sh) sh = ss.insertSheet('Dashboard', 0);

    // Pulizia robusta
    sh.clear();
    try { sh.getCharts().forEach(chart => sh.removeChart(chart)); } catch (e) {}
    try { sh.setFrozenRows(0); sh.setFrozenColumns(0); } catch (e) {}
    try { sh.getDataRange().breakApart(); } catch (e) {}

    // Calcolo dati P&L
    const pnlDataBySede   = _calculatePnlBySede();         // { sede -> { anno -> { data: [], annualTotals: {} } } }
    const combinedPnlData = _calculateCombinedPnl(pnlDataBySede); // { anno -> { data: [], annualTotals: {} } }

    let currentRow = 1;
    // Intestazioni tabella dati mensili (8 colonne: aggiunto MOL Netto)
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
    const numCols = headers[0].length;

    // Formati
    const currencyFormat = '€ #,##0.00;[Red](€ #,##0.00);€ 0.00';
    const percentFormat  = '0.00%';

    // Sezione GLOBALE: anni in ordine decrescente numerico
    const anniGlobali = Object.keys(combinedPnlData).map(Number).sort((a, b) => b - a);
    anniGlobali.forEach((anno, index) => {
      if (index > 0) currentRow += 2; // spazio tra anni
      currentRow = _writeSection(sh, {
        title: `RIEPILOGO FINANZIARIO GLOBALE - ANNO ${anno}`,
        headers,
        pnlAnnualData: combinedPnlData[anno],
        startRow: currentRow,
        formatCurrency: currencyFormat,
        formatPercent: percentFormat
      });
    });

    // Sezioni per SEDE (ordine alfabetico sedi, anni decrescenti)
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

    // Autoresize
    if (sh.getLastRow() > 1 && numCols > 1) {
      try { sh.autoResizeColumns(1, numCols); }
      catch (e) { LOG?.warn('DASHBOARD_RESIZE', 'Impossibile ridimensionare automaticamente le colonne.', { error: e.message }); }
    }

    ss.setActiveSheet(sh);
    LOG?.info('DASHBOARD', 'Dashboard aggiornata.');
    UTIL.showToast('Dashboard aggiornata!', 'Completato');
  }

  /**
   * Scrive una sezione (Globale o Sede/Anno) e restituisce la prossima riga disponibile.
   * Usa mappa header -> colonna per formule dinamiche.
   * @private
   */
  function _writeSection(sh, config) {
    try {
      const { title, headers, pnlAnnualData, startRow, formatCurrency, formatPercent } = config;
      const headerNames   = headers[0]; // Array dei nomi delle colonne
      const numDataCols   = headerNames.length;
      const dataRows      = pnlAnnualData?.data || [];
      const dataRowsCount = dataRows.length;

      // Mappa Nome Header -> Lettera Colonna (index 0 -> 'A')
      const headerMap = {};
      headerNames.forEach((name, index) => {
        if (name) headerMap[name] = UTIL.getColumnLetter(index);
      });

      const requiredForFormula = ['Fatturato', 'Costo Fornitori (Netto)', 'Costo Fornitori (Totale)', 'Costo Personale', 'MOL Netto'];
      const missingInMap = requiredForFormula.filter(h => !headerMap[h]);
      if (missingInMap.length > 0) {
        throw new Error(`Nomi header richiesti per le formule non trovati: ${missingInMap.join(', ')}`);
      }

      // Prepara colonne formattazione (usate più avanti)
      const currencyCols = [
        headerMap['Fatturato'],
        headerMap['Costo Fornitori (Netto)'],
        headerMap['Costo Fornitori (Totale)'],
        headerMap['Costo Personale'],
        headerMap['MOL Netto']
      ];
      const percentCols = [
        headerMap['Inc. Costo Netto (%)'],
        headerMap['Inc. Personale (%)']
      ];

      // Riga di inizio dati e fine dati
      const startDataRow = startRow + 2;
      const endDataRow   = startDataRow + dataRowsCount - 1;

      // Righe: Totale Anno e MOL Netto
      const totalRowIndex    = endDataRow + 1;
      const molNettoRowIndex = totalRowIndex + 1;

      // Titolo e Header
      if (numDataCols > 1) {
        sh.getRange(startRow, 2, 1, numDataCols - 1)
          .merge()
          .setValue(title)
          .setFontWeight('bold')
          .setHorizontalAlignment('center')
          .setBackground('#e0e0e0');
      } else {
        sh.getRange(startRow, 1).setValue(title).setFontWeight('bold');
      }
      sh.getRange(startRow + 1, 1, 1, numDataCols)
        .setValues(headers)
        .setFontWeight('bold');

      // Dati mensili
      if (dataRowsCount > 0) {
        const dataRange = sh.getRange(startDataRow, 1, dataRowsCount, numDataCols);
        dataRange.setValues(dataRows);

        // Formattazione dati
        if (formatCurrency) {
          currencyCols.forEach(colLetter => {
            if (colLetter) sh.getRange(`${colLetter}${startDataRow}:${colLetter}${endDataRow}`).setNumberFormat(formatCurrency);
          });
        }
        if (formatPercent) {
          percentCols.forEach(colLetter => {
            if (colLetter) sh.getRange(`${colLetter}${startDataRow}:${colLetter}${endDataRow}`).setNumberFormat(formatPercent);
          });
        }
      }

      // Riga TOTALE ANNO
      const totalRow = sh.getRange(totalRowIndex, 1, 1, numDataCols);
      totalRow.getCell(1, 1).setValue('TOTALE ANNO').setFontWeight('bold').setBackground('#f3f3f3');

      if (dataRowsCount > 0) {
        // Formule di somma sulle colonne economiche
        const colsToSum = [
          headerMap['Fatturato'],
          headerMap['Costo Fornitori (Netto)'],
          headerMap['Costo Fornitori (Totale)'],
          headerMap['Costo Personale'],
          headerMap['MOL Netto']
        ];
        colsToSum.forEach(colLetter => {
          if (!colLetter) return;
          const colIndex = headerNames.findIndex(h => headerMap[h] === colLetter) + 1;
          if (colIndex > 0) {
            totalRow.getCell(1, colIndex).setFormula(`=SUM(${colLetter}${startDataRow}:${colLetter}${endDataRow})`);
          }
        });

        // Incidenze su totale fatturato
        const totalFatturatoCellRef  = `${headerMap['Fatturato']}${totalRowIndex}`;
        const totalCostoNettoCellRef = `${headerMap['Costo Fornitori (Netto)']}${totalRowIndex}`;
        const totalPersonaleCellRef  = `${headerMap['Costo Personale']}${totalRowIndex}`;
        const incCostoNettoColIndex  = headerNames.indexOf('Inc. Costo Netto (%)') + 1;
        const incPersonaleColIndex   = headerNames.indexOf('Inc. Personale (%)') + 1;

        if (incCostoNettoColIndex > 0) totalRow.getCell(1, incCostoNettoColIndex).setFormula(`=IFERROR(${totalCostoNettoCellRef}/${totalFatturatoCellRef},0)`);
        if (incPersonaleColIndex > 0) totalRow.getCell(1, incPersonaleColIndex).setFormula(`=IFERROR(${totalPersonaleCellRef}/${totalFatturatoCellRef},0)`);
      } else {
        totalRow.offset(0, 1, 1, numDataCols - 1).setValue(0);
      }

      // Formattazione riga totale
      if (formatCurrency) {
        currencyCols.forEach(colLetter => {
          if (colLetter) sh.getRange(`${colLetter}${totalRowIndex}`).setNumberFormat(formatCurrency);
        });
      }
      if (formatPercent) {
        percentCols.forEach(colLetter => {
          if (colLetter) sh.getRange(`${colLetter}${totalRowIndex}`).setNumberFormat(formatPercent);
        });
      }

      // Riga MOL NETTO (annuale): scrive SOLO nella colonna MOL Netto
      const molNettoRow = sh.getRange(molNettoRowIndex, 1, 1, numDataCols);
      molNettoRow.getCell(1, 1)
        .setValue('MOL NETTO')
        .setFontWeight('bold')
        .setFontStyle('italic')
        .setBackground('#e0e0e0');

      if (dataRowsCount > 0) {
        const molColLetter        = headerMap['MOL Netto'];
        const fattColLetter       = headerMap['Fatturato'];
        const costoNettoColLetter = headerMap['Costo Fornitori (Netto)'];
        const personaleColLetter  = headerMap['Costo Personale'];
        const molColIndex         = headerNames.indexOf('MOL Netto') + 1;

        if (molColIndex > 0 && fattColLetter && costoNettoColLetter && personaleColLetter) {
          const molFormula = `=${fattColLetter}${totalRowIndex}-${costoNettoColLetter}${totalRowIndex}-${personaleColLetter}${totalRowIndex}`;
          molNettoRow.getCell(1, molColIndex).setFormula(molFormula);
        }

        // Pulisce le altre colonne (tranne la prima e quella del MOL)
        headerNames.forEach((name, index) => {
          const colIndex = index + 1;
          if (colIndex > 1 && colIndex !== molColIndex) {
            molNettoRow.getCell(1, colIndex).setValue('-');
          }
        });
      } else {
        molNettoRow.offset(0, 1, 1, numDataCols - 1).setValue(0);
      }

      // Formattazione riga MOL
      const molColLetterFormat = headerMap['MOL Netto'];
      if (formatCurrency && molColLetterFormat) {
        sh.getRange(`${molColLetterFormat}${molNettoRowIndex}`).setNumberFormat(formatCurrency);
      }
      if (formatPercent) {
        percentCols.forEach(colLetter => {
          if (colLetter) sh.getRange(`${colLetter}${molNettoRowIndex}`).setNumberFormat(formatPercent);
        });
      }

      // Prossima riga
      return molNettoRowIndex + 2;

    } catch (e) {
      LOG?.error('DASHBOARD_WRITE', `Errore scrittura sezione: ${config.title}`, { error: e.message, stack: e.stack });
      return config.startRow + (config.pnlAnnualData?.data?.length || 0) + 5; // fallback
    }
  }

  /**
   * Calcola P&L per Sede/Anno, con MOL mensile calcolato.
   */
  function _calculatePnlBySede() {
    const dataAggregata = new Map(); // K: Sede, V: Map<AnnoMese, {fatturato, personale, costoFornitoriNetto, costoFornitoriTotale}>

    // 1) Dati Mensili (fatturato / personale)
    const shDM = SHEETS.get(SHEETS.SHEET_NAMES.Dati_Mensili);
    if (shDM) {
      try {
        const headerRow = SHEETS._findHeaderRow(shDM, SHEETS.SHEET_NAMES.Dati_Mensili);
        if (shDM.getLastRow() > headerRow) {
          const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Dati_Mensili);
          if (idx.Sede === undefined || idx.AnnoMese === undefined || idx.Fatturato === undefined) {
            LOG?.error('DASHBOARD_CALC', 'Colonne Sede, AnnoMese o Fatturato mancanti in Dati Mensili.');
          } else {
            const idxPersonale = idx.Costo_Personale; // può essere undefined
            const lastColDM = Math.max(idx.Sede, idx.AnnoMese, idx.Fatturato, idxPersonale ?? 0) + 1;
            const dataDM = shDM.getRange(headerRow + 1, 1, shDM.getLastRow() - headerRow, lastColDM).getValues();

            dataDM.forEach(row => {
              const sedeKey  = String(row[idx.Sede] ?? 'Non Assegnata').trim() || 'Non Assegnata';
              const annoMese = String(row[idx.AnnoMese] ?? '').trim();
              if (/^\d{4}-\d{2}$/.test(annoMese)) {
                if (!dataAggregata.has(sedeKey)) dataAggregata.set(sedeKey, new Map());
                let cur = dataAggregata.get(sedeKey).get(annoMese)
                  || { fatturato: 0, personale: 0, costoFornitoriNetto: 0, costoFornitoriTotale: 0 };
                cur.fatturato += UTIL.parseNumSmart(row[idx.Fatturato]);
                if (idxPersonale !== undefined) cur.personale += UTIL.parseNumSmart(row[idxPersonale]);
                dataAggregata.get(sedeKey).set(annoMese, cur);
              }
            });
          }
        }
      } catch (e) { LOG?.error('DASHBOARD_CALC', 'Errore lettura Dati Mensili.', { error: e.message }); }
    } else {
      LOG?.warn('DASHBOARD_CALC', 'Foglio Dati Mensili non trovato.');
    }

    // 2) Costi Fornitori da Fatture (imponibile = netto, documento = totale)
    const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    if (shF) {
      try {
        const headerRow = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
        if (shF.getLastRow() > headerRow) {
          const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
          if (idx.Sede === undefined || idx.Data === undefined || idx.TotImponibile === undefined || idx.TotDocumento === undefined) {
            LOG?.error('DASHBOARD_CALC', 'Colonne Sede, Data, TotImponibile o TotDocumento mancanti in Fatture.');
          } else {
            const lastColF = Math.max(idx.Sede, idx.Data, idx.TotImponibile, idx.TotDocumento) + 1;
            const fattureData = shF.getRange(headerRow + 1, 1, shF.getLastRow() - headerRow, lastColF).getValues();

            fattureData.forEach(row => {
              const sedeKey = String(row[idx.Sede] ?? 'Non Assegnata').trim() || 'Non Assegnata';
              const data    = row[idx.Data];
              const costoNetto  = UTIL.parseNumSmart(row[idx.TotImponibile]);
              const costoTotale = UTIL.parseNumSmart(row[idx.TotDocumento]);
              if (data instanceof Date && !isNaN(data.getTime())) {
                const annoMese = `${data.getFullYear()}-${('0' + (data.getMonth() + 1)).slice(-2)}`;
                if (!dataAggregata.has(sedeKey)) dataAggregata.set(sedeKey, new Map());
                let cur = dataAggregata.get(sedeKey).get(annoMese)
                  || { fatturato: 0, personale: 0, costoFornitoriNetto: 0, costoFornitoriTotale: 0 };
                cur.costoFornitoriNetto  += costoNetto;
                cur.costoFornitoriTotale += costoTotale;
                dataAggregata.get(sedeKey).set(annoMese, cur);
              }
            });
          }
        }
      } catch (e) { LOG?.error('DASHBOARD_CALC', 'Errore lettura Fatture.', { error: e.message }); }
    } else {
      LOG?.warn('DASHBOARD_CALC', 'Foglio Fatture non trovato.');
    }

    // 3) Output: { sede -> { anno -> { data: [...], annualTotals: {...} } } }
    const output = {};
    dataAggregata.forEach((datiMeseMap, sede) => {
      if (!output[sede]) output[sede] = {};
      const yearlyTotals = {}; // { anno: { ... } }

      datiMeseMap.forEach((valori, annoMese) => {
        const [annoStr, meseStr] = annoMese.split('-');
        const anno = parseInt(annoStr, 10);

        if (!output[sede][anno]) {
          output[sede][anno] = { data: [], annualTotals: { fatturato: 0, costoFornitoriNetto: 0, costoFornitoriTotale: 0, personale: 0, mol: 0 } };
        }
        if (!yearlyTotals[anno]) {
          yearlyTotals[anno] = { fatturato: 0, costoFornitoriNetto: 0, costoFornitoriTotale: 0, personale: 0, mol: 0 };
        }

        // Totali annuali
        yearlyTotals[anno].fatturato           += valori.fatturato;
        yearlyTotals[anno].costoFornitoriNetto  += valori.costoFornitoriNetto;
        yearlyTotals[anno].costoFornitoriTotale += valori.costoFornitoriTotale;
        yearlyTotals[anno].personale           += valori.personale;

        // Incidenze mensili
        const incCostoNetto = valori.fatturato !== 0 ? (valori.costoFornitoriNetto / valori.fatturato) : 0;
        const incPersonale  = valori.fatturato !== 0 ? (valori.personale / valori.fatturato) : 0;

        // MOL mensile
        const molMensile = (valori.fatturato - valori.costoFornitoriNetto - valori.personale);

        // Riga dati (8 colonne)
        output[sede][anno].data.push([
          meseStr,
          valori.fatturato,
          valori.costoFornitoriNetto,
          valori.costoFornitoriTotale,
          valori.personale,
          incCostoNetto,
          incPersonale,
          molMensile
        ]);
      });

      // Assegna i totali annuali (incluso MOL annuale calcolato da totali)
      for (const anno in yearlyTotals) {
        if (output[sede][anno]) {
          const t = yearlyTotals[anno];
          t.mol = t.fatturato - t.costoFornitoriNetto - t.personale;
          output[sede][anno].annualTotals = t;
        }
      }

      // Ordina i mesi (stringhe '01'..'12')
      for (const anno in output[sede]) {
        if (output[sede][anno].data) {
          output[sede][anno].data.sort((a, b) => a[0].localeCompare(b[0]));
        }
      }
    });
    return output;
  }

  /**
   * Calcola P&L aggregato (tutte le sedi), per Anno, con MOL mensile.
   */
  function _calculateCombinedPnl(pnlDataBySede) {
    // Anno -> { meseStr -> accumulati }
    const agg = new Map(); // K: anno (number), V: Map<meseStr, { fatturato, costoFornitoriNetto, costoFornitoriTotale, personale }>

    for (const [, anniObj] of Object.entries(pnlDataBySede)) {
      for (const [annoStr, annoData] of Object.entries(anniObj)) {
        const anno = Number(annoStr);
        if (!agg.has(anno)) agg.set(anno, new Map());

        if (annoData?.data) {
          annoData.data.forEach(row => {
            // row = [meseStr, fatturato, costoNetto, costoTotale, personale, incCostoNetto, incPersonale, molMensile]
            const meseStr = row[0];
            const cur = agg.get(anno).get(meseStr) || { fatturato: 0, costoFornitoriNetto: 0, costoFornitoriTotale: 0, personale: 0 };
            cur.fatturato            += row[1];
            cur.costoFornitoriNetto  += row[2];
            cur.costoFornitoriTotale += row[3];
            cur.personale            += row[4];
            agg.get(anno).set(meseStr, cur);
          });
        }
      }
    }

    // Costruzione output
    const output = {}; // { anno -> { data: [...], annualTotals: {...} } }
    for (const [anno, mesiMap] of agg.entries()) {
      const dataRows = [];
      const annualTotals = { fatturato: 0, costoFornitoriNetto: 0, costoFornitoriTotale: 0, personale: 0, mol: 0 };

      // Ordina mesi
      const mesiOrd = Array.from(mesiMap.keys()).sort((a, b) => a.localeCompare(b));
      mesiOrd.forEach(meseStr => {
        const v = mesiMap.get(meseStr);
        const incCostoNetto = v.fatturato !== 0 ? (v.costoFornitoriNetto / v.fatturato) : 0;
        const incPersonale  = v.fatturato !== 0 ? (v.personale / v.fatturato) : 0;
        const molMensile    = v.fatturato - v.costoFornitoriNetto - v.personale;

        dataRows.push([
          meseStr,
          v.fatturato,
          v.costoFornitoriNetto,
          v.costoFornitoriTotale,
          v.personale,
          incCostoNetto,
          incPersonale,
          molMensile
        ]);

        annualTotals.fatturato           += v.fatturato;
        annualTotals.costoFornitoriNetto  += v.costoFornitoriNetto;
        annualTotals.costoFornitoriTotale += v.costoFornitoriTotale;
        annualTotals.personale            += v.personale;
      });

      annualTotals.mol = annualTotals.fatturato - annualTotals.costoFornitoriNetto - annualTotals.personale;
      output[anno] = { data: dataRows, annualTotals };
    }

    return output;
  }

  /**
   * Assicura l'esistenza e le intestazioni del foglio 'Dati Mensili'.
   */
  function _ensureDatiMensiliSheet(ss) {
    try {
      const sheetName = SHEETS.SHEET_NAMES.Dati_Mensili;
      const schema = SHEETS.SCHEMAS[sheetName];
      if (!schema) {
        LOG?.error('DASHBOARD_ENSURE', `Schema non definito per '${sheetName}'.`);
        return;
      }

      let sh = ss.getSheetByName(sheetName);
      if (!sh) {
        sh = ss.insertSheet(sheetName);
        LOG?.info('DASHBOARD_ENSURE', `Foglio '${sheetName}' creato.`);
      }

      SHEETS._ensureHeaders(sh, schema, sheetName);
    } catch (e) {
      LOG?.error('DASHBOARD_ENSURE', `Errore creazione/verifica '${SHEETS.SHEET_NAMES.Dati_Mensili}'.`, { error: e.message });
    }
  }

  return { create };
})();

// Registra DASHBOARD nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('DASHBOARD', ['SHEETS', 'LOG', 'UTIL']);
}

// Registra DASHBOARD nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('DASHBOARD', DASHBOARD);
}
