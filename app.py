from flask import Flask, render_template, request, session, redirect, url_for, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room
from pymongo import MongoClient
from datetime import datetime
import uuid
import hashlib
import os

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "videocall_secret_key_change_in_prod")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="gevent")

# MongoDB connection
MONGO_URI = os.environ.get("MONGO_URI", "mongodb+srv://shuvo1994:875965@cluster0.l71jpfi.mongodb.net/videocall_app")
client = MongoClient(MONGO_URI)
db = client["videocall_app"]
users_col = db["users"]
rooms_col = db["rooms"]
calls_col = db["call_history"]

# Track active users in rooms: room_id -> list of socket_ids
room_participants = {}

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

# ─── AUTH ROUTES ────────────────────────────────────────────────────────────

@app.route("/")
def index():
    if "user_id" in session:
        return redirect(url_for("dashboard"))
    return redirect(url_for("login"))

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        data = request.get_json()
        username = data.get("username", "").strip()
        password = data.get("password", "")
        user = users_col.find_one({"username": username, "password": hash_password(password)})
        if user:
            session["user_id"] = str(user["_id"])
            session["username"] = user["username"]
            return jsonify({"success": True})
        return jsonify({"success": False, "message": "Invalid credentials"})
    return render_template("login.html")

@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        data = request.get_json()
        username = data.get("username", "").strip()
        password = data.get("password", "")
        if not username or not password:
            return jsonify({"success": False, "message": "All fields required"})
        if users_col.find_one({"username": username}):
            return jsonify({"success": False, "message": "Username already taken"})
        users_col.insert_one({
            "username": username,
            "password": hash_password(password),
            "created_at": datetime.utcnow(),
            "avatar_color": "#" + format(hash(username) & 0xFFFFFF, '06x')
        })
        return jsonify({"success": True})
    return render_template("register.html")

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

@app.route("/dashboard")
def dashboard():
    if "user_id" not in session:
        return redirect(url_for("login"))
    history = list(calls_col.find(
        {"participants": session["username"]},
        {"_id": 0}
    ).sort("started_at", -1).limit(10))
    return render_template("dashboard.html", username=session["username"], history=history)

@app.route("/room/<room_id>")
def room(room_id):
    if "user_id" not in session:
        return redirect(url_for("login"))
    room_data = rooms_col.find_one({"room_id": room_id})
    if not room_data:
        rooms_col.insert_one({
            "room_id": room_id,
            "created_by": session["username"],
            "created_at": datetime.utcnow()
        })
    return render_template("room.html", room_id=room_id, username=session["username"])

@app.route("/create_room")
def create_room():
    if "user_id" not in session:
        return redirect(url_for("login"))
    room_id = str(uuid.uuid4())[:8].upper()
    return redirect(url_for("room", room_id=room_id))

@app.route("/api/room_info/<room_id>")
def room_info(room_id):
    participants = room_participants.get(room_id, [])
    return jsonify({"room_id": room_id, "participant_count": len(participants)})

# ─── WEBSOCKET SIGNALING ─────────────────────────────────────────────────────

@socketio.on("join")
def on_join(data):
    room_id = data["room_id"]
    username = data["username"]
    join_room(room_id)

    if room_id not in room_participants:
        room_participants[room_id] = []

    room_participants[room_id].append({
        "socket_id": request.sid,
        "username": username
    })

    # Tell existing users about new peer
    emit("user_joined", {
        "socket_id": request.sid,
        "username": username
    }, to=room_id, include_self=False)

    # Tell the new user about existing peers
    existing = [p for p in room_participants[room_id] if p["socket_id"] != request.sid]
    emit("existing_peers", {"peers": existing})

    # Log call start if first person
    if len(room_participants[room_id]) == 1:
        calls_col.insert_one({
            "room_id": room_id,
            "participants": [username],
            "started_at": datetime.utcnow(),
            "ended_at": None
        })
    else:
        calls_col.update_one(
            {"room_id": room_id, "ended_at": None},
            {"$addToSet": {"participants": username}}
        )

@socketio.on("offer")
def on_offer(data):
    emit("offer", {
        "offer": data["offer"],
        "from_socket": request.sid,
        "username": data.get("username")
    }, to=data["target_socket"])

@socketio.on("answer")
def on_answer(data):
    emit("answer", {
        "answer": data["answer"],
        "from_socket": request.sid
    }, to=data["target_socket"])

@socketio.on("ice_candidate")
def on_ice_candidate(data):
    emit("ice_candidate", {
        "candidate": data["candidate"],
        "from_socket": request.sid
    }, to=data["target_socket"])

@socketio.on("leave")
def on_leave(data):
    room_id = data["room_id"]
    username = data.get("username")
    leave_room(room_id)

    if room_id in room_participants:
        room_participants[room_id] = [
            p for p in room_participants[room_id] if p["socket_id"] != request.sid
        ]
        if not room_participants[room_id]:
            del room_participants[room_id]
            calls_col.update_one(
                {"room_id": room_id, "ended_at": None},
                {"$set": {"ended_at": datetime.utcnow()}}
            )

    emit("user_left", {"socket_id": request.sid, "username": username}, to=room_id)

@socketio.on("disconnect")
def on_disconnect():
    for room_id, participants in list(room_participants.items()):
        for p in participants:
            if p["socket_id"] == request.sid:
                room_participants[room_id] = [x for x in participants if x["socket_id"] != request.sid]
                emit("user_left", {"socket_id": request.sid, "username": p["username"]}, to=room_id)
                if not room_participants[room_id]:
                    del room_participants[room_id]
                    calls_col.update_one(
                        {"room_id": room_id, "ended_at": None},
                        {"$set": {"ended_at": datetime.utcnow()}}
                    )
                break

@socketio.on("chat_message")
def on_chat_message(data):
    emit("chat_message", {
        "username": data["username"],
        "message": data["message"],
        "timestamp": datetime.utcnow().strftime("%H:%M")
    }, to=data["room_id"])

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    socketio.run(app, host="0.0.0.0", port=port)
