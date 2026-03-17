#!/usr/bin/env python3
# tests/test_db.py — Database validation suite
# Verifies every table, query pattern, and constraint used by the backend routes.
# Non-destructive: all writes happen inside a transaction that is rolled back at the end.
# Run with: python backend/tests/test_db.py   (from project root)
#        or: python tests/test_db.py           (from backend/)

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import psycopg2
from database import get_db
from datetime import datetime

# ── Terminal colours ──────────────────────────────────────────────────────────
GREEN  = "\033[32m"
RED    = "\033[31m"
YELLOW = "\033[33m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

_passed   = 0
_failed   = 0
_sp_index = 0

# Sentinel email/values that will never collide with real data
_TEST_EMAIL = "__vispl_test__@__test__.internal"
_TEST_USER  = None   # set during setup; used by all tests


def _run(label, fn, db):
    """Run fn(db), print PASS/FAIL, isolate side-effects with a savepoint."""
    global _passed, _failed, _sp_index
    _sp_index += 1
    sp = f"sp_{_sp_index}"
    db.execute(f"SAVEPOINT {sp}")
    try:
        fn(db)
        db.execute(f"RELEASE SAVEPOINT {sp}")
        print(f"  {GREEN}PASS{RESET}  {label}")
        _passed += 1
    except Exception as exc:
        # Restore transaction state regardless of error type
        try:
            db.execute(f"ROLLBACK TO SAVEPOINT {sp}")
            db.execute(f"RELEASE SAVEPOINT {sp}")
        except Exception:
            pass
        print(f"  {RED}FAIL{RESET}  {label}")
        print(f"        → {exc}")
        _failed += 1


def _expect_error(db, sql, params=()):
    """Execute sql inside a nested savepoint; return True if it raised, False if it succeeded."""
    db.execute("SAVEPOINT expect_err")
    try:
        db.execute(sql, params)
        db.execute("ROLLBACK TO SAVEPOINT expect_err")
        db.execute("RELEASE SAVEPOINT expect_err")
        return False
    except Exception:
        db.execute("ROLLBACK TO SAVEPOINT expect_err")
        db.execute("RELEASE SAVEPOINT expect_err")
        return True


# ── Individual tests ──────────────────────────────────────────────────────────

def t_all_tables_exist(db):
    tables = [
        "users", "locations", "activity_logs", "login_logs",
        "saved_locations", "client_visits", "user_sync_log",
        "company_settings", "bug_reports",
    ]
    for table in tables:
        row = db.execute(
            "SELECT 1 FROM information_schema.tables "
            "WHERE table_schema = 'public' AND table_name = %s",
            (table,)
        ).fetchone()
        assert row, f"Table '{table}' not found"


def t_user_insert_returning_id(db):
    cur = db.execute(
        "INSERT INTO users (name, email, password, role) "
        "VALUES (%s, %s, %s, %s) RETURNING id",
        ("Test User 2", "__vispl_test_2__@__test__.internal", "hashed_pw", "employee"),
    )
    row = cur.fetchone()
    assert row and row["id"] > 0, "RETURNING id did not return a valid integer"


def t_user_duplicate_email_rejected(db):
    # _TEST_EMAIL was already inserted in setup; this must fail
    rejected = _expect_error(
        db,
        "INSERT INTO users (name, email, password) VALUES (%s, %s, %s)",
        ("Dup", _TEST_EMAIL, "x"),
    )
    assert rejected, "Duplicate email should have raised IntegrityError"


def t_user_invalid_role_rejected(db):
    rejected = _expect_error(
        db,
        "INSERT INTO users (name, email, password, role) VALUES (%s, %s, %s, %s)",
        ("Bad", "bad_role@test.internal", "x", "superuser"),
    )
    assert rejected, "Invalid role should have raised CHECK constraint error"


def t_user_select_by_email(db):
    row = db.execute(
        "SELECT id, name, role FROM users WHERE email = %s", (_TEST_EMAIL,)
    ).fetchone()
    assert row, "Could not SELECT the test user by email"
    assert row["name"] == "Test User"
    assert row["role"] == "employee"


def t_user_update_is_online(db):
    db.execute("UPDATE users SET is_online = 1 WHERE email = %s", (_TEST_EMAIL,))
    row = db.execute(
        "SELECT is_online FROM users WHERE email = %s", (_TEST_EMAIL,)
    ).fetchone()
    assert row["is_online"] == 1, "is_online UPDATE did not persist within transaction"


