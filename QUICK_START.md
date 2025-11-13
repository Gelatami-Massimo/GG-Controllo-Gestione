# GUIDA RAPIDA - GG GESTIONE GELATAMI V1 (v25.0)
## Post-Deployment Reference

---

## 🚀 QUICK START

### 1. Verify Deployment
```
1. Open Google Apps Script editor
2. Check Files section - should see 20 .gs files
3. Check .clasp.json in Project settings
4. Open spreadsheet → Menu should show "GG Controllo Gestione"
```

### 2. Check System Health
```javascript
// In Script Editor Console, run:
GG.diagnose()

// Should output:
// [GG.diagnose] Namespace GG: 19 moduli registrati
//   • CONFIG
//   • SHEETS
//   • LOG
//   ... (all 19 modules listed)
```

### 3. Enable Debug Mode
```javascript
// In Script Editor Console, run:
GG.get('PROFILER').enable(true)
GG.get('TRACER').enable(true)

// Then execute any function - debug info will appear in Cloud Logger
```

---

## 📖 MODULE REFERENCE

### Core Modules

#### CONFIG
```javascript
const value = GG.get('CONFIG').get('CARTELLA_INPUT_ID')
GG.get('CONFIG').set('key', value)
```

#### LOG
```javascript
GG.get('LOG').info('scope', 'message', { context: 'data' })
GG.get('LOG').warn('scope', 'message')
GG.get('LOG').error('scope', 'message')
GG.get('LOG').flush()  // Write buffered logs to sheet
```

#### UTIL
```javascript
const num = GG.get('UTIL').parseNum('123.45')
GG.get('UTIL').showToast('message', 'title', duration)
const lock = GG.get('UTIL').acquireLock(10000)
```

### Data Access

#### SHEETS
```javascript
const sheet = GG.get('SHEETS').get('sheet_name')
const range = GG.get('SHEETS').getRange('sheet_name', row, col, numRows, numCols)
```

#### STATE
```javascript
const value = GG.get('STATE').get('key')
GG.get('STATE').set('key', value)
const json = GG.get('STATE').getJSON('key', {})
```

### Business Logic

#### IMPORT_ROWS
```javascript
GG.get('IMPORT_ROWS').processRows()
```

#### PDF
```javascript
GG.get('PDF').generatePdf('file_id')
```

#### DASHBOARD
```javascript
GG.get('DASHBOARD').updateDashboard()
```

#### REPORTING
```javascript
const report = GG.get('REPORTING').generateReport(type)
```

---

## 🔧 DEBUGGING

### Enable Full Diagnostics
```javascript
// Enable profiler
GG.get('PROFILER').enable(true)
GG.get('PROFILER').configure({
  ENABLED: true,
  AUTO_LOG_THRESHOLD_MS: 100,  // Log if slower than 100ms
  CAPTURE_STACK_TRACES: true
})

// Enable tracer
GG.get('TRACER').enable(true)
GG.get('TRACER').trace('location', 'message', { data: 'value' })

// Check metrics
GG.get('METRICS').record('metric_name', value, 'unit')
GG.get('METRICS').getStats('metric_name')
```

### View Reports
```javascript
// Profiler report
console.log(GG.get('PROFILER').report('totalTime'))

// Tracer report
console.log(GG.get('TRACER').report())

// Metrics report
console.log(GG.get('METRICS').report())

// Full system diagnosis
GG.diagnose()
```

### Check Cloud Logger
```
1. Open Google Apps Script editor
2. Click "Executions" in left sidebar
3. Expand latest onOpen() execution
4. View all logs in expandable sections
```

---

## ⚠️ TROUBLESHOOTING

### Menu Doesn't Appear
```
1. Check Cloud Logger - look for errors
2. Try: GG.diagnose() in Console
3. Reload spreadsheet (Ctrl+Shift+F5)
4. Check that ModuleRegistry.validateAll() passed
```

### Module Not Found Error
```
// First, check which modules are loaded:
console.log(GG.list())

// If a module is missing, it means:
// - Load order issue (check .clasp.json)
// - Module file wasn't deployed
// - Module didn't call GG.register()
```

