// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 080_pdf_export.js
// RUOLO: Generazione PDF fatture con naming DenominazioneFornitore - NumeroDoc.pdf.
// NOTE: Usa SHEET_ITERATOR, PdfTemplate.html, sanificazione nomi, PDFStato opzionale.
// =============================================================

const PDF = (function () {

  const CURSOR_KEY = App.config.keys.cursors.pdf;

  /**
   * Genera file PDF da file XML fatture e salva in cartella output.
   * 
   * Workflow:
   * 1. Verifica PDF_ENABLED: se FALSE, salta creazione e imposta StatoPDF=SKIPPED
   * 2. Legge foglio Fatture, filtra righe con Link PDF vuoto o StatoPDF=TODO/SKIPPED
   * 3. Per ogni fattura:
   *    a. Verifica se PDF già esistente in cartella output (nome match)
   *    b. Se esistente: aggiorna LinkPDF con URL esistente, StatoPDF=DONE
   *    c. Se non esistente:
   *       - Genera PDF da XML con HtmlService (template PdfTemplate.html)
   *       - Naming: "DenominazioneFornitore - NumeroDoc.pdf" (sanificato)
   *       - Salva in CARTELLA_OUTPUT_ID configurata
   *       - Aggiorna LinkPDF con URL nuovo file, StatoPDF=DONE
   * 4. Scrittura batch: flush aggiornamenti ogni PDF_FLUSH_EVERY righe
   * 5. Gestione errori:
   *    - Quota giornaliera raggiunta: disabilita PDF_ENABLED, imposta StatoPDF=ERROR
   *    - Altri errori: imposta StatoPDF=ERROR, continua
   * 6. Gestione timeout: salva stato, riprendibile
   * 
   * @param {boolean} [isSilent=false] - Se true, disabilita aggiornamenti UI progress
   * @param {boolean} [forceProcessAll=false] - Se true, processa tutte le fatture (ignora PDF_ENABLED)
   * @returns {void}
   * @throws {Error} Se CARTELLA_OUTPUT_ID non configurata o inaccessibile
   * 
   * @example
   * PDF.run(); // Rispetta PDF_ENABLED
   * PDF.run(false, true); // Forza creazione PDF (ignora PDF_ENABLED)
   */
  function run(isSilent = false, forceProcessAll = false) {
    const outputFolderId = CONFIG.get('CARTELLA_OUTPUT_ID');
    if (!outputFolderId) {
      LOG?.error('PDF_RUN', 'CARTELLA_OUTPUT_ID non definita.');
      throw new Error("CARTELLA_OUTPUT_ID non definita in 'Config'.");
    }

    let outputFolder;
    try {
      outputFolder = DriveApp.getFolderById(outputFolderId);
    } catch (e) {
      LOG?.error('PDF_RUN', `Impossibile accedere alla cartella di output: ${outputFolderId}`, { error: e.message });
      throw new Error(`Impossibile accedere alla CARTELLA_OUTPUT_ID.`);
    }

    _mainLoop(outputFolder, isSilent, forceProcessAll);
  }

  /**
   * Processa solo fatture con StatoPDF=TODO o SKIPPED.
   * Utile per riprendere creazione PDF dopo disabilitazione temporanea.
   * 
   * @param {boolean} [isSilent=false] - Se true, disabilita aggiornamenti UI progress
   * @returns {void}
   * 
   * @example
   * PDF.runPdfOnly(); // Processa solo TODO/SKIPPED
   */
  function runPdfOnly(isSilent = false) {
    const outputFolderId = CONFIG.get('CARTELLA_OUTPUT_ID');
    if (!outputFolderId) {
      LOG?.error('PDF_RUN_ONLY', 'CARTELLA_OUTPUT_ID non definita.');
      throw new Error("CARTELLA_OUTPUT_ID non definita in 'Config'.");
    }

    let outputFolder;
    try {
      outputFolder = DriveApp.getFolderById(outputFolderId);
    } catch (e) {
      LOG?.error('PDF_RUN_ONLY', `Impossibile accedere alla cartella di output: ${outputFolderId}`, { error: e.message });
      throw new Error(`Impossibile accedere alla CARTELLA_OUTPUT_ID.`);
    }

    _mainLoopPdfOnly(outputFolder, isSilent);
  }

  /**
   * Ciclo principale (resumibile e chunked).
   */
  function _mainLoop(outputFolder, isSilent, forceProcessAll = false) {
    const startTime = new Date();
    const maxSec = Number(CONFIG.get('MAX_RUNTIME_SEC', 240)) || 240;

    // Check PDF_ENABLED
    const pdfEnabled = CONFIG.get('PDF_ENABLED', true);
    if (!pdfEnabled && !forceProcessAll) {
      LOG?.info('PDF', 'PDF_ENABLED=FALSE. Impostazione StatoPDF=SKIPPED per fatture senza PDF.');
      _markAllAsSkipped(isSilent);
      return;
    }

    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    if (!sh) {
      LOG?.warn('PDF', "Foglio 'Fatture' non trovato. Nessuna operazione eseguita.");
      return;
    }

    const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Fatture);
    if (sh.getLastRow() < headerRow + 1) {
      LOG?.info('PDF', 'Nessuna fattura da processare.');
      return;
    }

    // ---- Indici necessari (minimi): FileID, FileName, LinkPDF, StatoPDF, DenominazioneFornitore, NumeroDoc
    const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
    const requiredKeys = ['FileID', 'FileName', 'LinkPDF', 'DenominazioneFornitore', 'NumeroDoc'];
    const missing = requiredKeys.filter(k => idx[k] === undefined);
    if (missing.length > 0) {
      throw new Error("Colonne mancanti nel foglio Fatture: " + missing.join(', '));
    }
    // Opzionale: colonna PDFStato per tracciare successo/errore (legacy)
    const hasPDFStato = idx.PDFStato !== undefined;
    // Nuova colonna obbligatoria: StatoPDF
    const hasStatoPDF = idx.StatoPDF !== undefined;
    if (!hasStatoPDF) {
      LOG?.warn('PDF', 'Colonna StatoPDF non trovata. Funzionalità limitata.');
    }
    
    // Lettura ottimizzata: solo fino all'ultima colonna richiesta
    const colsToCheck = [idx.FileID, idx.FileName, idx.LinkPDF, idx.DenominazioneFornitore, idx.NumeroDoc];
    if (hasPDFStato) colsToCheck.push(idx.PDFStato);
    if (hasStatoPDF) colsToCheck.push(idx.StatoPDF);
    const maxColNeeded = Math.max(...colsToCheck) + 1;

    // Stato ripresa
    const cursor = STATE.getJSON(CURSOR_KEY, { nextRow: headerRow + 1 });
    let currentRow = Math.max(headerRow + 1, Number(cursor.nextRow));
    const lastRow = sh.getLastRow();

    // Indicizza PDF già presenti (nome → url)
    const existingPdfs = _indexExistingPdfsMap(outputFolder);

    // Buffer aggiornamenti LinkPDF e parametri batch
    const linkUpdates = {};
    let pendingUpdates = 0;
    let createdCount = 0;

    const CHUNK_SIZE = Number(CONFIG.get('PDF_CHUNK_SIZE', 80)) || 80;
    const FLUSH_UPDATES_EVERY = Number(CONFIG.get('PDF_FLUSH_EVERY', 200)) || 200;

    const totalInvoices = lastRow - headerRow;
    LOG?.info('PDF', `Avvio generazione PDF: ${totalInvoices} fatture da processare (da riga ${currentRow} a ${lastRow})`);

    if (!isSilent) {
      STATE.setJSON(App.config.keys.progress, {
        current: currentRow,
        total: lastRow,
        message: 'Creazione PDF in corso...'
      });
    }

    // REFACTORED: Use SHEET_ITERATOR for automatic chunk handling, timeout, progress
    const iteratorResult = SHEET_ITERATOR.forEachChunk({
      sheet: sh,
      sheetName: SHEETS.SHEET_NAMES.Fatture,
      startRow: currentRow,
      endRow: lastRow,
      batchSize: CHUNK_SIZE,
      maxColumns: maxColNeeded,
      cursorKey: CURSOR_KEY,
      maxRuntimeSec: maxSec,
      onTimeout: () => {
        if (pendingUpdates > 0) {
          UTIL.updateSheetInPlace(sh, linkUpdates, headerRow);
          _clearObject(linkUpdates); pendingUpdates = 0;
        }
        LOG?.warn('PDF', 'Timeout. Ripresa salvata.');
        if (!isSilent) {
          SHARED_UTILS.showToast('Timeout raggiunto. Premi "Crea PDF" per riprendere.', 'Pausa', 10);
        }
      },
      processChunk: (chunkData, chunkStartRow) => {
        // Log progresso chunk
        LOG?.info('PDF', `Elaborando chunk: righe ${chunkStartRow}-${chunkStartRow + chunkData.length - 1} di ${lastRow}`);
        
        // Elabora il blocco
        for (let i = 0; i < chunkData.length; i++) {
          const rowData = chunkData[i];
          const rowNum = chunkStartRow + i;

        const fileId = rowData[idx.FileID];
        const fileName = rowData[idx.FileName];
        const existingPdfLink = rowData[idx.LinkPDF];
        const currentStatoPDF = hasStatoPDF ? String(rowData[idx.StatoPDF] || '').trim().toUpperCase() : '';
        const denominazioneFornitore = String(rowData[idx.DenominazioneFornitore] || '').trim();
        const numeroDoc = String(rowData[idx.NumeroDoc] || '').trim();

        // Skip se mancano dati essenziali o PDF già completato
        if (!fileId || !fileName) continue;
        if (existingPdfLink && currentStatoPDF === 'DONE') continue; // Già fatto
        if (!denominazioneFornitore || !numeroDoc) {
          LOG?.warn('PDF', `Saltata fattura riga ${rowNum}: manca DenominazioneFornitore o NumeroDoc`);
          if (hasStatoPDF) _addUpdate(linkUpdates, rowNum, idx.StatoPDF, 'ERROR');
          pendingUpdates++;
          continue;
        }

        const pdfName = _toPdfName(denominazioneFornitore, numeroDoc);

        // Se PDF già in cartella: aggiorna LinkPDF con URL noto dall'indice
        const knownUrl = existingPdfs.get(pdfName);
        if (knownUrl) {
          _addUpdate(linkUpdates, rowNum, idx.LinkPDF, knownUrl);
          if (hasStatoPDF) _addUpdate(linkUpdates, rowNum, idx.StatoPDF, 'DONE');
          pendingUpdates++;
          // flush parziale
          if (pendingUpdates >= FLUSH_UPDATES_EVERY) {
            UTIL.updateSheetInPlace(sh, linkUpdates, headerRow);
            _clearObject(linkUpdates); pendingUpdates = 0;
          }
          continue;
        }

        // Creazione PDF da template
        try {
          const doc = XMLSAFE.parseDriveXml(String(fileId));
          if (!doc) throw new Error(`Parsing del file XML fallito (ID: ${fileId}).`);

          const template = HtmlService.createTemplateFromFile('PdfTemplate');
          const dataForTemplate = _prepareDataForTemplate(doc);

          template.fornitore = dataForTemplate.fornitore;
          template.cliente   = dataForTemplate.cliente;
          template.doc       = dataForTemplate.doc;
          template.righe     = dataForTemplate.righe;
          template.riepilogo = dataForTemplate.riepilogo;

          // Genera HTML → PDF
          const htmlString = template.evaluate().getContent();
          const pdfBlob = Utilities.newBlob(htmlString, MimeType.HTML, pdfName).getAs(MimeType.PDF);

          const pdfFile = outputFolder.createFile(pdfBlob);
          const pdfUrl = pdfFile.getUrl();

          // Aggiorna indice e foglio
          existingPdfs.set(pdfName, pdfUrl);
          _addUpdate(linkUpdates, rowNum, idx.LinkPDF, pdfUrl);
          if (hasPDFStato) _addUpdate(linkUpdates, rowNum, idx.PDFStato, 'OK');
          if (hasStatoPDF) _addUpdate(linkUpdates, rowNum, idx.StatoPDF, 'DONE');
          pendingUpdates++;
          createdCount++;
          LOG?.info('PDF', `PDF creato: "${pdfName}" (riga ${rowNum})`);

          // flush parziale
          if (pendingUpdates >= FLUSH_UPDATES_EVERY) {
            UTIL.updateSheetInPlace(sh, linkUpdates, headerRow);
            _clearObject(linkUpdates); pendingUpdates = 0;
          }
        } catch (e) {
          // ✅ CIRCUIT BREAKER: Quota giornaliera PDF raggiunta
          const errorMsg = String(e.message || '').toLowerCase();
          if (errorMsg.includes('servizio richiamato troppe volte') || 
              errorMsg.includes('quota') || 
              errorMsg.includes('conversion')) {
            
            // Imposta StatoPDF=ERROR per questa fattura
            if (hasStatoPDF) _addUpdate(linkUpdates, rowNum, idx.StatoPDF, 'ERROR');
            if (hasPDFStato) _addUpdate(linkUpdates, rowNum, idx.PDFStato, 'QUOTA_EXCEEDED');
            _addUpdate(linkUpdates, rowNum, idx.LinkPDF, '⚠️ QUOTA PDF ESAURITA');
            pendingUpdates++;
            
            // Flush aggiornamenti prima di uscire
            if (pendingUpdates > 0) {
              UTIL.updateSheetInPlace(sh, linkUpdates, headerRow);
              _clearObject(linkUpdates); pendingUpdates = 0;
            }
            
            // Salva stato per ripresa futura
            STATE.setJSON(CURSOR_KEY, { nextRow: rowNum });
            
            // ✅ DISABILITA PDF_ENABLED AUTOMATICAMENTE
            try {
              CONFIG.set('PDF_ENABLED', false);
              LOG?.warn('PDF_QUOTA_EXCEEDED', `⚠️ PDF_ENABLED disabilitato automaticamente dopo quota esaurita.`);
            } catch (configError) {
              LOG?.error('PDF_CONFIG_UPDATE', 'Impossibile disabilitare PDF_ENABLED', { error: configError.message });
            }
            
            LOG?.warn('PDF_QUOTA_EXCEEDED', `⚠️ QUOTA GIORNALIERA RAGGIUNTA. Stop esecuzione alla riga ${rowNum}. Creati finora: ${createdCount} PDF.`);
            
            if (!isSilent) {
              SHARED_UTILS.showToast(
                '⚠️ Quota giornaliera PDF raggiunta. PDF_ENABLED disabilitato. Riprova domani o usa "Riprendi PDF".', 
                'Quota Esaurita', 
                15
              );
              STATE.setJSON(App.config.keys.progress, {
                current: rowNum, 
                total: lastRow, 
                message: 'Quota PDF esaurita. PDF_ENABLED disabilitato.'
              });
            }
            
            return; // ✅ STOP IMMEDIATO - Non continua a processare altre fatture
          }
          
          // Errori normali (diversi da quota): log e continua
          LOG?.error('PDF', `Impossibile creare PDF (riga ${rowNum})`, {
            fileId, fornitore: denominazioneFornitore, numeroDoc, 
            error: e.message, stack: e.stack
          });
          _addUpdate(linkUpdates, rowNum, idx.LinkPDF, 'ERRORE CREAZIONE PDF');
          if (hasPDFStato) _addUpdate(linkUpdates, rowNum, idx.PDFStato, 'ERRORE');
          if (hasStatoPDF) _addUpdate(linkUpdates, rowNum, idx.StatoPDF, 'ERROR');
          pendingUpdates++;
        }
      }

      // UI progress update
      if (!isSilent && chunkStartRow % (CHUNK_SIZE * 2) === 0) {
        const progressRow = Math.min(chunkStartRow + chunkData.length - 1, lastRow);
        STATE.setJSON(App.config.keys.progress, {
          current: progressRow, total: lastRow,
          message: `Creazione PDF: ${progressRow}/${lastRow}...`
        });
      }
    }
    });

    // Check if iterator was interrupted by timeout
    if (iteratorResult.interrupted) {
      return;
    }

    // Flush finale degli aggiornamenti link
    if (pendingUpdates > 0) {
      UTIL.updateSheetInPlace(sh, linkUpdates, headerRow);
      _clearObject(linkUpdates); pendingUpdates = 0;
    }

    STATE.clear(CURSOR_KEY);
    if (!isSilent) STATE.clear(App.config.keys.progress);
    LOG?.info('PDF', `Creazione PDF completata. Creati ${createdCount} nuovi file.`);
  }

  /**
   * Prepara dati da passare al template HTML.
   */
  function _prepareDataForTemplate(doc) {
    const root = doc.getRootElement();
    const header = UTIL.firstChild(root, 'FatturaElettronicaHeader');
    const body   = UTIL.firstChild(root, 'FatturaElettronicaBody');
    if (!body) throw new Error('Elemento FatturaElettronicaBody non trovato.');

    // Helper anagrafica
    const _extractAnagrafica = (partyElement) => {
      if (!partyElement) return { nome: 'Dati Anagrafici Mancanti' };

      const datiAnagrafici = UTIL.firstChild(partyElement, 'DatiAnagrafici');
      const anagrafica = datiAnagrafici ? UTIL.firstChild(datiAnagrafici, 'Anagrafica') : null;
      const idFiscale  = datiAnagrafici ? UTIL.firstChild(datiAnagrafici, 'IdFiscaleIVA') : null;
      const sede       = UTIL.firstChild(partyElement, 'Sede');

      const indirizzo = sede
        ? [UTIL.firstText(sede, 'Indirizzo'), UTIL.firstText(sede, 'NumeroCivico')].filter(Boolean).join(' ')
        : '';
      const citta = sede
        ? [UTIL.firstText(sede, 'CAP'), UTIL.firstText(sede, 'Comune'),
           UTIL.firstText(sede, 'Provincia') ? `(${UTIL.firstText(sede, 'Provincia')})` : '']
           .filter(Boolean).join(' ')
        : '';

      const nome = anagrafica
        ? (UTIL.firstText(anagrafica, 'Denominazione') ||
           [UTIL.firstText(anagrafica, 'Nome'), UTIL.firstText(anagrafica, 'Cognome')].filter(Boolean).join(' '))
        : 'Nome Mancante';

      const piva = idFiscale
        ? `${UTIL.firstText(idFiscale, 'IdPaese') || ''}${UTIL.firstText(idFiscale, 'IdCodice') || ''}`.trim()
        : '';

      const cf = datiAnagrafici ? (UTIL.firstText(datiAnagrafici, 'CodiceFiscale') || '') : '';

      const indirizzoHtml = (`${indirizzo}<br>${citta}`).trim() === '<br>' ? 'Indirizzo Mancante' : `${indirizzo}<br>${citta}`;

      return { nome, piva, cf, indirizzo: indirizzoHtml };
    };

    const datiGenerali = UTIL.firstChild(body, 'DatiGenerali');
    const datiGeneraliDoc = UTIL.firstChild(datiGenerali, 'DatiGeneraliDocumento');
    if (!datiGeneraliDoc) throw new Error('Elemento DatiGeneraliDocumento non trovato.');

    const dataDocStr = UTIL.firstText(datiGeneraliDoc, 'Data');
    const dataDoc = UTIL.date.parseXmlDate(dataDocStr) || new Date(0);

    const datiBeniServizi = UTIL.firstChild(body, 'DatiBeniServizi');

    // Righe
    const righe = [];
    const dettaglioLinee = datiBeniServizi
      ? (datiBeniServizi.getChildren() || []).filter(n => n.getName && n.getName() === 'DettaglioLinee')
      : [];

    dettaglioLinee.forEach(linea => {
      righe.push({
        numeroLinea:    UTIL.firstText(linea, 'NumeroLinea') || '',
        descrizione:    UTIL.firstText(linea, 'Descrizione') || '',
        quantita:       _fmtNum(UTIL.parseNumSmart(UTIL.firstText(linea, 'Quantita')), 2),
        prezzoUnitario: _fmtNum(UTIL.parseNumSmart(UTIL.firstText(linea, 'PrezzoUnitario')), 2),
        prezzoTotale:   _fmtNum(UTIL.parseNumSmart(UTIL.firstText(linea, 'PrezzoTotale')), 2),
        aliquotaIVA:    _fmtNum(UTIL.parseNumSmart(UTIL.firstText(linea, 'AliquotaIVA')), 2)
      });
    });

    // Riepilogo Totali
    const riepilogoNodi = datiBeniServizi
      ? (datiBeniServizi.getChildren() || []).filter(n => n.getName && n.getName() === 'DatiRiepilogo')
      : [];
    let totaleImponibile = 0, totaleImposta = 0;
    riepilogoNodi.forEach(node => {
      totaleImponibile += UTIL.parseNumSmart(UTIL.firstText(node, 'ImponibileImporto'));
      totaleImposta    += UTIL.parseNumSmart(UTIL.firstText(node, 'Imposta'));
    });

    let totaleDocumento = UTIL.parseNumSmart(UTIL.firstText(datiGeneraliDoc, 'ImportoTotaleDocumento'));
    if (totaleDocumento === 0 && (totaleImponibile !== 0 || totaleImposta !== 0)) {
      // Considera eventuale Bollo
      const bollo = UTIL.parseNumSmart(UTIL.firstText(UTIL.firstChild(datiGeneraliDoc, 'DatiBollo'), 'ImportoBollo'));
      totaleDocumento = totaleImponibile + totaleImposta + bollo;
    }

    return {
      fornitore: _extractAnagrafica(UTIL.firstChild(header, 'CedentePrestatore')),
      cliente:   _extractAnagrafica(UTIL.firstChild(header, 'CessionarioCommittente')),
      doc: {
        numero: UTIL.forceText(UTIL.firstText(datiGeneraliDoc, 'Numero')),
        data:   UTIL.date.formatItalianDate(dataDoc)
      },
      righe: righe,
      riepilogo: {
        totaleImponibile: _fmtNum(totaleImponibile, 2),
        totaleImposta:    _fmtNum(totaleImposta, 2),
        totaleDocumento:  _fmtNum(totaleDocumento, 2)
      }
    };
  }

  // Indicizza i PDF esistenti come mappa (nome → URL)
  function _indexExistingPdfsMap(folder) {
    const map = new Map();
    try {
      const files = folder.getFiles();
      while (files.hasNext()) {
        const f = files.next();
        if (f.getMimeType && f.getMimeType() === MimeType.PDF) {
          map.set(f.getName(), f.getUrl());
        }
      }
    } catch (e) {
      LOG?.error('PDF_INDEX', 'Impossibile indicizzare i PDF esistenti.', { error: e.message });
    }
    return map;
  }

  /**
   * Costruisce nome PDF da DenominazioneFornitore e NumeroDoc.
   * Schema: "DenominazioneFornitore - NumeroDoc.pdf"
   */
  function _toPdfName(denominazione, numeroDoc) {
    const denom = _sanitizeFilename(String(denominazione || '').trim());
    const num = _sanitizeFilename(String(numeroDoc || '').trim());
    
    if (!denom && !num) return 'documento_senza_nome.pdf';
    if (!denom) return `Fornitore_sconosciuto - ${num}.pdf`;
    if (!num) return `${denom} - documento_senza_numero.pdf`;
    
    return `${denom} - ${num}.pdf`;
  }

  /**
   * Sanifica nome file rimuovendo caratteri non ammessi in Google Drive.
   * Caratteri proibiti: / \ ? * [ ] : | < > " e caratteri di controllo.
   */
  function _sanitizeFilename(name) {
    if (!name) return '';
    // Rimuove caratteri proibiti e di controllo
    let sanitized = name.replace(/[\/\\?\*\[\]:"<>|\x00-\x1F\x7F]/g, '');
    // Converte spazi multipli in singoli
    sanitized = sanitized.replace(/\s+/g, ' ');
    // Rimuove spazi iniziali/finali
    sanitized = sanitized.trim();
    // Se vuoto dopo sanificazione, ritorna placeholder
    return sanitized || 'unnamed';
  }

  function _addUpdate(updatesObj, rowNum, colIndex0based, value) {
    if (!updatesObj[rowNum]) updatesObj[rowNum] = {};
    updatesObj[rowNum][colIndex0based] = value;
  }

  function _clearObject(obj) { for (const k in obj) delete obj[k]; }

  function _fmtNum(n, digits) {
    const num = Number(n) || 0;
    return num.toFixed(digits);
  }

  /**
   * Marca tutte le fatture senza PDF come SKIPPED quando PDF_ENABLED=FALSE
   * @private
   */
  function _markAllAsSkipped(isSilent) {
    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    if (!sh) return;

    const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
    if (!idx.StatoPDF || !idx.LinkPDF) return;

    const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Fatture);
    const lastRow = sh.getLastRow();
    if (lastRow <= headerRow) return;

    const data = sh.getRange(headerRow + 1, 1, lastRow - headerRow, Math.max(...Object.values(idx)) + 1).getValues();
    const updates = {};
    let skippedCount = 0;

    data.forEach((row, i) => {
      const rowNum = headerRow + 1 + i;
      const linkPDF = row[idx.LinkPDF];
      const statoPDF = String(row[idx.StatoPDF] || '').trim().toUpperCase();

      // Solo fatture senza PDF che non sono già SKIPPED o DONE
      if (!linkPDF && statoPDF !== 'SKIPPED' && statoPDF !== 'DONE') {
        _addUpdate(updates, rowNum, idx.StatoPDF, 'SKIPPED');
        skippedCount++;
      }
    });

    if (skippedCount > 0) {
      UTIL.updateSheetInPlace(sh, updates, headerRow);
      LOG?.info('PDF_SKIP', `Marcate ${skippedCount} fatture come SKIPPED (PDF_ENABLED=FALSE).`);
      if (!isSilent) {
        SHARED_UTILS.showToast(`PDF disabilitato: ${skippedCount} fatture marcate SKIPPED.`, 'PDF Disabilitato', 5);
      }
    }
  }

  /**
   * Ciclo principale solo per fatture con StatoPDF=TODO o SKIPPED
   * @private
   */
  function _mainLoopPdfOnly(outputFolder, isSilent) {
    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Fatture);
    if (!sh) {
      LOG?.warn('PDF_ONLY', "Foglio 'Fatture' non trovato.");
      return;
    }

    const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
    if (!idx.StatoPDF) {
      LOG?.error('PDF_ONLY', 'Colonna StatoPDF non trovata. Impossibile procedere.');
      if (!isSilent) SHARED_UTILS.showToast('Colonna StatoPDF mancante.', 'Errore', 5);
      return;
    }

    const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Fatture);
    const lastRow = sh.getLastRow();
    if (lastRow <= headerRow) {
      LOG?.info('PDF_ONLY', 'Nessuna fattura da processare.');
      return;
    }

    const data = sh.getRange(headerRow + 1, 1, lastRow - headerRow, Math.max(...Object.values(idx)) + 1).getValues();
    
    // Filtra solo TODO e SKIPPED
    const rowsTodo = [];
    data.forEach((row, i) => {
      const statoPDF = String(row[idx.StatoPDF] || '').trim().toUpperCase();
      if (statoPDF === 'TODO' || statoPDF === 'SKIPPED') {
        rowsTodo.push(headerRow + 1 + i);
      }
    });

    if (rowsTodo.length === 0) {
      LOG?.info('PDF_ONLY', 'Nessuna fattura TODO o SKIPPED da processare.');
      if (!isSilent) SHARED_UTILS.showToast('Nessun PDF da riprendere.', 'Info', 3);
      return;
    }

    LOG?.info('PDF_ONLY', `Ripresa creazione PDF: ${rowsTodo.length} fatture TODO/SKIPPED.`);
    if (!isSilent) SHARED_UTILS.showToast(`Ripresa ${rowsTodo.length} PDF...`, 'Avvio', 5);

    // Forza processamento di tutte queste fatture
    _mainLoop(outputFolder, isSilent, true);
  }

  return { run, runPdfOnly };
})();

// Registra PDF nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('PDF', ['SHEETS', 'LOG', 'UTIL', 'SHARED_UTILS', 'STATE', 'CONFIG', 'SHEET_ITERATOR']);
}

// Registra PDF nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('PDF', PDF);
}
