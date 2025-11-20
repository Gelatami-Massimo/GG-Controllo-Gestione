# Feature: Calcolo Costi Unitari con Conversioni UM

**Data Implementazione:** 20 Novembre 2025  
**Versione:** 31.0  
**Moduli Modificati:** `020_config.js`, `040_products.js`, `070_import_rows.js`

---

## 📋 Panoramica

Sistema completo per calcolare **€/KG** o **€/PZ** dai dati fattura, con supporto conversioni tra unità di misura (KG, PZ, CT).

**Principio fondamentale:** Nessuna conversione viene "indovinata". Se mancano dati di configurazione, il prodotto viene marcato con `RichiedeSetup = TRUE`.

---

## 🏗️ Schema Prodotti Esteso

### Nuove Colonne

| Colonna | Tipo | Descrizione | Obbligatorio | Esempio |
|---------|------|-------------|--------------|---------|
| **UMBase** | Testo | Unità di misura base del prodotto (KG o PZ) | ✅ Sì | `KG` |
| **PZxCT** | Numero | Pezzi per cartone | Se UM fattura è CT | `12` |
| **KGxPZ** | Numero | Kilogrammi per pezzo | Se conversione KG↔PZ | `0.150` |
| **PZxFila** | Numero | Pezzi per fila (logistica) | ❌ Opzionale | `6` |
| **FilePerCT** | Numero | File per cartone (logistica) | ❌ Opzionale | `2` |
| **RichiedeSetup** | Boolean | TRUE se mancano dati per calcolo costi | Auto | `TRUE` |
| **CostoUnitario** | Numero | Costo unitario calcolato | Auto | `2.5000` |
| **UMCosto** | Testo | UM del costo (KG o PZ) | Auto | `KG` |

### Schema Completo
```javascript
'Prodotti': [
  'CodiceInterno', 'CodiceFornitore', 'Descrizione', 'UM',
  'FornitoreID', 'DenominazioneFornitore', 'CategoriaProdotto',
  'Note', 'CreatoIl', 'UltimoAgg', 'Ingrediente', 'NonInUso',
  'UMBase', 'PZxCT', 'KGxPZ', 'PZxFila', 'FilePerCT', 'RichiedeSetup',
  'CostoUnitario', 'UMCosto'
]
```

---

## 🔢 Regole di Conversione

### Caso 1: Fattura in KG, UMBase = KG
```
Fattura: 25 KG @ 62.50€
Calcolo: €/KG = 62.50 / 25 = 2.50€

CostoUnitario = 2.50
UMCosto = "KG"
RichiedeSetup = FALSE
```

**Configurazione richiesta:**
- ✅ `UMBase = "KG"`

---

### Caso 2: Fattura in PZ, UMBase = PZ
```
Fattura: 100 PZ @ 150.00€
Calcolo: €/PZ = 150.00 / 100 = 1.50€

CostoUnitario = 1.50
UMCosto = "PZ"
RichiedeSetup = FALSE
```

**Configurazione richiesta:**
- ✅ `UMBase = "PZ"`

---

### Caso 3a: Fattura in CT, UMBase = KG
```
Fattura: 10 CT @ 300.00€
Configurazione:
  PZxCT = 12 (12 pezzi per cartone)
  KGxPZ = 0.500 (ogni pezzo pesa 500g)

Calcolo:
  PZ_TOT = 10 CT × 12 PZ/CT = 120 PZ
  KG_TOT = 120 PZ × 0.500 KG/PZ = 60 KG
  €/KG = 300.00 / 60 = 5.00€

CostoUnitario = 5.00
UMCosto = "KG"
RichiedeSetup = FALSE
```

**Configurazione richiesta:**
- ✅ `UMBase = "KG"`
- ✅ `PZxCT = 12`
- ✅ `KGxPZ = 0.500`

---

### Caso 3b: Fattura in CT, UMBase = PZ
```
Fattura: 5 CT @ 90.00€
Configurazione:
  PZxCT = 6 (6 bottiglie per cartone)

Calcolo:
  PZ_TOT = 5 CT × 6 PZ/CT = 30 PZ
  €/PZ = 90.00 / 30 = 3.00€

CostoUnitario = 3.00
UMCosto = "PZ"
RichiedeSetup = FALSE
```

**Configurazione richiesta:**
- ✅ `UMBase = "PZ"`
- ✅ `PZxCT = 6`

---

## ⚠️ Gestione RichiedeSetup

Il flag `RichiedeSetup` viene impostato a **TRUE** nei seguenti casi:

