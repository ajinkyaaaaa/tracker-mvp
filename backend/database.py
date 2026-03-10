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
    """)
    conn.commit()
    conn.close()
