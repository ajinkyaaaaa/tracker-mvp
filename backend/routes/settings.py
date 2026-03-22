# routes/settings.py — Company-wide configuration endpoints
# login_deadline:    read by employees (MapScreen week boxes), written by admins.
# logout_time:       read by AuthContext.js (auto-logout polling), written by admins.
# interval_active:   seconds between GPS saves when outside all geofences (default 3).
# interval_idle:     seconds between GPS saves when inside a saved-location geofence (default 30).
#
# GET  /api/settings/login-deadline        → any authenticated user → { login_deadline: "HH:MM" }
# PUT  /api/admin/settings/login-deadline  → admin only
# GET  /api/settings/logout-time           → any authenticated user → { logout_time: "HH:MM" }
# PUT  /api/admin/settings/logout-time     → admin only
# GET  /api/settings/tracking-intervals    → any authenticated user → { interval_active, interval_idle }
# PUT  /api/admin/settings/tracking-intervals → admin only
#   Consumed by: MapScreen.js → api.getLoginDeadline() / api.getTrackingIntervals()
#            and AdminDashboardScreen.js → api.updateLoginDeadline() / api.updateLogoutTime()
#                                          / api.updateTrackingIntervals()
#            and AuthContext.js → api.getLogoutTime() (60-second polling loop)

import os
import re
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt
from database import get_db

settings_bp = Blueprint('settings', __name__)


def _require_admin():
    """Returns a 403 response if the JWT role is not 'admin'."""
    if get_jwt().get('role') != 'admin':
        return jsonify(error='Admin access required'), 403
    return None


# GET /api/settings/login-deadline
# Returns the current login deadline — consumed by MapScreen.js on mount
@settings_bp.route('/login-deadline', methods=['GET'])
@jwt_required()
def get_login_deadline():
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT value FROM company_settings WHERE key = 'login_deadline'"
        ).fetchone()
        return jsonify({'login_deadline': row['value'] if row else '09:00'})
    finally:
        conn.close()


# PUT /api/admin/settings/login-deadline
# Receives: { login_deadline: "HH:MM" } from AdminDashboardScreen → api.updateLoginDeadline()
# Validates HH:MM format; returns { login_deadline: "HH:MM" } on success
@settings_bp.route('/admin/login-deadline', methods=['PUT'])
@jwt_required()
def update_login_deadline():
    err = _require_admin()
    if err:
        return err
    data     = request.get_json()
    deadline = data.get('login_deadline', '').strip()
    if not re.match(r'^([01]\d|2[0-3]):[0-5]\d$', deadline):
        return jsonify(error='Invalid format. Use HH:MM (e.g. 09:00)'), 400
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO company_settings (key, value) VALUES ('login_deadline', %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (deadline,)
        )
        conn.commit()
        return jsonify({'login_deadline': deadline})
    finally:
        conn.close()


# GET /api/settings/logout-time
# Returns the configured auto-logout time — polled every 60 s by AuthContext.js
@settings_bp.route('/logout-time', methods=['GET'])
@jwt_required()
def get_logout_time():
    conn = get_db()
    try:
        row = conn.execute(
            "SELECT value FROM company_settings WHERE key = 'logout_time'"
        ).fetchone()
        return jsonify({'logout_time': row['value'] if row else '18:00'})
    finally:
        conn.close()


# PUT /api/admin/settings/logout-time
# Receives: { logout_time: "HH:MM" } from AdminDashboardScreen → api.updateLogoutTime()
# Validates HH:MM format; returns { logout_time: "HH:MM" } on success
@settings_bp.route('/admin/logout-time', methods=['PUT'])
@jwt_required()
def update_logout_time():
    err = _require_admin()
    if err:
        return err
    data        = request.get_json()
    logout_time = data.get('logout_time', '').strip()
    if not re.match(r'^([01]\d|2[0-3]):[0-5]\d$', logout_time):
        return jsonify(error='Invalid format. Use HH:MM (e.g. 18:00)'), 400
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO company_settings (key, value) VALUES ('logout_time', %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (logout_time,)
        )
        conn.commit()
        return jsonify({'logout_time': logout_time})
    finally:
        conn.close()


# GET /api/settings/tracking-intervals
# Returns { interval_active, interval_idle } (seconds) — consumed by MapScreen.js → loadTrackingIntervals()
# Background task uses these values: active = outside geofence, idle = inside geofence
@settings_bp.route('/tracking-intervals', methods=['GET'])
@jwt_required()
def get_tracking_intervals():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT key, value FROM company_settings WHERE key IN ('interval_active', 'interval_idle')"
        ).fetchall()
        vals = {r['key']: int(r['value']) for r in rows}
        return jsonify({
            'interval_active': vals.get('interval_active', 3),
            'interval_idle':   vals.get('interval_idle',   30),
        })
    finally:
        conn.close()


# PUT /api/admin/settings/tracking-intervals
# Receives: { interval_active: int, interval_idle: int } (seconds, both ≥ 1)
# from AdminDashboardScreen.js → api.updateTrackingIntervals()
@settings_bp.route('/admin/tracking-intervals', methods=['PUT'])
@jwt_required()
def update_tracking_intervals():
    err = _require_admin()
    if err:
        return err
    data   = request.get_json()
    active = data.get('interval_active')
    idle   = data.get('interval_idle')
    if not isinstance(active, int) or not isinstance(idle, int) or active < 1 or idle < 1:
        return jsonify(error='interval_active and interval_idle must be positive integers (seconds)'), 400
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO company_settings (key, value) VALUES ('interval_active', %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (str(active),)
        )
        conn.execute(
            "INSERT INTO company_settings (key, value) VALUES ('interval_idle', %s) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
            (str(idle),)
        )
        conn.commit()
        return jsonify({'interval_active': active, 'interval_idle': idle})
    finally:
        conn.close()


# POST /api/settings/verify-storage-clear-code
# Receives: { code } from SettingsScreen → "Clear Local Storage" flow
# Compares against ADMIN_STORAGE_CLEAR_CODE env var; returns 200 on match, 403 on mismatch
@settings_bp.route('/verify-storage-clear-code', methods=['POST'])
@jwt_required()
def verify_storage_clear_code():
    expected = os.environ.get('ADMIN_STORAGE_CLEAR_CODE', '')
    if not expected:
        return jsonify(error='Storage clear code not configured on server'), 500
    code = (request.get_json() or {}).get('code', '')
    if code != expected:
        return jsonify(error='Incorrect code'), 403
    return jsonify({'ok': True})
