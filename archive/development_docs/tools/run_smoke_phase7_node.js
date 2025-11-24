const fs = require('fs');
const vm = require('vm');
const path = require('path');

const smokePath = path.resolve(__dirname, '..', 'smoke_test_phase7.js');
let source = fs.readFileSync(smokePath, 'utf8');

// Strip possible Markdown code fences ```javascript ... ```
source = source.replace(/^\s*```[a-z]*\r?\n/, '');
source = source.replace(/\r?\n\s*```\s*$/,'');

// Minimal Logger mock
const Logger = {
  logs: [],
  log: function(...args) { console.log(...args); this.logs.push(args.join(' ')); },
};

// Minimal GG mock with ERROR_HANDLER and simple registry
const _registry = {};

function makeErrorHandler() {
  const stats = { total: 0, byScope: {} };
  const callbacks = [];
  const rateMap = {};

  function reportError(scope, message, error, context = {}) {
    const report = {
      timestamp: Date.now(),
      scope,
      message,
      errorType: error && error.name ? error.name : typeof error,
      context,
      userId: 'test-user@example.com'
    };
    stats.total = (stats.total || 0) + 1;
    stats.byScope[scope] = (stats.byScope[scope] || 0) + 1;
    callbacks.forEach(cb => {
      try { cb(report); } catch (e) { /* ignore */ }
    });
    return report;
  }

  function retryAsync(fn, opts = {}) {
    const maxRetries = opts.maxRetries || 0;
    let attempt = 0;
    while (true) {
      try {
        return fn();
      } catch (e) {
        if (attempt >= maxRetries) throw e;
        attempt++;
        // simple backoff
        const delay = opts.baseDelay || 0;
        if (delay) {
          const start = Date.now();
          while (Date.now() - start < delay) {} // busy wait but small delays in tests
        }
      }
    }
  }

  function withFallback(primary, fallback, opts = {}) {
    try {
      return primary();
    } catch (e) {
      return fallback();
    }
  }

  function withTimeout(fn, timeoutMs, opts = {}) {
    // For local tests we just call the function (no real timeout enforcement)
    return fn();
  }

  function isRateLimited(key, limit) {
    rateMap[key] = (rateMap[key] || 0) + 1;
    return rateMap[key] > limit;
  }

  function resetStats() {
    stats.total = 0;
    stats.byScope = {};
  }

  function getStats() {
    return {
      total: stats.total || 0,
      byScope: stats.byScope || {}
    };
  }

  function onError(cb) {
    callbacks.push(cb);
    return () => {
      const idx = callbacks.indexOf(cb);
      if (idx >= 0) callbacks.splice(idx, 1);
    };
  }

  return {
    retryAsync,
    withFallback,
    withTimeout,
    reportError,
    isRateLimited,
    resetStats,
    getStats,
    onError
  };
}

// Populate minimal GG registry
_registry['ERROR_HANDLER'] = makeErrorHandler();

const GG = {
  get: function(name) {
    return _registry[name];
  },
  register: function(name, obj) {
    _registry[name] = obj;
  }
};

// Provide globals for the VM
const sandbox = {
  Logger,
  GG,
  console,
  require,
  module,
  setTimeout,
  clearTimeout,
  Date,
};

vm.createContext(sandbox);

try {
  vm.runInContext(source, sandbox, { filename: smokePath });

  if (typeof sandbox.runPhase7SmokeTests !== 'function') {
    console.error('runPhase7SmokeTests() not found in smoke_test_phase7.js');
    process.exit(2);
  }

  const result = sandbox.runPhase7SmokeTests();
  console.log('\n=== SMOKE TEST RUNNER RESULT ===');
  console.log(JSON.stringify(result, null, 2));
  const failed = result.failed || 0;
  process.exit(failed > 0 ? 3 : 0);
} catch (e) {
  console.error('Error running smoke tests:', e);
  process.exit(2);
}
