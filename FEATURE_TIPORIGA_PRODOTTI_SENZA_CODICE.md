# Feature: TipoRiga + Prodotti Senza Codice Articolo

**Data Implementazione:** 20 Novembre 2025  
**Versione:** 30.0  
**Moduli Modificati:** `020_config.js`, `070_import_rows.js`, `040_products.js`

---

## 📋 Panoramica

Due miglioramenti fondamentali alla logica di import:

1. **Colonna TipoRiga**: Classifica automaticamente ogni riga importata come ARTICOLO, SCONTO o TESTO
2. **Prodotti senza codice**: Gestisce prodotti anche quando il fornitore non fornisce un codice articolo

---

## 🏗️ 1. Colonna TipoRiga

### Schema Righe (aggiornato)
```javascript
'Righe': [
  'FileID', 'Sede', 'DataDoc', 'Anno', 'Mese', 'NumeroDoc',
  'FornitoreID', 'DenominazioneFornitore', 'Famiglia', 'Categoria',
  'NumeroLinea', 'Codice Articolo Fornitore',
  'CodiceTipo', 'CodiceValore', 'Descrizione', 'Quantita',
  'PrezzoUnitario', 'PrezzoTotale', 'AliquotaIVA',
  'Reparto', 'TipoRiga'  // ✅ NUOVO
]
```

### Logica di Classificazione

```javascript
// ARTICOLO: prodotti con quantità e prezzo
if (Quantita > 0 && PrezzoTotale !== 0) {
  TipoRiga = "ARTICOLO"
}

// SCONTO: righe di sconto (senza quantità, prezzo negativo)
else if (Quantita === 0 && PrezzoTotale < 0) {
  TipoRiga = "SCONTO"
}

// TESTO: righe descrittive senza valore economico
else if (Quantita === 0 && PrezzoTotale === 0) {
  TipoRiga = "TESTO"
}
```

### Esempi Pratici

#### Esempio 1: Riga ARTICOLO
```
NumeroLinea: 1
Descrizione: "LATTE INTERO 1L"
Quantita: 10
PrezzoUnitario: 1.50
PrezzoTotale: 15.00
→ TipoRiga: "ARTICOLO"  ✅ Crea prodotto
```

#### Esempio 2: Riga SCONTO
```
NumeroLinea: 2
Descrizione: "Sconto promozionale"
Quantita: 0
PrezzoUnitario: 0
PrezzoTotale: -2.50
→ TipoRiga: "SCONTO"  ❌ NON crea prodotto
```

#### Esempio 3: Riga TESTO
```
NumeroLinea: 3
Descrizione: "Consegna prevista: 15/11/2025"
Quantita: 0
PrezzoUnitario: 0
PrezzoTotale: 0
→ TipoRiga: "TESTO"  ❌ NON crea prodotto
```

---

## 🔧 2. Gestione Prodotti Senza Codice Articolo

### Problema Precedente
```javascript
// ❌ PRIMA: se Codice Articolo Fornitore vuoto → prodotto non creato o errore
CodiceInterno = FornitoreID + "-" + CodiceArticoloFornitore
// Se CodiceArticoloFornitore è vuoto → "IT12345-" (invalido)
```

### Nuova Logica
```javascript
// ✅ DOPO: fallback su slug(Descrizione)

// CASO 1: Codice presente
if (CodiceArticoloFornitore !== "") {
  CodiceInterno = FornitoreID + "-" + CodiceArticoloFornitore
}

// CASO 2: Codice vuoto → usa slug della descrizione
else {
  const slug = normalizeDescription(Descrizione) // max 50 caratteri
  CodiceInterno = FornitoreID + "-" + slug
}
```

### Funzione slug() Implementata

```javascript
function _proposeInternalCode(fornitoreId, codiceForn, descr) {
  const baseFor = UTIL.normKey(fornitoreId).replace(/\s+/g, '');
  const cleanCodiceForn = String(codiceForn ?? '')
    .trim()
    .replace(/^'+/, '') // Rimuove apostrofi iniziali di Sheets
    .replace(/[^a-zA-Z0-9-]/g, '');

  // ✅ CASO 1: Codice presente
  if (cleanCodiceForn) {
    return `${baseFor}-${cleanCodiceForn}`.slice(0, 60);
  }

  // ✅ CASO 2: Codice vuoto → slug(Descrizione)
  const slug = String(descr ?? '')
    .normalize('NFD')                    // Decompose accenti (è → e)
    .replace(/[\u0300-\u036f]/g, '')    // Rimuove diacritici
    .toUpperCase()                       // MAIUSCOLO
    .replace(/[^A-Z0-9]+/g, '-')        // Sostituisce non-alfanumerici con -
    .replace(/^-+|-+$/g, '')            // Rimuove - iniziali/finali
    .slice(0, 50);                      // Max 50 caratteri

  return `${baseFor}-${slug || 'ITEM'}`;
}
```

