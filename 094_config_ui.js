// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 094_config_ui.js
// RUOLO: Dialog HTML per configurazione user-friendly.
// NOTE: Usa ConfigDialog.html, interfaccia grafica per CONFIG.get/set.
// =============================================================

var CONFIG_UI = (function() {
  'use strict';

  /**
   * Apre dialog HTML per configurazione sistema user-friendly.
   * Mostra interfaccia grafica (ConfigDialog.html) per modificare CONFIG senza toccare foglio manualmente.
   * 
   * Parametri configurabili:
   * - CARTELLA_INPUT_ID/OUTPUT_ID: Cartelle Drive
   * - TRIGGER_EVERY_MIN: Frequenza trigger automatico
   * - MAX_RUNTIME_SEC: Timeout esecuzione
   * - ROWS_CHUNK_SIZE, PDF_CHUNK_SIZE: Dimensioni batch
   * - CATEGORIE_ESCLUSE_MAGAZZINO, MODALITA_DEBUG, ecc.
   * 
   * @returns {void}
   * @throws {Error} Se ConfigDialog.html non trovato
   * 
   * @example
   * CONFIG_UI.openDialog();
   */
  function openDialog() {
    try {
      var html = HtmlService.createHtmlOutputFromFile('ConfigDialog')
        .setWidth(700)
        .setHeight(800)
        .setTitle('⚙️ Configurazione Sistema');
      
      SpreadsheetApp.getUi().showModalDialog(html, 'Configurazione GG Gestione');
      
      LOG.info('CONFIG_UI', 'Dialog configurazione aperto.');
      
    } catch (e) {
      LOG.error('CONFIG_UI', 'Errore apertura dialog configurazione', {
        error: e.message,
        stack: e.stack
      });
      
      SpreadsheetApp.getUi().alert(
        'Errore',
        'Impossibile aprire il dialog di configurazione: ' + e.message,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    }
  }
  
  /**
   * Recupera configurazione corrente per popolare dialog HTML (chiamata da ConfigDialog.html).
   * 
   * @returns {Object} Oggetto con tutte le chiavi CONFIG (es. {CARTELLA_INPUT_ID: '...', TRIGGER_EVERY_MIN: 15, ...})
   * 
   * @example
   * const config = CONFIG_UI.getConfiguration();
   * console.log(config.TRIGGER_EVERY_MIN); // 15
   */
  function getConfiguration() {
    try {
      var config = {};
      
      // Carica tutti i valori CONFIG
      var keys = [
        'CARTELLA_INPUT_ID',
        'CARTELLA_OUTPUT_ID',
        'TRIGGER_EVERY_MIN',
        'MAX_RUNTIME_SEC',
        'IMPORT_RIGHE_DEFAULT',
        'CATEGORIE_ESCLUSE_MAGAZZINO',
        'MODALITA_DEBUG',
        'ROWS_CHUNK_SIZE',
        'ROWS_FLUSH_EVERY',
        'PDF_CHUNK_SIZE',
        'PDF_FLUSH_EVERY',
        'ROWS_TOLLERANZA_EURO',
        'ADMIN_EMAIL',
        'TRIGGER_NOTIFY_ON_ACTIVE'
      ];
      
      keys.forEach(function(key) {
        config[key] = CONFIG.get(key, '');
      });
      
      LOG.debug('CONFIG_UI', 'Configurazione caricata per dialog.', {
        keys: Object.keys(config).length
      });
      
      return config;
      
    } catch (e) {
      LOG.error('CONFIG_UI', 'Errore lettura configurazione', {
        error: e.message,
        stack: e.stack
      });
      throw e;
    }
  }
  
  /**
   * Salva configurazione modificata dal dialog (chiamata da ConfigDialog.html).
   * 
   * Workflow:
   * 1. Valida dati critici (CARTELLA_INPUT_ID, OUTPUT_ID)
   * 2. Backup configurazione corrente in PropertiesService
   * 3. Scrive nuovi valori nel foglio Config
   * 4. Invalida cache CONFIG
   * 
   * @param {Object} newConfig - Nuova configurazione da form HTML
   * @returns {boolean} True se salvato con successo
   * @throws {Error} Se validazione fallisce o foglio Config non accessibile
   * 
   * @example
   * CONFIG_UI.saveConfiguration({TRIGGER_EVERY_MIN: 30, MAX_RUNTIME_SEC: 180});
   */
  function saveConfiguration(newConfig) {
    try {
      LOG.info('CONFIG_UI', 'Salvataggio nuova configurazione...', {
        keys: Object.keys(newConfig)
      });
      
      // Valida dati critici
      _validateConfig(newConfig);
      
      // Backup configurazione corrente
      _backupCurrentConfig();
      
      // Scrivi nuova configurazione sul foglio Config
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var cfgSheet = ss.getSheetByName('Config');
      
      if (!cfgSheet) {
        throw new Error('Foglio Config non trovato');
      }
      
      var headerRow = SHEETS._findHeaderRow(cfgSheet, 'Config');
      if (!headerRow) {
        throw new Error('Intestazione Config non trovata');
      }
      
      var dataStartRow = headerRow + 1;
      var lastRow = cfgSheet.getLastRow();
      
      if (lastRow < dataStartRow) {
        throw new Error('Nessuna configurazione esistente');
      }
      
      // Leggi tutte le righe CONFIG
      var data = cfgSheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, 3).getValues();
      
      // Aggiorna valori
      var updated = 0;
      for (var i = 0; i < data.length; i++) {
        var key = String(data[i][0]).trim();
        
        if (newConfig.hasOwnProperty(key)) {
          var newValue = newConfig[key];
          
          // Converti booleani in stringhe TRUE/FALSE
          if (typeof newValue === 'boolean') {
            newValue = newValue ? 'TRUE' : 'FALSE';
          }
          
          // Aggiorna solo se cambiato
          if (String(data[i][1]) !== String(newValue)) {
            data[i][1] = newValue;
            updated++;
            
            LOG.debug('CONFIG_UI', 'Aggiornato: ' + key, {
              oldValue: data[i][1],
              newValue: newValue
            });
          }
        }
      }
      
      // Scrivi modifiche sul foglio
      if (updated > 0) {
        cfgSheet.getRange(dataStartRow, 1, data.length, 3).setValues(data);
        
        // Invalida cache CONFIG
        CONFIG.invalidateCache();
        
        LOG.info('CONFIG_UI', 'Configurazione salvata con successo.', {
          updated: updated
        });
      } else {
        LOG.info('CONFIG_UI', 'Nessuna modifica da salvare.');
      }
      
      return true;
      
    } catch (e) {
      LOG.error('CONFIG_UI', 'Errore salvataggio configurazione', {
        error: e.message,
        stack: e.stack
      });
      throw e;
    }
  }
  
  /**
   * Recupera la configurazione predefinita (chiamata dal dialog HTML).
   * @returns {Object} Configurazione default
   */
  function getDefaultConfiguration() {
    var defaultEmail = '';
    try {
      defaultEmail = Session.getActiveUser().getEmail();
    } catch (e) {
      // Permessi mancanti, usa stringa vuota
      defaultEmail = '';
    }
    
    return {
      CARTELLA_INPUT_ID: '',
      CARTELLA_OUTPUT_ID: '',
      TRIGGER_EVERY_MIN: '15',
      MAX_RUNTIME_SEC: '240',
      IMPORT_RIGHE_DEFAULT: 'FALSE',
      CATEGORIE_ESCLUSE_MAGAZZINO: 'sconto, attrezzatura, canvass, omaggio, servizi',
      MODALITA_DEBUG: 'FALSE',
      ROWS_CHUNK_SIZE: '100',
      ROWS_FLUSH_EVERY: '2000',
      PDF_CHUNK_SIZE: '80',
      PDF_FLUSH_EVERY: '200',
      ROWS_TOLLERANZA_EURO: '1.00',
      ADMIN_EMAIL: defaultEmail,
      TRIGGER_NOTIFY_ON_ACTIVE: 'FALSE'
    };
  }
  
  // ========== FUNZIONI PRIVATE ==========
  
  /**
   * Valida la configurazione prima di salvare.
   */
  function _validateConfig(config) {
    var errors = [];
    
    // Valida ID cartelle (almeno 10 caratteri)
    if (!config.CARTELLA_INPUT_ID || config.CARTELLA_INPUT_ID.length < 10) {
      errors.push('ID Cartella Input non valido');
    }
    
    if (!config.CARTELLA_OUTPUT_ID || config.CARTELLA_OUTPUT_ID.length < 10) {
      errors.push('ID Cartella Output non valido');
    }
    
    // Valida numeri
    var triggerMin = Number(config.TRIGGER_EVERY_MIN);
    if (!Number.isFinite(triggerMin) || triggerMin < 1) {
      errors.push('Frequenza trigger non valida');
    }
    
    var maxRuntime = Number(config.MAX_RUNTIME_SEC);
    if (!Number.isFinite(maxRuntime) || maxRuntime < 60 || maxRuntime > 360) {
      errors.push('Timeout deve essere tra 60 e 360 secondi');
    }
    
    // Valida email (se fornita)
    if (config.ADMIN_EMAIL && !_isValidEmail(config.ADMIN_EMAIL)) {
      errors.push('Email amministratore non valida');
    }
    
    if (errors.length > 0) {
      throw new Error('Validazione fallita: ' + errors.join(', '));
    }
  }
  
  /**
   * Verifica validità email.
   */
  function _isValidEmail(email) {
    var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
  
  /**
   * Backup della configurazione corrente prima di sovrascrivere.
   */
  function _backupCurrentConfig() {
    try {
      var timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      var backupKey = 'config_backup_' + timestamp;
      
      var currentConfig = getConfiguration();
      STATE.set(backupKey, JSON.stringify(currentConfig));
      
      // Mantieni solo ultimi 10 backup
      _cleanOldBackups();
      
      LOG.debug('CONFIG_UI', 'Backup configurazione creato: ' + backupKey);
      
    } catch (e) {
      LOG.warn('CONFIG_UI', 'Errore creazione backup configurazione', {
        error: e.message
      });
      // Non bloccare il salvataggio se il backup fallisce
    }
  }
  
  /**
   * Pulisce vecchi backup (mantiene ultimi 10).
   */
  function _cleanOldBackups() {
    try {
      var props = PropertiesService.getScriptProperties();
      var allKeys = props.getKeys();
      
      var backupKeys = allKeys.filter(function(k) {
        return k.startsWith('config_backup_');
      }).sort();
      
      if (backupKeys.length > 10) {
        var toDelete = backupKeys.slice(0, backupKeys.length - 10);
        toDelete.forEach(function(k) {
          props.deleteProperty(k);
        });
        
        LOG.debug('CONFIG_UI', 'Rimossi ' + toDelete.length + ' vecchi backup.');
      }
      
    } catch (e) {
      LOG.warn('CONFIG_UI', 'Errore pulizia vecchi backup', {
        error: e.message
      });
    }
  }
  
  // API pubblica
  return {
    openDialog: openDialog,
    getConfiguration: getConfiguration,
    saveConfiguration: saveConfiguration,
    getDefaultConfiguration: getDefaultConfiguration
  };
  
})();

// Registra CONFIG_UI nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('CONFIG_UI', ['CONFIG', 'SHEETS', 'LOG', 'STATE']);
}

// Registra CONFIG_UI nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('CONFIG_UI', CONFIG_UI);
}
