# 📊 DATA VALIDATION SYSTEM - Guida Utente

**Modulo**: `160_data_validator.js`  
**Funzione Menu**: 📊 Report → ✅ Validazione Dati Completa  
**Scopo**: Analisi integrità, coerenza e completezza dati su Fatture, Righe, Prodotti e Magazzino

---

## 🎯 COSA FA

Il sistema di validazione esegue controlli approfonditi su tutti i fogli principali del tuo database per darti **sicurezza totale** sui dati raccolti.

### ✅ Controlli Eseguiti

#### 1. **FATTURE** (Foglio: Fatture)
- ✅ **FileID presente e univoco** - Nessuna fattura duplicata o con ID mancante
- ✅ **Date valide** - Tutte le date sono parsabili e coerenti
- ✅ **Fornitore completo** - Ogni fattura ha FornitoreID e Denominazione
- ✅ **Totali coerenti** - TotDocumento = TotImponibile + TotImposta (± 0.02€ tolleranza)
- ✅ **Dati finanziari presenti** - Nessun totale mancante

#### 2. **RIGHE** (Foglio: Righe)
- ✅ **FileID presente** - Ogni riga collegata a una fattura
- ✅ **Integrità referenziale** - Nessuna riga orfana (FileID non in Fatture)
- ✅ **Codice/Descrizione presenti** - Almeno uno dei due campi compilato
- ✅ **Quantità valida** - Numeri parsabili e diversi da zero
- ✅ **Prezzo valido** - Prezzi unitari presenti e numerici

#### 3. **PRODOTTI** (Foglio: Prodotti)
- ✅ **CodiceInterno univoco** - Nessun duplicato nel catalogo
- ✅ **CodiceInternoBreve presente** - Chiave di matching popolata
- ✅ **Descrizione presente** - Nessun prodotto senza nome
- ✅ **FornitoreID presente** - Ogni prodotto associato a fornitore
- ✅ **UM presente** - Unità di misura specificata
- ✅ **Dati conversione completi** - Ingredienti con PZxCT/KGxPZ se necessari

#### 4. **MAGAZZINO** (Foglio: Magazzino)
- ✅ **Codice Interno presente** - Nessuna riga senza identificativo
- ✅ **Integrità con Prodotti** - Tutti i codici esistono in Prodotti
- ✅ **Quantità acquistata presente** - Dati numerici validi
- ✅ **Prezzo presente** - Ultimo prezzo netto disponibile
- ✅ **Conversioni standardizzate** - Quantità Standard e Prezzo Standardizzato calcolati

---

## 🚀 COME USARE

### Lancio Validazione

1. Apri Google Sheets con il tuo database GG-Controllo-Gestione
2. Menu: **🧊 GELATAMI → 📊 Report → ✅ Validazione Dati Completa**
3. Attendi il completamento (solitamente 10-30 secondi)
4. Leggi il toast finale per il riepilogo
5. Apri **Visualizza → Log** (Ctrl+Enter) per il report dettagliato

### Quando Lanciare la Validazione

✅ **Raccomandato**:
- Dopo import massivo di fatture (>100 file)
- Prima di generare report finanziari critici
- Dopo modifiche manuali ai fogli Prodotti/Fornitori
- Periodicamente (es: fine mese) per monitoraggio health

⚠️ **Non necessario**:
- Dopo ogni singola fattura importata
- Durante import automatici (già validati)

---

## 📋 LEGGERE IL REPORT

### Esempio Output (Log)

```
═══════════════════════════════════════════════════════════
        📊 DATA VALIDATION REPORT - GG CONTROLLO GESTIONE
═══════════════════════════════════════════════════════════

📅 Data analisi: 24/11/2025, 15:30:45

─────────────────────────────────────────────────────────
📋 FATTURE
─────────────────────────────────────────────────────────
Totale righe: 1247
✅ Valide: 1245 (99.8%)
❌ FileID duplicati: 2

─────────────────────────────────────────────────────────
📝 RIGHE
─────────────────────────────────────────────────────────
Totale righe: 8523
✅ Valide: 8520 (99.9%)
⚠️  Quantità mancanti: 3

─────────────────────────────────────────────────────────
🏷️  PRODOTTI
─────────────────────────────────────────────────────────
Totale prodotti: 450
✅ Validi: 448 (99.5%)
⚠️  CodiceInternoBreve mancanti: 2

─────────────────────────────────────────────────────────
📦 MAGAZZINO
─────────────────────────────────────────────────────────
Totale righe magazzino: 380
✅ Valide: 380 (100.0%)

═══════════════════════════════════════════════════════════
🎯 RIEPILOGO: 2 errori critici, 5 warning
═══════════════════════════════════════════════════════════

❌ ERRORI CRITICI (Richiedono correzione):

   ❌ Riga 125: FileID duplicato "1a2b3c4d5e..."
   ❌ Riga 890: FileID duplicato "1a2b3c4d5e..."

⚠️  WARNING (Consigliata revisione):

   ⚠️  Riga 234: Quantità mancante (FileID: 9x8y7z...)
   ⚠️  Riga 567: Quantità mancante (FileID: 5k4j3h...)
   ⚠️  Riga 891: Quantità mancante (FileID: 2m1n0p...)
   ⚠️  Riga 45: CodiceInternoBreve mancante (PROD-2025-123)
   ⚠️  Riga 302: CodiceInternoBreve mancante (PROD-2025-456)

═══════════════════════════════════════════════════════════
```