### 1. UMBase Non Configurato
```
Prodotto: LATTE-INTERO-1L
UMBase: (vuoto)
→ RichiedeSetup = TRUE
→ CostoUnitario non calcolato
```

### 2. PZxCT Mancante (Fattura in CT)
```
Fattura: 10 CT @ 120.00€
UMBase: KG
PZxCT: (vuoto)
→ RichiedeSetup = TRUE
→ Impossibile convertire CT → PZ
```

### 3. KGxPZ Mancante (CT → KG)
```
Fattura: 10 CT @ 120.00€
UMBase: KG
PZxCT: 12
KGxPZ: (vuoto)
→ RichiedeSetup = TRUE
→ Impossibile convertire PZ → KG
```

### 4. UM Fattura Non Gestita
```
Fattura: 5 LT @ 50.00€
UMBase: KG
→ RichiedeSetup = TRUE
→ UM "LT" non supportata
```

---

## 🛠️ Implementazione Tecnica

### 1. Modulo `040_products.js`

#### Funzione `calculateUnitCost()`
```javascript
/**
 * Calcola il costo unitario con conversioni UM.
 * @returns {{costoUnitario: number|null, umCosto: string|null, richiedeSetup: boolean}}
 */
PRODUCTS.calculateUnitCost(codiceInterno, quantita, umFattura, prezzoTotale)
```

**Logica:**
1. Valida input (quantità > 0, prezzo valido)
2. Legge configurazione prodotto (UMBase, PZxCT, KGxPZ)
3. Applica regole di conversione
4. Restituisce risultato o flag `richiedeSetup`

**Esempio uso:**
```javascript
const result = PRODUCTS.calculateUnitCost('IT12345-YOGURT-150G', 10, 'CT', 45.00);
// result = {
//   costoUnitario: 0.375,
//   umCosto: 'PZ',
//   richiedeSetup: false
// }
```

---

### 2. Modulo `070_import_rows.js`

#### Funzione `_updateProductUnitCost()`
```javascript
/**
 * Aggiorna CostoUnitario, UMCosto, RichiedeSetup nel foglio Prodotti.
 * Chiamata automaticamente durante import righe (solo per ARTICOLO).
 */
_updateProductUnitCost(codiceInterno, quantita, um, prezzoTotale)
```

**Integrazione nel flusso import:**
```javascript
// Dopo creazione prodotto
if (tipoRiga === 'ARTICOLO' && prezzoTotale > 0 && qta > 0) {
  _updateProductUnitCost(codiceInterno, qta, um, prezzoTotale);
}
```

**Campi aggiornati:**
- `CostoUnitario` (se calcolo riuscito)
- `UMCosto` (KG o PZ)
- `RichiedeSetup` (TRUE/FALSE)
- `UltimoAgg` (timestamp)

---

## 📊 Formattazione Colonne

```javascript
FORMAT_RULES[Prodotti] = [
  {
    format: '@',
    cols: ['CodiceInterno', 'UMBase', 'UMCosto', ...]
  },
  {
    format: '#,##0.####',
    cols: ['PZxCT', 'KGxPZ', 'PZxFila', 'FilePerCT']
  },
  {
    format: '€ #,##0.0000;[Red]-€ #,##0.0000;€ 0.0000',
    cols: ['CostoUnitario']
  }
]
```

**Precisione:**
- **Conversioni UM:** 4 decimali (es. `0.1250` per 125g)
- **Costi unitari:** 4 decimali (es. `€ 2.3456/KG`)

---

## 📝 Esempi Pratici

### Esempio 1: Yogurt in Cartoni
```
Prodotto: IT12345-YOGURT-GRECO-150G
Fattura: 20 CT @ 90.00€

Configurazione:
  UMBase: PZ
  PZxCT: 12
  KGxPZ: (non necessario)

Calcolo:
  PZ_TOT = 20 × 12 = 240 PZ
  €/PZ = 90.00 / 240 = 0.3750€

Risultato:
  CostoUnitario = 0.3750
  UMCosto = PZ
  RichiedeSetup = FALSE
```

---

### Esempio 2: Farina in KG (diretto)
```
Prodotto: IT12345-FARINA-00-TIPO-0
Fattura: 50 KG @ 35.00€

Configurazione:
  UMBase: KG

Calcolo:
  €/KG = 35.00 / 50 = 0.70€

Risultato:
  CostoUnitario = 0.7000
  UMCosto = KG
  RichiedeSetup = FALSE
```

---

