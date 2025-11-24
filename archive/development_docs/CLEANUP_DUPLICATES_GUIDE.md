# 🧹 GUIDA: ELIMINARE RIGHE DUPLICATE E REIMPORTARE

## ❓ PERCHÉ HAI CENTINAIA DI RIGHE DUPLICATE?

Il sistema **non previene duplicati automaticamente**. Se esegui "Importa Righe Prodotti" più volte sulla stessa fattura, le righe vengono **aggiunte** ogni volta.

### Cause Comuni:
1. ❌ Eseguito import multipli senza reset flags
2. ❌ Reset manuale del flag `RigheImportate` su fatture già importate
3. ❌ Modificato stato `ImportaRigheSrc` durante debug
4. ❌ Cancellato righe dal foglio ma non resettato i flag

---

## 🛠️ PROCEDURA COMPLETA DI PULIZIA

### **STEP 1: Backup Completo** ⚠️
```
1. File > Crea una copia
2. Rinomina: "BACKUP - [data] - Prima Pulizia Duplicati"
3. IMPORTANTE: Non saltare questo step!
```

### **STEP 2: Identifica Duplicati**
```
Menu > Strumenti Avanzati > 🔍 Trova Righe Duplicate

Output: Foglio "Righe_Duplicate" con:
- FileID
- NumeroDoc
- NumeroLinea
- CodiceValore
- Descrizione
- RowIndex (indice riga da eliminare)
```

### **STEP 3: Verifica Duplicati**
Apri il foglio "Righe_Duplicate" e controlla:
- ✅ Sono effettivamente duplicati (stessa chiave FileID+NumeroLinea)?
- ✅ Quanti duplicati per fattura? (se troppe, meglio reimport totale)
- ✅ Ci sono pattern (es: solo fornitori specifici)?

### **STEP 4: Scegli Strategia**

#### 🔹 **OPZIONE A: Elimina Solo Duplicati** (se <500 duplicati)
```
Menu > Strumenti Avanzati > 🗑️ Elimina Righe Duplicate

⚠️ ATTENZIONE: Operazione irreversibile!
✅ Elimina solo le righe duplicate (mantiene prime occorrenze)
✅ Veloce (2-5 minuti)
❌ Non corregge dati inconsistenti
```

**Quando usare**: Se hai pochi duplicati e sai che i dati sono corretti.

---

#### 🔹 **OPZIONE B: Reimport Totale** (CONSIGLIATO se >500 duplicati)
```
⚠️ QUESTA È LA PROCEDURA PIÙ SICURA!
```

**STEP B.1: Pulisci Foglio Righe**
```
1. Apri foglio "Righe"
2. Seleziona TUTTE le righe dati (dalla riga 2 in poi)
3. Clic destro > Elimina righe
4. ⚠️ NON eliminare l'header (riga 1)!
5. Verifica: foglio "Righe" deve avere solo 1 riga (header)
```

**STEP B.2: Reset Flag su TUTTE le Fatture**
```javascript
// Esegui questo script:

function DEV_ResetAllImportFlags() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shF = ss.getSheetByName('Fatture');
  
  if (!shF) {
    SpreadsheetApp.getUi().alert('Foglio Fatture non trovato!');
    return;
  }
  
  const lastRow = shF.getLastRow();
  if (lastRow < 2) return;
  
  // Trova indici colonne
  const headers = shF.getRange(1, 1, 1, shF.getLastColumn()).getValues()[0];
  const idxRigheImportate = headers.indexOf('RigheImportate');
  const idxImportaRigheSrc = headers.indexOf('ImportaRigheSrc');
  const idxRigheImportateNum = headers.indexOf('RigheImportateNum');
  const idxTotRigheNetto = headers.indexOf('TotRigheNetto');
  
  if (idxRigheImportate === -1 || idxImportaRigheSrc === -1) {
    SpreadsheetApp.getUi().alert('Colonne non trovate!');
    return;
  }
  
  // Reset flags
  const rowCount = lastRow - 1;
  
  shF.getRange(2, idxRigheImportate + 1, rowCount, 1).setValue(false);
  shF.getRange(2, idxImportaRigheSrc + 1, rowCount, 1).setValue('');
  
  if (idxRigheImportateNum !== -1) {
    shF.getRange(2, idxRigheImportateNum + 1, rowCount, 1).setValue(0);
  }
  
  if (idxTotRigheNetto !== -1) {
    shF.getRange(2, idxTotRigheNetto + 1, rowCount, 1).setValue(0);
  }
  
  SpreadsheetApp.getUi().alert(`✅ Reset completato su ${rowCount} fatture!`);
}

// Esegui: DEV_ResetAllImportFlags()
```