### Interpretazione Risultati

#### 🎉 **TUTTO OK** (zero errori, zero warning)
```
🎉 ✅ ECCELLENTE! Tutti i dati sono validi e coerenti!

✅ Zero errori critici
✅ Zero warning
✅ Integrità referenziale completa
✅ Pronto per analisi e report
```
**Azione**: Nessuna. Puoi procedere con report e analisi in sicurezza.

---

#### ⚠️ **SOLO WARNING** (zero errori, N warning)
```
🎯 RIEPILOGO: 0 errori critici, 5 warning

⚠️  WARNING (Consigliata revisione):
   ⚠️  Riga 234: Quantità mancante (FileID: xyz)
   ...
```
**Significato**: Dati tecnicamente validi ma con campi opzionali mancanti o discrepanze minori.

**Azione**: Revisione consigliata ma non bloccante. Puoi procedere con report ma alcuni dati potrebbero essere incompleti.

---

#### ❌ **ERRORI CRITICI** (N errori, M warning)
```
🎯 RIEPILOGO: 2 errori critici, 3 warning

❌ ERRORI CRITICI (Richiedono correzione):
   ❌ Riga 125: FileID duplicato "abc123"
   ❌ Riga 456: Righe orfane (FileID non in Fatture)
```
**Significato**: Problemi di integrità che invalidano analisi/report.

**Azione**: **CORREZIONE OBBLIGATORIA** prima di procedere con report critici.

---

## 🔧 CORREGGERE GLI ERRORI

### Tipo Errore: FileID Duplicato
**Causa**: Due fatture con stesso FileID (import errato o duplicazione manuale)

**Soluzione**:
1. Cerca FileID duplicato nel foglio Fatture
2. Confronta le due righe (data, fornitore, numero doc)
3. Se sono la stessa fattura: elimina una riga
4. Se sono diverse: c'è un bug nell'import → contatta supporto

---

### Tipo Errore: Righe Orfane
**Causa**: Righe con FileID che non esiste in Fatture

**Soluzione**:
1. Controlla se la fattura corrispondente è stata eliminata manualmente
2. Se sì: elimina anche le righe orfane
3. Se no: c'è un problema di sincronizzazione → contatta supporto

---

### Tipo Errore: CodiceInterno Duplicato
**Causa**: Due prodotti con stesso CodiceInterno (import errato)

**Soluzione**:
1. Cerca CodiceInterno duplicato nel foglio Prodotti
2. Confronta le due righe (descrizione, fornitore)
3. Se sono lo stesso prodotto: unisci manualmente (mantieni il più completo)
4. Se sono diversi: rigenera CodiceInterno per uno dei due

---

### Tipo Errore: Date Non Valide
**Causa**: Data non parsabile o formato errato

**Soluzione**:
1. Controlla formato colonna Data (deve essere Date, non Text)
2. Verifica valore cella (es: "31/02/2025" non è valido)
3. Correggi manualmente o reimporta fattura

---

### Tipo Warning: Quantità/Prezzo Mancante
**Causa**: Campo lasciato vuoto durante import o parsing fallito

**Soluzione**:
1. Controlla XML originale della fattura
2. Se valore presente in XML: reimporta fattura
3. Se valore assente in XML: fattura fornitore incompleta → contatta fornitore

---

### Tipo Warning: Conversioni Mancanti
**Causa**: Prodotto ingrediente senza PZxCT/KGxPZ

**Soluzione**:
1. Apri foglio Prodotti
2. Cerca prodotto segnalato
3. Compila campi UMBase, PZxCT, KGxPZ secondo UM originale
4. Rigenera Magazzino per aggiornare conversioni

---

## 🎯 METRICHE DI QUALITÀ

### Soglie Accettabili

| Metrica | Target | Accettabile | Critico |
|---------|--------|-------------|---------|
| **Fatture valide** | 100% | ≥99% | <99% |
| **Righe valide** | 100% | ≥98% | <98% |
| **Prodotti validi** | 100% | ≥95% | <95% |
| **Integrità referenziale** | 100% | 100% | <100% |
| **Errori critici** | 0 | 0 | >0 |

