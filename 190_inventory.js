// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 190_inventory.js
// RUOLO: Gestione inventario fisico con conteggio prodotti raggruppati
// NOTE: Smart grouping per ingrediente con UMBase per guidare conteggio
// =============================================================

const INVENTORY = (() => {

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
        
        // Formattazione zebrata
        for (let i = 0; i < dataRows.length; i++) {
          const rowNum = i + 2;
          const rowRange = sheet.getRange(rowNum, 1, 1, headers.length);
          if (i % 2 === 0) {
            rowRange.setBackground('#E8F5E9'); // Verde chiaro
          }
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

      // ✅ STEP 6: Aggiungi istruzioni in nota
      const instructionCell = sheet.getRange(1, 1);
      instructionCell.setNote(
        `FOGLIO INVENTARIO FISICO\n\n` +
        `ISTRUZIONI:\n` +
        `1. Compila la colonna "Quantità Conteggio" con i valori reali conteggiati\n` +
        `2. Usa la colonna "UM" come riferimento per il conteggio:\n` +
        `   - PZ = conta singoli pezzi (non cartoni)\n` +
        `   - KG = pesa in chilogrammi\n` +
        `3. I prodotti sono raggruppati per ingrediente comune\n` +
        `4. La colonna "CodiciInterni" (nascosta) contiene i riferimenti ai prodotti\n\n` +
        `💡 ESEMPIO: Se vedi "KINDER CEREALI | UM: PZ", conta i singoli pezzi totali,\n` +
        `    non i cartoni o confezioni multiple.\n\n` +
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
        `Compila la colonna "Quantità Conteggio" durante l'inventario fisico.\n\n` +
        `💡 La colonna "UM" indica l'unità di misura da usare per il conteggio:\n` +
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
   * e crea report delle giacenze fisiche per ogni prodotto.
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

      if (!sheet) {
        throw new Error(`Foglio "${sheetName}" non trovato. Creare prima il foglio inventario.`);
      }

      const lastRow = sheet.getLastRow();
      if (lastRow < 2) {
        throw new Error('Nessun dato da importare (foglio vuoto).');
      }

      // Leggi dati (salta header)
      const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
      
      const imported = [];
      const skipped = [];
      const errors = [];

      data.forEach((row, i) => {
        const rowNum = i + 2;
        const [nomeGruppo, categoria, fornitore, umBase, quantita, note, codiciJSON] = row;

        // Salta righe senza quantità
        if (!quantita || Number(quantita) <= 0) {
          skipped.push({ rowNum, reason: 'Quantità mancante o zero' });
          return;
        }

        try {
          // Decodifica JSON codici interni
          const codiciInterni = JSON.parse(codiciJSON);
          
          if (!Array.isArray(codiciInterni) || codiciInterni.length === 0) {
            errors.push({ rowNum, error: 'JSON codici non valido o vuoto' });
            return;
          }

          // Registra giacenza per ogni codice del gruppo
          codiciInterni.forEach(codice => {
            imported.push({
              codiceInternoBreve: codice,
              quantita: Number(quantita),
              umBase,
              categoria,
              nomeGruppo,
              note: note || ''
            });
          });

        } catch (e) {
          errors.push({ rowNum, error: e.message });
        }
      });

      const result = {
        success: true,
        imported: imported.length,
        skipped: skipped.length,
        errors: errors.length,
        details: { imported, skipped, errors }
      };

      LOG.info(runId, 'INVENTORY_IMPORT_DONE', 'Importazione completata', result);

      // TODO: Implementare scrittura su foglio "Giacenze" o database
      // Per ora ritorna solo il risultato dell'analisi

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
