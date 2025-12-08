// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 190_inventory.js
// RUOLO: Gestione inventario fisico con conteggio prodotti raggruppati
// NOTE: Smart grouping per ingrediente con UMBase per guidare conteggio
// =============================================================

const INVENTORY = (() => {

  /**
   * Crea dizionario prezzi da Magazzino_Ingredienti per lookup veloce.
   * Chiave: "anno|ingrediente" → Valore: { totEuro, kgTot, pzTot, umBase }
   * Serve per calcolare prezzo unitario (€/KG o €/PZ)
   * 
   * @returns {Object} Dizionario { "2025|KINDER CEREALI": { totEuro: 1500, kgTot: 10, pzTot: 50, umBase: "KG" }, ... }
   * @private
   */
  function _getPrezziIngredienti() {
    const prezziByYear = {}; // key: "AZIENDA|ANNO|INGREDIENTE_UPPER" => dati
    const latestByIngred = {}; // key: "AZIENDA|INGREDIENTE_UPPER" => { year, entry }
    
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sh = ss.getSheetByName('Magazzino_Ingredienti');
      
      if (!sh) {
        LOG.warn('INVENTORY', 'Foglio Magazzino_Ingredienti non trovato, prezzi non disponibili');
        return prezzi;
      }

      const lastRow = sh.getLastRow();
      if (lastRow <= 1) {
        LOG.warn('INVENTORY', 'Foglio Magazzino_Ingredienti vuoto');
        return prezzi;
      }

      // Leggi tutto il foglio
      const data = sh.getRange(2, 1, lastRow - 1, 9).getValues();
      
      // Mappa: [Anno(0), Azienda(1), Ingrediente(2), Categoria(3), UMBase(4), PZ(5), KG(6), TotEuro(7), ...
      data.forEach(row => {
        const anno = row[0];
        const aziendaRaw = String(row[1] || '').trim();
        const aziendaKey = aziendaRaw ? aziendaRaw.toUpperCase() : 'ALL';
        const ingredienteRaw = String(row[2] || '').trim();
        const ingredienteKey = ingredienteRaw.toUpperCase();
        const umBase = String(row[4] || 'KG').trim().toUpperCase();
        const pzTot = Number(row[5]) || 0;
        const kgTot = Number(row[6]) || 0;
        const totEuro = Number(row[7]) || 0;
        
        if (anno && ingredienteKey) {
          const key = `${aziendaKey}|${anno}|${ingredienteKey}`;
          const entry = {
            totEuro: totEuro,
            kgTot: kgTot,
            pzTot: pzTot,
            umBase: umBase
          };
          prezziByYear[key] = entry;

          const latestKey = `${aziendaKey}|${ingredienteKey}`;
          // Aggiorna latest per ingrediente/azienda (scegli anno più recente disponibile)
          if (!latestByIngred[latestKey] || Number(anno) > latestByIngred[latestKey].year) {
            latestByIngred[latestKey] = { year: Number(anno), entry };
          }
        }
      });

      LOG.info('INVENTORY', 'Prezzi ingredienti caricati', { count: Object.keys(prezziByYear).length });
      return { byYear: prezziByYear, latest: latestByIngred };

    } catch (e) {
      LOG.warn('INVENTORY', 'Errore caricamento prezzi ingredienti', { error: e.message });
      return { byYear: prezziByYear, latest: latestByIngred };
    }
  }

  /**
   * Crea il foglio per il conteggio inventario fisico.
   * 
   * LOGICA RAGGRUPPAMENTO SMART INGREDIENTE:
   * 1. Filtra prodotti attivi (NonInUso=false) con Ingrediente valorizzato
   * 2. Raggruppa per ChiaveGruppo:
   *    - Ingrediente specifico (es. "KINDER CEREALI", "LATTE") → usa quello
   *    - Ingrediente generico (TRUE/SI/YES/1) → usa Descrizione prodotto
   * 3. Per ogni gruppo salva:
   *    - UMBase del primo prodotto (es. "PZ") → guida il conteggio
   *    - Array di tutti i CodiciInterni inclusi
   *    - Categoria, Fornitore
   * 4. Sort per Categoria > Nome gruppo
   * 
   * OUTPUT: Foglio "INVENTARIO_ATTIVO" con:
   * - Colonna A: Nome gruppo (es. "KINDER CEREALI")
   * - Colonna D: UMBase (es. "PZ") → indica come contare
   * - Colonna G: JSON array CodiciInterni (nascosta)
   * 
   * @returns {void}
   */
  function createCountSheet() {
    const runId = LOG.generateRunId();
    LOG.info(runId, 'INVENTORY_CREATE', 'Creazione foglio inventario fisico');

    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheetName = 'INVENTARIO_ATTIVO';
      
      // Elimina foglio esistente se presente
      const existingSheet = ss.getSheetByName(sheetName);
      if (existingSheet) {
        ss.deleteSheet(existingSheet);
        LOG.info(runId, 'INVENTORY_DELETE_OLD', 'Foglio esistente eliminato', { sheetName });
      }

      // Crea nuovo foglio
      const sheet = ss.insertSheet(sheetName);
      
      // ✅ STEP 1: Recupera e raggruppa prodotti ingredienti attivi
      const groupedProducts = _getActiveIngredients();
      
      LOG.info(runId, 'INVENTORY_GROUPS', 'Prodotti raggruppati per inventario', {
        totalGroups: groupedProducts.length
      });

      // ✅ STEP 2: Crea intestazioni
      const headers = [
        'Nome Prodotto/Ingrediente', // A
        'Categoria',                  // B
        'Fornitore',                  // C
        'UM',                         // D - UMBase per guidare conteggio
        'Quantità Conteggio',         // E - da compilare
        'Note',                       // F - opzionale
        'CodiciInterni'               // G - JSON nascosto
      ];

      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      
      // Formattazione header
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground('#34A853');
      headerRange.setFontColor('#FFFFFF');
      headerRange.setFontWeight('bold');
      headerRange.setHorizontalAlignment('center');

      // ✅ STEP 3: Inserisci righe raggruppate
      if (groupedProducts.length > 0) {
        const dataRows = groupedProducts.map(group => [
          group.nomeGruppo,              // Nome visualizzato (es. "KINDER CEREALI")
          group.categoria || '',
          group.fornitore,
          group.umBase,                  // UM del primo prodotto (es. "PZ")
          '',                            // Quantità (da compilare manualmente)
          '',                            // Note
          JSON.stringify(group.codiciInterni) // JSON nascosto
        ]);

        sheet.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);
        
        // Formattazione zebrata (batch optimization - single I/O call)
        const backgrounds = dataRows.map((_, i) =>
          Array(headers.length).fill(i % 2 === 0 ? '#E8F5E9' : '#FFFFFF') // Verde chiaro per pari
        );
        if (backgrounds.length > 0) {
          sheet.getRange(2, 1, backgrounds.length, headers.length).setBackgrounds(backgrounds);
        }

        LOG.info(runId, 'INVENTORY_ROWS', 'Righe inserite', { count: dataRows.length });
      }

      // ✅ STEP 4: Formattazione colonne
      sheet.setColumnWidth(1, 280);  // Nome
      sheet.setColumnWidth(2, 150);  // Categoria
      sheet.setColumnWidth(3, 180);  // Fornitore
      sheet.setColumnWidth(4, 60);   // UM
      sheet.setColumnWidth(5, 120);  // Quantità
      sheet.setColumnWidth(6, 200);  // Note
      sheet.setColumnWidth(7, 100);  // CodiciInterni (nascosta)

      // ⭐ Forza formato TESTO sulla colonna E (Quantità) per evitare che "-" diventi formula
      if (groupedProducts.length > 0) {
        sheet.getRange(2, 5, groupedProducts.length, 1).setNumberFormat('@'); // @ = formato testo
      }

      // Nascondi colonna G (CodiciInterni JSON)
      sheet.hideColumns(7);

      // Proteggi colonne informative (solo Quantità e Note editabili)
      const protection = sheet.protect();
      protection.setDescription('Protezione inventario fisico');
      
      // Sblocca solo colonne E (Quantità) e F (Note)
      const unprotectedRanges = [
        sheet.getRange(2, 5, Math.max(1, groupedProducts.length), 1), // Colonna E
        sheet.getRange(2, 6, Math.max(1, groupedProducts.length), 1)  // Colonna F
      ];
      protection.setUnprotectedRanges(unprotectedRanges);
      
      // Rimuovi tutti gli editor per rendere effettiva la protezione
      protection.removeEditors(protection.getEditors());
      if (protection.canDomainEdit()) {
        protection.setDomainEdit(false);
      }

      // ✅ STEP 5: Freeze header
      sheet.setFrozenRows(1);

      // Aggiungi istruzioni in nota
      const instructionCell = sheet.getRange(1, 1);
      instructionCell.setNote(
        `FOGLIO INVENTARIO FISICO\n\n` +
        `ISTRUZIONI:\n` +
        `1. Compila la colonna "Quantità Conteggio" con i valori reali conteggiati\n` +
        `2. Per prodotti esauriti, scrivi "-" (trattino) al posto di 0\n` +
        `3. Usa la colonna "UM" come riferimento per il conteggio:\n` +
        `   - PZ = conta singoli pezzi (non cartoni)\n` +
        `   - KG = pesa in chilogrammi\n` +
        `4. I prodotti sono raggruppati per ingrediente comune\n` +
        `5. La colonna "CodiciInterni" (nascosta) contiene i riferimenti ai prodotti\n\n` +
        `💡 ESEMPI:\n` +
        `   • Se vedi "KINDER CEREALI | UM: PZ", conta i singoli pezzi totali\n` +
        `   • Se è esaurito: scrivi "-"\n` +
        `   • Se non lo hai controllato: lascia vuoto\n\n` +
        `Generato il: ${new Date().toLocaleString('it-IT')}`
      );

      // Attiva il foglio
      sheet.activate();

      LOG.info(runId, 'INVENTORY_COMPLETE', 'Foglio inventario creato con successo', {
        sheetName,
        productsCount: groupedProducts.length
      });

      SpreadsheetApp.getUi().alert(
        '✅ Foglio Inventario Creato',
        `Foglio "${sheetName}" creato con ${groupedProducts.length} prodotti raggruppati.\n\n` +
        `Compila la colonna "Quantità Conteggio" durante l'inventario fisico:\n` +
        `   • Numero: quantità conteggiata (es. 15, 25.5)\n` +
        `   • "-" (trattino): prodotto esaurito\n` +
        `   • Vuoto: non ancora controllato (verrà saltato)\n\n` +
        `💡 La colonna "UM" indica l'unità di misura da usare:\n` +
        `   - PZ = conta i pezzi singoli\n` +
        `   - KG = pesa in chilogrammi`,
        SpreadsheetApp.getUi().ButtonSet.OK
      );

    } catch (e) {
      LOG.error(runId, 'INVENTORY_ERROR', 'Errore creazione foglio inventario', {
        error: e.message,
        stack: e.stack
      });
      throw e;
    }
  }

  /**
   * Recupera e raggruppa i prodotti ingredienti attivi per l'inventario fisico.
   * 
   * LOGICA SMART INGREDIENTE:
   * 1. Filtra: Ingrediente valorizzato + NonInUso=false
   * 2. Determina ChiaveGruppo:
   *    - Ingrediente specifico (es. "KINDER CEREALI") → usa quello
   *    - Ingrediente generico (TRUE/SI/YES/1) → usa Descrizione
   * 3. Raggruppa e salva:
   *    - UMBase del primo prodotto trovato (guida il conteggio)
   *    - Array di tutti i CodiciInterni del gruppo
   *    - Categoria, Fornitore
   * 4. Ordina per Categoria > Nome gruppo
   * 
   * @returns {Array<Object>} Array di gruppi prodotti ordinati con UMBase
   * @private
   */
  function _getActiveIngredients() {
    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
    if (!sh) {
      LOG.error('INVENTORY_PRODUCTS', 'Foglio Prodotti non trovato');
      return [];
    }

    const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti);
    if (sh.getLastRow() <= headerRow) {
      LOG.warn('INVENTORY_PRODUCTS', 'Foglio Prodotti vuoto');
      return [];
    }

    const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
    
    // Validazione colonne richieste
    const requiredCols = [
      'Ingrediente', 
      'NonInUso', 
      'Descrizione', 
      'UM', 
      'UMBase',
      'CodiceInternoBreve', 
      'CategoriaProdotto', 
      'DenominazioneFornitore'
    ];
    const missingCols = requiredCols.filter(col => idx[col] === undefined);
    if (missingCols.length > 0) {
      LOG.error('INVENTORY_PRODUCTS', 'Colonne mancanti in Prodotti', { missingCols });
      return [];
    }

    try {
      const lastRow = sh.getLastRow();
      const lastCol = sh.getLastColumn();
      const values = sh.getRange(headerRow + 1, 1, lastRow - headerRow, lastCol).getValues();

      // ✅ STEP 1: Filtra prodotti ingredienti attivi
      const activeIngredients = [];
      
      values.forEach((row, i) => {
        const ingredienteVal = String(row[idx.Ingrediente] || '').trim().toUpperCase();
        const nonInUsoVal = row[idx.NonInUso];
        
        // Verifica se è ingrediente (valorizzato)
        const isIngredient = ingredienteVal && 
                            ingredienteVal !== 'FALSE' && 
                            ingredienteVal !== 'NO' &&
                            ingredienteVal !== '0';
        
        // Verifica se è attivo (NonInUso = false)
        const isActive = nonInUsoVal !== true && 
                        String(nonInUsoVal).toLowerCase() !== 'true' &&
                        String(nonInUsoVal).toLowerCase() !== 'vero';
        
        if (isIngredient && isActive) {
          activeIngredients.push({
            codiceInternoBreve: String(row[idx.CodiceInternoBreve] || '').trim(),
            descrizione: String(row[idx.Descrizione] || '').trim(),
            ingrediente: ingredienteVal,
            um: String(row[idx.UM] || 'PZ').trim(),
            umBase: String(row[idx.UMBase] || 'PZ').trim(), // ⭐ UMBase per guidare conteggio
            categoria: String(row[idx.CategoriaProdotto] || '').trim(),
            fornitore: String(row[idx.DenominazioneFornitore] || '').trim()
          });
        }
      });

      LOG.info('INVENTORY_FILTER', 'Prodotti ingredienti attivi filtrati', {
        totalProducts: values.length,
        activeIngredients: activeIngredients.length
      });

      // ✅ STEP 2: Raggruppa per ChiaveGruppo (Smart Ingrediente)
      const groupsMap = new Map();

      activeIngredients.forEach(product => {
        let chiaveGruppo;
        let isGenericIngredient = false;

        // Determina ChiaveGruppo
        const ingredienteVal = product.ingrediente;
        const genericValues = ['TRUE', 'VERO', 'SI', 'YES', '1'];
        
        if (genericValues.includes(ingredienteVal)) {
          // ⭐ Ingrediente generico → usa Descrizione prodotto
          chiaveGruppo = product.descrizione;
          isGenericIngredient = true;
        } else {
          // ⭐ Ingrediente specifico → usa nome ingrediente
          chiaveGruppo = ingredienteVal;
          isGenericIngredient = false;
        }

        // Crea o aggiorna gruppo
        if (!groupsMap.has(chiaveGruppo)) {
          groupsMap.set(chiaveGruppo, {
            nomeGruppo: chiaveGruppo,
            categoria: product.categoria,
            fornitore: isGenericIngredient ? product.fornitore : 'VARI (Raggruppato)',
            umBase: product.umBase,  // ⭐ UMBase del PRIMO prodotto trovato
            codiciInterni: []
          });
        }

        // Aggiungi codice al gruppo
        const group = groupsMap.get(chiaveGruppo);
        group.codiciInterni.push(product.codiceInternoBreve);
        
        // ⚠️ IMPORTANTE: Se nel gruppo ci sono prodotti con UMBase diverse,
        // manteniamo quella del primo prodotto (guida il conteggio).
        // Questo è intenzionale: l'utente conta nella UM principale del gruppo.
      });

      LOG.info('INVENTORY_GROUPS', 'Gruppi creati con UMBase', {
        totalGroups: groupsMap.size
      });

      // ✅ STEP 3: Converti mappa in array e ordina
      const groupedProducts = Array.from(groupsMap.values());

      // Ordinamento: Categoria > Nome Gruppo
      groupedProducts.sort((a, b) => {
        // Prima per categoria
        const catCompare = (a.categoria || '').localeCompare(b.categoria || '', 'it');
        if (catCompare !== 0) return catCompare;
        
        // Poi per nome gruppo
        return (a.nomeGruppo || '').localeCompare(b.nomeGruppo || '', 'it');
      });

      LOG.info('INVENTORY_SORT', 'Gruppi ordinati', {
        finalCount: groupedProducts.length
      });

      return groupedProducts;

    } catch (e) {
      LOG.error('INVENTORY_PRODUCTS', 'Errore recupero prodotti raggruppati', {
        error: e.message,
        stack: e.stack
      });
      return [];
    }
  }

  /**
   * Importa i dati inventario dal foglio compilato.
   * Legge il foglio "INVENTARIO_ATTIVO", decodifica i JSON dei codici interni,
   * recupera il prezzo dal foglio "Magazzino_Ingredienti",
   * e salva le giacenze fisiche nel foglio "Inventari_DB".
   * 
   * @returns {Object} Risultato importazione con statistiche
   */
  function importCountData() {
    const runId = LOG.generateRunId();
    LOG.info(runId, 'INVENTORY_IMPORT_START', 'Avvio importazione conteggi inventario');

    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheetName = 'INVENTARIO_ATTIVO';
      const sheet = ss.getSheetByName(sheetName);

      // Prompt azienda (Gemma/Zaffiro/ALL)
      const ui = SpreadsheetApp.getUi();
      const aziendaResp = ui.prompt(
        'Azienda per import inventario',
        'Inserisci GEMMA o ZAFFIRO, oppure lascia vuoto per ALL:',
        ui.ButtonSet.OK_CANCEL
      );
      if (aziendaResp.getSelectedButton() !== ui.Button.OK) {
        ui.alert('Operazione annullata.');
        return;
      }
      const aziendaKey = (aziendaResp.getResponseText() || '').trim().toUpperCase() || 'ALL';

      if (!sheet) {
        throw new Error(`Foglio "${sheetName}" non trovato. Creare prima il foglio inventario.`);
      }

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        throw new Error('Nessun dato da importare (foglio vuoto).');
      }

      // ⭐ PRE-CARICA dizionario prezzi da Magazzino_Ingredienti per lookup veloce
      const prezzoDizionario = _getPrezziIngredienti();

      // Leggi dati (salta header)
      const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
      
      const imported = [];
      const skipped = [];
      const errors = [];
      const dataInventario = new Date();

      data.forEach((row, i) => {
        const rowNum = i + 2;
        const [nomeGruppo, categoria, fornitore, umBase, quantita, note, codiciJSON] = row;

        // Debug logging per le prime 3 righe
        if (i < 3) {
          LOG.debug(runId, 'INVENTORY_IMPORT_ROW', `Riga ${rowNum} esempio`, {
            nomeGruppo: String(nomeGruppo).substring(0, 50),
            categoria: String(categoria).substring(0, 30),
            umBase,
            quantita,
            hasJSON: !!codiciJSON,
            jsonLength: String(codiciJSON).length
          });
        }

        // Salta righe completamente vuote (tutte le celle vuote)
        if (!nomeGruppo && !categoria && !quantita && !codiciJSON) {
          return; // Non contare come skipped, è solo padding vuoto
        }

        // Salta righe senza quantità (cioè non ancora controllate)
        // Nota: quantita = 0 è VALIDA (significa terminato)
        // Nota: quantita = "-" è VALIDA (marcatore esaurito, converti a 0)
        // quantita vuota/mancante è SKIPPA (non controllato)
        
        // Converti a numero per i controlli
        // Se è "-", convertilo a 0 (marcatore esaurito)
        let quantitaNum = 0;
        if (quantita === '-' || String(quantita).trim() === '-') {
          quantitaNum = 0; // Marcatore esaurito
        } else {
          quantitaNum = Number(quantita);
        }
        
        // Se quantita è stringa vuota, null, undefined, o non è un numero valido → SALTA
        if (quantita === '' || quantita === null || quantita === undefined || (isNaN(quantitaNum) && quantita !== '-')) {
          skipped.push({ rowNum, reason: 'Quantità non compilata (inventario non controllato)', nomeGruppo: String(nomeGruppo).substring(0, 40) });
          return;
        }

        try {
          // Decodifica JSON codici interni
          if (!codiciJSON || String(codiciJSON).trim() === '') {
            errors.push({ rowNum, error: 'Colonna CodiciInterni vuota', nomeGruppo: String(nomeGruppo).substring(0, 40) });
            return;
          }

          let codiciInterni;
          try {
            codiciInterni = JSON.parse(codiciJSON);
          } catch (jsonError) {
            errors.push({ 
              rowNum, 
              error: `JSON non valido: ${jsonError.message}`, 
              nomeGruppo: String(nomeGruppo).substring(0, 40),
              jsonPreview: String(codiciJSON).substring(0, 50)
            });
            return;
          }
          
          if (!Array.isArray(codiciInterni) || codiciInterni.length === 0) {
            errors.push({ 
              rowNum, 
              error: 'JSON non è un array o è vuoto', 
              nomeGruppo: String(nomeGruppo).substring(0, 40) 
            });
            return;
          }

          // ⭐ NUOVA LOGICA: Crea 1 RIGA PER INGREDIENTE (non per codice)
          // Salva: ingrediente, quantità totale, tutti i codici, categoria, fornitore
          
          // ⭐ Recupera prezzo da Magazzino_Ingredienti
          const annoCorrente = new Date().getFullYear();
          const ingredienteKey = String(nomeGruppo || '').trim().toUpperCase();

          const keysToTry = [
            `${aziendaKey}|${annoCorrente}|${ingredienteKey}`,
            `ALL|${annoCorrente}|${ingredienteKey}`
          ];

          let prezziData = null;
          for (const k of keysToTry) {
            if (prezzoDizionario.byYear[k]) {
              prezziData = prezzoDizionario.byYear[k];
              break;
            }
          }

          if (!prezziData) {
            // fallback ultimo anno per azienda specifica o ALL
            const latestAzi = prezzoDizionario.latest[`${aziendaKey}|${ingredienteKey}`];
            const latestAll = prezzoDizionario.latest[`ALL|${ingredienteKey}`];
            prezziData = (latestAzi?.entry) || (latestAll?.entry) || { totEuro: 0, kgTot: 0, pzTot: 0, umBase: 'KG' };
          }
          
          // Calcola prezzo unitario (€/KG o €/PZ)
          let prezzoUnitario = 0;
          if (umBase.toUpperCase() === 'KG' && prezziData.kgTot > 0) {
            prezzoUnitario = prezziData.totEuro / prezziData.kgTot; // €/KG
          } else if (umBase.toUpperCase() === 'PZ' && prezziData.pzTot > 0) {
            prezzoUnitario = prezziData.totEuro / prezziData.pzTot; // €/PZ
          }
          
          // Calcola valore totale (prezzo unitario × quantità conteggiata)
          const valoreTotale = prezzoUnitario * quantitaNum;
          
          imported.push({
            dataInventario,
            azienda: aziendaKey,
            nomeIngrediente: nomeGruppo,  // Nome ingrediente/gruppo
            descrizione: '', // Verrà arricchito se necessario
            categoria,
            quantita: quantitaNum, // Quantità totale del gruppo
            umBase,
            prezzoUnitario: prezzoUnitario, // ⭐ €/KG o €/PZ
            valoreTotale: valoreTotale,     // ⭐ Prezzo unitario × Quantità
            codiciInterni: codiciInterni, // Array di tutti i codici (salva come JSON)
            note: note || '',
            operatore: Session.getEffectiveUser().getEmail() || 'Sistema'
          });

        } catch (e) {
          errors.push({ 
            rowNum, 
            error: e.message, 
            stack: e.stack ? e.stack.substring(0, 200) : '',
            nomeGruppo: String(nomeGruppo).substring(0, 40)
          });
        }
      });

      // ✅ STEP: Salva nel foglio Inventari_DB
      if (imported.length > 0) {
        const dbSheet = SHEETS.get(SHEETS.SHEET_NAMES.Inventari_DB);
        if (!dbSheet) {
          throw new Error('Foglio "Inventari_DB" non trovato. Eseguire Setup Fogli prima.');
        }

        const headerRow = SHEETS._findHeaderRow(dbSheet, SHEETS.SHEET_NAMES.Inventari_DB);
        const startRow = Math.max(dbSheet.getLastRow() + 1, headerRow + 1);

        // Prepara righe per scrittura
        // ⭐ 1 riga per ingrediente, non per codice
        const rowsToWrite = imported.map(item => [
          item.dataInventario,
          item.azienda,
          item.nomeIngrediente,           // Nome ingrediente/gruppo
          item.descrizione,
          item.categoria,
          item.quantita,                  // Quantità totale del gruppo
          item.umBase,
          item.prezzoUnitario,            // ⭐ €/KG o €/PZ
          item.valoreTotale,              // ⭐ Prezzo unitario × Quantità
          JSON.stringify(item.codiciInterni), // Salva array codici come JSON
          item.note,
          item.operatore
        ]);

        dbSheet.getRange(startRow, 1, rowsToWrite.length, 12).setValues(rowsToWrite);
        
        // ⭐ Forza formato NUMERO sulla colonna F (QuantitaConteggio) nel database
        if (rowsToWrite.length > 0) {
          dbSheet.getRange(startRow, 6, rowsToWrite.length, 1).setNumberFormat('0.00');
          // Forza formato CURRENCY sulla colonna H (PrezzoUnitario) e I (ValoreTotale)
          dbSheet.getRange(startRow, 8, rowsToWrite.length, 2).setNumberFormat('€ #,##0.00');
        }
        
        LOG.info(runId, 'INVENTORY_DB_WRITE', 'Dati scritti su Inventari_DB', {
          rowsWritten: rowsToWrite.length,
          startRow
        });

        // ⭐ ELIMINA il foglio INVENTARIO_ATTIVO dopo importazione riuscita
        try {
          ss.deleteSheet(sheet);
          LOG.info(runId, 'INVENTORY_DELETE_TEMP', 'Foglio INVENTARIO_ATTIVO eliminato dopo importazione');
        } catch (delErr) {
          LOG.warn(runId, 'INVENTORY_DELETE_FAIL', 'Errore eliminazione foglio INVENTARIO_ATTIVO', { error: delErr.message });
        }
      }

      const result = {
        success: true,
        imported: imported.length,
        skipped: skipped.length,
        errors: errors.length,
        details: { imported, skipped, errors }
      };

      LOG.info(runId, 'INVENTORY_IMPORT_DONE', 'Importazione completata', result);

      // Mostra riepilogo all'utente con dettagli errori
      let message = `Dati ${imported.length > 0 ? 'salvati nel foglio "Inventari_DB"' : 'NON salvati (nessun prodotto controllato)'}:\n\n` +
        `✓ Importati: ${imported.length} prodotti\n` +
        `⊗ Saltati: ${skipped.length} (quantità non compilata - inventario non controllato)\n` +
        `✗ Errori: ${errors.length}\n\n`;

      if (imported.length > 0) {
        message += `Data inventario: ${dataInventario.toLocaleString('it-IT')}\n\n`;
      }

      // Aggiungi dettagli errori se presenti
      if (errors.length > 0 && errors.length <= 5) {
        message += `\n📋 Dettagli errori:\n`;
        errors.forEach(err => {
          message += `• Riga ${err.rowNum}: ${err.error}\n`;
          if (err.nomeGruppo) message += `  Prodotto: ${err.nomeGruppo}\n`;
        });
      } else if (errors.length > 5) {
        message += `\n📋 Primi 5 errori:\n`;
        errors.slice(0, 5).forEach(err => {
          message += `• Riga ${err.rowNum}: ${err.error}\n`;
          if (err.nomeGruppo) message += `  Prodotto: ${err.nomeGruppo}\n`;
        });
        message += `\n(${errors.length - 5} errori aggiuntivi. Vedi Log per dettagli completi.)\n`;
      }

      // Suggerimenti se nessun dato importato
      if (imported.length === 0) {
        message += `\n⚠️ SUGGERIMENTI:\n`;
        if (skipped.length > 0) {
          message += `• Compila la colonna "Quantità Conteggio" (E) nel foglio INVENTARIO_ATTIVO\n`;
        }
        if (errors.length > 0) {
          message += `• Ricrea il foglio inventario (potrebbe essere corrotto)\n`;
          message += `• Menu: 📦 Inventario Fisico → 📋 Crea Scheda Conteggio\n`;
        }
      }

      SpreadsheetApp.getUi().alert(
        imported.length > 0 ? '✅ Importazione Inventario Completata' : '⚠️ Importazione Fallita',
        message,
        SpreadsheetApp.getUi().ButtonSet.OK
      );

      return result;

    } catch (e) {
      LOG.error(runId, 'INVENTORY_IMPORT_ERROR', 'Errore importazione inventario', {
        error: e.message,
        stack: e.stack
      });
      throw e;
    }
  }

  // API pubblica
  return {
    createCountSheet,
    importCountData
  };
})();

// Registra INVENTORY nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('INVENTORY', ['SHEETS', 'LOG']);
}

// Registra INVENTORY nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('INVENTORY', INVENTORY);
}
