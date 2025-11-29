# 🎓 GUIDA FORMATIVA: Trasformare Script in Add-on

**Creato**: 24 novembre 2025  
**Livello**: Intermedio  
**Tempo stimato**: 30-60 minuti  
**Prerequisiti**: Google Workspace account, clasp configurato

---

## 📋 COSA HAI GIÀ FATTO

✅ **appsscript.json** - Configurazione add-on aggiunta  
✅ **180_addon_ui.js** - Homepage con Card Service API  

**Manca solo**: Deploy e test!

---

## 🚀 PASSO 3: DEPLOY (Quando pronto)

### Comandi da eseguire:

```powershell
# 1. Deploy modifiche
cd C:\ScriptApp\GG-Controllo-Gestione
clasp push

# 2. Crea versione add-on
clasp deploy --description "Add-on v1.0 - Formazione"

# 3. Annota deployment ID (output precedente)
# Output sarà tipo: @2 - Add-on v1.0 - Formazione
```

---

## 🧪 PASSO 4: TEST ADD-ON

### Opzione A: Test Deployment (Consigliato per formazione)

1. **Apri script.google.com**
2. **Trova progetto** "GG-Controllo-Gestione"
3. **Click "Deploy" → "Test deployments"**
4. **Seleziona "Install"** per la versione head
5. **Apri un foglio Google qualsiasi**
6. **Sidebar → Extensions → GG Controllo Gestione**
7. **Vedrai la homepage con le card!** 🎉

### Opzione B: Deploy Installabile

1. Dopo `clasp deploy`, vai su script.google.com
2. Deploy → Manage deployments
3. Click ⚙️ sul deployment
4. Copia "Deployment ID"
5. Usa URL: `https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec`
6. Condividi URL con utenti (solo Workspace domain)

---

## 📚 COSA IMPARERAI

### 1. **Card Service API** (180_addon_ui.js)

```javascript
// Anatomia di una Card
CardService.newCardBuilder()
  .setHeader(...)      // Intestazione con titolo/icona
  .addSection(...)     // Sezioni contenuto
  .build();            // Costruisci card finale

// Widget disponibili:
- TextParagraph     // Testo statico
- TextButton        // Pulsante azione
- ButtonSet         // Gruppo pulsanti
- TextInput         // Campo input
- SelectionInput    // Dropdown/checkbox
- DateTimePicker    // Selettore date
```

**Esempio pratico nel tuo codice**:
```javascript
function onAddonHomepage(e) {
  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('🧊 GG Controllo Gestione')
    );
  
  const section = CardService.newCardSection()
    .addWidget(CardService.newTextButton()
      .setText('▶️ Continua Import')
      .setOnClickAction(CardService.newAction()
        .setFunctionName('onContinueImportAction')  // ← Handler
      )
    );
  
  card.addSection(section);
  return card.build();
}
```

**Concetto chiave**: Le card sono **reactive** - ogni azione rebuilda la UI.

---

### 2. **Action Handlers**

```javascript
// Handler pattern
function onContinueImportAction(e) {
  try {
    // 1. Esegui logica business
    runContinue();
    
    // 2. Ritorna response (notification/navigation)
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification()
        .setText('Import avviato!')
        .setType(CardService.NotificationType.INFO)
      )
      .build();
  } catch (error) {
    // 3. Error handling
    return createErrorResponse_(error.message);
  }
}
```

**Concetti chiave**:
- Handler riceve **event object** `e` con contesto
- Deve ritornare **ActionResponse** (mai void!)
- Notification types: INFO, WARNING, ERROR

---

### 3. **Manifest Add-on** (appsscript.json)

```json
{
  "addOns": {
    "common": {
      "name": "GG Controllo Gestione",        // Nome visibile
      "logoUrl": "https://...",                // Icona 96x96
      "layoutProperties": {
        "primaryColor": "#4285f4"              // Brand color
      },
      "homepageTrigger": {
        "runFunction": "onAddonHomepage"       // Entry point
      }
    },
    "sheets": {                                 // Specific to Sheets
      "onFileScopeGrantedTrigger": {
        "runFunction": "onOpen"                // Trigger all'apertura
      }
    }
  }
}
```

