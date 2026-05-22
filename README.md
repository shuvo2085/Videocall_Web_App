# NexCall — Video Calling Web App

A real-time video calling application built with:
- **Python** (Flask + Flask-SocketIO) — backend & WebSocket signaling
- **HTML/CSS/JS** — frontend with WebRTC peer-to-peer video
- **MongoDB** — user accounts & call history

---

## Features

- 🔐 User registration & login
- 📹 Multi-party video calls (WebRTC)
- 🎙 Mute/unmute audio
- 📷 Toggle camera on/off
- 🖥 Screen sharing
- 💬 In-room text chat
- 📋 Room codes (shareable)
- 📝 Call history stored in MongoDB

---

## Requirements

- Python 3.9+
- MongoDB running locally (or MongoDB Atlas URI)
- Modern browser (Chrome/Firefox/Edge recommended)

---

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

### 2. Start MongoDB

Make sure MongoDB is running locally:
```bash
# macOS (Homebrew)
brew services start mongodb-community

# Linux
sudo systemctl start mongod

# Or use Docker
docker run -d -p 27017:27017 mongo
```

### 3. Configure (optional)

Set environment variables:
```bash
export MONGO_URI="mongodb://localhost:27017/"   # or Atlas URI
export SECRET_KEY="your_secret_key_here"
```

### 4. Run the app

```bash
python app.py
```

Open **http://localhost:5000** in your browser.

---

## Usage

1. **Register** a new account at `/register`
2. **Login** at `/login`
3. **Create a room** — click "Start Now" on the dashboard
4. **Share the room code** with others to invite them
5. **Join a room** — enter the room code on the dashboard

---

## Project Structure

```
videocall/
├── app.py                  # Flask app, Socket.IO events, MongoDB
├── requirements.txt
├── templates/
│   ├── login.html
│   ├── register.html
│   ├── dashboard.html
│   └── room.html
└── static/
    ├── css/
    │   ├── auth.css
    │   ├── dashboard.css
    │   └── room.css
    └── js/
        └── room.js         # WebRTC + Socket.IO signaling
```

---

## How It Works

- **Signaling**: Flask-SocketIO handles WebRTC offer/answer/ICE candidate exchange
- **Video**: Browser-to-browser WebRTC (no media server needed for small calls)
- **Auth**: Session-based login with SHA-256 hashed passwords
- **Database**: MongoDB stores users, room metadata, and call history

---

## Notes

- For production, use HTTPS (WebRTC requires it on non-localhost)
- For large calls (10+ people), consider a media server like mediasoup or Janus
- Change `SECRET_KEY` in production
