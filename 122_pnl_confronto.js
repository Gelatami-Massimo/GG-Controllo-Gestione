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
  SHARED_UTILS.showToast(`Creazione ${sheetName}...`, 'Confronto', 10);

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
    SHARED_UTILS.showToast('Operazione annullata', 'Info', 3);
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

    // Mappe per Gemma, Zaffiro e Globale (Gemma+Zaffiro) - SOLO GELATERIA
    const pnlGemma = new Map();
    const pnlZaffiro = new Map();
    const pnlGlobale = new Map(); // Somma Gemma + Zaffiro
    
    // Inizializza mappe
    [pnlGemma, pnlZaffiro, pnlGlobale].forEach(map => {
      map.set(VOCE_FATTURATO, new Map());
      map.set(VOCE_FATTURE_INCASSATE, new Map());
      COSTI_OPERATIVI_GOP.forEach(fam => map.set(fam, new Map()));
      ALTRI_COSTI.forEach(fam => map.set(fam, new Map()));
    });

    const tuttiGliAnni = new Set();

    // Aggrega dati mensili per anno (SOLO GELATERIA, NO HOTEL)
    dataMensili.forEach((mesi, sede) => {
      const azienda = aziendaMap.get(sede);
      if (!azienda) {
        LOG.warn('PNL_CONFRONTO', `Sede "${sede}" non trovata in aziendaMap. Saltata.`);
        return;
      }
      
      mesi.forEach((dati, annoMese) => {
        const { fatturato, personale, fattureIncassate, reparto } = dati;
        const anno = annoMese.split('-')[0];
        tuttiGliAnni.add(anno);
        
        // SOLO GELATERIA (escludi Hotel)
        const repartoEffettivo = (azienda === 'Zaffiro') ? 'Gelateria' : reparto;
        const isGelateria = !repartoEffettivo || String(repartoEffettivo).toLowerCase() !== 'hotel';
        
        if (!isGelateria) return; // Skip Hotel
        
        // Aggrega per azienda
        if (azienda === 'Gemma') {
          pnlGemma.get(VOCE_FATTURATO).set(anno, (pnlGemma.get(VOCE_FATTURATO).get(anno) ?? 0) + fatturato);
          pnlGemma.get(VOCE_FATTURE_INCASSATE).set(anno, (pnlGemma.get(VOCE_FATTURE_INCASSATE).get(anno) ?? 0) + (fattureIncassate || 0));
          pnlGemma.get(VOCE_CEDOLINI).set(anno, (pnlGemma.get(VOCE_CEDOLINI).get(anno) ?? 0) + personale);
        } else if (azienda === 'Zaffiro') {
          pnlZaffiro.get(VOCE_FATTURATO).set(anno, (pnlZaffiro.get(VOCE_FATTURATO).get(anno) ?? 0) + fatturato);
          pnlZaffiro.get(VOCE_FATTURE_INCASSATE).set(anno, (pnlZaffiro.get(VOCE_FATTURE_INCASSATE).get(anno) ?? 0) + (fattureIncassate || 0));
          pnlZaffiro.get(VOCE_CEDOLINI).set(anno, (pnlZaffiro.get(VOCE_CEDOLINI).get(anno) ?? 0) + personale);
        }
        
        // Aggrega GLOBALE (Gemma + Zaffiro)
        pnlGlobale.get(VOCE_FATTURATO).set(anno, (pnlGlobale.get(VOCE_FATTURATO).get(anno) ?? 0) + fatturato);
        pnlGlobale.get(VOCE_FATTURE_INCASSATE).set(anno, (pnlGlobale.get(VOCE_FATTURE_INCASSATE).get(anno) ?? 0) + (fattureIncassate || 0));
        pnlGlobale.get(VOCE_CEDOLINI).set(anno, (pnlGlobale.get(VOCE_CEDOLINI).get(anno) ?? 0) + personale);
      });
    });
    
    LOG.info('PNL_CONFRONTO', `Dati aggregati - Gemma Fatturato anni: ${Array.from(pnlGemma.get(VOCE_FATTURATO).keys()).join(', ')}`);
    LOG.info('PNL_CONFRONTO', `Dati aggregati - Zaffiro Fatturato anni: ${Array.from(pnlZaffiro.get(VOCE_FATTURATO).keys()).join(', ')}`);

    // Aggrega costi fornitori per anno (SOLO GELATERIA, NO HOTEL)
    costiAggregati.forEach((mesi, sede) => {
      mesi.forEach((costiPerFamiglia, annoMese) => {
        const anno = annoMese.split('-')[0];
        tuttiGliAnni.add(anno);
        
        costiPerFamiglia.forEach((infoFamiglia, chiaveAggregazione) => {
          const { costoNetto, reparto, azienda, famiglia: famigliaOriginale } = infoFamiglia;
          const famiglia = trovaFamigliaStandard(famigliaOriginale);
          
          // SOLO GELATERIA (escludi Hotel)
          const repartoEffettivo = (azienda === 'Zaffiro') ? 'Gelateria' : reparto;
          const isGelateria = !repartoEffettivo || String(repartoEffettivo).toLowerCase() !== 'hotel';
          
          if (!isGelateria) return; // Skip Hotel
          
          // Aggrega per azienda
          if (azienda === 'Gemma') {
            if (!pnlGemma.has(famiglia)) pnlGemma.set(famiglia, new Map());
            pnlGemma.get(famiglia).set(anno, (pnlGemma.get(famiglia).get(anno) ?? 0) + costoNetto);
          } else if (azienda === 'Zaffiro') {
            if (!pnlZaffiro.has(famiglia)) pnlZaffiro.set(famiglia, new Map());
            pnlZaffiro.get(famiglia).set(anno, (pnlZaffiro.get(famiglia).get(anno) ?? 0) + costoNetto);
          }
          
          // Aggrega GLOBALE (Gemma + Zaffiro)
          if (!pnlGlobale.has(famiglia)) pnlGlobale.set(famiglia, new Map());
          pnlGlobale.get(famiglia).set(anno, (pnlGlobale.get(famiglia).get(anno) ?? 0) + costoNetto);
        });
      });
    });

    // Filtra anni se specificato
    let anniOrdinati = Array.from(tuttiGliAnni).sort();
    if (filtroAnno) {
      anniOrdinati = anniOrdinati.filter(a => a === filtroAnno);
      if (anniOrdinati.length === 0) {
        SHARED_UTILS.showToast(`Nessun dato trovato per l'anno ${filtroAnno}`, 'Avviso', 5);
        return;
      }
    }
    
    // --- SCRITTURA FOGLIO ---
    let currentRow = 1;
    const currencyFormat = '€ #,##0.00;[Red]-€ #,##0.00;€ 0.00';
    const percentFormat = '(0.0)%;[Red](0.0)%;(0.0)%';

    anniOrdinati.forEach(anno => {
      currentRow = _writeConfrontoSection(
        sh, currentRow, anno, pnlGlobale, pnlGemma, pnlZaffiro,
        COSTI_OPERATIVI_GOP, ALTRI_COSTI, VOCE_FATTURATO, VOCE_FATTURE_INCASSATE, VOCE_CEDOLINI,
        currencyFormat, percentFormat
      );
      currentRow += 2; // Spazio
      
      // Aggiungi sezione RIALLINEAMENTO CE
      currentRow = _writeRiallineamentoSection(
        sh, currentRow, anno, pnlGlobale, pnlGemma, pnlZaffiro,
        FAMIGLIE_ORDINATE, VOCE_FATTURATO, VOCE_FATTURE_INCASSATE,
        currencyFormat, percentFormat
      );
      currentRow += 3; // Spazio tra anni
    });

    // Ridimensiona colonne
    if (sh.getLastColumn() > 0) {
      GG.get('ERROR_HANDLER').safely(
        () => sh.autoResizeColumns(1, Math.min(sh.getMaxColumns(), 14)),
        { scope: 'CONFRONTO_RESIZE', message: 'Impossibile ridimensionare colonne.' }
      );
    }

    const messaggioAnno = filtroAnno ? ` per anno ${filtroAnno}` : ` per ${anniOrdinati.length} anni`;
    LOG.info('PNL_CONFRONTO', `Confronto Gemma-Zaffiro creato con successo${messaggioAnno}.`);
    SHARED_UTILS.showToast(`Confronto "${sheetName}" creato!`, 'Completato', 10);
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
function _writeConfrontoSection(sheet, startRow, anno, pnlGlobale, pnlGemma, pnlZaffiro, costiOperativiGOP, altriCosti, VOCE_FATTURATO, VOCE_FATTURE_INCASSATE, VOCE_CEDOLINI, currencyFormat, percentFormat) {
  let currentRow = startRow;
  
  // Titolo
  sheet.getRange(currentRow, 1, 1, 7).merge()
    .setValue(`CONFRONTO GELATERIA - ANNO ${anno}`)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setBackground('#e0e0e0');
  currentRow++;
  
  // Header
  const headers = ['Voce', 'Globale €', '% Glob', 'Gemma €', '% Gemma', 'Zaffiro €', '% Zaffiro'];
  sheet.getRange(currentRow, 1, 1, 7).setValues([headers]).setFontWeight('bold').setBackground('#f3f3f3');
  currentRow++;
  
  // Helper per ottenere valori
  const getVal = (map, voce, anno) => map.get(voce)?.get(anno) || 0;
  
  // Helper per calcolare percentuali sul fatturato
  const calcPercentOnFatt = (valore, fatturatoTotale) => {
    if (fatturatoTotale === 0) return 0;
    return (valore / fatturatoTotale) * 100;
  };
  
  // RICAVI
  const rigaFatt = currentRow;
  const fattGlobale = getVal(pnlGlobale, VOCE_FATTURATO, anno);
  const fattGemma = getVal(pnlGemma, VOCE_FATTURATO, anno);
  const fattZaffiro = getVal(pnlZaffiro, VOCE_FATTURATO, anno);
  
  sheet.getRange(currentRow, 1).setValue(VOCE_FATTURATO);
  sheet.getRange(currentRow, 2).setValue(fattGlobale).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(calcPercentOnFatt(fattGlobale, fattGlobale) / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 4).setValue(fattGemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(calcPercentOnFatt(fattGemma, fattGemma) / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 6).setValue(fattZaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 7).setValue(calcPercentOnFatt(fattZaffiro, fattZaffiro) / 100).setNumberFormat(percentFormat);
  currentRow++;
  
  const rigaFattInc = currentRow;
  const fattIncGlobale = getVal(pnlGlobale, VOCE_FATTURE_INCASSATE, anno);
  const fattIncGemma = getVal(pnlGemma, VOCE_FATTURE_INCASSATE, anno);
  const fattIncZaffiro = getVal(pnlZaffiro, VOCE_FATTURE_INCASSATE, anno);
  
  sheet.getRange(currentRow, 1).setValue(VOCE_FATTURE_INCASSATE);
  sheet.getRange(currentRow, 2).setValue(fattIncGlobale).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(calcPercentOnFatt(fattIncGlobale, fattGlobale) / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 4).setValue(fattIncGemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(calcPercentOnFatt(fattIncGemma, fattGemma) / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 6).setValue(fattIncZaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 7).setValue(calcPercentOnFatt(fattIncZaffiro, fattZaffiro) / 100).setNumberFormat(percentFormat);
  currentRow++;
  currentRow++; // Spazio
  
  const rigaTotRicavi = currentRow;
  const totRicaviGlobale = fattGlobale + fattIncGlobale;
  const totRicaviGemma = fattGemma + fattIncGemma;
  const totRicaviZaffiro = fattZaffiro + fattIncZaffiro;
  
  sheet.getRange(currentRow, 1).setValue('(A) - TOTALE RICAVI').setFontWeight('bold').setBackground('#f3f3f3');
  sheet.getRange(currentRow, 2).setValue(totRicaviGlobale).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(1.0).setNumberFormat(percentFormat); // 100%
  sheet.getRange(currentRow, 4).setValue(totRicaviGemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(1.0).setNumberFormat(percentFormat); // 100%
  sheet.getRange(currentRow, 6).setValue(totRicaviZaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 7).setValue(1.0).setNumberFormat(percentFormat); // 100%
  currentRow++;
  currentRow++; // Spazio
  
  // COSTI OPERATIVI
  const valoriCostiOp = { globale: 0, gemma: 0, zaffiro: 0 };
  costiOperativiGOP.forEach(famiglia => {
    const valGlobale = getVal(pnlGlobale, famiglia, anno);
    const valGemma = getVal(pnlGemma, famiglia, anno);
    const valZaffiro = getVal(pnlZaffiro, famiglia, anno);
    valoriCostiOp.globale += valGlobale;
    valoriCostiOp.gemma += valGemma;
    valoriCostiOp.zaffiro += valZaffiro;
    
    const percGlobale = calcPercentOnFatt(valGlobale, totRicaviGlobale);
    const percGemma = calcPercentOnFatt(valGemma, totRicaviGemma);
    const percZaffiro = calcPercentOnFatt(valZaffiro, totRicaviZaffiro);
    
    sheet.getRange(currentRow, 1).setValue(famiglia);
    sheet.getRange(currentRow, 2).setValue(valGlobale).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 3).setValue(percGlobale / 100).setNumberFormat(percentFormat);
    sheet.getRange(currentRow, 4).setValue(valGemma).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 5).setValue(percGemma / 100).setNumberFormat(percentFormat);
    sheet.getRange(currentRow, 6).setValue(valZaffiro).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 7).setValue(percZaffiro / 100).setNumberFormat(percentFormat);
    currentRow++;
  });
  currentRow++; // Spazio
  
  // C1 - TOTALE OPERATIVI
  const rigaC1 = currentRow;
  const percC1Globale = calcPercentOnFatt(valoriCostiOp.globale, totRicaviGlobale);
  const percC1Gemma = calcPercentOnFatt(valoriCostiOp.gemma, totRicaviGemma);
  const percC1Zaffiro = calcPercentOnFatt(valoriCostiOp.zaffiro, totRicaviZaffiro);
  
  sheet.getRange(currentRow, 1).setValue('C1 - DI CUI OPERATIVI').setFontWeight('bold').setBackground('#f3f3f3');
  sheet.getRange(currentRow, 2).setValue(valoriCostiOp.globale).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(percC1Globale / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 4).setValue(valoriCostiOp.gemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(percC1Gemma / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 6).setValue(valoriCostiOp.zaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 7).setValue(percC1Zaffiro / 100).setNumberFormat(percentFormat);
  currentRow++;
  currentRow++; // Spazio
  
  // GOP
  const rigaGOP = currentRow;
  const gopGlobale = totRicaviGlobale - valoriCostiOp.globale;
  const gopGemma = totRicaviGemma - valoriCostiOp.gemma;
  const gopZaffiro = totRicaviZaffiro - valoriCostiOp.zaffiro;
  const percGOPGlobale = calcPercentOnFatt(gopGlobale, totRicaviGlobale);
  const percGOPGemma = calcPercentOnFatt(gopGemma, totRicaviGemma);
  const percGOPZaffiro = calcPercentOnFatt(gopZaffiro, totRicaviZaffiro);
  
  sheet.getRange(currentRow, 1).setValue('GOP (A - C1)').setFontWeight('bold').setBackground('#e0e0e0');
  sheet.getRange(currentRow, 2).setValue(gopGlobale).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(percGOPGlobale / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 4).setValue(gopGemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(percGOPGemma / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 6).setValue(gopZaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 7).setValue(percGOPZaffiro / 100).setNumberFormat(percentFormat);
  currentRow++;
  currentRow++; // Spazio
  
  // ALTRI COSTI
  const valoriAltriCosti = { globale: 0, gemma: 0, zaffiro: 0 };
  altriCosti.forEach(famiglia => {
    const valGlobale = getVal(pnlGlobale, famiglia, anno);
    const valGemma = getVal(pnlGemma, famiglia, anno);
    const valZaffiro = getVal(pnlZaffiro, famiglia, anno);
    valoriAltriCosti.globale += valGlobale;
    valoriAltriCosti.gemma += valGemma;
    valoriAltriCosti.zaffiro += valZaffiro;
    
    const percGlobale = calcPercentOnFatt(valGlobale, totRicaviGlobale);
    const percGemma = calcPercentOnFatt(valGemma, totRicaviGemma);
    const percZaffiro = calcPercentOnFatt(valZaffiro, totRicaviZaffiro);
    
    sheet.getRange(currentRow, 1).setValue(famiglia);
    sheet.getRange(currentRow, 2).setValue(valGlobale).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 3).setValue(percGlobale / 100).setNumberFormat(percentFormat);
    sheet.getRange(currentRow, 4).setValue(valGemma).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 5).setValue(percGemma / 100).setNumberFormat(percentFormat);
    sheet.getRange(currentRow, 6).setValue(valZaffiro).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 7).setValue(percZaffiro / 100).setNumberFormat(percentFormat);
    currentRow++;
  });
  currentRow++; // Spazio
  
  // C - TOTALE COSTI
  const rigaTotCosti = currentRow;
  const totCostiGlobale = valoriCostiOp.globale + valoriAltriCosti.globale;
  const totCostiGemma = valoriCostiOp.gemma + valoriAltriCosti.gemma;
  const totCostiZaffiro = valoriCostiOp.zaffiro + valoriAltriCosti.zaffiro;
  const percTotCostiGlobale = calcPercentOnFatt(totCostiGlobale, totRicaviGlobale);
  const percTotCostiGemma = calcPercentOnFatt(totCostiGemma, totRicaviGemma);
  const percTotCostiZaffiro = calcPercentOnFatt(totCostiZaffiro, totRicaviZaffiro);
  
  sheet.getRange(currentRow, 1).setValue('C - TOTALE COSTI').setFontWeight('bold').setBackground('#f3f3f3');
  sheet.getRange(currentRow, 2).setValue(totCostiGlobale).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(percTotCostiGlobale / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 4).setValue(totCostiGemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(percTotCostiGemma / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 6).setValue(totCostiZaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 7).setValue(percTotCostiZaffiro / 100).setNumberFormat(percentFormat);
  currentRow++;
  currentRow++; // Spazio
  
  // MOL
  const rigaMOL = currentRow;
  const molGlobale = totRicaviGlobale - totCostiGlobale;
  const molGemma = totRicaviGemma - totCostiGemma;
  const molZaffiro = totRicaviZaffiro - totCostiZaffiro;
  const percMOLGlobale = calcPercentOnFatt(molGlobale, totRicaviGlobale);
  const percMOLGemma = calcPercentOnFatt(molGemma, totRicaviGemma);
  const percMOLZaffiro = calcPercentOnFatt(molZaffiro, totRicaviZaffiro);
  
  sheet.getRange(currentRow, 1).setValue('MOL (A-C)').setFontWeight('bold').setBackground('#e0e0e0');
  sheet.getRange(currentRow, 2).setValue(molGlobale).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 3).setValue(percMOLGlobale / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 4).setValue(molGemma).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 5).setValue(percMOLGemma / 100).setNumberFormat(percentFormat);
  sheet.getRange(currentRow, 6).setValue(molZaffiro).setNumberFormat(currencyFormat);
  sheet.getRange(currentRow, 7).setValue(percMOLZaffiro / 100).setNumberFormat(percentFormat);
  currentRow++;
  
  return currentRow;
}

