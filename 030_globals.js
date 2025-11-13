// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 30_globals.js
// VERSIONE: 25.0 (Global Utilities)
// DESCRIZIONE: Utility globali (LOG, UTIL, XMLSAFE, STATE) — fix critico
//               su XmlService: niente getTextTrim(), gestione namespace FPA.
// =============================================================

/** Namespace FatturaPA (default v1.2 con fallback v1.0) */
const FPA_NS = XmlService.getNamespace('', 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2');
const FPA_NS10 = XmlService.getNamespace('', 'http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.0');

const LOG = (function () {
  const logBuffer = [];
  const MAX_BUFFER_SIZE = 100;

  function _flush() {
    if (logBuffer.length === 0) return;
    try {
      const sh = SHEETS.get(SHEETS.SHEET_NAMES.Log);
      if (!sh) {
        console.error('[LOG FLUSH FAIL] Foglio Log non trovato.');
        return;
      }
      const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Log);
      const numCols = 5; // Schema Log fisso
      const nextRow = Math.max(headerRow + 1, sh.getLastRow() + 1);

      const rangeToWrite = sh.getRange(nextRow, 1, logBuffer.length, numCols);
      rangeToWrite.setValues(logBuffer);
      
      sh.getRange(nextRow, 1, logBuffer.length, 1).setNumberFormat('dd/mm/yyyy hh:mm:ss');
      
      logBuffer.length = 0;
    } catch (e) {
      console.error('[LOG FLUSH FAIL]', e.message, e.stack);
    }
  }

  function _safeSerialize(context) {
    try {
      return JSON.stringify(
        context,
        (key, value) => {
          if (value && typeof value.getId === 'function') {
            try {
              if (typeof value.getName === 'function') {
                return `[AppsScript Object: ${value.getName()}]`;
              }
              return `[AppsScript Object ID: ${value.getId()}]`;
            } catch (e) {
              return `[AppsScript Object (errore serializzazione: ${e.message})]`;
            }
          }
          if (value instanceof Date) return value.toISOString();
          if (value instanceof Error) {
            return {
              name: value.name,
              message: value.message,
              stack: String(value.stack || '').slice(0, 1500)
            };
          }
          return value;
        }, 2
      );
    } catch (e) {
      return `{"error":"Impossibile serializzare il contesto","message":"${e.message}"}`;
    }
  }

  function _log(level, scope, message, context) {
    try {
      const cloudLogMessage = `[${level}] ${scope}: ${message}`;
      if (context && Object.keys(context).length > 0) {
           if (context.error instanceof Error) {
             console.error(cloudLogMessage, context.error.message, context.error.stack, context);
           } else if (level === 'ERROR') {
             console.error(cloudLogMessage, context);
           } else if (level === 'WARN') {
             console.warn(cloudLogMessage, context);
           } else {
             console.log(cloudLogMessage, context);
           }
      } else {
         if (level === 'ERROR') console.error(cloudLogMessage);
         else if (level === 'WARN') console.warn(cloudLogMessage);
         else console.log(cloudLogMessage);
      }

      let safeContext = _safeSerialize(context);
      if (safeContext.length > 49000) {
        safeContext = safeContext.substring(0, 49000) + '... [TRONCATO]"}';
      }
      logBuffer.push([new Date(), level || 'INFO', scope || '-', message || '-', safeContext]);
      
      if (logBuffer.length >= MAX_BUFFER_SIZE) _flush();

    } catch (e) {
      console.error('[LOG FAIL] Errore critico nel logger!', level, scope, message, e?.message);
    }
  }

  return {
    info: (scope, message, context = {}) => _log('INFO', scope, message, context),
    warn: (scope, message, context = {}) => _log('WARN', scope, message, context),
    error: (scope, message, context = {}) => _log('ERROR', scope, message, context),
    debug: (scope, message, context = {}) => {
      // Assicurati che CONFIG sia definito prima di chiamare LOG.debug
      try {
        if (CONFIG && CONFIG.get('MODALITA_DEBUG', false) === true) _log('DEBUG', scope, message, context);
      } catch (e) {
        // Fallback se CONFIG non è ancora pronto durante l'init
        if (String(message || '').includes('MODALITA_DEBUG')) {
          _log('DEBUG', scope, message, context);
        }
      }
    },
    flush: _flush
  };
})();

// Registra LOG nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('LOG', ['App']);
}

// Registra LOG nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('LOG', LOG);
}



