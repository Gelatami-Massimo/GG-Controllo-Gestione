// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 082_sync_prodotti.js
// RUOLO: Sincronizzazione automatica foglio Prodotti da Righe + suggerimento UM da descrizione
// NOTE: Due funzionalità distinte - sync da Righe e parsing peso da Descrizione
// =============================================================

const SYNC_PRODOTTI = (() => {
  /**
   * Sincronizza il foglio Prodotti a partire dalle righe fatture.
   * Crea nuovi prodotti per codici mai visti, aggiorna soft i campi vuoti degli esistenti.
   * NON modifica MAI: Ingrediente, UMBase, PZxCT, KGxPZ, PZxFila, FilePerCT, Note, NonInUso.
   * 
   * PROTEZIONE ANTI-RACE: Usa Lock per prevenire esecuzioni parallele
   * 
   * @returns {{nuovi: number, aggiornati: number}} Statistiche sincronizzazione
   */
  function syncProdottiFromRighe() {
    const lock = LockService.getScriptLock();
    const lockAcquired = lock.tryLock(5000); // Prova ad acquisire lock per max 5 secondi
    
    if (!lockAcquired) {
      LOG.warn('SYNC_PRODOTTI', 'Sync già in esecuzione, operazione annullata (lock non acquisito).');
      return { nuovi: 0, aggiornati: 0, skipped: true };
    }
    
    try {
      return _syncProdottiFromRigheInternal();
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Implementazione interna del sync (protetta da lock).
   * @private
   */
  function _syncProdottiFromRigheInternal() {
    const stats = { nuovi: 0, aggiornati: 0 };

    // 1. Carica foglio Prodotti e crea mappa keyProd -> {rowIndex, data}
    const shProdotti = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
    if (!shProdotti) {
      LOG.error('SYNC_PRODOTTI', 'Foglio Prodotti non trovato.');
      return stats;
    }

    const headerRowProd = SHEETS._findHeaderRow(shProdotti, SHEETS.SHEET_NAMES.Prodotti);
    const idxProd = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);

    // Verifica colonne essenziali Prodotti
    const requiredProd = ['FornitoreID', 'CodiceFornitore', 'Descrizione', 'UM', 'CodiceInterno'];
    const missingProd = requiredProd.filter(k => idxProd[k] === undefined);
    if (missingProd.length) {
      LOG.error('SYNC_PRODOTTI', 'Intestazioni mancanti in Prodotti.', { missing: missingProd });
      return stats;
    }

    // Forza formato TEXT su colonna CodiceFornitore
    try {
      const codFornCol = idxProd.CodiceFornitore + 1;
      const lastRowProd = shProdotti.getLastRow();
      if (lastRowProd > headerRowProd) {
        const rangeCodForn = shProdotti.getRange(headerRowProd + 1, codFornCol, lastRowProd - headerRowProd, 1);
        rangeCodForn.setNumberFormat('@');
      }
    } catch (e) {
      LOG.warn('SYNC_PRODOTTI', 'Errore applicando formato TEXT a CodiceFornitore.', { error: e.message });
    }

    // Leggi Prodotti esistenti
    const prodottiMap = new Map(); // key -> {rowIndex, data}
    const codiciInterniSet = new Set(); // Set di CodiciInterni già esistenti (per prevenire duplicati esatti)
    const lastRowProd = shProdotti.getLastRow();
    if (lastRowProd > headerRowProd) {
      const valuesProd = shProdotti.getRange(headerRowProd + 1, 1, lastRowProd - headerRowProd, shProdotti.getLastColumn()).getValues();
      valuesProd.forEach((row, i) => {
        const fornId = String(row[idxProd.FornitoreID] || '').trim();
        const codForn = String(row[idxProd.CodiceFornitore] || '').trim();
        const codiceInterno = String(row[idxProd.CodiceInterno] || '').trim();
        
        if (!fornId || !codForn) return;
        
        const key = `${fornId}||${codForn}`;
        return [
          d.codiceFornitore,
          d.righe[0].descrizione,
          d.righe[0].fornId,
          d.count,
          attivi,
          nonInUsoCount,
          causa,
          codiciInterni,
          date
        ];
      const fornName = String(row[idxRighe.DenominazioneFornitore] || '').trim();

      if (!fornId) return;

      const keyRiga = `${fornId}||${codArticolo}`;
      const existing = prodottiMap.get(keyRiga);

      if (!existing) {
        // NUOVO PRODOTTO - ma verifica che CodiceInterno non esista già
        const codiceInterno = `${fornId}-${codArticolo}`;
        
        // CONTROLLO ANTI-DUPLICATO ESATTO
        if (codiciInterniSet.has(codiceInterno)) {
          LOG.warn('SYNC_PRODOTTI', `CodiceInterno già esistente, skip creazione duplicato: ${codiceInterno}`, {
            fornitoreID: fornId,
            codiceFornitore: codArticolo,
            descrizione: descrizione
          });
          return; // Skip questo prodotto, è già presente
        }
        
        const categoria = fornitoriMap.get(fornId) || '';
        const now = new Date();

        const newRow = _buildProductRow(idxProd, {
          CodiceInterno: codiceInterno,
          CodiceFornitore: codArticolo,
          Descrizione: descrizione,
          UM: um,
          FornitoreID: fornId,
          DenominazioneFornitore: fornName,
          CategoriaProdotto: categoria,
          Note: '',
          CreatoIl: now,
          UltimoAgg: now,
          Ingrediente: '',
          NonInUso: false,
          UMBase: '',
          PZxCT: '',
          KGxPZ: '',
          PZxFila: '',
          FilePerCT: '',
          RichiedeSetup: true,
          CostoUnitario: '',
          UMCosto: ''
        });

        newProducts.push(newRow);
        codiciInterniSet.add(codiceInterno); // Aggiungi al set per prevenire duplicati nella stessa esecuzione
        stats.nuovi++;

      } else {
        // PRODOTTO ESISTENTE - aggiorna solo campi vuoti
        const existingData = existing.data;
        const rowIdx = existing.rowIndex;
        let needsUpdate = false;

        if (!updates[rowIdx]) updates[rowIdx] = {};

        // Aggiorna solo se vuoto
        if (!existingData[idxProd.Descrizione] && descrizione) {
          updates[rowIdx][idxProd.Descrizione] = descrizione;
          needsUpdate = true;
        }
        if (!existingData[idxProd.UM] && um) {
          updates[rowIdx][idxProd.UM] = um;
          needsUpdate = true;
        }
        if (!existingData[idxProd.DenominazioneFornitore] && fornName) {
          updates[rowIdx][idxProd.DenominazioneFornitore] = fornName;
          needsUpdate = true;
        }
        if (!existingData[idxProd.CategoriaProdotto]) {
          const categoria = fornitoriMap.get(fornId) || '';
          if (categoria) {
            updates[rowIdx][idxProd.CategoriaProdotto] = categoria;
            needsUpdate = true;
          }
        }

        if (needsUpdate) {
          updates[rowIdx][idxProd.UltimoAgg] = new Date();
          stats.aggiornati++;
        }
      }
    });

    // 4. Scrivi nuovi prodotti (con verifica anti-duplicati finale)
    if (newProducts.length > 0) {
      try {
        // RILEGGI il foglio Prodotti SUBITO PRIMA di scrivere (anti race-condition)
        const finalCheck = new Map();
        const lastRowCheck = shProdotti.getLastRow();
        if (lastRowCheck > headerRowProd) {
          const valuesCheck = shProdotti.getRange(headerRowProd + 1, 1, lastRowCheck - headerRowProd, shProdotti.getLastColumn()).getValues();
          valuesCheck.forEach(row => {
            const fornId = String(row[idxProd.FornitoreID] || '').trim();
            const codForn = String(row[idxProd.CodiceFornitore] || '').trim();
            if (fornId && codForn) {
              finalCheck.set(`${fornId}||${codForn}`, true);
            }
          });
        }

        // Filtra solo prodotti REALMENTE nuovi
        const safeProducts = newProducts.filter(row => {
          const fornId = String(row[idxProd.FornitoreID] || '').trim();
          const codForn = String(row[idxProd.CodiceFornitore] || '').trim();
          const key = `${fornId}||${codForn}`;
          return !finalCheck.has(key);
        });

        if (safeProducts.length === 0) {
          LOG.warn('SYNC_PRODOTTI', 'Tutti i nuovi prodotti sono duplicati (già presenti). Nessun inserimento.');
        } else {
          const startRow = Math.max(headerRowProd + 1, shProdotti.getLastRow() + 1);
          UTIL.writeBatched(shProdotti, startRow, safeProducts);
          LOG.info('SYNC_PRODOTTI', `Aggiunti ${safeProducts.length} nuovi prodotti (${newProducts.length - safeProducts.length} duplicati scartati).`);
          stats.nuovi = safeProducts.length; // Correggi conteggio
        }
      } catch (e) {
        LOG.error('SYNC_PRODOTTI', 'Errore scrittura nuovi prodotti.', { error: e.message });
      }
    }

    // 5. Applica aggiornamenti soft
    if (Object.keys(updates).length > 0) {
      try {
        UTIL.batchUpdateCells(shProdotti, updates, 1);
        LOG.info('SYNC_PRODOTTI', `Aggiornati ${stats.aggiornati} prodotti esistenti (campi vuoti).`);
      } catch (e) {
        LOG.error('SYNC_PRODOTTI', 'Errore aggiornamento prodotti esistenti.', { error: e.message });
      }
    }

    return stats;
  }

  /**
   * Riempie CodiceFornitore mancante nei prodotti usando le righe fattura.
   * Implementazione interna, invocata da API pubblica.
   */
  function _fixMissingSupplierCodesInternal() {
    const shProd = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
    const shRighe = SHEETS.get(SHEETS.SHEET_NAMES.Righe);
    if (!shProd || !shRighe) {
      LOG?.error('SYNC_CODES', 'Foglio Prodotti/Righe non trovato');
      return 0;
    }

    const hdrRowProd = SHEETS._findHeaderRow(shProd, SHEETS.SHEET_NAMES.Prodotti);
    const idxP = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
    const lastRowP = shProd.getLastRow();
    const lastColP = shProd.getLastColumn();
    const prodData = shProd.getRange(hdrRowProd + 1, 1, lastRowP - hdrRowProd, lastColP).getValues();

    const hdrRowR = SHEETS._findHeaderRow(shRighe, SHEETS.SHEET_NAMES.Righe);
    const idxR = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Righe);
    const lastRowR = shRighe.getLastRow();
    const lastColR = shRighe.getLastColumn();
    const righeData = shRighe.getRange(hdrRowR + 1, 1, lastRowR - hdrRowR, lastColR).getValues();

    // Costruisci mappa: CodiceInternoBreve -> frequenza codici fornitore dalle righe
    const freqMap = new Map();
    righeData.forEach(r => {
      const tipo = String(r[idxR.TipoRiga] || '').trim();
      if (tipo !== 'ARTICOLO') return;
      const codiceBreve = String(r[idxR.CodiceInternoBreve] || '').trim();
      const codiceFornRiga = String(r[idxR['Codice Articolo Fornitore']] || '').trim();
      if (!codiceBreve || !codiceFornRiga) return;
      const norm = PRODUCTS.normalizeCodiceFornitore(codiceFornRiga);
      if (!norm || norm.startsWith('TEMP_')) return;
      const m = freqMap.get(codiceBreve) || new Map();
      m.set(norm, (m.get(norm) || 0) + 1);
      freqMap.set(codiceBreve, m);
    });

    // Applica aggiornamenti a Prodotti
    let updates = 0;
    for (let i = 0; i < prodData.length; i++) {
      const row = prodData[i];
      const codiceBreve = String(row[idxP.CodiceInternoBreve] || '').trim();
      let codiceForn = String(row[idxP.CodiceFornitore] || '').trim();
      if (!codiceBreve) continue;
      const isMissing = !codiceForn || codiceForn.toUpperCase().startsWith('TEMP_');
      const candidates = freqMap.get(codiceBreve);
      if (!isMissing || !candidates) continue;
      // Scegli il codice con massima frequenza
      let bestCode = null, bestFreq = -1;
      for (const [code, f] of candidates.entries()) {
        if (f > bestFreq) { bestFreq = f; bestCode = code; }
      }
      if (bestCode) {
        const targetRow = hdrRowProd + 1 + i;
        shProd.getRange(targetRow, idxP.CodiceFornitore + 1).setValue(bestCode);
        shProd.getRange(targetRow, idxP.UltimoAgg + 1).setValue(new Date());
        updates++;
      }
    }
    LOG?.info('SYNC_CODES', `Aggiornati ${updates} CodiceFornitore mancanti da Righe.`);
    return updates;
  }

  /** API pubblica: fix codici fornitore mancanti */
  function fixMissingSupplierCodes() {
    const lock = LockService.getScriptLock();
    const ok = lock.tryLock(5000);
    if (!ok) {
      LOG?.warn('SYNC_CODES', 'Operazione già in esecuzione.');
      return 0;
    }
    try {
      return _fixMissingSupplierCodesInternal();
    } finally {
      lock.releaseLock();
    }
  }
  /**
   * Suggerisce UMBase e KGxPZ leggendo la Descrizione dei prodotti con RichiedeSetup=TRUE.
   * SOLO per pattern PESO affidabili (kg, gr).
   * NON gestisce volumi (litri, ml, bottiglie) per evitare ambiguità.
   * NON sovrascrive valori già compilati manualmente.
   * 
   * @returns {{aggiornati: number}} Statistiche suggerimenti applicati
   */
  function suggestUnitsFromDescription() {
    const stats = { aggiornati: 0 };

    const shProdotti = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
    if (!shProdotti) {
      LOG.error('SUGGERISCI_UM', 'Foglio Prodotti non trovato.');
      return stats;
    }

    const headerRow = SHEETS._findHeaderRow(shProdotti, SHEETS.SHEET_NAMES.Prodotti);
    const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);

    // Verifica colonne necessarie
    const required = ['Descrizione', 'RichiedeSetup', 'UMBase', 'KGxPZ', 'NonInUso', 'Note'];
    const missing = required.filter(k => idx[k] === undefined);
    if (missing.length) {
      LOG.error('SUGGERISCI_UM', 'Intestazioni mancanti in Prodotti.', { missing });
      return stats;
    }

    const lastRow = shProdotti.getLastRow();
    if (lastRow <= headerRow) {
      LOG.info('SUGGERISCI_UM', 'Foglio Prodotti vuoto.');
      return stats;
    }

    const values = shProdotti.getRange(headerRow + 1, 1, lastRow - headerRow, shProdotti.getLastColumn()).getValues();
    const updates = {}; // rowIndex -> {colIndex: value}

    values.forEach((row, i) => {
      const rowIdx = headerRow + 1 + i;

      // Filtro: solo prodotti che richiedono setup, non disabilitati, con descrizione
      const richiedeSetup = row[idx.RichiedeSetup] === true || String(row[idx.RichiedeSetup]).toLowerCase() === 'true';
      const nonInUso = row[idx.NonInUso] === true || String(row[idx.NonInUso]).toLowerCase() === 'true';
      const descrizione = String(row[idx.Descrizione] || '').trim();
      const umBase = String(row[idx.UMBase] || '').trim();
      const kgxpz = row[idx.KGxPZ];

      if (!richiedeSetup || nonInUso || !descrizione) return;
      if (umBase && kgxpz) return; // Già configurato

      // Parsing descrizione
      const parsed = _parseWeightFromDescription(descrizione);
      if (!parsed) return; // Nessun pattern riconosciuto

      if (!updates[rowIdx]) updates[rowIdx] = {};

      // Applica suggerimenti solo se campi vuoti
      if (!umBase && parsed.tipo === 'KG') {
        updates[rowIdx][idx.UMBase] = 'KG';
      }
      if (!kgxpz && parsed.kgPerPezzo) {
        updates[rowIdx][idx.KGxPZ] = parsed.kgPerPezzo;
      }

      // Aggiungi nota solo se Note vuoto
      const note = String(row[idx.Note] || '').trim();
      if (!note) {
        updates[rowIdx][idx.Note] = 'UM/KG suggeriti automaticamente da descrizione';
      }

      if (Object.keys(updates[rowIdx]).length > 0) {
        stats.aggiornati++;
      }
    });

    // Applica aggiornamenti
    if (Object.keys(updates).length > 0) {
      try {
        UTIL.batchUpdateCells(shProdotti, updates, 1);
        LOG.info('SUGGERISCI_UM', `Suggerimenti applicati a ${stats.aggiornati} prodotti.`);
      } catch (e) {
        LOG.error('SUGGERISCI_UM', 'Errore applicando suggerimenti.', { error: e.message });
      }
    } else {
      LOG.info('SUGGERISCI_UM', 'Nessun suggerimento applicabile.');
    }

    return stats;
  }

  // ========== HELPERS PRIVATI ==========

  /**
   * Costruisce array riga prodotto allineato allo schema Prodotti.
   * @private
   */
  function _buildProductRow(idx, data) {
    const schema = SHEETS.SCHEMAS[SHEETS.SHEET_NAMES.Prodotti];
    if (!schema || !Array.isArray(schema)) {
      LOG.error('SYNC_PRODOTTI_BUILD', 'Schema Prodotti mancante.');
      return [];
    }

    return schema.map(header => {
      const key = String(header).replace(/ /g, '');
      return key in data ? data[key] : '';
    });
  }

  /**
   * Carica mappa FornitoreID -> Categoria dal foglio Fornitori.
   * @private
   */
  function _loadFornitoriMap() {
    const map = new Map();
    const shForn = SHEETS.get(SHEETS.SHEET_NAMES.Fornitori);
    if (!shForn) return map;

    try {
      const headerRow = SHEETS._findHeaderRow(shForn, SHEETS.SHEET_NAMES.Fornitori);
      const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fornitori);
      if (idx.FornitoreID === undefined || idx.Categoria === undefined) return map;

      const lastRow = shForn.getLastRow();
      if (lastRow <= headerRow) return map;

      const values = shForn.getRange(headerRow + 1, 1, lastRow - headerRow, shForn.getLastColumn()).getValues();
      values.forEach(row => {
        const id = String(row[idx.FornitoreID] || '').trim();
        const cat = String(row[idx.Categoria] || '').trim();
        if (id && cat) map.set(id, cat);
      });
    } catch (e) {
      LOG.warn('SYNC_PRODOTTI_FORNITORI', 'Errore caricando mappa fornitori.', { error: e.message });
    }

    return map;
  }

  /**
   * Estrae peso da descrizione prodotto usando pattern affidabili.
   * Gestisce SOLO pesi (kg, gr) - NON volumi.
   * 
   * Pattern riconosciuti:
   * - "kg 1,3" / "kg 1.3" / "kg.1,3"
   * - "busta gr.800" / "gr 800" / "g 800"
   * - "vaso da kg 1,2"
   * 
   * @param {string} descrizione - Descrizione prodotto
   * @returns {{tipo: string, kgPerPezzo: number}|null} Peso parsato o null se non riconosciuto
   * @private
   */
  function _parseWeightFromDescription(descrizione) {
    if (!descrizione) return null;

    const desc = descrizione.toLowerCase().trim();

    // Pattern 1: kg con decimali (virgola o punto)
    // Es: "kg 1,3", "kg 1.3", "kg.1,3", "da kg 1.2"
    const regexKg = /kg[\s.]*([0-9]+[,.]?[0-9]*)/i;
    const matchKg = desc.match(regexKg);
    if (matchKg) {
      const kg = UTIL.number.parseStrict(matchKg[1]);
      if (kg !== null && kg > 0) {
        return { tipo: 'KG', kgPerPezzo: kg };
      }
    }

    // Pattern 2: grammi (gr o g seguiti da numero intero)
    // Es: "gr.800", "gr 800", "g 800", "busta gr.800"
    const regexGr = /\b(?:gr?|grammi?)[\s.]*([0-9]+)\b/i;
    const matchGr = desc.match(regexGr);
    if (matchGr) {
      const gr = UTIL.number.parseStrict(matchGr[1]);
      if (gr !== null && gr > 0) {
        return { tipo: 'KG', kgPerPezzo: gr / 1000 };
      }
    }

    // Nessun pattern riconosciuto
    return null;
  }

  // ========== API PUBBLICA ==========
  return {
    syncProdottiFromRighe,
    suggestUnitsFromDescription,
    fixMissingSupplierCodes
  };
})();

