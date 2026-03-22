# routes/profile.py — Per-user profile storage endpoints
# Frontend entry point: src/services/api.js → api.getProfile / api.upsertProfile / api.setGeoProfiles
#
# GET  /api/profile      → returns { personal_info, geo_profiles: { base[], home[] } } for the JWT user
# PUT  /api/profile      → receives { first_name, … } → upserts user_profiles row
# PUT  /api/profile/geo  → receives { base[], home[] } → wipes and replaces user_geo_profiles rows

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from database import get_db

profile_bp = Blueprint('profile', __name__)


# GET /api/profile
# Consumed by: AuthContext.js (login/loadUser) + ManageProfileScreen.js (on mount)
# Returns full personal info and geo profiles for the current user
@profile_bp.route('', methods=['GET'])
@jwt_required()
def get_profile():
    user_id = get_jwt_identity()
    db = get_db()
    try:
        row = db.execute(
            "SELECT first_name, last_name, phone, address, state, pincode, country "
            "FROM user_profiles WHERE user_id = %s",
            (user_id,)
        ).fetchone()

        geo_rows = db.execute(
            "SELECT profile_type, name, latitude, longitude, radius "
            "FROM user_geo_profiles WHERE user_id = %s ORDER BY profile_type, sort_order",
            (user_id,)
        ).fetchall()

        personal_info = dict(row) if row else {
            'first_name': None, 'last_name': None, 'phone': None,
            'address': None, 'state': None, 'pincode': None, 'country': None,
        }
        base = [{'name': r['name'], 'latitude': r['latitude'], 'longitude': r['longitude'], 'radius': r['radius']}
                for r in geo_rows if r['profile_type'] == 'base']
        home = [{'name': r['name'], 'latitude': r['latitude'], 'longitude': r['longitude'], 'radius': r['radius']}
                for r in geo_rows if r['profile_type'] == 'home']

        return jsonify({'personal_info': personal_info, 'geo_profiles': {'base': base, 'home': home}})
    finally:
        db.close()


# PUT /api/profile
# Receives: { first_name, last_name, phone, address, state, pincode, country }
# Consumed by: ManageProfileScreen.js → api.upsertProfile (debounced auto-save)
@profile_bp.route('', methods=['PUT'])
@jwt_required()
def upsert_profile():
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    db = get_db()
    try:
        db.execute("""
            INSERT INTO user_profiles (user_id, first_name, last_name, phone, address, state, pincode, country, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT (user_id) DO UPDATE SET
                first_name = EXCLUDED.first_name,
                last_name  = EXCLUDED.last_name,
                phone      = EXCLUDED.phone,
                address    = EXCLUDED.address,
                state      = EXCLUDED.state,
                pincode    = EXCLUDED.pincode,
                country    = EXCLUDED.country,
                updated_at = NOW()
        """, (
            user_id,
            data.get('first_name'), data.get('last_name'), data.get('phone'),
            data.get('address'), data.get('state'), data.get('pincode'),
            data.get('country', 'India'),
        ))
        db.commit()
        return jsonify({'ok': True})
    finally:
        db.close()


# PUT /api/profile/geo
# Receives: { base: [{name, latitude, longitude, radius}, …], home: […] }
# Wipe-and-replace: deletes all existing rows for the user then inserts the full new arrays.
# Consumed by: ManageProfileScreen.js → api.setGeoProfiles (immediate on any geo change)
@profile_bp.route('/geo', methods=['PUT'])
@jwt_required()
def set_geo_profiles():
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    base = data.get('base', [])
    home = data.get('home', [])
    db = get_db()
    try:
        db.execute("DELETE FROM user_geo_profiles WHERE user_id = %s", (user_id,))
        for i, pin in enumerate(base):
            db.execute(
                "INSERT INTO user_geo_profiles (user_id, profile_type, name, latitude, longitude, radius, sort_order) "
                "VALUES (%s, 'base', %s, %s, %s, %s, %s)",
                (user_id, pin.get('name', ''), pin['latitude'], pin['longitude'], pin.get('radius', 100), i)
            )
        for i, pin in enumerate(home):
            db.execute(
                "INSERT INTO user_geo_profiles (user_id, profile_type, name, latitude, longitude, radius, sort_order) "
                "VALUES (%s, 'home', %s, %s, %s, %s, %s)",
                (user_id, pin.get('name', ''), pin['latitude'], pin['longitude'], pin.get('radius', 100), i)
            )
        db.commit()
        return jsonify({'ok': True})
    finally:
        db.close()
