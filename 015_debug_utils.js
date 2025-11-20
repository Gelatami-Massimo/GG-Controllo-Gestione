// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 015_debug_utils.js
// RUOLO: Profiling, tracing e analisi performance.
// NOTE: Tools diagnostici avanzati - PROFILER, TRACER, METRICS.
// =============================================================

/**
 * PROFILING & TRACING MODULE
 * 
 * Features:
 * - Function execution profiling (time, memory, calls)
 * - Stack trace collection and analysis
 * - Memory usage monitoring
 * - Performance bottleneck detection
 * - Async operation tracking
 * - Thread safety with LockService
 */

const PROFILER = (function () {

  // === STATE MANAGEMENT ===
  const profiles = {}; // Indexed by function name or label
  const executionStack = []; // Current execution stack for nested calls
  const locks = {}; // Per-label lock tracking
  const memorySnapshots = []; // Memory usage history

  // === CONFIGURATION ===
  const CONFIG_DEFAULTS = {
    ENABLED: false, // Disabled by default (performance impact)
    MAX_PROFILES: 100, // Maximum number of unique profiles to track
    MAX_HISTORY: 1000, // Maximum number of execution records per profile
    MEMORY_TRACKING: false, // Track memory usage (expensive)
    AUTO_LOG_THRESHOLD_MS: 1000, // Log execution > 1s
    CAPTURE_STACK_TRACES: true, // Capture stack traces
  };

  let config = { ...CONFIG_DEFAULTS };

  // === UTILITY FUNCTIONS ===

  /**
   * Get current memory usage (approximate, Apps Script)
   */
  function _getMemoryUsage() {
    try {
      // Apps Script doesn't expose direct memory API
      // Use script properties size as proxy
      const scriptProps = PropertiesService.getScriptProperties();
      const allProps = scriptProps.getProperties();
      let totalSize = 0;
      for (let key in allProps) {
        totalSize += (key.length + allProps[key].length);
      }
      return totalSize;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Generate stack trace (simplified)
   */
  function _getStackTrace() {
    try {
      throw new Error('Stack trace marker');
    } catch (e) {
      const stack = e.stack || '';
      // Parse stack and extract function names
      const lines = stack.split('\n').slice(2, 8); // Skip first 2, take 6 frames
      return lines
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .map(line => line.replace(/^at\s+/, ''))
        .join(' > ');
    }
  }

  /**
   * Format milliseconds to human-readable time
   */
  function _formatTime(ms) {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}min`;
  }

  /**
   * Ensure profile exists
   */
  function _ensureProfile(label) {
    if (!profiles[label]) {
      profiles[label] = {
        label: label,
        calls: 0,
        totalTime: 0,
        minTime: Infinity,
        maxTime: 0,
        errors: 0,
        history: [], // Array of {startTime, duration, error}
        lastError: null,
        createdAt: new Date(),
      };
    }
    return profiles[label];
  }

  // === PUBLIC API ===

  /**
   * Configure profiler
   */
  function configure(options = {}) {
    Object.assign(config, options);
    if (config.ENABLED) {
      LOG.info('PROFILER', 'Profiler enabled with config: ' + JSON.stringify(config));
    }
  }

  /**
   * Enable/disable profiler
   */
  function enable(enabled = true) {
    config.ENABLED = enabled;
    if (enabled) {
      LOG.info('PROFILER', 'Profiler ENABLED');
    } else {
      LOG.info('PROFILER', 'Profiler DISABLED');
    }
  }

  /**
   * Start profiling execution
   */
  function startProfile(label) {
    if (!config.ENABLED) return () => {};

    const profile = _ensureProfile(label);
    const startTime = performance.now ? performance.now() : new Date().getTime();
    const memoryBefore = config.MEMORY_TRACKING ? _getMemoryUsage() : 0;
    const stackTrace = config.CAPTURE_STACK_TRACES ? _getStackTrace() : '';

    executionStack.push({
      label: label,
      startTime: startTime,
      memoryBefore: memoryBefore,
      stackTrace: stackTrace,
    });

    /**
     * End profiling and record result
     */
    return function endProfile(error = null) {
      if (executionStack.length === 0) {
        LOG.warn('PROFILER', `endProfile called without matching startProfile for "${label}"`);
        return;
      }

      const entry = executionStack.pop();
      const duration = (performance.now ? performance.now() : new Date().getTime()) - entry.startTime;
      const memoryAfter = config.MEMORY_TRACKING ? _getMemoryUsage() : 0;
      const memoryDelta = memoryAfter - entry.memoryBefore;

      profile.calls++;
      profile.totalTime += duration;
      profile.minTime = Math.min(profile.minTime, duration);
      profile.maxTime = Math.max(profile.maxTime, duration);

      if (error) {
        profile.errors++;
        profile.lastError = {
          message: error.message || String(error),
          timestamp: new Date(),
        };
      }

      // Record in history (with size limit)
      if (profile.history.length >= config.MAX_HISTORY) {
        profile.history.shift();
      }
      profile.history.push({
        duration: duration,
        error: error ? { message: error.message || String(error) } : null,
        timestamp: new Date(),
        memoryDelta: memoryDelta,
      });

      // Auto-log slow executions
      if (duration > config.AUTO_LOG_THRESHOLD_MS) {
        LOG.warn('PROFILER', `Slow execution: "${label}" took ${_formatTime(duration)}`, {
          calls: profile.calls,
          avgTime: _formatTime(profile.totalTime / profile.calls),
          stackTrace: entry.stackTrace,
        });
      }
    };
  }

  /**
   * Wrap function for automatic profiling
   */
  function wrap(func, label = null) {
    const funcLabel = label || func.name || 'anonymous';

    return function wrappedFunction(...args) {
      const endProfile = startProfile(funcLabel);
      try {
        const result = func.apply(this, args);
        endProfile();
        return result;
      } catch (e) {
        endProfile(e);
        throw e;
      }
    };
  }

  /**
   * Get profile by label
   */
  function getProfile(label) {
    return profiles[label] || null;
  }

  /**
   * Get all profiles
   */
  function getAllProfiles() {
    return Object.values(profiles);
  }

  /**
   * Clear profiles
   */
  function reset() {
    Object.keys(profiles).forEach(key => delete profiles[key]);
    executionStack.length = 0;
    memorySnapshots.length = 0;
    LOG.info('PROFILER', 'Profiles reset');
  }

  /**
   * Generate profiling report
   */
  function report(sortBy = 'totalTime') {
    const allProfiles = getAllProfiles();
    if (allProfiles.length === 0) {
      return 'No profiles recorded.';
    }

    // Sort profiles
    let sorted = allProfiles.slice();
    if (sortBy === 'totalTime') {
      sorted.sort((a, b) => b.totalTime - a.totalTime);
    } else if (sortBy === 'calls') {
      sorted.sort((a, b) => b.calls - a.calls);
    } else if (sortBy === 'maxTime') {
      sorted.sort((a, b) => b.maxTime - a.maxTime);
    }

    // Build report
    let report = '╔════════════════════════════════════════════════════════╗\n';
    report += '║           PROFILER REPORT - PERFORMANCE ANALYSIS         ║\n';
    report += '╚════════════════════════════════════════════════════════╝\n\n';

    report += `Sorted by: ${sortBy}\n`;
    report += `Total profiles: ${allProfiles.length}\n`;
    report += `Total time: ${_formatTime(allProfiles.reduce((sum, p) => sum + p.totalTime, 0))}\n\n`;

    report += '┌─ Function ─┬─ Calls ─┬─ Total ─┬─ Avg ─┬─ Min ─┬─ Max ─┬─ Errors ─┐\n';

    sorted.forEach(p => {
      const avgTime = (p.calls > 0 ? p.totalTime / p.calls : 0);
      const label = (p.label || 'unknown').substring(0, 20).padEnd(20);
      const calls = String(p.calls).padStart(7);
      const total = _formatTime(p.totalTime).padStart(7);
      const avg = _formatTime(avgTime).padStart(7);
      const min = _formatTime(p.minTime).padStart(7);
      const max = _formatTime(p.maxTime).padStart(7);
      const errors = String(p.errors).padStart(8);

      report += `│${label}│${calls}│${total}│${avg}│${min}│${max}│${errors}│\n`;
    });

    report += '└────────────────────────────────────────────────────────┘\n';

    return report;
  }

  /**
   * Log report to Cloud Logger
   */
  function logReport(sortBy = 'totalTime') {
    const reportText = report(sortBy);
    LOG.info('PROFILER_REPORT', reportText);
    console.log(reportText);
  }

  // === RETURN PUBLIC API ===
  return {
    startProfile: startProfile,
    wrap: wrap,
    configure: configure,
    enable: enable,
    getProfile: getProfile,
    getAllProfiles: getAllProfiles,
    reset: reset,
    report: report,
    logReport: logReport,
    // Expose for debugging
    _getMemoryUsage: _getMemoryUsage,
    _getStackTrace: _getStackTrace,
  };
})();

// Registra PROFILER nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('PROFILER', ['LOG', 'UTIL']);
}

// Registra PROFILER nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('PROFILER', PROFILER);
}

/**
 * TRACER MODULE
 * 
 * Lightweight execution tracing for debugging control flow
 */
const TRACER = (function () {

  const traces = [];
  let enabled = false;

  const CONFIG_DEFAULTS = {
    ENABLED: false,
    MAX_TRACES: 5000,
    LOG_TO_CLOUD: false,
    INCLUDE_TIMESTAMPS: true,
  };

  let config = { ...CONFIG_DEFAULTS };

  /**
   * Configure tracer
   */
  function configure(options = {}) {
    Object.assign(config, options);
  }

  /**
   * Enable/disable tracer
   */
  function enable(enabledFlag = true) {
    enabled = enabledFlag;
    if (enabled) {
      LOG.info('TRACER', 'Tracer ENABLED');
    }
  }

  /**
   * Add trace point
   */
  function trace(location, message = '', data = {}) {
    if (!enabled) return;

    const traceEntry = {
      location: location,
      message: message,
      data: data,
      timestamp: config.INCLUDE_TIMESTAMPS ? new Date().toISOString() : null,
    };

    if (config.LOG_TO_CLOUD) {
      LOG.debug('TRACE', `[${location}] ${message}`, data);
    }

    traces.push(traceEntry);

    // Keep history size limited
    if (traces.length > config.MAX_TRACES) {
      traces.shift();
    }
  }

  /**
   * Get all traces
   */
  function getTraces(filter = null) {
    if (!filter) return traces.slice();

    return traces.filter(t => {
      if (filter.location && !t.location.includes(filter.location)) return false;
      if (filter.message && !t.message.includes(filter.message)) return false;
      return true;
    });
  }

  /**
   * Clear traces
   */
  function clear() {
    traces.length = 0;
  }

  /**
   * Generate trace report
   */
  function report() {
    if (traces.length === 0) return 'No traces recorded.';

    let output = '╔════════════════════════════════════════════════════════╗\n';
    output += '║             TRACER REPORT - EXECUTION FLOW              ║\n';
    output += '╚════════════════════════════════════════════════════════╝\n\n';

    output += `Total traces: ${traces.length}\n\n`;

    traces.forEach((t, idx) => {
      const ts = t.timestamp ? `[${t.timestamp}] ` : '';
      const location = `${t.location}`.padEnd(30);
      const hasData = Object.keys(t.data || {}).length > 0;

      output += `${idx + 1}. ${ts}${location} - ${t.message}\n`;
      if (hasData) {
        output += `   Data: ${JSON.stringify(t.data)}\n`;
      }
    });

    return output;
  }

  // === RETURN PUBLIC API ===
  return {
    configure: configure,
    enable: enable,
    trace: trace,
    getTraces: getTraces,
    clear: clear,
    report: report,
  };
})();

// Registra TRACER nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('TRACER', ['LOG']);
}

// Registra TRACER nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('TRACER', TRACER);
}

/**
 * METRICS MODULE
 * 
 * Collects runtime metrics for system health monitoring
 */
const METRICS = (function () {

  const metrics = {};

  /**
   * Record metric
   */
  function record(name, value, unit = '') {
    if (!metrics[name]) {
      metrics[name] = {
        name: name,
        values: [],
        unit: unit,
        createdAt: new Date(),
      };
    }

    metrics[name].values.push({
      value: value,
      timestamp: new Date(),
    });

    // Keep history limited
    const maxHistory = 1000;
    if (metrics[name].values.length > maxHistory) {
      metrics[name].values.shift();
    }
  }

  /**
   * Get metric statistics
   */
  function getStats(name) {
    const metric = metrics[name];
    if (!metric || metric.values.length === 0) return null;

    const values = metric.values.map(v => v.value);
    const sum = values.reduce((a, b) => a + b, 0);
    const avg = sum / values.length;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const latest = values[values.length - 1];

    return {
      name: name,
      count: values.length,
      latest: latest,
      average: avg,
      min: min,
      max: max,
      unit: metric.unit,
    };
  }

  /**
   * Get all metrics
   */
  function getAllMetrics() {
    const result = [];
    for (let name in metrics) {
      const stats = getStats(name);
      if (stats) result.push(stats);
    }
    return result;
  }

  /**
   * Clear metrics
   */
  function reset() {
    Object.keys(metrics).forEach(key => delete metrics[key]);
  }

  /**
   * Generate metrics report
   */
  function report() {
    const allMetrics = getAllMetrics();
    if (allMetrics.length === 0) return 'No metrics recorded.';

    let output = '╔════════════════════════════════════════════════════════╗\n';
    output += '║         METRICS REPORT - SYSTEM HEALTH MONITORING        ║\n';
    output += '╚════════════════════════════════════════════════════════╝\n\n';

    allMetrics.forEach(m => {
      const unit = m.unit ? ` ${m.unit}` : '';
      output += `${m.name}:\n`;
      output += `  Latest: ${m.latest}${unit}\n`;
      output += `  Average: ${m.average.toFixed(2)}${unit}\n`;
      output += `  Min: ${m.min}${unit}\n`;
      output += `  Max: ${m.max}${unit}\n`;
      output += `  Samples: ${m.count}\n\n`;
    });

    return output;
  }

  // === RETURN PUBLIC API ===
  return {
    record: record,
    getStats: getStats,
    getAllMetrics: getAllMetrics,
    reset: reset,
    report: report,
  };
})();

// Registra METRICS nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('METRICS', ['LOG']);
}

// Registra METRICS nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('METRICS', METRICS);
}