def t_location_insert(db):
    ts = datetime.utcnow().isoformat() + "Z"
    db.execute(
        "INSERT INTO locations (user_id, latitude, longitude, recorded_at) "
        "VALUES (%s, %s, %s, %s)",
        (_TEST_USER, 19.076, 72.877, ts),
    )
    row = db.execute(
        "SELECT latitude FROM locations WHERE user_id = %s", (_TEST_USER,)
    ).fetchone()
    assert row, "Location INSERT not readable in same transaction"


def t_location_date_cast_today(db):
    rows = db.execute(
        "SELECT latitude, longitude FROM locations "
        "WHERE user_id = %s AND recorded_at::DATE = CURRENT_DATE",
        (_TEST_USER,),
    ).fetchall()
    assert len(rows) > 0, "recorded_at::DATE = CURRENT_DATE returned no rows"


def t_location_date_cast_specific(db):
    today = datetime.utcnow().date().isoformat()
    rows = db.execute(
        "SELECT latitude FROM locations "
        "WHERE user_id = %s AND recorded_at::DATE = %s::DATE",
        (_TEST_USER, today),
    ).fetchall()
    assert len(rows) > 0, "recorded_at::DATE = specific date cast returned no rows"


def t_location_on_conflict_do_nothing(db):
    ts = datetime.utcnow().isoformat() + "Z"
    # Insert once
    db.execute(
        "INSERT INTO locations (user_id, latitude, longitude, recorded_at) "
        "VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
        (_TEST_USER, 18.5, 73.8, ts),
    )
    # Insert same row again — should silently skip
    db.execute(
        "INSERT INTO locations (user_id, latitude, longitude, recorded_at) "
        "VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
        (_TEST_USER, 18.5, 73.8, ts),
    )
    count = db.execute(
        "SELECT COUNT(*) as c FROM locations WHERE user_id = %s AND recorded_at = %s",
        (_TEST_USER, ts),
    ).fetchone()["c"]
    assert count == 1, f"ON CONFLICT DO NOTHING should keep 1 row, got {count}"


def t_location_fk_constraint(db):
    rejected = _expect_error(
        db,
        "INSERT INTO locations (user_id, latitude, longitude, recorded_at) "
        "VALUES (%s, %s, %s, %s)",
        (999999, 0.0, 0.0, "2000-01-01T00:00:00Z"),
    )
    assert rejected, "Non-existent user_id should have raised FK constraint error"


def t_activity_insert_returning_id(db):
    ts = datetime.utcnow().isoformat() + "Z"
    cur = db.execute(
        "INSERT INTO activity_logs "
        "(user_id, latitude, longitude, triggered_at, dwell_duration, status) "
        "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
        (_TEST_USER, 19.076, 72.877, ts, 900, "pending"),
    )
    row = cur.fetchone()
    assert row and row["id"] > 0, "Activity RETURNING id did not return a valid integer"


def t_activity_update_now(db):
    ts = datetime.utcnow().isoformat() + "Z"
    cur = db.execute(
        "INSERT INTO activity_logs "
        "(user_id, latitude, longitude, triggered_at, dwell_duration, status) "
        "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
        (_TEST_USER, 19.0, 72.0, ts, 600, "pending"),
    )
    act_id = cur.fetchone()["id"]
    db.execute(
        "UPDATE activity_logs SET response = %s, status = 'completed', responded_at = NOW() "
        "WHERE id = %s AND user_id = %s",
        ("Test response", act_id, _TEST_USER),
    )
    row = db.execute(
        "SELECT status, responded_at FROM activity_logs WHERE id = %s", (act_id,)
    ).fetchone()
    assert row["status"] == "completed", "Activity status not updated"
    assert row["responded_at"] is not None, "responded_at = NOW() is NULL"


def t_activity_pending_count(db):
    row = db.execute(
        "SELECT COUNT(*) as count FROM activity_logs "
        "WHERE user_id = %s AND status = 'pending' AND triggered_at::DATE = CURRENT_DATE",
        (_TEST_USER,),
    ).fetchone()
    assert row is not None and "count" in row, "Pending count query failed"
    assert isinstance(row["count"], int), f"Count is not int: {type(row['count'])}"


