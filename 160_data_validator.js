// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 160_data_validator.js
// RUOLO: Sistema validazione completa dati Fatture/Righe/Prodotti/Magazzino.
// NOTE: Analisi integrità, coerenza, completezza con report dettagliato.
// =============================================================

const DATA_VALIDATOR = (function() {
  'use strict';

  // ============================================================
  // VALIDAZIONE FATTURE
  // ============================================================

  /**
   * Valida integrità foglio Fatture
   * @private
   * @returns {Object} Risultati validazione
   */
  function _validateFatture() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Fatture');
    
    const issues = [];
    const warnings = [];
    let stats = {
      total: 0,
      valid: 0,
      missingFileID: 0,
      missingData: 0,
      missingFornitore: 0,
      invalidDate: 0,
      missingTotale: 0,
      mismatchTotali: 0,
      duplicateFileID: 0
    };

    if (!sheet) {
      issues.push('❌ CRITICO: Foglio "Fatture" non trovato');
      return { issues, warnings, stats };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      warnings.push('⚠️  Foglio Fatture vuoto');
      return { issues, warnings, stats };
    }

    // Leggi headers e dati
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idx = {};
    headers.forEach((h, i) => {
      const cleanHeader = String(h).trim();
      if (cleanHeader) idx[cleanHeader] = i;
    });

    // Verifica colonne obbligatorie
    const requiredCols = ['FileID', 'Data', 'FornitoreID', 'DenominazioneFornitore', 'TotDocumento'];
    const missingCols = requiredCols.filter(col => idx[col] === undefined);
    if (missingCols.length > 0) {
      issues.push(`❌ CRITICO: Colonne mancanti in Fatture: ${missingCols.join(', ')}`);
      return { issues, warnings, stats };
    }

    // Valida ogni riga
    const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const fileIDsSeen = new Set();
    const fileIDDuplicates = new Set();

    data.forEach((row, i) => {
      const rowNum = i + 2;
      stats.total++;

      const fileID = String(row[idx.FileID] || '').trim();
      const data = row[idx.Data];
      const fornitoreID = String(row[idx.FornitoreID] || '').trim();
      const denominazione = String(row[idx.DenominazioneFornitore] || '').trim();
      const totDocumento = row[idx.TotDocumento];
      const totImponibile = row[idx.TotImponibile];
      const totImposta = row[idx.TotImposta];

      let hasIssue = false;

      // 1. Verifica FileID
      if (!fileID) {
        stats.missingFileID++;
        warnings.push(`⚠️  Riga ${rowNum}: FileID mancante`);
        hasIssue = true;
      } else {
        // Check duplicati FileID
        if (fileIDsSeen.has(fileID)) {
          if (!fileIDDuplicates.has(fileID)) {
            stats.duplicateFileID++;
            issues.push(`❌ Riga ${rowNum}: FileID duplicato "${fileID}"`);
            fileIDDuplicates.add(fileID);
          }
          hasIssue = true;
        } else {
          fileIDsSeen.add(fileID);
        }
      }

      // 2. Verifica Data
      if (!data || !UTIL.date.isValidDate(data)) {
        stats.invalidDate++;
        issues.push(`❌ Riga ${rowNum}: Data non valida (FileID: ${fileID})`);
        hasIssue = true;
      }

      // 3. Verifica Fornitore
      if (!fornitoreID || !denominazione) {
        stats.missingFornitore++;
        issues.push(`❌ Riga ${rowNum}: Fornitore mancante (FileID: ${fileID})`);
        hasIssue = true;
      }

      // 4. Verifica Totale Documento
      if (totDocumento === null || totDocumento === undefined || totDocumento === '') {
        stats.missingTotale++;
        warnings.push(`⚠️  Riga ${rowNum}: TotDocumento mancante (FileID: ${fileID})`);
        hasIssue = true;
      }

      // 5. Verifica coerenza totali (se presenti)
      if (totImponibile != null && totImposta != null && totDocumento != null) {
        const calculated = UTIL.number.parse(totImponibile) + UTIL.number.parse(totImposta);
        const actual = UTIL.number.parse(totDocumento);
        const diff = Math.abs(calculated - actual);
        
        if (diff > 0.02) { // Tolleranza arrotondamenti
          stats.mismatchTotali++;
          warnings.push(`⚠️  Riga ${rowNum}: Mismatch totali (Calc: ${calculated.toFixed(2)}, Actual: ${actual.toFixed(2)}) (FileID: ${fileID})`);
          hasIssue = true;
        }
      }

      if (!hasIssue) {
        stats.valid++;
      }
    });

    return { issues, warnings, stats };
  }

  // ============================================================
  // VALIDAZIONE RIGHE
  // ============================================================

  /**
   * Valida integrità foglio Righe e coerenza con Fatture
   * @private
   * @returns {Object} Risultati validazione
   */
  function _validateRighe() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheetRighe = ss.getSheetByName('Righe');
    const sheetFatture = ss.getSheetByName('Fatture');

    const issues = [];
    const warnings = [];
    let stats = {
      total: 0,
      valid: 0,
      missingFileID: 0,
      orphanFileID: 0,
      missingCodice: 0,
      missingDescrizione: 0,
      missingQuantita: 0,
      missingPrezzo: 0,
      invalidQuantita: 0,
      invalidPrezzo: 0
    };

    if (!sheetRighe) {
      issues.push('❌ CRITICO: Foglio "Righe" non trovato');
      return { issues, warnings, stats };
    }

    const lastRow = sheetRighe.getLastRow();
    if (lastRow <= 1) {
      warnings.push('⚠️  Foglio Righe vuoto');
      return { issues, warnings, stats };
    }

    // Costruisci set FileID validi da Fatture
    const validFileIDs = new Set();
    if (sheetFatture && sheetFatture.getLastRow() > 1) {
      const headersFatt = sheetFatture.getRange(1, 1, 1, sheetFatture.getLastColumn()).getValues()[0];
      const idxFatt = headersFatt.indexOf('FileID');
      if (idxFatt !== -1) {
        const dataFatt = sheetFatture.getRange(2, idxFatt + 1, sheetFatture.getLastRow() - 1, 1).getValues();
        dataFatt.forEach(row => {
          const fid = String(row[0] || '').trim();
          if (fid) validFileIDs.add(fid);
        });
      }
    }

    // Leggi headers e dati Righe
    const headers = sheetRighe.getRange(1, 1, 1, sheetRighe.getLastColumn()).getValues()[0];
    const idx = {};
    headers.forEach((h, i) => {
      const cleanHeader = String(h).trim();
      if (cleanHeader) idx[cleanHeader] = i;
    });

    // Verifica colonne obbligatorie
    const requiredCols = ['FileID', 'Descrizione', 'Quantita', 'PrezzoUnitario'];
    const missingCols = requiredCols.filter(col => idx[col] === undefined);
    if (missingCols.length > 0) {
      issues.push(`❌ CRITICO: Colonne mancanti in Righe: ${missingCols.join(', ')}`);
      return { issues, warnings, stats };
    }

    // Valida ogni riga
    const data = sheetRighe.getRange(2, 1, lastRow - 1, headers.length).getValues();

    data.forEach((row, i) => {
      const rowNum = i + 2;
      stats.total++;

      const fileID = String(row[idx.FileID] || '').trim();
      const codiceBreve = String(row[idx.CodiceInternoBreve] || '').trim();
      const descrizione = String(row[idx.Descrizione] || '').trim();
      const quantita = row[idx.Quantita];
      const prezzoUnitario = row[idx.PrezzoUnitario];

      let hasIssue = false;

      // 1. Verifica FileID
      if (!fileID) {
        stats.missingFileID++;
        warnings.push(`⚠️  Riga ${rowNum}: FileID mancante`);
        hasIssue = true;
      } else if (validFileIDs.size > 0 && !validFileIDs.has(fileID)) {
        stats.orphanFileID++;
        issues.push(`❌ Riga ${rowNum}: FileID "${fileID}" non trovato in Fatture (riga orfana)`);
        hasIssue = true;
      }

      // 2. Verifica Codice/Descrizione
      if (!codiceBreve && !descrizione) {
        stats.missingDescrizione++;
        warnings.push(`⚠️  Riga ${rowNum}: Sia CodiceInternoBreve che Descrizione mancanti (FileID: ${fileID})`);
        hasIssue = true;
      }

      // 3. Verifica Quantità
      if (quantita === null || quantita === undefined || quantita === '') {
        stats.missingQuantita++;
        warnings.push(`⚠️  Riga ${rowNum}: Quantita mancante (FileID: ${fileID})`);
        hasIssue = true;
      } else {
        const qta = UTIL.number.parse(quantita);
        if (isNaN(qta) || qta === 0) {
          stats.invalidQuantita++;
          warnings.push(`⚠️  Riga ${rowNum}: Quantita non valida: "${quantita}" (FileID: ${fileID})`);
          hasIssue = true;
        }
      }

      // 4. Verifica Prezzo
      if (prezzoUnitario === null || prezzoUnitario === undefined || prezzoUnitario === '') {
        stats.missingPrezzo++;
        warnings.push(`⚠️  Riga ${rowNum}: PrezzoUnitario mancante (FileID: ${fileID})`);
        hasIssue = true;
      } else {
        const prezzo = UTIL.number.parse(prezzoUnitario);
        if (isNaN(prezzo)) {
          stats.invalidPrezzo++;
          warnings.push(`⚠️  Riga ${rowNum}: PrezzoUnitario non valido: "${prezzoUnitario}" (FileID: ${fileID})`);
          hasIssue = true;
        }
      }

      if (!hasIssue) {
        stats.valid++;
      }
    });

    return { issues, warnings, stats };
  }

  // ============================================================
  // VALIDAZIONE PRODOTTI
  // ============================================================

  /**
   * Valida integrità foglio Prodotti
   * @private
   * @returns {Object} Risultati validazione
   */
  function _validateProdotti() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Prodotti');

    const issues = [];
    const warnings = [];
    let stats = {
      total: 0,
      valid: 0,
      missingCodiceInterno: 0,
      missingCodiceBreve: 0,
      missingDescrizione: 0,
      missingFornitore: 0,
      missingUM: 0,
      duplicateCodiceInterno: 0,
      invalidConversionData: 0
    };

    if (!sheet) {
      issues.push('❌ CRITICO: Foglio "Prodotti" non trovato');
      return { issues, warnings, stats };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      warnings.push('⚠️  Foglio Prodotti vuoto');
      return { issues, warnings, stats };
    }

    // Leggi headers e dati
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idx = {};
    headers.forEach((h, i) => {
      const cleanHeader = String(h).trim();
      if (cleanHeader) idx[cleanHeader] = i;
    });

    // Verifica colonne obbligatorie
    const requiredCols = ['CodiceInterno', 'CodiceInternoBreve', 'Descrizione', 'FornitoreID', 'UM'];
    const missingCols = requiredCols.filter(col => idx[col] === undefined);
    if (missingCols.length > 0) {
      issues.push(`❌ CRITICO: Colonne mancanti in Prodotti: ${missingCols.join(', ')}`);
      return { issues, warnings, stats };
    }

    // Valida ogni riga
    const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const codiciInterni = new Set();
    const duplicates = new Set();

    data.forEach((row, i) => {
      const rowNum = i + 2;
      stats.total++;

      const codiceInterno = String(row[idx.CodiceInterno] || '').trim();
      const codiceBreve = String(row[idx.CodiceInternoBreve] || '').trim();
      const descrizione = String(row[idx.Descrizione] || '').trim();
      const fornitoreID = String(row[idx.FornitoreID] || '').trim();
      const um = String(row[idx.UM] || '').trim();
      const pzxct = row[idx.PZxCT];
      const kgxpz = row[idx.KGxPZ];
      const umBase = String(row[idx.UMBase] || '').trim().toUpperCase();

      let hasIssue = false;

      // 1. Verifica CodiceInterno
      if (!codiceInterno) {
        stats.missingCodiceInterno++;
        issues.push(`❌ Riga ${rowNum}: CodiceInterno mancante`);
        hasIssue = true;
      } else {
        // Check duplicati
        if (codiciInterni.has(codiceInterno)) {
          if (!duplicates.has(codiceInterno)) {
            stats.duplicateCodiceInterno++;
            issues.push(`❌ Riga ${rowNum}: CodiceInterno duplicato "${codiceInterno}"`);
            duplicates.add(codiceInterno);
          }
          hasIssue = true;
        } else {
          codiciInterni.add(codiceInterno);
        }
      }

      // 2. Verifica CodiceInternoBreve
      if (!codiceBreve) {
        stats.missingCodiceBreve++;
        warnings.push(`⚠️  Riga ${rowNum}: CodiceInternoBreve mancante (${codiceInterno})`);
        hasIssue = true;
      }

      // 3. Verifica Descrizione
      if (!descrizione) {
        stats.missingDescrizione++;
        warnings.push(`⚠️  Riga ${rowNum}: Descrizione mancante (${codiceInterno})`);
        hasIssue = true;
      }

      // 4. Verifica FornitoreID
      if (!fornitoreID) {
        stats.missingFornitore++;
        issues.push(`❌ Riga ${rowNum}: FornitoreID mancante (${codiceInterno})`);
        hasIssue = true;
      }

      // 5. Verifica UM
      if (!um) {
        stats.missingUM++;
        warnings.push(`⚠️  Riga ${rowNum}: UM mancante (${codiceInterno})`);
        hasIssue = true;
      }

      // 6. Verifica dati conversione (se Ingrediente)
      const ingrediente = String(row[idx.Ingrediente] || '').trim();
      if (ingrediente && ingrediente.toLowerCase() !== 'no') {
        if (umBase === 'PZ' && (!pzxct || UTIL.number.parse(pzxct) === 0)) {
          stats.invalidConversionData++;
          warnings.push(`⚠️  Riga ${rowNum}: Ingrediente PZ senza PZxCT valido (${codiceInterno})`);
          hasIssue = true;
        }
        if (umBase === 'KG' && (!kgxpz || UTIL.number.parse(kgxpz) === 0)) {
          stats.invalidConversionData++;
          warnings.push(`⚠️  Riga ${rowNum}: Ingrediente KG senza KGxPZ valido (${codiceInterno})`);
          hasIssue = true;
        }
      }

      if (!hasIssue) {
        stats.valid++;
      }
    });

    return { issues, warnings, stats };
  }

  // ============================================================
  // VALIDAZIONE MAGAZZINO
  // ============================================================

  /**
   * Valida coerenza Magazzino con Righe e Prodotti
   * @private
   * @returns {Object} Risultati validazione
   */
  function _validateMagazzino() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName('Magazzino');

    const issues = [];
    const warnings = [];
    let stats = {
      total: 0,
      valid: 0,
      missingCodiceInterno: 0,
      orphanCodiceInterno: 0,
      invalidQuantita: 0,
      invalidPrezzo: 0,
      missingConversioni: 0
    };

    if (!sheet) {
      issues.push('❌ CRITICO: Foglio "Magazzino" non trovato');
      return { issues, warnings, stats };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      warnings.push('⚠️  Foglio Magazzino vuoto (esegui Genera Magazzino)');
      return { issues, warnings, stats };
    }

    // Costruisci set Codici Interni validi da Prodotti
    const validCodiciInterni = new Set();
    const sheetProdotti = ss.getSheetByName('Prodotti');
    if (sheetProdotti && sheetProdotti.getLastRow() > 1) {
      const headersProd = sheetProdotti.getRange(1, 1, 1, sheetProdotti.getLastColumn()).getValues()[0];
      const idxProd = headersProd.indexOf('CodiceInterno');
      if (idxProd !== -1) {
        const dataProd = sheetProdotti.getRange(2, idxProd + 1, sheetProdotti.getLastRow() - 1, 1).getValues();
        dataProd.forEach(row => {
          const code = String(row[0] || '').trim();
          if (code) validCodiciInterni.add(code);
        });
      }
    }

    // Leggi headers e dati Magazzino
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const idx = {};
    headers.forEach((h, i) => {
      const cleanHeader = String(h).trim();
      if (cleanHeader) idx[cleanHeader] = i;
    });

    // Verifica colonne obbligatorie
    const requiredCols = ['Codice Interno', 'Quantità Acquistata', 'Ultimo Prezzo Netto'];
    const missingCols = requiredCols.filter(col => idx[col] === undefined);
    if (missingCols.length > 0) {
      issues.push(`❌ CRITICO: Colonne mancanti in Magazzino: ${missingCols.join(', ')}`);
      return { issues, warnings, stats };
    }

    // Valida ogni riga
    const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

    data.forEach((row, i) => {
      const rowNum = i + 2;
      stats.total++;

      const codiceInterno = String(row[idx['Codice Interno']] || '').trim();
      const quantita = row[idx['Quantità Acquistata']];
      const prezzo = row[idx['Ultimo Prezzo Netto']];
      const qtaStd = row[idx['Quantità Standard']];
      const prezzoStd = row[idx['Prezzo Standardizzato']];

      let hasIssue = false;

      // 1. Verifica Codice Interno
      if (!codiceInterno) {
        stats.missingCodiceInterno++;
        warnings.push(`⚠️  Riga ${rowNum}: Codice Interno mancante`);
        hasIssue = true;
      } else if (validCodiciInterni.size > 0 && !validCodiciInterni.has(codiceInterno)) {
        stats.orphanCodiceInterno++;
        issues.push(`❌ Riga ${rowNum}: Codice Interno "${codiceInterno}" non trovato in Prodotti`);
        hasIssue = true;
      }

      // 2. Verifica Quantità
      if (quantita === null || quantita === undefined || quantita === '') {
        stats.invalidQuantita++;
        warnings.push(`⚠️  Riga ${rowNum}: Quantità Acquistata mancante (${codiceInterno})`);
        hasIssue = true;
      }

      // 3. Verifica Prezzo
      if (prezzo === null || prezzo === undefined || prezzo === '') {
        stats.invalidPrezzo++;
        warnings.push(`⚠️  Riga ${rowNum}: Ultimo Prezzo Netto mancante (${codiceInterno})`);
        hasIssue = true;
      }

      // 4. Verifica conversioni (se quantità std mancante)
      if ((qtaStd === null || qtaStd === undefined || qtaStd === '') ||
          (prezzoStd === null || prezzoStd === undefined || prezzoStd === '')) {
        stats.missingConversioni++;
        warnings.push(`⚠️  Riga ${rowNum}: Conversioni standardizzate mancanti (${codiceInterno})`);
        hasIssue = true;
      }

      if (!hasIssue) {
        stats.valid++;
      }
    });

    return { issues, warnings, stats };
  }

  // ============================================================
  // REPORT CONSOLIDATO
  // ============================================================

  /**
   * Genera report completo validazione dati
   * @private
   * @returns {string} Report formattato
   */
  function _generateReport(results) {
    const lines = [];
    
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('        📊 DATA VALIDATION REPORT - GG CONTROLLO GESTIONE');
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');
    lines.push(`📅 Data analisi: ${new Date().toLocaleString('it-IT')}`);
    lines.push('');

    // Sezione Fatture
    lines.push('─────────────────────────────────────────────────────────');
    lines.push('📋 FATTURE');
    lines.push('─────────────────────────────────────────────────────────');
    const f = results.fatture;
    lines.push(`Totale righe: ${f.stats.total}`);
    lines.push(`✅ Valide: ${f.stats.valid} (${(f.stats.valid / f.stats.total * 100).toFixed(1)}%)`);
    if (f.stats.missingFileID > 0) lines.push(`⚠️  FileID mancanti: ${f.stats.missingFileID}`);
    if (f.stats.duplicateFileID > 0) lines.push(`❌ FileID duplicati: ${f.stats.duplicateFileID}`);
    if (f.stats.invalidDate > 0) lines.push(`❌ Date non valide: ${f.stats.invalidDate}`);
    if (f.stats.missingFornitore > 0) lines.push(`❌ Fornitori mancanti: ${f.stats.missingFornitore}`);
    if (f.stats.missingTotale > 0) lines.push(`⚠️  Totali mancanti: ${f.stats.missingTotale}`);
    if (f.stats.mismatchTotali > 0) lines.push(`⚠️  Mismatch totali: ${f.stats.mismatchTotali}`);
    lines.push('');

    // Sezione Righe
    lines.push('─────────────────────────────────────────────────────────');
    lines.push('📝 RIGHE');
    lines.push('─────────────────────────────────────────────────────────');
    const r = results.righe;
    lines.push(`Totale righe: ${r.stats.total}`);
    lines.push(`✅ Valide: ${r.stats.valid} (${(r.stats.valid / r.stats.total * 100).toFixed(1)}%)`);
    if (r.stats.missingFileID > 0) lines.push(`⚠️  FileID mancanti: ${r.stats.missingFileID}`);
    if (r.stats.orphanFileID > 0) lines.push(`❌ Righe orfane (FileID non in Fatture): ${r.stats.orphanFileID}`);
    if (r.stats.missingDescrizione > 0) lines.push(`⚠️  Codice/Descrizione mancanti: ${r.stats.missingDescrizione}`);
    if (r.stats.missingQuantita > 0) lines.push(`⚠️  Quantità mancanti: ${r.stats.missingQuantita}`);
    if (r.stats.invalidQuantita > 0) lines.push(`⚠️  Quantità non valide: ${r.stats.invalidQuantita}`);
    if (r.stats.missingPrezzo > 0) lines.push(`⚠️  Prezzi mancanti: ${r.stats.missingPrezzo}`);
    if (r.stats.invalidPrezzo > 0) lines.push(`⚠️  Prezzi non validi: ${r.stats.invalidPrezzo}`);
    lines.push('');

    // Sezione Prodotti
    lines.push('─────────────────────────────────────────────────────────');
    lines.push('🏷️  PRODOTTI');
    lines.push('─────────────────────────────────────────────────────────');
    const p = results.prodotti;
    lines.push(`Totale prodotti: ${p.stats.total}`);
    lines.push(`✅ Validi: ${p.stats.valid} (${(p.stats.valid / p.stats.total * 100).toFixed(1)}%)`);
    if (p.stats.missingCodiceInterno > 0) lines.push(`❌ CodiceInterno mancanti: ${p.stats.missingCodiceInterno}`);
    if (p.stats.duplicateCodiceInterno > 0) lines.push(`❌ CodiceInterno duplicati: ${p.stats.duplicateCodiceInterno}`);
    if (p.stats.missingCodiceBreve > 0) lines.push(`⚠️  CodiceInternoBreve mancanti: ${p.stats.missingCodiceBreve}`);
    if (p.stats.missingDescrizione > 0) lines.push(`⚠️  Descrizioni mancanti: ${p.stats.missingDescrizione}`);
    if (p.stats.missingFornitore > 0) lines.push(`❌ FornitoreID mancanti: ${p.stats.missingFornitore}`);
    if (p.stats.missingUM > 0) lines.push(`⚠️  UM mancanti: ${p.stats.missingUM}`);
    if (p.stats.invalidConversionData > 0) lines.push(`⚠️  Dati conversione incompleti: ${p.stats.invalidConversionData}`);
    lines.push('');

    // Sezione Magazzino
    lines.push('─────────────────────────────────────────────────────────');
    lines.push('📦 MAGAZZINO');
    lines.push('─────────────────────────────────────────────────────────');
    const m = results.magazzino;
    lines.push(`Totale righe magazzino: ${m.stats.total}`);
    if (m.stats.total > 0) {
      lines.push(`✅ Valide: ${m.stats.valid} (${(m.stats.valid / m.stats.total * 100).toFixed(1)}%)`);
      if (m.stats.missingCodiceInterno > 0) lines.push(`⚠️  Codici Interni mancanti: ${m.stats.missingCodiceInterno}`);
      if (m.stats.orphanCodiceInterno > 0) lines.push(`❌ Codici non in Prodotti: ${m.stats.orphanCodiceInterno}`);
      if (m.stats.invalidQuantita > 0) lines.push(`⚠️  Quantità mancanti: ${m.stats.invalidQuantita}`);
      if (m.stats.invalidPrezzo > 0) lines.push(`⚠️  Prezzi mancanti: ${m.stats.invalidPrezzo}`);
      if (m.stats.missingConversioni > 0) lines.push(`⚠️  Conversioni mancanti: ${m.stats.missingConversioni}`);
    }
    lines.push('');

    // Riepilogo Issues
    const allIssues = [
      ...results.fatture.issues,
      ...results.righe.issues,
      ...results.prodotti.issues,
      ...results.magazzino.issues
    ];

    const allWarnings = [
      ...results.fatture.warnings,
      ...results.righe.warnings,
      ...results.prodotti.warnings,
      ...results.magazzino.warnings
    ];

    lines.push('═══════════════════════════════════════════════════════════');
    lines.push(`🎯 RIEPILOGO: ${allIssues.length} errori critici, ${allWarnings.length} warning`);
    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');

    if (allIssues.length === 0 && allWarnings.length === 0) {
      lines.push('🎉 ✅ ECCELLENTE! Tutti i dati sono validi e coerenti!');
      lines.push('');
      lines.push('✅ Zero errori critici');
      lines.push('✅ Zero warning');
      lines.push('✅ Integrità referenziale completa');
      lines.push('✅ Pronto per analisi e report');
    } else {
      if (allIssues.length > 0) {
        lines.push('❌ ERRORI CRITICI (Richiedono correzione):');
        lines.push('');
        allIssues.slice(0, 20).forEach(issue => lines.push(`   ${issue}`));
        if (allIssues.length > 20) {
          lines.push(`   ... e altri ${allIssues.length - 20} errori (vedi log completo)`);
        }
        lines.push('');
      }

      if (allWarnings.length > 0) {
        lines.push('⚠️  WARNING (Consigliata revisione):');
        lines.push('');
        allWarnings.slice(0, 20).forEach(warn => lines.push(`   ${warn}`));
        if (allWarnings.length > 20) {
          lines.push(`   ... e altri ${allWarnings.length - 20} warning (vedi log completo)`);
        }
        lines.push('');
      }
    }

    lines.push('═══════════════════════════════════════════════════════════');
    lines.push('');

    return lines.join('\n');
  }

  // ============================================================
  // API PUBBLICA
  // ============================================================

  /**
   * Esegue validazione completa dati e mostra report
   * @public
   * @returns {void}
   */
  function runCompleteValidation() {
    try {
      UTIL.showToast('Avvio validazione dati completa...', 'Validazione', 3);

      // Esegui validazioni
      const results = {
        fatture: _validateFatture(),
        righe: _validateRighe(),
        prodotti: _validateProdotti(),
        magazzino: _validateMagazzino()
      };

      // Genera report
      const report = _generateReport(results);

      // Log report completo su Sheet e su Logger standard
      const reportTitle = `Report Validazione Dati - ${new Date().toLocaleString('it-IT')}`;
      SHEET_LOGGER.log(reportTitle, report);
      Logger.log(report);

      // Conta totali
      const totalIssues = 
        results.fatture.issues.length +
        results.righe.issues.length +
        results.prodotti.issues.length +
        results.magazzino.issues.length;

      const totalWarnings =
        results.fatture.warnings.length +
        results.righe.warnings.length +
        results.prodotti.warnings.length +
        results.magazzino.warnings.length;

      // Mostra risultato
      let message, title, duration;
      if (totalIssues === 0 && totalWarnings === 0) {
        message = '🎉 Validazione completata! Tutti i dati sono validi. Consulta il foglio "Log Validazione" per i dettagli.';
        title = '✅ Validazione OK';
        duration = 10;
      } else {
        message = `Validazione completata: ${totalIssues} errori, ${totalWarnings} warning. Consulta il foglio "Log Validazione".`;
        title = '⚠️  Validazione Completata';
        duration = 15;
      }

      UTIL.showToast(message, title, duration);

      // Log nel sistema
      if (totalIssues > 0) {
        LOG.error('DATA_VALIDATION', `Trovati ${totalIssues} errori critici`, {
          fatture: results.fatture.issues.length,
          righe: results.righe.issues.length,
          prodotti: results.prodotti.issues.length,
          magazzino: results.magazzino.issues.length
        });
      } else {
        LOG.info('DATA_VALIDATION', 'Validazione completata con successo', {
          warnings: totalWarnings
        });
      }

    } catch (error) {
      const msg = `Errore durante validazione: ${error.message}`;
      LOG.error('DATA_VALIDATION', msg, { stack: error.stack });
      UTIL.showToast(msg, 'Errore', 10);
      throw error;
    }
  }

  // API pubblica
  return {
    runCompleteValidation
  };

})();

// Registra nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('DATA_VALIDATOR', ['UTIL', 'LOG', 'SHEET_LOGGER']);
}

// Registra nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('DATA_VALIDATOR', DATA_VALIDATOR);
}

// Espone DATA_VALIDATOR in globalThis per dependency tracking
if (typeof globalThis !== 'undefined') {
  globalThis.DATA_VALIDATOR = DATA_VALIDATOR;
}