### Esempi di CodiceInterno Generato

#### Con Codice Articolo Fornitore
```javascript
FornitoreID: "IT12345678901"
CodiceArticoloFornitore: "LAT1000"
Descrizione: "Latte Intero 1L"

→ CodiceInterno: "IT12345678901-LAT1000"
```

#### Senza Codice (slug da Descrizione)
```javascript
FornitoreID: "IT12345678901"
CodiceArticoloFornitore: ""  // ⚠️ Vuoto
Descrizione: "Caffè Espresso Arabica 100% - Confezione da 250g"

→ slug: "CAFFE-ESPRESSO-ARABICA-100-CONFEZIONE-DA-250G"
→ CodiceInterno: "IT12345678901-CAFFE-ESPRESSO-ARABICA-100-CONFEZIONE-DA-250G"
```

#### Con Accenti e Caratteri Speciali
```javascript
FornitoreID: "IT98765432100"
CodiceArticoloFornitore: ""
Descrizione: "Parmigiano Reggiano DOP 36 mesi - 1kg à € 45,00"

→ Normalizzazione:
  1. NFD: "Parmigiano Reggiano DOP 36 mesi - 1kg a € 45,00"
  2. Rimuove diacritici: "Parmigiano Reggiano DOP 36 mesi - 1kg a € 45,00"
  3. UPPERCASE: "PARMIGIANO REGGIANO DOP 36 MESI - 1KG A € 45,00"
  4. Solo [A-Z0-9-]: "PARMIGIANO-REGGIANO-DOP-36-MESI-1KG-A-45-00"
  5. Slice(50): "PARMIGIANO-REGGIANO-DOP-36-MESI-1KG-A-45-00"

→ CodiceInterno: "IT98765432100-PARMIGIANO-REGGIANO-DOP-36-MESI-1KG-A-45-00"
```

---

## 🔄 Integrazione con TipoRiga

### Filtro Creazione Prodotti

```javascript
// ✅ PRIMA: Creazione prodotti per tutte le righe (eccetto spazzatura)
if (!isJunk) {
  PRODUCTS.ensureProduct(...)
}

// ✅ DOPO: Solo righe ARTICOLO creano prodotti
if (!isJunk && tipoRiga === 'ARTICOLO') {
  PRODUCTS.ensureProduct(...)
}
```

### Comportamento per Tipo

| TipoRiga | Crea Prodotto? | Include in Magazzino? | Note |
|----------|----------------|------------------------|------|
| **ARTICOLO** | ✅ SÌ | ✅ SÌ | Prodotti fisici acquistati |
| **SCONTO** | ❌ NO | ❌ NO | Sconti applicati alla fattura |
| **TESTO** | ❌ NO | ❌ NO | Note/descrizioni senza valore economico |

---

## 📊 Scenario Completo: Import Fattura con Righe Miste

### Fattura XML
```xml
<FatturaElettronicaBody>
  <DatiBeniServizi>
    <DettaglioLinee>
      <NumeroLinea>1</NumeroLinea>
      <CodiceArticolo>
        <CodiceTipo>FORNITORE</CodiceTipo>
        <CodiceValore>LAT1000</CodiceValore>
      </CodiceArticolo>
      <Descrizione>Latte Intero 1L</Descrizione>
      <Quantita>20</Quantita>
      <PrezzoUnitario>1.50</PrezzoUnitario>
      <PrezzoTotale>30.00</PrezzoTotale>
    </DettaglioLinee>
    
    <DettaglioLinee>
      <NumeroLinea>2</NumeroLinea>
      <!-- ⚠️ Nessun CodiceArticolo -->
      <Descrizione>Yogurt Greco Bianco 150g</Descrizione>
      <Quantita>50</Quantita>
      <PrezzoUnitario>0.80</PrezzoUnitario>
      <PrezzoTotale>40.00</PrezzoTotale>
    </DettaglioLinee>
    
    <DettaglioLinee>
      <NumeroLinea>3</NumeroLinea>
      <Descrizione>Sconto Cliente Fedele</Descrizione>
      <Quantita>0</Quantita>
      <PrezzoUnitario>0</PrezzoUnitario>
      <PrezzoTotale>-5.00</PrezzoTotale>
    </DettaglioLinee>
    
    <DettaglioLinee>
      <NumeroLinea>4</NumeroLinea>
      <Descrizione>Consegna a temperatura controllata</Descrizione>
      <Quantita>0</Quantita>
      <PrezzoUnitario>0</PrezzoUnitario>
      <PrezzoTotale>0</PrezzoTotale>
    </DettaglioLinee>
  </DatiBeniServizi>
</FatturaElettronicaBody>
```

