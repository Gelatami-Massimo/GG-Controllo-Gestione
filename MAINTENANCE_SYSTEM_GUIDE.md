# 🔧 Sistema di Manutenzione - Guida Operativa

**Data creazione:** 28 novembre 2025  
**Versione:** 1.0  
**Progetto:** GG Controllo Gestione v25.0

---

## 📋 Panoramica

Il sistema di manutenzione è stato completamente semplificato per garantire **facilità d'uso** con **poche opzioni che fanno tutto**. L'utente non deve preoccuparsi di eseguire operazioni complesse: un singolo comando esegue tutte le verifiche e correzioni necessarie.

---

## ✨ Manutenzione Completa (One-Click)

### 🎯 Accesso Rapido

**Menu:** `🧊 GELATAMI → 🔧 Manutenzione → ✨ Manutenzione Completa`

### 🔄 Operazioni Eseguite (Automatiche)

La **Manutenzione Completa** esegue in sequenza:

1. **Verifica e Riallineamento Fogli** (`SETUP.verifyAlignment()`)
   - Controlla tutti i fogli rispetto agli schemi definiti in `SHEETS.SCHEMAS`
   - Identifica intestazioni mancanti o extra
   - Riallinea automaticamente dove possibile
   - Logga riepilogo dettagliato nel foglio `Log` con scope `MAINT_SETUP_VERIFY`

2. **Creazione Fogli Mancanti** (`SHEETS.ensureAll()`)
   - Verifica esistenza di tutti i fogli previsti
   - Crea fogli mancanti con intestazioni corrette
   - Applica filtri automatici su tutte le intestazioni

3. **Applicazione Formati** (`SHEETS.applyFormats()`)
   - Applica formati valuta, date, percentuali secondo `SHEETS.FORMAT_RULES`
   - Protegge colonne calcolate automaticamente
   - Assicura coerenza visiva e funzionale

4. **Formattazione Codici** (`DEBUG.forceTextFormatOnCodes()`)
   - Forza formato **TESTO** su colonne codici critiche
   - Previene conversioni automatiche (es. `001` → `1`)
   - Colonne protette: `FileID`, `CodiceInterno`, `CodiceFornitore`, `NumeroDoc`, ecc.

5. **Marcatura Duplicati Fatture** (`DEBUG.manageDuplicateInvoices()`)
   - Identifica fatture con `FileID` duplicato
   - Applica evidenziazione gialla automatica
   - Operazione silenziosa (solo log, nessun alert)
   - Protegge integrità dati senza bloccare workflow

6. **Marcatura Duplicati Righe** (`DEBUG.manageDuplicateRows()`)
   - Identifica righe con `FileID|NumeroLinea` duplicato
   - Applica evidenziazione rosa automatica
   - Operazione silenziosa (solo log)

7. **Controllo Integrità Dati** (`DEBUG.sanityCheck()`)
   - Verifica accesso a cartelle Drive (Input/Output)
   - Controlla esistenza fogli essenziali (`Config`, `Fatture`, `Righe`, `Fornitori`, `Prodotti`)
   - Riporta errori e warning nel foglio `Log`

### 📊 Logging Granulare

Ogni esecuzione genera log dettagliati nel foglio **Log** con formato:

```
[Timestamp] [RunId] [Scope] [Level] [Message] [Context]
```

**Scope principali:**
- `MAINT_START`: Avvio manutenzione completa
- `MAINT_SETUP_VERIFY`: Verifica setup fogli
- `MAINT_SETUP_VERIFY_FIX`: Riallineamento intestazioni
- `MAINT_DONE`: Manutenzione completata

**RunId:** Identificatore univoco per tracciare ogni esecuzione (formato `YYYYMMDD_HHMMSS_SSS`)

### ⏱️ Tempo di Esecuzione

- **Tipico:** 30-60 secondi
- **Con molti dati:** fino a 2-3 minuti
- **Timeout:** Protetto da `MAX_RUNTIME_SEC` (default 240 sec)

