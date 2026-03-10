# app.py — Flask application entry point
# Initialises the app, registers route blueprints, and sets up WebSocket events.
# Run via: python app.py  (starts on PORT env var, default 3000)

import os
from datetime import timedelta
from flask import Flask
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room
from flask_jwt_extended import JWTManager, decode_token
from dotenv import load_dotenv
from database import init_db          # creates tables on first run → database.py
from routes.auth import auth_bp
from routes.locations import locations_bp
from routes.activities import activities_bp
from routes.admin import admin_bp
from routes.saved_locations import saved_locations_bp
from routes.sync import sync_bp

load_dotenv()

app = Flask(__name__)
app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET", "change-me")
app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=24)

CORS(app)
jwt = JWTManager(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# ── Route blueprints ───────────────────────────────────────────────────────────
# Each blueprint maps to a file in routes/ and is prefixed under /api/
app.register_blueprint(auth_bp,            url_prefix="/api/auth")
app.register_blueprint(locations_bp,       url_prefix="/api/locations")
app.register_blueprint(activities_bp,      url_prefix="/api/activities")
app.register_blueprint(admin_bp,           url_prefix="/api/admin")
app.register_blueprint(saved_locations_bp, url_prefix="/api/saved-locations")
app.register_blueprint(sync_bp,            url_prefix="/api/sync")


# ── Health check ──────────────────────────────────────────────────────────────
# GET /api/health — used to verify the server is reachable
@app.route("/api/health")
def health():
    from datetime import datetime
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat() + "Z"}


# ── WebSocket: connection handshake ───────────────────────────────────────────
# Triggered when a client connects via socket.io (AdminDashboardScreen.js → connectSocket())
# Validates the JWT passed in the auth payload and places admins into "admin-room"
# so they receive employee-location broadcasts without exposing them to other clients.
@socketio.on("connect")
def handle_connect(auth=None):
    token = auth.get("token") if auth and isinstance(auth, dict) else None
    if not token:
        return False  # reject connection — no token provided

    try:
        decoded = decode_token(token)
        if decoded.get("role") == "admin":
            join_room("admin-room")
        print(f"Connected: {decoded.get('name')} ({decoded.get('role')})")
    except Exception:
        return False  # reject connection — invalid / expired token


# ── WebSocket: employee location update ───────────────────────────────────────
# Triggered by the employee client emitting "location-update".
# Rebroadcasts the position to all admins in "admin-room".
# Consumed by: AdminDashboardScreen.js → socket.on("employee-location")
# NOTE (offline-first): the employee client no longer emits "location-update" in real-time.
# Admin sees the last position from GET /api/admin/live (locations table), which is only
# as fresh as the employee's last manual sync via SyncScreen → POST /api/sync/locations.
# Re-enable live emit here if real-time tracking is reinstated.
@socketio.on("location-update")
def handle_location_update(data):
    emit(
        "employee-location",
        {
            "userId":    data.get("userId"),
            "name":      data.get("name", "Unknown"),
            "latitude":  data.get("latitude"),
            "longitude": data.get("longitude"),
            "timestamp": data.get("timestamp"),
        },
        room="admin-room",
    )


if __name__ == "__main__":
    init_db()   # ensure all tables exist before accepting requests
    port = int(os.getenv("PORT", 3000))
    print(f"Server running on port {port}")
    socketio.run(app, host="0.0.0.0", port=port, debug=True)