### Risultato Import - Foglio Righe

| NumeroLinea | Codice Articolo Fornitore | Descrizione | Quantita | PrezzoTotale | **TipoRiga** |
|-------------|---------------------------|-------------|----------|--------------|--------------|
| 1 | LAT1000 | Latte Intero 1L | 20 | 30.00 | **ARTICOLO** |
| 2 | *(vuoto)* | Yogurt Greco Bianco 150g | 50 | 40.00 | **ARTICOLO** |
| 3 | *(vuoto)* | Sconto Cliente Fedele | 0 | -5.00 | **SCONTO** |
| 4 | *(vuoto)* | Consegna a temperatura controllata | 0 | 0.00 | **TESTO** |

### Risultato - Foglio Prodotti

| CodiceInterno | CodiceFornitore | Descrizione | NonInUso | Note |
|---------------|-----------------|-------------|----------|------|
| IT12345-LAT1000 | LAT1000 | Latte Intero 1L | TRUE | ✅ Con codice fornitore |
| IT12345-YOGURT-GRECO-BIANCO-150G | *(vuoto)* | Yogurt Greco Bianco 150g | TRUE | ✅ Slug da descrizione |

**⚠️ Note:**
- Riga 3 (SCONTO): **NON crea prodotto**
- Riga 4 (TESTO): **NON crea prodotto**
- Entrambi i prodotti creati con `NonInUso = TRUE` (richiedono attivazione manuale)

---

## 🧪 Test di Validazione

### Test 1: Calcolo TipoRiga
```javascript
// Setup
const testCases = [
  { qta: 10, prezzo: 15.00, expected: 'ARTICOLO' },
  { qta: 0, prezzo: -5.00, expected: 'SCONTO' },
  { qta: 0, prezzo: 0, expected: 'TESTO' },
  { qta: 5, prezzo: 0, expected: 'ARTICOLO' },  // Edge: qta > 0
  { qta: 0, prezzo: 10.00, expected: 'TESTO' }, // Edge: prezzo > 0 ma qta = 0
];

testCases.forEach(t => {
  let tipoRiga = 'TESTO';
  if (t.qta > 0 && t.prezzo !== 0) tipoRiga = 'ARTICOLO';
  else if (t.qta === 0 && t.prezzo < 0) tipoRiga = 'SCONTO';
  else if (t.qta === 0 && t.prezzo === 0) tipoRiga = 'TESTO';
  
  console.log(`qta=${t.qta}, prezzo=${t.prezzo} → ${tipoRiga} (expected: ${t.expected})`);
});
```

### Test 2: Slug Normalizzazione
```javascript
// Test normalizzazione descrizioni
const testDescriptions = [
  { input: "Caffè Espresso", expected: "CAFFE-ESPRESSO" },
  { input: "Parmigiano à 45€", expected: "PARMIGIANO-A-45" },
  { input: "  Spazi   multipli  ", expected: "SPAZI-MULTIPLI" },
  { input: "Caratteri$%&speciali!?", expected: "CARATTERI-SPECIALI" },
  { input: "Très bien", expected: "TRES-BIEN" },
];

testDescriptions.forEach(t => {
  const slug = t.input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  
  console.log(`"${t.input}" → "${slug}" (expected: "${t.expected}")`);
});
```

### Test 3: CodiceInterno con e senza codice fornitore
```javascript
// Test generazione CodiceInterno
const productTests = [
  {
    fornitoreId: 'IT12345',
    codiceForn: 'LAT1000',
    descr: 'Latte Intero',
    expected: 'IT12345-LAT1000'
  },
  {
    fornitoreId: 'IT12345',
    codiceForn: '',  // ⚠️ Vuoto
    descr: 'Yogurt Greco Bianco 150g',
    expected: 'IT12345-YOGURT-GRECO-BIANCO-150G'
  },
  {
    fornitoreId: 'IT98765',
    codiceForn: null,  // ⚠️ Null
    descr: 'Caffè Espresso Arabica 100%',
    expected: 'IT98765-CAFFE-ESPRESSO-ARABICA-100'
  }
];

// Esegui con _proposeInternalCode(...)
```

---

## 📝 Impatto su Altri Moduli

