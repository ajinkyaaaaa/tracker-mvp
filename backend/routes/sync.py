# routes/sync.py — Bulk sync endpoints for offline-first employee data
# All endpoints are idempotent; re-syncing the same date inserts 0 duplicate rows.
# Each POST stamps user_sync_log so CalendarScreen can show which days are synced.
#
# POST /api/sync/locations — {date, locations:[{latitude,longitude,recorded_at}]}
#   → bulk INSERT OR IGNORE into locations; stamp user_sync_log
# POST /api/sync/stops     — {date, stops:[{arrived_at,triggered_at,...}]}
#   → bulk INSERT OR IGNORE into activity_logs; stamp user_sync_log
# POST /api/sync/visits    — {date, visits:[{saved_location_name,...}]}
#   → bulk INSERT OR IGNORE into client_visits; stamp user_sync_log
# GET  /api/sync/status    — returns [{date, synced_at}] for last 90 days
#   → consumed by CalendarScreen.js on mount

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from database import get_db
from datetime import datetime, timedelta

sync_bp = Blueprint('sync', __name__)


def _stamp_sync_log(conn, user_id, date):
    """Upsert a sync log row for this user+date — called by every POST endpoint."""
    conn.execute(
        "INSERT OR REPLACE INTO user_sync_log (user_id, date, synced_at) VALUES (?, ?, ?)",
        (user_id, date, datetime.utcnow().isoformat())
    )


# POST /api/sync/locations
# Receives: {date, locations:[{latitude,longitude,recorded_at}]} from SyncScreen → api.syncBulkLocations()
# Returns:  {inserted: N} → SyncScreen progress bar
@sync_bp.route('/locations', methods=['POST'])
@jwt_required()
def sync_locations():
    user_id   = get_jwt_identity()
    data      = request.get_json()
    date      = data.get('date')
    locations = data.get('locations', [])
    conn = get_db()
    try:
        rows = [
            (user_id, loc['latitude'], loc['longitude'], loc['recorded_at'])
            for loc in locations
        ]
        conn.executemany(
            "INSERT OR IGNORE INTO locations (user_id, latitude, longitude, recorded_at) VALUES (?, ?, ?, ?)",
            rows
        )
        _stamp_sync_log(conn, user_id, date)
        conn.commit()
        return jsonify({'inserted': len(rows)})
    finally:
        conn.close()


# POST /api/sync/stops
# Receives: {date, stops:[{arrived_at,triggered_at,latitude,longitude,dwell_duration,status,response,responded_at}]}
# Returns:  {inserted: N} → SyncScreen progress bar
@sync_bp.route('/stops', methods=['POST'])
@jwt_required()
def sync_stops():
    user_id = get_jwt_identity()
    data    = request.get_json()
    date    = data.get('date')
    stops   = data.get('stops', [])
    conn = get_db()
    try:
        rows = [
            (
                user_id,
                s['latitude'], s['longitude'],
                s.get('triggered_at'),
                s.get('dwell_duration', 0),
                s.get('status', 'pending'),
                s.get('response'),
                s.get('responded_at'),
            )
            for s in stops
        ]
        conn.executemany(
            """INSERT OR IGNORE INTO activity_logs
               (user_id, latitude, longitude, triggered_at, dwell_duration, status, response, responded_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            rows
        )
        _stamp_sync_log(conn, user_id, date)
        conn.commit()
        return jsonify({'inserted': len(rows)})
    finally:
        conn.close()


# POST /api/sync/visits
# Receives: {date, visits:[{saved_location_name,saved_location_cat,latitude,longitude,arrived_at,dwell_duration}]}
# Returns:  {inserted: N} → SyncScreen progress bar
@sync_bp.route('/visits', methods=['POST'])
@jwt_required()
def sync_visits():
    user_id = get_jwt_identity()
    data    = request.get_json()
    date    = data.get('date')
    visits  = data.get('visits', [])
    conn = get_db()
    try:
        rows = [
            (
                user_id,
                v['saved_location_name'], v.get('saved_location_cat'),
                v['latitude'], v['longitude'],
                v['arrived_at'], v.get('dwell_duration', 0),
                date,
            )
            for v in visits
        ]
        conn.executemany(
            """INSERT OR IGNORE INTO client_visits
               (user_id, saved_location_name, saved_location_cat, latitude, longitude,
                arrived_at, dwell_duration, date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            rows
        )
        _stamp_sync_log(conn, user_id, date)
        conn.commit()
        return jsonify({'inserted': len(rows)})
    finally:
        conn.close()


# POST /api/sync/login-sessions
# Receives: {sessions:[{login_time}]} from SyncScreen → api.syncBulkLoginSessions()
# INSERT OR IGNORE into login_logs — safe to re-sync; server record already exists from actual login
# Returns: {inserted: N}
@sync_bp.route('/login-sessions', methods=['POST'])
@jwt_required()
def sync_login_sessions():
    user_id  = get_jwt_identity()
    data     = request.get_json()
    sessions = data.get('sessions', [])
    conn = get_db()
    try:
        rows = [(user_id, s['login_time']) for s in sessions]
        conn.executemany(
            "INSERT OR IGNORE INTO login_logs (user_id, login_time) VALUES (?, ?)",
            rows
        )
        conn.commit()
        return jsonify({'inserted': len(rows)})
    finally:
        conn.close()


# GET /api/sync/login-history
# Returns [{login_time, logout_time}] for last 90 days → SyncScreen login calendar modal
@sync_bp.route('/login-history', methods=['GET'])
@jwt_required()
def login_history():
    user_id = get_jwt_identity()
    cutoff  = (datetime.utcnow() - timedelta(days=90)).date().isoformat()
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT login_time, logout_time FROM login_logs WHERE user_id = ? AND login_time >= ? ORDER BY login_time DESC",
            (user_id, cutoff)
        ).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()


# GET /api/sync/status
# Returns [{date, synced_at}] for last 90 days → CalendarScreen.js dot rendering
@sync_bp.route('/status', methods=['GET'])
@jwt_required()
def sync_status():
    user_id = get_jwt_identity()
    cutoff  = (datetime.utcnow() - timedelta(days=90)).date().isoformat()
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT date, synced_at FROM user_sync_log WHERE user_id = ? AND date >= ? ORDER BY date DESC",
            (user_id, cutoff)
        ).fetchall()
        return jsonify([dict(r) for r in rows])
    finally:
        conn.close()