### Memory/Performance Issues
```
// Check system metrics
GG.get('METRICS').record('operation', duration, 'ms')

// Profile slow functions
const end = GG.get('PROFILER').startProfile('myFunction')
// ... do work ...
end()

// View results
GG.get('PROFILER').logReport()
```

---

## 📊 SYSTEM ARCHITECTURE

```
GG Namespace (1 central object)
├─ CONFIG          - Configuration manager
├─ SHEETS          - Spreadsheet interface
├─ LOG             - Logging system
├─ UTIL            - General utilities
├─ XMLSAFE         - XML parsing
├─ STATE           - Persistent state
├─ PRODUCTS        - Product management
├─ FILTERS         - Filter engine
├─ IMPORT_HEADERS  - Header import
├─ IMPORT_ROWS     - Row import
├─ PDF             - PDF export
├─ DASHBOARD       - Analytics dashboard
├─ REPORTING       - Report generation
├─ WAREHOUSE       - Warehouse management
├─ DEBUG           - Debug utilities
├─ PROFILER        - Performance profiler
├─ TRACER          - Execution tracer
├─ METRICS         - System metrics
└─ SETUP           - Setup assistant
```

---

## 🎯 COMMON TASKS

### Add Logging to a Function
```javascript
const myFunc = GG.get('PROFILER').wrap(
  function() {
    GG.get('LOG').info('MY_FUNC', 'Starting execution')
    // ... do work ...
    GG.get('LOG').info('MY_FUNC', 'Completed successfully')
  },
  'myFunc'
)

myFunc()  // Will be automatically profiled
```

### Track Execution Flow
```javascript
function importData() {
  const tracer = GG.get('TRACER')
  tracer.enable(true)
  
  tracer.trace('import.start', 'Import initiated')
  readHeaders()
  tracer.trace('import.headers', 'Headers read')
  readRows()
  tracer.trace('import.rows', 'Rows read')
  processData()
  tracer.trace('import.end', 'Import completed')
  
  console.log(tracer.report())
}
```

### Monitor Performance
```javascript
const metrics = GG.get('METRICS')

function processRow(row) {
  const start = Date.now()
  // ... process row ...
  const duration = Date.now() - start
  metrics.record('row_processing', duration, 'ms')
}

// Later, check stats
const stats = metrics.getStats('row_processing')
GG.get('LOG').info('PERF', `Average row processing: ${stats.average}ms`)
```

---

## 📞 VERSION INFO

- **Version**: 25.0
- **Deployed**: 13 Novembre 2025
- **Phases**: 6 (Complete)
- **Modules**: 19 (All registered)
- **Status**: Production-Ready ✅

---

## 🔄 MIGRATION FROM OLD API

### Old Code (v24)
```javascript
CONFIG.get('key')
LOG.info('scope', 'message')
PDF.generatePdf('id')
```

### New Code (v25.0)
```javascript
GG.get('CONFIG').get('key')
GG.get('LOG').info('scope', 'message')
GG.get('PDF').generatePdf('id')
```

### Both Work (Retrocompatibility)
Old global variables still exist as aliases during v25.x:
```javascript
CONFIG === GG.get('CONFIG')  // true
LOG === GG.get('LOG')        // true
```

Will be removed in v26.0. Plan migration accordingly.

---

## 📚 DOCUMENTATION

For detailed information, see:
- `PROJECT_COMPLETION_SUMMARY.md` - Complete project overview
- `FASE_6_DEPLOYMENT.md` - Deployment details
- `FASE_5_IMPLEMENTATION.md` - Debug utilities features
- `FASE_4_IMPLEMENTATION.md` - Versioning strategy
- `FASE_3_IMPLEMENTATION.md` - Namespace architecture
- `FASE_2_IMPLEMENTATION.md` - Dependency validation
- `ARCHITECTURAL_IMPROVEMENTS.md` - Strategic roadmap
- `DEPENDENCY_ANALYSIS.md` - Module dependency map

---

**Last Updated**: 13 Novembre 2025  
**For Support**: Check Cloud Logger for diagnostic messages  
**Next Version**: v25.1 (bugfixes, if needed), v26.0 (major release)
