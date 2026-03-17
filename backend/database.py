# database.py — PostgreSQL connection and schema initialisation
# get_db() is imported by every route file to obtain a connection.
# init_db() is called once at startup from app.py.

import os
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")


class _Conn:
    """Thin wrapper around a psycopg2 connection that mimics the sqlite3 connection
    API used throughout the route files (execute, executemany, commit, close).
    All cursors use RealDictCursor so rows are accessible as dicts."""

    def __init__(self, conn):
        self._conn = conn

    def execute(self, sql, params=()):
        cur = self._conn.cursor()
        cur.execute(sql, params)
        return cur

    def executemany(self, sql, seq_of_params):
        cur = self._conn.cursor()
        cur.executemany(sql, seq_of_params)
        return cur

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()


def get_db():
    """Return a PostgreSQL connection wrapped in _Conn."""
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    return _Conn(conn)


def init_db():
    """Create all tables and indexes if they don't already exist.
    Called once at server startup (app.py → __main__)."""
    conn = get_db()

    # users: stores both employees and admins
    conn.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id         SERIAL PRIMARY KEY,
            name       TEXT    NOT NULL,
            email      TEXT    UNIQUE NOT NULL,
            password   TEXT    NOT NULL,
            role       TEXT    NOT NULL DEFAULT 'employee' CHECK(role IN ('employee', 'admin')),
            is_online  INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)

    # locations: GPS points synced from the employee device
    # Batched by locationService.js and sent via POST /api/locations/sync
    conn.execute("""
        CREATE TABLE IF NOT EXISTS locations (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            latitude    DOUBLE PRECISION NOT NULL,
            longitude   DOUBLE PRECISION NOT NULL,
            recorded_at TEXT NOT NULL,
            synced_at   TIMESTAMP DEFAULT NOW()
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_locations_user_date
            ON locations(user_id, recorded_at)
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_locations_user_recorded_unique
            ON locations(user_id, recorded_at)
    """)

    # activity_logs: idle-stop events detected by MapScreen.js
    # Created via POST /api/activities; updated via PUT /api/activities/:id/respond
    conn.execute("""
        CREATE TABLE IF NOT EXISTS activity_logs (
            id             SERIAL PRIMARY KEY,
            user_id        INTEGER NOT NULL REFERENCES users(id),
            latitude       DOUBLE PRECISION NOT NULL,
            longitude      DOUBLE PRECISION NOT NULL,
            description    TEXT,
            triggered_at   TEXT NOT NULL,
            dwell_duration INTEGER DEFAULT 0,
            status         TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'completed')),
            response       TEXT,
            responded_at   TEXT,
            created_at     TIMESTAMP DEFAULT NOW()
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_activity_user_date
            ON activity_logs(user_id, triggered_at)
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_logs_user_triggered_unique
            ON activity_logs(user_id, triggered_at, latitude, longitude)
    """)

    # login_logs: one row per session; logout_time filled by POST /api/auth/logout
    conn.execute("""
        CREATE TABLE IF NOT EXISTS login_logs (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            login_time  TIMESTAMP DEFAULT NOW(),
            logout_time TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_login_logs_user_time_unique
            ON login_logs(user_id, login_time)
    """)

    # saved_locations: named pins marked by the employee via MapScreen.js modal
    conn.execute("""
        CREATE TABLE IF NOT EXISTS saved_locations (
            id         SERIAL PRIMARY KEY,
            user_id    INTEGER NOT NULL REFERENCES users(id),
            name       TEXT NOT NULL,
            category   TEXT NOT NULL DEFAULT 'other',
            latitude   DOUBLE PRECISION NOT NULL,
            longitude  DOUBLE PRECISION NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_saved_locations_user
            ON saved_locations(user_id)
    """)

    # client_visits: matched stops where employee was at a saved "client" pin
    # UNIQUE index enforces idempotency so re-syncing inserts 0 duplicate rows
    conn.execute("""
        CREATE TABLE IF NOT EXISTS client_visits (
            id                  SERIAL PRIMARY KEY,
            user_id             INTEGER NOT NULL REFERENCES users(id),
            saved_location_name TEXT,
            saved_location_cat  TEXT,
            latitude            DOUBLE PRECISION NOT NULL,
            longitude           DOUBLE PRECISION NOT NULL,
            arrived_at          TEXT NOT NULL,
            dwell_duration      INTEGER DEFAULT 0,
            date                TEXT NOT NULL,
            synced_at           TIMESTAMP DEFAULT NOW()
        )
    """)
    conn.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_client_visits_unique
            ON client_visits(user_id, arrived_at, saved_location_name)
    """)
    conn.execute("""
        CREATE INDEX IF NOT EXISTS idx_client_visits_user_date
            ON client_visits(user_id, date)
    """)

    # user_sync_log: records which dates each employee has synced to the server
    conn.execute("""
        CREATE TABLE IF NOT EXISTS user_sync_log (
            id        SERIAL PRIMARY KEY,
            user_id   INTEGER NOT NULL REFERENCES users(id),
            date      TEXT NOT NULL,
            synced_at TEXT NOT NULL,
            UNIQUE(user_id, date)
        )
    """)

    # company_settings: global key-value config controlled by the admin
    conn.execute("""
        CREATE TABLE IF NOT EXISTS company_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    """)
    conn.execute("""
        INSERT INTO company_settings (key, value) VALUES ('login_deadline', '09:00')
        ON CONFLICT (key) DO NOTHING
    """)

    # bug_reports: submitted by employees via ReportBugScreen.js → POST /api/bugs/report
    conn.execute("""
        CREATE TABLE IF NOT EXISTS bug_reports (
            id          SERIAL PRIMARY KEY,
            user_id     INTEGER NOT NULL REFERENCES users(id),
            description TEXT NOT NULL,
            status      TEXT DEFAULT 'open' CHECK(status IN ('open', 'resolved')),
            created_at  TIMESTAMP DEFAULT NOW()
        )
    """)

    conn.commit()
    conn.close()