const UTIL = (function () {

  let activeLock = null;
  function acquireLock(timeoutMs = 10000) {
    if (activeLock?.hasLock()) return true;
    try {
      const lock = LockService.getScriptLock();
      if (lock.tryLock(timeoutMs)) {
        activeLock = lock;
        return true;
      }
      LOG.warn('LOCK_ACQUIRE', `Timeout acquisizione lock (${timeoutMs}ms). Un altro processo è in esecuzione.`);
      return false;
    } catch (e) {
      LOG.error('LOCK_ACQUIRE', 'Errore critico durante il tentativo di acquisizione del lock.', { error: e.message });
      return false;
    }
  }
  function releaseLock() {
    if (activeLock?.hasLock()) {
      try { activeLock.releaseLock(); }
      catch (e) { LOG.error('LOCK_RELEASE', 'Errore durante il rilascio del lock.', { error: e.message }); }
    }
    activeLock = null;
  }

  function parseNumSmart(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const cleaned = value.replace(/[€$£\s]/g, '').trim();
      if (!cleaned) return 0;
      if (cleaned.includes('.') && cleaned.includes(',') && cleaned.lastIndexOf('.') < cleaned.lastIndexOf(',')) {
         const num = parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
         return isNaN(num) ? 0 : num;
      }
      if (cleaned.includes(',') && cleaned.includes('.') && cleaned.lastIndexOf(',') < cleaned.lastIndexOf('.')) {
         const num = parseFloat(cleaned.replace(/,/g, ''));
         return isNaN(num) ? 0 : num;
      }
      const num = parseFloat(cleaned.replace(',', '.'));
      return isNaN(num) ? 0 : num;
    }
    return 0;
  }

  // === XML HELPERS (Fix critico) ===
  /** Ritorna getChild con priorità: namespace dell'elemento -> extraNs -> FPA_NS -> FPA_NS10 -> no ns */
  function firstChild(element, name, extraNs) {
    if (!element) return null;
    const elNs = element.getNamespace();
    let found = null;
    if (elNs) {
      try { found = element.getChild(name, elNs); } catch (_) {}
      if (found) return found;
    }
    if (extraNs) {
      try { found = element.getChild(name, extraNs); } catch (_) {}
      if (found) return found;
    }
    try { found = element.getChild(name, FPA_NS); } catch (_) {}
    if (found) return found;
    try { found = element.getChild(name, FPA_NS10); } catch (_) {}
    if (found) return found;
    try { found = element.getChild(name); } catch (_) {}
    return found;
  }
  /** Testo sicuro: Apps Script non ha getTextTrim() → usa getText().trim() */
  function firstText(element, name, ns) {
    const child = firstChild(element, name, ns);
    return child ? String(child.getText()).trim() : '';
  }
  /** Testo di un nodo generico (Element/Text/String), mai null */
  function textOf(node) {
    if (!node) return '';
    try {
      if (typeof node.getText === 'function') return String(node.getText()).trim();
      if (typeof node.getValue === 'function') return String(node.getValue()).trim();
    } catch (e) {}
    return String(node).trim();
  }

  function writeBatched(sheet, startRow, data, batchSize = 200) {
    if (!data || data.length === 0 || !data[0]) return;
    try {
      const numRows = data.length;
      const numCols = data[0].length;
      if (numCols === 0) return;

      const maxColsSheet = sheet.getMaxColumns();
      if (maxColsSheet < numCols) sheet.insertColumnsAfter(maxColsSheet, numCols - maxColsSheet);
       const neededLastRow = startRow + numRows - 1;
       const maxRowsSheet = sheet.getMaxRows();
       if (neededLastRow > maxRowsSheet) sheet.insertRowsAfter(maxRowsSheet, neededLastRow - maxRowsSheet);

      const validStartRow = Math.max(1, startRow);
      for (let i = 0; i < numRows; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        if (batch.length > 0) {
           sheet.getRange(validStartRow + i, 1, batch.length, numCols).setValues(batch);
        }
      }
    } catch (e) {
      LOG.error('UTIL_WRITE_BATCH', `Errore during scrittura batch.`, { sheet: sheet.getName(), error: e.message });
      throw e;
    }
  }

  function getAllFilesRecursive(folder) {
    const fileList = [];
    function _search(subFolder) {
      try {
        const files = subFolder.getFiles();
        while (files.hasNext()) fileList.push(files.next());
        const subfolders = subFolder.getFolders();
        while (subfolders.hasNext()) _search(subfolders.next());
      } catch (e) {
        if (String(e.message || '').indexOf('denied') === -1) {
           LOG.warn('UTIL_SEARCH', `Impossibile leggere contenuto di '${subFolder?.getName()}'.`, { folderId: subFolder?.getId(), error: e.message });
        } else {
             console.warn(`Accesso negato alla cartella '${subFolder?.getName()}' (ID: ${subFolder?.getId()}) - Saltata.`);
        }
      }
    }
    if (folder) _search(folder);
    return fileList;
  }

  function updateSheetInPlace(sheet, updates, headerRows = 1) {
    const rowNumbers = Object.keys(updates);
    if (rowNumbers.length === 0) return 0;
    try {
      const dataRange = sheet.getDataRange();
      const numSheetRows = dataRange.getNumRows();
      if (numSheetRows <= headerRows) return 0;

      const displayRange = dataRange.offset(headerRows, 0, numSheetRows - headerRows);
      const values = displayRange.getValues();
      const dataRowsCount = values.length;
      let updatedCount = 0;

      for (const rowNum of rowNumbers) {
        const rowIndex = Number(rowNum) - headerRows - 1;
        if (rowIndex >= 0 && rowIndex < dataRowsCount) {
          const rowUpdates = updates[rowNum];
          const currentRowData = values[rowIndex];
          for (const colIndexStr in rowUpdates) {
            const colIndex = Number(colIndexStr);
            if (colIndex >= 0 && colIndex < currentRowData.length) {
              if (currentRowData[colIndex] !== rowUpdates[colIndexStr]) {
                 currentRowData[colIndex] = rowUpdates[colIndexStr];
                 updatedCount++;
              }
            } else {
              LOG.warn('UTIL_UPDATE', `Indice colonna ${colIndex + 1} fuori limiti per riga ${rowNum} in ${sheet.getName()}.`);
            }
          }
        } else {
          LOG.warn('UTIL_UPDATE', `Indice riga ${rowNum} fuori dai limiti per ${sheet.getName()}. Dati letti: ${dataRowsCount} righe. (Forse il foglio è cambiato durante l'esecuzione?)`);
        }
      }

      if (updatedCount > 0) {
        displayRange.setValues(values);
        SpreadsheetApp.flush();
        LOG.debug('UTIL_UPDATE', `Aggiornamento in-place: ${updatedCount} celle modificate in ${sheet.getName()}.`);
      }
      return updatedCount;
    } catch (e) {
      LOG.error('UTIL_UPDATE', 'Aggiornamento in-place fallito. Fallback cella-per-cella (lento).', { error: e.message, sheet: sheet.getName() });
      let fallbackCount = 0;
      for (const rowNum in updates) {
        for (const colIndex in updates[rowNum]) {
          try {
            sheet.getRange(Number(rowNum), Number(colIndex) + 1).setValue(updates[rowNum][colIndex]);
            fallbackCount++;
          } catch (e2) {
             LOG.error('UTIL_UPDATE_FALLBACK', `Impossibile aggiornare cella ${rowNum}:${Number(colIndex)+1}`, { error: e2.message });
          }
        }
      }
      return fallbackCount;
    }
  }

  function _looksNumericLike(str) {
    const s = String(str ?? '').trim();
    if (!s) return false;
    const cleaned = s.replace(/[€$£\s]/g, '');
    return /^-?[\d.,]+$/.test(cleaned) && !isNaN(parseNumSmart(s));
  }
  const forceText = (value) => {
    const str = String(value ?? '');
    if (!str) return '';
    if (str.startsWith("'")) return str;
    const trimmedStr = str.trim();
    if (/^0\d+$/.test(trimmedStr) || _looksNumericLike(trimmedStr)) {
      return "'" + str;
    }
    return str;
  };

  function getColumnLetter(colIndex) {
    if (typeof colIndex !== 'number' || colIndex < 0) return '';
    let letter = '';
    let num = colIndex + 1;
    while (num > 0) {
      let rem = (num - 1) % 26;
      letter = String.fromCharCode(65 + rem) + letter;
      num = Math.floor((num - 1) / 26);
    }
    return letter;
  }

  return {
    showToast: (message, title = 'Info', timeout = 5) => SpreadsheetApp.getActiveSpreadsheet().toast(message, title, timeout),
    parseNumSmart,
    // XML helpers pubblici
    firstChild,
    firstText,
    textOf,
    writeBatched,
    normKey: (str) => String(str ?? '').trim().toUpperCase(),
    getAllFilesRecursive,
    updateSheetInPlace,
    forceText,
    acquireLock,
    releaseLock,
    getColumnLetter
  };
})();