### Esempio 3: Gelato in Vaschette (CT → KG)
```
Prodotto: IT12345-GELATO-PISTACCHIO-5KG
Fattura: 8 CT @ 240.00€

Configurazione:
  UMBase: KG
  PZxCT: 2 (2 vaschette per cartone)
  KGxPZ: 5.0 (ogni vaschetta = 5kg)

Calcolo:
  PZ_TOT = 8 × 2 = 16 vaschette
  KG_TOT = 16 × 5.0 = 80 KG
  €/KG = 240.00 / 80 = 3.00€

Risultato:
  CostoUnitario = 3.0000
  UMCosto = KG
  RichiedeSetup = FALSE
```

---

### Esempio 4: Configurazione Incompleta
```
Prodotto: IT12345-PRODOTTO-NUOVO
Fattura: 10 CT @ 100.00€

Configurazione:
  UMBase: (vuoto)
  PZxCT: (vuoto)
  KGxPZ: (vuoto)

Risultato:
  CostoUnitario = (vuoto)
  UMCosto = (vuoto)
  RichiedeSetup = TRUE ⚠️

Azione richiesta:
  → Configurare manualmente UMBase e conversioni necessarie
```

---

## 🔄 Workflow Completo

### 1. Import Iniziale
```
1. Fattura importata con riga: 10 CT @ 120.00€
2. Prodotto creato automaticamente:
   - CodiceInterno: IT12345-YOGURT-BIANCO-125G
   - UMBase: (vuoto)
   - RichiedeSetup: TRUE ⚠️
```

### 2. Configurazione Manuale
```
1. Utente apre foglio Prodotti
2. Trova prodotto con RichiedeSetup = TRUE
3. Configura:
   - UMBase: PZ
   - PZxCT: 24
```

### 3. Re-Import o Aggiornamento
```
1. Prossima fattura con stesso prodotto: 5 CT @ 60.00€
2. Sistema calcola:
   - PZ_TOT = 5 × 24 = 120 PZ
   - €/PZ = 60.00 / 120 = 0.50€
3. Aggiorna:
   - CostoUnitario: 0.5000
   - UMCosto: PZ
   - RichiedeSetup: FALSE ✅
```

---

## 🎯 Best Practices

### 1. Configurazione UMBase
- **Prodotti pesati** (farina, zucchero, pasta sfusa) → `UMBase = KG`
- **Prodotti confezionati** (yogurt, bottiglie, lattine) → `UMBase = PZ`
- **Regola generale:** Scegli l'UM più comune nelle fatture del fornitore

### 2. PZxCT
- Verifica sulla confezione o listino fornitore
- Esempi:
  - Yogurt 125g: solitamente 24 o 12 PZ/CT
  - Bottiglie 1L: solitamente 6 o 12 PZ/CT
  - Lattine 330ml: solitamente 24 PZ/CT

### 3. KGxPZ
- Peso netto prodotto (NO tara confezione)
- Esempi:
  - Yogurt 125g: `KGxPZ = 0.125`
  - Bottiglia 1L latte (densità ~1.03): `KGxPZ = 1.030`
  - Vaschetta gelato 5kg: `KGxPZ = 5.000`

### 4. Monitoraggio RichiedeSetup
```sql
-- Query per trovare prodotti da configurare
SELECT CodiceInterno, Descrizione, FornitoreID
FROM Prodotti
WHERE RichiedeSetup = TRUE
  AND NonInUso = FALSE
ORDER BY UltimoAgg DESC
```

---

## 📌 Vincoli e Limitazioni

### Vincoli Attuali
1. ✅ **No conversioni automatiche:** Meglio richiedere configurazione che sbagliare calcolo
2. ✅ **UM supportate:** Solo KG, PZ, CT
3. ✅ **Aggiornamento costi:** Solo su import righe (non retroattivo)

### UM Non Supportate (Future Estensioni)
- `LT` (litri) → richiede densità
- `GR` (grammi) → convertibile ma non implementato
- `NR` (numero) → alias di PZ
- `CF` (colli/cartoni) → alias di CT

### Gestione Casi Edge
- **Prezzo zero:** Non calcola (tipoRiga = OMAGGIO)
- **Quantità zero:** Non calcola (tipoRiga = SCONTO o TESTO)
- **Prezzo negativo:** Non calcola (tipoRiga = SCONTO)
- **UM mancante in fattura:** RichiedeSetup = TRUE

---

## 🧪 Test e Validazione

