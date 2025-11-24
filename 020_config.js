// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 020_config.js
// RUOLO: Schemi fogli, indici colonne, formati e validazione.
// NOTE: Contiene CONFIG (get/set valori) e SHEETS (accesso fogli/header).
// =============================================================

const CONFIG = (function () {
  const cache = {};
  let cacheTimestamp = 0;
  const CACHE_DURATION_MS = 300000; // 5 minuti

  /**
   * Parser robusto per valori di configurazione.
   */
  function _parseValue(v) {
    if (v === null || v === undefined || v === '') return v;
    if (typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;

    if (typeof v === 'string') {
      const sRaw = v.trim();
      const s = sRaw.toLowerCase();

      // booleani
      if (s === 'true' || s === 'vero') return true;
      if (s === 'false' || s === 'falso') return false;

      // numeri (usa UTIL.number.parse centralizzato)
      const parsedNum = UTIL.number.parse(sRaw);
      if (parsedNum !== 0 || sRaw === '0' || sRaw === '0.0' || sRaw === '0,0') {
        return parsedNum;
      }

      // date ISO
      if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const d = UTIL.date.parseXmlDate(sRaw);
        if (d) return d;
      }
      // date IT: dd/mm/yyyy (con eventuale orario)
      const parsedItalianDate = UTIL.date.parseItalianDate(sRaw);
      if (parsedItalianDate) return parsedItalianDate;
      
      // Date con orario IT (estendi parsing)
      const mIT = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(sRaw);
      if (mIT) {
        const [, dd, mm, yyyy, hh = '00', mi = '00', ss = '00'] = mIT;
        const d = new Date(`${yyyy}-${mm}-${dd}T${hh}:${mi}:${ss}`);
        if (UTIL.date.isValidDate(d)) return d;
      }
    }
    return v; // Ritorna il valore originale se nessun parsing ha avuto successo
  }

  function _read() {
    const now = Date.now();
    if (cache.data && (now - cacheTimestamp < CACHE_DURATION_MS)) {
      return cache.data;
    }
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Config');

    if (!sh) {
      LOG?.error('CONFIG_READ', "Il foglio 'Config' non è stato trovato. Uso configurazione vuota.");
      cache.data = {};
      cacheTimestamp = now;
      return cache.data;
    }

    const lastRow = sh.getLastRow();
    const cfg = {};
    if (lastRow > 1) {
      // Assume header sempre in riga 1 per Config
      const headerRowCfg = 1;
      // Legge solo le prime 2 colonne (Key, Value)
      const data = sh.getRange(headerRowCfg + 1, 1, lastRow - headerRowCfg, 2).getValues();
      for (const [key, raw] of data) {
        const trimmedKey = String(key ?? '').trim();
        if (trimmedKey) {
          cfg[trimmedKey] = _parseValue(raw);
        }
      }
    }
    cache.data = cfg;
    cacheTimestamp = now;
    return cfg;
  }

  return {
    /**
     * Legge un valore di configurazione dal foglio Config.
     * Supporta parsing automatico di numeri, booleani, date (ISO e italiane), valute.
     * I valori vengono cachati in memoria per 5 minuti.
     * 
     * @param {string} key - Chiave configurazione da leggere
     * @param {*} [defaultValue=null] - Valore di default se la chiave non esiste
     * @returns {*} Valore configurazione parsato o defaultValue
     * 
     * @example
     * const maxRuntime = CONFIG.get('MAX_RUNTIME_SEC', 240);
     * const debugMode = CONFIG.get('MODALITA_DEBUG', false);
     */
    get(key, defaultValue = null) {
      const cfg = _read();
      return cfg[key] ?? defaultValue;
    },
    /**
     * Invalida la cache di configurazione forzando la rilettura dal foglio al prossimo get().
     * Utile dopo modifiche manuali al foglio Config.
     * 
     * @returns {void}
     */
    invalidateCache() {
      cache.data = null;
      cacheTimestamp = 0;
    }
  };
})();

// Registra CONFIG nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('CONFIG', ['App']);
}

// Registra CONFIG nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('CONFIG', CONFIG);
}

