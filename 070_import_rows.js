// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 70_import_rows.js
// VERSIONE: 25.1 (Row Import)
// DESCRIZIONE: Importa le righe. Filtro righe "spazzatura" dinamico
//              • Logica di skip corretta (non blocca import futuri)
//              • RigheImportate = TRUE solo se le righe sono state scritte
// =============================================================

const IMPORT_ROWS = (function () {

  function run(isSilent = false) {
    if (!isSilent) STATE.clear(App.config.keys.progress);
    _mainLoop(isSilent);
  }

  /**
   * Legge le parole chiave da ignorare dal foglio 'Filtro Righe Spazzatura'.
   * @returns {Set<string>} Un Set di parole chiave in minuscolo.
   */
  function _getJunkKeywords() {
    const junkSet = new Set();
    const sheetName = SHEETS.SHEET_NAMES.Filtro_Righe_Spazzatura;
    const sh = SHEETS.get(sheetName);
    
    if (!sh) {
      LOG.warn('ROWS_JUNK_FILTER', `Foglio ${sheetName} non trovato. Filtro righe spazzatura disattivato.`);
      return junkSet;
    }
    
    const headerRow = SHEETS._findHeaderRow(sh, sheetName);
    if (sh.getLastRow() <= headerRow) {
       LOG.info('ROWS_JUNK_FILTER', `Foglio ${sheetName} vuoto. Nessuna parola chiave caricata.`);
       return junkSet; // Foglio vuoto
    }

    try {
      const idx = SHEETS.headerIndex(sheetName);
      const colKey = 'ParolaChiaveDaIgnorare'; // Nome colonna dallo schema
      
      if (idx[colKey] === undefined) {
         LOG.error('ROWS_JUNK_FILTER', `Colonna '${colKey}' non trovata in ${sheetName}. Filtro disattivato.`);
         return junkSet;
      }
      
      const colIndex = idx[colKey];
      const data = sh.getRange(headerRow + 1, colIndex + 1, sh.getLastRow() - headerRow, 1).getValues();
      
      data.forEach(([keyword]) => {
        const kw = String(keyword || '').trim().toLowerCase();
        if (kw) junkSet.add(kw);
      });
      
      LOG.info('ROWS_JUNK_FILTER', `Caricate ${junkSet.size} parole chiave dal foglio ${sheetName}.`);
    } catch (e) {
      LOG.error('ROWS_JUNK_FILTER', `Errore lettura foglio ${sheetName}.`, { error: e.message });
    }
    return junkSet;
  }

  function _mainLoop(isSilent) {
    const startTime = new Date();
    const maxSec = CONFIG.get('MAX_RUNTIME_SEC', 240);

    const shF = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    const shR = SHEETS.get(SHEETS.SHEET_NAMES.Righe);
    if (!shF || !shR) throw new Error("Fogli 'Fatture' o 'Righe' non trovati.");

    const headerRowF = SHEETS._findHeaderRow(shF, SHEETS.SHEET_NAMES.Fatture);
    const idxF = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);

    const righeHeaders = SHEETS.SCHEMAS[SHEETS.SHEET_NAMES.Righe];
    if (!righeHeaders || righeHeaders.length === 0) {
      throw new Error("Schema Righe non trovato in SHEETS.SCHEMAS.");
    }

    // Validazione indici critici
    const requiredKeys = [
      'FileID', 'FornitoreID', 'RigheImportate', 'ImportaRigheSrc',
      'TotImponibile', 'Famiglia', 'Categoria', 'Sede', 'Data',
      'Anno', 'Mese', 'NumeroDoc', 'DenominazioneFornitore', 'TipoDoc'
    ];
    const missing = requiredKeys.filter(k => idxF[k] === undefined);
    if (missing.length > 0) {
      throw new Error("Colonne mancanti nel foglio Fatture: " + missing.join(', '));
    }
    const maxColNeeded = Math.max(...requiredKeys.map(k => idxF[k])) + 1;

    // Carica filtro dinamico
    const junkKeywordsSet = _getJunkKeywords();

    // Fornitori abilitati
    const suppliersData = _getSuppliersData();
    const enabledSupplierIds = new Set();
    suppliersData.forEach((data, id) => {
      if (data.importaRighe === true) {
        enabledSupplierIds.add(String(id).trim().replace(/^IT/i, '').replace(/^0+/, ''));
      }
    });
    LOG?.info('ROWS', `Fornitori abilitati: ${enabledSupplierIds.size}`);

    // Cache prodotti
    const productCache = PRODUCTS.primeCache();

    // Cursor
    const CURSOR_KEY = App.config.keys.cursors.rows;
    const cursor = STATE.getJSON(CURSOR_KEY, { nextRow: headerRowF + 1 });
    let currentRow = Math.max(headerRowF + 1, Number(cursor.nextRow));
    const lastInvoiceRow = shF.getLastRow();

    if (currentRow > lastInvoiceRow) {
      if (!isSilent) UTIL.showToast('Nessuna nuova riga da importare.', 'Info', 5);
      STATE.clear(CURSOR_KEY);
      return;
    }

    const rowsBuffer = [];
    const flagUpdates = {};
    let processedInvoices = 0;
    let skippedInvoices = 0;

    const CHUNK_SIZE = Number(CONFIG.get('ROWS_CHUNK_SIZE', 100)) || 100;
    const FLUSH_ROWS_EVERY = Number(CONFIG.get('ROWS_FLUSH_EVERY', 2000)) || 2000;

    // Stati finali che indicano fattura già processata CON righe scritte
    const finalStates = ['imported', 'total_mismatch'];

    if (!isSilent) {
      STATE.setJSON(App.config.keys.progress, {
        current: currentRow, total: lastInvoiceRow, message: 'Avvio import righe...'
      });
    }

    // Ciclo principale su blocchi
    while (currentRow <= lastInvoiceRow) {
      const elapsed = (new Date() - startTime) / 1000;
      if (elapsed > maxSec) {
        // Timeout
        STATE.setJSON(CURSOR_KEY, { nextRow: currentRow });
        _flushAll(shR, rowsBuffer, shF, flagUpdates, productCache, headerRowF);
        LOG?.warn('ROWS', `Timeout. Ripresa salvata dalla riga ${currentRow}.`);

        if (!isSilent) {
          STATE.setJSON(App.config.keys.progress, {
            current: currentRow, total: lastInvoiceRow, message: 'Timeout. In pausa...'
          });
          UTIL.showToast('Timeout raggiunto. Clicca "Continua" per riprendere.', 'Pausa', 10);
        }
        return;
      }

      // Legge blocco
      const chunkRowCount = Math.min(CHUNK_SIZE, lastInvoiceRow - currentRow + 1);
      let invoicesChunk = [];
      try {
        invoicesChunk = shF.getRange(currentRow, 1, chunkRowCount, maxColNeeded).getValues();
      } catch (e) {
        LOG?.error('ROWS_MAIN', `Errore lettura chunk fatture da riga ${currentRow}`, { error: e.message });
        currentRow += chunkRowCount;
        continue;
      }

      // Elabora blocco
      for (let i = 0; i < invoicesChunk.length; i++) {
        const invData = invoicesChunk[i];
        const invRowNum = currentRow + i;

        const fornitoreId = String(invData[idxF.FornitoreID] ?? '').trim().replace(/^IT/i, '').replace(/^0+/, '');
        const righeImportateFlag = invData[idxF.RigheImportate];
        const importaSrc = invData[idxF.ImportaRigheSrc];

        // 1. Se la fattura ha già righe importate con stato finale (imported/total_mismatch), non rielaborare
        if (righeImportateFlag === true && finalStates.includes(importaSrc)) {
          continue;
        }

        // 2. Fornitore abilitato/disabilitato
        if (enabledSupplierIds.has(fornitoreId)) {
          // Fornitore ABILITATO.
          // Processa la fattura; la funzione restituisce:
          //  - statusSrc: 'imported','total_mismatch','xml_error','processing_error','no_rows'
          //  - hasImportedRows: TRUE solo se sono state scritte righe in 'Righe'
          const { statusSrc, hasImportedRows } = _processInvoice(
            invData,
            invRowNum,
            idxF,
            productCache,
            rowsBuffer,
            righeHeaders,
            junkKeywordsSet
          );

          _addFlagUpdate(flagUpdates, invRowNum, idxF, {
            RigheImportate: !!hasImportedRows,
            ImportaRigheSrc: statusSrc
          });

          processedInvoices++;
        } else {
          // Fornitore DISABILITATO.
          // Marca come 'skipped' ma lascia RigheImportate = FALSE
          // (TRUE significa sempre "righe esistono in Righe").
          _addFlagUpdate(flagUpdates, invRowNum, idxF, {
            RigheImportate: false,
            ImportaRigheSrc: 'skipped'
          });
          skippedInvoices++;
        }

        // Flush periodico
        if (rowsBuffer.length >= FLUSH_ROWS_EVERY) {
          _flushAll(shR, rowsBuffer, shF, flagUpdates, productCache, headerRowF);
        }
      }

      currentRow += chunkRowCount;
      const progressRow = Math.min(currentRow - 1, lastInvoiceRow);

      // Aggiorna UI
      if (!isSilent) {
        STATE.setJSON(App.config.keys.progress, {
          current: progressRow, total: lastInvoiceRow,
          message: `Importo righe: ${progressRow}/${lastInvoiceRow}...`
        });
        UTIL.showToast(`Elaboro fattura ${progressRow}/${lastInvoiceRow}...`, 'Importazione Righe', 3);
      }
    }

    // Scrittura finale
    _flushAll(shR, rowsBuffer, shF, flagUpdates, productCache, headerRowF);
    STATE.clear(CURSOR_KEY);
    if (!isSilent) STATE.clear(App.config.keys.progress);

    LOG?.info('ROWS', `Importazione righe completata. Processate: ${processedInvoices}, Saltate: ${skippedInvoices}.`);
  }

  /**
   * Processa le righe di una singola fattura.
   * Ritorna:
   *  - statusSrc: stato finale (imported, total_mismatch, xml_error, processing_error, no_rows)
   *  - hasImportedRows: TRUE se sono state scritte righe nel foglio Righe
   */
  function _processInvoice(invData, invRowNum, idxF, productCache, rowsBuffer, righeHeaders, junkKeywordsSet) {
    const fileId = invData[idxF.FileID];
    let statusSrc = 'imported'; // Default a successo

    const famigliaFornitore = invData[idxF.Famiglia];
    const categoriaFornitore = invData[idxF.Categoria];

    let sommaRigheNetto = 0;
    let importedRowsCount = 0;
    const imponibileFattura = UTIL.parseNumSmart(invData[idxF.TotImponibile]);
    const TOLLERANZA_EURO = Number(CONFIG.get('ROWS_TOLLERANZA_EURO', 1.00)) || 1.00;

    try {
      const doc = XMLSAFE.parseDriveXml(fileId);
      if (!doc) {
        statusSrc = 'xml_error';
        throw new Error('Parsing XML fallito.');
      }

      const root = doc.getRootElement();
      const body = UTIL.firstChild(root, 'FatturaElettronicaBody');
      const datiBeniServizi = UTIL.firstChild(body, 'DatiBeniServizi');

      const dettaglioLinee = datiBeniServizi
        ? (datiBeniServizi.getChildren() || []).filter(n => n.getName && n.getName() === 'DettaglioLinee')
        : [];

      if (dettaglioLinee.length === 0) {
        statusSrc = 'no_rows';
        if (Math.abs(imponibileFattura) > TOLLERANZA_EURO) {
          statusSrc = 'total_mismatch';
          LOG?.warn('ROWS_TOTAL_CHECK', `Discrepanza: Imponibile=${imponibileFattura} ma nessuna riga.`, { fileId });
        }
      } else {
        // Converti il Set in Array una sola volta per usare .some()
        const junkKeywordsArray = Array.from(junkKeywordsSet);

        for (const linea of dettaglioLinee) {
          const descrizione = UTIL.firstText(linea, 'Descrizione') || '';
          
          if (!descrizione) {
            continue; // Salta righe senza descrizione
          }
          
          const descLower = descrizione.toLowerCase();
          const isJunk = junkKeywordsArray.some(keyword => descLower.includes(keyword));

          const codiceArticolo = UTIL.firstChild(linea, 'CodiceArticolo');
          const codiceValoreRaw = codiceArticolo ? UTIL.firstText(codiceArticolo, 'CodiceValore') : '';
          const codiceTipo = codiceArticolo ? (UTIL.firstText(codiceArticolo, 'CodiceTipo') || '') : '';

          const um = UTIL.firstText(linea, 'UnitaMisura');
          const codiceValoreForzato = UTIL.forceText(codiceValoreRaw);

          const qta = UTIL.parseNumSmart(UTIL.firstText(linea, 'Quantita'));
          const prezzoUnit = UTIL.parseNumSmart(UTIL.firstText(linea, 'PrezzoUnitario'));
          const prezzoTotaleRiga = UTIL.parseNumSmart(UTIL.firstText(linea, 'PrezzoTotale'));
          const aliquota = UTIL.parseNumSmart(UTIL.firstText(linea, 'AliquotaIVA'));

          sommaRigheNetto += prezzoTotaleRiga;

          // Gestione Prodotti (SOLO se non è spazzatura)
          if (!isJunk) {
            PRODUCTS.ensureProduct(
              invData[idxF.FornitoreID], invData[idxF.DenominazioneFornitore],
              codiceValoreRaw, descrizione, um, productCache
            );
          }

          // Mappa i dati secondo lo schema
          const rowData = {
            'FileID': invData[idxF.FileID],
            'Sede': invData[idxF.Sede],
            'DataDoc': invData[idxF.Data],
            'Anno': invData[idxF.Anno],
            'Mese': invData[idxF.Mese],
            'NumeroDoc': invData[idxF.NumeroDoc],
            'FornitoreID': invData[idxF.FornitoreID],
            'DenominazioneFornitore': invData[idxF.DenominazioneFornitore],
            'Famiglia': famigliaFornitore,
            'Categoria': categoriaFornitore,
            'NumeroLinea': UTIL.firstText(linea, 'NumeroLinea'),
            'Codice Articolo Fornitore': codiceValoreForzato,
            'CodiceTipo': codiceTipo,
            'CodiceValore': codiceValoreForzato,
            'Descrizione': descrizione,
            'Quantita': qta,
            'PrezzoUnitario': prezzoUnit,
            'PrezzoTotale': prezzoTotaleRiga,
            'AliquotaIVA': String(aliquota)
          };

          const row = righeHeaders.map(header => {
             // Pulisce il nome dell'header per farlo corrispondere alle chiavi
             const dataKey = String(header).replace(/ /g, '').replace('ArticoloFornitore', 'ArticoloFornitore');
             return (rowData[header] !== undefined) ? rowData[header] : 
                   (rowData[dataKey] !== undefined ? rowData[dataKey] : '');
          });
          rowsBuffer.push(row);
          importedRowsCount++;
        } // fine loop for

        // Controllo totali
        if (Math.abs(sommaRigheNetto - imponibileFattura) > TOLLERANZA_EURO) {
          statusSrc = 'total_mismatch';
          LOG?.warn(
            'ROWS_TOTAL_CHECK',
            `Mismatch > ${TOLLERANZA_EURO}€. Somma righe=${sommaRigheNetto}, Imponibile fattura=${imponibileFattura}`,
            { fileId }
          );
        }
      }
    } catch (e) {
      statusSrc = 'processing_error';
      LOG?.error('ROWS', `Errore processamento righe per file ${fileId}`, { error: e.message, stack: e.stack });
    } finally {
      // Ignora mismatch per Parcelle e Note di Credito
      if (statusSrc === 'total_mismatch') {
        const docType = String(invData[idxF.TipoDoc] ?? '').toLowerCase();
        if (docType.includes('parcella') || docType.includes('nota di credito')) {
          statusSrc = 'imported'; // Consideralo importato con successo
          LOG?.info('ROWS_TOTAL_CHECK_IGNORE', `Discrepanza totali ignorata per ${docType}.`, { fileId });
        }
      }
    }

    const hasImportedRows = importedRowsCount > 0;
    return { statusSrc, hasImportedRows };
  }

  // Scrive buffer righe + aggiorna flag + flush prodotti
  function _flushAll(shR, rowsBuffer, shF, flagUpdates, productCache, headerRowF) {
    if (rowsBuffer.length > 0) {
      try {
        const headerRowR = SHEETS._findHeaderRow(shR, SHEETS.SHEET_NAMES.Righe);
        const startRow = Math.max(shR.getLastRow() + 1, headerRowR + 1);
        UTIL.writeBatched(shR, startRow, rowsBuffer);
        LOG?.info('ROWS_FLUSH', `Scritte ${rowsBuffer.length} nuove righe prodotto.`);
      } catch (e) {
        LOG?.error('ROWS_FLUSH', 'Errore scrittura batch righe prodotto.', { error: e.message });
      } finally {
        rowsBuffer.length = 0;
      }
    }

    const updatedFlags = UTIL.updateSheetInPlace(shF, flagUpdates, headerRowF);
    if (updatedFlags > 0) {
      LOG?.info('ROWS_FLUSH', `Aggiornati flag di stato per ${Object.keys(flagUpdates).length} fatture.`);
    }
    for (const key in flagUpdates) delete flagUpdates[key];

    PRODUCTS.flushNewRows(productCache);
  }

  // Funzione _addFlagUpdate
  function _addFlagUpdate(flagUpdates, rowNum, idx, updates) {
    if (!flagUpdates[rowNum]) flagUpdates[rowNum] = {};
    for (const key in updates) {
      const safeKey = key.replace(/ /g, '_');
      if (idx[safeKey] !== undefined) {
        flagUpdates[rowNum][idx[safeKey]] = updates[key];
      } else {
        LOG?.warn('ROWS_FLAG_UPDATE', `Indice non trovato per aggiornare flag: ${key}`, { rowNum });
      }
    }
  }

  // Carica dati fornitori
  function _getSuppliersData() {
    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Fornitori);
    const suppliers = new Map();
    if (!sh) return suppliers;

    const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Fornitori);
    if (sh.getLastRow() < headerRow + 1) return suppliers;

    try {
      const idxForn = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fornitori);
      const data = sh.getRange(headerRow + 1, 1, sh.getLastRow() - headerRow, sh.getLastColumn()).getValues();

      data.forEach(row => {
        const rawId = row[idxForn.FornitoreID];
        if (!rawId && rawId !== 0) return;

        const normalizedId = String(rawId).trim().replace(/^IT/i, '').replace(/^0+/, '');
        const rawImportFlag = row[idxForn.ImportaRighe];

        const importaRighe =
          (rawImportFlag === true) ||
          (String(rawImportFlag).trim().toLowerCase() === 'true') ||
          (String(rawImportFlag).trim().toLowerCase() === 'vero') ||
          (String(rawImportFlag).trim() === '1');

        suppliers.set(normalizedId, {
          nome: row[idxForn.Denominazione] || '',
          famiglia: row[idxForn.Famiglia] || '',
          categoria: row[idxForn.Categoria] || '',
          importaRighe
        });
      });
    } catch (e) {
      LOG?.error('ROWS_GET_SUPPLIERS', 'Errore lettura dati Fornitori.', { error: e.message });
    }
    return suppliers;
  }

  return { run };
})();

// Registra IMPORT_ROWS nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('IMPORT_ROWS', ['SHEETS', 'LOG', 'UTIL', 'PRODUCTS', 'STATE', 'CONFIG']);
}

// Registra IMPORT_ROWS nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('IMPORT_ROWS', IMPORT_ROWS);
}