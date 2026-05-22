// NexCall Room — WebRTC + Socket.IO
const socket = io();

const ICE_SERVERS = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun2.l.google.com:19302" }
  ]
};

let localStream = null;
let screenStream = null;
let peers = {}; // socket_id -> RTCPeerConnection
let micEnabled = true;
let camEnabled = true;
let screenSharing = false;
let chatOpen = false;

// ─── INIT ──────────────────────────────────────────────────────────────────

async function init() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById("local-video").srcObject = localStream;
    document.getElementById("local-overlay").style.display = "none";
  } catch (err) {
    console.warn("Media access denied:", err);
    showToast("Camera/mic access denied. Others won't see/hear you.");
    localStream = new MediaStream();
    document.getElementById("local-overlay").style.display = "flex";
  }
  socket.emit("join", { room_id: ROOM_ID, username: USERNAME });
}

// ─── SOCKET EVENTS ─────────────────────────────────────────────────────────

socket.on("connect", () => {
  document.getElementById("conn-status").textContent = "● Connected";
  document.getElementById("conn-status").className = "conn-status connected";
});

socket.on("disconnect", () => {
  document.getElementById("conn-status").textContent = "● Disconnected";
  document.getElementById("conn-status").className = "conn-status connecting";
});

// Existing peers when joining
socket.on("existing_peers", async ({ peers: existingPeers }) => {
  for (const peer of existingPeers) {
    await createOffer(peer.socket_id, peer.username);
  }
  updateEmptyState();
});

// New peer joined — they'll wait for our offer
socket.on("user_joined", async ({ socket_id, username }) => {
  showToast(`${username} joined`);
  updateEmptyState();
});

// Receive offer → answer
socket.on("offer", async ({ offer, from_socket, username }) => {
  const pc = createPeerConnection(from_socket, username || "Guest");
  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("answer", { answer, target_socket: from_socket });
  updateEmptyState();
});

// Receive answer
socket.on("answer", async ({ answer, from_socket }) => {
  const pc = peers[from_socket];
  if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
});

// ICE candidates
socket.on("ice_candidate", async ({ candidate, from_socket }) => {
  const pc = peers[from_socket];
  if (pc && candidate) {
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e) {}
  }
});

// User left
socket.on("user_left", ({ socket_id, username }) => {
  if (peers[socket_id]) {
    peers[socket_id].close();
    delete peers[socket_id];
  }
  const tile = document.getElementById("tile-" + socket_id);
  if (tile) tile.remove();
  if (username) showToast(`${username} left`);
  updateVideoGrid();
  updateEmptyState();
});

// Chat
socket.on("chat_message", ({ username, message, timestamp }) => {
  addChatMessage(username, message, timestamp, username === USERNAME);
});

// ─── WEBRTC ────────────────────────────────────────────────────────────────

function createPeerConnection(socketId, username) {
  const pc = new RTCPeerConnection(ICE_SERVERS);
  peers[socketId] = pc;

  // Add local tracks
  if (localStream) {
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
  }

  // ICE candidates
  pc.onicecandidate = ({ candidate }) => {
    if (candidate) {
      socket.emit("ice_candidate", { candidate, target_socket: socketId });
    }
  };

  // Remote stream
  pc.ontrack = ({ streams }) => {
    let tile = document.getElementById("tile-" + socketId);
    if (!tile) {
      tile = createVideoTile(socketId, username);
    }
    const video = tile.querySelector("video");
    if (video.srcObject !== streams[0]) {
      video.srcObject = streams[0];
    }
    updateVideoGrid();
    updateEmptyState();
  };

  pc.onconnectionstatechange = () => {
    if (pc.connectionState === "failed") {
      console.warn("Peer connection failed:", socketId);
    }
  };

  return pc;
}

async function createOffer(targetSocket, username) {
  const pc = createPeerConnection(targetSocket, username);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("offer", { offer, target_socket: targetSocket, username: USERNAME });
}

function createVideoTile(socketId, username) {
  const grid = document.getElementById("video-grid");
  const tile = document.createElement("div");
  tile.className = "video-tile";
  tile.id = "tile-" + socketId;

  const video = document.createElement("video");
  video.autoplay = true;
  video.playsinline = true;

  const label = document.createElement("div");
  label.className = "video-label";
  label.textContent = username;

  const overlay = document.createElement("div");
  overlay.className = "video-overlay";
  overlay.id = "overlay-" + socketId;
  overlay.style.display = "none";

  const avatar = document.createElement("div");
  avatar.className = "avatar-circle";
  avatar.textContent = username[0].toUpperCase();
  overlay.appendChild(avatar);

  tile.appendChild(video);
  tile.appendChild(label);
  tile.appendChild(overlay);
  grid.appendChild(tile);
  return tile;
}

// ─── CONTROLS ──────────────────────────────────────────────────────────────