// Registra UTIL nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('UTIL', ['App']);
}

// Registra UTIL nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('UTIL', UTIL);
}



const XMLSAFE = (function () {
  const _stripBom = (s) => s.replace(/^\uFEFF/, '');

  function parseDriveXml(fileId) {
    try {
      const file = DriveApp.getFileById(fileId);
      const blob = file.getBlob();
      let content;

      try {
        content = blob.getDataAsString('UTF-8');
        return XmlService.parse(_stripBom(content));
      } catch (eUtf8) {
        LOG.debug('XMLSAFE', `Parsing UTF-8 fallito per ${file.getName()}, tento ISO-8859-1.`, { fileId, error: String(eUtf8.message || '').substring(0,100) });
        try {
          content = blob.getDataAsString('ISO-8859-1');
          return XmlService.parse(_stripBom(content));
        } catch (eIso) {
           try {
             content = blob.getDataAsString('Windows-1252');
             return XmlService.parse(_stripBom(content));
           } catch(eWin) {
              LOG.error('XMLSAFE', `Parsing fallito (UTF-8, ISO-8859-1, Win-1252) per ${file.getName()}.`, { fileId, error: eWin.message });
              return null;
           }
        }
      }
    } catch (eDrive) {
      LOG.error('XMLSAFE', `Impossibile leggere file da Drive: ${fileId}.`, { error: eDrive.message });
      return null;
    }
  }
  return { parseDriveXml };
})();

