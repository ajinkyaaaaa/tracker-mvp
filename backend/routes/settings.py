# routes/settings.py — Company-wide configuration endpoints
# login_deadline is read by employees (MapScreen week boxes) and written by admins.
#
# GET  /api/settings/login-deadline → any authenticated user → { login_deadline: "HH:MM" }
# PUT  /api/admin/settings/login-deadline → admin only → { login_deadline: "HH:MM" }
#   Consumed by: MapScreen.js → api.getLoginDeadline()
#            and AdminDashboardScreen.js → api.updateLoginDeadline()

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