// ========== WRAPPER PUBBLICI PER MENU ==========

/**
 * Diagnostica duplicati esistenti in Prodotti.
 * Identifica prodotti con stesso CodiceFornitore e analizza differenze.
 * 
 * @returns {void}
 */
function runDiagnosticaDuplicati() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shProdotti = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
  
  if (!shProdotti) {
    ss.toast('❌ Foglio Prodotti non trovato.', 'Errore', 5);
    return;
  }

  ss.toast('Analisi duplicati in corso...', 'Attendere...', -1);

  const headerRow = SHEETS._findHeaderRow(shProdotti, SHEETS.SHEET_NAMES.Prodotti);
  const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
  
  const lastRow = shProdotti.getLastRow();
  if (lastRow <= headerRow) {
    ss.toast('📋 Foglio Prodotti vuoto.', 'Info', 3);
    return;
  }

  // Mappa: CodiceFornitore -> Array di righe
  const mappaFornitori = new Map();
  const values = shProdotti.getRange(headerRow + 1, 1, lastRow - headerRow, shProdotti.getLastColumn()).getValues();

  values.forEach((row, i) => {
    const codForn = String(row[idx.CodiceFornitore] || '').trim();
    const fornId = String(row[idx.FornitoreID] || '').trim();
    
    if (!codForn) return;

    if (!mappaFornitori.has(codForn)) {
      mappaFornitori.set(codForn, []);
    }

    mappaFornitori.get(codForn).push({
      rowIndex: headerRow + 1 + i,
      codiceInterno: row[idx.CodiceInterno],
      fornId: fornId,
      descrizione: row[idx.Descrizione],
      ultimoAgg: row[idx.UltimoAgg],
      nonInUso: row[idx.NonInUso]
    });
  });

  // Filtra solo duplicati
  const duplicati = [];
  mappaFornitori.forEach((righe, codForn) => {
    if (righe.length > 1) {
      duplicati.push({
        codiceFornitore: codForn,
        righe: righe,
        count: righe.length
      });
    }
  });

  if (duplicati.length === 0) {
    ss.toast('✅ Nessun duplicato trovato!', 'Ottimo!', 5);
    LOG.info('DIAGNOSTICA_DUPLICATI', 'Nessun duplicato rilevato.');
    return;
  }

  // Analizza CAUSE duplicati
  const report = [];
  report.push(`🔍 ANALISI DUPLICATI - ${duplicati.length} prodotti con duplicati`);
  report.push('');

  duplicati.forEach(d => {
    const fornitoriDiversi = new Set(d.righe.map(r => r.fornId)).size > 1;
    const nonInUsoCount = d.righe.filter(r => r.nonInUso === true).length;
    const attivi = d.righe.length - nonInUsoCount;

    report.push(`📦 ${d.codiceFornitore} (${d.count} copie)`);
    report.push(`   Descrizione: ${d.righe[0].descrizione}`);
    
    if (fornitoriDiversi) {
      report.push(`   ⚠️ CAUSE: Fornitori diversi! ${d.righe.map(r => r.fornId).join(', ')}`);
    } else {
      report.push(`   FornitoreID: ${d.righe[0].fornId}`);
    }

    report.push(`   Attivi: ${attivi}, NonInUso: ${nonInUsoCount}`);
    
    d.righe.forEach((r, i) => {
      const status = r.nonInUso ? '❌ NonInUso' : '✅ Attivo';
      const dataStr = r.ultimoAgg ? new Date(r.ultimoAgg).toLocaleDateString('it-IT') : 'N/A';
      report.push(`   ${i + 1}. ${r.codiceInterno} (riga ${r.rowIndex}) - ${status} - Agg: ${dataStr}`);
    });
    
    report.push('');
  });

  // Mostra report
  const ui = SpreadsheetApp.getUi();
  const msg = report.join('\n');
  
  if (msg.length > 1000) {
    // Report troppo lungo - crea foglio
    _createDuplicatiDiagnosisSheet(ss, duplicati);
    ui.alert('Diagnostica Duplicati', 
      `Trovati ${duplicati.length} prodotti con duplicati.\n\n` +
      `Report dettagliato creato nel foglio "Diagnostica Duplicati".\n\n` +
      `Usa il modulo 124_prodotti_cleanup.js per pulire.`,
      ui.ButtonSet.OK);
  } else {
    ui.alert('Diagnostica Duplicati', msg, ui.ButtonSet.OK);
  }

  LOG.info('DIAGNOSTICA_DUPLICATI', `Trovati ${duplicati.length} prodotti con duplicati.`);
}

