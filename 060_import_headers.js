// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 60_import_headers.js
// VERSIONE: 25.0 (Header Import)
// DESCRIZIONE: Motore di importazione testate OTTIMIZZATO (CacheService)
//               • GoldenTotal calcolato SEMPRE (anche su file già importati)
//               • Salvataggio/ripresa GoldenTotal durante SCAN_EXTRACT
//               • Logica Percorso Cartella con rootFolderId e fallback sicuri
//               • Aggiornamento barra di avanzamento (STATE.progress)
// =============================================================

const IMPORT_HEADERS = (function () {
  const TIPO_DOC_MAP = {
    'TD01': 'Fattura', 'TD04': 'Nota di Credito', 'TD05': 'Nota di Debito',
    'TD06': 'Parcella', 'TD24': 'Fattura Differita', 'TD25': 'Fattura Differita',
    'TD27': 'Fattura per Autoconsumo'
  };

  // --- CHIAVI DI STATO ---
  const IMPORT_PHASE_KEY          = 'HEADERS_IMPORT_PHASE_V23';
  const ALL_FILES_TO_PROCESS_KEY  = 'HEADERS_ALL_FILES_V23';
  const ALL_FILES_IDS_KEY         = 'HEADERS_ALL_FILES_IDS_V23';
  const EXTRACTED_DATA_KEY        = 'HEADERS_EXTRACTED_DATA_V23';
  const EXTRACTED_DATA_CHUNKS_KEY = 'HEADERS_EXTRACTED_CHUNKS_V23';
  const PARTIAL_COUNTS_KEY        = 'HEADERS_PARTIAL_COUNTS_V23'; // { month: {}, folder: {}, goldenTotal: 0 }

  const PHASES = { DISCOVERY: 'DISCOVERY', SCAN_EXTRACT: 'SCAN_EXTRACT' };
  const SAVE_EVERY_N = 100;
  const UI_TICK_N    = 20;
  let ROOT_FOLDER_NAME_CACHE = null; // Cache per il nome della cartella radice

  function run(isSilent = false) {
    _clearAllStates(true); // Pulisce conteggi finali E goldenTotal
    _mainLoop(isSilent);
  }
  function runContinue(isSilent = false) {
    _mainLoop(isSilent); // Non pulisce conteggi finali / goldenTotal
  }

  function _clearAllStates(clearFinalCounts = false) {
    try {
      const numChunks = STATE.getJSON(EXTRACTED_DATA_CHUNKS_KEY, 0);
      if (numChunks > 0) STATE.cache.clearLargeJSON(EXTRACTED_DATA_KEY, numChunks);
    } catch (e) { LOG?.warn('HEADERS_CLEAR', 'Errore pulizia cache estratti.', { error: e.message }); }

    try {
      STATE.clear(App.config.keys.cursors.headers);
      STATE.clear(IMPORT_PHASE_KEY);
      STATE.clear(ALL_FILES_TO_PROCESS_KEY);
      STATE.clear(ALL_FILES_IDS_KEY);
      STATE.clear(EXTRACTED_DATA_CHUNKS_KEY);
      STATE.clear(PARTIAL_COUNTS_KEY);
      ROOT_FOLDER_NAME_CACHE = null; // Pulisce cache nome cartella

      if (clearFinalCounts) {
        STATE.clear(App.config.keys.auditCountsMonth);
        STATE.clear(App.config.keys.auditCountsFolder);
        STATE.clear(App.config.keys.auditTotalCount);
        STATE.clear(App.config.keys.goldenTotal);
        LOG.info('HEADERS_CLEAR', 'Puliti anche i conteggi audit finali e Golden Total.');
      }
    } catch (e) { LOG?.warn('HEADERS_CLEAR', 'Errore pulizia Properties.', { error: e.message }); }
  }

  function _mainLoop(isSilent) {
    const startTime = new Date();
    const maxSec = CONFIG.get('MAX_RUNTIME_SEC', 240);
    let currentPhase = STATE.get(IMPORT_PHASE_KEY) || PHASES.DISCOVERY;

    try {
      if (currentPhase === PHASES.DISCOVERY) {
        if (!isSilent) STATE.setJSON(App.config.keys.progress, { phase: 'DISCOVERY', message: 'Fase 1: Ricerca file...' });
        LOG.info('HEADERS', 'Fase 1 (Discovery): Avvio ricerca file.');
        _runDiscoveryPhase();
        currentPhase = PHASES.SCAN_EXTRACT;
        LOG.info('HEADERS', 'Fase 1 completata. Passaggio a Fase 2: Scansione, Estrazione e Conteggio.');
      }

      if (currentPhase === PHASES.SCAN_EXTRACT) {
        const isDone = _runScanAndExtractPhase(startTime, maxSec, isSilent);
        if (!isDone) return; // Pausa per timeout

        _runSortAndWritePhase(isSilent);
        LOG.info('HEADERS', 'Importazione e conteggio completati.');
        if (!isSilent) STATE.clear(App.config.keys.progress);
        _clearAllStates(false);
      }
    } catch (e) {
      LOG.error('HEADERS_MAIN_LOOP', `Errore durante la fase ${currentPhase}`, { error: e.message, stack: e.stack });
      if (!isSilent) STATE.clear(App.config.keys.progress);
      _clearAllStates(false);
      throw e;
    }
  }

  // ----------------------------- FASI -----------------------------

  function _runDiscoveryPhase() {
    const folderId = CONFIG.get('CARTELLA_INPUT_ID');
    if (!folderId) throw new Error("CARTELLA_INPUT_ID non impostata in Config.");
    let rootFolder;
    try {
      rootFolder = DriveApp.getFolderById(folderId);
      ROOT_FOLDER_NAME_CACHE = rootFolder.getName(); // Salva il nome della radice
    } catch (e) { throw new Error(`Impossibile accedere a CARTELLA_INPUT_ID: ${folderId}.`); }

    const processedSheetIds = SHEETS.getProcessedFileIds();
    const allDriveFiles = UTIL.getAllFilesRecursive(rootFolder)
      .filter(file => _isXmlFile(file));

    const allFileIds = allDriveFiles.map(f => f.getId());
    const filesToProcessIds = allFileIds.filter(id => !processedSheetIds.has(id));

    try {
      STATE.setJSON(ALL_FILES_IDS_KEY, allFileIds);
    } catch (e) {
      LOG.error('HEADERS_DISCOVERY', 'Errore salvataggio lista TUTTI File ID.', { error: e.message });
      STATE.clear(ALL_FILES_IDS_KEY);
    }
    STATE.setJSON(ALL_FILES_TO_PROCESS_KEY, filesToProcessIds);

    STATE.setJSON(EXTRACTED_DATA_CHUNKS_KEY, 0);
    STATE.clear(App.config.keys.cursors.headers);
    STATE.clear(PARTIAL_COUNTS_KEY);
    STATE.set(IMPORT_PHASE_KEY, PHASES.SCAN_EXTRACT);

    LOG.info('HEADERS_DISCOVERY', `Trovati ${allFileIds.length} file XML totali in Drive. Nuovi da processare: ${filesToProcessIds.length}.`);
  }

  function _runScanAndExtractPhase(startTime, maxSec, isSilent) {
    const allFileIdsForCount = STATE.getJSON(ALL_FILES_IDS_KEY);
    if (!allFileIdsForCount || !Array.isArray(allFileIdsForCount)) {
      throw new Error('Lista ID file totali non trovata per il conteggio. Rieseguire la fase 1.');
    }
    const totalToScan = allFileIdsForCount.length;
    if (totalToScan === 0) return true;

    const filesToProcessSet = new Set(STATE.getJSON(ALL_FILES_TO_PROCESS_KEY, []));
    const CURSOR_KEY = App.config.keys.cursors.headers;
    const cursor = STATE.getJSON(CURSOR_KEY, { nextIndex: 0 });
    let startIndex = cursor.nextIndex;

    const numChunks = STATE.getJSON(EXTRACTED_DATA_CHUNKS_KEY, 0);
    let extractedData = STATE.cache.getLargeJSONArray(EXTRACTED_DATA_KEY, numChunks) || [];

    // --- Carica conteggi parziali, INCLUSO goldenTotal ---
    let partialCounts = STATE.getJSON(PARTIAL_COUNTS_KEY, { month: {}, folder: {}, goldenTotal: 0 });
    let countsByMonth = partialCounts.month || {};
    let countsByFolder = partialCounts.folder || {};
    let goldenTotal = partialCounts.goldenTotal || 0; // Riprende da 0 o dal valore salvato

    // --- Nome cartella radice da cache o da config ---
    if (!ROOT_FOLDER_NAME_CACHE) {
      try {
        const rootFolderId = CONFIG.get('CARTELLA_INPUT_ID');
        if (rootFolderId) ROOT_FOLDER_NAME_CACHE = DriveApp.getFolderById(rootFolderId).getName();
        else ROOT_FOLDER_NAME_CACHE = "[ERRORE: ID Radice Mancante]";
      } catch (e) {
        LOG.warn('HEADERS_SCAN', `Impossibile leggere nome cartella radice, ID: ${CONFIG.get('CARTELLA_INPUT_ID')}`);
        ROOT_FOLDER_NAME_CACHE = `[ID:${CONFIG.get('CARTELLA_INPUT_ID')}]`;
      }
    }
    const inputFolderName = ROOT_FOLDER_NAME_CACHE;

    if (!isSilent) {
      STATE.setJSON(App.config.keys.progress, {
        phase: 'SCAN', done: startIndex, total: totalToScan,
        message: `Fase 2: Scansione file (${startIndex}/${totalToScan})...`
      });
    }

    const companyMap = SHEETS.getCompanyMap();

    const saveState = (currentIndex) => {
      STATE.setJSON(CURSOR_KEY, { nextIndex: currentIndex });
      const newNumChunks = STATE.cache.setLargeJSONArray(EXTRACTED_DATA_KEY, extractedData);
      STATE.setJSON(EXTRACTED_DATA_CHUNKS_KEY, newNumChunks);
      // Salva anche goldenTotal parziale
      STATE.setJSON(PARTIAL_COUNTS_KEY, { month: countsByMonth, folder: countsByFolder, goldenTotal: goldenTotal });
    };

    for (let i = startIndex; i < totalToScan; i++) {
      const elapsed = (new Date() - startTime) / 1000;
      if (elapsed > maxSec) {
        saveState(i);
        LOG.warn('HEADERS_SCAN', `Timeout durante scansione/conteggio. Ripresa salvata dal file index=${i}.`);
        if (!isSilent) {
          STATE.setJSON(App.config.keys.progress, {
            phase: 'SCAN', done: i, total: totalToScan,
            message: `Pausa per timeout. Riprenderò da ${i}/${totalToScan}.`
          });
        }
        return false; // pausa
      }

      const fileId = allFileIdsForCount[i];
      let file;
      try {
        file = DriveApp.getFileById(fileId);
      } catch (e) {
        LOG.error('HEADERS_SCAN', `Impossibile accedere a file ID: ${fileId}. File saltato (anche per conteggio).`, { error: e.message });
        continue;
      }

      let yearMonth = null;
      let folderPath = null;
      let docInfo = null;
      let fornitoreInfo = null;
      let clienteInfo = null;
      let sede = 'Non Assegnata';
      let isNewFile = filesToProcessSet.has(fileId);

      try {
        // Percorso relativo rispetto alla radice configurata
        folderPath = _getRelativeFolderPath(file, CONFIG.get('CARTELLA_INPUT_ID'), inputFolderName);

        const doc = XMLSAFE.parseDriveXml(fileId);

        if (!doc) {
          LOG.warn('HEADERS_SCAN_COUNT', `Impossibile parsare XML: ${file.getName()}. Uso data modifica per conteggio mese.`, { fileId });
          yearMonth = Utilities.formatDate(file.getLastUpdated(), Session.getScriptTimeZone(), 'yyyy-MM');
        } else {
          const rootElement = doc.getRootElement();
          const dataStr = _extractInvoiceDate(doc);

          // Estrai info doc SEMPRE (serve a GoldenTotal)
          docInfo = _extractDocumentoInfo(rootElement, dataStr);

          if (dataStr && /^\d{4}-\d{2}-\d{2}$/.test(dataStr)) {
            yearMonth = dataStr.substring(0, 7);
          } else {
            LOG.warn('HEADERS_SCAN_COUNT', `Data non trovata/valida in ${file.getName()}. Uso data modifica per conteggio mese.`, { fileId, dataStr });
            yearMonth = Utilities.formatDate(file.getLastUpdated(), Session.getScriptTimeZone(), 'yyyy-MM');
          }

          // Calcola GoldenTotal SEMPRE
          const isCreditNote = (docInfo.tipo || '').toLowerCase().includes('nota di credito');
          const totalValue = docInfo.totale || 0;
          goldenTotal += isCreditNote ? -Math.abs(totalValue) : totalValue;

          if (isNewFile) {
            fornitoreInfo = _extractFornitoreInfo(rootElement);
            clienteInfo   = _extractClienteInfo(rootElement);
            const clienteIdNorm = String(clienteInfo.pIva ?? '').trim().replace(/^IT/i, '').replace(/^0+/, '');
            sede = companyMap.get(clienteIdNorm) || 'Non Assegnata';
          }
        }
      } catch (e) {
        // Continua comunque (conteggi e percorso)
        LOG.error('HEADERS_SCAN', `Errore estrazione dati/conteggio da file ${file?.getName?.()}`, { fileId, error: e.message });
        if (!yearMonth) try { yearMonth = Utilities.formatDate(file.getLastUpdated(), Session.getScriptTimeZone(), 'yyyy-MM'); } catch (_) {}
        if (!folderPath) try { folderPath = _getRelativeFolderPath(file, CONFIG.get('CARTELLA_INPUT_ID'), inputFolderName); } catch (_) {}
      }

      if (yearMonth) countsByMonth[yearMonth] = (countsByMonth[yearMonth] || 0) + 1;
      if (folderPath) countsByFolder[folderPath] = (countsByFolder[folderPath] || 0) + 1;

      if (isNewFile && fornitoreInfo && clienteInfo && docInfo) {
        extractedData.push({
          fileId: fileId, fileName: file.getName(), fileUrl: file.getUrl(),
          fornitore: fornitoreInfo, cliente: clienteInfo, doc: docInfo, sede: sede
        });
      }

      const nextIndex = i + 1;
      const isSaveTick = (nextIndex % SAVE_EVERY_N === 0) || (nextIndex === totalToScan);
      if (isSaveTick) saveState(nextIndex);

      if (!isSilent && (nextIndex % UI_TICK_N === 0 || nextIndex === totalToScan)) {
        STATE.setJSON(App.config.keys.progress, {
          phase: 'SCAN', done: nextIndex, total: totalToScan,
          message: `Scansione ${nextIndex}/${totalToScan} — GoldenTotal provvisorio: ${goldenTotal.toFixed(2)}`
        });
      }
    } // Fine ciclo for

    saveState(totalToScan);
    LOG.info('HEADERS_SCAN', `Fase 2 (Scansione/Conteggio) completata per ${totalToScan} file.`);
    return true;
  }

  function _runSortAndWritePhase(isSilent) {
    if (!isSilent) STATE.setJSON(App.config.keys.progress, { phase: 'WRITE', message: 'Fase Finale: Ordino, scrivo e salvo conteggi...' });

    const numChunks = STATE.getJSON(EXTRACTED_DATA_CHUNKS_KEY, 0);
    let extractedData = STATE.cache.getLargeJSONArray(EXTRACTED_DATA_KEY, numChunks) || [];

    const finalCountsState = STATE.getJSON(PARTIAL_COUNTS_KEY, { month: {}, folder: {}, goldenTotal: 0 });
    const finalCountsByMonth = finalCountsState.month || {};
    const finalCountsByFolder = finalCountsState.folder || {};
    const finalTotalCount = Object.values(finalCountsByMonth).reduce((sum, count) => sum + count, 0);
    const finalGoldenTotal = finalCountsState.goldenTotal || 0;

    const shFornitori  = SHEETS.get(SHEETS.SHEET_NAMES.Fornitori);
    const headerRowFor = SHEETS._findHeaderRow(shFornitori, SHEETS.SHEET_NAMES.Fornitori);
    const supplierDataMap = _getSupplierDataMap(shFornitori, headerRowFor);

    if (extractedData.length > 0) {
      extractedData = extractedData.map(d => { try { if (d?.doc && typeof d.doc.data === 'string') d.doc.data = new Date(d.doc.data); } catch (_) {} return d; });
      extractedData.sort((a, b) => {
        const ta = (a?.doc?.data instanceof Date && !isNaN(a.doc.data)) ? a.doc.data.getTime() : 0;
        const tb = (b?.doc?.data instanceof Date && !isNaN(b.doc.data)) ? b.doc.data.getTime() : 0;
        return ta - tb; // cronologico crescente
      });

      const shFatture     = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
      const headerRowFat = SHEETS._findHeaderRow(shFatture, SHEETS.SHEET_NAMES.Fatture);
      const fattureHeaders = SHEETS.SCHEMAS[SHEETS.SHEET_NAMES.Fatture];
      if (!fattureHeaders || fattureHeaders.length === 0) {
        LOG.error('HEADERS_WRITE', 'Schema Fatture non trovato. Impossibile scrivere.');
        return;
      }

      const defaultImportRows = CONFIG.get('IMPORT_RIGHE_DEFAULT', false);
      const fornitoriBatch = [];
      const fattureBatch   = [];

      extractedData.forEach(data => {
        const supplierIdNorm = UTIL.normKey(data.fornitore.pIva).replace(/^0+/, '');
        let supplierInfo = supplierDataMap.get(supplierIdNorm);

        if (supplierIdNorm && !supplierInfo) {
          fornitoriBatch.push([supplierIdNorm, data.fornitore.denom, '', '', defaultImportRows]);
          supplierInfo = { famiglia: '', categoria: '' };
          supplierDataMap.set(supplierIdNorm, supplierInfo);
        } else if (!supplierInfo) {
          supplierInfo = { famiglia: '', categoria: '' };
        }

        const isCreditNote = (data.doc.tipo || '').toLowerCase().includes('nota di credito');
        const sede = data.sede || 'Non Assegnata';
        const numeroDocFormatted = UTIL.forceText(data.doc.numero);
        const finalImponibile = isCreditNote ? -Math.abs(data.doc.imponibile || 0) : (data.doc.imponibile || 0);
        const finalImposta    = isCreditNote ? -Math.abs(data.doc.imposta    || 0) : (data.doc.imposta    || 0);
        const finalTotale     = isCreditNote ? -Math.abs(data.doc.totale      || 0) : (data.doc.totale      || 0);

        const rowData = {
          'FileID': data.fileId, 'Sede': sede, 'FileName': data.fileName, 'LinkXML': data.fileUrl, 'LinkPDF': '',
          'FornitoreID': supplierIdNorm, 'DenominazioneFornitore': data.fornitore.denom,
          'Famiglia': supplierInfo.famiglia, 'Categoria': supplierInfo.categoria,
          'RegimeFiscale': data.fornitore.regime, 'Data': data.doc.data, 'Anno': data.doc.anno, 'Mese': data.doc.mese,
          'NumeroDoc': numeroDocFormatted, 'TipoDoc': data.doc.tipo, 'TotImponibile': finalImponibile,
          'TotImposta': finalImposta, 'Valuta': data.doc.valuta, 'TotDocumento': finalTotale,
          'RigheImportate': false, 'ImportaRigheSrc': '', 'ImportedAt': new Date()
        };
        const row = fattureHeaders.map(header => (rowData[header] !== undefined ? rowData[header] : ''));
        fattureBatch.push(row);
      });

      _flushBatch(shFornitori, fornitoriBatch, 'Fornitori', headerRowFor);
      _flushBatch(shFatture,   fattureBatch,   'Fatture',   headerRowFat);
      try { SpreadsheetApp.flush(); LOG.debug('HEADERS_WRITE', 'SpreadsheetApp.flush() eseguito.'); }
      catch (eFlush) { LOG.error('HEADERS_WRITE', 'Errore SpreadsheetApp.flush()', { error: eFlush.message }); }

      LOG.info('HEADERS_WRITE', `Scrittura completata. Fatture: ${fattureBatch.length}, nuovi fornitori: ${fornitoriBatch.length}.`);
    } else {
      LOG.info('HEADERS_WRITE', 'Nessuna nuova fattura da scrivere (ma i conteggi sono stati aggiornati).');
    }

    try {
      STATE.set(App.config.keys.goldenTotal, Number.isFinite(finalGoldenTotal) ? finalGoldenTotal.toFixed(2) : '0.00');
      STATE.setJSON(App.config.keys.auditCountsMonth, finalCountsByMonth);
      STATE.setJSON(App.config.keys.auditCountsFolder, finalCountsByFolder);
      STATE.set(App.config.keys.auditTotalCount, finalTotalCount);
      LOG.info('HEADERS_WRITE', `Conteggi audit finali e GoldenTotal (${finalGoldenTotal.toFixed(2)}) salvati.`);
    } catch (eSaveCounts) {
      LOG.error('HEADERS_WRITE', 'Errore salvataggio conteggi/totali finali.', { error: eSaveCounts.message });
    }

    STATE.cache.clearLargeJSON(EXTRACTED_DATA_KEY, numChunks);
    STATE.clear(EXTRACTED_DATA_CHUNKS_KEY);
    STATE.clear(PARTIAL_COUNTS_KEY);
  }

  // ---------------------- Helper I/O ----------------------

  function _flushBatch(sheet, batch, entityName, headerRow) {
    if (batch.length === 0) return;
    try {
      const startRow = Math.max(sheet.getLastRow() + 1, headerRow + 1);
      UTIL.writeBatched(sheet, startRow, batch);
    } catch (e) {
      LOG.error('FLUSH', `Scrittura batch fallita per ${entityName}.`, { error: e.message });
    } finally {
      batch.length = 0;
    }
  }

  const _isXmlFile = (file) => {
    try {
      const name = file?.getName() || '';
      const mime = file?.getMimeType() || '';
      return (/\.xml(\.p7m)?$/i).test(name) || mime.toLowerCase().includes('xml');
    } catch (_) { return false; }
  };

  function _getSupplierDataMap(sheet, headerRow) {
    const map = new Map();
    if (!sheet || sheet.getLastRow() < headerRow + 1) return map;
    try {
      const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fornitori);
      if (idx.FornitoreID === undefined || idx.Famiglia === undefined || idx.Categoria === undefined) {
        LOG.error('HEADERS_SUPPLIER_MAP', 'Colonne FornitoreID, Famiglia, o Categoria mancanti in Fornitori.');
        return map;
      }
      const lastCol = Math.max(idx.FornitoreID, idx.Famiglia, idx.Categoria) + 1;
      const data = sheet.getRange(headerRow + 1, 1, sheet.getLastRow() - headerRow, lastCol).getValues();
      data.forEach(row => {
        const rawId = row[idx.FornitoreID];
        if (rawId === null || rawId === undefined || String(rawId).trim() === '') return;
        const normalizedId = String(rawId).trim().replace(/^IT/i, '').replace(/^0+/, '');
        if (normalizedId) {
          map.set(normalizedId, {
            famiglia: String(row[idx.Famiglia] ?? '').trim(),
            categoria: String(row[idx.Categoria] ?? '').trim()
          });
        }
      });
    } catch (e) {
      LOG.error('HEADERS_GET_SUPPLIER_MAP', 'Errore lettura mappa Fornitori.', { error: e.message });
    }
    return map;
  }

  // ---------------------- Estrazione XML ----------------------

  function _extractFornitoreInfo(root) {
    const header = UTIL.firstChild(root, 'FatturaElettronicaHeader');
    const cedente = UTIL.firstChild(header, 'CedentePrestatore');
    if (!cedente) throw new Error('CedentePrestatore non trovato.');
    const datiAnagrafici = UTIL.firstChild(cedente, 'DatiAnagrafici');
    const idFiscale = UTIL.firstChild(datiAnagrafici, 'IdFiscaleIVA');
    const anagrafica = UTIL.firstChild(datiAnagrafici, 'Anagrafica');
    const pIva = idFiscale ? (UTIL.firstText(idFiscale, 'IdCodice') || '') : '';
    const denom = anagrafica ? (UTIL.firstText(anagrafica, 'Denominazione') || [UTIL.firstText(anagrafica, 'Cognome'), UTIL.firstText(anagrafica, 'Nome')].filter(Boolean).join(' ')) : '';
    const regime = UTIL.firstText(datiAnagrafici, 'RegimeFiscale') || '';
    return { pIva, denom, regime };
  }

  function _extractClienteInfo(root) {
    const header = UTIL.firstChild(root, 'FatturaElettronicaHeader');
    const cessionario = UTIL.firstChild(header, 'CessionarioCommittente');
    if (!cessionario) throw new Error('CessionarioCommittente non trovato.');
    const datiAnagrafici = UTIL.firstChild(cessionario, 'DatiAnagrafici');
    const idFiscale = UTIL.firstChild(datiAnagrafici, 'IdFiscaleIVA');
    const anagrafica = UTIL.firstChild(datiAnagrafici, 'Anagrafica');
    let pIva = idFiscale ? (UTIL.firstText(idFiscale, 'IdCodice') || '') : '';
    if (!pIva) pIva = UTIL.firstText(datiAnagrafici, 'CodiceFiscale') || '';
    const denom = anagrafica ? (UTIL.firstText(anagrafica, 'Denominazione') || [UTIL.firstText(anagrafica, 'Cognome'), UTIL.firstText(anagrafrica, 'Nome')].filter(Boolean).join(' ')) : '';
    return { pIva, denom };
  }

  function _extractInvoiceDate(doc) {
    try {
      const root = doc.getRootElement();
      const body = UTIL.firstChild(root, 'FatturaElettronicaBody');
      const datiGenerali = UTIL.firstChild(body, 'DatiGenerali');
      const datiGeneraliDoc = UTIL.firstChild(datiGenerali, 'DatiGeneraliDocumento');
      return UTIL.firstText(datiGeneraliDoc, 'Data');
    } catch (e) { return null; }
  }

  function _extractDocumentoInfo(root, dataStr = null) {
    const body = UTIL.firstChild(root, 'FatturaElettronicaBody');
    if (!body) throw new Error('FatturaElettronicaBody non trovato.');
    const datiGenerali = UTIL.firstChild(body, 'DatiGenerali');
    if (!datiGenerali) throw new Error('DatiGenerali non trovato.');
    const datiGeneraliDoc = UTIL.firstChild(datiGenerali, 'DatiGeneraliDocumento');
    if (!datiGeneraliDoc) throw new Error('DatiGeneraliDocumento non trovato.');

    if (dataStr === null) dataStr = UTIL.firstText(datiGeneraliDoc, 'Data');
    const dataDoc = dataStr ? new Date(dataStr) : new Date(0);

    const datiBeniServizi = UTIL.firstChild(body, 'DatiBeniServizi');
    const tipoDocCodice       = UTIL.firstText(datiGeneraliDoc, 'TipoDocumento') || '';
    let   tipoDocDescrizione = TIPO_DOC_MAP[tipoDocCodice] || tipoDocCodice;
    let totaleImponibile = 0, totaleImposta = 0;
    const riepiloghi = (datiBeniServizi?.getChildren('DatiRiepilogo') || []);
    riepiloghi.forEach(node => {
      totaleImponibile += UTIL.parseNumSmart(UTIL.firstText(node, 'ImponibileImporto'));
      totaleImposta    += UTIL.parseNumSmart(UTIL.firstText(node, 'Imposta'));
    });
    let totaleDocumento = UTIL.parseNumSmart(UTIL.firstText(datiGeneraliDoc, 'ImportoTotaleDocumento'));
    if (totaleDocumento === 0 && (totaleImponibile !== 0 || totaleImposta !== 0)) {
      const bollo = UTIL.parseNumSmart(UTIL.firstText(UTIL.firstChild(datiGeneraliDoc, 'DatiBollo'), 'ImportoBollo'));
      totaleDocumento = totaleImponibile + totaleImposta + bollo;
    }
    if (tipoDocCodice === 'TD01' && totaleDocumento < 0) {
      tipoDocDescrizione = 'Nota di Credito (da TD01)';
    }
    const numeroRaw = UTIL.firstText(datiGeneraliDoc, 'Numero') || '';

    return {
      data: dataDoc,
      anno: dataDoc instanceof Date && !isNaN(dataDoc) ? dataDoc.getFullYear() : 0,
      mese: dataDoc instanceof Date && !isNaN(dataDoc) ? dataDoc.getMonth() + 1 : 0,
      numero: numeroRaw, tipo: tipoDocDescrizione, imponibile: totaleImponibile,
      imposta: totaleImposta, totale: totaleDocumento,
      valuta: UTIL.firstText(datiGeneraliDoc, 'Divisa') || 'EUR'
    };
  }

  /** Determina percorso relativo cartella.
   * Usa rootFolderId e risale la gerarchia in modo sicuro.
   */
  function _getRelativeFolderPath(file, rootFolderId, rootFolderName) {
    try {
      if (!rootFolderId) return "[ID Radice Mancante]";
      if (!rootFolderName) rootFolderName = DriveApp.getFolderById(rootFolderId).getName();

      const parents = file.getParents();
      if (!parents.hasNext()) return rootFolderName + " (Radice - No Parent)";
      const parentFolder = parents.next();

      if (parentFolder.getId() === rootFolderId) {
        return rootFolderName + " (Radice)";
      } else {
        let currentFolder = parentFolder;
        let pathParts = [];
        let loopGuard = 0; // Prevenzione cicli infiniti

        while (currentFolder && currentFolder.getId() !== rootFolderId && loopGuard < 10) {
          pathParts.unshift(currentFolder.getName());
          const grandParents = currentFolder.getParents();
          if (!grandParents.hasNext()) {
            LOG.debug('HEADERS_SCAN_COUNT', `Interruzione risalita percorso (no parent) per ${file.getName()}`);
            break;
          }
          currentFolder = grandParents.next();
          loopGuard++;
        }

        const isPartialPath = (currentFolder && currentFolder.getId() !== rootFolderId);

        if (pathParts.length > 0) {
          const prefix = isPartialPath ? '/.../' : '/'; // Indica se il percorso è completo
          return `${rootFolderName}${prefix}${pathParts.join('/')}`;
        } else if (currentFolder && currentFolder.getId() === rootFolderId) {
          return rootFolderName + " (Radice)"; // File in una cartella che è la radice
        } else {
          LOG.warn('HEADERS_SCAN_COUNT', `Impossibile determinare percorso per ${file.getName()}. Assegnato a radice.`, { fileId: file.getId() });
          return rootFolderName + " (Radice - Errore Percorso)";
        }
      }
    } catch (e) {
      LOG.warn('HEADERS_SCAN_COUNT', `Errore nel determinare percorso cartella per ${file?.getName()}`, { error: e.message });
      return rootFolderName + " (Radice - Errore)";
    }
  }

  // ---------------------- Exports ----------------------
  return { run, runContinue };
})();

// Registra IMPORT_HEADERS nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('IMPORT_HEADERS', ['SHEETS', 'LOG', 'UTIL', 'XMLSAFE', 'STATE', 'CONFIG']);
}

// Registra IMPORT_HEADERS nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('IMPORT_HEADERS', IMPORT_HEADERS);
}