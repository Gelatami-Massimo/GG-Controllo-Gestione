// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 122_pnl_confronto.js
// RUOLO: Confronto P&L annuale Gemma vs Zaffiro (solo Gelateria)
// NOTE: Struttura identica al P&L principale, con colonne comparative
// =============================================================

/**
 * Crea foglio di confronto annuale Gemma vs Zaffiro (reparto Gelateria)
 * Struttura: Anno | Gemma | Zaffiro | Delta € | Delta %
 */
function createPnlConfrontoGemmaZaffiro() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetName = 'Confronto Gemma-Zaffiro';
  UTIL.showToast(`Creazione ${sheetName}...`, 'Confronto', 10);

  const VOCE_FATTURATO = 'Fatturato';
  const VOCE_FATTURE_INCASSATE = 'Fatture Incassate';
  const VOCE_CEDOLINI = '3 - Cedolini';
  
  const COSTI_OPERATIVI_GOP = [
    '1 - Food Cost',
    '2 - Consumabili',
    '3 - Cedolini'
  ];
  
  const ALTRI_COSTI = [
    '4 - Personale (costi azienda)',
    '5 - Utenze (utenze e costi fissi)',
    '6 - Automezzi',
    '7 - Struttura (manutenzioni ordinarie)',
    '8 - Gestione (spese generali)',
    '9 - Marketing',
    'Non Categorizzato'
  ];
  
  const FAMIGLIE_ORDINATE = [...COSTI_OPERATIVI_GOP, ...ALTRI_COSTI];
  
  const normalizzaFamiglia = (nome) => String(nome).toLowerCase().replace(/[^a-z]/g, '');
  const FAMIGLIA_MAPPING = new Map();
  FAMIGLIE_ORDINATE.forEach(fam => {
    const key = normalizzaFamiglia(fam);
    FAMIGLIA_MAPPING.set(key, fam);
  });
  
  const trovaFamigliaStandard = (nomeVar) => {
    if (!nomeVar) return 'Non Categorizzato';
    const normalized = normalizzaFamiglia(nomeVar);
    if (FAMIGLIA_MAPPING.has(normalized)) return FAMIGLIA_MAPPING.get(normalized);
    for (const [key, standard] of FAMIGLIA_MAPPING.entries()) {
      if (normalized.includes(key) || key.includes(normalized)) {
        return standard;
      }
    }
    return 'Non Categorizzato';
  };

  let sh = ss.getSheetByName(sheetName);
  if (!sh) { sh = ss.insertSheet(sheetName, 1); }

  // --- DIALOG DI FILTRO ANNO ---
  const ui = SpreadsheetApp.getUi();
  const responseAnno = ui.prompt(
    '📅 FILTRO ANNO',
    'Inserisci anno (es: 2025) oppure lascia VUOTO per tutti:',
    ui.ButtonSet.OK_CANCEL
  );
  
  if (responseAnno.getSelectedButton() === ui.Button.CANCEL) {
    UTIL.showToast('Operazione annullata', 'Info', 3);
    return;
  }
  
  const filtroAnno = responseAnno.getResponseText().trim();

  try {
    sh.clear();
    
    // --- CARICAMENTO DATI (solo Gelateria) ---
    const dataMensili = _getDatiMensiliBySede();
    const famiglieFornitori = _getFamiglieFornitori();
    const aziendaMap = _getAziendaMap();
    const costiAggregati = _getAggregatedCostsBySede(famiglieFornitori, aziendaMap);

    // Mappe separate per Gemma e Zaffiro (solo Gelateria)
    const pnlGemma = new Map();
    const pnlZaffiro = new Map();
    
    // Inizializza mappe
    [pnlGemma, pnlZaffiro].forEach(map => {
      map.set(VOCE_FATTURATO, new Map());
      map.set(VOCE_FATTURE_INCASSATE, new Map());
      COSTI_OPERATIVI_GOP.forEach(fam => map.set(fam, new Map()));
      ALTRI_COSTI.forEach(fam => map.set(fam, new Map()));
    });

    const tuttiGliAnni = new Set();

    // Aggrega dati mensili per anno (solo Gelateria)
    dataMensili.forEach((mesi, sede) => {
      const azienda = aziendaMap.get(sede); // Ottieni azienda dalla mappa
      if (!azienda) {
        LOG.warn('PNL_CONFRONTO', `Sede "${sede}" non trovata in aziendaMap. Saltata.`);
        return; // Salta se azienda non trovata
      }
      
      mesi.forEach((dati, annoMese) => {
        const { fatturato, personale, fattureIncassate, reparto } = dati;
        const anno = annoMese.split('-')[0];
        tuttiGliAnni.add(anno);
        
        // Solo Gelateria (Zaffiro sempre Gelateria, Gemma escludi Hotel)
        const repartoEffettivo = (azienda === 'Zaffiro') ? 'Gelateria' : reparto;
        const isGelateria = !repartoEffettivo || String(repartoEffettivo).toLowerCase() !== 'hotel';
        
        if (!isGelateria) return; // Escludi Hotel
        
        if (azienda === 'Gemma') {
          pnlGemma.get(VOCE_FATTURATO).set(anno, (pnlGemma.get(VOCE_FATTURATO).get(anno) ?? 0) + fatturato);
          pnlGemma.get(VOCE_FATTURE_INCASSATE).set(anno, (pnlGemma.get(VOCE_FATTURE_INCASSATE).get(anno) ?? 0) + (fattureIncassate || 0));
          pnlGemma.get(VOCE_CEDOLINI).set(anno, (pnlGemma.get(VOCE_CEDOLINI).get(anno) ?? 0) + personale);
        } else if (azienda === 'Zaffiro') {
          pnlZaffiro.get(VOCE_FATTURATO).set(anno, (pnlZaffiro.get(VOCE_FATTURATO).get(anno) ?? 0) + fatturato);
          pnlZaffiro.get(VOCE_FATTURE_INCASSATE).set(anno, (pnlZaffiro.get(VOCE_FATTURE_INCASSATE).get(anno) ?? 0) + (fattureIncassate || 0));
          pnlZaffiro.get(VOCE_CEDOLINI).set(anno, (pnlZaffiro.get(VOCE_CEDOLINI).get(anno) ?? 0) + personale);
        }
      });
    });
    
    LOG.info('PNL_CONFRONTO', `Dati aggregati - Gemma Fatturato anni: ${Array.from(pnlGemma.get(VOCE_FATTURATO).keys()).join(', ')}`);
    LOG.info('PNL_CONFRONTO', `Dati aggregati - Zaffiro Fatturato anni: ${Array.from(pnlZaffiro.get(VOCE_FATTURATO).keys()).join(', ')}`);

    // Aggrega costi fornitori per anno (solo Gelateria)
    costiAggregati.forEach((mesi, sede) => {
      mesi.forEach((costiPerFamiglia, annoMese) => {
        const anno = annoMese.split('-')[0];
        tuttiGliAnni.add(anno);
        
        costiPerFamiglia.forEach((infoFamiglia, chiaveAggregazione) => {
          const { costoNetto, reparto, azienda, famiglia: famigliaOriginale } = infoFamiglia;
          const famiglia = trovaFamigliaStandard(famigliaOriginale);
          
          // Solo Gelateria
          const repartoEffettivo = (azienda === 'Zaffiro') ? 'Gelateria' : reparto;
          const isGelateria = !repartoEffettivo || String(repartoEffettivo).toLowerCase() !== 'hotel';
          
          if (!isGelateria) return; // Escludi Hotel
          
          if (azienda === 'Gemma') {
            if (!pnlGemma.has(famiglia)) pnlGemma.set(famiglia, new Map());
            pnlGemma.get(famiglia).set(anno, (pnlGemma.get(famiglia).get(anno) ?? 0) + costoNetto);
          } else if (azienda === 'Zaffiro') {
            if (!pnlZaffiro.has(famiglia)) pnlZaffiro.set(famiglia, new Map());
            pnlZaffiro.get(famiglia).set(anno, (pnlZaffiro.get(famiglia).get(anno) ?? 0) + costoNetto);
          }
        });
      });
    });

    // Filtra anni se specificato
    let anniOrdinati = Array.from(tuttiGliAnni).sort();
    if (filtroAnno) {
      anniOrdinati = anniOrdinati.filter(a => a === filtroAnno);
      if (anniOrdinati.length === 0) {
        UTIL.showToast(`Nessun dato trovato per l'anno ${filtroAnno}`, 'Avviso', 5);
        return;
      }
    }
    
    // --- SCRITTURA FOGLIO ---
    let currentRow = 1;
    const currencyFormat = '€ #,##0.00;[Red]-€ #,##0.00;€ 0.00';
    const percentFormat = '(0.0)%;[Red](0.0)%;(0.0)%';

    anniOrdinati.forEach(anno => {
      currentRow = _writeConfrontoSection(
        sh, currentRow, anno, pnlGemma, pnlZaffiro, 
        COSTI_OPERATIVI_GOP, ALTRI_COSTI, VOCE_FATTURATO, VOCE_FATTURE_INCASSATE, VOCE_CEDOLINI,
        currencyFormat, percentFormat
      );
      currentRow += 3; // Spazio tra anni
    });

    // Ridimensiona colonne
    if (sh.getLastColumn() > 0) {
      GG.get('ERROR_HANDLER').safely(
        () => sh.autoResizeColumns(1, Math.min(sh.getMaxColumns(), 6)),
        { scope: 'CONFRONTO_RESIZE', message: 'Impossibile ridimensionare colonne.' }
      );
    }

    const messaggioAnno = filtroAnno ? ` per anno ${filtroAnno}` : ` per ${anniOrdinati.length} anni`;
    LOG.info('PNL_CONFRONTO', `Confronto Gemma-Zaffiro creato con successo${messaggioAnno}.`);
    UTIL.showToast(`Confronto "${sheetName}" creato!`, 'Completato', 10);
    ss.setActiveSheet(sh);

  } catch (e) {
    LOG.error('PNL_CONFRONTO', `Errore creazione confronto.`, { error: e.message, stack: e.stack });
    throw new Error(`Errore creazione confronto: ${e.message}`);
  }
}