**Concetti chiave**:
- `common`: Configurazione condivisa (tutti prodotti Workspace)
- `sheets`: Specifico per Google Sheets
- `homepageTrigger`: Cosa mostrare quando utente apre sidebar
- `onFileScopeGrantedTrigger`: Autorizzazioni file-specific

---

### 4. **Ciclo di Vita Add-on**

```
1. Utente apre Sheets
   ↓
2. Extensions → GG Controllo Gestione (se installato)
   ↓
3. Google chiama onAddonHomepage(e)
   ↓
4. Riceve Card, mostra in sidebar
   ↓
5. Utente click pulsante
   ↓
6. Google chiama onContinueImportAction(e)
   ↓
7. Riceve ActionResponse, aggiorna UI
```

**Differenze vs Script normale**:
- ❌ Script: `onOpen()` crea menu nella barra
- ✅ Add-on: `onAddonHomepage()` crea card in sidebar

---

## 🔍 DEBUGGING ADD-ON

### Problema: "Add-on non appare in Extensions"

**Causa**: Non installato o scope mancanti

**Soluzione**:
1. script.google.com → Deploy → Test deployments → Install
2. Ricarica foglio (F5)
3. Extensions → Refresh

---

### Problema: "Card non si carica"

**Causa**: Errore in `onAddonHomepage()`

**Soluzione**:
1. Apri script.google.com → Editor
2. Executions → Vedi log errori
3. Debug con `Logger.log()` in `onAddonHomepage()`

---

### Problema: "Pulsante non fa nulla"

**Causa**: Handler mancante o return sbagliato

**Soluzione**:
```javascript
// ❌ SBAGLIATO
function onContinueImportAction(e) {
  runContinue();  // Nessun return!
}

// ✅ CORRETTO
function onContinueImportAction(e) {
  runContinue();
  return CardService.newActionResponseBuilder()
    .setNotification(...)
    .build();
}
```

---

## 🎯 ESERCIZI FORMATIVI

### Esercizio 1: Aggiungi nuovo pulsante

**Obiettivo**: Aggiungere pulsante "📦 Magazzino" alla homepage

**Codice da aggiungere** (in `180_addon_ui.js`):
```javascript
// In reportSection, dopo pulsante P&L
.addButton(CardService.newTextButton()
  .setText('📦 Magazzino')
  .setOnClickAction(CardService.newAction()
    .setFunctionName('onWarehouseAction')
  )
)

// Handler nuovo (dopo onPnLAction)
function onWarehouseAction(e) {
  try {
    buildMagazzinoByYear();
    return CardService.newActionResponseBuilder()
      .setNotification(CardService.newNotification()
        .setText('📦 Magazzino generato!')
        .setType(CardService.NotificationType.INFO)
      )
      .build();
  } catch (error) {
    return createErrorResponse_('Errore magazzino: ' + error.message);
  }
}
```

**Test**: Deploy, ricarica, click pulsante → Magazzino generato! ✅

---

### Esercizio 2: Card dinamica con input

**Obiettivo**: Card che chiede anno per P&L

```javascript
function onPnLWithYearCard(e) {
  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('💰 Genera P&L')
    )
    .addSection(CardService.newCardSection()
      .addWidget(CardService.newTextInput()
        .setFieldName('year')
        .setTitle('Anno')
        .setValue(new Date().getFullYear().toString())
      )
      .addWidget(CardService.newTextButton()
        .setText('Genera')
        .setOnClickAction(CardService.newAction()
          .setFunctionName('onGeneratePnLAction')
        )
      )
    );
  
  return card.build();
}

function onGeneratePnLAction(e) {
  const year = e.formInputs.year[0];  // ← Leggi input!
  
  // Usa year per filtrare dati...
  createPnlSheet();
  
  return CardService.newActionResponseBuilder()
    .setNotification(CardService.newNotification()
      .setText(`P&L ${year} generato!`)
    )
    .build();
}
```

