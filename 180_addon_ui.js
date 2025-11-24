// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 180_addon_ui.js
// RUOLO: UI Cards per Google Workspace Add-on.
// NOTE: Homepage e action cards per interfaccia add-on moderna.
// =============================================================

/**
 * Homepage dell'add-on - visualizzata quando utente apre add-on dalla sidebar.
 * Mostra card con azioni principali e stato sistema.
 * 
 * @param {Object} e - Event object fornito da Google Workspace
 * @returns {Card} Card homepage con azioni principali
 */
function onAddonHomepage(e) {
  try {
    // Costruisci card principale
    const card = CardService.newCardBuilder()
      .setHeader(CardService.newCardHeader()
        .setTitle('🧊 GG Controllo Gestione')
        .setSubtitle('Sistema Gestione Fatture')
        .setImageUrl('https://www.gstatic.com/images/branding/product/1x/sheets_48dp.png')
      );

    // Sezione Import
    const importSection = CardService.newCardSection()
      .setHeader('📥 Import Fatture')
      .addWidget(CardService.newTextParagraph()
        .setText('Importa fatture XML da Google Drive con analisi automatica.')
      )
      .addWidget(CardService.newButtonSet()
        .addButton(CardService.newTextButton()
          .setText('▶️ Continua Import')
          .setOnClickAction(CardService.newAction()
            .setFunctionName('onContinueImportAction')
          )
          .setTextButtonStyle(CardService.TextButtonStyle.FILLED)
        )
      );

    // Sezione Report
    const reportSection = CardService.newCardSection()
      .setHeader('📊 Report e Analisi')
      .addWidget(CardService.newTextParagraph()
        .setText('Genera report finanziari e dashboard analitiche.')
      )
      .addWidget(CardService.newButtonSet()
        .addButton(CardService.newTextButton()
          .setText('📈 Dashboard')
          .setOnClickAction(CardService.newAction()
            .setFunctionName('onDashboardAction')
          )
        )
        .addButton(CardService.newTextButton()
          .setText('💰 P&L')
          .setOnClickAction(CardService.newAction()
            .setFunctionName('onPnLAction')
          )
        )
      )
      .addWidget(CardService.newTextButton()
        .setText('✅ Validazione Dati')
        .setOnClickAction(CardService.newAction()
          .setFunctionName('onDataValidationAction')
        )
        .setTextButtonStyle(CardService.TextButtonStyle.TEXT)
      );

    // Sezione Manutenzione
    const maintenanceSection = CardService.newCardSection()
      .setHeader('🔧 Manutenzione')
      .addWidget(CardService.newButtonSet()
        .addButton(CardService.newTextButton()
          .setText('✨ Manutenzione Completa')
          .setOnClickAction(CardService.newAction()
            .setFunctionName('onMaintenanceAction')
          )
        )
        .addButton(CardService.newTextButton()
          .setText('🗑️ Pulisci Cache')
          .setOnClickAction(CardService.newAction()
            .setFunctionName('onClearCacheAction')
          )
        )
      );

    // Sezione Info
    const infoSection = CardService.newCardSection()
      .addWidget(CardService.newTextParagraph()
        .setText('<b>Versione:</b> 25.0<br><b>Stato:</b> ✅ Operativo')
      );

    // Assembla card
    card.addSection(importSection)
        .addSection(reportSection)
        .addSection(maintenanceSection)
        .addSection(infoSection);

    return card.build();

  } catch (error) {
    LOG?.error('ADDON_UI', 'Errore creazione homepage', { error: error.message });
    return createErrorCard_('Errore caricamento homepage: ' + error.message);
  }
}

// ============================================================
// ACTION HANDLERS
// ============================================================

/**
 * Handler azione: Continua Import
 * @param {Object} e - Event object
 * @returns {ActionResponse}
 */
function onContinueImportAction(e) {
  try {
    // Esegui import
    runContinue();
    
    // Mostra notifica successo
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification()
        .setText('▶️ Import avviato! Controlla il foglio per il progresso.')
        .setType(CardService.NotificationType.INFO)
      )
      .build();
  } catch (error) {
    return createErrorResponse_('Errore import: ' + error.message);
  }
}

/**
 * Handler azione: Dashboard
 * @param {Object} e - Event object
 * @returns {ActionResponse}
 */
function onDashboardAction(e) {
  try {
    runCreateDashboard();
    
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification()
        .setText('📈 Dashboard generata!')
        .setType(CardService.NotificationType.INFO)
      )
      .build();
  } catch (error) {
    return createErrorResponse_('Errore dashboard: ' + error.message);
  }
}

/**
 * Handler azione: P&L
 * @param {Object} e - Event object
 * @returns {ActionResponse}
 */
function onPnLAction(e) {
  try {
    runCreatePnlSheet();
    
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification()
        .setText('💰 P&L generato!')
        .setType(CardService.NotificationType.INFO)
      )
      .build();
  } catch (error) {
    return createErrorResponse_('Errore P&L: ' + error.message);
  }
}

/**
 * Handler azione: Validazione Dati
 * @param {Object} e - Event object
 * @returns {ActionResponse}
 */
function onDataValidationAction(e) {
  try {
    DATA_VALIDATOR.runCompleteValidation();
    
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification()
        .setText('✅ Validazione completata! Controlla i log per dettagli.')
        .setType(CardService.NotificationType.INFO)
      )
      .build();
  } catch (error) {
    return createErrorResponse_('Errore validazione: ' + error.message);
  }
}

/**
 * Handler azione: Manutenzione Completa
 * @param {Object} e - Event object
 * @returns {ActionResponse}
 */
function onMaintenanceAction(e) {
  try {
    runCompleteMaintenance();
    
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification()
        .setText('✨ Manutenzione completata!')
        .setType(CardService.NotificationType.INFO)
      )
      .build();
  } catch (error) {
    return createErrorResponse_('Errore manutenzione: ' + error.message);
  }
}

/**
 * Handler azione: Pulisci Cache
 * @param {Object} e - Event object
 * @returns {ActionResponse}
 */
function onClearCacheAction(e) {
  try {
    runClearCache();
    
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification()
        .setText('🗑️ Cache pulita!')
        .setType(CardService.NotificationType.INFO)
      )
      .build();
  } catch (error) {
    return createErrorResponse_('Errore pulizia cache: ' + error.message);
  }
}

// ============================================================
// UTILITY CARDS
// ============================================================

/**
 * Crea card di errore
 * @param {string} message - Messaggio errore
 * @returns {Card}
 * @private
 */
function createErrorCard_(message) {
  return CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('❌ Errore')
    )
    .addSection(CardService.newCardSection()
      .addWidget(CardService.newTextParagraph()
        .setText(message)
      )
    )
    .build();
}

/**
 * Crea action response di errore
 * @param {string} message - Messaggio errore
 * @returns {ActionResponse}
 * @private
 */
function createErrorResponse_(message) {
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification()
      .setText(message)
      .setType(CardService.NotificationType.ERROR)
    )
    .build();
}

// Registra nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('ADDON_UI', ['LOG', 'DATA_VALIDATOR']);
}

// Registra nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('ADDON_UI', {
    onAddonHomepage,
    onContinueImportAction,
    onDashboardAction,
    onPnLAction,
    onDataValidationAction,
    onMaintenanceAction,
    onClearCacheAction
  });
}