### Test Case 1: KG Diretto
```javascript
const result = PRODUCTS.calculateUnitCost('TEST-001', 50, 'KG', 100.00);
// Aspettato:
// { costoUnitario: 2.00, umCosto: 'KG', richiedeSetup: false }
```

### Test Case 2: CT → PZ
```javascript
// Setup prodotto:
// UMBase = PZ, PZxCT = 12

const result = PRODUCTS.calculateUnitCost('TEST-002', 10, 'CT', 120.00);
// Aspettato:
// { costoUnitario: 1.00, umCosto: 'PZ', richiedeSetup: false }
```

### Test Case 3: CT → KG
```javascript
// Setup prodotto:
// UMBase = KG, PZxCT = 6, KGxPZ = 0.500

const result = PRODUCTS.calculateUnitCost('TEST-003', 5, 'CT', 90.00);
// Aspettato:
// PZ_TOT = 5 × 6 = 30
// KG_TOT = 30 × 0.500 = 15
// €/KG = 90.00 / 15 = 6.00
// { costoUnitario: 6.00, umCosto: 'KG', richiedeSetup: false }
```

### Test Case 4: Configurazione Mancante
```javascript
// Setup prodotto:
// UMBase = (vuoto)

const result = PRODUCTS.calculateUnitCost('TEST-004', 10, 'CT', 100.00);
// Aspettato:
// { costoUnitario: null, umCosto: null, richiedeSetup: true }
```

---

## 📦 Deploy

### 1. Backup
```bash
git add -A
git commit -m "backup: Pre-deployment v31.0"
git push
```

### 2. Deploy Codice
```bash
clasp push
```

### 3. Verifica Schema
1. Apri Google Sheets
2. Menu: **⚙️ Config → Riallinea Schema**
3. Verifica colonne Prodotti:
   - UMBase, PZxCT, KGxPZ
   - RichiedeSetup, CostoUnitario, UMCosto

### 4. Test Import
1. Seleziona fattura test
2. **Importa → Import Righe**
3. Verifica foglio Prodotti:
   - RichiedeSetup = TRUE per nuovi prodotti
4. Configura UMBase + conversioni manualmente
5. Re-import fattura
6. Verifica CostoUnitario calcolato

---

## 📊 Metriche di Successo

Dopo deploy, verificare:

| Metrica | Target | Come Verificare |
|---------|--------|-----------------|
| Prodotti con UMBase configurato | > 80% prodotti attivi | `COUNT(UMBase != '') / COUNT(*)` |
| Costi unitari calcolati | > 70% prodotti attivi | `COUNT(CostoUnitario != '') / COUNT(*)` |
| RichiedeSetup risolti | < 20% prodotti attivi | `COUNT(RichiedeSetup = TRUE) / COUNT(*)` |
| Errori calcolo | 0 | Verifica LOG con scope `ROWS_UNIT_COST` |

---

## 🔧 Troubleshooting

### Problema: CostoUnitario non aggiornato
**Sintomo:** Dopo import, CostoUnitario rimane vuoto

**Diagnosi:**
```javascript
// Controlla configurazione
SELECT CodiceInterno, UMBase, PZxCT, KGxPZ, RichiedeSetup
FROM Prodotti
WHERE CodiceInterno = 'XXX-YYY-ZZZ'
```

**Soluzioni:**
1. Verifica `UMBase` configurato
2. Se UM fattura = CT, verifica `PZxCT`
3. Se UMBase = KG, verifica `KGxPZ`
4. Controlla LOG per errori

---

### Problema: RichiedeSetup sempre TRUE
**Sintomo:** Anche dopo configurazione, flag non si aggiorna

**Causa:** Configurazione incompleta per il tipo di conversione

**Esempio:**
```
Fattura: 10 CT @ 100.00€
UMBase: KG ✅
PZxCT: 12 ✅
KGxPZ: (vuoto) ❌
→ RichiedeSetup = TRUE (serve KGxPZ per CT→KG)
```

**Soluzione:** Configura TUTTI i campi necessari per la conversione richiesta

---

## 📚 File Modificati

| File | Modifiche | Righe Aggiunte |
|------|-----------|----------------|
| `020_config.js` | Schema Prodotti + FORMAT_RULES | +8 colonne, +3 regole |
| `040_products.js` | `calculateUnitCost()` + `_getProductData()` | +180 righe |
| `070_import_rows.js` | `_updateProductUnitCost()` + integrazione | +85 righe |

**Versione complessiva:** `v31.0` (Unit Cost Calculation)

---

**✅ Feature completa e pronta per deploy!**
