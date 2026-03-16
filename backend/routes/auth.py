# routes/auth.py — Authentication routes
# Handles user registration, login, logout, and token validation.
# All tokens are JWTs signed by JWT_SECRET_KEY (app.py).
# Token expiry: before 18:00 local time → expires at 18:00; at/after 18:00 → expires in 5 hours.
# Frontend entry point: src/services/api.js → api.login / api.register / api.logout / api.getMe

from datetime import datetime, timedelta
from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity, get_jwt
import bcrypt
from database import get_db   # → database.py

auth_bp = Blueprint("auth", __name__)


# Returns (expires_delta, expires_at_iso) based on current local time.
# Before 18:00 → token lives until 18:00 today; at/after 18:00 → 5-hour session.
def _token_expiry():
    now    = datetime.utcnow()
    cutoff = now.replace(hour=18, minute=0, second=0, microsecond=0)
    delta  = (cutoff - now) if now < cutoff else timedelta(hours=5)
    return delta, (now + delta).isoformat() + "Z"  # Z suffix → frontend parses as UTC


# ── POST /api/auth/register ───────────────────────────────────────────────────
# Receives: { name, email, password, role } from api.js → api.register()
# Returns:  { token, user } → consumed by AuthContext.register()
@auth_bp.route("/register", methods=["POST"])
def register():
    data     = request.get_json()
    name     = data.get("name")
    email    = data.get("email")
    password = data.get("password")
    role     = data.get("role", "employee")

    if not name or not email or not password:
        return jsonify(error="Name, email, and password are required"), 400

    db = get_db()
    if db.execute("SELECT id FROM users WHERE email = ?", (email,)).fetchone():
        db.close()
        return jsonify(error="Email already registered"), 409

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    cursor = db.execute(
        "INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)",
        (name, email, hashed, role),
    )
    db.commit()
    user_id = cursor.lastrowid
    db.close()

    # Embed role + name in JWT; expiry follows office-hours rules (_token_expiry)
    expires_delta, expires_at = _token_expiry()
    token = create_access_token(
        identity=str(user_id),
        additional_claims={"email": email, "role": role, "name": name},
        expires_delta=expires_delta,
    )
    return jsonify(
        token=token,
        tokenExpiresAt=expires_at,
        user={"id": user_id, "name": name, "email": email, "role": role},
    ), 201


# ── POST /api/auth/login ──────────────────────────────────────────────────────
# Receives: { email, password } from api.js → api.login()
# Returns:  { token, user, loginTime } → consumed by AuthContext.login()
# loginTime is the first login_logs entry for today, displayed in MapScreen.js
@auth_bp.route("/login", methods=["POST"])
def login():
    data     = request.get_json()
    email    = data.get("email")
    password = data.get("password")

    if not email or not password:
        return jsonify(error="Email and password are required"), 400

    db   = get_db()
    user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()

    if not user or not bcrypt.checkpw(password.encode(), user["password"].encode()):
        db.close()
        return jsonify(error="Invalid credentials"), 401

    # Mark user online and record the login session
    db.execute("UPDATE users SET is_online = 1 WHERE id = ?", (user["id"],))
    db.execute("INSERT INTO login_logs (user_id) VALUES (?)", (user["id"],))
    db.commit()

    # Fetch the first login of the day to show a consistent "logged in since" time
    login_log = db.execute(
        "SELECT login_time FROM login_logs "
        "WHERE user_id = ? AND date(login_time) = date('now') ORDER BY id ASC LIMIT 1",
        (user["id"],),
    ).fetchone()
    db.close()

    # Expiry follows office-hours rules: before 18:00 → expires at 18:00, else → 5 h session
    expires_delta, expires_at = _token_expiry()
    token = create_access_token(
        identity=str(user["id"]),
        additional_claims={"email": user["email"], "role": user["role"], "name": user["name"]},
        expires_delta=expires_delta,
    )

    # SQLite stores datetime without timezone; append Z so the frontend parses it as UTC
    raw_time = login_log["login_time"] if login_log else None
    iso_time = (raw_time.replace(" ", "T") + "Z") if raw_time else None

    return jsonify(
        token=token,
        tokenExpiresAt=expires_at,
        user={"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]},
        loginTime=iso_time,
    )


# ── POST /api/auth/logout ─────────────────────────────────────────────────────
# Receives: JWT in Authorization header; called by api.js → api.logout()
# Marks user offline and closes the open login_logs session
@auth_bp.route("/logout", methods=["POST"])
@jwt_required()
def logout():
    user_id = int(get_jwt_identity())
    db = get_db()
    db.execute("UPDATE users SET is_online = 0 WHERE id = ?", (user_id,))
    db.execute(
        "UPDATE login_logs SET logout_time = datetime('now') "
        "WHERE user_id = ? AND logout_time IS NULL",
        (user_id,),
    )
    db.commit()
    db.close()
    return jsonify(message="Logged out successfully")


# ── GET /api/auth/me ──────────────────────────────────────────────────────────
# Called by api.js → api.getMe() on app load (AuthContext.loadUser())
# Returns the current user profile + today's login time to restore session state
@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    user_id = int(get_jwt_identity())
    db      = get_db()
    user    = db.execute(
        "SELECT id, name, email, role, is_online FROM users WHERE id = ?", (user_id,)
    ).fetchone()

    if not user:
        db.close()
        return jsonify(error="User not found"), 404

    login_log = db.execute(
        "SELECT login_time FROM login_logs "
        "WHERE user_id = ? AND date(login_time) = date('now') ORDER BY id ASC LIMIT 1",
        (user_id,),
    ).fetchone()
    db.close()

    raw_time = login_log["login_time"] if login_log else None
    iso_time = (raw_time.replace(" ", "T") + "Z") if raw_time else None

    # Read expiry from the live JWT so the frontend can reschedule its auto-logout timer
    exp_ts     = get_jwt().get("exp")
    expires_at = datetime.utcfromtimestamp(exp_ts).isoformat() + "Z" if exp_ts else None

    return jsonify(
        id=user["id"],
        name=user["name"],
        email=user["email"],
        role=user["role"],
        is_online=user["is_online"],
        loginTime=iso_time,
        tokenExpiresAt=expires_at,
    )


# ── POST /api/auth/change-password ────────────────────────────────────────────
# Receives: { currentPassword, newPassword } from api.js → api.changePassword()
# Validates the current password, then stores a new bcrypt hash
@auth_bp.route("/change-password", methods=["POST"])
@jwt_required()
def change_password():
    user_id = int(get_jwt_identity())
    data    = request.get_json()
    current = data.get("currentPassword", "")
    new_pw  = data.get("newPassword", "")

    if not current or not new_pw:
        return jsonify(error="Both passwords are required"), 400
    if len(new_pw) < 6:
        return jsonify(error="New password must be at least 6 characters"), 400

    db   = get_db()
    user = db.execute("SELECT password FROM users WHERE id = ?", (user_id,)).fetchone()

    if not bcrypt.checkpw(current.encode(), user["password"].encode()):
        db.close()
        return jsonify(error="Current password is incorrect"), 401

    hashed = bcrypt.hashpw(new_pw.encode(), bcrypt.gensalt()).decode()
    db.execute("UPDATE users SET password = ? WHERE id = ?", (hashed, user_id))
    db.commit()
    db.close()

    return jsonify(message="Password updated successfully")
