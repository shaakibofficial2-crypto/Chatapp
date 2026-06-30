require('dotenv').config();
const http = require('http');
const url = require('url');
const querystring = require('querystring');
const { MongoClient, ObjectId } = require('mongodb');
 
const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    console.error("❌ ERROR: MONGO_URI environment variable is missing!");
    process.exit(1);
}
 
const client = new MongoClient(mongoUri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    maxIdleTimeMS: 30000,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000
});
 
let db, usersCollection, roomsCollection, messagesCollection, reactionsCollection, pinsCollection;
 
async function connectDB() {
    try {
        await client.connect();
        db = client.db('chat-app-db');
        usersCollection = db.collection('users');
        roomsCollection = db.collection('rooms');
        messagesCollection = db.collection('messages');
        reactionsCollection = db.collection('reactions');
        pinsCollection = db.collection('pins');
        
        // Create indexes for better performance
        await usersCollection.createIndex({ email: 1 });
        await usersCollection.createIndex({ phone: 1 });
        await roomsCollection.createIndex({ roomId: 1 });
        await roomsCollection.createIndex({ creator: 1 });
        await messagesCollection.createIndex({ roomId: 1, timestamp: 1 });
        
        console.log("✅ Successfully connected to MongoDB!");
    } catch (err) {
        console.error("❌ MongoDB connection failed:", err);
        process.exit(1);
    }
}
 
// Helper: Generate room ID
function generateRoomId() {
    return 'ROOM-' + Math.random().toString(36).substr(2, 9).toUpperCase();
}
 
// Helper: Parse JSON safely
function parseJSON(str) {
    try {
        return JSON.parse(str);
    } catch {
        return null;
    }
}
 
