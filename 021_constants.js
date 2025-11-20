// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 021_constants.js
// RUOLO: Costanti globali centralizzate (timeout, date format, ecc.).
// NOTE: Elimina numeri magici, valori hardcoded accessibili via CONSTANTS.*
// =============================================================

/**
 * CONSTANTS Module
 * 
 * Centralizza tutti i valori hardcoded sparsi nel progetto.
 * Ogni "numero magico" deve essere definito qui con nome chiaro e commento.
 * 
 * USAGE:
 *   const COL = CONSTANTS.TRIGGER_STATUS_COLUMNS;
 *   const status = row[COL.STATUS];  // vs row[2] ❌
 * 
 * DEPENDENCIES: None (modulo base)
 * VERSION: 26.0
 */
const CONSTANTS = (function() {
  'use strict';

  return {
    
    // ========================================================================
    // SHEET COLUMN MAPPINGS
    // ========================================================================
    
    /**
     * Indici colonne per foglio "Trigger Status Dashboard"
     * Usare questi invece di numeri magici come row[0], row[2]
     */
    TRIGGER_STATUS_COLUMNS: {
      TIMESTAMP: 0,   // Colonna A: Data/ora esecuzione
      DURATION: 1,    // Colonna B: Durata esecuzione (secondi)
      STATUS: 2,      // Colonna C: Esito (✅/❌/⏸️)
      MESSAGE: 3      // Colonna D: Messaggio descrittivo
    },

    /**
     * Nomi colonne standard cross-sheet
     * Mappatura logica colonne comuni a più fogli
     */
    STANDARD_COLUMNS: {
      FILE_ID: 'FileID',
      NUMERO_DOC: 'NumeroDoc',
      DATA: 'Data',
      FORNITORE_ID: 'FornitoreID',
      DENOMINAZIONE_FORNITORE: 'DenominazioneFornitore',
      IMPORTO: 'TotImponibile',
      IMPORTED_AT: 'ImportedAt',
      SEDE: 'Sede',
      REPARTO: 'Reparto',
      ANNO: 'Anno',
      MESE: 'Mese'
    },

    // ========================================================================
    // PERFORMANCE LIMITS & BATCH SIZES
    // ========================================================================
    
    /**
     * Limiti operazioni batch per prevenire timeout e ottimizzare memoria
     */
    BATCH_LIMITS: {
      // Chunk sizes per lettura dati
      READ_CHUNK_SIZE: 500,          // Max righe per lettura batch da foglio
      READ_CHUNK_SIZE_LARGE: 1000,   // Per fogli con poche colonne
      READ_CHUNK_SIZE_SMALL: 200,    // Per fogli con molte colonne (>30)
      
      // Chunk sizes per scrittura dati
      WRITE_CHUNK_SIZE: 1000,        // Max righe per scrittura batch
      WRITE_CHUNK_SIZE_SMALL: 500,   // Per operazioni complesse
      
      // Formattazione e marcatura
      MARK_BATCH_SIZE: 200,          // Max righe per formattazione colori batch
      FORMAT_BATCH_SIZE: 100,        // Max celle per setNumberFormat batch
      
      // Cache e memoria
      MAX_CACHE_SIZE: 10000,         // Max elementi in Set/Map in memoria
      MAX_CACHE_CHUNKS: 50,          // Max chunk in CacheService
      
      // Flush frequencies
      FLUSH_EVERY: 200,              // Flush buffer ogni N operazioni
      FLUSH_PDF_EVERY: 200,          // Flush link PDF ogni N aggiornamenti
      
      // Import specifici
      IMPORT_SAVE_EVERY: 100,        // Salva stato import ogni N file
      PDF_CHUNK_SIZE: 80             // PDF generati per ciclo
    },

    /**
     * Timeout operazioni lunghe (secondi)
     * Google Apps Script ha limite hard di 6 minuti (360s)
     */
    TIMEOUTS: {
      MAX_RUNTIME: 240,              // 4 minuti (limite configurabile)
      IMPORT_HEADERS: 240,           // Import testate fatture
      IMPORT_ROWS: 240,              // Import righe dettaglio
      PDF_GENERATION: 240,           // Generazione PDF
      DASHBOARD_UPDATE: 120,         // Aggiornamento dashboard
      REPORTING: 180,                // Generazione report audit
      SAFETY_MARGIN: 30,             // Margine sicurezza per cleanup finale
      
      // Timeout specifici operazioni brevi
      QUICK_OPERATION: 30,           // Operazioni rapide (sync, format)
      DUPLICATE_SCAN: 180,           // Scansione duplicati
      WAREHOUSE_BUILD: 180           // Costruzione magazzino
    },

    // ========================================================================
    // DATE FORMATS & REGEX PATTERNS
    // ========================================================================
    
    /**
     * Pattern regex per parsing date
     * Usare con DATE_UTILS.parseXmlDate(), etc.
     */
    DATE_PATTERNS: {
      // Date ISO 8601: YYYY-MM-DD o YYYY-MM-DDTHH:MM:SS
      ISO_DATE: /^(\d{4})-(\d{2})-(\d{2})/,
      
      // Date italiane: DD/MM/YYYY
      ITALIAN_DATE: /^(\d{2})\/(\d{2})\/(\d{4})/,
      
      // Anno-Mese: YYYY-MM
      MONTH_YEAR: /^(\d{4})-(\d{2})$/,
      
      // Solo anno: YYYY
      YEAR_ONLY: /^(\d{4})$/
    },

    /**
     * Indici gruppi regex (per chiarezza nel codice)
     * Evita magic numbers come match[1], match[2]
     */
    DATE_REGEX_GROUPS: {
      ISO: { 
        YEAR: 1,    // Primo gruppo: anno
        MONTH: 2,   // Secondo gruppo: mese
        DAY: 3      // Terzo gruppo: giorno
      },
      ITALIAN: { 
        DAY: 1,     // Primo gruppo: giorno
        MONTH: 2,   // Secondo gruppo: mese
        YEAR: 3     // Terzo gruppo: anno
      }
    },

    /**
     * Formati date per Utilities.formatDate()
     */
    DATE_FORMATS: {
      ISO: 'yyyy-MM-dd',                    // 2025-11-19
      ITALIAN: 'dd/MM/yyyy',                // 19/11/2025
      LONG_ITALIAN: 'd MMMM yyyy',          // 19 novembre 2025
      MONTH_NAME: 'MMMM',                   // novembre
      SHORT_MONTH: 'MMM',                   // nov
      YEAR_MONTH: 'yyyy-MM',                // 2025-11
      TIMESTAMP: 'yyyy-MM-dd HH:mm:ss'      // 2025-11-19 15:30:45
    },

    // ========================================================================
    // UI CONFIGURATION
    // ========================================================================
    
    /**
     * Durate toast notifications (secondi)
     * Usare CONSTANTS.TOAST_DURATION.MEDIUM invece di 5
     */
    TOAST_DURATION: {
      INSTANT: 1,          // Toast velocissimo (cleanup)
      SHORT: 3,            // Messaggio breve
      MEDIUM: 5,           // Messaggio standard
      LONG: 8,             // Messaggio importante
      VERY_LONG: 15,       // Alert critico
      PERSISTENT: -1       // Non si chiude automaticamente
    },

    /**
     * Colori standard per marcature visive (hex)
     */
    COLORS: {
      // Duplicati
      DUPLICATE_INVOICE: '#FFFF00',    // Giallo per fatture duplicate
      DUPLICATE_ROW: '#FFE6E6',        // Rosa chiaro per righe duplicate
      
      // Stati e alert
      ERROR: '#FF0000',                // Rosso per errori critici
      WARNING: '#FFA500',              // Arancione per warning
      SUCCESS: '#00FF00',              // Verde per successo
      INFO: '#ADD8E6',                 // Azzurro per info
      
      // Formattazione fogli
      HEADER: '#E0E0E0',               // Grigio chiaro per header
      HEADER_BOLD: '#D0D0D0',          // Grigio per header sezioni
      TOTAL_ROW: '#F3F3F3',            // Grigio chiarissimo per totali
      SUBTOTAL_ROW: '#E8E8E8',         // Grigio per subtotali
      
      // Dashboard
      TRIGGER_ACTIVE: '#34A853',       // Verde per trigger attivo
      TRIGGER_INACTIVE: '#EA4335',     // Rosso per trigger inattivo
      HEALTH_GOOD: '#34A853',          // Verde per health >80%
      HEALTH_MEDIUM: '#FBBC04',        // Giallo per health 50-80%
      HEALTH_BAD: '#EA4335',           // Rosso per health <50%
      
      // P&L colors
      PNL_REVENUE: '#E8F5E9',          // Verde chiaro per ricavi
      PNL_COST: '#FFEBEE',             // Rosso chiaro per costi
      PNL_MOL: '#FFF9C4'               // Giallo chiaro per MOL
    },

    /**
     * Frequenze aggiornamento UI (ogni N elementi)
     * Bilanciamento tra feedback utente e performance
     */
    UI_UPDATE_FREQUENCY: {
      PROGRESS_BAR: 20,            // Aggiorna barra progresso ogni 20 item
      PROGRESS_BAR_SLOW: 50,       // Per operazioni veloci
      PROGRESS_BAR_FAST: 10,       // Per operazioni lente
      
      LOG_MESSAGE: 500,            // Log dettagliato ogni 500 item
      LOG_MESSAGE_VERBOSE: 100,    // Log verbose per debug
      
      TOAST_UPDATE: 100,           // Toast ogni 100 item processati
      STATE_SAVE: 100              // Salva stato ogni 100 item
    },

    // ========================================================================
    // BUSINESS LOGIC CONSTANTS
    // ========================================================================
    
    /**
     * Tipi documento fattura elettronica (codici standard SDI)
     */
    DOCUMENT_TYPES: {
      TD01: 'Fattura',
      TD02: 'Acconto/Anticipo',
      TD03: 'Acconto/Anticipo su Parcella',
      TD04: 'Nota di Credito',
      TD05: 'Nota di Debito',
      TD06: 'Parcella',
      TD16: 'Integrazione Fattura Reverse Charge',
      TD17: 'Integrazione/Autofattura Acquisti Servizi Estero',
      TD18: 'Integrazione Acquisti Beni Intracomunitari',
      TD19: 'Integrazione/Autofattura Acquisti Beni ex Art.17 c.2',
      TD20: 'Autofattura Regolarizzazione',
      TD21: 'Autofattura Cessione Beni',
      TD22: 'Estrazione Beni da Deposito IVA',
      TD23: 'Estrazione Beni da Deposito IVA con Versamento IVA',
      TD24: 'Fattura Differita',
      TD25: 'Fattura Differita',
      TD26: 'Cessione Beni Ammortizzabili',
      TD27: 'Fattura per Autoconsumo'
    },

    /**
     * Famiglie prodotti escluse da calcoli specifici
     */
    PRODUCT_EXCLUSIONS: {
      // Escluse da inventario magazzino
      WAREHOUSE_EXCLUDED: [
        'Servizi', 
        'Spese', 
        'Trasporti', 
        'Consulenze',
        'Utenze'
      ],
      
      // Escluse da P&L costi diretti
      PNL_NON_DIRECT_COSTS: [
        'Consulenze',
        'Utenze',
        'Assicurazioni'
      ]
    },

    /**
     * Mapping reparto based on indirizzo
     * Usato in 060_import_headers.js
     */
    DEPARTMENT_MAPPING: {
      // Indirizzo → Reparto
      HOTEL_KEYWORDS: [
        'via nazionale 202',
        'via nazionale, 202',
        'nazionale 202'
      ],
      DEFAULT_DEPARTMENT: 'Gelateria',
      HOTEL_DEPARTMENT: 'Hotel'
    },

    /**
     * Soglie alert per monitoring e health check
     */
    ALERT_THRESHOLDS: {
      // Percentuali di warning
      DUPLICATE_PERCENT: 5,            // Alert se >5% righe duplicate
      ERROR_RATE: 2,                   // Alert se >2% operazioni falliscono
      TIMEOUT_WARNINGS: 3,             // Alert dopo 3 timeout consecutivi
      
      // Health score
      HEALTH_GOOD: 80,                 // Score >80 = ottimo
      HEALTH_MEDIUM: 50,               // Score 50-80 = accettabile
      HEALTH_BAD: 50,                  // Score <50 = critico
      
      // Performance
      MAX_IMPORT_DURATION: 300,        // Alert se import >5 minuti
      MAX_PDF_GENERATION_TIME: 2,      // Alert se PDF >2 secondi/file
      MAX_QUERY_TIME: 10               // Alert se query >10 secondi
    },

    // ========================================================================
    // CACHE CONFIGURATION
    // ========================================================================
    
    /**
     * Prefissi chiavi cache per evitare collisioni
     * CacheService ha namespace flat, serve organizzazione
     */
    CACHE_PREFIXES: {
      IMPORT_HEADERS: 'HEADERS_V23_',
      IMPORT_ROWS: 'ROWS_V23_',
      DUPLICATE_CHECK: 'DUP_CHK_',
      AUDIT_COUNTS: 'AUDIT_',
      PDF_PROCESSING: 'PDF_PROC_',
      TEMP_DATA: 'TEMP_'
    },

    /**
     * TTL (Time To Live) cache in secondi
     * CacheService: max 6 ore (21600s), ScriptCache: max 10 minuti
     */
    CACHE_TTL: {
      SHORT: 300,        // 5 minuti - dati volatili
      MEDIUM: 1800,      // 30 minuti - dati semi-permanenti
      LONG: 21600,       // 6 ore - massimo CacheService
      SESSION: 600       // 10 minuti - durata sessione utente
    },

    // ========================================================================
    // VALIDATION RULES
    // ========================================================================
    
    /**
     * Regole validazione dati
     */
    VALIDATION: {
      // Lunghezze minime/massime
      MIN_SUPPLIER_NAME: 3,
      MAX_SUPPLIER_NAME: 200,
      MIN_INVOICE_NUMBER: 1,
      MAX_INVOICE_NUMBER: 50,
      
      // Pattern validazione
      PARTITA_IVA_LENGTH: 11,
      CODICE_FISCALE_LENGTH: 16,
      
      // Range valori
      MIN_YEAR: 2020,
      MAX_YEAR: 2050,
      MIN_MONTH: 1,
      MAX_MONTH: 12,
      
      // Limiti importi
      MAX_INVOICE_AMOUNT: 1000000,   // 1 milione
      MIN_INVOICE_AMOUNT: 0
    },

    // ========================================================================
    // ERROR CODES & MESSAGES
    // ========================================================================
    
    /**
     * Codici errore standard per logging strutturato
     */
    ERROR_CODES: {
      // Import errors (1000-1999)
      IMPORT_XML_PARSE_FAILED: 1001,
      IMPORT_MISSING_COLUMNS: 1002,
      IMPORT_DUPLICATE_DETECTED: 1003,
      IMPORT_TIMEOUT: 1004,
      
      // PDF errors (2000-2999)
      PDF_QUOTA_EXCEEDED: 2001,
      PDF_TEMPLATE_NOT_FOUND: 2002,
      PDF_GENERATION_FAILED: 2003,
      
      // Data errors (3000-3999)
      DATA_VALIDATION_FAILED: 3001,
      DATA_INTEGRITY_ERROR: 3002,
      DATA_MISSING_REQUIRED: 3003,
      
      // System errors (4000-4999)
      SYSTEM_TIMEOUT: 4001,
      SYSTEM_QUOTA_EXCEEDED: 4002,
      SYSTEM_PERMISSION_DENIED: 4003,
      SYSTEM_RESOURCE_EXHAUSTED: 4004
    },

    /**
     * Template messaggi errore user-friendly
     */
    ERROR_MESSAGES: {
      QUOTA_EXCEEDED: '⚠️ Quota giornaliera raggiunta. Riprova domani o contatta l\'amministratore.',
      TIMEOUT_WARNING: '⏱️ Operazione troppo lunga. Riprova o contatta il supporto.',
      PERMISSION_DENIED: '🔒 Permessi insufficienti. Verifica le autorizzazioni Google Drive.',
      DATA_MISSING: '📋 Dati mancanti. Verifica che tutte le colonne richieste siano presenti.',
      GENERIC_ERROR: '❌ Si è verificato un errore. Controlla il foglio Log per dettagli.'
    },

    // ========================================================================
    // FEATURE FLAGS
    // ========================================================================
    
    /**
     * Feature flags per abilitare/disabilitare funzionalità
     * Utile per rollout graduale e A/B testing
     */
    FEATURES: {
      ENABLE_DUPLICATE_PREVENTION: true,     // Prevenzione duplicati import
      ENABLE_PDF_CIRCUIT_BREAKER: true,      // Circuit breaker quota PDF
      ENABLE_AUTO_MAINTENANCE: true,         // Manutenzione automatica post-setup
      ENABLE_HEALTH_MONITORING: true,        // Monitoring health trigger
      ENABLE_VERBOSE_LOGGING: false,         // Log dettagliato (solo debug)
      ENABLE_PERFORMANCE_METRICS: false      // Tracking performance dettagliato
    },

    // ========================================================================
    // REGEX PATTERNS (BUSINESS LOGIC)
    // ========================================================================
    
    /**
     * Pattern regex per business logic
     */
    REGEX: {
      // File patterns
      XML_FILE: /\.xml(\.p7m)?$/i,
      PDF_FILE: /\.pdf$/i,
      
      // Data patterns (già definiti sopra in DATE_PATTERNS)
      
      // Business patterns
      PARTITA_IVA: /^[0-9]{11}$/,
      CODICE_FISCALE: /^[A-Z]{6}[0-9]{2}[A-Z][0-9]{2}[A-Z][0-9]{3}[A-Z]$/,
      
      // Text cleaning
      MULTIPLE_SPACES: /\s+/g,
      LEADING_ZEROS: /^0+/,
      
      // Invoice number extraction
      INVOICE_NUMBER: /[A-Z0-9\-\/]+/i
    },

    // ========================================================================
    // METADATA
    // ========================================================================
    
    /**
     * Metadata configurazione
     */
    META: {
      VERSION: '26.0',
      LAST_UPDATED: '2025-11-19',
      AUTHOR: 'GitHub Copilot - Senior Tech Lead Refactoring',
      PURPOSE: 'Eliminazione numeri magici dal codebase'
    }
  };
})();

// =============================================================
// MODULE REGISTRATION
// =============================================================

if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('CONSTANTS', []); // No dependencies
}

if (typeof GG !== 'undefined') {
  GG.register('CONSTANTS', CONSTANTS);
}
