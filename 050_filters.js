// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 50_filters.js
// VERSIONE: 25.0 (Filter Engine)
// DESCRIZIONE: Gestore robusto per i filtri manuali dell'interfaccia utente.
// NOTA: Richiede FilterDialog.html
// =============================================================

const FILTERS = (function () {

  // ---------------------- UI ----------------------

  // Apre la dialog box per il filtro manuale
  function applyManualDialog(sheetName) {
    const sh = SHEETS.get(sheetName);
    if (!sh) {
      SpreadsheetApp.getUi().alert(`Foglio '${sheetName}' non trovato.`);
      return;
    }
    const headerRow = SHEETS._findHeaderRow(sh, sheetName);
    if (sh.getLastRow() <= headerRow) {
      SpreadsheetApp.getUi().alert(`Nessun dato da filtrare nel foglio '${sheetName}'.`);
      return;
    }

    const lastCol = sh.getLastColumn();
    let headers = [];
    try {
      headers = lastCol > 0 ? sh.getRange(headerRow, 1, 1, lastCol).getValues()[0].map(h => String(h ?? '').trim()).filter(Boolean) : [];
    } catch (e) {
      LOG?.error('FILTERS_DIALOG', `Lettura intestazioni fallita per '${sheetName}'.`, { error: e.message });
    }

    if (headers.length === 0) {
      SpreadsheetApp.getUi().alert(`Il foglio '${sheetName}' non ha intestazioni valide.`);
      return;
    }

    try {
      const htmlTemplate = HtmlService.createTemplateFromFile('FilterDialog');
      htmlTemplate.sheetName = sheetName;
      htmlTemplate.headers = headers;
      const htmlOutput = htmlTemplate
        .evaluate()
        .setWidth(420)
        .setHeight(300)
        .setSandboxMode(HtmlService.SandboxMode.IFRAME);
      SpreadsheetApp.getUi().showModalDialog(htmlOutput, `Filtro Manuale • ${sheetName}`);
    } catch (e) {
      LOG?.error('FILTERS_DIALOG', 'Errore apertura dialog filtro. (FilterDialog.html mancante?)', { error: e.message, stack: e.stack });
      SpreadsheetApp.getUi().alert('Errore', `Impossibile aprire il pannello filtri (File HTML mancante?): ${e.message}`);
    }
  }

  // ---------------------- Public API ----------------------

  // Rimuove i filtri ed eventualmente ricrea un filtro “vuoto” sull’area dati
  function clearFilter(sheetName) {
    try {
      const sh = SHEETS.get(sheetName);
      if (!sh) return;

      const f = sh.getFilter();
      if (f) f.remove();

      // Ricrea filtro pulito sull’area dati (se presente)
      const range = _getFilterRange(sh, sheetName);
      if (range) {
        try { range.createFilter(); }
        catch (e) { LOG?.warn('FILTERS_CLEAR', `Impossibile ricreare il filtro su ${sheetName}`, { error: e.message }); }
      }
      UTIL.showToast(`Filtri rimossi da '${sheetName}'.`, 'Filtri');
    } catch (e) {
      LOG?.error('FILTERS_CLEAR', `Impossibile rimuovere filtro su ${sheetName}`, { error: e.message, stack: e.stack });
      throw e;
    }
  }

  // Applica un filtro su colonna e valore con parsing “smart” dell’espressione
  function runManualFilter(colName, filterValue, sheetName) {
    const sh = SHEETS.get(sheetName);
    if (!sh) throw new Error(`Foglio '${sheetName}' non trovato.`);

    const idx = SHEETS.headerIndex(sheetName, true);
    const safeColName = String(colName ?? '').replace(/ /g, '_');
    const colIndex = idx[safeColName];
    if (colIndex === undefined) {
      throw new Error(`Colonna '${colName}' (key: ${safeColName}) non trovata in '${sheetName}'.`);
    }

    _applyFilterSmart(sh, sheetName, colIndex + 1, filterValue);
    UTIL.showToast(`Filtro applicato.`, 'Filtri');
  }

  // ---------------------- Core ----------------------

  /**
   * Crea/ricrea il filtro sull’area dati e applica i criteri in base al tipo di valore.
   * Supporta:
   * - Testo: "abc" (contains), "=abc" (equals)
   * - Numero: >, >=, <, <=, =  (es. ">= 10"), range "10..20"
   * - Data: "YYYY-MM-DD" o "DD/MM/YYYY"; range "2024-01-01..2024-01-31" o "01/01/2024..31/01/2024"
   */
  function _applyFilterSmart(sheet, sheetName, colIndex, rawValue) {
    try {
      const range = _getFilterRange(sheet, sheetName);
      if (!range) return;

      // Ricrea sempre il filtro “pulito” sull’area attiva
      const oldFilter = range.getFilter();
      if (oldFilter) oldFilter.remove();
      const filter = range.createFilter();

      const expr = _parseExpression(String(rawValue ?? '').trim());
      if (!expr) return; // filtro vuoto

      const b = SpreadsheetApp.newFilterCriteria();

      switch (expr.type) {
        case 'textEquals':
          filter.setColumnFilterCriteria(colIndex, b.whenTextEqualTo(expr.value).build());
          break;

        case 'textContains':
          filter.setColumnFilterCriteria(colIndex, b.whenTextContains(expr.value).build());
          break;

        case 'number':
          _applyNumberComparator(filter, colIndex, b, expr.op, expr.value);
          break;

        case 'numberRange':
          filter.setColumnFilterCriteria(colIndex, b.whenNumberBetween(expr.start, expr.end).build());
          break;

        case 'date':
          // Per la data singola applichiamo un "between" sull'intera giornata
          const s = _startOfDay(expr.value);
          const e = _endOfDay(expr.value);
          filter.setColumnFilterCriteria(colIndex, b.whenDateBetween(s, e).build());
          break;

        case 'dateRange':
          const sR = _startOfDay(expr.start);
          const eR = _endOfDay(expr.end);
          filter.setColumnFilterCriteria(colIndex, b.whenDateBetween(sR, eR).build());
          break;

        default:
          // fallback: contains testuale
          filter.setColumnFilterCriteria(colIndex, b.whenTextContains(String(rawValue)).build());
      }
    } catch (e) {
      LOG?.error('FILTERS_APPLY', 'Impossibile applicare criterio di filtro.', { error: e.message, stack: e.stack, colIndex, rawValue });
      throw new Error(`Impossibile applicare filtro: ${e.message}`);
    }
  }

  // Determina l’area corretta da filtrare (dalla riga header all’ultima riga/colonna con dati)
  function _getFilterRange(sh, sheetName) {
    const headerRow = SHEETS._findHeaderRow(sh, sheetName);
    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < headerRow || lastCol === 0) return null;
    return sh.getRange(headerRow, 1, lastRow - headerRow + 1, lastCol);
  }

  // ---------------------- Parsing ----------------------

  /**
   * Parser espressione filtro.
   * Ritorna un oggetto:
   * - {type:'textContains', value}
   * - {type:'textEquals',   value}
   * - {type:'number', op:'> | >= | < | <= | =', value:Number}
   * - {type:'numberRange', start:Number, end:Number}
   * - {type:'date', value:Date}
   * - {type:'dateRange', start:Date, end:Date}
   */
  function _parseExpression(s) {
    if (!s) return null;

    // Range (..)
    if (s.includes('..')) {
      const [a, b] = s.split('..').map(t => t.trim());
      const da = _parseDateAny(a), db = _parseDateAny(b);
      if (da && db) return { type: 'dateRange', start: da, end: db };

      const na = _parseNumberStrict(a), nb = _parseNumberStrict(b);
      if (na != null && nb != null) {
        const [start, end] = na <= nb ? [na, nb] : [nb, na];
        return { type: 'numberRange', start, end };
      }
      // fallback testuale contiene “..”
      return { type: 'textContains', value: s };
    }

    // Comparators numerici
    const m = s.match(/^([<>]=?|=)\s*(.+)$/);
    if (m) {
      const op = m[1];
      const rhs = m[2].trim();

      // numero
      const n = _parseNumberStrict(rhs);
      if (n != null) return { type: 'number', op, value: n };

      // data: supporto solo "=" come data singola
      const d = _parseDateAny(rhs);
      if (d && op === '=') return { type: 'date', value: d };

      // fallback testuale con "=" => equals
      if (op === '=') return { type: 'textEquals', value: rhs };
      return { type: 'textContains', value: s };
    }

    // data singola
    const dOnly = _parseDateAny(s);
    if (dOnly) return { type: 'date', value: dOnly };

    // numero semplice => equals
    const nOnly = _parseNumberStrict(s);
    if (nOnly != null) return { type: 'number', op: '=', value: nOnly };

    // testo: "=" prefisso => equals
    if (s.startsWith('=')) return { type: 'textEquals', value: s.substring(1).trim() };

    // default: contains
    return { type: 'textContains', value: s };
  }

  // Numero “strict”: accetta "123", "123.45", "123,45" (stile IT/EN); rifiuta se misto con lettere
  function _parseNumberStrict(x) {
    const t = String(x ?? '').trim();
    if (!/^[-+]?\d+(?:[.,]\d+)?$/.test(t)) return null;
    const num = parseFloat(t.replace(',', '.'));
    return Number.isFinite(num) ? num : null;
  }

  // Date: YYYY-MM-DD o DD/MM/YYYY
  function _parseDateAny(x) {
    const t = String(x ?? '').trim();
    // ISO
    const mIso = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (mIso) {
      const y = +mIso[1], m = +mIso[2] - 1, d = +mIso[3];
      const dt = new Date(y, m, d);
      return _isValidDate(dt, y, m, d) ? dt : null;
    }
    // IT
    const mIt = t.match(/^(\d{2})[\/\-](\d{2})[\/\-](\d{4})$/);
    if (mIt) {
      const d = +mIt[1], m = +mIt[2] - 1, y = +mIt[3];
      const dt = new Date(y, m, d);
      return _isValidDate(dt, y, m, d) ? dt : null;
    }
    return null;
  }

  function _isValidDate(dt, y, m, d) {
    return dt instanceof Date && !isNaN(dt.getTime()) &&
           dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
  }
  function _startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function _endOfDay(d)   { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59); }

  // Applica un confronto numerico con le API di FilterCriteria
  function _applyNumberComparator(filter, colIndex, builder, op, value) {
    switch (op) {
      case '>':  filter.setColumnFilterCriteria(colIndex, builder.whenNumberGreaterThan(value).build()); break;
      case '>=': filter.setColumnFilterCriteria(colIndex, builder.whenNumberGreaterThanOrEqualTo(value).build()); break;
      case '<':  filter.setColumnFilterCriteria(colIndex, builder.whenNumberLessThan(value).build()); break;
      case '<=': filter.setColumnFilterCriteria(colIndex, builder.whenNumberLessThanOrEqualTo(value).build()); break;
      case '=':
      default:   filter.setColumnFilterCriteria(colIndex, builder.whenNumberEqualTo(value).build()); break;
    }
  }

  // ---------------------- Exports ----------------------
  return {
    applyManualDialog,
    clearFilter,
    runManualFilter
  };
})();

// Registra FILTERS nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('FILTERS', ['SHEETS']);
}

// Registra FILTERS nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('FILTERS', FILTERS);
}

/**
 * Wrapper globale richiesto da HtmlService per la dialog box.
 * Ritorna { success, error? } alla pagina HTML.
 */
function runManualFilter(colName, filterValue, sheetName) {
  try {
    FILTERS.runManualFilter(colName, filterValue, sheetName);
    return { success: true };
  } catch (e) {
    LOG?.error('FILTERS_WRAPPER', 'Fallita esecuzione filtro da UI.', { error: e.message });
    return { success: false, error: e.message };
  }
}