// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 195_manual_sales.js
// RUOLO: Gestione vendite manuali con raggruppamento intelligente prodotti
// NOTE: Allineato alla logica di inventario fisico con raggruppamento per ingrediente
// =============================================================

const MANUAL_SALES = (() => {

  /**
   * Crea il foglio per l'inserimento delle vendite manuali con prodotti raggruppati.
   * 
   * LOGICA RAGGRUPPAMENTO (allineata a inventario fisico):
   * 1. Filtra prodotti con Ingrediente valorizzato e attivi (NonInUso=false)
   * 2. Raggruppa per nome ingrediente:
   *    - Ingrediente generico (TRUE/SI/YES/1) → gruppo = Descrizione prodotto
   *    - Ingrediente specifico (es. "LATTE") → gruppo = nome ingrediente
   * 3. Ogni gruppo conserva: nome, categoria, fornitore, UM, array codici
   * 4. Ordina per Categoria > Nome
   * 
   * @param {string} year - Anno di riferimento (es. "2024")
   * @param {string} month - Mese di riferimento (es. "01")
   * @returns {void}
   */
  function createSalesEntrySheet(year, month) {
    const runId = LOG.generateRunId();
    LOG.info(runId, 'MANUAL_SALES_CREATE', 'Creazione foglio vendite manuali', { year, month });

    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheetName = `Vendite_${year}_${month}`;
      
      // Elimina foglio esistente se presente
      const existingSheet = ss.getSheetByName(sheetName);
      if (existingSheet) {
        ss.deleteSheet(existingSheet);
        LOG.info(runId, 'MANUAL_SALES_DELETE_OLD', 'Foglio esistente eliminato', { sheetName });
      }

      // Crea nuovo foglio
      const sheet = ss.insertSheet(sheetName);
      
      // ✅ STEP 1: Recupera e raggruppa prodotti ingredienti attivi
      const groupedProducts = _getGroupedIngredientsForSales();
      
      LOG.info(runId, 'MANUAL_SALES_GROUPS', 'Prodotti raggruppati', {
        totalGroups: groupedProducts.length
      });

      // ✅ STEP 2: Crea intestazioni
      const headers = [
        'Categoria',           // A
        'Prodotto/Ingrediente', // B
        'Fornitore',           // C
        'UM',                  // D
        'Quantità Venduta',    // E
        'Note',                // F
        'CodiciInterni'        // G (nascosta - JSON array)
      ];

      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      
      // Formattazione header
      const headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground('#4A86E8');
      headerRange.setFontColor('#FFFFFF');
      headerRange.setFontWeight('bold');
      headerRange.setHorizontalAlignment('center');

      // ✅ STEP 3: Inserisci righe raggruppate
      if (groupedProducts.length > 0) {
        const dataRows = groupedProducts.map(group => [
          group.categoria || '',
          group.nomeVisualizzato,
          group.fornitore,
          group.um,
          '', // Quantità (da compilare manualmente)
          '', // Note
          JSON.stringify(group.codiciInterni) // JSON nascosto
        ]);

        sheet.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);
        
        // Formattazione zebrata
        for (let i = 0; i < dataRows.length; i++) {
          const rowNum = i + 2;
          const rowRange = sheet.getRange(rowNum, 1, 1, headers.length);
          if (i % 2 === 0) {
            rowRange.setBackground('#F3F3F3');
          }
        }

        LOG.info(runId, 'MANUAL_SALES_ROWS', 'Righe inserite', { count: dataRows.length });
      }

      // ✅ STEP 4: Formattazione colonne
      sheet.setColumnWidth(1, 120);  // Categoria
      sheet.setColumnWidth(2, 250);  // Prodotto/Ingrediente
      sheet.setColumnWidth(3, 180);  // Fornitore
      sheet.setColumnWidth(4, 60);   // UM
      sheet.setColumnWidth(5, 120);  // Quantità
      sheet.setColumnWidth(6, 200);  // Note
      sheet.setColumnWidth(7, 100);  // CodiciInterni (nascosta)

      // Nascondi colonna G (CodiciInterni JSON)
      sheet.hideColumns(7);

      // Proteggi colonne informative (solo Quantità e Note editabili)
      const protection = sheet.protect();
      protection.setDescription('Protezione vendite manuali');
      
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
        `FOGLIO VENDITE MANUALI - ${month}/${year}\n\n` +
        `ISTRUZIONI:\n` +
        `1. Compila la colonna "Quantità Venduta" con i valori venduti\n` +
        `2. Usa le Note per dettagli aggiuntivi\n` +
        `3. I prodotti sono raggruppati per ingrediente\n` +
        `4. La colonna "CodiciInterni" (nascosta) contiene i riferimenti ai prodotti\n\n` +
        `Generato il: ${new Date().toLocaleString('it-IT')}`
      );

      // Attiva il foglio
      sheet.activate();

      LOG.info(runId, 'MANUAL_SALES_COMPLETE', 'Foglio vendite creato con successo', {
        sheetName,
        productsCount: groupedProducts.length
      });

      SpreadsheetApp.getUi().alert(
        '✅ Foglio Vendite Creato',
        `Foglio "${sheetName}" creato con ${groupedProducts.length} prodotti raggruppati.\n\n` +
        `Compila la colonna "Quantità Venduta" per registrare le vendite.`,
        SpreadsheetApp.getUi().ButtonSet.OK
      );

    } catch (e) {
      LOG.error(runId, 'MANUAL_SALES_ERROR', 'Errore creazione foglio vendite', {
        error: e.message,
        stack: e.stack
      });
      throw e;
    }
  }

  /**
   * Recupera e raggruppa i prodotti ingredienti attivi per le vendite.
   * 
   * LOGICA RAGGRUPPAMENTO:
   * 1. Filtra: Ingrediente valorizzato + NonInUso=false
   * 2. Raggruppa per nome ingrediente (generico → Descrizione, specifico → nome ingrediente)
   * 3. Crea mappa con: nome, categoria, fornitore, UM, codici
   * 4. Ordina per Categoria > Nome
   * 
   * @returns {Array<Object>} Array di gruppi prodotti ordinati
   * @private
   */
  function _getGroupedIngredientsForSales() {
    const sh = SHEETS.get(SHEETS.SHEET_NAMES.Prodotti);
    if (!sh) {
      LOG.error('MANUAL_SALES_PRODUCTS', 'Foglio Prodotti non trovato');
      return [];
    }

    const headerRow = SHEETS._findHeaderRow(sh, SHEETS.SHEET_NAMES.Prodotti);
    if (sh.getLastRow() <= headerRow) {
      LOG.warn('MANUAL_SALES_PRODUCTS', 'Foglio Prodotti vuoto');
      return [];
    }

    const idx = SHEETS.headerIndex(SHEETS.SHEET_NAMES.Prodotti);
    
    // Validazione colonne richieste
    const requiredCols = ['Ingrediente', 'NonInUso', 'Descrizione', 'UM', 'CodiceInternoBreve', 'CategoriaProdotto', 'DenominazioneFornitore'];
    const missingCols = requiredCols.filter(col => idx[col] === undefined);
    if (missingCols.length > 0) {
      LOG.error('MANUAL_SALES_PRODUCTS', 'Colonne mancanti in Prodotti', { missingCols });
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
            categoria: String(row[idx.CategoriaProdotto] || '').trim(),
            fornitore: String(row[idx.DenominazioneFornitore] || '').trim()
          });
        }
      });

      LOG.info('MANUAL_SALES_FILTER', 'Prodotti ingredienti attivi filtrati', {
        totalProducts: values.length,
        activeIngredients: activeIngredients.length
      });

      // ✅ STEP 2: Raggruppa per nome ingrediente
      const groupsMap = new Map();

      activeIngredients.forEach(product => {
        let groupName;
        let isGenericIngredient = false;

        // Determina nome gruppo
        const ingredienteVal = product.ingrediente;
        const genericValues = ['TRUE', 'VERO', 'SI', 'YES', '1'];
        
        if (genericValues.includes(ingredienteVal)) {
          // Ingrediente generico → usa Descrizione prodotto
          groupName = product.descrizione;
          isGenericIngredient = true;
        } else {
          // Ingrediente specifico → usa nome ingrediente
          groupName = ingredienteVal;
          isGenericIngredient = false;
        }

        // Crea o aggiorna gruppo
        if (!groupsMap.has(groupName)) {
          groupsMap.set(groupName, {
            nomeVisualizzato: groupName,
            categoria: product.categoria,
            fornitore: isGenericIngredient ? product.fornitore : 'VARI (Raggruppato)',
            um: product.um,
            codiciInterni: []
          });
        }

        // Aggiungi codice al gruppo
        const group = groupsMap.get(groupName);
        group.codiciInterni.push(product.codiceInternoBreve);
      });

      LOG.info('MANUAL_SALES_GROUPS', 'Gruppi creati', {
        totalGroups: groupsMap.size
      });

      // ✅ STEP 3: Converti mappa in array e ordina
      const groupedProducts = Array.from(groupsMap.values());

      // Ordinamento: Categoria > Nome Visualizzato
      groupedProducts.sort((a, b) => {
        // Prima per categoria
        const catCompare = (a.categoria || '').localeCompare(b.categoria || '', 'it');
        if (catCompare !== 0) return catCompare;
        
        // Poi per nome visualizzato
        return (a.nomeVisualizzato || '').localeCompare(b.nomeVisualizzato || '', 'it');
      });

      LOG.info('MANUAL_SALES_SORT', 'Gruppi ordinati', {
        finalCount: groupedProducts.length
      });

      return groupedProducts;

    } catch (e) {
      LOG.error('MANUAL_SALES_PRODUCTS', 'Errore recupero prodotti raggruppati', {
        error: e.message,
        stack: e.stack
      });
      return [];
    }
  }

  /**
   * Importa le vendite dal foglio manuale al sistema.
   * Legge il foglio "Vendite_YYYY_MM", decodifica i JSON dei codici interni,
   * e registra le vendite per ogni prodotto.
   * 
   * @param {string} year - Anno di riferimento
   * @param {string} month - Mese di riferimento
   * @returns {Object} Risultato importazione con statistiche
   */
  function importSalesFromSheet(year, month) {
    const runId = LOG.generateRunId();
    LOG.info(runId, 'MANUAL_SALES_IMPORT_START', 'Avvio importazione vendite', { year, month });

    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const sheetName = `Vendite_${year}_${month}`;
      const sheet = ss.getSheetByName(sheetName);

      if (!sheet) {
        throw new Error(`Foglio "${sheetName}" non trovato. Creare prima il foglio vendite.`);
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
        const [categoria, nomeVisualizzato, fornitore, um, quantita, note, codiciJSON] = row;

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

          // Registra vendita per ogni codice del gruppo
          codiciInterni.forEach(codice => {
            imported.push({
              codiceInternoBreve: codice,
              quantita: Number(quantita),
              um,
              categoria,
              nomeVisualizzato,
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

      LOG.info(runId, 'MANUAL_SALES_IMPORT_DONE', 'Importazione completata', result);

      // TODO: Implementare scrittura su foglio "Vendite" o database
      // Per ora ritorna solo il risultato dell'analisi

      return result;

    } catch (e) {
      LOG.error(runId, 'MANUAL_SALES_IMPORT_ERROR', 'Errore importazione vendite', {
        error: e.message,
        stack: e.stack
      });
      throw e;
    }
  }

  // API pubblica
  return {
    createSalesEntrySheet,
    importSalesFromSheet
  };
})();

// Registra MANUAL_SALES nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('MANUAL_SALES', ['SHEETS', 'LOG']);
}

// Registra MANUAL_SALES nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('MANUAL_SALES', MANUAL_SALES);
}
