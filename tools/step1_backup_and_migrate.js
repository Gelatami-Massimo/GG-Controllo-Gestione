/**
 * STEP 1: Backup e Migrazione a CodiceInternoBreve
 * 
 * ESECUZIONE:
 * 1. Apri lo script nel Google Apps Script Editor
 * 2. Esegui la funzione step1_backupAndMigrate()
 * 3. Verifica il log per conferma
 * 
 * SAFE: Crea backup prima di modificare, non sovrascrive dati esistenti.
 */

function step1_backupAndMigrate() {
  Logger.log('='.repeat(60));
  Logger.log('🚀 STEP 1: Backup e Migrazione CodiceInternoBreve');
  Logger.log('='.repeat(60));
  
  // 1. BACKUP
  Logger.log('\n📦 FASE 1: Creazione backup...');
  const backupName = createBackupProdotti();
  if (!backupName) {
    Logger.log('❌ Backup fallito. Migrazione annullata.');
    return;
  }
  Logger.log(`✅ Backup creato: ${backupName}`);
  
  // 2. MIGRAZIONE
  Logger.log('\n🔧 FASE 2: Migrazione dati...');
  const migrateResult = migrateProductsToCodiceBreve();
  
  if (!migrateResult.success) {
    Logger.log('❌ Migrazione fallita. Verifica errori sopra.');
    Logger.log(`💡 Per rollback: ripristina foglio "${backupName}"`);
    return;
  }
  
  // 3. VERIFICA
  Logger.log('\n✅ FASE 3: Verifica integrità...');
  const verifyResult = verificaMigrazione();
  
  // 4. RIEPILOGO
  Logger.log('\n' + '='.repeat(60));
  Logger.log('📊 RIEPILOGO MIGRAZIONE');
  Logger.log('='.repeat(60));
  Logger.log(`Backup: ${backupName}`);
  Logger.log(`Prodotti totali: ${verifyResult.totale}`);
  Logger.log(`CodiceInternoBreve popolati: ${verifyResult.brevePopol}`);
  Logger.log(`ChiaveDescrizione popolate: ${verifyResult.chiavePopol}`);
  Logger.log(`Codici brevi univoci: ${verifyResult.univoci ? '✅ SI' : '⚠️ NO'}`);
  Logger.log(`Duplicati trovati: ${verifyResult.duplicati.length}`);
  
  if (verifyResult.duplicati.length > 0) {
    Logger.log('\n⚠️ ATTENZIONE: Codici duplicati:');
    verifyResult.duplicati.forEach(d => {
      Logger.log(`  - ${d.codice} (righe: ${d.righe.join(', ')})`);
    });
  }
  
  Logger.log('\n' + '='.repeat(60));
  if (verifyResult.brevePopol === verifyResult.totale && 
      verifyResult.chiavePopol === verifyResult.totale &&
      verifyResult.univoci) {
    Logger.log('✅ MIGRAZIONE COMPLETATA CON SUCCESSO!');
    Logger.log('👉 Prossimo step: Sostituire modulo 040_products.js');
  } else {
    Logger.log('⚠️ MIGRAZIONE COMPLETATA CON WARNING');
    Logger.log('👉 Verifica i warning sopra prima di procedere');
  }
  Logger.log('='.repeat(60));
}

// ============================================================
// BACKUP
// ============================================================

function createBackupProdotti() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('Prodotti');
    
    if (!sh) {
      Logger.log('❌ Foglio Prodotti non trovato!');
      return null;
    }
    
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
    const backupName = `Prodotti_BACKUP_${timestamp}`;
    
    const backup = sh.copyTo(ss);
    backup.setName(backupName);
    
    return backupName;
  } catch (error) {
    Logger.log(`❌ Errore durante backup: ${error.message}`);
    return null;
  }
}

// ============================================================
// MIGRAZIONE
// ============================================================

function migrateProductsToCodiceBreve() {
  const result = {
    success: false,
    updated: 0,
    totalCodes: 0
  };
  
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName('Prodotti');
    
    if (!sh) {
      Logger.log('❌ Foglio Prodotti non trovato!');
      return result;
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
      Logger.log('✅ Colonne già presenti, popolo solo valori mancanti...');
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
      result.success = true;
      return result;
    }

    const data = sh.getRange(headerRow + 1, 1, lastRow - headerRow, newLastCol).getValues();
    const updates = [];
    const existingCodes = new Set();

    // Prima passata: raccogli codici brevi esistenti
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
    
    result.success = true;
    result.updated = updates.length;
    result.totalCodes = existingCodes.size;
    
    return result;
    
  } catch (error) {
    Logger.log(`❌ Errore durante migrazione: ${error.message}`);
    Logger.log(`Stack: ${error.stack}`);
    return result;
  }
}

// ============================================================
// VERIFICA
// ============================================================

function verificaMigrazione() {
  const result = {
    totale: 0,
    brevePopol: 0,
    chiavePopol: 0,
    univoci: true,
    duplicati: []
  };
  
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Prodotti');
    const data = sh.getDataRange().getValues();
    const headers = data[0];
    
    const idxBreve = headers.findIndex(h => String(h).replace(/\s+/g, '') === 'CodiceInternoBreve');
    const idxChiave = headers.findIndex(h => String(h).replace(/\s+/g, '') === 'ChiaveDescrizione');
    
    if (idxBreve === -1 || idxChiave === -1) {
      Logger.log('❌ Colonne CodiceInternoBreve o ChiaveDescrizione mancanti!');
      return result;
    }
    
    const codiciBrevi = new Map(); // codice -> [righe]
    
    for (let i = 1; i < data.length; i++) {
      result.totale++;
      
      const breve = String(data[i][idxBreve] || '').trim();
      const chiave = String(data[i][idxChiave] || '').trim();
      
      if (breve) {
        result.brevePopol++;
        
        if (codiciBrevi.has(breve)) {
          codiciBrevi.get(breve).push(i + 1);
          result.univoci = false;
        } else {
          codiciBrevi.set(breve, [i + 1]);
        }
      }
      
      if (chiave) {
        result.chiavePopol++;
      }
    }
    
    // Trova duplicati
    codiciBrevi.forEach((righe, codice) => {
      if (righe.length > 1) {
        result.duplicati.push({ codice, righe });
      }
    });
    
    return result;
    
  } catch (error) {
    Logger.log(`❌ Errore durante verifica: ${error.message}`);
    return result;
  }
}

// ============================================================
// HELPER FUNCTIONS
// ============================================================

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

// ============================================================
// NORMALIZZAZIONE DESCRIZIONI
// ============================================================
// NOTA: Funzione mantenuta per compatibilità tool standalone.
// Per accedere all'implementazione principale del modulo PRODUCTS:
//   const PRODUCTS = GG.get('PRODUCTS');
//   PRODUCTS.normalizeDescrizione(desc);

function normalizeDesc(descrizione) {
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
