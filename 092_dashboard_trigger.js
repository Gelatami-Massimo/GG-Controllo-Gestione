// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 092_dashboard_trigger.js
// VERSIONE: 1.0 (Trigger Dashboard & Health Monitoring)
// DESCRIZIONE: Dashboard real-time per monitoraggio trigger e metriche esecuzioni
// =============================================================

var DASHBOARD = (function() {
  'use strict';

  // Configurazione
  var SHEET_NAME = 'Trigger Status';
  var MAX_HISTORY_ROWS = 20; // Storico ultime 20 esecuzioni
  var STATE_KEY_PREFIX = 'dashboard_exec_';
  
  /**
   * Inizializza il foglio Trigger Status (chiamato da SETUP).
   * Crea intestazioni, formattazione, e struttura dashboard.
   */
  function initSheet() {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(SHEET_NAME);
      
      // Crea foglio se non esiste
      if (!sheet) {
        sheet = ss.insertSheet(SHEET_NAME);
        LOG.info('DASHBOARD_INIT', 'Foglio Trigger Status creato.');
      }
      
      sheet.clear();
      
      // ========== SEZIONE HEADER ==========
      sheet.setColumnWidth(1, 200);
      sheet.setColumnWidth(2, 250);
      sheet.setColumnWidth(3, 150);
      
      // Titolo principale
      sheet.getRange('A1:C1').merge()
        .setValue('🎛️  TRIGGER STATUS DASHBOARD')
        .setFontSize(16)
        .setFontWeight('bold')
        .setBackground('#4285f4')
        .setFontColor('#ffffff')
        .setHorizontalAlignment('center');
      
      // ========== SEZIONE STATO CORRENTE ==========
      var currentRow = 3;
      
      // Stato Trigger
      sheet.getRange(currentRow, 1).setValue('Stato Trigger:').setFontWeight('bold');
      sheet.getRange(currentRow, 2).setValue('🔴 INATTIVO')
        .setFontSize(12)
        .setFontWeight('bold');
      currentRow++;
      
      // Health Score
      sheet.getRange(currentRow, 1).setValue('Health Score:').setFontWeight('bold');
      sheet.getRange(currentRow, 2).setValue('N/A')
        .setFontSize(11);
      currentRow++;
      
      // Ultima Esecuzione
      sheet.getRange(currentRow, 1).setValue('Ultima Esecuzione:').setFontWeight('bold');
      sheet.getRange(currentRow, 2).setValue('Mai eseguito');
      currentRow++;
      
      // Durata
      sheet.getRange(currentRow, 1).setValue('Durata:').setFontWeight('bold');
      sheet.getRange(currentRow, 2).setValue('N/A');
      currentRow++;
      
      // Esito
      sheet.getRange(currentRow, 1).setValue('Esito:').setFontWeight('bold');
      sheet.getRange(currentRow, 2).setValue('N/A');
      currentRow += 2;
      
      // ========== SEZIONE STATISTICHE ==========
      sheet.getRange(currentRow, 1, 1, 3).merge()
        .setValue('📊 STATISTICHE (Ultime ' + MAX_HISTORY_ROWS + ' esecuzioni)')
        .setFontSize(12)
        .setFontWeight('bold')
        .setBackground('#34a853')
        .setFontColor('#ffffff');
      currentRow++;
      
      sheet.getRange(currentRow, 1).setValue('• Success Rate:').setFontWeight('bold');
      sheet.getRange(currentRow, 2).setValue('N/A');
      currentRow++;
      
      sheet.getRange(currentRow, 1).setValue('• Durata Media:').setFontWeight('bold');
      sheet.getRange(currentRow, 2).setValue('N/A');
      currentRow++;
      
      sheet.getRange(currentRow, 1).setValue('• Tempo Max:').setFontWeight('bold');
      sheet.getRange(currentRow, 2).setValue('N/A');
      currentRow++;
      
      sheet.getRange(currentRow, 1).setValue('• Ultimo Errore:').setFontWeight('bold');
      sheet.getRange(currentRow, 2).setValue('Nessuno');
      currentRow += 2;
      
      // ========== SEZIONE STORICO ESECUZIONI ==========
      var historyStartRow = currentRow;
      sheet.getRange(historyStartRow, 1, 1, 5).merge()
        .setValue('📋 STORICO ESECUZIONI')
        .setFontSize(12)
        .setFontWeight('bold')
        .setBackground('#fbbc04')
        .setFontColor('#ffffff');
      historyStartRow++;
      
      // Intestazioni tabella storico
      var headers = ['Timestamp', 'Durata (s)', 'Stato', 'Headers', 'Rows'];
      sheet.getRange(historyStartRow, 1, 1, headers.length)
        .setValues([headers])
        .setFontWeight('bold')
        .setBackground('#f4f4f4')
        .setHorizontalAlignment('center');
      
      // Formattazione colonne storico
      sheet.setColumnWidth(1, 180); // Timestamp
      sheet.setColumnWidth(2, 100); // Durata
      sheet.setColumnWidth(3, 100); // Stato
      sheet.setColumnWidth(4, 100); // Headers
      sheet.setColumnWidth(5, 100); // Rows
      
      // Freeze header
      sheet.setFrozenRows(historyStartRow);
      
      LOG.info('DASHBOARD_INIT', 'Dashboard Trigger Status inizializzata con successo.');
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
   * @param {boolean} isActive - Trigger attivo o meno
   */
  function updateTriggerStatus(isActive) {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(SHEET_NAME);
      
      if (!sheet) {
        LOG.warn('DASHBOARD_UPDATE', 'Foglio Trigger Status non trovato, inizializzo...');
        initSheet();
        sheet = ss.getSheetByName(SHEET_NAME);
      }
      
      // Aggiorna riga 3 (Stato Trigger)
      var statusCell = sheet.getRange(3, 2);
      if (isActive) {
        statusCell.setValue('🟢 ATTIVO')
          .setFontColor('#137333')
          .setBackground('#d9ead3');
      } else {
        statusCell.setValue('🔴 INATTIVO')
          .setFontColor('#cc0000')
          .setBackground('#f4cccc');
      }
      
      LOG.debug('DASHBOARD_UPDATE', 'Stato trigger aggiornato: ' + (isActive ? 'ATTIVO' : 'INATTIVO'));
      
    } catch (e) {
      LOG.warn('DASHBOARD_UPDATE', 'Errore aggiornamento stato trigger', {
        error: e.message
      });
    }
  }
  
  /**
   * Registra una nuova esecuzione nello storico.
   * @param {Object} execution - Dati esecuzione: {timestamp, duration, success, phases}
   */
  function recordExecution(execution) {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(SHEET_NAME);
      
      if (!sheet) {
        LOG.warn('DASHBOARD_RECORD', 'Foglio Trigger Status non trovato.');
        return;
      }
      
      // Trova riga di inizio storico (riga con "📋 STORICO ESECUZIONI")
      var historyHeaderRow = _findRowByText(sheet, '📋 STORICO ESECUZIONI');
      if (!historyHeaderRow) {
        LOG.warn('DASHBOARD_RECORD', 'Sezione storico non trovata.');
        return;
      }
      
      var dataStartRow = historyHeaderRow + 2; // Salta intestazione tabella
      
      // Inserisci nuova riga in cima allo storico
      sheet.insertRowBefore(dataStartRow);
      
      // Prepara dati riga
      var timestamp = new Date(execution.timestamp || Date.now());
      var duration = execution.duration ? (execution.duration / 1000).toFixed(1) : 'N/A';
      var status = execution.success ? '✅ OK' : '❌ ERRORE';
      var headersCount = execution.phases && execution.phases.headers ? 
        (execution.phases.headers.count || 'N/A') : 'N/A';
      var rowsCount = execution.phases && execution.phases.rows ? 
        (execution.phases.rows.count || 'N/A') : 'N/A';
      
      var rowData = [
        Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'dd/MM/yy HH:mm:ss'),
        duration,
        status,
        headersCount,
        rowsCount
      ];
      
      sheet.getRange(dataStartRow, 1, 1, rowData.length).setValues([rowData]);
      
      // Formattazione condizionale status
      var statusCell = sheet.getRange(dataStartRow, 3);
      if (execution.success) {
        statusCell.setBackground('#d9ead3').setFontColor('#137333');
      } else {
        statusCell.setBackground('#f4cccc').setFontColor('#cc0000');
      }
      
      // Limita storico a MAX_HISTORY_ROWS
      var totalRows = sheet.getLastRow() - dataStartRow + 1;
      if (totalRows > MAX_HISTORY_ROWS) {
        var rowsToDelete = totalRows - MAX_HISTORY_ROWS;
        sheet.deleteRows(dataStartRow + MAX_HISTORY_ROWS, rowsToDelete);
      }
      
      // Aggiorna sezione "Stato Corrente"
      _updateCurrentStatus(sheet, execution);
      
      // Aggiorna sezione "Statistiche"
      _updateStatistics(sheet);
      
      // Salva in STATE per persistenza
      _saveExecutionToState(execution);
      
      LOG.debug('DASHBOARD_RECORD', 'Esecuzione registrata in dashboard.', {
        success: execution.success,
        duration: duration + 's'
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
   * Basato su: success rate (70%), durata media (20%), errori recenti (10%).
   * @returns {number} Score 0-100
   */
  function calculateHealthScore() {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(SHEET_NAME);
      
      if (!sheet) return 0;
      
      var historyHeaderRow = _findRowByText(sheet, '📋 STORICO ESECUZIONI');
      if (!historyHeaderRow) return 0;
      
      var dataStartRow = historyHeaderRow + 2;
      var lastRow = sheet.getLastRow();
      
      if (lastRow < dataStartRow) return 100; // Nessuna esecuzione = perfetto
      
      var dataRange = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, 5);
      var data = dataRange.getValues();
      
      if (data.length === 0) return 100;
      
      // Calcola success rate
      var successCount = 0;
      var totalDuration = 0;
      var validDurations = 0;
      
      data.forEach(function(row) {
        var status = String(row[2] || '');
        if (status.includes('✅')) successCount++;
        
        var duration = parseFloat(row[1]);
        if (!isNaN(duration)) {
          totalDuration += duration;
          validDurations++;
        }
      });
      
      var successRate = data.length > 0 ? (successCount / data.length) : 1;
      var avgDuration = validDurations > 0 ? (totalDuration / validDurations) : 0;
      
      // Componenti score
      var successScore = successRate * 70; // 70% peso
      
      // Durata: sotto 30s = ottimo (20 punti), sopra 60s = pessimo (0 punti)
      var durationScore = 0;
      if (avgDuration <= 30) {
        durationScore = 20;
      } else if (avgDuration <= 60) {
        durationScore = 20 - ((avgDuration - 30) / 30 * 20);
      }
      
      // Errori recenti: nessun errore nelle ultime 5 = 10 punti
      var recentErrors = 0;
      var recentData = data.slice(0, Math.min(5, data.length));
      recentData.forEach(function(row) {
        if (String(row[2] || '').includes('❌')) recentErrors++;
      });
      var errorScore = recentErrors === 0 ? 10 : (10 - recentErrors * 2);
      
      var totalScore = Math.max(0, Math.min(100, Math.round(successScore + durationScore + errorScore)));
      
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
   * @returns {Object} Metriche: {successRate, avgDuration, maxDuration, totalRuns, lastError}
   */
  function getTriggerMetrics() {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(SHEET_NAME);
      
      if (!sheet) {
        return {
          successRate: 0,
          avgDuration: 0,
          maxDuration: 0,
          totalRuns: 0,
          lastError: null
        };
      }
      
      var historyHeaderRow = _findRowByText(sheet, '📋 STORICO ESECUZIONI');
      if (!historyHeaderRow) return { totalRuns: 0 };
      
      var dataStartRow = historyHeaderRow + 2;
      var lastRow = sheet.getLastRow();
      
      if (lastRow < dataStartRow) {
        return { totalRuns: 0, successRate: 0, avgDuration: 0, maxDuration: 0, lastError: null };
      }
      
      var dataRange = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, 5);
      var data = dataRange.getValues();
      
      var successCount = 0;
      var totalDuration = 0;
      var maxDuration = 0;
      var lastError = null;
      
      data.forEach(function(row, idx) {
        var status = String(row[2] || '');
        if (status.includes('✅')) {
          successCount++;
        } else if (status.includes('❌') && !lastError) {
          lastError = {
            timestamp: row[0],
            error: 'Vedi log per dettagli'
          };
        }
        
        var duration = parseFloat(row[1]);
        if (!isNaN(duration)) {
          totalDuration += duration;
          if (duration > maxDuration) maxDuration = duration;
        }
      });
      
      var totalRuns = data.length;
      var successRate = totalRuns > 0 ? (successCount / totalRuns * 100) : 0;
      var avgDuration = totalRuns > 0 ? (totalDuration / totalRuns) : 0;
      
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
      return { totalRuns: 0 };
    }
  }
  
  // ========== FUNZIONI PRIVATE ==========
  
  /**
   * Trova la riga contenente un testo specifico nella colonna A.
   */
  function _findRowByText(sheet, text) {
    var data = sheet.getRange('A:A').getValues();
    for (var i = 0; i < data.length; i++) {
      if (String(data[i][0]).includes(text)) {
        return i + 1; // Row numbers are 1-indexed
      }
    }
    return null;
  }
  
  /**
   * Aggiorna la sezione "Stato Corrente" con l'ultima esecuzione.
   */
  function _updateCurrentStatus(sheet, execution) {
    try {
      var timestamp = new Date(execution.timestamp || Date.now());
      var duration = execution.duration ? (execution.duration / 1000).toFixed(1) + 's' : 'N/A';
      var status = execution.success ? '✅ SUCCESSO' : '❌ ERRORE';
      
      // Riga 5: Ultima Esecuzione
      sheet.getRange(5, 2).setValue(
        Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss')
      );
      
      // Riga 6: Durata
      sheet.getRange(6, 2).setValue(duration);
      
      // Riga 7: Esito
      var statusCell = sheet.getRange(7, 2);
      statusCell.setValue(status);
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
   */
  function _updateStatistics(sheet) {
    try {
      var metrics = getTriggerMetrics();
      var healthScore = calculateHealthScore();
      
      // Riga 4: Health Score
      var healthCell = sheet.getRange(4, 2);
      var healthBar = _createProgressBar(healthScore);
      healthCell.setValue(healthScore + '/100  ' + healthBar);
      
      // Colore basato su score
      if (healthScore >= 80) {
        healthCell.setBackground('#d9ead3').setFontColor('#137333');
      } else if (healthScore >= 60) {
        healthCell.setBackground('#fff2cc').setFontColor('#bf9000');
      } else {
        healthCell.setBackground('#f4cccc').setFontColor('#cc0000');
      }
      
      // Riga 10: Success Rate
      sheet.getRange(10, 2).setValue(
        metrics.successRate.toFixed(1) + '% (' + 
        Math.round(metrics.successRate * metrics.totalRuns / 100) + '/' + 
        metrics.totalRuns + ')'
      );
      
      // Riga 11: Durata Media
      sheet.getRange(11, 2).setValue(metrics.avgDuration.toFixed(1) + 's');
      
      // Riga 12: Tempo Max
      sheet.getRange(12, 2).setValue(metrics.maxDuration.toFixed(1) + 's');
      
      // Riga 13: Ultimo Errore
      var lastErrorCell = sheet.getRange(13, 2);
      if (metrics.lastError) {
        lastErrorCell.setValue(
          Utilities.formatDate(
            new Date(metrics.lastError.timestamp), 
            Session.getScriptTimeZone(), 
            'dd/MM/yy HH:mm'
          )
        ).setFontColor('#cc0000');
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
   */
  function _createProgressBar(score) {
    var filled = Math.round(score / 10);
    var empty = 10 - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
  }
  
  /**
   * Salva esecuzione in STATE per persistenza.
   */
  function _saveExecutionToState(execution) {
    try {
      var key = STATE_KEY_PREFIX + Date.now();
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
   */
  function _cleanOldExecutions() {
    try {
      var props = PropertiesService.getScriptProperties();
      var allKeys = props.getKeys();
      
      var execKeys = allKeys.filter(function(k) {
        return k.startsWith(STATE_KEY_PREFIX);
      }).sort();
      
      if (execKeys.length > 50) {
        var toDelete = execKeys.slice(0, execKeys.length - 50);
        toDelete.forEach(function(k) {
          props.deleteProperty(k);
        });
        
        LOG.debug('DASHBOARD_CLEAN', 'Rimosse ' + toDelete.length + ' vecchie esecuzioni da STATE.');
      }
      
    } catch (e) {
      LOG.warn('DASHBOARD_CLEAN', 'Errore pulizia vecchie esecuzioni', {
        error: e.message
      });
    }
  }
  
  // API pubblica
  return {
    initSheet: initSheet,
    updateTriggerStatus: updateTriggerStatus,
    recordExecution: recordExecution,
    calculateHealthScore: calculateHealthScore,
    getTriggerMetrics: getTriggerMetrics
  };
  
})();

// Registra DASHBOARD nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('DASHBOARD', ['SHEETS', 'LOG', 'STATE']);
}

// Registra DASHBOARD nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('DASHBOARD', DASHBOARD);
}
