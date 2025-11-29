# Migrazione a CodiceInternoBreve - Guida Completa

## 📋 Panoramica

Migrazione del sistema prodotti da `CodiceInterno` (lungo, basato su slug) a **`CodiceInternoBreve`** (formato AAA-0001, leggibile).

### Nuove Colonne nel Foglio Prodotti

| Colonna | Tipo | Descrizione | Esempio |
|---------|------|-------------|---------|
| `CodiceInternoBreve` | TEXT | Chiave primaria corta (AAA-0001) | `DAV-0001`, `FER-0042` |
| `ChiaveDescrizione` | TEXT | Descrizione normalizzata per matching | `LATTE INTERO 1L` |

## 🎯 Benefici

1. **Codici leggibili**: `DAV-0001` invece di `718760143-PUREA-MANGO-KG-1X6-RO`
2. **Matching robusto**: Trova prodotti anche senza codice fornitore
3. **Performance**: Lookup O(1) invece di scan lineare
4. **Stabilità**: Codici mai rigenerati, progressivi per fornitore

## 📦 File Modificati

### 1. `020_config.js`
```javascript
'Prodotti': [
  'CodiceInterno',           // ← Manteniamo per compatibilità
  'CodiceInternoBreve',     // ← NUOVO: chiave primaria
  'ChiaveDescrizione',      // ← NUOVO: per matching
  'CodiceFornitore',
  // ... resto colonne
]
```

### 2. `040_products_v2.js` (NUOVO)
Refactoring completo del modulo prodotti con:
- `normalizeDescrizione()`: Normalizzazione robusta
- `findOrCreateProduct()`: Funzione principale con doppio matching
- `primeCache()`: 3 mappe (by code, by desc, by codice breve)

### 3. `tools/migrate_to_codice_breve.js` (NUOVO)
Script di migrazione per dati esistenti.

## 🚀 Procedura Migrazione

### Step 1: Backup

```javascript
// In Google Apps Script Editor
function backupProdotti() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Prodotti');
  const backup = sh.copyTo(ss);
  backup.setName('Prodotti_BACKUP_' + new Date().toISOString().slice(0,10));
  Logger.log('✅ Backup creato: ' + backup.getName());
}
```

### Step 2: Esegui Migrazione

1. Apri Google Apps Script Editor
2. Copia `tools/migrate_to_codice_breve.js`
3. Esegui `migrateProductsToCodiceBreve()`
4. Verifica log:

```
📋 Headers trovati: 20
✅ Colonna CodiceInternoBreve inserita in posizione 2
✅ Colonna ChiaveDescrizione inserita in posizione 3
📊 Trovati 0 codici brevi esistenti.
⏳ Processati 100/1523 prodotti...
⏳ Processati 200/1523 prodotti...
...
✅ Migrazione completata! 1523 prodotti aggiornati.
📦 Totale codici brevi: 1523
```

### Step 3: Sostituisci Modulo Products

```bash
# Rinomina vecchio modulo (backup)
mv 040_products.js 040_products_OLD.js

# Attiva nuovo modulo
mv 040_products_v2.js 040_products.js

# Deploy
clasp push
```

### Step 4: Aggiorna Import Righe

Modifica `070_import_rows.js`:

```javascript
// PRIMA (vecchio):
const codiceInterno = PRODUCTS.ensureProduct(
  fornitoreId, fornitoreName, codiceForn, descrizione, um, cache
);

// DOPO (nuovo):
const result = PRODUCTS.findOrCreateProduct(
  fornitoreId, fornitoreName, codiceForn, descrizione, um, cache
);
const codiceInternoBreve = result.codiceInternoBreve;

// Salva nelle Righe:
rowData['CodiceInternoBreve'] = codiceInternoBreve;
```

## 🔍 Esempi Pratici

### Caso 1: Fornitore CON codice articolo

```javascript
// Input
fornitoreId = "718760143"
denominazione = "DAV SNC"
codFornitore = "18023"
descrizione = "GAUFFRE WAFFEL PREC SURG 100G 55PZ DELI"
um = "CT"

// Output
{
  codiceInternoBreve: "DAV-0012",  // Progressivo per DAV
  isNew: false                     // Trovato esistente
}
```

### Caso 2: Fornitore SENZA codice articolo

```javascript
// Input
fornitoreId = "718760143"
denominazione = "DAV SNC"
codFornitore = ""  // ← VUOTO
descrizione = "PUREA MANGO KG.1X6 RO"
um = "KG"

// Processo interno:
// 1. Cerca by code → non trova (codice vuoto)
// 2. Normalizza descrizione → "PUREA MANGO KG 1X6 RO"
// 3. Cerca by "718760143|PUREA MANGO KG 1X6 RO" → trova!

// Output
{
  codiceInternoBreve: "DAV-0001",  // Trovato con match descrizione
  isNew: false
}
```

### Caso 3: Nuovo prodotto

```javascript
// Input (prima fattura di questo prodotto)
fornitoreId = "3629090048"
denominazione = "FERRERO COMMERCIALE ITALIA S.r.l."
codFornitore = "80761761"
descrizione = "KINDER BUENO WH T2X30 VRT NEW COVER"
um = "CU"

// Processo interno:
// 1. Cerca by code → non trova
// 2. Cerca by descrizione → non trova
// 3. Genera sigla: "FER" (da "FERRERO")
// 4. Trova max progressivo FER: 41
// 5. Genera nuovo: "FER-0042"

// Output
{
  codiceInternoBreve: "FER-0042",  // NUOVO
  isNew: true
}

// Scrittura in Prodotti:
// CodiceInternoBreve: "FER-0042"
// ChiaveDescrizione: "KINDER BUENO WH T2X30 VRT NEW COVER"
// CodiceFornitore: "80761761"
```

