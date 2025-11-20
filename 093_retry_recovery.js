// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 093_retry_recovery.js
// RUOLO: DEPRECATO - Retry intelligente con backoff exponential.
// NOTE: DUPLICATO di ERROR_HANDLER (016) - da eliminare.
// =============================================================

var RETRY = (function() {
  'use strict';

  // Configurazione retry
  var MAX_RETRIES = 3;
  var INITIAL_BACKOFF_MS = 1000; // 1 secondo
  var MAX_BACKOFF_MS = 16000; // 16 secondi
  var BACKOFF_MULTIPLIER = 2;
  
  // Errori transitori (possono essere ritentati)
  var TRANSIENT_ERROR_PATTERNS = [
    /timeout/i,
    /timed out/i,
    /deadline exceeded/i,
    /service invoked too many times/i,
    /rate limit/i,
    /quota exceeded/i,
    /temporarily unavailable/i,
    /internal error/i,
    /backend error/i,
    /connection/i,
    /network/i,
    /ECONNRESET/i,
    /ETIMEDOUT/i,
    /503/,
    /502/,
    /500/
  ];
  
  // Errori permanenti (NON ritentare)
  var PERMANENT_ERROR_PATTERNS = [
    /not found/i,
    /404/,
    /permission denied/i,
    /403/,
    /unauthorized/i,
    /401/,
    /invalid/i,
    /malformed/i,
    /syntax error/i,
    /parse error/i,
    /reference.*is not defined/i
  ];
  
  /**
   * Esegue una funzione con retry automatico su errori transitori.
   * 
   * @param {Function} fn - Funzione da eseguire
   * @param {Object} options - Opzioni: {maxRetries, context, args, onRetry}
   * @returns {*} Risultato della funzione
   * @throws {Error} Se tutti i retry falliscono o errore permanente
   */
  function withRetry(fn, options) {
    options = options || {};
    var maxRetries = options.maxRetries || MAX_RETRIES;
    var context = options.context || null;
    var args = options.args || [];
    var onRetry = options.onRetry || null;
    var operationName = options.name || fn.name || 'unnamed operation';
    
    var attempt = 0;
    var lastError = null;
    
    while (attempt <= maxRetries) {
      try {
        LOG.debug('RETRY', 'Tentativo ' + (attempt + 1) + '/' + (maxRetries + 1) + ': ' + operationName);
        
        var result = fn.apply(context, args);
        
        if (attempt > 0) {
          LOG.info('RETRY', 'Operazione riuscita dopo ' + attempt + ' retry: ' + operationName);
        }
        
        return result;
        
      } catch (e) {
        lastError = e;
        attempt++;
        
        // Verifica se è un errore permanente
        if (_isPermanentError(e)) {
          LOG.error('RETRY', 'Errore permanente, nessun retry: ' + operationName, {
            error: e.message,
            attempt: attempt
          });
          throw e;
        }
        
        // Verifica se è transiente
        if (!_isTransientError(e)) {
          LOG.warn('RETRY', 'Errore non classificato come transiente, nessun retry: ' + operationName, {
            error: e.message
          });
          throw e;
        }
        
        // Se abbiamo esaurito i tentativi
        if (attempt > maxRetries) {
          LOG.error('RETRY', 'Esauriti tutti i ' + maxRetries + ' retry: ' + operationName, {
            error: e.message,
            stack: e.stack
          });
          throw new Error('Max retries (' + maxRetries + ') exceeded for ' + operationName + ': ' + e.message);
        }
        
        // Calcola backoff esponenziale
        var backoffMs = Math.min(
          INITIAL_BACKOFF_MS * Math.pow(BACKOFF_MULTIPLIER, attempt - 1),
          MAX_BACKOFF_MS
        );
        
        LOG.info('RETRY', 'Errore transiente, retry tra ' + backoffMs + 'ms: ' + operationName, {
          error: e.message,
          attempt: attempt,
          maxRetries: maxRetries
        });
        
        // Callback opzionale prima del retry
        if (onRetry && typeof onRetry === 'function') {
          try {
            onRetry(attempt, e, backoffMs);
          } catch (callbackError) {
            LOG.warn('RETRY', 'Errore in onRetry callback', {
              error: callbackError.message
            });
          }
        }
        
        // Attendi (backoff)
        Utilities.sleep(backoffMs);
      }
    }
    
    // Fallback (non dovrebbe mai arrivare qui)
    throw lastError;
  }
  
  /**
   * Crea un checkpoint per recovery.
   * Salva lo stato corrente in STATE per permettere il resume.
   * 
   * @param {string} operationType - Tipo operazione (HEADERS, ROWS, PDF)
   * @param {Object} checkpointData - Dati checkpoint: {cursor, processedCount, etc.}
   */
  function createCheckpoint(operationType, checkpointData) {
    try {
      var key = 'checkpoint_' + operationType;
      var checkpoint = {
        timestamp: new Date().toISOString(),
        operationType: operationType,
        data: checkpointData
      };
      
      STATE.set(key, JSON.stringify(checkpoint));
      
      LOG.debug('RETRY_CHECKPOINT', 'Checkpoint creato: ' + operationType, {
        processedCount: checkpointData.processedCount || 'N/A'
      });
      
    } catch (e) {
      LOG.warn('RETRY_CHECKPOINT', 'Errore creazione checkpoint', {
        operationType: operationType,
        error: e.message
      });
    }
  }
  
  /**
   * Recupera un checkpoint esistente.
   * 
   * @param {string} operationType - Tipo operazione (HEADERS, ROWS, PDF)
   * @returns {Object|null} Checkpoint o null se non esiste
   */
  function getCheckpoint(operationType) {
    try {
      var key = 'checkpoint_' + operationType;
      var checkpointJson = STATE.get(key, null);
      
      if (!checkpointJson) return null;
      
      var checkpoint = JSON.parse(checkpointJson);
      
      LOG.debug('RETRY_CHECKPOINT', 'Checkpoint recuperato: ' + operationType, {
        timestamp: checkpoint.timestamp
      });
      
      return checkpoint.data;
      
    } catch (e) {
      LOG.warn('RETRY_CHECKPOINT', 'Errore recupero checkpoint', {
        operationType: operationType,
        error: e.message
      });
      return null;
    }
  }
  
  /**
   * Cancella un checkpoint (dopo completamento operazione).
   * 
   * @param {string} operationType - Tipo operazione (HEADERS, ROWS, PDF)
   */
  function clearCheckpoint(operationType) {
    try {
      var key = 'checkpoint_' + operationType;
      STATE.delete(key);
      
      LOG.debug('RETRY_CHECKPOINT', 'Checkpoint cancellato: ' + operationType);
      
    } catch (e) {
      LOG.warn('RETRY_CHECKPOINT', 'Errore cancellazione checkpoint', {
        operationType: operationType,
        error: e.message
      });
    }
  }
  
  /**
   * Wrapper per operazioni con checkpoint automatici.
   * Salva checkpoint ogni N iterazioni e supporta recovery automatico.
   * 
   * @param {string} operationType - Tipo operazione
   * @param {Function} processFn - Funzione processo: (item, index) => void
   * @param {Array} items - Array di elementi da processare
   * @param {Object} options - Opzioni: {checkpointEvery, onProgress}
   * @returns {Object} Risultato: {processed, errors, recovered}
   */
  function withCheckpoints(operationType, processFn, items, options) {
    options = options || {};
    var checkpointEvery = options.checkpointEvery || 50;
    var onProgress = options.onProgress || null;
    
    // Tenta recovery da checkpoint esistente
    var checkpoint = getCheckpoint(operationType);
    var startIndex = 0;
    var recovered = false;
    
    if (checkpoint && checkpoint.lastProcessedIndex !== undefined) {
      startIndex = checkpoint.lastProcessedIndex + 1;
      recovered = true;
      LOG.info('RETRY_RECOVERY', 'Recovery da checkpoint: ' + operationType, {
        startIndex: startIndex,
        totalItems: items.length,
        remaining: items.length - startIndex
      });
    }
    
    var processed = 0;
    var errors = [];
    
    try {
      for (var i = startIndex; i < items.length; i++) {
        try {
          // Processa elemento con retry automatico
          withRetry(processFn, {
            context: null,
            args: [items[i], i],
            name: operationType + '[' + i + ']',
            maxRetries: 2 // Retry limitati per elementi singoli
          });
          
          processed++;
          
          // Callback progresso
          if (onProgress && typeof onProgress === 'function') {
            onProgress(i + 1, items.length);
          }
          
          // Crea checkpoint periodicamente
          if ((i + 1) % checkpointEvery === 0) {
            createCheckpoint(operationType, {
              lastProcessedIndex: i,
              processedCount: processed,
              totalCount: items.length
            });
          }
          
        } catch (e) {
          // Elemento singolo fallito (dopo retry)
          LOG.warn('RETRY_ITEM_FAILED', 'Elemento ' + i + ' fallito: ' + operationType, {
            error: e.message,
            index: i
          });
          
          errors.push({
            index: i,
            item: items[i],
            error: e.message
          });
          
          // Continua con prossimo elemento
        }
      }
      
      // Completato con successo - cancella checkpoint
      clearCheckpoint(operationType);
      
      LOG.info('RETRY_COMPLETE', 'Operazione completata: ' + operationType, {
        processed: processed,
        errors: errors.length,
        recovered: recovered
      });
      
      return {
        processed: processed,
        errors: errors,
        recovered: recovered
      };
      
    } catch (e) {
      // Errore critico - mantieni checkpoint per recovery
      LOG.error('RETRY_CRITICAL', 'Errore critico durante operazione: ' + operationType, {
        error: e.message,
        stack: e.stack,
        processed: processed,
        lastIndex: startIndex + processed - 1
      });
      
      // Salva checkpoint finale
      createCheckpoint(operationType, {
        lastProcessedIndex: startIndex + processed - 1,
        processedCount: processed,
        totalCount: items.length,
        lastError: e.message
      });
      
      throw e;
    }
  }
  
  /**
   * Esegue batch di operazioni con retry e rate limiting.
   * 
   * @param {Array} items - Elementi da processare
   * @param {Function} batchFn - Funzione batch: (batch) => void
   * @param {Object} options - Opzioni: {batchSize, delayBetweenBatches, maxRetries}
   * @returns {Object} Risultato: {totalProcessed, batchCount, errors}
   */
  function withBatchRetry(items, batchFn, options) {
    options = options || {};
    var batchSize = options.batchSize || 100;
    var delayBetweenBatches = options.delayBetweenBatches || 100;
    var maxRetries = options.maxRetries || MAX_RETRIES;
    
    var totalProcessed = 0;
    var batchCount = 0;
    var errors = [];
    
    for (var i = 0; i < items.length; i += batchSize) {
      var batch = items.slice(i, Math.min(i + batchSize, items.length));
      batchCount++;
      
      try {
        withRetry(batchFn, {
          context: null,
          args: [batch, i],
          name: 'Batch ' + batchCount + ' (items ' + i + '-' + (i + batch.length) + ')',
          maxRetries: maxRetries
        });
        
        totalProcessed += batch.length;
        
        // Rate limiting tra batch
        if (i + batchSize < items.length && delayBetweenBatches > 0) {
          Utilities.sleep(delayBetweenBatches);
        }
        
      } catch (e) {
        LOG.error('RETRY_BATCH_FAILED', 'Batch ' + batchCount + ' fallito dopo retry', {
          error: e.message,
          batchStart: i,
          batchSize: batch.length
        });
        
        errors.push({
          batchIndex: batchCount,
          startIndex: i,
          batchSize: batch.length,
          error: e.message
        });
        
        // Continua con prossimo batch (opzionale: throw per interrompere)
      }
    }
    
    LOG.info('RETRY_BATCH_COMPLETE', 'Operazione batch completata', {
      totalProcessed: totalProcessed,
      batchCount: batchCount,
      errors: errors.length
    });
    
    return {
      totalProcessed: totalProcessed,
      batchCount: batchCount,
      errors: errors
    };
  }
  
  // ========== FUNZIONI PRIVATE ==========
  
  /**
   * Verifica se un errore è transiente (può essere ritentato).
   */
  function _isTransientError(error) {
    var errorMessage = String(error.message || error);
    
    return TRANSIENT_ERROR_PATTERNS.some(function(pattern) {
      return pattern.test(errorMessage);
    });
  }
  
  /**
   * Verifica se un errore è permanente (NON ritentare).
   */
  function _isPermanentError(error) {
    var errorMessage = String(error.message || error);
    
    return PERMANENT_ERROR_PATTERNS.some(function(pattern) {
      return pattern.test(errorMessage);
    });
  }
  
  // API pubblica
  return {
    withRetry: withRetry,
    createCheckpoint: createCheckpoint,
    getCheckpoint: getCheckpoint,
    clearCheckpoint: clearCheckpoint,
    withCheckpoints: withCheckpoints,
    withBatchRetry: withBatchRetry,
    
    // Utilities per configurazione
    isTransientError: _isTransientError,
    isPermanentError: _isPermanentError
  };
  
})();

// Registra RETRY nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('RETRY', ['LOG', 'STATE']);
}

// Registra RETRY nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('RETRY', RETRY);
}