const html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ChatApp - Room Based</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        :root {
            --primary: #0084ff;
            --dark-bg: #0a0e27;
            --dark-card: #1a1f3a;
            --dark-border: #2d3548;
            --text-primary: #fff;
            --text-secondary: #999;
            --accent: #ff6b00;
        }
        
        body.light-mode {
            --dark-bg: #f5f5f5;
            --dark-card: #fff;
            --dark-border: #e0e0e0;
            --text-primary: #000;
            --text-secondary: #666;
        }
        
        body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--dark-bg);
            color: var(--text-primary);
            overflow: hidden;
            transition: background 0.3s;
        }
        
        .container { display: flex; height: 100vh; width: 100vw; }
        .sidebar { width: 320px; border-right: 1px solid var(--dark-border); display: flex; flex-direction: column; background: var(--dark-card); height: 100%; }
        .main { flex: 1; display: flex; flex-direction: column; background: var(--dark-bg); }
        
        .sidebar-header { padding: 16px; border-bottom: 1px solid var(--dark-border); }
        .sidebar-header h2 { font-size: 24px; font-weight: 800; margin-bottom: 12px; }
        .user-info { font-size: 12px; color: var(--text-secondary); padding: 8px; background: var(--dark-bg); border-radius: 6px; }
        
        .action-buttons { padding: 12px 16px; display: flex; gap: 8px; border-bottom: 1px solid var(--dark-border); }
        .action-buttons button { flex: 1; padding: 10px; background: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px; }
        .action-buttons button.secondary { background: var(--accent); }
        
        .rooms-list { flex: 1; overflow-y: auto; }
        .room-item { padding: 12px 16px; border-bottom: 1px solid var(--dark-border); cursor: pointer; transition: background 0.2s; }
        .room-item:hover { background: var(--primary); opacity: 0.1; }
        .room-item.active { background: var(--primary); color: white; }
        .room-item-name { font-weight: 600; font-size: 14px; }
        .room-item-info { font-size: 11px; color: var(--text-secondary); margin-top: 4px; }
        
        .sidebar-footer { padding: 12px 16px; border-top: 1px solid var(--dark-border); display: flex; gap: 8px; }
        .sidebar-footer button { flex: 1; padding: 10px; background: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 12px; }
        
        .chat-header { padding: 14px 20px; border-bottom: 1px solid var(--dark-border); display: flex; align-items: center; justify-content: space-between; }
        .chat-header-left { display: flex; align-items: center; gap: 12px; flex: 1; }
        .chat-header-info h2 { font-size: 15px; font-weight: 600; }
        .chat-header-info p { font-size: 12px; color: var(--text-secondary); }
        .chat-header-right { display: flex; gap: 8px; }
        .chat-header-right button { background: none; border: none; font-size: 20px; cursor: pointer; }
        
        .messages-area { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
        .message { display: flex; margin-bottom: 4px; }
        .message.sent { justify-content: flex-end; }
        .message.received { justify-content: flex-start; }
        .message-bubble { max-width: 60%; padding: 10px 14px; border-radius: 14px; word-wrap: break-word; font-size: 14px; line-height: 1.4; position: relative; }
        .message.sent .message-bubble { background: var(--primary); color: white; }
        .message.received .message-bubble { background: var(--dark-border); color: var(--text-primary); }
        .message-user { font-size: 11px; font-weight: 600; margin-bottom: 4px; color: var(--accent); }
        .message-image { max-width: 200px; border-radius: 8px; margin-top: 4px; cursor: pointer; }
        .message-time { font-size: 10px; color: var(--text-secondary); margin-top: 4px; }
        
        .input-section { padding: 12px 16px; border-top: 1px solid var(--dark-border); display: flex; gap: 8px; align-items: center; }
        .input-section input { flex: 1; padding: 10px 14px; border: 1px solid var(--dark-border); border-radius: 20px; background: var(--dark-bg); color: var(--text-primary); font-size: 14px; outline: none; }
        .input-section button { padding: 10px 16px; background: var(--primary); color: white; border: none; border-radius: 20px; cursor: pointer; font-weight: 600; font-size: 13px; }
        
        .modal { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: none; align-items: center; justify-content: center; z-index: 1000; }
        .modal.show { display: flex; }
        .modal-content { background: var(--dark-card); padding: 24px; border-radius: 12px; max-width: 400px; width: 90%; max-height: 80vh; overflow-y: auto; }
        .modal-content h2 { margin-bottom: 16px; font-size: 20px; }
        .modal-content input, .modal-content textarea, .modal-content select { width: 100%; padding: 10px 12px; margin-bottom: 12px; border: 1px solid var(--dark-border); border-radius: 8px; background: var(--dark-bg); color: var(--text-primary); font-size: 14px; outline: none; font-family: inherit; }
        .modal-content textarea { resize: vertical; min-height: 80px; }
        .modal-buttons { display: flex; gap: 8px; margin-top: 16px; }
        .modal-buttons button { flex: 1; padding: 10px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; }
        .modal-buttons button.primary { background: var(--primary); color: white; }
        .modal-buttons button.secondary { background: var(--dark-border); color: var(--text-primary); }
        
        .placeholder { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-secondary); font-size: 16px; }
        .empty-state { padding: 40px 20px; text-align: center; color: var(--text-secondary); }
        
        .room-settings-btn { background: none; border: none; font-size: 18px; cursor: pointer; color: var(--text-primary); }
        .admin-badge { background: var(--accent); color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; margin-left: 8px; }
        
        @media (max-width: 768px) {
            .sidebar { width: 100%; position: absolute; left: 0; top: 0; height: 100%; transform: translateX(-100%); transition: transform 0.3s; z-index: 100; }
            .container.show-chat .sidebar { transform: translateX(-100%); }
            .container.show-chat .main { width: 100%; }
            .chat-header-left .back-btn { display: block; background: none; border: none; font-size: 20px; cursor: pointer; color: var(--primary); }
        }
    </style>
