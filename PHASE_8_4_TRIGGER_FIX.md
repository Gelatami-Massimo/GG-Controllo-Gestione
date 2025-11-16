# Fix: Trigger Automatico Condizionale (PHASE 8.4)

**Data**: 17 Novembre 2025  
**File**: `150_triggers.js`  
**Funzione Modificata**: `_disableAutoTriggerSilently()`  
**Problema Risolto**: Trigger disattivato incondizionatamente anche quando c'è ancora lavoro in coda  

---

## Problema

La funzione `_disableAutoTriggerSilently()` veniva chiamata nel `finally` block di `runAutomatedImport()` **sempre**, indipendentemente dal fatto che ci fosse ancora lavoro da fare.

**Scenario problematico**:
1. Un XML import inizia (HEADERS phase)
2. A causa di timeout o dimensione file, HEADERS salva il suo cursore in STATE e interrompe
3. Alla fine del run, il trigger viene disattivato **incondizionatamente**
4. Al prossimo run, non avviene nulla perché il trigger è spento
5. L'import rimane **sospeso e non completa mai**

---

## Soluzione

Modificata `_disableAutoTriggerSilently()` per essere **condizionale**:

```javascript
// STEP 1: Controlla se ci sono cursori attivi
var hasHeadersCursor = !!STATE.getJSON(App.config.keys.cursors.headers, null);
var hasRowsCursor    = !!STATE.getJSON(App.config.keys.cursors.rows, null);

if (hasHeadersCursor || hasRowsCursor) {
  // Ci sono ancora importazioni in sospeso → NON spegnere il trigger
  LOG.info('TRIGGER_AUTO_OFF', 'Trigger mantenuto attivo: lavoro ancora in corso.', {
    hasHeadersCursor: hasHeadersCursor,
    hasRowsCursor: hasRowsCursor
  });
  return;
}

// STEP 2: Se NESSUNO dei due cursori esiste → import COMPLETATA → disattiva
// (resto della logica originale)
```

### Logica Nuova

| Situazione | Azione |
|-----------|--------|
| ✅ Cursor HEADERS presente | Trigger **RIMANE ATTIVO** (c'è lavoro) |
| ✅ Cursor ROWS presente | Trigger **RIMANE ATTIVO** (c'è lavoro) |
| ✅ Entrambi i cursori presenti | Trigger **RIMANE ATTIVO** (c'è lavoro) |
| ❌ NESSUNO dei cursori presente | Trigger **VIENE DISATTIVATO** (import completata) |

---

## Impatto

### Benefici
- ✅ Import parziali completano correttamente al run successivo
- ✅ Timeout non blocca più il processo
- ✅ Import su file grandi funzionano come previsto
- ✅ Trigger rimane "vivo" finché c'è lavoro

### Backward Compatibility
- ✅ **100% compatibile** con runAutomatedImport() esistente
- ✅ Non cambia il comportamento quando l'import **è completato**
- ✅ Nessuna modifica a log, STATE, CONFIG
- ✅ Solo aggiunge il controllo sui cursori

---

## Testing

Suggerito test:
1. Avviare un import XML grande (che causa timeout)
2. Verificare che il trigger rimanga attivo dopo il timeout
3. Al run successivo, verificare che l'import riprenda dal cursor
4. Verificare che il trigger si disattivi solo quando **tutti** i cursori sono assenti

---

## Commit

```bash
git add 150_triggers.js
git commit -m "Phase 8.4: Fix trigger automatico condizionale - mantiene attivo finché cursori presenti"
```

---

## Files Modificati

- `150_triggers.js`: Funzione `_disableAutoTriggerSilently()` (+30 righe nette)

---

## Note

- Non richiede push immediato su GAS (sarà incluso nel prossimo deploy)
- Completamente testabile in ambiente di staging
- Può essere rollback semplicemente ripristinando la versione precedente
- No impact su performance o memory
