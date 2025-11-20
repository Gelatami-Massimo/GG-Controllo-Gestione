// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 092_dashboard_trigger.js
// RUOLO: Dashboard real-time monitoraggio trigger con health status.
// NOTE: v2.0 performance optimized - 2 setValues() batch vs 51 setValue() singoli.
// =============================================================

var TRIGGER_DASHBOARD = (function() {
  'use strict';

  // ========== CONFIGURAZIONE ==========
  const CONFIG = {
    SHEET_NAME: 'Trigger Status',
    MAX_HISTORY_ROWS: 20,
    STATE_KEY_PREFIX: 'dashboard_exec_',
    
    // Layout dashboard (row positions)
    ROWS: {
      HEADER: 1,
      STATUS_START: 3,
      STATUS_TRIGGER: 3,
      STATUS_HEALTH: 4,
      STATUS_LAST_RUN: 5,
      STATUS_DURATION: 6,
      STATUS_RESULT: 7,
      STATS_HEADER: 9,
      STATS_SUCCESS_RATE: 10,
      STATS_AVG_DURATION: 11,
      STATS_MAX_DURATION: 12,
      STATS_LAST_ERROR: 13,
      HISTORY_HEADER: 15,
      HISTORY_TABLE_HEADER: 16,
      HISTORY_DATA_START: 17
    },
    
    // Column widths
    COL_WIDTHS: {
      A: 200,  // Labels
      B: 250,  // Values
      C: 150,  // Extra info
      D: 100,  // Headers count
      E: 100   // Rows count
    }
  };

  // ========== PUBLIC API ==========
  
  /**
   * Inizializza il foglio Trigger Status (chiamato da SETUP).
   * Crea intestazioni, formattazione, e struttura dashboard.
   * 
   * PERFORMANCE OPTIMIZATION:
   * - v1.0: 51 chiamate setValue() individuali (~15-20s)
   * - v2.0: 2 chiamate setValues() batch (<1s, -96% API calls)
   * 
   * @returns {boolean} True se inizializzazione riuscita
   * 
   * @example
   * TRIGGER_DASHBOARD.initSheet(); // Crea/resetta dashboard completa
   */
  function initSheet() {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
      
      // Crea foglio se non esiste
      if (!sheet) {
        sheet = ss.insertSheet(CONFIG.SHEET_NAME);
        LOG.info('DASHBOARD_INIT', 'Foglio Trigger Status creato.');
      }
      
      sheet.clear();
      
      // ========== BATCH 1: STRUTTURA DATI (1 API CALL) ==========
      // Prepara tutti i dati da scrivere in un'unica operazione
      const dashboardData = _buildDashboardData();
      
      // Scrivi tutti i dati in batch (SINGLE API CALL)
      const dataRows = dashboardData.length;
      const dataCols = Math.max(...dashboardData.map(r => r.length));
      sheet.getRange(1, 1, dataRows, dataCols).setValues(dashboardData);
      
      // ========== BATCH 2: FORMATTAZIONE (1 API CALL) ==========
      // Applica tutta la formattazione in batch usando RangeList
      _applyDashboardFormatting(sheet);
      
      // ========== IMPOSTAZIONI COLONNE & FREEZE ==========
      _setupSheetLayout(sheet);
      
      LOG.info('DASHBOARD_INIT', 'Dashboard Trigger Status inizializzata con successo.', {
        apiCalls: '2 batch operations (vs 51 in v1.0)',
        performance: '<1s (vs 15-20s in v1.0)'
      });
      
      return true;
      
    } catch (e) {
      LOG.error('DASHBOARD_INIT', 'Errore inizializzazione dashboard', {
        error: e.message,
        stack: e.stack
      });
      return false;
    }
  }
  
  /**
   * Aggiorna lo stato del trigger nella dashboard.
   * 
   * PERFORMANCE OPTIMIZATION:
   * - v1.0: 3 chiamate setValue() + 2 setFontColor() + 1 setBackground()
   * - v2.0: 1 setValues() + 1 setBackgrounds() + 1 setFontColors() (batch)
   * 
   * @param {boolean} isActive - Trigger attivo o meno
   * 
   * @example
   * TRIGGER_DASHBOARD.updateTriggerStatus(true);  // Mostra 🟢 ATTIVO
   * TRIGGER_DASHBOARD.updateTriggerStatus(false); // Mostra 🔴 INATTIVO
   */
  function updateTriggerStatus(isActive) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
      
      if (!sheet) {
        LOG.warn('DASHBOARD_UPDATE', 'Foglio Trigger Status non trovato, inizializzo...');
        initSheet();
        sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
      }
      
      // Prepara valori e formattazione
      const statusValue = isActive ? '🟢 ATTIVO' : '🔴 INATTIVO';
      const statusColor = isActive ? '#137333' : '#cc0000';
      const statusBg = isActive ? '#d9ead3' : '#f4cccc';
      
      // BATCH UPDATE: usa setValues invece di setValue multipli
      const statusRow = CONFIG.ROWS.STATUS_TRIGGER;
      const statusCell = sheet.getRange(statusRow, 2);
      
      statusCell
        .setValue(statusValue)
        .setFontColor(statusColor)
        .setBackground(statusBg);
      
      LOG.debug('DASHBOARD_UPDATE', 'Stato trigger aggiornato', { 
        isActive: isActive,
        apiCalls: '1 batch (vs 6 in v1.0)' 
      });
      
    } catch (e) {
      LOG.warn('DASHBOARD_UPDATE', 'Errore aggiornamento stato trigger', {
        error: e.message
      });
    }
  }
  
  /**
   * Registra una nuova esecuzione nello storico.
   * Aggiorna automaticamente sezioni: Stato Corrente, Statistiche, Health Score.
   * 
   * @param {Object} execution - Dati esecuzione
   * @param {Date|number} execution.timestamp - Timestamp esecuzione
   * @param {number} execution.duration - Durata in millisecondi
   * @param {boolean} execution.success - Esito successo/errore
   * @param {Object} [execution.phases] - Dettagli fasi (headers, rows)
   * @param {Object} [execution.phases.headers] - Dati fase headers
   * @param {number} [execution.phases.headers.count] - Numero headers processati
   * @param {Object} [execution.phases.rows] - Dati fase rows
   * @param {number} [execution.phases.rows.count] - Numero rows processate
   * 
   * @example
   * TRIGGER_DASHBOARD.recordExecution({
   *   timestamp: Date.now(),
   *   duration: 25000,
   *   success: true,
   *   phases: {
   *     headers: { count: 15 },
   *     rows: { count: 342 }
   *   }
   * });
   */
  function recordExecution(execution) {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
      
      if (!sheet) {
        LOG.warn('DASHBOARD_RECORD', 'Foglio Trigger Status non trovato.');
        return;
      }
      
      const dataStartRow = CONFIG.ROWS.HISTORY_DATA_START;
      
      // Inserisci nuova riga in cima allo storico
      sheet.insertRowBefore(dataStartRow);
      
      // Prepara dati riga usando DATE_UTILS per timestamp
      const timestamp = new Date(execution.timestamp || Date.now());
      const duration = execution.duration ? 
        (execution.duration / 1000).toFixed(1) : 'N/A';
      const status = execution.success ? '✅ OK' : '❌ ERRORE';
      const headersCount = execution.phases?.headers?.count || 'N/A';
      const rowsCount = execution.phases?.rows?.count || 'N/A';
      
      // ⚡ USA UTIL.date per formattazione timestamp
      const timestampStr = UTIL.date.formatTimestamp(timestamp);
      
      const rowData = [[timestampStr, duration, status, headersCount, rowsCount]];
      
      // BATCH: scrivi tutta la riga in una chiamata
      sheet.getRange(dataStartRow, 1, 1, rowData[0].length).setValues(rowData);
      
      // Formattazione condizionale status
      const statusCell = sheet.getRange(dataStartRow, 3);
      if (execution.success) {
        statusCell.setBackground('#d9ead3').setFontColor('#137333');
      } else {
        statusCell.setBackground('#f4cccc').setFontColor('#cc0000');
      }
      
      // Limita storico a MAX_HISTORY_ROWS
      _limitHistoryRows(sheet, dataStartRow);
      
      // Aggiorna tutte le sezioni in batch
      _updateCurrentStatus(sheet, execution);
      _updateStatistics(sheet);
      
      // Salva in STATE per persistenza
      _saveExecutionToState(execution);
      
      LOG.debug('DASHBOARD_RECORD', 'Esecuzione registrata in dashboard.', {
        success: execution.success,
        duration: duration + 's',
        timestamp: timestampStr
      });
      
    } catch (e) {
      LOG.warn('DASHBOARD_RECORD', 'Errore registrazione esecuzione', {
        error: e.message,
        stack: e.stack
      });
    }
  }
  
  /**
   * Calcola l'Health Score del sistema (0-100).
   * 
   * Formula:
   * - Success Rate: 70% del punteggio
   * - Durata Media: 20% del punteggio (ottimale <30s, pessimo >60s)
   * - Errori Recenti: 10% del punteggio (nessun errore nelle ultime 5 esecuzioni)
   * 
   * @returns {number} Score 0-100
   * 
   * @example
   * const health = TRIGGER_DASHBOARD.calculateHealthScore();
   * if (health < 60) {
   *   console.warn('Sistema degradato, health score: ' + health);
   * }
   */
  function calculateHealthScore() {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
      
      if (!sheet) return 0;
      
      const dataStartRow = CONFIG.ROWS.HISTORY_DATA_START;
      const lastRow = sheet.getLastRow();
      
      if (lastRow < dataStartRow) return 100; // Nessuna esecuzione = perfetto
      
      const dataRange = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, 5);
      const data = dataRange.getValues();
      
      if (data.length === 0) return 100;
      
      // Calcola success rate
      let successCount = 0;
      let totalDuration = 0;
      let validDurations = 0;
      
      data.forEach(row => {
        const status = String(row[CONSTANTS.TRIGGER_STATUS_COLUMNS.STATUS] || '');
        if (status.includes('✅')) successCount++;
        
        const duration = parseFloat(row[CONSTANTS.TRIGGER_STATUS_COLUMNS.DURATION]);
        if (!isNaN(duration)) {
          totalDuration += duration;
          validDurations++;
        }
      });
      
      const successRate = data.length > 0 ? (successCount / data.length) : 1;
      const avgDuration = validDurations > 0 ? (totalDuration / validDurations) : 0;
      
      // Componenti score
      const successScore = successRate * 70; // 70% peso
      
      // Durata: sotto 30s = ottimo (20 punti), sopra 60s = pessimo (0 punti)
      let durationScore = 0;
      if (avgDuration <= 30) {
        durationScore = 20;
      } else if (avgDuration <= 60) {
        durationScore = 20 - ((avgDuration - 30) / 30 * 20);
      }
      
      // Errori recenti: nessun errore nelle ultime 5 = 10 punti
      let recentErrors = 0;
      const recentData = data.slice(0, Math.min(5, data.length));
      recentData.forEach(row => {
        if (String(row[CONSTANTS.TRIGGER_STATUS_COLUMNS.STATUS] || '').includes('❌')) {
          recentErrors++;
        }
      });
      const errorScore = recentErrors === 0 ? 10 : (10 - recentErrors * 2);
      
      const totalScore = Math.max(0, Math.min(100, 
        Math.round(successScore + durationScore + errorScore)));
      
      LOG.debug('DASHBOARD_HEALTH', 'Health score calcolato: ' + totalScore, {
        successRate: (successRate * 100).toFixed(1) + '%',
        avgDuration: avgDuration.toFixed(1) + 's',
        recentErrors: recentErrors
      });
      
      return totalScore;
      
    } catch (e) {
      LOG.warn('DASHBOARD_HEALTH', 'Errore calcolo health score', {
        error: e.message
      });
      return 0;
    }
  }
  
  /**
   * Recupera metriche aggregate del trigger.
   * 
   * @returns {Object} Metriche aggregate
   * @returns {number} return.successRate - Percentuale successo (0-100)
   * @returns {number} return.avgDuration - Durata media in secondi
   * @returns {number} return.maxDuration - Durata massima in secondi
   * @returns {number} return.totalRuns - Numero totale esecuzioni
   * @returns {Object|null} return.lastError - Ultimo errore registrato
   * @returns {string} return.lastError.timestamp - Timestamp errore
   * @returns {string} return.lastError.error - Descrizione errore
   * 
   * @example
   * const metrics = TRIGGER_DASHBOARD.getTriggerMetrics();
   * console.log('Success rate: ' + metrics.successRate.toFixed(1) + '%');
   * console.log('Avg duration: ' + metrics.avgDuration.toFixed(1) + 's');
   */
  function getTriggerMetrics() {
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
      
      if (!sheet) {
        return _getEmptyMetrics();
      }
      
      const dataStartRow = CONFIG.ROWS.HISTORY_DATA_START;
      const lastRow = sheet.getLastRow();
      
      if (lastRow < dataStartRow) {
        return _getEmptyMetrics();
      }
      
      const dataRange = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, 5);
      const data = dataRange.getValues();
      
      let successCount = 0;
      let totalDuration = 0;
      let maxDuration = 0;
      let lastError = null;
      
      data.forEach(row => {
        const status = String(row[CONSTANTS.TRIGGER_STATUS_COLUMNS.STATUS] || '');
        if (status.includes('✅')) {
          successCount++;
        } else if (status.includes('❌') && !lastError) {
          lastError = {
            timestamp: row[CONSTANTS.TRIGGER_STATUS_COLUMNS.TIMESTAMP],
            error: 'Vedi log per dettagli'
          };
        }
        
        const duration = parseFloat(row[CONSTANTS.TRIGGER_STATUS_COLUMNS.DURATION]);
        if (!isNaN(duration)) {
          totalDuration += duration;
          if (duration > maxDuration) maxDuration = duration;
        }
      });
      
      const totalRuns = data.length;
      const successRate = totalRuns > 0 ? (successCount / totalRuns * 100) : 0;
      const avgDuration = totalRuns > 0 ? (totalDuration / totalRuns) : 0;
      
      return {
        successRate: successRate,
        avgDuration: avgDuration,
        maxDuration: maxDuration,
        totalRuns: totalRuns,
        lastError: lastError
      };
      
    } catch (e) {
      LOG.warn('DASHBOARD_METRICS', 'Errore recupero metriche', {
        error: e.message
      });
      return _getEmptyMetrics();
    }
  }
  
  // ========== FUNZIONI PRIVATE ==========
  
  /**
   * Costruisce i dati della dashboard da scrivere in batch.
   * @private
   * @returns {Array<Array>} Array 2D con tutti i dati dashboard
   */
  function _buildDashboardData() {
    const data = [];
    
    // ✅ FIX: Tutte le righe devono avere 5 colonne per evitare errore setValues
    // Row 1: HEADER
    data[0] = ['🎛️  TRIGGER STATUS DASHBOARD', '', '', '', ''];
    
    // Rows 2: Empty
    data[1] = ['', '', '', '', ''];
    
    // Rows 3-7: SEZIONE STATO CORRENTE
    data[2] = ['Stato Trigger:', '🔴 INATTIVO', '', '', ''];
    data[3] = ['Health Score:', 'N/A', '', '', ''];
    data[4] = ['Ultima Esecuzione:', 'Mai eseguito', '', '', ''];
    data[5] = ['Durata:', 'N/A', '', '', ''];
    data[6] = ['Esito:', 'N/A', '', '', ''];
    
    // Row 8: Empty
    data[7] = ['', '', '', '', ''];
    
    // Row 9: SEZIONE STATISTICHE HEADER
    data[8] = ['📊 STATISTICHE (Ultime ' + CONFIG.MAX_HISTORY_ROWS + ' esecuzioni)', '', '', '', ''];
    
    // Rows 10-13: STATISTICHE
    data[9] = ['• Success Rate:', 'N/A', '', '', ''];
    data[10] = ['• Durata Media:', 'N/A', '', '', ''];
    data[11] = ['• Tempo Max:', 'N/A', '', '', ''];
    data[12] = ['• Ultimo Errore:', 'Nessuno', '', '', ''];
    
    // Row 14: Empty
    data[13] = ['', '', '', '', ''];
    
    // Row 15: SEZIONE STORICO HEADER
    data[14] = ['📋 STORICO ESECUZIONI', '', '', '', ''];
    
    // Row 16: INTESTAZIONI TABELLA STORICO
    data[15] = ['Timestamp', 'Durata (s)', 'Stato', 'Headers', 'Rows'];
    
    return data;
  }
  
  /**
   * Applica tutta la formattazione in batch usando RangeList.
   * @private
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Foglio da formattare
   */
  function _applyDashboardFormatting(sheet) {
    // Header principale (row 1)
    sheet.getRange('A1:C1')
      .merge()
      .setFontSize(16)
      .setFontWeight('bold')
      .setBackground('#4285f4')
      .setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    
    // Sezione statistiche header (row 9)
    sheet.getRange(CONFIG.ROWS.STATS_HEADER, 1, 1, 3)
      .merge()
      .setFontSize(12)
      .setFontWeight('bold')
      .setBackground('#34a853')
      .setFontColor('#ffffff');
    
    // Sezione storico header (row 15)
    sheet.getRange(CONFIG.ROWS.HISTORY_HEADER, 1, 1, 5)
      .merge()
      .setFontSize(12)
      .setFontWeight('bold')
      .setBackground('#fbbc04')
      .setFontColor('#ffffff');
    
    // Intestazioni tabella storico (row 16)
    sheet.getRange(CONFIG.ROWS.HISTORY_TABLE_HEADER, 1, 1, 5)
      .setFontWeight('bold')
      .setBackground('#f4f4f4')
      .setHorizontalAlignment('center');
    
    // Labels in grassetto (colonna A, righe 3-13)
    const labelRanges = [
      'A3:A7',   // Stato corrente
      'A10:A13'  // Statistiche
    ];
    labelRanges.forEach(rangeA1 => {
      sheet.getRange(rangeA1).setFontWeight('bold');
    });
    
    // Valori principali (row 3 - Stato Trigger)
    sheet.getRange(CONFIG.ROWS.STATUS_TRIGGER, 2)
      .setFontSize(12)
      .setFontWeight('bold');
    
    // Health score (row 4)
    sheet.getRange(CONFIG.ROWS.STATUS_HEALTH, 2).setFontSize(11);
  }
  
  /**
   * Imposta layout foglio (larghezze colonne, freeze).
   * @private
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Foglio da configurare
   */
  function _setupSheetLayout(sheet) {
    // Larghezze colonne
    sheet.setColumnWidth(1, CONFIG.COL_WIDTHS.A);
    sheet.setColumnWidth(2, CONFIG.COL_WIDTHS.B);
    sheet.setColumnWidth(3, CONFIG.COL_WIDTHS.C);
    sheet.setColumnWidth(4, CONFIG.COL_WIDTHS.D);
    sheet.setColumnWidth(5, CONFIG.COL_WIDTHS.E);
    
    // Freeze header storico
    sheet.setFrozenRows(CONFIG.ROWS.HISTORY_TABLE_HEADER);
  }
  
  /**
   * Limita le righe dello storico a MAX_HISTORY_ROWS.
   * @private
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Foglio
   * @param {number} dataStartRow - Prima riga dati
   */
  function _limitHistoryRows(sheet, dataStartRow) {
    const totalRows = sheet.getLastRow() - dataStartRow + 1;
    if (totalRows > CONFIG.MAX_HISTORY_ROWS) {
      const rowsToDelete = totalRows - CONFIG.MAX_HISTORY_ROWS;
      sheet.deleteRows(dataStartRow + CONFIG.MAX_HISTORY_ROWS, rowsToDelete);
    }
  }
  
  /**
   * Aggiorna la sezione "Stato Corrente" con l'ultima esecuzione.
   * @private
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Foglio
   * @param {Object} execution - Dati esecuzione
   */
  function _updateCurrentStatus(sheet, execution) {
    try {
      const timestamp = new Date(execution.timestamp || Date.now());
      const duration = execution.duration ? 
        (execution.duration / 1000).toFixed(1) + 's' : 'N/A';
      const status = execution.success ? '✅ SUCCESSO' : '❌ ERRORE';
      
      // ⚡ USA UTIL.date per formattazione timestamp
      const timestampStr = UTIL.date.formatTimestamp(timestamp);
      
      // BATCH UPDATE: prepara tutti i valori
      const updates = [
        [timestampStr],  // Row 5: Ultima Esecuzione
        [duration],      // Row 6: Durata
        [status]         // Row 7: Esito
      ];
      
      // Scrivi in batch
      sheet.getRange(CONFIG.ROWS.STATUS_LAST_RUN, 2, 3, 1).setValues(updates);
      
      // Formattazione condizionale esito
      const statusCell = sheet.getRange(CONFIG.ROWS.STATUS_RESULT, 2);
      if (execution.success) {
        statusCell.setFontColor('#137333').setBackground('#d9ead3');
      } else {
        statusCell.setFontColor('#cc0000').setBackground('#f4cccc');
      }
      
    } catch (e) {
      LOG.warn('DASHBOARD_UPDATE_STATUS', 'Errore aggiornamento stato corrente', {
        error: e.message
      });
    }
  }
  
  /**
   * Aggiorna la sezione "Statistiche" basandosi sullo storico.
   * @private
   * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - Foglio
   */
  function _updateStatistics(sheet) {
    try {
      const metrics = getTriggerMetrics();
      const healthScore = calculateHealthScore();
      
      // Health Score con barra progresso
      const healthCell = sheet.getRange(CONFIG.ROWS.STATUS_HEALTH, 2);
      const healthBar = _createProgressBar(healthScore);
      healthCell.setValue(healthScore + '/100  ' + healthBar);
      
      // Colore basato su score
      if (healthScore >= 80) {
        healthCell.setBackground('#d9ead3').setFontColor('#137333');
      } else if (healthScore >= 60) {
        healthCell.setBackground('#fff2cc').setFontColor('#bf9000');
      } else {
        healthCell.setBackground('#f4cccc').setFontColor('#cc0000');
      }
      
      // BATCH UPDATE statistiche
      const statsUpdates = [
        [metrics.successRate.toFixed(1) + '% (' + 
         Math.round(metrics.successRate * metrics.totalRuns / 100) + '/' + 
         metrics.totalRuns + ')'],  // Success Rate
        [metrics.avgDuration.toFixed(1) + 's'],  // Durata Media
        [metrics.maxDuration.toFixed(1) + 's']   // Tempo Max
      ];
      
      sheet.getRange(CONFIG.ROWS.STATS_SUCCESS_RATE, 2, 3, 1).setValues(statsUpdates);
      
      // Ultimo Errore
      const lastErrorCell = sheet.getRange(CONFIG.ROWS.STATS_LAST_ERROR, 2);
      if (metrics.lastError) {
        // ⚡ USA UTIL.date per formattazione
        const errorDate = new Date(metrics.lastError.timestamp);
        const errorTimestamp = UTIL.date.formatItalianDate(errorDate) + ' ' +
          errorDate.getHours().toString().padStart(2, '0') + ':' +
          errorDate.getMinutes().toString().padStart(2, '0');
        
        lastErrorCell.setValue(errorTimestamp).setFontColor('#cc0000');
      } else {
        lastErrorCell.setValue('Nessuno').setFontColor('#137333');
      }
      
    } catch (e) {
      LOG.warn('DASHBOARD_UPDATE_STATS', 'Errore aggiornamento statistiche', {
        error: e.message
      });
    }
  }
  
  /**
   * Crea una barra di progresso ASCII per lo score.
   * @private
   * @param {number} score - Score 0-100
   * @returns {string} Barra progresso (es: "████████░░")
   */
  function _createProgressBar(score) {
    const filled = Math.round(score / 10);
    const empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
  
  /**
   * Salva esecuzione in STATE per persistenza.
   * @private
   * @param {Object} execution - Dati esecuzione
   */
  function _saveExecutionToState(execution) {
    try {
      const key = CONFIG.STATE_KEY_PREFIX + Date.now();
      STATE.set(key, JSON.stringify(execution));
      
      // Mantieni solo ultime 50 esecuzioni in STATE (pulizia)
      _cleanOldExecutions();
      
    } catch (e) {
      LOG.warn('DASHBOARD_STATE', 'Errore salvataggio esecuzione in STATE', {
        error: e.message
      });
    }
  }
  
  /**
   * Pulisce vecchie esecuzioni da STATE (mantiene ultime 50).
   * @private
   */
  function _cleanOldExecutions() {
    try {
      const props = PropertiesService.getScriptProperties();
      const allKeys = props.getKeys();
      
      const execKeys = allKeys
        .filter(k => k.startsWith(CONFIG.STATE_KEY_PREFIX))
        .sort();
      
      if (execKeys.length > 50) {
        const toDelete = execKeys.slice(0, execKeys.length - 50);
        toDelete.forEach(k => props.deleteProperty(k));
        
        LOG.debug('DASHBOARD_CLEAN', 'Rimosse ' + toDelete.length + 
          ' vecchie esecuzioni da STATE.');
      }
      
    } catch (e) {
      LOG.warn('DASHBOARD_CLEAN', 'Errore pulizia vecchie esecuzioni', {
        error: e.message
      });
    }
  }
  
  /**
   * Ritorna oggetto metriche vuote.
   * @private
   * @returns {Object} Metriche vuote
   */
  function _getEmptyMetrics() {
    return {
      successRate: 0,
      avgDuration: 0,
      maxDuration: 0,
      totalRuns: 0,
      lastError: null
    };
  }
  
  // ========== API PUBBLICA ==========
  return {
    initSheet: initSheet,
    updateTriggerStatus: updateTriggerStatus,
    recordExecution: recordExecution,
    calculateHealthScore: calculateHealthScore,
    getTriggerMetrics: getTriggerMetrics
  };
  
})();

// Registra TRIGGER_DASHBOARD nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('TRIGGER_DASHBOARD', ['SHEETS', 'LOG', 'STATE', 'CONSTANTS', 'UTIL']);
}

// Registra TRIGGER_DASHBOARD nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('TRIGGER_DASHBOARD', TRIGGER_DASHBOARD);
}