**Concetto**: `e.formInputs` contiene valori inseriti dall'utente!

---

### Esercizio 3: Navigation tra card

**Obiettivo**: Homepage → Card Dettagli → Torna Homepage

```javascript
// In homepage, aggiungi:
.addWidget(CardService.newTextButton()
  .setText('ℹ️ Info Sistema')
  .setOnClickAction(CardService.newAction()
    .setFunctionName('onShowInfoCard')
  )
)

// Card Info
function onShowInfoCard(e) {
  const card = CardService.newCardBuilder()
    .setHeader(CardService.newCardHeader()
      .setTitle('ℹ️ Info Sistema')
    )
    .addSection(CardService.newCardSection()
      .addWidget(CardService.newTextParagraph()
        .setText('Versione: 25.0\nModuli: 38\nUltimo deploy: 24/11/2025')
      )
      .addWidget(CardService.newTextButton()
        .setText('← Indietro')
        .setOnClickAction(CardService.newAction()
          .setFunctionName('onAddonHomepage')  // ← Torna homepage
        )
      )
    );
  
  // IMPORTANTE: setNavigation per pushare nuova card
  return CardService.newActionResponseBuilder()
    .setNavigation(CardService.newNavigation()
      .pushCard(card.build())
    )
    .build();
}
```

**Concetto**: Stack navigation come app mobile! `pushCard()` / `popCard()` / `updateCard()`

---

## 📖 RISORSE GOOGLE

- **Card Service Reference**: https://developers.google.com/apps-script/reference/card-service
- **Add-ons Best Practices**: https://developers.google.com/workspace/add-ons/guides/best-practices
- **Debugging Guide**: https://developers.google.com/workspace/add-ons/guides/debugging

---

## 🎓 CONCETTI AVANZATI (Per dopo)

### 1. **Context-aware cards**

Add-on può reagire al contesto (celle selezionate, valori):

```javascript
function onAddonHomepage(e) {
  // e.sheets contiene info foglio corrente!
  const selection = e.sheets?.selection;
  
  if (selection) {
    const range = selection.range;
    // Mostra card diversa basata su selezione
  }
}
```

### 2. **Universal Actions**

Azioni disponibili da qualsiasi card (es: Settings):

```json
// In appsscript.json
"universalActions": [{
  "label": "Impostazioni",
  "runFunction": "onSettingsAction"
}]
```

### 3. **OAuth2 Flows**

Per integrare servizi esterni (es: Stripe API):

```javascript
// Gestione OAuth complesso
function getOAuthService() {
  return OAuth2.createService('stripe')
    .setAuthorizationBaseUrl('...')
    .setTokenUrl('...')
    // ...
}
```

---

## ✅ CHECKLIST FINALE

Quando hai tempo, segui questi passi:

- [ ] `clasp push` per deploy modifiche
- [ ] `clasp deploy --description "Add-on v1.0"`
- [ ] script.google.com → Test deployments → Install
- [ ] Apri foglio → Extensions → GG Controllo Gestione
- [ ] Testa tutti i pulsanti sulla homepage
- [ ] Prova Esercizio 1 (aggiungi pulsante Magazzino)
- [ ] Leggi Card Service reference (link sopra)
- [ ] Sperimenta con card custom!

---

## 🎉 CONCLUSIONE

Hai imparato:
- ✅ Configurazione manifest add-on
- ✅ Card Service API
- ✅ Action handlers pattern
- ✅ Deploy e test workflow
- ✅ Debugging add-on
- ✅ Navigation tra card

**Prossimo livello**: Pubblica su Workspace Marketplace (quando pronto per distribuzione esterna)!

---

**Documenta creato**: 24 novembre 2025  
**Tempo pratica stimato**: 1-2 ore  
**Difficoltà**: ⭐⭐⭐☆☆

Quando hai tempo, basta seguire PASSO 3 e divertirti! 🚀