/**
 * Scrive la sezione di RIALLINEAMENTO CE per un anno specifico
 * Mostra quanto ogni sede dovrebbe ricevere/cedere per allinearsi alla % globale
 * @private
 */
function _writeRiallineamentoSection(sheet, startRow, anno, pnlGlobale, pnlGemma, pnlZaffiro, famiglieOrdinate, VOCE_FATTURATO, VOCE_FATTURE_INCASSATE, currencyFormat, percentFormat) {
  let currentRow = startRow;
  
  // Helper per ottenere valori
  const getVal = (map, voce, anno) => map.get(voce)?.get(anno) || 0;
  
  // Ottieni ricavi totali (base per calcolo %)
  const fattGlobale = getVal(pnlGlobale, VOCE_FATTURATO, anno);
  const fattIncGlobale = getVal(pnlGlobale, VOCE_FATTURE_INCASSATE, anno);
  const ricaviGlobali = fattGlobale + fattIncGlobale;
  
  const fattGemma = getVal(pnlGemma, VOCE_FATTURATO, anno);
  const fattIncGemma = getVal(pnlGemma, VOCE_FATTURE_INCASSATE, anno);
  const ricaviGemma = fattGemma + fattIncGemma;
  
  const fattZaffiro = getVal(pnlZaffiro, VOCE_FATTURATO, anno);
  const fattIncZaffiro = getVal(pnlZaffiro, VOCE_FATTURE_INCASSATE, anno);
  const ricaviZaffiro = fattZaffiro + fattIncZaffiro;
  
  // Titolo sezione
  sheet.getRange(currentRow, 1, 1, 14).merge()
    .setValue(`📊 ANALISI RIALLINEAMENTO COSTI - ANNO ${anno}`)
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setBackground('#d0e0f0')
    .setFontSize(11);
  currentRow++;
  
  // Sottotitolo esplicativo
  sheet.getRange(currentRow, 1, 1, 14).merge()
    .setValue('Questa sezione mostra quanto costo dovrebbe essere "spostato" tra Gemma e Zaffiro per allinearsi alla % globale di ogni voce')
    .setFontSize(9)
    .setFontStyle('italic')
    .setHorizontalAlignment('center')
    .setBackground('#f0f0f0');
  currentRow++;
  currentRow++; // Spazio
  
  // Header tabella riallineamento
  const headers = [
    'Voce',
    'Costo Glob €',
    '% Glob',
    'Ricavi Gemma',
    'Costo Gemma Att.',
    '% Gemma Att.',
    'Costo Gemma Align.',
    'Δ Gemma',
    'Ricavi Zaffiro',
    'Costo Zaffiro Att.',
    '% Zaffiro Att.',
    'Costo Zaffiro Align.',
    'Δ Zaffiro',
    'Direzione'
  ];
  
  const headerRange = sheet.getRange(currentRow, 1, 1, 14);
  headerRange.setValues([headers])
    .setFontWeight('bold')
    .setBackground('#c0d0e0')
    .setHorizontalAlignment('center')
    .setWrap(true);
  currentRow++;
  
  // Filtra solo voci di COSTO (escludi ricavi e aggregati)
  const vociDaEscludere = [
    VOCE_FATTURATO,
    VOCE_FATTURE_INCASSATE,
    '(A) - TOTALE RICAVI',
    'C1 - DI CUI OPERATIVI',
    'GOP (A - C1)',
    'C - TOTALE COSTI',
    'MOL (A-C)'
  ];
  
  const vociCosto = famiglieOrdinate.filter(voce => !vociDaEscludere.includes(voce));
  
  // Elabora ogni voce di costo
  vociCosto.forEach(voce => {
    // Dati attuali
    const costoGlobale = getVal(pnlGlobale, voce, anno);
    const costoGemmaAtt = getVal(pnlGemma, voce, anno);
    const costoZaffiroAtt = getVal(pnlZaffiro, voce, anno);
    
    // Skip se voce vuota
    if (costoGlobale === 0 && costoGemmaAtt === 0 && costoZaffiroAtt === 0) return;
    
    // Calcola % target (globale)
    const percTarget = ricaviGlobali > 0 ? (costoGlobale / ricaviGlobali) : 0;
    
    // Calcola % attuali
    const percGemmaAtt = ricaviGemma > 0 ? (costoGemmaAtt / ricaviGemma) : 0;
    const percZaffiroAtt = ricaviZaffiro > 0 ? (costoZaffiroAtt / ricaviZaffiro) : 0;
    
    // Calcola costi allineati
    const costoGemmaAlign = ricaviGemma * percTarget;
    const costoZaffiroAlign = ricaviZaffiro * percTarget;
    
    // Calcola delta (quanto ricevere/cedere)
    const deltaGemma = costoGemmaAlign - costoGemmaAtt;
    const deltaZaffiro = costoZaffiroAlign - costoZaffiroAtt;
    
    // Determina direzione spostamento
    let direzione = '';
    const importoDaSpostare = Math.abs(deltaGemma);
    if (Math.abs(deltaGemma) < 1) {
      direzione = '✓ Allineato';
    } else if (deltaGemma > 0) {
      direzione = `← da Zaffiro a Gemma (€${importoDaSpostare.toFixed(0)})`;
    } else {
      direzione = `→ da Gemma a Zaffiro (€${importoDaSpostare.toFixed(0)})`;
    }
    
    // Scrivi riga
    sheet.getRange(currentRow, 1).setValue(voce);
    sheet.getRange(currentRow, 2).setValue(costoGlobale).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 3).setValue(percTarget).setNumberFormat(percentFormat);
    sheet.getRange(currentRow, 4).setValue(ricaviGemma).setNumberFormat(currencyFormat).setBackground('#fff3cd');
    sheet.getRange(currentRow, 5).setValue(costoGemmaAtt).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 6).setValue(percGemmaAtt).setNumberFormat(percentFormat);
    sheet.getRange(currentRow, 7).setValue(costoGemmaAlign).setNumberFormat(currencyFormat).setBackground('#e8f5e9');
    sheet.getRange(currentRow, 8).setValue(deltaGemma).setNumberFormat(currencyFormat)
      .setBackground(deltaGemma > 0 ? '#ffebee' : deltaGemma < 0 ? '#e3f2fd' : '#f5f5f5')
      .setFontWeight('bold');
    sheet.getRange(currentRow, 9).setValue(ricaviZaffiro).setNumberFormat(currencyFormat).setBackground('#fff3cd');
    sheet.getRange(currentRow, 10).setValue(costoZaffiroAtt).setNumberFormat(currencyFormat);
    sheet.getRange(currentRow, 11).setValue(percZaffiroAtt).setNumberFormat(percentFormat);
    sheet.getRange(currentRow, 12).setValue(costoZaffiroAlign).setNumberFormat(currencyFormat).setBackground('#e8f5e9');
    sheet.getRange(currentRow, 13).setValue(deltaZaffiro).setNumberFormat(currencyFormat)
      .setBackground(deltaZaffiro > 0 ? '#ffebee' : deltaZaffiro < 0 ? '#e3f2fd' : '#f5f5f5')
      .setFontWeight('bold');
    sheet.getRange(currentRow, 14).setValue(direzione).setFontSize(9);
    
    currentRow++;
  });
  
  currentRow++; // Spazio finale
  
  // Nota esplicativa
  sheet.getRange(currentRow, 1, 1, 14).merge()
    .setValue('📌 Legenda: Δ positivo = sede deve RICEVERE costo | Δ negativo = sede deve CEDERE costo | % Target = % globale da raggiungere')
    .setFontSize(8)
    .setFontStyle('italic')
    .setBackground('#f9f9f9');
  currentRow++;
  
  return currentRow;
}