/**
 * Crea foglio diagnostico per analisi duplicati.
 * @private
 */
function _createDuplicatiDiagnosisSheet(ss, duplicati) {
  const sheetName = 'Diagnostica Duplicati';
  let sheet = ss.getSheetByName(sheetName);
  
  if (sheet) {
    ss.deleteSheet(sheet);
  }
  
  sheet = ss.insertSheet(sheetName);
  
  // Headers
  const headers = [
    'CodiceFornitore',
    'Descrizione',
    'FornitoreID',
    'Totale Copie',
    'Attivi',
    'NonInUso',
    'Causa Probabile',
    'CodiciInterni (separati da |)',
    'Date UltimoAgg'
  ];
  
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#4285f4').setFontColor('white');
  
  // Data
  const data = duplicati.map(d => {
    const fornitoriDiversi = new Set(d.righe.map(r => r.fornId)).size > 1;
    const nonInUsoCount = d.righe.filter(r => r.nonInUso === true).length;
    const attivi = d.righe.length - nonInUsoCount;
    
    let causa = '';
    if (fornitoriDiversi) {
      causa = 'Fornitori Diversi';
    } else if (attivi > 1) {
      causa = 'Modifiche Manuali / Race Condition';
    } else if (attivi === 1 && nonInUsoCount > 0) {
      causa = 'Storicizzazione (OK)';
    } else {
      causa = 'Sconosciuta';
    }
    
    const codiciInterni = d.righe.map(r => r.codiceInterno).join(' | ');
    const date = d.righe.map(r => r.ultimoAgg ? new Date(r.ultimoAgg).toLocaleDateString('it-IT') : 'N/A').join(' | ');
    
    return [
      d.codiceFornitore,
      d.righe[0].descrizione,
      d.righe[0].fornId,
      d.count,
      attivi,
      nonInUsoCount,
      causa,
      codiciInterni,
      date
    ];
  });
  
  if (data.length > 0) {
    sheet.getRange(2, 1, data.length, headers.length).setValues(data);
  }
  
  // Formattazione
  sheet.autoResizeColumns(1, headers.length);
  sheet.setFrozenRows(1);
  
  // Evidenzia problemi
  const causeRange = sheet.getRange(2, 7, data.length, 1);
  const causeValues = causeRange.getValues();
  causeValues.forEach((row, i) => {
    const cellRange = sheet.getRange(i + 2, 7);
    if (row[0] === 'Fornitori Diversi') {
      cellRange.setBackground('#ea4335').setFontColor('white');
    } else if (row[0] === 'Modifiche Manuali / Race Condition') {
      cellRange.setBackground('#fbbc04').setFontColor('black');
    } else if (row[0] === 'Storicizzazione (OK)') {
      cellRange.setBackground('#34a853').setFontColor('white');
    }
  });
  
  LOG.info('DIAGNOSTICA_DUPLICATI', `Creato foglio diagnostico con ${data.length} righe.`);
}