/**
 * Scrive una sezione di confronto per un anno specifico
 * @private
 */
function _writeConfrontoSection(sheet, startRow, anno, pnlGemma, pnlZaffiro, costiOperativiGOP, altriCosti, VOCE_FATTURATO, VOCE_FATTURE_INCASSATE, VOCE_CEDOLINI, currencyFormat, percentFormat) {
  let currentRow = startRow;
  
  // Titolo
  sheet.getRange(currentRow, 1, 1, 6).merge()
    .setValue(`CONFRONTO P&L GELATERIA - ANNO ${anno}`)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setBackground('#e0e0e0');
  currentRow++;
  
  // Header
  const headers = ['Voce', 'Gemma', 'Zaffiro', 'Delta €', 'Delta %', '% su Fatturato Gemma'];
  sheet.getRange(currentRow, 1, 1, 6).setValues([headers]).setFontWeight('bold').setBackground('#f3f3f3');
  currentRow++;
  
  // Helper per ottenere valori
  const getVal = (map, voce, anno) => map.get(voce)?.get(anno) || 0;
  
  // Helper per calcolare percentuali
  const calcDeltaPercent = (valGemma, valZaffiro) => {
    if (valZaffiro === 0) return 0;
    return ((valGemma - valZaffiro) / valZaffiro) * 100;
  };
  
  const calcPercentOnFatt = (valore, fatturatoTotale) => {
    if (fatturatoTotale === 0) return 0;
    return (valore / fatturatoTotale) * 100;
  };
  
  // RICAVI
  const rigaFatt = currentRow;
  const fattGemma = getVal(pnlGemma, VOCE_FATTURATO, anno);
  const fattZaffiro = getVal(pnlZaffiro, VOCE_FATTURATO, anno);
  const deltaFatt = fattGemma - fattZaffiro;
  const deltaPercFatt = calcDeltaPercent(fattGemma, fattZaffiro);
  
  sheet.getRange(currentRow, 1).setValue(VOCE_FATTURATO);
  sheet.getRange(currentRow, 2).setValue(fattGemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(fattZaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 4).setValue(deltaFatt).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(deltaPercFatt / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 6).setValue(calcPercentOnFatt(fattGemma, fattGemma) / 100).setNumberFormat(percentFormat);
  currentRow++;
  
  const rigaFattInc = currentRow;
  const fattIncGemma = getVal(pnlGemma, VOCE_FATTURE_INCASSATE, anno);
  const fattIncZaffiro = getVal(pnlZaffiro, VOCE_FATTURE_INCASSATE, anno);
  const deltaFattInc = fattIncGemma - fattIncZaffiro;
  const deltaPercFattInc = calcDeltaPercent(fattIncGemma, fattIncZaffiro);
  
  sheet.getRange(currentRow, 1).setValue(VOCE_FATTURE_INCASSATE);
  sheet.getRange(currentRow, 2).setValue(fattIncGemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(fattIncZaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 4).setValue(deltaFattInc).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(deltaPercFattInc / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 6).setValue(calcPercentOnFatt(fattIncGemma, fattGemma) / 100).setNumberFormat(percentFormat);
  currentRow++;
  currentRow++; // Spazio
  
  const rigaTotRicavi = currentRow;
  const totRicaviGemma = fattGemma + fattIncGemma;
  const totRicaviZaffiro = fattZaffiro + fattIncZaffiro;
  const deltaTotRicavi = totRicaviGemma - totRicaviZaffiro;
  const deltaPercTotRicavi = calcDeltaPercent(totRicaviGemma, totRicaviZaffiro);
  
  sheet.getRange(currentRow, 1).setValue('(A) - TOTALE RICAVI').setFontWeight('bold').setBackground('#f3f3f3');
  sheet.getRange(currentRow, 2).setValue(totRicaviGemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(totRicaviZaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 4).setValue(deltaTotRicavi).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(deltaPercTotRicavi / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 6).setValue(1.0).setNumberFormat(percentFormat); // 100%
  currentRow++;
  currentRow++; // Spazio
  
  // COSTI OPERATIVI
  const valoriCostiOp = { gemma: 0, zaffiro: 0 };
  costiOperativiGOP.forEach(famiglia => {
    const valGemma = getVal(pnlGemma, famiglia, anno);
    const valZaffiro = getVal(pnlZaffiro, famiglia, anno);
    valoriCostiOp.gemma += valGemma;
    valoriCostiOp.zaffiro += valZaffiro;
    
    const delta = valGemma - valZaffiro;
    const deltaPerc = calcDeltaPercent(valGemma, valZaffiro);
    const percOnFatt = calcPercentOnFatt(valGemma, totRicaviGemma);
    
    sheet.getRange(currentRow, 1).setValue(famiglia);
    sheet.getRange(currentRow, 2).setValue(valGemma).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 3).setValue(valZaffiro).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 4).setValue(delta).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 5).setValue(deltaPerc / 100).setNumberFormat(percentFormat);
    sheet.getRange(currentRow, 6).setValue(percOnFatt / 100).setNumberFormat(percentFormat);
    currentRow++;
  });
  currentRow++; // Spazio
  
  // C1 - TOTALE OPERATIVI
  const rigaC1 = currentRow;
  const deltaC1 = valoriCostiOp.gemma - valoriCostiOp.zaffiro;
  const deltaPercC1 = calcDeltaPercent(valoriCostiOp.gemma, valoriCostiOp.zaffiro);
  const percC1OnFatt = calcPercentOnFatt(valoriCostiOp.gemma, totRicaviGemma);
  
  sheet.getRange(currentRow, 1).setValue('C1 - DI CUI OPERATIVI').setFontWeight('bold').setBackground('#f3f3f3');
  sheet.getRange(currentRow, 2).setValue(valoriCostiOp.gemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(valoriCostiOp.zaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 4).setValue(deltaC1).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(deltaPercC1 / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 6).setValue(percC1OnFatt / 100).setNumberFormat(percentFormat);
  currentRow++;
  currentRow++; // Spazio
  
  // GOP
  const rigaGOP = currentRow;
  const gopGemma = totRicaviGemma - valoriCostiOp.gemma;
  const gopZaffiro = totRicaviZaffiro - valoriCostiOp.zaffiro;
  const deltaGOP = gopGemma - gopZaffiro;
  const deltaPercGOP = calcDeltaPercent(gopGemma, gopZaffiro);
  const percGOPOnFatt = calcPercentOnFatt(gopGemma, totRicaviGemma);
  
  sheet.getRange(currentRow, 1).setValue('GOP (A - C1)').setFontWeight('bold').setBackground('#e0e0e0');
  sheet.getRange(currentRow, 2).setValue(gopGemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(gopZaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 4).setValue(deltaGOP).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(deltaPercGOP / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 6).setValue(percGOPOnFatt / 100).setNumberFormat(percentFormat);
  currentRow++;
  currentRow++; // Spazio
  
  // ALTRI COSTI
  const valoriAltriCosti = { gemma: 0, zaffiro: 0 };
  altriCosti.forEach(famiglia => {
    const valGemma = getVal(pnlGemma, famiglia, anno);
    const valZaffiro = getVal(pnlZaffiro, famiglia, anno);
    valoriAltriCosti.gemma += valGemma;
    valoriAltriCosti.zaffiro += valZaffiro;
    
    const delta = valGemma - valZaffiro;
    const deltaPerc = calcDeltaPercent(valGemma, valZaffiro);
    const percOnFatt = calcPercentOnFatt(valGemma, totRicaviGemma);
    
    sheet.getRange(currentRow, 1).setValue(famiglia);
    sheet.getRange(currentRow, 2).setValue(valGemma).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 3).setValue(valZaffiro).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 4).setValue(delta).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 5).setValue(deltaPerc / 100).setNumberFormat(percentFormat);
    sheet.getRange(currentRow, 6).setValue(percOnFatt / 100).setNumberFormat(percentFormat);
    currentRow++;
  });
  currentRow++; // Spazio
  
  // C - TOTALE COSTI
  const rigaTotCosti = currentRow;
  const totCostiGemma = valoriCostiOp.gemma + valoriAltriCosti.gemma;
  const totCostiZaffiro = valoriCostiOp.zaffiro + valoriAltriCosti.zaffiro;
  const deltaTotCosti = totCostiGemma - totCostiZaffiro;
  const deltaPercTotCosti = calcDeltaPercent(totCostiGemma, totCostiZaffiro);
  const percTotCostiOnFatt = calcPercentOnFatt(totCostiGemma, totRicaviGemma);
  
  sheet.getRange(currentRow, 1).setValue('C - TOTALE COSTI').setFontWeight('bold').setBackground('#f3f3f3');
  sheet.getRange(currentRow, 2).setValue(totCostiGemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(totCostiZaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 4).setValue(deltaTotCosti).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(deltaPercTotCosti / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 6).setValue(percTotCostiOnFatt / 100).setNumberFormat(percentFormat);
  currentRow++;
  currentRow++; // Spazio
  
  // MOL
  const rigaMOL = currentRow;
  const molGemma = totRicaviGemma - totCostiGemma;
  const molZaffiro = totRicaviZaffiro - totCostiZaffiro;
  const deltaMOL = molGemma - molZaffiro;
  const deltaPercMOL = calcDeltaPercent(molGemma, molZaffiro);
  const percMOLOnFatt = calcPercentOnFatt(molGemma, totRicaviGemma);
  
  sheet.getRange(currentRow, 1).setValue('MOL (A-C)').setFontWeight('bold').setBackground('#e0e0e0');
  sheet.getRange(currentRow, 2).setValue(molGemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(molZaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 4).setValue(deltaMOL).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(deltaPercMOL / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 6).setValue(percMOLOnFatt / 100).setNumberFormat(percentFormat);
  currentRow++;
  
  return currentRow;
}
