// =============================================================
// PROGETTO: GG GESTIONE GELATAMI V1
// FILE: 170_backup_service.js
// RUOLO: Backup automatico rotativo ERP
// =============================================================

const BACKUP_SERVICE = (() => {
  const BACKUP_FOLDER_NAME = 'ERP_BACKUPS';
  const RETENTION_DAYS = 7;

  function runNightlyBackup() {
    const now = new Date();
    const tz = Session.getScriptTimeZone() || 'Europe/Rome';
    const timestamp = Utilities.formatDate(now, tz, 'yyyy-MM-dd_HHmm');
    const backupName = `BACKUP_ERP_${timestamp}`;

    const folder = _ensureBackupFolder();
    const backupFile = _copySpreadsheet(backupName, folder);
    const trashedCount = _rotateOldBackups(folder, RETENTION_DAYS);

    _logInfo('BACKUP', `Backup creato: ${backupName}, File vecchi eliminati: ${trashedCount}`, {
      backupName,
      trashedCount,
      folderId: folder.getId(),
      backupFileId: backupFile.getId()
    });

    return { backupName, trashedCount };
  }

  function setupBackupTrigger() {
    // Crea trigger giornaliero tra le 02:00 e le 03:00
    ScriptApp.newTrigger('runNightlyBackup')
      .timeBased()
      .atHour(2)
      .everyDays(1)
      .create();
  }

  function _ensureBackupFolder() {
    const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
    return folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);
  }

  function _copySpreadsheet(backupName, targetFolder) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const copied = ss.copy(backupName);
    const file = DriveApp.getFileById(copied.getId());
    targetFolder.addFile(file);
    DriveApp.getRootFolder().removeFile(file); // mantiene ordine solo nella cartella target
    return file;
  }

  function _rotateOldBackups(folder, retentionDays) {
    const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let trashed = 0;
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const age = now - file.getLastUpdated().getTime();
      if (age > maxAgeMs) {
        file.setTrashed(true);
        trashed++;
      }
    }
    return trashed;
  }

  function _logInfo(scope, message, ctx) {
    if (typeof LOG !== 'undefined' && LOG.info) {
      LOG.info(scope, message, ctx);
    } else {
      console.log(`[${scope}] ${message}`, ctx || {});
    }
  }

  return {
    runNightlyBackup,
    setupBackupTrigger
  };
})();

// Registra nel ModuleRegistry
if (typeof ModuleRegistry !== 'undefined') {
  ModuleRegistry.register('BACKUP_SERVICE', ['LOG']);
}

// Registra nel namespace GG
if (typeof GG !== 'undefined') {
  GG.register('BACKUP_SERVICE', BACKUP_SERVICE);
}

// Wrapper globali
function runNightlyBackup() {
  BACKUP_SERVICE.runNightlyBackup();
}

function setupBackupTrigger() {
  BACKUP_SERVICE.setupBackupTrigger();
}