**STEP B.3: Reimporta Righe**
```
Menu > Importazione Dati > 2. Importa Righe Prodotti

⏱️ Tempo stimato: 10-30 minuti (dipende dal numero di fatture)
✅ Import pulito da zero
✅ Nessun duplicato
✅ Dati consistenti
```

---

## 🚨 **PREVENZIONE FUTURA**

### ✅ **Regole d'Oro**:

1. **NON eseguire mai "Importa Righe" due volte** senza prima:
   - Controllare il flag `RigheImportate = TRUE`
   - Verificare lo stato `ImportaRigheSrc = imported`

2. **Se devi reimportare una fattura specifica**:
   ```
   a. Elimina manualmente le righe di QUELLA fattura dal foglio "Righe"
      (filtra per FileID, poi elimina righe selezionate)
   b. Reset flag SOLO per quella fattura:
      - RigheImportate = FALSE
      - ImportaRigheSrc = (vuoto)
   c. Esegui import
   ```

3. **Usa "Continua Import Interrotto"** invece di riavviare import:
   ```
   Menu > Importazione Dati > ▶️ Continua Import Interrotto
   ```
   → Riprende esattamente da dove si era fermato (non duplica)

4. **Monitora il contatore `RigheImportateNum`**:
   - Colonna nel foglio "Fatture"
   - Mostra quante righe sono state importate per quella fattura
   - Se vedi numeri sospetti (es: 10 righe per una fattura semplice) → indaga!

---

## 🔧 **FEATURE REQUEST: Prevenzione Automatica Duplicati**

### Possibile miglioramento futuro:
```javascript
// Prima di scrivere nuove righe, controlla se FileID+NumeroLinea già esistono
// Se esistono: UPDATE invece di INSERT
// Se non esistono: INSERT normale
```

**Pro**: Nessun duplicato mai più  
**Contro**: Import più lento (richiede lettura completa foglio Righe ogni volta)

**Alternativa**: Aggiungere indice univoco `FileID|NumeroLinea` come prima colonna nascosta.

---

## 📊 **DIAGNOSTICA: Quanti Duplicati Ho?**

```javascript
function DEV_CountDuplicates() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shR = ss.getSheetByName('Righe');
  
  if (!shR || shR.getLastRow() < 2) {
    SpreadsheetApp.getUi().alert('Foglio Righe vuoto!');
    return;
  }
  
  const headers = shR.getRange(1, 1, 1, shR.getLastColumn()).getValues()[0];
  const idxFileID = headers.indexOf('FileID');
  const idxNumeroLinea = headers.indexOf('NumeroLinea');
  
  if (idxFileID === -1 || idxNumeroLinea === -1) {
    SpreadsheetApp.getUi().alert('Colonne FileID/NumeroLinea non trovate!');
    return;
  }
  
  const data = shR.getRange(2, 1, shR.getLastRow() - 1, shR.getLastColumn()).getValues();
  
  const seen = new Map();
  let duplicateCount = 0;
  
  data.forEach((row, i) => {
    const fileId = String(row[idxFileID] || '').trim();
    const numeroLinea = String(row[idxNumeroLinea] || '').trim();
    
    if (!fileId || !numeroLinea) return;
    
    const key = `${fileId}|${numeroLinea}`;
    
    if (seen.has(key)) {
      duplicateCount++;
    } else {
      seen.set(key, true);
    }
  });
  
  const totalRows = data.length;
  const uniqueRows = seen.size;
  const dupPercent = ((duplicateCount / totalRows) * 100).toFixed(1);
  
  SpreadsheetApp.getUi().alert(
    '📊 Statistiche Duplicati\n\n' +
    `Righe totali: ${totalRows}\n` +
    `Righe uniche: ${uniqueRows}\n` +
    `Righe duplicate: ${duplicateCount} (${dupPercent}%)\n\n` +
    (duplicateCount > 500 ? '⚠️ CONSIGLIATO: Reimport totale' : '✅ OK: Usa "Elimina Righe Duplicate"')
  );
}
```

---

## 📞 **SUPPORTO**

Se hai dubbi o problemi durante la pulizia:
1. Crea backup completo
2. Esegui `DEV_CountDuplicates()` per diagnostica
3. Se >1000 duplicati → usa OPZIONE B (reimport totale)
4. Se <500 duplicati → usa OPZIONE A (elimina selettivi)

**NON procedere senza backup!**