### ✅ Risultato Atteso

Al termine vedrai:
- Toast di conferma: *"Manutenzione completata! Fogli verificati, codici formattati, duplicati marcati, integrità controllata."*
- Log dettagliato nel foglio `Log` con tutti i passaggi eseguiti
- Fogli allineati e formattati correttamente
- Duplicati evidenziati visivamente

---

## 🚀 Setup Iniziale

### 🎯 Accesso

**Menu:** `🧊 GELATAMI → ⚙️ Configurazione → 🚀 Setup Iniziale`

### 📝 Quando Usarlo

- **Prima installazione** del sistema
- **Re-configurazione** completa dopo modifiche strutturali
- **Reset configurazione** (richiede conferma se già esistente)

### 🔄 Operazioni Eseguite

1. **Configurazione Cartelle Drive**
   - Richiede ID cartella INPUT (XML fatture)
   - Richiede ID cartella OUTPUT (PDF generati)
   - Verifica permessi accesso

2. **Configurazione Trigger**
   - Richiede frequenza import automatico (1, 5, 10, 15, 30 minuti)
   - Apps Script arrotonda al valore consentito più vicino

3. **Creazione Struttura Fogli**
   - Esegue `SHEETS.ensureAll()` + `SHEETS.applyFormats()`
   - Inizializza foglio `Trigger Status` per dashboard

4. **Scrittura Configurazione**
   - Scrive parametri nel foglio `Config`
   - Include valori default per tutti i parametri operativi

5. **Manutenzione Automatica Finale**
   - Esegue automaticamente tutti i passaggi della Manutenzione Completa
   - Garantisce ambiente pronto all'uso

### ✅ Messaggio di Successo

```
🎉 Setup Completato!

✅ Cartelle configurate:
• Input: "1. XML Input"
• Output: "2. PDF Output"

✅ Trigger: ogni ~15 minuti
✅ Filtri applicati su tutti i fogli
✅ Formati codici verificati
✅ Duplicati verificati e marcati
✅ Integrità dati controllata

NOTA: Se necessario, usa "Pulisci Cache" dal menu prima della prima importazione.
```

---

## 🔍 Verifica Setup Fogli (Avanzato)

### 🎯 Funzione Dedicata

**Codice:** `SETUP.verifyAlignment()`

### 📋 Cosa Fa

- Confronta **intestazioni correnti** vs **schemi attesi** (`SHEETS.SCHEMAS`)
- Identifica fogli:
  - `MISSING`: foglio non esistente
  - `MISALIGNED`: intestazioni non corrispondenti (colonne mancanti/extra)
  - `OK`: foglio corretto
- Prova a riallineare con `SHEETS._ensureHeaders()`
- Logga riepilogo dettagliato nel foglio `Log`

### 📊 Output

```json
{
  "summary": [
    { "sheet": "Fatture", "status": "OK" },
    { "sheet": "Log", "status": "MISALIGNED", "missing": ["RunId"], "extra": [] },
    { "sheet": "Magazzino", "status": "MISSING", "action": "CREATE" }
  ]
}
```

### ✅ Quando Usare

- Dopo modifiche agli schemi (`SHEETS.SCHEMAS`)
- Per diagnostica problemi di struttura fogli
- Prima di import massivi per validare setup

---

## 📦 Moduli di Manutenzione

### 🗂️ Moduli Verificati e Allineati

Tutti i moduli di manutenzione sono stati verificati per coerenza con il sistema Setup:

#### `130_debug.js` - Suite Diagnostica Completa
- **Funzioni principali:**
  - `sanityCheck()`: Controllo integrità sistema
  - `manageDuplicateInvoices()`: Marcatura duplicati fatture
  - `manageDuplicateRows()`: Marcatura duplicati righe
  - `forceTextFormatOnCodes()`: Formattazione codici
  - `syncCategoriesRetroactive()`: Riallineamento categorie storiche
  - `syncSuppliersFromInvoices()`: Sincronizzazione fornitori
