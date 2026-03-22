# routes/admin.py — Admin-only fleet management routes
# All routes validate the admin role via require_admin() before proceeding.
# Frontend entry point: src/services/api.js → api.getEmployees / api.getLiveEmployees / etc.
# Consumed by: AdminDashboardScreen.js, AdminLiveScreen.js, AdminEmployeesScreen.js,
#              AdminDayLogScreen.js, AdminReportsScreen.js

import math
from datetime import datetime, timedelta
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt
from database import get_db   # → database.py

admin_bp = Blueprint("admin", __name__)


def require_admin():
    """Guard helper — returns a 403 response if the JWT role is not 'admin'.
    Called at the top of every route in this file before touching the DB."""
    if get_jwt().get("role") != "admin":
        return jsonify(error="Admin access required"), 403
    return None


# ── GET /api/admin/employees ──────────────────────────────────────────────────
# Returns all registered employee records (no location data).
# Consumed by api.js → api.getEmployees() → AdminDashboardScreen.js → loadEmployees()
# Used to populate the employee selector chips in the History tab.
@admin_bp.route("/employees", methods=["GET"])
@jwt_required()
def employees():
    err = require_admin()
    if err:
        return err

    db   = get_db()
    rows = db.execute(
        "SELECT id, name, email, role, is_online, created_at FROM users WHERE role = 'employee'"
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


# ── GET /api/admin/live ───────────────────────────────────────────────────────
# Returns currently online employees with their most recent GPS point for today.
# Uses a window function (ROW_NUMBER) to pick the latest location per user.
# Consumed by api.js → api.getLiveEmployees() → AdminDashboardScreen.js → loadLiveEmployees()
# Polled every 15 s; also updated in real-time via WebSocket (app.py → handle_location_update)
@admin_bp.route("/live", methods=["GET"])
@jwt_required()
def live():
    err = require_admin()
    if err:
        return err

    db   = get_db()
    rows = db.execute("""
        SELECT u.id, u.name, u.email, u.is_online,
               l.latitude, l.longitude, l.recorded_at
        FROM users u
        LEFT JOIN (
            SELECT user_id, latitude, longitude, recorded_at,
                   ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY recorded_at DESC) as rn
            FROM locations
            WHERE LEFT(recorded_at, 10) = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD')
        ) l ON u.id = l.user_id AND l.rn = 1
        WHERE u.role = 'employee' AND u.is_online = 1
    """).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


# ── GET /api/admin/employee/<id>/locations/<date> ─────────────────────────────
# Returns ordered GPS points for a specific employee on a given date.
# Consumed by api.js → api.getEmployeeLocations() → AdminDashboardScreen.js → loadHistory()
# Renders as a Polyline on the history map.
@admin_bp.route("/employee/<int:user_id>/locations/<date>", methods=["GET"])
@jwt_required()
def employee_locations(user_id, date):
    err = require_admin()
    if err:
        return err

    db   = get_db()
    rows = db.execute(
        "SELECT latitude, longitude, recorded_at FROM locations "
        "WHERE user_id = %s AND LEFT(recorded_at, 10) = %s ORDER BY recorded_at ASC",
        (user_id, date),
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


# ── GET /api/admin/employee/<id>/activities/<date> ────────────────────────────
# Returns activity-stop markers for a specific employee on a given date.
# Consumed by api.js → api.getEmployeeActivities() → AdminDashboardScreen.js → loadHistory()
# Rendered as red pin markers on the history map.
@admin_bp.route("/employee/<int:user_id>/activities/<date>", methods=["GET"])
@jwt_required()
def employee_activities(user_id, date):
    err = require_admin()
    if err:
        return err

    db   = get_db()
    rows = db.execute(
        "SELECT id, latitude, longitude, description, triggered_at FROM activity_logs "
        "WHERE user_id = %s AND LEFT(triggered_at, 10) = %s ORDER BY triggered_at ASC",
        (user_id, date),
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


# ── Helpers ───────────────────────────────────────────────────────────────────

def haversine_km(lat1, lon1, lat2, lon2):
    """Computes great-circle distance in km between two GPS points."""
    R    = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a    = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _parse_ts(ts_str):
    """Parses a timestamp string (ISO or space-separated) into a datetime; returns datetime.min on failure."""
    if not ts_str:
        return datetime.min
    s = str(ts_str)
    for fmt in ('%Y-%m-%dT%H:%M:%S.%f', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M:%S.%f'):
        try:
            return datetime.strptime(s[:len(fmt) + 2].strip('Z'), fmt)
        except Exception:
            pass
    return datetime.min


def _date_range(start_str, end_str):
    """Returns list of 'YYYY-MM-DD' strings from start to end inclusive."""
    start = datetime.strptime(start_str, '%Y-%m-%d').date()
    end   = datetime.strptime(end_str,   '%Y-%m-%d').date()
    days  = []
    cur   = start
    while cur <= end:
        days.append(cur.strftime('%Y-%m-%d'))
        cur += timedelta(days=1)
    return days


# ── GET /api/admin/employee/<id>/day-log/<date> ───────────────────────────────
# Returns login record, activity stops (with client_visit name if available), and GPS point count.
# Consumed by api.js → api.getEmployeeDayLog() → AdminDayLogScreen.js → loadDayData()
@admin_bp.route("/employee/<int:user_id>/day-log/<date>", methods=["GET"])
@jwt_required()
def employee_day_log(user_id, date):
    err = require_admin()
    if err:
        return err

    db = get_db()

    # First login record for user on given date
    login_row = db.execute(
        "SELECT id, login_time, logout_time, login_location_name, login_location_cat "
        "FROM login_logs WHERE user_id = %s AND login_time::DATE = %s::DATE "
        "ORDER BY login_time ASC LIMIT 1",
        (user_id, date),
    ).fetchone()

    # Activity stops sorted chronologically
    stop_rows = db.execute(
        "SELECT id, latitude, longitude, description, triggered_at, dwell_duration, status, response, responded_at "
        "FROM activity_logs WHERE user_id = %s AND LEFT(triggered_at, 10) = %s "
        "ORDER BY triggered_at ASC",
        (user_id, date),
    ).fetchall()

    # Client visits for the same day to enrich stops with named locations
    visit_rows = db.execute(
        "SELECT id, saved_location_name, saved_location_cat, arrived_at, dwell_duration "
        "FROM client_visits WHERE user_id = %s AND date = %s",
        (user_id, date),
    ).fetchall()

    # GPS point count for the day
    loc_count = db.execute(
        "SELECT COUNT(*) as cnt FROM locations WHERE user_id = %s AND LEFT(recorded_at, 10) = %s",
        (user_id, date),
    ).fetchone()

    db.close()

    # Match each stop to the nearest client visit within 30 minutes
    visits = [dict(v) for v in visit_rows]
    stops  = []
    for s in stop_rows:
        stop_dict = dict(s)
        stop_ts   = _parse_ts(stop_dict.get('triggered_at'))
        best      = None
        best_diff = timedelta(minutes=30)
        for v in visits:
            v_ts = _parse_ts(v.get('arrived_at'))
            if v_ts == datetime.min:
                continue
            diff = abs(stop_ts - v_ts)
            if diff < best_diff:
                best_diff = diff
                best      = v
        if best:
            stop_dict['location_name'] = best.get('saved_location_name')
            stop_dict['location_cat']  = best.get('saved_location_cat')
        else:
            stop_dict['location_name'] = None
            stop_dict['location_cat']  = None
        stops.append(stop_dict)

    return jsonify({
        'login':          dict(login_row) if login_row else None,
        'stops':          stops,
        'location_count': loc_count['cnt'] if loc_count else 0,
    })


# ── GET /api/admin/report?user_ids=1,2&start=YYYY-MM-DD&end=YYYY-MM-DD ───────
# Generates a multi-employee report for a date range.
# Consumed by api.js → api.generateReport() → AdminReportsScreen.js → handleGenerateReport()
@admin_bp.route("/report", methods=["GET"])
@jwt_required()
def admin_report():
    err = require_admin()
    if err:
        return err

    start_str = request.args.get('start')
    end_str   = request.args.get('end')
    user_ids_param = request.args.get('user_ids', '')

    if not start_str or not end_str:
        return jsonify(error="start and end query params required"), 400

    db = get_db()

    # Resolve target user IDs — default to all employees
    if user_ids_param:
        try:
            target_ids = [int(x) for x in user_ids_param.split(',') if x.strip()]
        except ValueError:
            return jsonify(error="user_ids must be comma-separated integers"), 400
    else:
        rows       = db.execute("SELECT id FROM users WHERE role = 'employee'").fetchall()
        target_ids = [r['id'] for r in rows]

    # Login deadline for on-time calculation
    deadline_row = db.execute(
        "SELECT value FROM company_settings WHERE key = 'login_deadline'"
    ).fetchone()
    login_deadline = deadline_row['value'] if deadline_row else '09:00'

    date_range = _date_range(start_str, end_str)

    employees_out = []
    for uid in target_ids:
        user_row = db.execute("SELECT id, name FROM users WHERE id = %s", (uid,)).fetchone()
        if not user_row:
            continue

        # Login days
        login_rows = db.execute(
            "SELECT login_time, login_location_name FROM login_logs "
            "WHERE user_id = %s AND login_time::DATE >= %s::DATE AND login_time::DATE <= %s::DATE "
            "ORDER BY login_time ASC",
            (uid, start_str, end_str),
        ).fetchall()

        login_by_date = {}
        for lr in login_rows:
            d = _parse_ts(lr['login_time'])
            if d == datetime.min:
                continue
            ds = d.strftime('%Y-%m-%d')
            if ds not in login_by_date:
                login_by_date[ds] = lr

        dl_h, dl_m = (int(x) for x in login_deadline.split(':'))
        deadline_mins = dl_h * 60 + dl_m

        login_days = []
        for ds in date_range:
            lr = login_by_date.get(ds)
            if lr:
                d   = _parse_ts(lr['login_time'])
                tot = d.hour * 60 + d.minute
                login_days.append({
                    'date':          ds,
                    'login_time':    str(lr['login_time']),
                    'on_time':       tot <= deadline_mins,
                    'location_name': lr['login_location_name'],
                })

        absent_dates = [ds for ds in date_range if ds not in login_by_date]

        # Activity stops
        stop_rows = db.execute(
            "SELECT id, triggered_at, dwell_duration, status, response, description "
            "FROM activity_logs WHERE user_id = %s "
            "AND LEFT(triggered_at, 10) >= %s AND LEFT(triggered_at, 10) <= %s "
            "ORDER BY triggered_at ASC",
            (uid, start_str, end_str),
        ).fetchall()
        stops = [dict(r) for r in stop_rows]

        # Client visits
        visit_rows = db.execute(
            "SELECT id, saved_location_name, saved_location_cat, arrived_at, dwell_duration, date "
            "FROM client_visits WHERE user_id = %s AND date >= %s AND date <= %s "
            "ORDER BY arrived_at ASC",
            (uid, start_str, end_str),
        ).fetchall()
        visits = [dict(r) for r in visit_rows]

        # Daily distances via haversine over ordered location points
        loc_rows = db.execute(
            "SELECT latitude, longitude, recorded_at FROM locations "
            "WHERE user_id = %s AND LEFT(recorded_at, 10) >= %s AND LEFT(recorded_at, 10) <= %s "
            "ORDER BY recorded_at ASC",
            (uid, start_str, end_str),
        ).fetchall()

        dist_by_date = {}
        for row in loc_rows:
            d  = _parse_ts(row['recorded_at'])
            ds = d.strftime('%Y-%m-%d')
            dist_by_date.setdefault(ds, []).append((row['latitude'], row['longitude']))

        daily_distances = []
        for ds in date_range:
            pts = dist_by_date.get(ds, [])
            km  = 0.0
            for i in range(1, len(pts)):
                km += haversine_km(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
            daily_distances.append({'date': ds, 'distance_km': round(km, 2)})

        # Synced dates from user_sync_log
        sync_rows = db.execute(
            "SELECT date FROM user_sync_log WHERE user_id = %s AND date >= %s AND date <= %s",
            (uid, start_str, end_str),
        ).fetchall()
        synced_dates   = [r['date'] for r in sync_rows]
        unsynced_dates = [ds for ds in date_range if ds not in synced_dates]

        employees_out.append({
            'id':               uid,
            'name':             user_row['name'],
            'login_days':       login_days,
            'absent_dates':     absent_dates,
            'stops':            stops,
            'visits':           visits,
            'daily_distances':  daily_distances,
            'synced_dates':     synced_dates,
            'unsynced_dates':   unsynced_dates,
        })

    db.close()

    return jsonify({
        'login_deadline': login_deadline,
        'start_date':     start_str,
        'end_date':       end_str,
        'generated_at':   datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ'),
        'employees':      employees_out,
    })