### Interpretazione

- **100% valide**: Eccellente! Dati perfettamente integri
- **≥99% valide**: Ottimo. Pochi warning gestibili
- **≥95% valide**: Accettabile. Revisione consigliata
- **<95% valide**: Problematico. Revisione urgente necessaria

---

## 💡 BEST PRACTICES

### ✅ DO
- Lancia validazione **prima** di generare report finanziari per stakeholder
- Archivia report di validazione per audit trail
- Correggi errori critici **immediatamente**
- Rivedi warning periodicamente (almeno mensile)
- Usa validazione come "health check" pre-chiusura mese

### ❌ DON'T
- Non ignorare errori critici (compromettono analisi)
- Non lanciare validazione durante import attivi (dati parziali)
- Non modificare manualmente dati senza capire causa errore
- Non sovrascrivere fogli senza backup se ci sono errori

---

## 🔍 TROUBLESHOOTING

### Problema: "Foglio XXX non trovato"
**Causa**: Setup incompleto o foglio rinominato

**Soluzione**: Menu → Configurazione → Setup Iniziale

---

### Problema: "Validazione troppo lenta (>60 secondi)"
**Causa**: Database molto grande (>10K righe)

**Soluzione**: Normale per grandi volumi. Se >2 minuti, ottimizza fogli eliminando dati obsoleti.

---

### Problema: "Errori critici persistono dopo correzione"
**Causa**: Cache non invalidata

**Soluzione**: Menu → Manutenzione → Pulisci Cache, poi rilancia validazione

---

## 📊 OUTPUT DETTAGLIATO

Il report completo viene scritto in **Logger** (Ctrl+Enter in Script Editor). Include:

- Statistiche per ogni foglio (totale, valide, %)
- Lista completa errori critici (primi 20)
- Lista completa warning (primi 20)
- Indicazione righe precise con problemi
- Suggerimenti contestuali

---

## 🚀 INTEGRAZIONE CON WORKFLOW

### Scenario 1: Import Massivo Fatture
1. Import fatture (Menu → Import → Continua Import)
2. ✅ **Validazione Dati** (verifica integrità)
3. Genera Dashboard (se validazione OK)
4. Genera P&L (se validazione OK)

### Scenario 2: Chiusura Mensile
1. Verifica import completato
2. ✅ **Validazione Dati** (health check)
3. Correggi eventuali errori
4. Genera report finali
5. Archivia report validazione per audit

### Scenario 3: Manutenzione Prodotti
1. Modifica manuale foglio Prodotti
2. ✅ **Validazione Dati** (verifica integrità)
3. Se OK: Rigenera Magazzino
4. Se errori: Correggi e rivalidazione

---

## 🔐 SICUREZZA E PRIVACY

- **Nessun dato esterno**: Validazione lavora solo sui fogli locali
- **Nessuna modifica dati**: Solo lettura e analisi
- **Log locali**: Report scritto in Logger locale, non condiviso

---

## 📞 SUPPORTO

**Problema tecnico o errore inspiegabile?**

1. Copia report completo da Logger
2. Annota passi per riprodurre
3. Contatta supporto tecnico con:
   - Report validazione
   - Screenshot errori
   - Descrizione modifiche recenti

---

## 🎓 ESEMPI PRATICI

### Caso 1: Database Perfetto
```
Lancio validazione → Toast "🎉 Validazione completata! Tutti i dati validi"
→ Procedi con report senza preoccupazioni
```

### Caso 2: Warning Minori
```
Lancio validazione → Toast "⚠️ 0 errori, 5 warning"
→ Apri log → Vedi "Quantità mancanti su 3 righe"
→ Decidi: accettabile per report preliminare
→ Programma correzione per dopo
```

### Caso 3: Errore Critico
```
Lancio validazione → Toast "❌ 2 errori critici"
→ Apri log → Vedi "FileID duplicati su riga 125 e 890"
→ Apri foglio Fatture → Cerca FileID duplicato
→ Elimina riga duplicata
→ Rilancia validazione → OK ✅
→ Procedi con report
```

---

## ✅ CHECKLIST FINALE

Prima di considerare dati "pronti per produzione":

- [ ] Validazione lanciata con successo
- [ ] Zero errori critici
- [ ] Warning compresi e accettati (o corretti)
- [ ] Report archiviato per audit trail
- [ ] Dashboard/P&L generati post-validazione
- [ ] Stakeholder informati su eventuali limitazioni dati

---

**Versione Documento**: 1.0  
**Data**: 24 novembre 2025  
**Modulo**: 160_data_validator.js