/**
 * Sincronizza foglio Prodotti dalle righe fatture.
 * Wrapper pubblico per menu UI.
 * @returns {void}
 */
function runSyncProdotti() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    ss.toast('Sincronizzazione Prodotti in corso...', 'Attendere...', -1);
    
    const stats = SYNC_PRODOTTI.syncProdottiFromRighe();
    
    if (stats.skipped) {
      ss.toast('⚠️ Sync già in esecuzione.\nRiprova tra qualche secondo.', 'Avviso', 5);
      LOG.warn('SYNC_PRODOTTI', 'Sync saltato (già in esecuzione).');
      return;
    }
    
    LOG.info('SYNC_PRODOTTI', 'Sincronizzazione completata.', stats);
    ss.toast(
      `✅ Sincronizzazione completata!\n` +
      `Nuovi prodotti: ${stats.nuovi}\n` +
      `Aggiornati: ${stats.aggiornati}`,
      'Fatto!',
      5
    );
  } catch (e) {
    LOG.error('SYNC_PRODOTTI', 'Errore durante sincronizzazione.', { error: e.message, stack: e.stack });
    ss.toast(`❌ Errore: ${e.message}`, 'Errore', 5);
    throw e;
  }
}

/**
 * Suggerisce UM e KG/PZ leggendo le descrizioni prodotti.
 * Wrapper pubblico per menu UI.
 * @returns {void}
 */
function runSuggestUnitsFromDescription() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    ss.toast('Analisi descrizioni prodotti in corso...', 'Attendere...', -1);
    
    const stats = SYNC_PRODOTTI.suggestUnitsFromDescription();
    
    LOG.info('SUGGERISCI_UM', 'Suggerimenti completati.', stats);
    ss.toast(
      `✅ Analisi completata!\n` +
      `Prodotti aggiornati: ${stats.aggiornati}`,
      'Fatto!',
      5
    );
  } catch (e) {
    LOG.error('SUGGERISCI_UM', 'Errore durante suggerimento UM.', { error: e.message, stack: e.stack });
    ss.toast(`❌ Errore: ${e.message}`, 'Errore', 5);
    throw e;
  }
}

// Registrazione moduli
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('SYNC_PRODOTTI', ['SHEETS', 'LOG', 'UTIL']);
}

if (typeof GG !== 'undefined') {
  GG.register('SYNC_PRODOTTI', SYNC_PRODOTTI);
}
