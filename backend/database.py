# database.py — SQLite connection and schema initialisation
# get_db() is imported by every route file to obtain a connection.
# init_db() is called once at startup from app.py.

import sqlite3
import os
from dotenv import load_dotenv

load_dotenv()

# DB_PATH defaults to database.sqlite in the project root; override via .env
DB_PATH = os.path.join(os.path.dirname(__file__), os.getenv("DB_PATH", "database.sqlite"))


def get_db():
    """Return a WAL-mode SQLite connection with row_factory set to sqlite3.Row
    so query results are accessible as dicts (dict(row))."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")    # better concurrent read performance
    conn.execute("PRAGMA foreign_keys=ON")     # enforce FK constraints
    return conn


def init_db():
    """Create all tables and indexes if they don't already exist.
    Called once at server startup (app.py → __main__)."""
    conn = get_db()
    conn.executescript("""
        -- users: stores both employees and admins
        -- role is enforced at DB level; is_online toggled by auth routes
        CREATE TABLE IF NOT EXISTS users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT    NOT NULL,
            email      TEXT    UNIQUE NOT NULL,
            password   TEXT    NOT NULL,
            role       TEXT    NOT NULL DEFAULT 'employee' CHECK(role IN ('employee', 'admin')),
            is_online  INTEGER DEFAULT 0,
            created_at TEXT    DEFAULT (datetime('now'))
        );

        -- locations: GPS points synced from the employee device
        -- Batched by locationService.js and sent via POST /api/locations/sync
        CREATE TABLE IF NOT EXISTS locations (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            latitude    REAL    NOT NULL,
            longitude   REAL    NOT NULL,
            recorded_at TEXT    NOT NULL,   -- ISO timestamp from the device
            synced_at   TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_locations_user_date
            ON locations(user_id, recorded_at);

        -- activity_logs: idle-stop events detected by MapScreen.js
        -- Created via POST /api/activities; updated via PUT /api/activities/:id/respond
        CREATE TABLE IF NOT EXISTS activity_logs (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id        INTEGER NOT NULL,
            latitude       REAL    NOT NULL,
            longitude      REAL    NOT NULL,
            description    TEXT,
            triggered_at   TEXT    NOT NULL,
            dwell_duration INTEGER DEFAULT 0,
            status         TEXT    NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
            response       TEXT,
            responded_at   TEXT,
            created_at     TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_activity_user_date
            ON activity_logs(user_id, triggered_at);

        -- login_logs: one row per session; logout_time filled by POST /api/auth/logout
        -- login_time is used by MapScreen.js to display the "LOGIN TIME" value
        CREATE TABLE IF NOT EXISTS login_logs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            login_time  TEXT    DEFAULT (datetime('now')),
            logout_time TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        -- saved_locations: named pins marked by the employee via MapScreen.js modal
        -- Loaded on map startup; rendered as category-icon markers
        CREATE TABLE IF NOT EXISTS saved_locations (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            name       TEXT    NOT NULL,
            category   TEXT    NOT NULL DEFAULT 'other',
            latitude   REAL    NOT NULL,
            longitude  REAL    NOT NULL,
            created_at TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_saved_locations_user
            ON saved_locations(user_id);

        -- client_visits: matched stops where employee was at a saved "client" pin
        -- Populated via POST /api/sync/visits (routes/sync.py) on manual sync
        -- UNIQUE index enforces idempotency so re-syncing inserts 0 duplicate rows
        CREATE TABLE IF NOT EXISTS client_visits (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id             INTEGER NOT NULL,
            saved_location_name TEXT,
            saved_location_cat  TEXT,
            latitude            REAL    NOT NULL,
            longitude           REAL    NOT NULL,
            arrived_at          TEXT    NOT NULL,
            dwell_duration      INTEGER DEFAULT 0,
            date                TEXT    NOT NULL,
            synced_at           TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_client_visits_unique
            ON client_visits(user_id, arrived_at, saved_location_name);
        CREATE INDEX IF NOT EXISTS idx_client_visits_user_date
            ON client_visits(user_id, date);

        -- user_sync_log: records which dates each employee has synced to the server
        -- Stamped by every POST /api/sync/* endpoint; read by GET /api/sync/status
        -- INSERT OR REPLACE updates the synced_at timestamp on re-sync
        CREATE TABLE IF NOT EXISTS user_sync_log (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id   INTEGER NOT NULL,
            date      TEXT    NOT NULL,
            synced_at TEXT    NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, date)
        );

        -- company_settings: global key-value config controlled by the admin
        -- login_deadline (HH:MM) is fetched by MapScreen to colour the week login boxes
        CREATE TABLE IF NOT EXISTS company_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        INSERT OR IGNORE INTO company_settings (key, value) VALUES ('login_deadline', '09:00');

    """)
    conn.commit()

    # Idempotency unique indexes on existing tables — must be added after deduplication
    # because the DB may already contain duplicate rows from the pre-offline-first era.
    # Run outside executescript so each step can be handled independently.

    # locations: remove legacy duplicates, then enforce uniqueness for re-sync safety
    conn.execute("""
        DELETE FROM locations WHERE id NOT IN (
            SELECT MIN(id) FROM locations GROUP BY user_id, recorded_at
        )
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_user_recorded_unique
            ON locations(user_id, recorded_at)
    """)

    # activity_logs: remove legacy duplicates, then enforce uniqueness for re-sync safety
    conn.execute("""
        DELETE FROM activity_logs WHERE id NOT IN (
            SELECT MIN(id) FROM activity_logs GROUP BY user_id, triggered_at, latitude, longitude
        )
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_logs_user_triggered_unique
            ON activity_logs(user_id, triggered_at, latitude, longitude)
    """)

    # login_logs: enforce uniqueness so INSERT OR IGNORE in sync works correctly
    # login_time is set at the moment of login — no duplicates expected, safe to add directly
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_login_logs_user_time_unique
            ON login_logs(user_id, login_time)
    """)

    conn.commit()
    conn.close()