## 📊 Struttura Mappe Cache

```javascript
{
  byFornitoreCodice: Map {
    "718760143|18023" => { codiceInternoBreve: "DAV-0012", ... },
    "3629090048|80761761" => { codiceInternoBreve: "FER-0042", ... }
  },
  
  byFornitoreDescrizione: Map {
    "718760143|PUREA MANGO KG 1X6 RO" => { codiceInternoBreve: "DAV-0001", ... },
    "718760143|SMOOTHIE AVVENTUROSO 15X150GR RO" => { codiceInternoBreve: "DAV-0002", ... }
  },
  
  byCodeBreve: Map {
    "DAV-0001" => { fornitoreId: "718760143", descrizione: "PUREA MANGO...", ... },
    "FER-0042" => { fornitoreId: "3629090048", descrizione: "KINDER...", ... }
  },
  
  shortCodes: Set ["DAV-0001", "DAV-0002", ..., "FER-0042"],
  
  newRows: []  // Buffer per flush batch
}
```

## ✅ Verifica Post-Migrazione

```javascript
function verificaMigrazione() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Prodotti');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  
  const idxBreve = headers.indexOf('CodiceInternoBreve');
  const idxChiave = headers.indexOf('ChiaveDescrizione');
  
  if (idxBreve === -1 || idxChiave === -1) {
    Logger.log('❌ Colonne mancanti!');
    return;
  }
  
  let vuotiBreve = 0;
  let vuotiChiave = 0;
  const codiciBrevi = new Set();
  
  for (let i = 1; i < data.length; i++) {
    const breve = String(data[i][idxBreve] || '').trim();
    const chiave = String(data[i][idxChiave] || '').trim();
    
    if (!breve) vuotiBreve++;
    if (!chiave) vuotiChiave++;
    
    if (breve) {
      if (codiciBrevi.has(breve)) {
        Logger.log(`⚠️ DUPLICATO: ${breve} alla riga ${i+1}`);
      }
      codiciBrevi.add(breve);
    }
  }
  
  Logger.log(`✅ Prodotti totali: ${data.length - 1}`);
  Logger.log(`✅ CodiceInternoBreve popolati: ${codiciBrevi.size}`);
  Logger.log(`⚠️ CodiceInternoBreve vuoti: ${vuotiBreve}`);
  Logger.log(`⚠️ ChiaveDescrizione vuote: ${vuotiChiave}`);
  Logger.log(`✅ Codici brevi univoci: ${codiciBrevi.size === (data.length - 1 - vuotiBreve)}`);
}
```

## 🔧 Rollback (se necessario)

```javascript
function rollbackMigrazione() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const backup = ss.getSheetByName('Prodotti_BACKUP_2025-11-22'); // Usa nome backup
  const current = ss.getSheetByName('Prodotti');
  
  // Elimina foglio corrente
  ss.deleteSheet(current);
  
  // Copia backup e rinomina
  const restored = backup.copyTo(ss);
  restored.setName('Prodotti');
  
  Logger.log('✅ Rollback completato. Backup ripristinato.');
}
```

## 📝 Checklist Finale

- [ ] Backup foglio Prodotti creato
- [ ] Script migrazione eseguito con successo
- [ ] Verifica log migrazione (0 errori)
- [ ] Funzione `verificaMigrazione()` eseguita
- [ ] Tutti i prodotti hanno CodiceInternoBreve
- [ ] Tutti i prodotti hanno ChiaveDescrizione
- [ ] Nessun codice breve duplicato
- [ ] Modulo `040_products.js` sostituito
- [ ] Import righe aggiornato per usare `findOrCreateProduct()`
- [ ] Deploy effettuato: `clasp push`
- [ ] Test import nuova fattura con codice fornitore
- [ ] Test import nuova fattura senza codice fornitore
- [ ] Verifica no duplicati prodotti
- [ ] Backup vecchio modulo conservato

## 🆘 Troubleshooting

### Problema: Codici brevi duplicati

**Causa**: Migrazione eseguita due volte o generazione non univoca.

**Soluzione**:
```javascript
// Rigenera codici duplicati con suffisso
function fixDuplicates() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Prodotti');
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const idxBreve = headers.indexOf('CodiceInternoBreve');
  
  const seen = new Map();
  
  for (let i = 1; i < data.length; i++) {
    const breve = String(data[i][idxBreve] || '').trim();
    if (!breve) continue;
    
    if (seen.has(breve)) {
      // Duplicato trovato
      const newBreve = `${breve}-${i}`;
      sh.getRange(i + 1, idxBreve + 1).setValue(newBreve);
      Logger.log(`🔧 Fixed: ${breve} → ${newBreve}`);
    } else {
      seen.set(breve, i);
    }
  }
}
```

### Problema: Import righe non trova prodotti

**Causa**: Cache non aggiornata o chiavi normalizzazione diverse.

**Soluzione**:
```javascript
// Debug matching
const cache = PRODUCTS.primeCache();
Logger.log(`byFornitoreCodice size: ${cache.byFornitoreCodice.size}`);
Logger.log(`byFornitoreDescrizione size: ${cache.byFornitoreDescrizione.size}`);

// Test manuale
const testResult = PRODUCTS.findOrCreateProduct(
  "718760143", "DAV SNC", "", "PUREA MANGO KG.1X6 RO", "KG", cache
);
Logger.log(JSON.stringify(testResult));
```

## 📚 Riferimenti

- Specifica originale: Issue #42 "Gestione prodotti senza codice fornitore"
- Modulo originale: `040_products_OLD.js` (backup)
- Test: `TEST_PRODUCTS_CODICE_BREVE.js` (da creare)
