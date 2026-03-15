// localDatabase.js — Local SQLite database for offline-first storage
// Stores GPS locations, idle stops, client visits, and login sessions on-device.
// Nothing reaches the server until the user taps "Sync with VISPL" in SyncScreen.
//
// Data flows:
//   MapScreen.js → drainCacheToSQLite()      → insertLocation()
//   MapScreen.js → autoArchiveIdleEvent()    → insertStop() / insertClientVisit()
//   ArchiveScreen.js → getStopsByDate()      → card list
//   ArchiveScreen.js → respondToStop()       → marks stop completed
//   SyncScreen.js → insertLoginSession()     → local_login_sessions on each load
//   SyncScreen.js → getUnsyncedLoginSessions() → api.syncBulkLoginSessions() → markLoginSessionsSynced()
//   SyncScreen.js → getUnsynced*()           → api.syncBulk*() → mark*Synced()
//   CalendarScreen.js → getSyncLog() / getPendingDays()

import * as SQLite from 'expo-sqlite';

let db = null;

// Called from App.js before navigation renders; gates render via dbReady state.
export async function initLocalDB() {
  db = SQLite.openDatabaseSync('vispl_local.db');
  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS local_locations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      latitude    REAL    NOT NULL,
      longitude   REAL    NOT NULL,
      recorded_at TEXT    NOT NULL,
      date        TEXT    NOT NULL,
      synced      INTEGER DEFAULT 0,
      synced_at   TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ll_date        ON local_locations(date);
    CREATE INDEX IF NOT EXISTS idx_ll_synced_date ON local_locations(synced, date);

    CREATE TABLE IF NOT EXISTS local_stops (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      latitude       REAL    NOT NULL,
      longitude      REAL    NOT NULL,
      arrived_at     TEXT    NOT NULL,
      triggered_at   TEXT    NOT NULL,
      dwell_duration INTEGER DEFAULT 0,
      status         TEXT    NOT NULL DEFAULT 'pending',
      response       TEXT,
      responded_at   TEXT,
      date           TEXT    NOT NULL,
      synced         INTEGER DEFAULT 0,
      synced_at      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ls_date        ON local_stops(date);
    CREATE INDEX IF NOT EXISTS idx_ls_synced_date ON local_stops(synced, date);

    CREATE TABLE IF NOT EXISTS local_client_visits (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      stop_id             INTEGER,
      saved_location_name TEXT,
      saved_location_cat  TEXT,
      latitude            REAL    NOT NULL,
      longitude           REAL    NOT NULL,
      arrived_at          TEXT    NOT NULL,
      dwell_duration      INTEGER DEFAULT 0,
      date                TEXT    NOT NULL,
      synced              INTEGER DEFAULT 0,
      synced_at           TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lcv_date        ON local_client_visits(date);
    CREATE INDEX IF NOT EXISTS idx_lcv_synced_date ON local_client_visits(synced, date);

    CREATE TABLE IF NOT EXISTS sync_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      date            TEXT    UNIQUE NOT NULL,
      locations_total INTEGER DEFAULT 0,
      stops_total     INTEGER DEFAULT 0,
      visits_total    INTEGER DEFAULT 0,
      synced_at       TEXT,
      status          TEXT    DEFAULT 'pending'
    );

    CREATE TABLE IF NOT EXISTS local_login_sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      login_time TEXT    NOT NULL,
      date       TEXT    NOT NULL,
      synced     INTEGER DEFAULT 0,
      synced_at  TEXT,
      UNIQUE(login_time)
    );
    CREATE INDEX IF NOT EXISTS idx_lls_date ON local_login_sessions(date);
  `);
}

// ── Locations ──────────────────────────────────────────────────────────────────

// Inserts a single GPS point → called by drainCacheToSQLite() in MapScreen.js
export async function insertLocation({ latitude, longitude, recorded_at, date }) {
  await db.runAsync(
    'INSERT INTO local_locations (latitude, longitude, recorded_at, date) VALUES (?, ?, ?, ?)',
    [latitude, longitude, recorded_at, date]
  );
}

// Returns ordered GPS trail for a given date → MapScreen Polyline render
export async function getTodayPath(date) {
  return db.getAllAsync(
    'SELECT latitude, longitude, recorded_at FROM local_locations WHERE date = ? ORDER BY recorded_at ASC',
    [date]
  );
}

// Returns unsynced locations for SyncScreen → api.syncBulkLocations()
export async function getUnsyncedLocations(date) {
  return db.getAllAsync(
    'SELECT * FROM local_locations WHERE date = ? AND synced = 0 ORDER BY recorded_at ASC',
    [date]
  );
}

// Marks all unsynced locations for a date as synced → called after api.syncBulkLocations()
export async function markLocationsSynced(date) {
  await db.runAsync(
    "UPDATE local_locations SET synced = 1, synced_at = datetime('now') WHERE date = ? AND synced = 0",
    [date]
  );
}

// ── Stops ──────────────────────────────────────────────────────────────────────

// Inserts an idle stop → called by autoArchiveIdleEvent() in MapScreen.js; returns new row id
export async function insertStop({ latitude, longitude, arrived_at, triggered_at, dwell_duration, date }) {
  const result = await db.runAsync(
    'INSERT INTO local_stops (latitude, longitude, arrived_at, triggered_at, dwell_duration, date) VALUES (?, ?, ?, ?, ?, ?)',
    [latitude, longitude, arrived_at, triggered_at, dwell_duration, date]
  );
  return result.lastInsertRowId;
}

// Returns all stops for a date ordered newest-first → ArchiveScreen card list
export async function getStopsByDate(date) {
  return db.getAllAsync(
    'SELECT * FROM local_stops WHERE date = ? ORDER BY triggered_at DESC',
    [date]
  );
}

// Marks stop as completed with response → ArchiveScreen submitResponse() / muteLocationForHours()
export async function respondToStop(id, response) {
  await db.runAsync(
    "UPDATE local_stops SET status = 'completed', response = ?, responded_at = datetime('now'), synced = 0 WHERE id = ?",
    [response, id]
  );
}

// Returns unsynced stops for SyncScreen → api.syncBulkStops()
export async function getUnsyncedStops(date) {
  return db.getAllAsync(
    'SELECT * FROM local_stops WHERE date = ? AND synced = 0 ORDER BY triggered_at ASC',
    [date]
  );
}

// Updates dwell_duration on an existing stop → called by MapScreen after grace period
export async function updateStopDwell(id, dwell_duration) {
  await db.runAsync(
    'UPDATE local_stops SET dwell_duration = ? WHERE id = ?',
    [dwell_duration, id]
  );
}

// Marks all unsynced stops for a date as synced → called after api.syncBulkStops()
export async function markStopsSynced(date) {
  await db.runAsync(
    "UPDATE local_stops SET synced = 1, synced_at = datetime('now') WHERE date = ? AND synced = 0",
    [date]
  );
}

// ── Client Visits ───────────────────────────────────────────────────────────────

// Inserts a client visit matched to a saved location → called by autoArchiveIdleEvent() in MapScreen.js
export async function insertClientVisit({ stop_id, saved_location_name, saved_location_cat, latitude, longitude, arrived_at, dwell_duration, date }) {
  await db.runAsync(
    'INSERT INTO local_client_visits (stop_id, saved_location_name, saved_location_cat, latitude, longitude, arrived_at, dwell_duration, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [stop_id, saved_location_name, saved_location_cat, latitude, longitude, arrived_at, dwell_duration, date]
  );
}

// Returns all client visits for a date → SyncScreen Client Visits section
export async function getVisitsByDate(date) {
  return db.getAllAsync(
    'SELECT * FROM local_client_visits WHERE date = ? ORDER BY arrived_at ASC',
    [date]
  );
}

// Returns unsynced visits for SyncScreen → api.syncBulkVisits()
export async function getUnsyncedVisits(date) {
  return db.getAllAsync(
    'SELECT * FROM local_client_visits WHERE date = ? AND synced = 0 ORDER BY arrived_at ASC',
    [date]
  );
}

// Marks all unsynced visits for a date as synced → called after api.syncBulkVisits()
export async function markVisitsSynced(date) {
  await db.runAsync(
    "UPDATE local_client_visits SET synced = 1, synced_at = datetime('now') WHERE date = ? AND synced = 0",
    [date]
  );
}

// ── Sync Log ────────────────────────────────────────────────────────────────────

// Returns all sync log rows → CalendarScreen dot rendering
export async function getSyncLog() {
  return db.getAllAsync('SELECT * FROM sync_log ORDER BY date DESC');
}

// Upserts a sync log entry for a date → SyncScreen handleSync()
export async function upsertSyncLog(date, fields) {
  const cols         = ['date', ...Object.keys(fields)].join(', ');
  const placeholders = Array(Object.keys(fields).length + 1).fill('?').join(', ');
  const sets         = Object.keys(fields).map((k) => `${k} = excluded.${k}`).join(', ');
  await db.runAsync(
    `INSERT INTO sync_log (${cols}) VALUES (${placeholders}) ON CONFLICT(date) DO UPDATE SET ${sets}`,
    [date, ...Object.values(fields)]
  );
}

// ── Login Sessions ──────────────────────────────────────────────────────────────

// Records current login time locally → called by SyncScreen.js on each load
// INSERT OR IGNORE prevents duplicates if called multiple times in the same session
export async function insertLoginSession(login_time, date) {
  await db.runAsync(
    'INSERT OR IGNORE INTO local_login_sessions (login_time, date) VALUES (?, ?)',
    [login_time, date]
  );
}

// Returns unsynced login sessions → SyncScreen → api.syncBulkLoginSessions()
export async function getUnsyncedLoginSessions() {
  return db.getAllAsync(
    'SELECT * FROM local_login_sessions WHERE synced = 0 ORDER BY login_time ASC'
  );
}

// Marks all unsynced login sessions as synced → called after api.syncBulkLoginSessions()
export async function markLoginSessionsSynced() {
  await db.runAsync(
    "UPDATE local_login_sessions SET synced = 1, synced_at = datetime('now') WHERE synced = 0"
  );
}

// Returns login sessions for a date range → MapScreen week login status boxes
export async function getLoginSessionsByDateRange(startDate, endDate) {
  return db.getAllAsync(
    'SELECT * FROM local_login_sessions WHERE date >= ? AND date <= ? ORDER BY login_time ASC',
    [startDate, endDate]
  );
}

// Returns dates with unsynced local data → CalendarScreen hollow dots
export async function getPendingDays() {
  const locationDates = await db.getAllAsync(
    'SELECT DISTINCT date FROM local_locations WHERE synced = 0'
  );
  const stopDates = await db.getAllAsync(
    'SELECT DISTINCT date FROM local_stops WHERE synced = 0'
  );
  const all = new Set([
    ...locationDates.map((r) => r.date),
    ...stopDates.map((r) => r.date),
  ]);
  return [...all];
}