- **Allineamento:** ✅ Usa `SHEETS.SHEET_NAMES` e `SHEETS.headerIndex()` correttamente
- **Logging:** Sistema LOG legacy (da migrare a ENHANCED_LOGGER)

#### `128_sheet_cleanup.js` - Pulizia Righe Vuote
- **Funzione principale:**
  - `deleteEmptyRows(sheetName)`: Rimozione righe vuote efficiente
- **Allineamento:** ✅ Usa `getSheetByName()` generico, non dipende da SCHEMAS
- **Logging:** Sistema LOG integrato

#### `124_prodotti_cleanup.js` - Gestione Duplicati Prodotti
- **Funzione principale:**
  - `cleanupProdottiDuplicati()`: Risolve duplicati CodiceFornitore
- **Strategia:** Mantiene il più recente (UltimoAgg), marca vecchi come NonInUso
- **Allineamento:** ✅ Accesso diretto foglio Prodotti, indipendente da SCHEMAS
- **Logging:** Sistema LOG integrato

---

## 🎛️ Menu Manutenzione - Funzioni Disponibili

### Menu: `🔧 Manutenzione`

| Comando | Funzione | Descrizione |
|---------|----------|-------------|
| **✨ Manutenzione Completa** | `runCompleteMaintenance()` | **RACCOMANDATO** - Esegue tutto automaticamente |
| 👥 Aggiorna Fornitori | `runSyncSuppliers()` | Sincronizza anagrafica fornitori con fatture nuove |
| 🏷️ Riallinea Categorie | `runSyncCategoriesRetroactive()` | Aggiorna categorie storiche nei fogli |
| 📦 Sincronizza Prodotti | `runSyncProdotti()` | Allinea prodotti con righe fatture (legacy) |
| 🔄 Duplicati Fatture | `runMarkDuplicateInvoices()` | Marca visivamente duplicati nel foglio Fatture |
| 🗑️ Pulisci Cache | `runClearCache()` | Svuota cache e azzera cursori di ripresa |
| 🗑️ Pulisci Righe Vuote | `runDeleteEmptyRowsFromRigheSheet()` | Rimuove righe vuote dal foglio Righe |

### Menu: `⚙️ Configurazione`

| Comando | Funzione | Descrizione |
|---------|----------|-------------|
| **🚀 Setup Iniziale** | `runInitialSetup()` | **PRIMA INSTALLAZIONE** - Setup guidato completo |
| ⚙️ Impostazioni | `runConfigDialog()` | Apre dialog configurazione parametri |
| ▶️ Attiva Import Auto | `runCreateTrigger()` | Installa trigger automatico import |
| ⏸️ Disattiva Import Auto | `runDeleteTriggers()` | Rimuove trigger automatico |

---

## 🛡️ Protezioni e Sicurezza

### 🔒 Lock Globale

Tutte le operazioni di manutenzione usano `_runSafely()` con lock globale:
- Previene esecuzioni concorrenti
- Timeout configurabile (`MAX_RUNTIME_SEC`)
- Gestione errori centralizzata
- Flush log automatico in `finally`

### ⚠️ Gestione Timeout

Se un'operazione supera il timeout:
- Stato salvato con **cursori di ripresa**
- Operazione riprende dal punto esatto all'esecuzione successiva
- Nessuna perdita dati o duplicazione lavoro

### 📝 Logging Completo

Ogni operazione critica logga:
- **Inizio:** Scope `*_START` con parametri
- **Progresso:** Scope `*_PROGRESS` con conteggi
- **Errori:** Scope `*_ERROR` con dettagli eccezione
- **Fine:** Scope `*_DONE` con riepilogo

---

## 📊 Schemi Fogli (`SHEETS.SCHEMAS`)

### Fogli Principali Allineati