def t_activity_invalid_status_rejected(db):
    ts = datetime.utcnow().isoformat() + "Z"
    rejected = _expect_error(
        db,
        "INSERT INTO activity_logs "
        "(user_id, latitude, longitude, triggered_at, status) "
        "VALUES (%s, %s, %s, %s, %s)",
        (_TEST_USER, 0.0, 0.0, ts, "unknown_status"),
    )
    assert rejected, "Invalid status should have raised CHECK constraint error"


def t_login_log_insert_and_datetime(db):
    db.execute("INSERT INTO login_logs (user_id) VALUES (%s)", (_TEST_USER,))
    row = db.execute(
        "SELECT login_time FROM login_logs WHERE user_id = %s "
        "AND login_time::DATE = CURRENT_DATE ORDER BY id ASC LIMIT 1",
        (_TEST_USER,),
    ).fetchone()
    assert row, "Login log not found after INSERT"
    raw_time = row["login_time"]
    assert isinstance(raw_time, datetime), \
        f"login_time should be a datetime object, got {type(raw_time).__name__}"


def t_login_time_iso_format(db):
    row = db.execute(
        "SELECT login_time FROM login_logs WHERE user_id = %s LIMIT 1",
        (_TEST_USER,),
    ).fetchone()
    assert row, "No login_log row to format"
    raw_time = row["login_time"]
    iso = raw_time.replace(microsecond=0).isoformat() + "Z"
    assert iso.endswith("Z"), "ISO string missing Z suffix"
    assert "T" in iso, "ISO string missing T separator"


def t_logout_update_now(db):
    db.execute(
        "UPDATE login_logs SET logout_time = NOW() "
        "WHERE user_id = %s AND logout_time IS NULL",
        (_TEST_USER,),
    )
    row = db.execute(
        "SELECT logout_time FROM login_logs WHERE user_id = %s LIMIT 1",
        (_TEST_USER,),
    ).fetchone()
    assert row["logout_time"] is not None, "logout_time = NOW() is still NULL"


def t_saved_location_crud(db):
    # INSERT
    cur = db.execute(
        "INSERT INTO saved_locations (user_id, name, category, latitude, longitude) "
        "VALUES (%s, %s, %s, %s, %s) RETURNING id",
        (_TEST_USER, "Test Office", "office", 19.076, 72.877),
    )
    loc_id = cur.fetchone()["id"]
    assert loc_id > 0

    # SELECT
    row = db.execute(
        "SELECT name, category FROM saved_locations WHERE id = %s AND user_id = %s",
        (loc_id, _TEST_USER),
    ).fetchone()
    assert row["name"] == "Test Office"
    assert row["category"] == "office"

    # DELETE
    db.execute(
        "DELETE FROM saved_locations WHERE id = %s AND user_id = %s",
        (loc_id, _TEST_USER),
    )
    gone = db.execute(
        "SELECT id FROM saved_locations WHERE id = %s", (loc_id,)
    ).fetchone()
    assert gone is None, "Saved location should be deleted"


def t_client_visit_on_conflict_do_nothing(db):
    arrived = datetime.utcnow().isoformat() + "Z"
    today   = datetime.utcnow().date().isoformat()
    db.execute(
        "INSERT INTO client_visits "
        "(user_id, saved_location_name, saved_location_cat, latitude, longitude, arrived_at, date) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
        (_TEST_USER, "HQ", "office", 19.076, 72.877, arrived, today),
    )
    db.execute(
        "INSERT INTO client_visits "
        "(user_id, saved_location_name, saved_location_cat, latitude, longitude, arrived_at, date) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
        (_TEST_USER, "HQ", "office", 19.076, 72.877, arrived, today),
    )
    count = db.execute(
        "SELECT COUNT(*) as c FROM client_visits "
        "WHERE user_id = %s AND arrived_at = %s AND saved_location_name = %s",
        (_TEST_USER, arrived, "HQ"),
    ).fetchone()["c"]
    assert count == 1, f"ON CONFLICT DO NOTHING should keep 1 row, got {count}"


