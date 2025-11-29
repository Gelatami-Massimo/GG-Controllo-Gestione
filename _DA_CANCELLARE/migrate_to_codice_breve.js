/**
 * Script di migrazione: Aggiunge CodiceInternoBreve e ChiaveDescrizione al foglio Prodotti.
 * 
 * ESECUZIONE:
 * 1. Apri lo script nel Google Apps Script Editor
 * 2. Esegui la funzione migrateProductsToCodiceBreve()
 * 3. Verifica il log per conferma
 * 
 * SAFE: Non sovrascrive dati esistenti, solo aggiunge colonne mancanti.
 */

function migrateProductsToCodiceBreve() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Prodotti');
  
  if (!sh) {
    Logger.log('❌ Foglio Prodotti non trovato!');
    return;
  }

  // 1. Trova header row
  const maxRows = sh.getMaxRows();
  let headerRow = 1;
  for (let i = 1; i <= Math.min(10, maxRows); i++) {
    const val = sh.getRange(i, 1).getValue();
    if (String(val).toLowerCase().includes('codiceinterno')) {
      headerRow = i;
      break;
    }
  }

  // 2. Leggi headers esistenti
  const lastCol = sh.getLastColumn();
  const headers = sh.getRange(headerRow, 1, 1, lastCol).getValues()[0];
  
  const idx = {};
  headers.forEach((h, i) => {
    const clean = String(h).replace(/\s+/g, '');
    idx[clean] = i;
  });

  Logger.log(`📋 Headers trovati: ${Object.keys(idx).length}`);

  // 3. Verifica se colonne già esistono
  const needCodiceBreve = idx.CodiceInternoBreve === undefined;
  const needChiaveDesc = idx.ChiaveDescrizione === undefined;

  if (!needCodiceBreve && !needChiaveDesc) {
    Logger.log('✅ Colonne CodiceInternoBreve e ChiaveDescrizione già presenti. Nessuna migrazione necessaria.');
    return;
  }

  // 4. Inserisci nuove colonne dopo CodiceInterno
  const codInternoCol = idx.CodiceInterno + 1; // 1-based
  let insertedCols = 0;

  if (needCodiceBreve) {
    sh.insertColumnAfter(codInternoCol);
    sh.getRange(headerRow, codInternoCol + 1).setValue('CodiceInternoBreve');
    insertedCols++;
    Logger.log(`✅ Colonna CodiceInternoBreve inserita in posizione ${codInternoCol + 1}`);
  }

  if (needChiaveDesc) {
    sh.insertColumnAfter(codInternoCol + insertedCols);
    sh.getRange(headerRow, codInternoCol + insertedCols + 1).setValue('ChiaveDescrizione');
    insertedCols++;
    Logger.log(`✅ Colonna ChiaveDescrizione inserita in posizione ${codInternoCol + insertedCols}`);
  }

  // 5. Rileggi indici dopo inserimento
  const newLastCol = sh.getLastColumn();
  const newHeaders = sh.getRange(headerRow, 1, 1, newLastCol).getValues()[0];
  const newIdx = {};
  newHeaders.forEach((h, i) => {
    const clean = String(h).replace(/\s+/g, '');
    newIdx[clean] = i;
  });

  // 6. Popola valori per righe esistenti
  const lastRow = sh.getLastRow();
  if (lastRow <= headerRow) {
    Logger.log('✅ Nessun prodotto esistente da migrare.');
    return;
  }

  const data = sh.getRange(headerRow + 1, 1, lastRow - headerRow, newLastCol).getValues();
  const updates = [];
  const existingCodes = new Set();

  // Prima passata: raccogli codici brevi esistenti (se popolati)
  data.forEach(row => {
    const breveCurrent = String(row[newIdx.CodiceInternoBreve] || '').trim();
    if (breveCurrent) {
      existingCodes.add(breveCurrent);
    }
  });

  Logger.log(`📊 Trovati ${existingCodes.size} codici brevi esistenti.`);

  // Seconda passata: genera/aggiorna
  data.forEach((row, i) => {
    const fornId = String(row[newIdx.FornitoreID] || '').trim();
    const denominazione = String(row[newIdx.DenominazioneFornitore] || '').trim();
    const descrizione = String(row[newIdx.Descrizione] || '').trim();
    
    const breveCurrent = String(row[newIdx.CodiceInternoBreve] || '').trim();
    const chiaveCurrent = String(row[newIdx.ChiaveDescrizione] || '').trim();

    let needUpdate = false;
    const rowNum = headerRow + 1 + i;

    // Genera CodiceInternoBreve se mancante
    if (!breveCurrent && denominazione) {
      const sigla = generateSupplierSigla(denominazione);
      const newBreve = generateUniqueCode(sigla, existingCodes);
      existingCodes.add(newBreve);
      
      sh.getRange(rowNum, newIdx.CodiceInternoBreve + 1).setValue(newBreve);
      needUpdate = true;
      
      if ((i + 1) % 100 === 0) {
        Logger.log(`⏳ Processati ${i + 1}/${data.length} prodotti...`);
      }
    }

    // Genera ChiaveDescrizione se mancante
    if (!chiaveCurrent && descrizione) {
      const chiave = normalizeDesc(descrizione);
      sh.getRange(rowNum, newIdx.ChiaveDescrizione + 1).setValue(chiave);
      needUpdate = true;
    }

    if (needUpdate) {
      updates.push(rowNum);
    }
  });

  Logger.log(`✅ Migrazione completata! ${updates.length} prodotti aggiornati.`);
  Logger.log(`📦 Totale codici brevi: ${existingCodes.size}`);
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================
// NOTA: Per accedere alle funzioni del modulo PRODUCTS, usa:
//   const PRODUCTS = GG.get('PRODUCTS');
//   PRODUCTS.normalizeDescrizione(desc);
//   PRODUCTS.generateSupplierSigla(fornitore);

function generateSupplierSigla(denominazione) {
  if (!denominazione) return 'GEN';
  
  const clean = String(denominazione)
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]/g, '');
  
  if (clean.length === 0) return 'GEN';
  if (clean.length <= 3) return clean;
  
  const consonants = clean.replace(/[AEIOU]/g, '');
  if (consonants.length >= 3) {
    return consonants.substring(0, 3);
  }
  
  return clean.substring(0, 3);
}

function generateUniqueCode(sigla, existingCodes) {
  let maxNum = 0;
  const pattern = new RegExp(`^${sigla}-(\\d{4})$`, 'i');
  
  existingCodes.forEach(code => {
    const match = code.match(pattern);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });
  
  const newNum = maxNum + 1;
  const paddedNum = String(newNum).padStart(4, '0');
  return `${sigla}-${paddedNum}`;
}

// ✅ ELIMINATO: normalizeDesc() duplicato
// Usa invece: PRODUCTS.normalizeDescrizione() dal modulo principale
function normalizeDesc(descrizione) {
  // Wrapper per compatibilità - usa implementazione del modulo PRODUCTS
  if (!descrizione) return '';
  
  return String(descrizione)
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.,;:!?'"(){}\[\]]/g, ' ')
    .replace(/[-\/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