```javascript
'Config': ['Key', 'Value', 'Description']
'Fatture': [
  'FileID', 'Sede', 'FileName', 'LinkXML', 'LinkPDF', 'PDFStato', 'StatoPDF',
  'FornitoreID', 'DenominazioneFornitore', 'Famiglia', 'Categoria',
  'Reparto', 'Destinazione',
  'RegimeFiscale', 'Data', 'Anno', 'Mese', 'NumeroDoc', 'TipoDoc',
  'TotImponibile', 'TotImposta', 'Valuta', 'TotDocumento',
  'RigheImportateNum', 'TotRigheNetto',
  'RigheImportate', 'ImportaRigheSrc', 'ImportedAt'
]
'Righe': [
  'FileID', 'Sede', 'DataDoc', 'Anno', 'Mese', 'NumeroDoc',
  'FornitoreID', 'DenominazioneFornitore', 'Famiglia', 'Categoria',
  'NumeroLinea', 'CodiceInternoBreve', 'Codice Articolo Fornitore',
  'CodiceTipo', 'CodiceValore', 'Descrizione', 'Quantita',
  'PrezzoUnitario', 'PrezzoTotale', 'AliquotaIVA',
  'Reparto', 'TipoRiga'
]
'Fornitori': ['FornitoreID', 'Denominazione', 'Famiglia', 'Categoria', 'Reparto', 'ImportaRighe']
'Prodotti': [
  'CodiceInterno', 'CodiceInternoBreve', 'ChiaveDescrizione', 'CodiceFornitore', 'Descrizione', 'UM',
  'FornitoreID', 'DenominazioneFornitore', 'CategoriaProdotto',
  'Note', 'CreatoIl', 'UltimoAgg', 'Ingrediente', 'NonInUso',
  'UMBase', 'PZxCT', 'KGxPZ', 'PZxFila', 'FilePerCT', 'RichiedeSetup',
  'CostoUnitario', 'UMCosto'
]
'Log': ['Timestamp', 'RunId', 'Scope', 'Level', 'Message', 'Context']  // ✅ AGGIORNATO a 6 colonne
'Dati Mensili': [
  'Sede', 'AnnoMese', 'Anno', 'Mese', 'Fatturato', 'Costo Personale',
  'Costi', 'Fatture Incassate', 'Spese Bancarie', 'Altre Spese N/F', 'N. Doc'
]
```

---

## 🔧 Parametri Configurazione (`Config`)

### Parametri Creati da Setup Iniziale

| Key | Default | Descrizione |
|-----|---------|-------------|
| `CARTELLA_INPUT_ID` | (richiesto) | ID cartella "1. XML Input" su Drive |
| `CARTELLA_OUTPUT_ID` | (richiesto) | ID cartella "2. PDF Output" su Drive |
| `TRIGGER_EVERY_MIN` | 15 | Frequenza import automatico (1,5,10,15,30) |
| `MAX_RUNTIME_SEC` | 240 | Secondi massimi per processo (timeout) |
| `IMPORT_RIGHE_DEFAULT` | false | Importare righe per nuovi fornitori? |
| `CATEGORIE_ESCLUSE_MAGAZZINO` | sconto, attrezzatura, canvass, omaggio, servizi | Categorie da escludere dal Magazzino |
| `MODALITA_DEBUG` | false | Abilita log dettagliati |
| `ROWS_CHUNK_SIZE` | 100 | Fatture per blocco (Import Righe) |
| `ROWS_FLUSH_EVERY` | 2000 | Righe per salvataggio (Import Righe) |
| `PDF_ENABLED` | true | Abilita creazione PDF durante import auto |
| `PDF_CHUNK_SIZE` | 80 | Fatture per blocco (Crea PDF) |
| `PDF_FLUSH_EVERY` | 200 | Link PDF per aggiornamento foglio |
| `ROWS_TOLLERANZA_EURO` | 1.00 | Tolleranza € per mismatch Totale/Somma Righe |
| `ADMIN_EMAIL` | (vuoto) | Email destinatario notifiche trigger |
| `TRIGGER_NOTIFY_ON_ACTIVE` | FALSE | Inviare email con trigger attivo? |