def t_user_sync_log_upsert(db):
    today = datetime.utcnow().date().isoformat()
    ts1   = datetime.utcnow().isoformat()
    ts2   = "2099-01-01T00:00:00"
    db.execute(
        "INSERT INTO user_sync_log (user_id, date, synced_at) VALUES (%s, %s, %s) "
        "ON CONFLICT (user_id, date) DO UPDATE SET synced_at = EXCLUDED.synced_at",
        (_TEST_USER, today, ts1),
    )
    db.execute(
        "INSERT INTO user_sync_log (user_id, date, synced_at) VALUES (%s, %s, %s) "
        "ON CONFLICT (user_id, date) DO UPDATE SET synced_at = EXCLUDED.synced_at",
        (_TEST_USER, today, ts2),
    )
    row = db.execute(
        "SELECT synced_at FROM user_sync_log WHERE user_id = %s AND date = %s",
        (_TEST_USER, today),
    ).fetchone()
    assert row["synced_at"] == ts2, \
        f"Upsert should update synced_at to {ts2}, got {row['synced_at']}"


def t_company_settings_upsert(db):
    db.execute(
        "INSERT INTO company_settings (key, value) VALUES ('login_deadline', '09:00') "
        "ON CONFLICT (key) DO NOTHING"
    )
    db.execute(
        "INSERT INTO company_settings (key, value) VALUES ('login_deadline', '10:00') "
        "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value"
    )
    row = db.execute(
        "SELECT value FROM company_settings WHERE key = 'login_deadline'"
    ).fetchone()
    assert row["value"] == "10:00", \
        f"Settings upsert should have updated value to 10:00, got {row['value']}"


def t_bug_report_insert_and_join(db):
    cur = db.execute(
        "INSERT INTO bug_reports (user_id, description) VALUES (%s, %s) RETURNING id",
        (_TEST_USER, "Test bug description"),
    )
    report_id = cur.fetchone()["id"]
    assert report_id > 0

    row = db.execute("""
        SELECT b.id, b.description, b.status,
               u.name AS user_name, u.email AS user_email
        FROM bug_reports b
        JOIN users u ON u.id = b.user_id
        WHERE b.id = %s
    """, (report_id,)).fetchone()
    assert row["description"] == "Test bug description"
    assert row["user_name"] == "Test User"
    assert row["user_email"] == _TEST_EMAIL
    assert row["status"] == "open"


def t_bug_report_resolve(db):
    cur = db.execute(
        "INSERT INTO bug_reports (user_id, description) VALUES (%s, %s) RETURNING id",
        (_TEST_USER, "Another test bug"),
    )
    report_id = cur.fetchone()["id"]
    db.execute(
        "UPDATE bug_reports SET status = 'resolved' WHERE id = %s", (report_id,)
    )
    row = db.execute(
        "SELECT status FROM bug_reports WHERE id = %s", (report_id,)
    ).fetchone()
    assert row["status"] == "resolved", "Bug report status not updated to resolved"