### Magazzino (`110_warehouse.js`)
**✅ Nessuna modifica necessaria**
- Il magazzino già filtra per `CategoriaProdotto` e `NonInUso`
- Con TipoRiga, solo righe ARTICOLO creano prodotti
- Riduzione automatica di righe "rumore" (sconti/testo)

### Reporting (`100_reporting.js`)
**✅ Possibile estensione futura**
```javascript
// Report per analizzare sconti applicati
const totaleSconti = righe
  .filter(r => r.TipoRiga === 'SCONTO')
  .reduce((sum, r) => sum + r.PrezzoTotale, 0);

console.log(`Sconti totali concessi: € ${Math.abs(totaleSconti)}`);
```

### Dashboard (`090_dashboard.js`)
**✅ Possibile widget futuro**
```
📊 Statistiche Import
- Righe ARTICOLO: 1250
- Righe SCONTO: 85
- Righe TESTO: 42
- Prodotti unici creati: 1150
```

---

## 🚀 Deployment e Attivazione

### 1. Deploy Codice
```bash
clasp push
```

### 2. Verifica Struttura Fogli
1. Apri sidebar
2. Sezione **⚙️ Config**
3. Click su **Struttura** (verde)
4. Verifica creazione colonna `TipoRiga` in Righe

### 3. Test Import
1. Esegui import intestazioni + righe
2. Apri foglio **Righe**
3. Verifica colonna `TipoRiga` popolata correttamente
4. Controlla foglio **Prodotti**:
   - Prodotti con codice fornitore → CodiceInterno con codice
   - Prodotti senza codice → CodiceInterno con slug descrizione
   - Tutti con `NonInUso = TRUE`

### 4. Query di Verifica

**Conta righe per tipo:**
```javascript
// Esegui in Apps Script Editor
function verificaTipoRiga() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Righe');
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const tipoRigaIdx = header.indexOf('TipoRiga');
  
  const counts = { ARTICOLO: 0, SCONTO: 0, TESTO: 0, ALTRO: 0 };
  for (let i = 1; i < data.length; i++) {
    const tipo = data[i][tipoRigaIdx];
    counts[tipo] = (counts[tipo] || 0) + 1;
  }
  
  Logger.log('Distribuzione TipoRiga:');
  Logger.log(JSON.stringify(counts, null, 2));
}
```

**Conta prodotti con/senza codice fornitore:**
```javascript
function verificaCodiciProdotti() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Prodotti');
  const data = sh.getDataRange().getValues();
  const header = data[0];
  const codFornIdx = header.indexOf('CodiceFornitore');
  
  let conCodice = 0, senzaCodice = 0;
  for (let i = 1; i < data.length; i++) {
    const codForn = String(data[i][codFornIdx] || '').trim();
    if (codForn) conCodice++;
    else senzaCodice++;
  }
  
  Logger.log(`Prodotti con codice fornitore: ${conCodice}`);
  Logger.log(`Prodotti senza codice (slug): ${senzaCodice}`);
}
```

---

## 🔧 Manutenzione e Estensioni Future

### Possibili Nuovi Tipi
```javascript
// TipoRiga = "SERVIZIO" se:
// - Descrizione contiene parole chiave: "servizio", "trasporto", "consegna"
// - Quantita = 1, PrezzoTotale > 0

// TipoRiga = "OMAGGIO" se:
// - Quantita > 0, PrezzoTotale = 0
```

### Filtri Avanzati Magazzino
```javascript
// Escludere sconti dal calcolo magazzino (già fatto automaticamente con TipoRiga)
const righeArticolo = righe.filter(r => r.TipoRiga === 'ARTICOLO');
```

### Report Sconti Concessi
```javascript
// Analisi sconti per fornitore
function reportScontiPerFornitore() {
  const righe = getRigheBySql(`SELECT * FROM Righe WHERE TipoRiga = 'SCONTO'`);
  const byFornitore = {};
  righe.forEach(r => {
    byFornitore[r.FornitoreID] = (byFornitore[r.FornitoreID] || 0) + Math.abs(r.PrezzoTotale);
  });
  return byFornitore;
}
```

---

## 📚 File Modificati

| File | Modifiche | Righe |
|------|-----------|-------|
| `020_config.js` | Schema Righe + TipoRiga, formattazione | +2 cols |
| `070_import_rows.js` | Calcolo TipoRiga + filtro ARTICOLO | +20 righe |
| `040_products.js` | Slug robusto con normalize('NFD') | +15 righe |

**Totale:** 3 file, ~40 righe modificate/aggiunte

---

**✅ Feature completata e pronta per deploy!**
