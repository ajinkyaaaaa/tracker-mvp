# routes/activities.py — Idle-stop activity log routes
# An activity is created automatically when the employee stays in one place for
# 15+ minutes (MapScreen.js idle detection → autoArchiveIdleEvent).
# The employee then responds via ArchiveScreen.js.
# Frontend entry point: src/services/api.js → api.logActivity / api.respondToActivity / etc.

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from database import get_db   # → database.py

activities_bp = Blueprint("activities", __name__)


# ── POST /api/activities ──────────────────────────────────────────────────────
# Receives: { latitude, longitude, triggered_at, dwell_duration, status }
#   from api.js → api.logActivity(), called in MapScreen.js → autoArchiveIdleEvent()
# Creates a 'pending' activity that the employee must respond to in ArchiveScreen.
@activities_bp.route("/", methods=["POST"])
@jwt_required()
def create():
    user_id        = int(get_jwt_identity())
    data           = request.get_json()
    latitude       = data.get("latitude")
    longitude      = data.get("longitude")
    triggered_at   = data.get("triggered_at")
    dwell_duration = data.get("dwell_duration", 0)
    status         = data.get("status", "pending")
    description    = data.get("description")
    response       = data.get("response")

    if latitude is None or longitude is None or not triggered_at:
        return jsonify(error="latitude, longitude, and triggered_at are required"), 400

    db = get_db()
    cursor = db.execute(
        "INSERT INTO activity_logs "
        "(user_id, latitude, longitude, description, triggered_at, dwell_duration, status, response) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (user_id, latitude, longitude, description, triggered_at, dwell_duration, status, response),
    )
    db.commit()
    activity_id = cursor.lastrowid
    db.close()

    return jsonify(id=activity_id, message="Activity logged"), 201


# ── PUT /api/activities/<id>/respond ─────────────────────────────────────────
# Receives: { response: string }
#   from api.js → api.respondToActivity(), called in ArchiveScreen.js → submitResponse()
# Marks the activity as 'completed' and stores the employee's typed or chip response.
@activities_bp.route("/<int:activity_id>/respond", methods=["PUT"])
@jwt_required()
def respond(activity_id):
    user_id       = int(get_jwt_identity())
    data          = request.get_json()
    response_text = data.get("response")

    if not response_text:
        return jsonify(error="response is required"), 400

    db = get_db()
    db.execute(
        "UPDATE activity_logs "
        "SET response = ?, status = 'completed', responded_at = datetime('now') "
        "WHERE id = ? AND user_id = ?",
        (response_text, activity_id, user_id),
    )
    db.commit()
    db.close()
    return jsonify(message="Response recorded")


# ── GET /api/activities/pending/count ────────────────────────────────────────
# Returns the count of today's unresponded activities for the current user.
# Consumed by api.js → api.getPendingCount() → MapScreen.js (badge on Archive tab)
@activities_bp.route("/pending/count", methods=["GET"])
@jwt_required()
def pending_count():
    user_id = int(get_jwt_identity())
    db      = get_db()
    row     = db.execute(
        "SELECT COUNT(*) as count FROM activity_logs "
        "WHERE user_id = ? AND status = 'pending' AND date(triggered_at) = date('now')",
        (user_id,),
    ).fetchone()
    db.close()
    return jsonify(count=row["count"])


# ── GET /api/activities/today ─────────────────────────────────────────────────
# Returns all activity stops for today, newest first.
# Consumed by api.js → api.getTodayActivities() → ArchiveScreen.js → loadActivities()
@activities_bp.route("/today", methods=["GET"])
@jwt_required()
def today():
    user_id = int(get_jwt_identity())
    db      = get_db()
    rows    = db.execute(
        "SELECT id, latitude, longitude, description, triggered_at, "
        "dwell_duration, status, response, responded_at "
        "FROM activity_logs "
        "WHERE user_id = ? AND date(triggered_at) = date('now') ORDER BY triggered_at DESC",
        (user_id,),
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


# ── GET /api/activities/history/<date> ───────────────────────────────────────
# Returns activity stops for a specific date (YYYY-MM-DD).
# Consumed by api.js → api.getActivitiesByDate() → AdminDashboardScreen.js → loadHistory()
@activities_bp.route("/history/<date>", methods=["GET"])
@jwt_required()
def history(date):
    user_id = int(get_jwt_identity())
    db      = get_db()
    rows    = db.execute(
        "SELECT id, latitude, longitude, description, triggered_at, "
        "dwell_duration, status, response, responded_at "
        "FROM activity_logs "
        "WHERE user_id = ? AND date(triggered_at) = date(?) ORDER BY triggered_at DESC",
        (user_id, date),
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])