def t_admin_live_window_function(db):
    # Insert a location row so the window function has data to work with
    ts = datetime.utcnow().isoformat() + "Z"
    db.execute(
        "INSERT INTO locations (user_id, latitude, longitude, recorded_at) "
        "VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
        (_TEST_USER, 19.076, 72.877, ts),
    )
    db.execute("UPDATE users SET is_online = 1 WHERE id = %s", (_TEST_USER,))

    rows = db.execute("""
        SELECT u.id, u.name, u.email, u.is_online,
               l.latitude, l.longitude, l.recorded_at
        FROM users u
        LEFT JOIN (
            SELECT user_id, latitude, longitude, recorded_at,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY recorded_at DESC) as rn
            FROM locations
            WHERE recorded_at::DATE = CURRENT_DATE
        ) l ON u.id = l.user_id AND l.rn = 1
        WHERE u.role = 'employee' AND u.is_online = 1
    """).fetchall()
    match = [r for r in rows if r["id"] == _TEST_USER]
    assert len(match) == 1, "Admin live query did not return the test employee"
    assert match[0]["latitude"] == 19.076, "Latest location not picked by ROW_NUMBER"


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"\n{BOLD}VISPL Tracker — Database Test Suite{RESET}")
    print("=" * 45)

    # ── Step 1: connection check (outside main transaction) ───────────────────
    print(f"\n{YELLOW}[ Connection ]{RESET}")
    try:
        db = get_db()
        db.execute("SELECT 1")
        print(f"  {GREEN}PASS{RESET}  PostgreSQL connection established")
        _passed += 1
    except Exception as e:
        print(f"  {RED}FAIL{RESET}  Could not connect to PostgreSQL")
        print(f"        → {e}")
        print(f"\n{RED}Cannot continue without a database connection.{RESET}\n")
        sys.exit(1)

    # ── Step 2: run all tests inside a single transaction ─────────────────────
    # At the end we ROLLBACK so no test data persists.

    print(f"\n{YELLOW}[ Schema ]{RESET}")
    _run("All 9 tables exist", t_all_tables_exist, db)

    print(f"\n{YELLOW}[ Users ]{RESET}")
    # Insert the shared test user first (savepoint means it survives for later tests)
    try:
        cur = db.execute(
            "INSERT INTO users (name, email, password, role) "
            "VALUES (%s, %s, %s, %s) RETURNING id",
            ("Test User", _TEST_EMAIL, "hashed_pw", "employee"),
        )
        _TEST_USER = cur.fetchone()["id"]
    except Exception as e:
        print(f"  {RED}FAIL{RESET}  Test user setup failed: {e}")
        db._conn.rollback()
        sys.exit(1)

    _run("INSERT user with RETURNING id",      t_user_insert_returning_id,      db)
    _run("Duplicate email rejected",           t_user_duplicate_email_rejected, db)
    _run("Invalid role rejected (CHECK)",      t_user_invalid_role_rejected,    db)
    _run("SELECT user by email",               t_user_select_by_email,          db)
    _run("UPDATE is_online",                   t_user_update_is_online,         db)

    print(f"\n{YELLOW}[ Locations ]{RESET}")
    _run("INSERT location",                    t_location_insert,               db)
    _run("Date cast — CURRENT_DATE",           t_location_date_cast_today,      db)
    _run("Date cast — specific date",          t_location_date_cast_specific,   db)
    _run("ON CONFLICT DO NOTHING (duplicate)", t_location_on_conflict_do_nothing, db)
    _run("FK constraint — bad user_id",        t_location_fk_constraint,        db)

    print(f"\n{YELLOW}[ Activity Logs ]{RESET}")
    _run("INSERT activity with RETURNING id",  t_activity_insert_returning_id,  db)
    _run("UPDATE responded_at = NOW()",        t_activity_update_now,           db)
    _run("Pending COUNT with date cast",       t_activity_pending_count,        db)
    _run("Invalid status rejected (CHECK)",    t_activity_invalid_status_rejected, db)

    print(f"\n{YELLOW}[ Login Logs ]{RESET}")
    _run("INSERT + login_time as datetime",    t_login_log_insert_and_datetime, db)
    _run("login_time ISO string formatting",   t_login_time_iso_format,         db)
    _run("UPDATE logout_time = NOW()",         t_logout_update_now,             db)

    print(f"\n{YELLOW}[ Saved Locations ]{RESET}")
    _run("INSERT / SELECT / DELETE",           t_saved_location_crud,           db)

    print(f"\n{YELLOW}[ Client Visits ]{RESET}")
    _run("ON CONFLICT DO NOTHING (duplicate)", t_client_visit_on_conflict_do_nothing, db)

    print(f"\n{YELLOW}[ User Sync Log ]{RESET}")
    _run("ON CONFLICT DO UPDATE (upsert)",     t_user_sync_log_upsert,          db)

    print(f"\n{YELLOW}[ Company Settings ]{RESET}")
    _run("ON CONFLICT DO UPDATE (upsert)",     t_company_settings_upsert,       db)

    print(f"\n{YELLOW}[ Bug Reports ]{RESET}")
    _run("INSERT with RETURNING id + JOIN",    t_bug_report_insert_and_join,    db)
    _run("PATCH status to resolved",           t_bug_report_resolve,            db)

    print(f"\n{YELLOW}[ Admin Queries ]{RESET}")
    _run("ROW_NUMBER() window function (live fleet)", t_admin_live_window_function, db)

    # ── Step 3: rollback everything — no data persists ────────────────────────
    db._conn.rollback()
    db.close()

    # ── Summary ───────────────────────────────────────────────────────────────
    total = _passed + _failed
    print("\n" + "=" * 45)
    if _failed == 0:
        print(f"{BOLD}{GREEN}All {total} tests passed.{RESET}")
    else:
        print(f"{BOLD}Results: {GREEN}{_passed} passed{RESET}, {RED}{_failed} failed{RESET} / {total} total")
    print()
    sys.exit(0 if _failed == 0 else 1)