---

## 🎯 Best Practices

### ✅ Quando Eseguire Manutenzione Completa

1. **Dopo ogni modifica strutturale** al codice o agli schemi
2. **Prima di import massivi** per validare setup
3. **Periodicamente** (es. settimanale) come routine preventiva
4. **Dopo errori persistenti** per reset stato sistema
5. **Dopo aggiornamento versione** progetto

### ❌ Quando NON Serve

- Durante operazioni di import in corso
- Se il sistema funziona correttamente
- Più volte al giorno senza motivo

### 🔄 Workflow Raccomandato

```
1. Setup Iniziale (solo prima volta)
   ↓
2. Manutenzione Completa (periodica/dopo modifiche)
   ↓
3. Import/Report normali
   ↓
4. Se problemi → Manutenzione Completa
```

---

## 🐛 Troubleshooting

### Problema: "Colonne non corrispondono nel foglio Log"

**Causa:** Schema Log non allineato (vecchio formato 5 colonne vs nuovo 6 colonne)

**Soluzione:**
1. Esegui **Manutenzione Completa** (include `verifyAlignment()`)
2. Verifica foglio `Log` per scope `MAINT_SETUP_VERIFY`
3. Se persiste, esegui manualmente `SETUP.verifyAlignment()`

### Problema: "Foglio [nome] non trovato"

**Causa:** Foglio mancante o rinominato

**Soluzione:**
1. Esegui **Setup Iniziale** (crea fogli mancanti)
2. O esegui **Manutenzione Completa** (include `SHEETS.ensureAll()`)

### Problema: "Codici convertiti in numeri (001 → 1)"

**Causa:** Excel/Sheets forza conversione automatica

**Soluzione:**
1. Esegui **Manutenzione Completa** (include `forceTextFormatOnCodes()`)
2. O esegui manualmente `DEBUG.forceTextFormatOnCodes()`

### Problema: "Duplicati non evidenziati"

**Causa:** Marcatura duplicati non eseguita

**Soluzione:**
1. Esegui **Manutenzione Completa** (include marcatura automatica)
2. O usa `🔧 Manutenzione → 🔄 Duplicati Fatture`

---

## 📚 Riferimenti Tecnici

### File Chiave

- **`170_setup.js`**: Setup guidato e verifica allineamento
- **`010_main.js`**: Menu UI e wrapper funzioni (`runCompleteMaintenance`)
- **`020_config.js`**: Definizione schemi fogli (`SHEETS.SCHEMAS`)
- **`017_enhanced_logger.js`**: Sistema logging granulare con RunId
- **`130_debug.js`**: Suite manutenzione e diagnostica

### Dipendenze Moduli

```
SETUP → SHEETS, UTIL, CONFIG, LOG, DEBUG, TRIGGER_DASHBOARD, ENHANCED_LOGGER
DEBUG → SHEETS, CONFIG, DUPLICATE_MANAGER, SHEET_ITERATOR, ERROR_HANDLER
SHEETS → App (frozen config)
```

---

## 📝 Changelog

### v1.0 (28 novembre 2025)
- ✅ Sistema unificato di Manutenzione Completa one-click
- ✅ Integrazione `SETUP.verifyAlignment()` nel workflow
- ✅ Allineamento schema `Log` a 6 colonne con `RunId`
- ✅ Logging granulare con `ENHANCED_LOGGER` (formato: Timestamp, RunId, Scope, Level, Message, Context)
- ✅ Unificazione formati logging (rimossi appendRow legacy a 5 colonne)
- ✅ Verifica completa moduli di manutenzione per coerenza Setup
- ✅ Documentazione operativa completa

---

**Autore:** Gelatami IT Team  
**Versione Progetto:** GG Controllo Gestione v25.0  
**Ultima revisione:** 28 novembre 2025
