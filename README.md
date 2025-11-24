# 🍦 GG GESTIONALE GELATAMI - Versione Produzione

**Sistema di gestione integrato per gelateria artigianale**

---

## 📊 Funzionalità Principali

### 🧾 Gestione Fatture
- Import automatico fatture XML da Drive
- Classificazione automatica prodotti e fornitori
- Tracciamento costi per reparto (Gelateria/Hotel)

### 📦 Gestione Prodotti
- Anagrafica prodotti con categorizzazione automatica
- Gestione ingredienti e unità di misura
- Calcolo automatico costi unitari

### 📈 Reportistica
- **Dashboard**: Overview mensile costi e fatture
- **P&L**: Profit & Loss per sede (Gemma/Zaffiro)
- **Confronto**: Analisi comparativa multi-anno
- **Magazzino**: Report consumi per prodotto/ingrediente
- **PDF Export**: Generazione report formattati

### 🔧 Manutenzione
- Sincronizzazione automatica fornitori e categorie
- Cleanup prodotti duplicati
- Backup e recovery dati

---

## 🚀 Deployment

### Requisiti
- Google Workspace account
- Node.js e npm installati
- clasp CLI (`npm install -g @google/clasp`)

### Setup Iniziale

```bash
# 1. Clona il repository
git clone https://github.com/Gelatami-Massimo/GG-Controllo-Gestione.git
cd GG-Controllo-Gestione

# 2. Configura clasp con il tuo Script ID
cp .clasp.json.example .clasp.json
# Modifica .clasp.json inserendo il tuo scriptId

# 3. Login a clasp (prima volta)
clasp login

# 4. Deploy su Apps Script
clasp push
```

### Deploy Modifiche

```bash
# Deploy modifiche
clasp push

# Apri editor Apps Script
clasp open
```

---

## 📁 Struttura Progetto

```
GG-Controllo-Gestione/
├── 000_App.js                    # Entry point e namespace globale
├── 001_module_registry.js        # Registro moduli
├── 005_namespace.js              # Definizione namespace App
├── 010_main.js                   # Menu e routing UI
├── 016_error_handler.js          # Gestione errori centralizzata
├── 020_config.js                 # Configurazione e setup fogli
├── 021_constants.js              # Costanti applicazione
├── 030_globals.js                # Utility globali (SHEETS, LOG, UTIL)
├── 031_sheet_iterator.js         # Iterator per processamento fogli
├── 032_duplicate_manager.js      # Gestione duplicati fatture
├── 040_products.js               # Gestione anagrafica prodotti
├── 050_filters.js                # Sistema filtri avanzati
├── 060_import_headers.js         # Import intestazioni fatture
├── 070_import_rows.js            # Import righe fatture
├── 080_pdf_export.js             # Generazione PDF
├── 082_sync_prodotti.js          # Sincronizzazione prodotti da righe
├── 084_magazzino_core.js         # Report magazzino
├── 090_dashboard.js              # Dashboard mensile
├── 092_dashboard_trigger.js      # Trigger automatici dashboard
├── 094_config_ui.js              # Dialog configurazione
├── 100_reporting.js              # Sistema reportistica
├── 110_warehouse.js              # Gestione magazzino
├── 120_pnl.js                    # Profit & Loss
├── 122_pnl_confronto.js          # Confronto P&L multi-anno
├── 124_prodotti_cleanup.js       # Cleanup duplicati prodotti
├── 126_cleanup_exact_duplicates.js # Cleanup duplicati esatti
├── 130_debug.js                  # Utility debug
├── 140_status.js                 # Status applicazione
├── 150_triggers.js               # Gestione trigger
├── 170_setup.js                  # Setup iniziale
├── appsscript.json               # Configurazione Apps Script
├── ConfigDialog.html             # Dialog configurazione
├── FilterDialog.html             # Dialog filtri
├── PdfTemplate.html              # Template PDF
├── Sidebar.html                  # Sidebar UI
├── README.md                     # Documentazione utente
├── QUICK_START.md                # Guida rapida
└── TESTING_GUIDE.md              # Guida testing
```

---

## 🎯 Menu Applicazione

### 📊 Analisi
- **Dashboard**: Riepilogo mensile costi e fatture
- **P&L Gemma**: Profit & Loss Gelateria Gemma
- **P&L Zaffiro**: Profit & Loss Gelateria Zaffiro
- **Confronto Gemma-Zaffiro**: Analisi comparativa
- **Magazzino Prodotti**: Report consumi per prodotto
- **Magazzino Ingredienti**: Report consumi ingredienti

### 📥 Import
- **Import Fatture XML**: Carica fatture da Drive
- **Elabora Coda**: Processa fatture in coda

### 🔧 Manutenzione
- **Completa**: Manutenzione full (fornitori + categorie)
- **Sync Prodotti**: Sincronizza prodotti da righe fatture
- **Pulisci Duplicati**: Cleanup prodotti duplicati
- **Diagnostica Duplicati**: Analisi cause duplicati

### ⚙️ Config
- **Setup**: Configurazione iniziale
- **Impostazioni**: Modifica configurazione
- **Attiva/Disattiva Auto**: Gestione trigger automatici

---

## 🔐 Permessi OAuth

L'applicazione richiede i seguenti scope:
- `spreadsheets`: Lettura/scrittura fogli Google Sheets
- `drive`: Accesso file XML su Google Drive
- `script.scriptapp`: Gestione trigger automatici

---

## 📞 Supporto

Per supporto o segnalazione bug, contattare l'amministratore di sistema.

---

## 📜 Licenza

Proprietario: Gelatami Massimo  
Versione: 1.0 (Produzione)  
Data rilascio: 24 Novembre 2025

**© 2025 - Tutti i diritti riservati**
