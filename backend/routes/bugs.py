# routes/bugs.py — Bug report routes
# Employees submit bug reports; admins retrieve them.
# Frontend entry point: ReportBugScreen.js → api.reportBug() → POST /api/bugs/report
# Admin view: AdminBugReportsScreen.js → api.getBugReports() → GET /api/bugs

from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from database import get_db

bugs_bp = Blueprint("bugs", __name__)


# ── POST /api/bugs/report ─────────────────────────────────────────────────────
# Receives: { description } from api.js → api.reportBug()
# Returns:  { message, id } — confirmation with the new report ID
@bugs_bp.route("/report", methods=["POST"])
@jwt_required()
def report_bug():
    user_id = int(get_jwt_identity())
    data    = request.get_json()
    description = data.get("description", "").strip()

    if not description:
        return jsonify(error="Description is required"), 400

    db = get_db()
    cursor = db.execute(
        "INSERT INTO bug_reports (user_id, description) VALUES (?, ?)",
        (user_id, description),
    )
    db.commit()
    report_id = cursor.lastrowid
    db.close()

    return jsonify(message="Bug report submitted", id=report_id), 201


# ── GET /api/bugs ─────────────────────────────────────────────────────────────
# Admin only — returns all bug reports with submitter details
# Consumed by AdminBugReportsScreen.js → api.getBugReports()
@bugs_bp.route("/", methods=["GET"])
@jwt_required()
def get_bug_reports():
    claims = get_jwt()
    if claims.get("role") != "admin":
        return jsonify(error="Admin access required"), 403

    db = get_db()
    rows = db.execute("""
        SELECT b.id, b.description, b.status, b.created_at,
               u.name AS user_name, u.email AS user_email, u.id AS user_id
        FROM bug_reports b
        JOIN users u ON u.id = b.user_id
        ORDER BY b.created_at DESC
    """).fetchall()
    db.close()

    return jsonify(reports=[dict(r) for r in rows])


# ── PATCH /api/bugs/<id>/resolve ─────────────────────────────────────────────
# Admin only — marks a bug report as resolved
# Consumed by AdminBugReportsScreen.js → resolve action
@bugs_bp.route("/<int:report_id>/resolve", methods=["PATCH"])
@jwt_required()
def resolve_bug(report_id):
    claims = get_jwt()
    if claims.get("role") != "admin":
        return jsonify(error="Admin access required"), 403

    db = get_db()
    db.execute("UPDATE bug_reports SET status = 'resolved' WHERE id = ?", (report_id,))
    db.commit()
    db.close()

    return jsonify(message="Marked as resolved")