function toggleMic() {
  if (!localStream) return;
  micEnabled = !micEnabled;
  localStream.getAudioTracks().forEach(t => t.enabled = micEnabled);
  const btn = document.getElementById("btn-mic");
  document.getElementById("mic-icon").textContent = micEnabled ? "🎙" : "🔇";
  btn.classList.toggle("muted", !micEnabled);
  btn.querySelector(".ctrl-label").textContent = micEnabled ? "Mute" : "Unmuted";
}

function toggleCam() {
  if (!localStream) return;
  camEnabled = !camEnabled;
  localStream.getVideoTracks().forEach(t => t.enabled = camEnabled);
  document.getElementById("cam-icon").textContent = camEnabled ? "📷" : "🚫";
  document.getElementById("local-overlay").style.display = camEnabled ? "none" : "flex";
  document.getElementById("btn-cam").classList.toggle("muted", !camEnabled);
}

async function toggleScreen() {
  const btn = document.getElementById("btn-screen");
  if (!screenSharing) {
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];

      // Replace video track in all peer connections
      Object.values(peers).forEach(pc => {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
        if (sender) sender.replaceTrack(screenTrack);
      });

      // Show screen in local video
      const localVideo = document.getElementById("local-video");
      const origStream = localStream;
      localVideo.srcObject = screenStream;

      screenTrack.onended = () => {
        stopScreen(origStream);
      };

      screenSharing = true;
      btn.classList.add("active");
      btn.querySelector(".ctrl-label").textContent = "Stop";
      showToast("Screen sharing started");
    } catch (e) {
      showToast("Screen sharing cancelled");
    }
  } else {
    stopScreen(localStream);
  }
}

function stopScreen(origStream) {
  if (screenStream) {
    screenStream.getTracks().forEach(t => t.stop());
    screenStream = null;
  }
  const videoTrack = origStream ? origStream.getVideoTracks()[0] : null;
  if (videoTrack) {
    Object.values(peers).forEach(pc => {
      const sender = pc.getSenders().find(s => s.track && s.track.kind === "video");
      if (sender) sender.replaceTrack(videoTrack);
    });
  }
  document.getElementById("local-video").srcObject = origStream;
  screenSharing = false;
  const btn = document.getElementById("btn-screen");
  btn.classList.remove("active");
  btn.querySelector(".ctrl-label").textContent = "Screen";
  showToast("Screen sharing stopped");
}

function leaveRoom() {
  socket.emit("leave", { room_id: ROOM_ID, username: USERNAME });
  localStream && localStream.getTracks().forEach(t => t.stop());
  screenStream && screenStream.getTracks().forEach(t => t.stop());
  Object.values(peers).forEach(pc => pc.close());
  window.location.href = "/dashboard";
}

// ─── CHAT ──────────────────────────────────────────────────────────────────

function toggleChat() {
  chatOpen = !chatOpen;
  document.getElementById("chat-sidebar").classList.toggle("open", chatOpen);
  document.getElementById("chat-label").textContent = chatOpen ? "Close" : "Chat";
  document.getElementById("btn-chat").classList.toggle("active", chatOpen);
}

function sendChat() {
  const input = document.getElementById("chat-input");
  const msg = input.value.trim();
  if (!msg) return;
  socket.emit("chat_message", { room_id: ROOM_ID, username: USERNAME, message: msg });
  input.value = "";
}

function addChatMessage(username, message, timestamp, isSelf) {
  const container = document.getElementById("chat-messages");
  const div = document.createElement("div");
  div.className = "chat-msg" + (isSelf ? " self" : "");
  div.innerHTML = `
    <div class="msg-meta"><span class="msg-user">${escapeHtml(username)}</span> · ${timestamp}</div>
    <div class="msg-body">${escapeHtml(message)}</div>
  `;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;

  if (!chatOpen) {
    showToast(`💬 ${username}: ${message.slice(0, 40)}`);
  }
}

document.getElementById("chat-input").addEventListener("keydown", e => {
  if (e.key === "Enter") sendChat();
});

// ─── UI HELPERS ────────────────────────────────────────────────────────────

function updateVideoGrid() {
  const grid = document.getElementById("video-grid");
  const count = grid.querySelectorAll(".video-tile").length;
  grid.className = "video-grid";
  if (count === 2) grid.classList.add("peers-2");
  else if (count === 3) grid.classList.add("peers-3");
  else if (count >= 4) grid.classList.add("peers-4");
}

function updateEmptyState() {
  const grid = document.getElementById("video-grid");
  const peerCount = grid.querySelectorAll(".video-tile:not(.local-tile)").length;
  const empty = document.getElementById("empty-state");
  empty.classList.toggle("visible", peerCount === 0);
}

function copyRoomId() {
  navigator.clipboard.writeText(ROOM_ID).then(() => showToast("Room code copied!"));
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function escapeHtml(str) {
  return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// ─── START ─────────────────────────────────────────────────────────────────
init();
updateEmptyState();
