# routes/saved_locations.py — Named location pin management
# Employees mark notable spots (client sites, offices, etc.) from MapScreen.js.
# These pins are loaded on map startup and suppress idle notifications when nearby.
# Frontend entry point: src/services/api.js → api.saveLocation / api.getSavedLocations / api.deleteSavedLocation

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from database import get_db   # → database.py

saved_locations_bp = Blueprint("saved_locations", __name__)


# ── POST /api/saved-locations ─────────────────────────────────────────────────
# Receives: { name, category, latitude, longitude }
#   from api.js → api.saveLocation(), called in MapScreen.js → submitMarkLocation()
# Saves the employee's current GPS position with a label and category icon.
@saved_locations_bp.route("/", methods=["POST"])
@jwt_required()
def create():
    user_id   = int(get_jwt_identity())
    data      = request.get_json()
    name      = data.get("name")
    category  = data.get("category", "other")
    latitude  = data.get("latitude")
    longitude = data.get("longitude")

    if not name or latitude is None or longitude is None:
        return jsonify(error="name, latitude, and longitude are required"), 400

    db     = get_db()
    cursor = db.execute(
        "INSERT INTO saved_locations (user_id, name, category, latitude, longitude) "
        "VALUES (?, ?, ?, ?, ?)",
        (user_id, name, category, latitude, longitude),
    )
    db.commit()
    loc_id = cursor.lastrowid
    db.close()

    return jsonify(id=loc_id, message="Location saved"), 201


# ── GET /api/saved-locations ──────────────────────────────────────────────────
# Returns all saved pins for the current user, newest first.
# Consumed by api.js → api.getSavedLocations() → MapScreen.js → loadSavedLocations()
# Pins are rendered as emoji markers on the map and used in idle-suppression logic.
@saved_locations_bp.route("/", methods=["GET"])
@jwt_required()
def get_all():
    user_id = int(get_jwt_identity())
    db      = get_db()
    rows    = db.execute(
        "SELECT id, name, category, latitude, longitude, created_at "
        "FROM saved_locations WHERE user_id = ? ORDER BY created_at DESC",
        (user_id,),
    ).fetchall()
    db.close()
    return jsonify([dict(r) for r in rows])


# ── DELETE /api/saved-locations/<id> ─────────────────────────────────────────
# Removes a saved pin for the current user.
# Consumed by api.js → api.deleteSavedLocation() (available for future use in the UI)
@saved_locations_bp.route("/<int:loc_id>", methods=["DELETE"])
@jwt_required()
def delete(loc_id):
    user_id = int(get_jwt_identity())
    db      = get_db()
    db.execute(
        "DELETE FROM saved_locations WHERE id = ? AND user_id = ?",
        (loc_id, user_id),
    )
    db.commit()
    db.close()
    return jsonify(message="Location deleted")
