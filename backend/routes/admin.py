# routes/admin.py — Admin-only fleet management routes
# All routes validate the admin role via require_admin() before proceeding.
# Frontend entry point: src/services/api.js → api.getEmployees / api.getLiveEmployees / etc.
# Consumed by: AdminDashboardScreen.js

from flask import Blueprint, jsonify
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
            WHERE recorded_at::DATE = CURRENT_DATE
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
        "WHERE user_id = %s AND recorded_at::DATE = %s::DATE ORDER BY recorded_at ASC",
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
        "WHERE user_id = %s AND triggered_at::DATE = %s::DATE ORDER BY triggered_at ASC",
        (user_id, date),
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])
