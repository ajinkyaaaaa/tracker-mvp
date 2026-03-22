# routes/locations.py — GPS location storage and retrieval
# Locations are batched on-device by locationService.js and synced every 60 s.
# Frontend entry point: src/services/api.js → api.syncLocations / api.getTodayPath

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from database import get_db   # → database.py

locations_bp = Blueprint("locations", __name__)


# ── POST /api/locations/sync ──────────────────────────────────────────────────
# Receives: { locations: [{latitude, longitude, recorded_at}] }
#   from api.js → api.syncLocations(), called in MapScreen.js → syncLocations()
# Bulk-inserts the cached GPS points then clears the local cache (clearCachedLocations)
@locations_bp.route("/sync", methods=["POST"])
@jwt_required()
def sync():
    user_id   = int(get_jwt_identity())
    data      = request.get_json()
    locations = data.get("locations", [])

    if not isinstance(locations, list) or len(locations) == 0:
        return jsonify(error="Locations array is required"), 400

    db = get_db()
    try:
        for loc in locations:
            db.execute(
                "INSERT INTO locations (user_id, latitude, longitude, recorded_at) "
                "VALUES (%s, %s, %s, %s) ON CONFLICT DO NOTHING",
                (user_id, loc["latitude"], loc["longitude"], loc["recorded_at"]),
            )
        db.commit()
    except Exception:
        db.close()
        return jsonify(error="Failed to sync locations"), 500

    db.close()
    return jsonify(message=f"{len(locations)} locations synced")


# ── GET /api/locations/today ──────────────────────────────────────────────────
# Returns today's ordered GPS points for the current user.
# Consumed by api.js → api.getTodayPath() → MapScreen.js → loadTodayPathOnly()
# Used to render the Polyline trail on the map.
@locations_bp.route("/today", methods=["GET"])
@jwt_required()
def today():
    user_id = int(get_jwt_identity())
    db      = get_db()
    rows    = db.execute(
        "SELECT latitude, longitude, recorded_at FROM locations "
        "WHERE user_id = %s AND LEFT(recorded_at, 10) = TO_CHAR(CURRENT_DATE, 'YYYY-MM-DD') ORDER BY recorded_at ASC",
        (user_id,),
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


# ── GET /api/locations/history/<date> ────────────────────────────────────────
# Returns ordered GPS points for a given date (YYYY-MM-DD).
# Consumed by api.js → api.getPathByDate() → AdminDashboardScreen.js → loadHistory()
@locations_bp.route("/history/<date>", methods=["GET"])
@jwt_required()
def history(date):
    user_id = int(get_jwt_identity())
    db      = get_db()
    rows    = db.execute(
        "SELECT latitude, longitude, recorded_at FROM locations "
        "WHERE user_id = %s AND LEFT(recorded_at, 10) = %s ORDER BY recorded_at ASC",
        (user_id, date),
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])