</head>
<body>
    <div id="app"></div>
    
    <!-- Modals -->
    <div id="setupModal" class="modal show"></div>
    <div id="roomCreateModal" class="modal"></div>
    <div id="roomJoinModal" class="modal"></div>
    <div id="settingsModal" class="modal"></div>
    <div id="imageViewerModal" class="modal"></div>
    
    <script>
        const API = window.location.origin + '/api';
        
        window.app = {
            user: null,
            currentRoom: null,
            rooms: [],
            refreshInterval: null,
            isDarkMode: true
        };
        
        // Utility Functions
        window.generateColor = (str) => {
            const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];
            let hash = 0;
            for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
            return colors[Math.abs(hash) % colors.length];
        };
        
        window.getInitials = (name) => name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U';
        
        window.formatTime = (timestamp) => {
            const date = new Date(timestamp);
            return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
        };
        
        // API Calls
        window.initUser = async (name, email, phone) => {
            try {
                const res = await fetch(API + '/init-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name, email, phone })
                });
                return await res.json();
            } catch (e) {
                return { error: 'Connection failed' };
            }
        };
        
        window.createRoom = async (roomName, isPrivate) => {
            try {
                const res = await fetch(API + '/create-room', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ creator: window.app.user.email, roomName, isPrivate })
                });
                return await res.json();
            } catch (e) {
                return { error: 'Failed to create room' };
            }
        };
        
        window.joinRoom = async (roomId) => {
            try {
                const res = await fetch(API + '/join-room', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: window.app.user.email, roomId })
                });
                return await res.json();
            } catch (e) {
                return { error: 'Failed to join room' };
            }
        };
        
        window.getRooms = async () => {
            try {
                const res = await fetch(API + '/rooms/' + window.app.user.email);
                return await res.json();
            } catch (e) {
                return { rooms: [] };
            }
        };
        
        window.getMessages = async (roomId) => {
            try {
                const res = await fetch(API + '/messages/' + roomId);
                return await res.json();
            } catch (e) {
                return { messages: [] };
            }
        };
        
        window.sendMessage = async (roomId, text, type = 'text') => {
            try {
                const res = await fetch(API + '/send-message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        roomId, 
                        sender: window.app.user.email, 
                        senderName: window.app.user.name,
                        text, 
                        type 
                    })
                });
                return await res.json();
            } catch (e) {
                return { error: 'Failed to send' };
            }
        };
        
        window.addReaction = async (messageId, emoji) => {
            try {
                const res = await fetch(API + '/add-reaction', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messageId, emoji, user: window.app.user.email })
                });
                return await res.json();
            } catch (e) {
                return { error: 'Failed' };
            }
        };
        
        // UI Rendering
        window.renderSetupScreen = () => {
            const modal = document.getElementById('setupModal');
            modal.innerHTML = \`
                <div class="modal-content" style="max-width: 350px;">
                    <h2>Welcome to ChatApp 🎮</h2>
                    <input type="text" id="setupName" placeholder="Full Name" />
                    <input type="email" id="setupEmail" placeholder="Email" />
                    <input type="tel" id="setupPhone" placeholder="Phone Number" />
                    <div class="modal-buttons">
                        <button class="primary" onclick="window.handleSetup()">Continue</button>
                    </div>
                </div>
            \`;
            modal.classList.add('show');
        };
        
        window.handleSetup = async () => {
            const name = document.getElementById('setupName').value.trim();
            const email = document.getElementById('setupEmail').value.trim();
            const phone = document.getElementById('setupPhone').value.trim();
            
            if (!name || !email || !phone) {
                alert('Please fill all fields');
                return;
            }
            
            const result = await window.initUser(name, email, phone);
            if (result.error) {
                alert(result.error);
                return;
            }
            
            window.app.user = result.user;
            localStorage.setItem('chatAppUser', JSON.stringify(window.app.user));
            document.getElementById('setupModal').classList.remove('show');
            window.renderMain();
            window.startSync();
        };
        
        window.renderMain = () => {
            const app = document.getElementById('app');
            app.innerHTML = \`
                <div class="container" id="container">
                    <div class="sidebar">
                        <div class="sidebar-header">
                            <h2>Rooms</h2>
                            <div class="user-info">👤 \${window.app.user.name}<br>📧 \${window.app.user.email}</div>
                        </div>
                        <div class="action-buttons">
                            <button onclick="window.showCreateRoomModal()">+ Create</button>
                            <button class="secondary" onclick="window.showJoinRoomModal()">🔓 Join</button>
                        </div>
                        <div class="rooms-list" id="roomsList"></div>
                        <div class="sidebar-footer">
                            <button onclick="window.chatWithCreator()">💬 Creator</button>
                            <button onclick="window.showSettingsModal()">⚙️ Settings</button>
                        </div>
                    </div>
                    <div class="main" id="mainArea">
                        <div class="placeholder">Select a room to start chatting</div>
                    </div>
                </div>
            \`;
            window.updateRoomsList();
        };
        
        window.updateRoomsList = async () => {
            const data = await window.getRooms();
            const roomsList = document.getElementById('roomsList');
            
            if (!data.rooms || data.rooms.length === 0) {
                roomsList.innerHTML = '<div class="empty-state">No rooms yet<br>Create or join one!</div>';
                return;
            }
            
            roomsList.innerHTML = data.rooms.map(room => {
                const isActive = window.app.currentRoom && window.app.currentRoom._id === room._id ? 'active' : '';
                return \`
                    <div class="room-item \${isActive}" onclick="window.selectRoom('\${room._id}')">
                        <div style="display: flex; align-items: center;">
                            <span style="font-size: 18px; margin-right: 8px;">🔒</span>
                            <div style="flex: 1;">
                                <div class="room-item-name">\${room.roomName}\${room.creator === window.app.user.email ? '<span class="admin-badge">ADMIN</span>' : ''}</div>
                                <div class="room-item-info">\${room.members ? room.members.length : 0} members</div>
                            </div>
                        </div>
                    </div>
                \`;
            }).join('');
        };
        
        window.selectRoom = async (roomId) => {
            const data = await window.getRooms();
            window.app.currentRoom = data.rooms.find(r => r._id === roomId);
            
            if (!window.app.currentRoom) return;
            
            const mainArea = document.getElementById('mainArea');
            mainArea.innerHTML = \`
                <div class="chat-header">
                    <div class="chat-header-left">
                        <button class="back-btn" onclick="window.deselectRoom()">←</button>
                        <div class="chat-header-info">
                            <h2>\${window.app.currentRoom.roomName}</h2>
                            <p>\${window.app.currentRoom.members.length} members • \${window.app.currentRoom.isPrivate ? '🔒 Private' : '🔓 Public'}</p>
                        </div>
                    </div>
                    <div class="chat-header-right">
                        \${window.app.currentRoom.creator === window.app.user.email ? '<button onclick="window.showRoomSettings()" class="room-settings-btn">⚙️</button>' : ''}
                    </div>
                </div>
                <div class="messages-area" id="messagesArea"></div>
                <div class="input-section">
                    <button id="voiceBtn" onclick="window.recordVoice()" style="background: none; border: none; font-size: 20px; cursor: pointer;">🎤</button>
                    <input type="file" id="imageInput" accept="image/*" style="display: none;" onchange="window.handleImageSelect()" />
                    <button onclick="document.getElementById('imageInput').click()" style="background: none; border: none; font-size: 20px; cursor: pointer;">📸</button>
                    <input type="text" id="messageInput" placeholder="Type a message..." />
                    <button onclick="window.handleSendMessage()">Send</button>
                </div>
            \`;
            
            document.getElementById('messageInput')?.focus();
            await window.updateMessages();
        };
        
        window.updateMessages = async () => {
            if (!window.app.currentRoom) return;
            
            const data = await window.getMessages(window.app.currentRoom._id);
            const messagesArea = document.getElementById('messagesArea');
            
            if (!data.messages || data.messages.length === 0) {
                messagesArea.innerHTML = '<div class="placeholder">No messages yet. Start the conversation!</div>';
                return;
            }
            
            messagesArea.innerHTML = data.messages.map(msg => {
                const isOwn = msg.sender === window.app.user.email;
                const isSent = isOwn ? 'sent' : 'received';
                
                let content = '';
                if (msg.type === 'text') {
                    content = \`<div class="message-bubble">\${msg.text}</div>\`;
                } else if (msg.type === 'image') {
                    content = \`<img src="\${msg.text}" class="message-image" onclick="window.viewImage('\${msg.text}')" />\`;
                } else if (msg.type === 'audio') {
                    content = \`<audio src="\${msg.text}" controls style="max-width: 200px; margin-top: 4px;"></audio>\`;
                }
                
                return \`
                    <div class="message \${isSent}">
                        <div class="message-content">
                            \${!isOwn ? '<div class="message-user">' + msg.senderName + '</div>' : ''}
                            \${content}
                            <div class="message-time">\${window.formatTime(msg.timestamp)}</div>
                        </div>
                    </div>
                \`;
            }).join('');
            
            messagesArea.scrollTop = messagesArea.scrollHeight;
        };
        
        window.handleSendMessage = async () => {
            const input = document.getElementById('messageInput');
            if (!input) return;
            
            const text = input.value.trim();
            if (!text || !window.app.currentRoom) return;
            
            await window.sendMessage(window.app.currentRoom._id, text, 'text');
            input.value = '';
            await window.updateMessages();
        };
        
        window.handleImageSelect = async () => {
            const file = document.getElementById('imageInput').files[0];
            if (!file) return;
            
            const reader = new FileReader();
            reader.onload = async (e) => {
                await window.sendMessage(window.app.currentRoom._id, e.target.result, 'image');
                document.getElementById('imageInput').value = '';
                await window.updateMessages();
            };
            reader.readAsDataURL(file);
        };
        
        window.viewImage = (src) => {
            const modal = document.getElementById('imageViewerModal');
            modal.innerHTML = \`
                <div style="max-width: 90%; max-height: 90%;">
                    <img src="\${src}" style="max-width: 100%; max-height: 100%; border-radius: 8px;" />
                </div>
            \`;
            modal.classList.add('show');
            modal.onclick = () => modal.classList.remove('show');
        };
        
        window.showCreateRoomModal = () => {
            const modal = document.getElementById('roomCreateModal');
            modal.innerHTML = \`
                <div class="modal-content">
                    <h2>Create Room</h2>
                    <label style="font-size: 12px; color: var(--text-secondary); margin-bottom: 8px; display: block;">Room Type</label>
                    <select id="roomType" style="margin-bottom: 12px;">
                        <option value="named">Custom Name</option>
                        <option value="auto">Auto Generate ID</option>
                    </select>
                    <input type="text" id="roomName" placeholder="Room name (if custom)" />
                    <label>
                        <input type="checkbox" id="isPrivate" checked /> Private Room
                    </label>
                    <div class="modal-buttons" style="margin-top: 16px;">
                        <button class="primary" onclick="window.handleCreateRoom()">Create</button>
                        <button class="secondary" onclick="document.getElementById('roomCreateModal').classList.remove('show')">Cancel</button>
                    </div>
                </div>
            \`;
            modal.classList.add('show');
        };
        
        window.handleCreateRoom = async () => {
            const type = document.getElementById('roomType').value;
            const isPrivate = document.getElementById('isPrivate').checked;
            let roomName = document.getElementById('roomName').value.trim();
            
            if (type === 'auto') {
                roomName = 'Room ' + Math.random().toString(36).substr(2, 5).toUpperCase();
            }
            
            if (!roomName) {
                alert('Enter room name');
                return;
            }
            
            const result = await window.createRoom(roomName, isPrivate);
            if (result.error) {
                alert(result.error);
            } else {
                alert('Room created! ID: ' + result.roomId);
                document.getElementById('roomCreateModal').classList.remove('show');
                await window.updateRoomsList();
            }
        };
        
        window.showJoinRoomModal = () => {
            const modal = document.getElementById('roomJoinModal');
            modal.innerHTML = \`
                <div class="modal-content">
                    <h2>Join Room</h2>
                    <input type="text" id="joinRoomId" placeholder="Enter Room ID (e.g., ROOM-ABC123)" />
                    <div class="modal-buttons">
                        <button class="primary" onclick="window.handleJoinRoom()">Join</button>
                        <button class="secondary" onclick="document.getElementById('roomJoinModal').classList.remove('show')">Cancel</button>
                    </div>
                </div>
            \`;
            modal.classList.add('show');
        };
        
        window.handleJoinRoom = async () => {
            const roomId = document.getElementById('joinRoomId').value.trim();
            if (!roomId) {
                alert('Enter room ID');
                return;
            }
            
            const result = await window.joinRoom(roomId);
            if (result.error) {
                alert(result.error);
            } else {
                alert('Joined room!');
                document.getElementById('roomJoinModal').classList.remove('show');
                await window.updateRoomsList();
            }
        };
        
        window.chatWithCreator = () => {
            alert('Chat with Creator feature:\n📞 +94 782 721 294\n\nDirect chat available soon!');
        };
        
        window.showSettingsModal = () => {
            const modal = document.getElementById('settingsModal');
            modal.innerHTML = \`
                <div class="modal-content">
                    <h2>Settings ⚙️</h2>
                    <h3 style="margin-top: 16px; margin-bottom: 8px;">Theme</h3>
                    <button onclick="window.toggleTheme()" style="width: 100%; padding: 10px; background: var(--primary); color: white; border: none; border-radius: 8px; cursor: pointer;">
                        \${window.app.isDarkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
                    </button>
                    <h3 style="margin-top: 16px; margin-bottom: 8px;">Profile</h3>
                    <p style="font-size: 12px; color: var(--text-secondary);">Name: \${window.app.user.name}</p>
                    <p style="font-size: 12px; color: var(--text-secondary);">Email: \${window.app.user.email}</p>
                    <p style="font-size: 12px; color: var(--text-secondary);">Phone: \${window.app.user.phone}</p>
                    <div class="modal-buttons" style="margin-top: 16px;">
                        <button class="secondary" onclick="document.getElementById('settingsModal').classList.remove('show')">Close</button>
                    </div>
                </div>
            \`;
            modal.classList.add('show');
        };
        
        window.toggleTheme = () => {
            window.app.isDarkMode = !window.app.isDarkMode;
            document.body.classList.toggle('light-mode');
            localStorage.setItem('chatAppTheme', window.app.isDarkMode ? 'dark' : 'light');
            window.showSettingsModal();
        };
        
        window.deselectRoom = () => {
            window.app.currentRoom = null;
            window.renderMain();
        };
        
        window.startSync = () => {
            if (window.app.refreshInterval) clearInterval(window.app.refreshInterval);
            window.app.refreshInterval = setInterval(async () => {
                if (window.app.currentRoom) {
                    await window.updateMessages();
                } else {
                    await window.updateRoomsList();
                }
            }, 2000);
        };
        
        // Initialize
        const saved = localStorage.getItem('chatAppUser');
        if (saved) {
            window.app.user = JSON.parse(saved);
            window.renderMain();
            window.startSync();
        } else {
            window.renderSetupScreen();
        }
        
        const savedTheme = localStorage.getItem('chatAppTheme');
        if (savedTheme === 'light') {
            window.app.isDarkMode = false;
            document.body.classList.add('light-mode');
        }
    </script>
</body>
</html>`;
 
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }
    
    if (pathname === '/' && req.method === 'GET') {
        res.setHeader('Content-Type', 'text/html');
        res.writeHead(200);
        res.end(html);
        return;
    }
    
    // API Routes
    if (pathname === '/api/init-user' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { name, email, phone } = parseJSON(body);
                if (!name || !email || !phone) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Missing fields' }));
                    return;
                }
                
                let user = await usersCollection.findOne({ email });
                if (!user) {
                    const result = await usersCollection.insertOne({
                        name, email, phone,
                        bio: '',
                        hidePhone: false,
                        createdAt: new Date()
                    });
                    user = { _id: result.insertedId, name, email, phone, bio: '', hidePhone: false };
                }
                
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, user }));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Database error' }));
            }
        });
        return;
    }
    
    if (pathname === '/api/create-room' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { creator, roomName, isPrivate } = parseJSON(body);
                if (!creator || !roomName) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Missing fields' }));
                    return;
                }
                
                const roomId = generateRoomId();
                const result = await roomsCollection.insertOne({
                    roomId, roomName, creator, isPrivate,
                    members: [creator],
                    createdAt: new Date(),
                    settings: { allowPinning: true, allowMentions: true }
                });
                
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, roomId, _id: result.insertedId }));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Failed to create room' }));
            }
        });
        return;
    }
    
    if (pathname === '/api/join-room' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { email, roomId } = parseJSON(body);
                const room = await roomsCollection.findOne({ roomId });
                
                if (!room) {
                    res.writeHead(404);
                    res.end(JSON.stringify({ error: 'Room not found' }));
                    return;
                }
                
                if (!room.members.includes(email)) {
                    await roomsCollection.updateOne(
                        { roomId },
                        { $push: { members: email } }
                    );
                }
                
                res.writeHead(200);
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Failed to join' }));
            }
        });
        return;
    }
    
    if (pathname.startsWith('/api/rooms/') && req.method === 'GET') {
        const email = pathname.split('/')[3];
        try {
            const rooms = await roomsCollection.find({ members: email }).toArray();
            res.writeHead(200);
            res.end(JSON.stringify({ rooms }));
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ rooms: [] }));
        }
        return;
    }
    
    if (pathname === '/api/send-message' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', async () => {
            try {
                const { roomId, sender, senderName, text, type } = parseJSON(body);
                if (!roomId || !sender || !text) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Missing fields' }));
                    return;
                }
                
                const result = await messagesCollection.insertOne({
                    roomId, sender, senderName, text, type: type || 'text',
                    timestamp: Date.now(),
                    reactions: []
                });
                
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, messageId: result.insertedId }));
            } catch (e) {
                res.writeHead(500);
                res.end(JSON.stringify({ error: 'Failed to send' }));
            }
        });
        return;
    }
    
    if (pathname.startsWith('/api/messages/') && req.method === 'GET') {
        const roomId = pathname.split('/')[3];
        try {
            const messages = await messagesCollection.find({ roomId }).sort({ timestamp: 1 }).toArray();
            res.writeHead(200);
            res.end(JSON.stringify({ messages }));
        } catch (e) {
            res.writeHead(500);
            res.end(JSON.stringify({ messages: [] }));
        }
        return;
    }
    
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});
 
const PORT = process.env.PORT || 3000;
 
async function startServer() {
    await connectDB();
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`✅ ChatApp server running on port ${PORT}`);
    });
}
 
startServer();
 