// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 016_error_handler.js
// RUOLO: Framework error handling con retry, fallback, timeout.
// NOTE: Dipende da LOG e METRICS. Pattern safely() per operazioni non critiche.
// =============================================================

/**
 * ERROR_HANDLER Module
 * 
 * Provides:
 * - Async operations with exponential backoff retry
 * - Structured error reporting and logging
 * - Graceful degradation with fallback functions
 * - Error context tracking
 * - Rate limiting and throttling
 */
const ERROR_HANDLER = (function() {
  'use strict';

  // ============================================================================
  // INTERNAL STATE
  // ============================================================================
  
  const errorStats = {
    total: 0,
    byType: {},
    byScope: {},
    lastError: null,
    lastErrorTime: null,
    recoveryAttempts: 0,
    successfulRecoveries: 0
  };

  const errorCallbacks = [];
  const rateLimitCache = {};

  // ============================================================================
  // PRIVATE UTILITIES
  // ============================================================================
  
  /**
   * Calculate exponential backoff delay
   * @param {number} attempt - Attempt number (0-indexed)
   * @param {number} baseDelay - Base delay in ms
   * @returns {number} Delay in milliseconds
   */
  function getBackoffDelay(attempt, baseDelay = 1000) {
    const jitter = Math.random() * 0.1 * baseDelay;
    return baseDelay * Math.pow(2, attempt) + jitter;
  }

  /**
   * Extract detailed context from an error
   * @param {Error} error - Error object
   * @returns {Object} Error context
   */
  function extractErrorContext(error) {
    var userId = 'unknown';
    try {
      userId = Session.getActiveUser().getEmail();
    } catch (e) {
      // Permessi mancanti, usa 'unknown'
      userId = 'unknown';
    }
    
    return {
      name: error.name || 'Error',
      message: error.message || String(error),
      stack: error.stack || 'No stack trace',
      timestamp: new Date().toISOString(),
      userId: userId,
      spreadsheetId: SpreadsheetApp.getActiveSpreadsheet().getId()
    };
  }

  /**
   * Increment error statistics
   * @param {string} errorType - Type of error
   * @param {string} scope - Scope where error occurred
   */
  function recordErrorStat(errorType, scope) {
    errorStats.total++;
    errorStats.byType[errorType] = (errorStats.byType[errorType] || 0) + 1;
    errorStats.byScope[scope] = (errorStats.byScope[scope] || 0) + 1;
  }

  /**
   * Check if operation is rate limited
   * @param {string} key - Rate limit key
   * @param {number} maxPerMinute - Max calls per minute
   * @returns {boolean} True if rate limited
   */
  function isRateLimited(key, maxPerMinute = 10) {
    const now = Date.now();
    const minute = Math.floor(now / 60000);
    const cacheKey = `${key}:${minute}`;
    
    if (!rateLimitCache[cacheKey]) {
      rateLimitCache[cacheKey] = 0;
    }
    
    rateLimitCache[cacheKey]++;
    
    // Clean old entries
    for (let k in rateLimitCache) {
      const m = parseInt(k.split(':')[1]);
      if (m < minute - 2) {
        delete rateLimitCache[k];
      }
    }
    
    return rateLimitCache[cacheKey] > maxPerMinute;
  }

  /**
   * Trigger registered error callbacks
   * @param {Object} errorInfo - Error information object
   */
  function triggerErrorCallbacks(errorInfo) {
    errorCallbacks.forEach(callback => {
      try {
        callback(errorInfo);
      } catch (e) {
        // Prevent callback errors from propagating
      }
    });
  }

  // ============================================================================
  // PUBLIC API
  // ============================================================================
  
  return {
    
    /**
     * Execute async operation with exponential backoff retry
     * 
     * @param {Function} fn - Async function to execute
     * @param {Object} options - Configuration options
     *   - maxRetries: Number of retries (default: 3)
     *   - baseDelay: Base delay in ms (default: 1000)
     *   - timeout: Operation timeout in ms (default: 30000)
     *   - scope: Operation scope for logging (default: 'ASYNC_OP')
     *   - onRetry: Callback on retry attempt
     * @returns {*} Result of function execution
     * @throws {Error} If all retries exhausted
     * 
     * @example
     * const result = GG.ERROR_HANDLER.retryAsync(
     *   () => fetchData(),
     *   { maxRetries: 5, scope: 'DATA_FETCH' }
     * );
     */
    retryAsync: function(fn, options = {}) {
      // Controllo configurazione globale per disabilitare retry
      const disableRetries = (typeof CONFIG !== 'undefined' && CONFIG.get('DISABLE_RETRIES', false) === true);
      
      let {
        maxRetries = 3,
        baseDelay = 1000,
        timeout = 30000,
        scope = 'ASYNC_OP',
        onRetry = null
      } = options;
      
      // Se retry disabilitati globalmente, forza singolo tentativo
      if (disableRetries) {
        maxRetries = 0;
      }

      let lastError = null;
      
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          // Execute with timeout
          const result = fn();
          
          if (attempt > 0) {
            GG.get('LOG').info('RETRY', `Success after ${attempt} retries`, {
              scope: scope,
              attemptsNeeded: attempt + 1
            });
            errorStats.successfulRecoveries++;
          }
          
          return result;
          
        } catch (error) {
          lastError = error;
          const context = extractErrorContext(error);
          
          if (attempt === maxRetries) {
            // Final attempt failed
            GG.get('LOG').error(scope, `Failed after ${maxRetries + 1} attempts`, context);
            recordErrorStat(error.name, scope);
            throw error;
          }
          
          // Calculate backoff and retry
          const delay = getBackoffDelay(attempt, baseDelay);
          errorStats.recoveryAttempts++;
          
          GG.get('LOG').warn('RETRY', `Attempt ${attempt + 1}/${maxRetries + 1} failed, retrying in ${delay}ms`, {
            scope: scope,
            error: error.message,
            nextDelay: delay
          });
          
          if (onRetry) {
            try {
              onRetry(attempt, error, delay);
            } catch (e) {
              // Ignore callback errors
            }
          }
          
          Utilities.sleep(delay);
        }
      }
      
      // Should never reach here
      throw lastError || new Error('Retry loop failed');
    },

    /**
     * Execute operation with fallback function
     * 
     * Tries primary function, falls back to alternative if it fails
     * 
     * @param {Function} primaryFn - Primary operation
     * @param {Function} fallbackFn - Fallback operation
     * @param {Object} options - Configuration
     *   - scope: Operation scope for logging (default: 'FALLBACK_OP')
     *   - reportError: Whether to report errors (default: true)
     * @returns {*} Result from primary or fallback function
     * 
     * @example
     * const data = GG.ERROR_HANDLER.withFallback(
     *   () => fetchFromCache(),
     *   () => fetchFromServer(),
     *   { scope: 'DATA_FETCH' }
     * );
     */
    withFallback: function(primaryFn, fallbackFn, options = {}) {
      const {
        scope = 'FALLBACK_OP',
        reportError = true
      } = options;

      try {
        return primaryFn();
      } catch (primaryError) {
        const context = extractErrorContext(primaryError);
        
        GG.get('LOG').warn('FALLBACK', 'Primary operation failed, using fallback', {
          scope: scope,
          primaryError: primaryError.message,
          fallback: 'enabled'
        });

        try {
          const result = fallbackFn();
          
          GG.get('LOG').info('FALLBACK', 'Fallback succeeded', {
            scope: scope,
            primaryError: primaryError.message
          });
          
          recordErrorStat('FallbackRecovery', scope);
          errorStats.successfulRecoveries++;
          
          return result;
          
        } catch (fallbackError) {
          const fallbackContext = extractErrorContext(fallbackError);
          
          if (reportError) {
            GG.get('LOG').error(scope, 'Both primary and fallback failed', {
              primaryError: primaryError.message,
              fallbackError: fallbackError.message
            });
          }
          
          recordErrorStat(fallbackError.name, scope);
          throw fallbackError;
        }
      }
    },

    /**
     * Execute operation with timeout protection
     * 
     * @param {Function} fn - Function to execute
     * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
     * @param {Object} options - Configuration
     *   - scope: Operation scope for logging
     *   - onTimeout: Callback if timeout occurs
     * @returns {*} Function result
     * @throws {Error} If operation times out
     * 
     * @example
     * try {
     *   const result = GG.ERROR_HANDLER.withTimeout(
     *     () => longRunningOperation(),
     *     5000,
     *     { scope: 'LONG_OP' }
     *   );
     * } catch (e) {
     *   if (e.message.includes('timeout')) {
     *     // Handle timeout
     *   }
     * }
     */
    withTimeout: function(fn, timeoutMs = 30000, options = {}) {
      const { scope = 'TIMEOUT_OP', onTimeout = null } = options;
      const startTime = Date.now();
      
      try {
        const result = fn();
        const elapsed = Date.now() - startTime;
        
        if (elapsed > timeoutMs * 0.9) {
          GG.get('LOG').warn(scope, 'Operation near timeout threshold', {
            elapsed: elapsed,
            timeout: timeoutMs,
            percentage: Math.round((elapsed / timeoutMs) * 100)
          });
        }
        
        return result;
        
      } catch (error) {
        const elapsed = Date.now() - startTime;
        
        if (elapsed >= timeoutMs) {
          const timeoutError = new Error(`Operation timeout after ${elapsed}ms`);
          timeoutError.name = 'TimeoutError';
          
          GG.get('LOG').error(scope, 'Operation timeout', {
            timeout: timeoutMs,
            elapsed: elapsed,
            originalError: error.message
          });
          
          if (onTimeout) {
            try {
              onTimeout(elapsed, error);
            } catch (e) {}
          }
          
          recordErrorStat('TimeoutError', scope);
          throw timeoutError;
        }
        
        throw error;
      }
    },

    /**
     * Report structured error
     * 
     * Records error with full context for debugging and monitoring
     * 
     * @param {string} scope - Operation scope where error occurred
     * @param {string} message - User-friendly error message
     * @param {Error} error - Error object
     * @param {Object} context - Additional context data
     * @returns {Object} Error report object
     * 
     * @example
     * try {
     *   // operation
     * } catch (e) {
     *   GG.ERROR_HANDLER.reportError(
     *     'IMPORT_ROWS',
     *     'Failed to import row data',
     *     e,
     *     { rowIndex: 5, data: rowData }
     *   );
     * }
     */
    reportError: function(scope, message, error, context = {}) {
      const errorContext = extractErrorContext(error);
      
      const errorReport = {
        timestamp: errorContext.timestamp,
        scope: scope,
        message: message,
        errorType: errorContext.name,
        errorMessage: errorContext.message,
        stack: errorContext.stack,
        context: context,
        userId: errorContext.userId,
        spreadsheetId: errorContext.spreadsheetId
      };

      GG.get('LOG').error(scope, message, errorReport);
      recordErrorStat(error.name, scope);

      // Trigger error callbacks
      triggerErrorCallbacks(errorReport);

      errorStats.lastError = errorReport;
      errorStats.lastErrorTime = new Date();

      // If metrics available, record error
      try {
        if (GG.get('METRICS')) {
          GG.get('METRICS').increment('error_count', { scope: scope, type: error.name });
        }
      } catch (e) {
        // Metrics not available
      }

      return errorReport;
    },

    /**
     * Check if operation is rate limited
     * 
     * @param {string} key - Rate limit key/operation identifier
     * @param {number} maxPerMinute - Max calls per minute (default: 10)
     * @returns {boolean} True if rate limited
     * 
     * @example
     * if (GG.ERROR_HANDLER.isRateLimited('api_call', 5)) {
     *   throw new Error('Rate limit exceeded');
     * }
     */
    isRateLimited: function(key, maxPerMinute = 10) {
      return isRateLimited(key, maxPerMinute);
    },

    /**
     * Register error callback
     * 
     * Callback will be triggered on any error report
     * 
     * @param {Function} callback - Function to call on error(errorReport)
     * @returns {Function} Unregister function
     * 
     * @example
     * const unregister = GG.ERROR_HANDLER.onError((errorReport) => {
     *   sendAlert(errorReport);
     * });
     * 
     * // Later to stop listening:
     * unregister();
     */
    onError: function(callback) {
      errorCallbacks.push(callback);
      
      // Return unregister function
      return () => {
        const index = errorCallbacks.indexOf(callback);
        if (index > -1) {
          errorCallbacks.splice(index, 1);
        }
      };
    },

    /**
     * Get error statistics
     * 
     * @returns {Object} Statistics object with counts and metrics
     * 
     * @example
     * const stats = GG.ERROR_HANDLER.getStats();
     * console.log(`Total errors: ${stats.total}`);
     * console.log(`Recovery rate: ${stats.successfulRecoveries}/${stats.recoveryAttempts}`);
     */
    getStats: function() {
      return {
        total: errorStats.total,
        byType: { ...errorStats.byType },
        byScope: { ...errorStats.byScope },
        recoveryAttempts: errorStats.recoveryAttempts,
        successfulRecoveries: errorStats.successfulRecoveries,
        recoveryRate: errorStats.recoveryAttempts > 0 
          ? Math.round((errorStats.successfulRecoveries / errorStats.recoveryAttempts) * 100) 
          : 0,
        lastError: errorStats.lastError,
        lastErrorTime: errorStats.lastErrorTime
      };
    },

    /**
     * Reset error statistics
     * 
     * @example
     * GG.ERROR_HANDLER.resetStats();
     */
    resetStats: function() {
      errorStats.total = 0;
      errorStats.byType = {};
      errorStats.byScope = {};
      errorStats.lastError = null;
      errorStats.lastErrorTime = null;
      errorStats.recoveryAttempts = 0;
      errorStats.successfulRecoveries = 0;
      
      GG.get('LOG').info('ERROR_HANDLER', 'Statistics reset');
    },

    /**
     * Create error with structured context
     * 
     * @param {string} name - Error name
     * @param {string} message - Error message
     * @param {Object} context - Error context
     * @returns {Error} Error object with context
     * 
     * @example
     * throw GG.ERROR_HANDLER.createError(
     *   'ValidationError',
     *   'Invalid input data',
     *   { field: 'email', value: 'invalid' }
     * );
     */
    createError: function(name, message, context = {}) {
      const error = new Error(message);
      error.name = name;
      error.context = context;
      return error;
    },

    /**
     * Execute non-critical operation with error logging (no retry)
     * Useful for UI/formatting operations where retry doesn't make sense
     * 
     * @param {Function} fn - Function to execute
     * @param {Object} opts - Options { scope, message, suppressThrow }
     * @returns {*} Result of fn(), or undefined if error and suppressThrow=true
     * 
     * @example
     * GG.ERROR_HANDLER.safely(
     *   () => sheet.autoResizeColumns(1, 10),
     *   { scope: 'UI_FORMAT', message: 'Cannot resize columns' }
     * );
     */
    safely: function(fn, opts = {}) {
      const { scope = 'SAFELY', message = 'Operation failed', suppressThrow = true } = opts;
      const LOG = GG.get('LOG');
      
      try {
        return fn();
      } catch (e) {
        const context = extractErrorContext(e);
        LOG.warn(scope, message, { error: e.message, ...context });
        recordErrorStat(e.name, scope);
        
        if (!suppressThrow) throw e;
        return undefined;
      }
    }

  };
})();

// Registra ERROR_HANDLER nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('ERROR_HANDLER', ['LOG']); // Dipende da LOG per logging
}

// Register module in GG namespace
if (typeof GG !== 'undefined') {
  GG.register('ERROR_HANDLER', ERROR_HANDLER);
}

// Espone ERROR_HANDLER in globalThis per dependency tracking
if (typeof globalThis !== 'undefined') {
  globalThis.ERROR_HANDLER = ERROR_HANDLER;
}