const SHEETS = (function () {
  // -----------------------------------------------------------
  // Utils interni
  // -----------------------------------------------------------
  function _toSafe(s) {
    return String(s ?? '')
      .normalize('NFKC')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[ /()]/g, '_')
      .replace(/_+/g, '_');
  }

  // -----------------------------------------------------------
  // Definizione degli schemi
  // -----------------------------------------------------------
  const SCHEMAS = {
    // --- SCHEMA CONFIG allineato (solo colonne base) ---
    'Config': ['Key', 'Value', 'Description'],

    // NB: Reparto subito dopo Categoria, Destinazione dopo Reparto, Data resta tra RegimeFiscale e Anno
    'Fatture': [
      'FileID', 'Sede', 'FileName', 'LinkXML', 'LinkPDF', 'PDFStato', 'StatoPDF',
      'FornitoreID', 'DenominazioneFornitore', 'Famiglia', 'Categoria',
      'Reparto', 'Destinazione',
      'RegimeFiscale', 'Data', 'Anno', 'Mese', 'NumeroDoc', 'TipoDoc',
      'TotImponibile', 'TotImposta', 'Valuta', 'TotDocumento',
      'RigheImportateNum', 'TotRigheNetto',
      'RigheImportate', 'ImportaRigheSrc', 'ImportedAt'
    ],
    // NB: Reparto ereditato da Fatture, TipoRiga calcolato in import
    'Righe': [
      'FileID', 'Sede', 'DataDoc', 'Anno', 'Mese', 'NumeroDoc',
      'FornitoreID', 'DenominazioneFornitore', 'Famiglia', 'Categoria',
      'NumeroLinea', 'CodiceInternoBreve', 'Codice Articolo Fornitore',
      'CodiceTipo', 'CodiceValore', 'Descrizione', 'Quantita',
      'PrezzoUnitario', 'PrezzoTotale', 'AliquotaIVA',
      'Reparto', 'TipoRiga'
    ],
    'Fornitori': ['FornitoreID', 'Denominazione', 'Famiglia', 'Categoria', 'Reparto', 'ImportaRighe'],
    'Aziende': ['P_IVA_Azienda', 'Nome_Sede', 'Note'],
    'Prodotti': [
      'CodiceInterno', 'CodiceInternoBreve', 'ChiaveDescrizione', 'CodiceFornitore', 'Descrizione', 'UM',
      'FornitoreID', 'DenominazioneFornitore', 'CategoriaProdotto',
      'Note', 'CreatoIl', 'UltimoAgg', 'Ingrediente', 'NonInUso',
      'UMBase', 'PZxCT', 'KGxPZ', 'PZxFila', 'FilePerCT', 'RichiedeSetup',
      'CostoUnitario', 'UMCosto'
    ],
    'Log': ['Timestamp', 'Level', 'Scope', 'Message', 'Context'],
    'Regole_UM': ['CodiceInterno', 'Pezzi per Unità', 'Peso per Pezzo (KG)', 'UM Finale', 'Note'],
    'Magazzino': [
      'Codice Interno', 'Denominazione Fornitore', 'Codice Articolo Fornitore', 'Descrizione',
      'Categoria Prodotto', 'Quantità Acquistata', 'UM Originale', 'Ultimo Prezzo Netto',
      'Pezzi per Unità (Calc)', 'Peso per Pezzo (KG) (Calc)', 'UM Finale (Calc)',
      'Quantità Standard', 'Prezzo Standardizzato'
    ],
    'Report Fornitori': ['Anno', 'FornitoreID', 'Denominazione Fornitore', 'Spesa Totale (IVA Incl.)'],
    // --- SCHEMA DATI MENSILI ---
    'Dati Mensili': [
      'Sede', 'AnnoMese', 'Anno', 'Mese', 'Fatturato', 'Costo Personale',
      'Costi', 'Fatture Incassate', 'Spese Bancarie', 'Altre Spese N/F', 'N. Doc'
    ],
    // --- Filtro Righe Spazzatura ---
    'Filtro Righe Spazzatura': ['ParolaChiaveDaIgnorare', 'Note'],
    // --- Righe Duplicate ---
    'Righe_Duplicate': ['FileID', 'NumeroDoc', 'NumeroLinea', 'CodiceValore', 'Descrizione', 'RowIndex']
  };

  // Mappa nomi sicuri -> nomi reali (es. Dati_Mensili -> "Dati Mensili")
  const SHEET_NAMES = Object.keys(SCHEMAS).reduce((acc, key) => {
    const safeKey = _toSafe(key);
    acc[safeKey] = key;
    return acc;
  }, {});

  const _cache = {}; // Cache interna per indici e headerRow
  const _dataCache = {}; // Cache avanzata per getCompanyMap e getProcessedFileIds
  const DATA_CACHE_TTL = 600000; // 10 minuti per dati che cambiano meno spesso

  function _invalidateIndexCache(sheetName = null) {
    try {
      if (sheetName && _cache[sheetName]) {
        delete _cache[sheetName];
        LOG?.debug('SHEETS_CACHE', `Cache invalidata per ${sheetName}`);
      } else if (!sheetName) {
        Object.keys(_cache).forEach(k => delete _cache[k]);
        LOG?.debug('SHEETS_CACHE', 'Cache intestazioni completamente invalidata.');
      }
    } catch (_) {}
  }

  function _findHeaderRow(sh, sheetName, forceRefresh = false) {
    if (_cache[sheetName] && _cache[sheetName].headerRow && !forceRefresh) {
      return _cache[sheetName].headerRow;
    }
    if (!SCHEMAS[sheetName]) {
      LOG?.warn('SHEETS_FIND_HEADER', `Schema non definito per ${sheetName}, assumo riga 1.`);
      return 1;
    }
    const schemaHeaders = new Set(SCHEMAS[sheetName]);
    if (!sh || schemaHeaders.size === 0) return 1;

    const maxRowsToCheck = Math.min(sh.getLastRow() || 10, 10);
    if (maxRowsToCheck === 0) return 1;

    let values;
    try {
      const lastColToCheck = sh.getLastColumn() || 1;
      values = sh.getRange(1, 1, maxRowsToCheck, lastColToCheck).getValues();
    } catch (e) {
      LOG?.error('SHEETS_FIND_HEADER', `Errore lettura prime righe di ${sheetName}`, { error: e.message });
      return 1;
    }

    let bestMatchRow = 1;
    let maxMatchScore = 0;

    for (let i = 0; i < values.length; i++) {
      const rowHeaders = new Set(values[i].filter(String).map(h => String(h).trim()));
      if (rowHeaders.size === 0) continue;

      const intersection = [...schemaHeaders].filter(h => rowHeaders.has(String(h).trim()));
      const matchScore = intersection.length / schemaHeaders.size;

      if (matchScore > maxMatchScore) {
        maxMatchScore = matchScore;
        bestMatchRow = i + 1;
      }
      if (matchScore >= 0.7) {
        if (!_cache[sheetName]) _cache[sheetName] = {};
        _cache[sheetName].headerRow = bestMatchRow;
        LOG?.debug(
          'SHEETS_FIND_HEADER',
          `Riga header trovata per ${sheetName}: ${bestMatchRow} (score: ${matchScore.toFixed(2)})`
        );
        return bestMatchRow;
      }
    }
    if (maxMatchScore > 0) {
      LOG?.warn(
        'SHEETS_HEADER',
        `Riga intestazioni trovata con bassa confidenza (${(maxMatchScore * 100).toFixed(0)}%) per ${sheetName}. Uso riga ${bestMatchRow}.`
      );
      if (!_cache[sheetName]) _cache[sheetName] = {};
      _cache[sheetName].headerRow = bestMatchRow;
      return bestMatchRow;
    } else {
      LOG?.warn(
        'SHEETS_HEADER',
        `Riga intestazioni non trovata con certezza per ${sheetName}. Assumo riga 1.`,
        { maxRowsChecked: maxRowsToCheck }
      );
      if (!_cache[sheetName]) _cache[sheetName] = {};
      _cache[sheetName].headerRow = 1;
      return 1;
    }
  }

  /**
   * Ottiene un oggetto Sheet per nome.
   * 
   * @param {string} sheetName - Nome del foglio da recuperare
   * @returns {GoogleAppsScript.Spreadsheet.Sheet|null} Oggetto Sheet o null se non trovato
   */
  function get(sheetName) {
    return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
  }

  /**
   * Ritorna mappa delle intestazioni colonna con indici 0-based.
   * Le chiavi sono normalizzate: spazi convertiti in underscore.
   * Risultato cachato in memoria per performance.
   * 
   * @param {string} sheetName - Nome foglio (usa SHEETS.SHEET_NAMES)
   * @param {boolean} [forceRefresh=false] - Se true, rilegge le intestazioni ignorando la cache
   * @returns {Object<string, number>} Mappa header_normalizzato -> indice colonna (0-based)
   * 
   * @example
   * const idx = SHEETS.headerIndex('Fatture');
   * const fileId = row[idx.FileID];
   * const numeroDoc = row[idx.NumeroDoc];
   */
  function headerIndex(sheetName, forceRefresh = false) {
    if (_cache[sheetName] && _cache[sheetName].index && !forceRefresh) {
      return _cache[sheetName].index;
    }
    const sh = get(sheetName);
    if (!sh) return {};

    const headerRow = _findHeaderRow(sh, sheetName, forceRefresh);
    let headers = [];
    try {
      const lastCol = sh.getLastColumn();
      headers = lastCol > 0 ? sh.getRange(headerRow, 1, 1, lastCol).getValues()[0] : [];
    } catch (e) {
      LOG?.error('SHEETS_INDEX', `Impossibile leggere riga intestazioni ${headerRow} per ${sheetName}`, {
        error: e.message
      });
      return {};
    }

    const idx = {};
    headers.forEach((h, i) => {
      const headerString = String(h ?? '').trim();
      if (headerString) {
        const safeKey = _toSafe(headerString);
        idx[safeKey] = i;
      }
    });

    if (!_cache[sheetName]) _cache[sheetName] = {};
    _cache[sheetName].index = idx;
    return idx;
  }

  function _ensureHeaders(sh, schemaHeaders, sheetName) {
    if (!sh || !Array.isArray(schemaHeaders) || schemaHeaders.length === 0) return;

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn() || 1;

    if (lastRow < 1 && lastCol <= 1 && sh.getRange('A1').getValue() === '') {
      try {
        const headerRange = sh.getRange(1, 1, 1, schemaHeaders.length);
        headerRange.setValues([schemaHeaders]);
        headerRange.setFontWeight('bold').setWrap(false);
        sh.setFrozenRows(1);
        LOG?.info('SHEETS_ENSURE_HDR', `Intestazioni create per foglio nuovo ${sheetName}.`);
        _invalidateIndexCache(sheetName);
      } catch (e) {
        LOG?.error('SHEETS_ENSURE_HDR', `Errore scrittura intestazioni per foglio nuovo ${sheetName}`, {
          error: e.message
        });
      }
      return;
    }

    const headerRow = _findHeaderRow(sh, sheetName);
    let actualHeaders = [];
    try {
      actualHeaders =
        lastCol > 0 ? sh.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(h => String(h ?? '').trim()) : [];
    } catch (e) {
      LOG?.error('SHEETS_ENSURE_HDR', `Impossibile leggere header esistenti in ${sheetName} riga ${headerRow}`, {
        error: e.message
      });
      return;
    }

    const schemaHeadersTrimmed = schemaHeaders.map(h => String(h).trim());
    const schemaHeaderSet = new Set(schemaHeadersTrimmed);
    const actualValidHeaders = actualHeaders.filter(h => h);
    const actualHeaderSet = new Set(actualValidHeaders);

    const missingHeaders = schemaHeadersTrimmed.filter(h => h && !actualHeaderSet.has(h));
    const extraHeaders = actualValidHeaders.filter(h => h && !schemaHeaderSet.has(h));

    let needsUpdate = false;
    if (missingHeaders.length > 0) {
      needsUpdate = true;
    } else {
      for (let i = 0; i < schemaHeadersTrimmed.length; i++) {
        if (i >= actualHeaders.length || actualHeaders[i] !== schemaHeadersTrimmed[i]) {
          needsUpdate = true;
          break;
        }
      }
    }

    if (needsUpdate) {
      const finalHeaders = [...schemaHeadersTrimmed, ...extraHeaders];
      LOG?.warn(
        'SHEETS_ENSURE_HDR',
        `Riallineamento intestazioni per ${sheetName} (riga ${headerRow}). Mancanti: [${missingHeaders.join(
          ', '
        )}]. Extra preservate: [${extraHeaders.join(', ')}]`
      );

      try {
        const colsToWrite = finalHeaders.length;
        const colsToClear = Math.max(lastCol, colsToWrite);

        if (colsToClear > 0) {
          sh.getRange(headerRow, 1, 1, colsToClear).clearContent().clearFormat();
        }

        if (colsToWrite > 0) {
          const rng = sh.getRange(headerRow, 1, 1, colsToWrite);
          rng.setValues([finalHeaders]).setFontWeight('bold').setWrap(false);
        }

        if (sh.getFrozenRows() < headerRow) {
          try {
            sh.setFrozenRows(headerRow);
          } catch (_) {}
          if (headerRow === 1 && sh.getFrozenRows() !== 1) {
            sh.setFrozenRows(1);
          }
        }

        _invalidateIndexCache(sheetName);
        Utilities.sleep(250);
      } catch (e) {
        LOG?.error('SHEETS_ENSURE_HDR', `Errore during riscrittura intestazioni in ${sheetName}`, {
          error: e.message
        });
      }
    }

    const excludeFromFilters = ['Config', 'Log'];
    
    if (!excludeFromFilters.includes(sheetName)) {
      try {
        // 1. Rimuovi filtro esistente (reset situazioni "sporche")
        const existingFilter = sh.getFilter();
        if (existingFilter) {
          existingFilter.remove();
          LOG?.debug('SHEETS_FILTER', `Filtro esistente rimosso da ${sheetName}`);
        }

        // 2. Applica nuovo filtro su tutta l'area dati
        const filterHeaderRow = _findHeaderRow(sh, sheetName, true);
        const lastCol = sh.getLastColumn();
        const lastRow = sh.getLastRow();
        
        if (lastRow >= filterHeaderRow && lastCol > 0) {
          const filterRange = sh.getRange(filterHeaderRow, 1, lastRow - filterHeaderRow + 1, lastCol);
          filterRange.createFilter();
          LOG?.debug('SHEETS_FILTER', `Filtro applicato a ${sheetName} (${lastRow - filterHeaderRow + 1} righe, ${lastCol} colonne)`);
        }
      } catch (e) {
        LOG?.warn('SHEETS_FILTER', `Impossibile gestire filtro per ${sheetName}`, { error: e.message });
      }
    }
  }

  /**
   * Verifica e crea tutti i fogli definiti in SHEETS.SCHEMAS.
   * Per ogni foglio mancante: lo crea con intestazioni corrette.
   * Per fogli esistenti: valida e ripristina intestazioni se necessario.
   * Applica filtri automatici su tutti i fogli dati (esclusi Config e Log).
   * 
   * @returns {void}
   */
  function ensureAll() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    LOG?.info('SHEETS_ENSURE', 'Avvio verifica struttura fogli...');
    for (const sheetName in SCHEMAS) {
      if (!SCHEMAS.hasOwnProperty(sheetName)) continue;

      let sh = ss.getSheetByName(sheetName);
      if (!sh) {
        sh = ss.insertSheet(sheetName);
        LOG?.info('SHEETS_ENSURE', `Foglio ${sheetName} creato.`);
        if (Array.isArray(SCHEMAS[sheetName]) && SCHEMAS[sheetName].length > 0) {
          _ensureHeaders(sh, SCHEMAS[sheetName], sheetName);
        }
      } else {
        if (Array.isArray(SCHEMAS[sheetName]) && SCHEMAS[sheetName].length > 0) {
          _ensureHeaders(sh, SCHEMAS[sheetName], sheetName);
        }
      }
    }
    LOG?.info('SHEETS_ENSURE', 'Verifica struttura fogli completata.');
  }

  function _formatRange(sheetName, colNames, format) {
    const sh = get(sheetName);
    if (!sh) return;
    const idx = headerIndex(sheetName, true);
    const headerRow = _findHeaderRow(sh, sheetName, true);
    if (sh.getLastRow() < headerRow + 1) return;

    for (const colName of colNames) {
      const safeColName = _toSafe(colName);
      if (idx[safeColName] !== undefined) {
        const colIndex0 = idx[safeColName];
        const colNum = colIndex0 + 1;
        if (colNum > 0 && colNum <= sh.getMaxColumns()) {
          try {
            const numRowsToFormat = sh.getLastRow() - headerRow;
            if (numRowsToFormat > 0) {
              sh.getRange(headerRow + 1, colNum, numRowsToFormat).setNumberFormat(format);
            }
          } catch (e) {
            LOG?.error('SHEETS_FORMAT', `Errore formattazione colonna ${colName} (${colNum}) in ${sheetName}`, {
              error: e.message
            });
          }
        }
      } else {
        const optionalSheets = [SHEET_NAMES.Dati_Mensili];
        if (!optionalSheets.includes(sheetName)) {
          LOG?.warn(
            'SHEETS_FORMAT',
            `Colonna "${colName}" (key: ${safeColName}) non trovata per formattazione in ${sheetName}.`
          );
        }
      }
    }
  }

  /**
   * Applica formati numerici e di testo a tutte le colonne dei fogli.
   * Formati applicati: valute (€), percentuali, date, numeri, testo (@).
   * Le regole sono definite in FORMAT_RULES interno.
   * 
   * @returns {void}
   */
  function applyFormats() {
    const FORMAT_RULES = {
      [SHEET_NAMES.Fatture]: [
        {
          format: '€ #,##0.00;[Red]-€ #,##0.00;€ 0.00',
          cols: ['TotImponibile', 'TotImposta', 'TotDocumento', 'TotRigheNetto']
        },
        { format: '#,##0', cols: ['RigheImportateNum'] },
        { format: 'dd/mm/yyyy', cols: ['Data'] },
        { format: 'dd/mm/yyyy hh:mm:ss', cols: ['ImportedAt'] },
        {
          format: '@',
          cols: [
            'FileID', 'Sede', 'FileName', 'LinkXML', 'LinkPDF', 'PDFStato', 'StatoPDF',
            'FornitoreID', 'DenominazioneFornitore', 'Famiglia', 'Categoria',
            'Reparto',
            'RegimeFiscale', 'Anno', 'Mese', 'NumeroDoc', 'TipoDoc',
            'Valuta', 'RigheImportate', 'ImportaRigheSrc'
          ]
        }
      ],
      [SHEET_NAMES.Righe]: [
        {
          format: '€ #,##0.00;[Red]-€ #,##0.00;€ 0.00',
          cols: ['PrezzoUnitario', 'PrezzoTotale']
        },
        { format: '#,##0.####', cols: ['Quantita'] },
        { format: '@', cols: ['AliquotaIVA'] },
        { format: 'dd/mm/yyyy', cols: ['DataDoc'] },
        {
          format: '@',
          cols: [
            'FileID', 'Sede', 'Anno', 'Mese', 'NumeroDoc', 'FornitoreID', 'DenominazioneFornitore',
            'Famiglia', 'Categoria', 'NumeroLinea', 'CodiceInternoBreve', 'Codice Articolo Fornitore',
            'CodiceTipo', 'CodiceValore', 'Descrizione', 'Reparto', 'TipoRiga'
          ]
        }
      ],
      [SHEET_NAMES.Prodotti]: [
        {
          format: '@',
          cols: [
            'CodiceInterno', 'CodiceFornitore', 'Descrizione', 'UM', 'UMBase', 'UMCosto',
            'FornitoreID', 'DenominazioneFornitore', 'CategoriaProdotto', 'Note', 'Ingrediente'
          ]
        },
        { format: 'dd/mm/yyyy hh:mm:ss', cols: ['CreatoIl', 'UltimoAgg'] },
        { format: '#,##0.####', cols: ['PZxCT', 'KGxPZ', 'PZxFila', 'FilePerCT'] },
        { format: '€ #,##0.0000;[Red]-€ #,##0.0000;€ 0.0000', cols: ['CostoUnitario'] }
      ],
      [SHEET_NAMES.Fornitori]: [
        {
          format: '@',
          cols: ['FornitoreID', 'Denominazione', 'Famiglia', 'Categoria', 'Reparto']
        }
      ],
      [SHEET_NAMES.Log]: [
        { format: 'dd/mm/yyyy hh:mm:ss', cols: ['Timestamp'] },
        { format: '@', cols: ['Level', 'Scope', 'Message', 'Context'] }
      ],
      [SHEET_NAMES.Regole_UM]: [
        { format: '@', cols: ['CodiceInterno', 'UM Finale', 'Note'] },
        { format: '#,##0.####', cols: ['Pezzi per Unità', 'Peso per Pezzo (KG)'] }
      ],
      [SHEET_NAMES.Magazzino]: [
        {
          format: '@',
          cols: [
            'Codice Interno', 'Denominazione Fornitore', 'Codice Articolo Fornitore',
            'Descrizione', 'Categoria Prodotto', 'UM Originale', 'UM Finale (Calc)'
          ]
        },
        {
          format: '#,##0.####',
          cols: [
            'Pezzi per Unità (Calc)', 'Peso per Pezzo (KG) (Calc)',
            'Quantità Acquistata', 'Quantità Standard'
          ]
        },
        { format: '€ #,##0.0000', cols: ['Ultimo Prezzo Netto', 'Prezzo Standardizzato'] }
      ],
      [SHEET_NAMES.Report_Fornitori]: [
        { format: '@', cols: ['Anno', 'FornitoreID', 'Denominazione Fornitore'] },
        { format: '€ #,##0.00', cols: ['Spesa Totale (IVA Incl.)'] }
      ],
      [SHEET_NAMES.Dati_Mensili]: [
        { format: '@', cols: ['Sede', 'AnnoMese', 'Anno', 'Mese'] },
        {
          format: '€ #,##0.00;[Red]-€ #,##0.00;€ 0.00',
          cols: [
            'Fatturato', 'Costo Personale',
            'Costi', 'Fatture Incassate', 'Spese Bancarie', 'Altre Spese N/F'
          ]
        },
        { format: '#,##0', cols: ['N. Doc'] }
      ],
      [SHEET_NAMES.Filtro_Righe_Spazzatura]: [
        { format: '@', cols: ['ParolaChiaveDaIgnorare', 'Note'] }
      ],
      [SHEET_NAMES.Righe_Duplicate]: [
        { format: '@', cols: ['FileID', 'NumeroDoc', 'NumeroLinea', 'CodiceValore', 'Descrizione'] },
        { format: '#,##0', cols: ['RowIndex'] }
      ]
    };

    LOG?.info('SHEETS_FORMAT', 'Avvio applicazione formati...');
    for (const sheetName in FORMAT_RULES) {
      if (!FORMAT_RULES.hasOwnProperty(sheetName)) continue;
      const sheet = get(sheetName);
      if (!sheet) {
        LOG?.warn('SHEETS_FORMAT', `Foglio ${sheetName} non trovato per formattazione.`);
        continue;
      }
      const rulesForSheet = FORMAT_RULES[sheetName];
      if (!Array.isArray(rulesForSheet)) {
        LOG?.error('CONFIG_FORMAT', `Definizione FORMAT_RULES non valida per ${sheetName}.`, {
          rules: rulesForSheet
        });
        continue;
      }
      for (const rule of rulesForSheet) {
        if (rule && Array.isArray(rule.cols) && rule.format !== undefined) {
          _formatRange(sheetName, rule.cols, rule.format);
        } else {
          LOG?.warn('CONFIG_FORMAT', `Regola formattazione non valida per ${sheetName}.`, { rule: rule });
        }
      }
    }
    LOG?.info('SHEETS_FORMAT', 'Applicazione formati completata.');
  }

  /**
   * Ottiene mappa delle aziende clienti da foglio Aziende.
   * Mappa P.IVA normalizzata (senza IT, senza zeri iniziali) -> Nome Sede.
   * Risultato cachato per 10 minuti per performance.
   * 
   * @returns {Map<string, string>} Mappa PIva -> NomeSede
   */
  function getCompanyMap() {
    // Phase 8.3: Query result caching - avoid repeated sheet reads
    const cacheKey = 'companyMap';
    const now = Date.now();
    
    if (_dataCache[cacheKey] && _dataCache[cacheKey].timestamp && 
        (now - _dataCache[cacheKey].timestamp) < DATA_CACHE_TTL) {
      return _dataCache[cacheKey].data;
    }
    
    const sheetName = SHEET_NAMES.Aziende;
    const sh = get(sheetName);
    const headerRow = sh ? _findHeaderRow(sh, sheetName) : 1;
    if (!sh || sh.getLastRow() <= headerRow) {
      const emptyMap = new Map();
      _dataCache[cacheKey] = { data: emptyMap, timestamp: now };
      return emptyMap;
    }

    let data = [];
    try {
      data = sh.getRange(headerRow + 1, 1, sh.getLastRow() - headerRow, 2).getValues();
    } catch (e) {
      LOG?.error('SHEETS_GETMAP', `Errore lettura dati da ${sheetName}`, { error: e.message });
      const emptyMap = new Map();
      _dataCache[cacheKey] = { data: emptyMap, timestamp: now };
      return emptyMap;
    }

    const companyMap = new Map();
    data.forEach(([key, val]) => {
      const trimmedKey = String(key ?? '').trim();
      const normalizedKey = trimmedKey.replace(/^IT/i, '').replace(/^0+/, '');
      const trimmedVal = String(val ?? '').trim();
      if (normalizedKey && trimmedVal) {
        companyMap.set(normalizedKey, trimmedVal);
      }
    });
    
    // Cache for next call
    _dataCache[cacheKey] = { data: companyMap, timestamp: now };
    LOG?.debug('SHEETS_CACHE', `getCompanyMap cached with ${companyMap.size} entries`, {
      cacheKey,
      entries: companyMap.size
    });
    
    return companyMap;
  }

  /**
   * Ottiene Set di tutti i FileID già processati nel foglio Fatture.
   * Usato per evitare reimport di fatture duplicate.
   * Risultato cachato per 10 minuti per performance.
   * 
   * @returns {Set<string>} Set di FileID già importati
   */
  function getProcessedFileIds() {
    // Phase 8.3: Query result caching - avoid repeated sheet reads
    const cacheKey = 'processedFileIds';
    const now = Date.now();
    
    if (_dataCache[cacheKey] && _dataCache[cacheKey].timestamp && 
        (now - _dataCache[cacheKey].timestamp) < DATA_CACHE_TTL) {
      return _dataCache[cacheKey].data;
    }
    
    const sheetName = SHEET_NAMES.Fatture;
    const sh = get(sheetName);
    const headerRow = sh ? _findHeaderRow(sh, sheetName) : 1;
    if (!sh || sh.getLastRow() <= headerRow) {
      const emptySet = new Set();
      _dataCache[cacheKey] = { data: emptySet, timestamp: now };
      return emptySet;
    }

    let data = [];
    try {
      data = sh.getRange(headerRow + 1, 1, sh.getLastRow() - headerRow, 1).getValues();
    } catch (e) {
      LOG?.error('SHEETS_GETIDS', `Errore lettura FileID da ${sheetName}`, { error: e.message });
      const emptySet = new Set();
      _dataCache[cacheKey] = { data: emptySet, timestamp: now };
      return emptySet;
    }

    const ids = new Set();
    data.flat().forEach(id => {
      const trimmedId = String(id ?? '').trim();
      if (trimmedId) ids.add(trimmedId);
    });
    
    // Cache for next call
    _dataCache[cacheKey] = { data: ids, timestamp: now };
    LOG?.debug('SHEETS_CACHE', `getProcessedFileIds cached with ${ids.size} entries`, {
      cacheKey,
      entries: ids.size
    });
    
    return ids;
  }

  // API Pubblica del modulo SHEETS
  return {
    get,
    ensureAll,
    applyFormats,
    headerIndex,
    invalidateHeaderIndexCache(sheetName = null) {
      _invalidateIndexCache(sheetName);
    },
    // Phase 8.3: Invalidate query result cache
    invalidateDataCache(cacheKey = null) {
      if (cacheKey) {
        delete _dataCache[cacheKey];
        LOG?.debug('SHEETS_CACHE', `Data cache invalidated for key: ${cacheKey}`);
      } else {
        // Clear all data cache
        Object.keys(_dataCache).forEach(key => delete _dataCache[key]);
        LOG?.debug('SHEETS_CACHE', `All data cache cleared`);
      }
    },
    getCompanyMap,
    getProcessedFileIds,
    SCHEMAS,
    SHEET_NAMES,
    _findHeaderRow,
    _ensureHeaders
  };
})();

// Registra SHEETS nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('SHEETS', ['App']);
}

// Registra SHEETS nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('SHEETS', SHEETS);
}

/**
 * Helper sviluppo: riallinea intestazioni e formati fogli.
 * Utile dopo modifiche agli SCHEMAS o FORMAT_RULES.
 * Chiama SHEETS.ensureAll() e SHEETS.applyFormats().
 * 
 * @returns {void}
 */
function DEV_EnsureSheetsAndFormats() {
  if (typeof SHEETS === 'undefined') {
    SpreadsheetApp.getUi().alert('SHEETS non è definito. Controlla 020_config.js.');
    return;
  }

  try {
    SHEETS.ensureAll();     // riallinea intestazioni in base a SCHEMAS
    SHEETS.applyFormats();  // riapplica tutti i formati
    SpreadsheetApp.getUi().alert('Struttura e formati fogli aggiornati.');
  } catch (e) {
    Logger.log(e);
    SpreadsheetApp.getUi().alert('Errore in DEV_EnsureSheetsAndFormats: ' + e.message);
  }
}
