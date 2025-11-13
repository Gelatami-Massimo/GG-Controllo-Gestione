// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 80_pdf_export.js
// VERSIONE: 25.0 (PDF Export Engine)
// DESCRIZIONE: Motore di creazione PDF (resumibile, chunked, robusto).
// NOTA: Richiede un file Html "PdfTemplate" nel progetto.
// =============================================================

const PDF = (function () {

  const CURSOR_KEY = App.config.keys.cursors.pdf;

  function run(isSilent = false) {
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

    _mainLoop(outputFolder, isSilent);
  }

  /**
   * Ciclo principale (resumibile e chunked).
   */
  function _mainLoop(outputFolder, isSilent) {
    const startTime = new Date();
    const maxSec = Number(CONFIG.get('MAX_RUNTIME_SEC', 240)) || 240;

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

    // ---- Indici necessari (minimi): FileID, FileName, LinkPDF
    const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Fatture);
    const requiredKeys = ['FileID', 'FileName', 'LinkPDF'];
    const missing = requiredKeys.filter(k => idx[k] === undefined);
    if (missing.length > 0) {
      throw new Error("Colonne mancanti nel foglio Fatture: " + missing.join(', '));
    }
    // Lettura ottimizzata: solo fino all’ultima colonna richiesta
    const maxColNeeded = Math.max(idx.FileID, idx.FileName, idx.LinkPDF) + 1;

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

    if (!isSilent) {
      STATE.setJSON(App.config.keys.progress, {
        current: currentRow,
        total: lastRow,
        message: 'Creazione PDF in corso...'
      });
    }

    while (currentRow <= lastRow) {
      const elapsed = (new Date() - startTime) / 1000;
      if (elapsed > maxSec) {
        // Timeout: salva stato + flush aggiornamenti
        STATE.setJSON(CURSOR_KEY, { nextRow: currentRow });
        if (pendingUpdates > 0) {
          UTIL.updateSheetInPlace(sh, linkUpdates, headerRow);
          _clearObject(linkUpdates); pendingUpdates = 0;
        }
        LOG?.warn('PDF', `Timeout. Ripresa salvata dalla riga ${currentRow}.`);
        if (!isSilent) {
          UTIL.showToast('Timeout raggiunto. Premi "Crea PDF" per riprendere.', 'Pausa', 10);
          STATE.setJSON(App.config.keys.progress, {
            current: currentRow, total: lastRow, message: 'Timeout. In pausa...'
          });
        }
        return;
      }

      // Legge un blocco minimale di colonne
      const chunkRowCount = Math.min(CHUNK_SIZE, lastRow - currentRow + 1);
      let chunkData = [];
      try {
        chunkData = sh.getRange(currentRow, 1, chunkRowCount, maxColNeeded).getValues();
      } catch (e) {
        LOG?.error('PDF_MAIN', `Errore lettura chunk dati (riga ${currentRow})`, { error: e.message });
        currentRow += chunkRowCount;
        continue;
      }

      // Elabora il blocco
      for (let i = 0; i < chunkData.length; i++) {
        const rowData = chunkData[i];
        const rowNum = currentRow + i;

        const fileId = rowData[idx.FileID];
        const fileName = rowData[idx.FileName];
        const existingPdfLink = rowData[idx.LinkPDF];

        // Skip se mancano dati essenziali o link già presente (già risolto)
        if (!fileId || !fileName || existingPdfLink) continue;

        const pdfName = _toPdfName(fileName);

        // Se PDF già in cartella: aggiorna LinkPDF con URL noto dall’indice
        const knownUrl = existingPdfs.get(pdfName);
        if (knownUrl) {
          _addUpdate(linkUpdates, rowNum, idx.LinkPDF, knownUrl);
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
          pendingUpdates++;
          createdCount++;

          // flush parziale
          if (pendingUpdates >= FLUSH_UPDATES_EVERY) {
            UTIL.updateSheetInPlace(sh, linkUpdates, headerRow);
            _clearObject(linkUpdates); pendingUpdates = 0;
          }
        } catch (e) {
          LOG?.error('PDF', `Impossibile creare PDF per '${fileName}' (riga ${rowNum})`, {
            fileId, error: e.message, stack: e.stack
          });
          _addUpdate(linkUpdates, rowNum, idx.LinkPDF, 'ERRORE CREAZIONE PDF');
          pendingUpdates++;
        }
      }

      currentRow += chunkRowCount;

      if (!isSilent) {
        const progressRow = Math.min(currentRow - 1, lastRow);
        STATE.setJSON(App.config.keys.progress, {
          current: progressRow, total: lastRow,
          message: `Creazione PDF: ${progressRow}/${lastRow}...`
        });
      }
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
    const dataDoc = dataDocStr ? new Date(dataDocStr) : new Date(0);

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
        data:   dataDoc.toLocaleDateString('it-IT', { year: 'numeric', month: '2-digit', day: '2-digit' })
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

  // Converte nome XML(.p7m) → nome PDF
  function _toPdfName(originalName) {
    const base = (originalName || '').trim();
    if (!base) return 'documento.pdf';
    const name = base.replace(/\.xml(\.p7m)?$/i, '.pdf');
    return /\.pdf$/i.test(name) ? name : (name + '.pdf');
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

  return { run };
})();

// Registra PDF nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('PDF', ['SHEETS', 'LOG', 'UTIL', 'STATE', 'CONFIG']);
}

// Registra PDF nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('PDF', PDF);
}