// Registra XMLSAFE nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('XMLSAFE', ['LOG', 'UTIL']);
}

// Registra XMLSAFE nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('XMLSAFE', XMLSAFE);
}



const STATE = (function () {
  const P = PropertiesService.getScriptProperties();
  const CACHE = CacheService.getScriptCache();
  const CACHE_EXPIRATION_SEC = 21600;
  const MAX_PROP_SIZE = 500000;
  const MAX_CACHE_CHUNK_SIZE = 95000;

  const standard = {
    get: (key) => P.getProperty(key),
    set: (key, value) => {
       const strValue = String(value ?? '');
       if (strValue.length > MAX_PROP_SIZE) {
           LOG.error('STATE_SET', `Valore troppo grande (> ${MAX_PROP_SIZE / 1024}KB) per PropertiesService, chiave: ${key}.`, { size: strValue.length });
           throw new Error(`Valore troppo grande per ScriptProperties. Chiave: ${key}.`);
       }
       P.setProperty(key, strValue);
    },
    clear: (key) => P.deleteProperty(key),
    getJSON(key, fallback = null) {
      const raw = P.getProperty(key);
      if (!raw) return fallback;
      try {
          return JSON.parse(raw);
      } catch (e) {
          LOG.warn('STATE_PARSE', `Impossibile parsare JSON da PropertiesService per chiave: ${key}. Valore grezzo: '${raw.substring(0,100)}...'`, { error: e.message });
          try { P.deleteProperty(key); } catch(_) {}
          return fallback;
      }
    },
    setJSON(key, obj) {
      try {
        const serialized = JSON.stringify(obj);
        if (serialized.length > MAX_PROP_SIZE) {
          LOG.error('STATE_SET_JSON', `JSON troppo grande (> ${MAX_PROP_SIZE / 1024}KB) per PropertiesService, chiave: ${key}. Usare STATE.cache?`, { size: serialized.length });
          throw new Error(`Dati JSON troppo grandi per ScriptProperties (${(serialized.length / 1024).toFixed(1)} KB). Chiave: ${key}.`);
        }
        P.setProperty(key, serialized);
      } catch (e) {
        LOG.error('STATE_SET_JSON', `Impossibile serializzare/salvare JSON in PropertiesService per chiave: ${key}`, { error: e.message });
        throw e;
      }
    }
  };

  const cache = {
    setLargeJSONArray(baseKey, dataArray) {
      if (!dataArray) return 0;
      if (dataArray.length === 0) {
        const oldKeys = [];
        for (let i = 0; i < 50; i++) oldKeys.push(`${baseKey}_${i}`);
        try { CACHE.removeAll(oldKeys); } catch (_) {}
        LOG.debug('STATE_CACHE_LARGE', `Array vuoto per ${baseKey}. Puliti chunk precedenti.`);
        return 0;
      }

      let chunkIndex = 0;
      let currentChunkItems = [];
      let currentChunkSize = 2; // '[' e ']'
      const chunksToSave = {};

      for (const item of dataArray) {
        let itemString;
        try {
          itemString = JSON.stringify(item);
        } catch (e) {
          LOG.warn('STATE_CACHE_LARGE', `Impossibile serializzare item per CacheService, chiave: ${baseKey}. Item saltato.`, { itemPreview: String(item).substring(0, 100), error: e.message });
          continue;
        }

        const itemSizeWithComma = itemString.length + (currentChunkItems.length > 0 ? 1 : 0);

        if (itemString.length + 2 > MAX_CACHE_CHUNK_SIZE) {
             LOG.error('STATE_CACHE_LARGE', `Item troppo grande (${itemString.length} bytes) per essere salvato in un chunk CacheService, chiave: ${baseKey}. Item saltato.`, { itemPreview: itemString.substring(0, 100) });
             continue;
        }

        if (currentChunkSize + itemSizeWithComma > MAX_CACHE_CHUNK_SIZE) {
          chunksToSave[`${baseKey}_${chunkIndex}`] = '[' + currentChunkItems.join(',') + ']';
          chunkIndex++;
          currentChunkItems = [itemString];
          currentChunkSize = itemString.length + 2;
        } else {
          currentChunkItems.push(itemString);
          currentChunkSize += itemSizeWithComma;
        }
      }

      if (currentChunkItems.length > 0) {
        chunksToSave[`${baseKey}_${chunkIndex}`] = '[' + currentChunkItems.join(',') + ']';
        chunkIndex++;
      }

      const keysToClean = [];
      for (let i = chunkIndex; i < chunkIndex + 50; i++) {
        keysToClean.push(`${baseKey}_${i}`);
      }
      try { if (keysToClean.length > 0) CACHE.removeAll(keysToClean); } catch (_) {}

      try {
        if (Object.keys(chunksToSave).length > 0) {
          CACHE.putAll(chunksToSave, CACHE_EXPIRATION_SEC);
        }
        LOG.debug('STATE_CACHE_LARGE', `Salvati ${dataArray.length} elementi in ${chunkIndex} chunk(s) per ${baseKey}.`);
        return chunkIndex;
      } catch (e) {
        LOG.error('STATE_CACHE_LARGE', `Errore during putAll in CacheService per ${baseKey}.`, { numChunks: Object.keys(chunksToSave).length, error: e.message });
        throw e;
      }
    },

    getLargeJSONArray(baseKey, numChunks) {
      if (!Number.isInteger(numChunks) || numChunks <= 0) return [];

      const keys = Array.from({ length: numChunks }, (_, i) => `${baseKey}_${i}`);
      let combinedArray = [];

      try {
        const chunksData = CACHE.getAll(keys);

        for (let i = 0; i < numChunks; i++) {
          const chunkKey = keys[i];
          const chunkJsonString = chunksData[chunkKey];

          if (chunkJsonString) {
            try {
              const chunkArray = JSON.parse(chunkJsonString);
              if (Array.isArray(chunkArray)) {
                 combinedArray = combinedArray.concat(chunkArray);
              } else {
                 LOG.error('STATE_CACHE_LARGE', `Chunk ${chunkKey} non contiene un array valido. Dati parziali.`, { chunkPreview: chunkJsonString.substring(0, 100) });
              }
            } catch (parseError) {
              LOG.error('STATE_CACHE_LARGE', `Errore parsing JSON chunk: ${chunkKey}. Dati incompleti o persi.`, { error: parseError.message, chunkPreview: chunkJsonString.substring(0, 100) });
              return [];
            }
          } else {
            LOG.error('STATE_CACHE_LARGE', `Chunk mancante/scaduto durante recupero: ${chunkKey}. Dati incompleti o persi.`);
            return [];
          }
        }
        LOG.debug('STATE_CACHE_LARGE', `Recuperati ${combinedArray.length} elementi da ${numChunks} chunk(s) per ${baseKey}.`);
        return combinedArray;

      } catch (e) {
        LOG.error('STATE_CACHE_LARGE', `Errore during getAll da CacheService per ${baseKey}.`, { error: e.message });
        return [];
      }
    },

    clearLargeJSON(baseKey, numChunks) {
      const chunksToTry = (Number.isInteger(numChunks) && numChunks > 0) ? numChunks + 50 : 100;
      const keys = Array.from({ length: chunksToTry }, (_, i) => `${baseKey}_${i}`);
      try {
          CACHE.removeAll(keys);
          LOG.debug('STATE_CACHE_CLEAR', `Tentativo rimozione ${keys.length} chunk(s) per ${baseKey}.`);
      }
      catch (e) { LOG.warn('STATE_CACHE_CLEAR', `Errore (potrebbe essere normale) durante pulizia cache per ${baseKey}.`, { error: e.message }); }
    }
  };

  return { ...standard, cache: cache };
})();

// Registra STATE nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('STATE', ['LOG']);
}

// Registra STATE nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('STATE', STATE);
}