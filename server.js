const http = require('http');
const url = require('url');
 
let users = {};
let chats = {};
 
const html = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chat App</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #fff; color: #222; }
        .setup-screen { display: flex; align-items: center; justify-content: center; height: 100vh; padding: 20px; }
        .setup-card { width: 100%; max-width: 400px; background: #fff; padding: 40px 20px; text-align: center; border-radius: 12px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        .setup-card h1 { font-size: 28px; margin-bottom: 30px; color: #000; font-weight: 600; }
        .setup-card input { width: 100%; padding: 12px 16px; margin-bottom: 15px; border: 1px solid #ddd; border-radius: 8px; font-size: 16px; outline: none; }
        .setup-card input:focus { border-color: #0084ff; }
        .setup-card button { width: 100%; padding: 12px; background: #0084ff; color: white; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; font-weight: 600; }
        .setup-card button:hover { background: #0073e6; }
        .setup-card .error { color: #e74c3c; margin-top: 10px; font-size: 14px; }
        .container { display: flex; height: 100vh; }
        .sidebar { width: 280px; border-right: 1px solid #e5e5e5; display: flex; flex-direction: column; background: #fff; }
        .sidebar-header { padding: 16px; border-bottom: 1px solid #e5e5e5; }
        .sidebar-header h2 { font-size: 32px; font-weight: 800; margin-bottom: 16px; }
        .user-info { font-size: 12px; color: #888; padding: 8px; background: #f5f5f5; border-radius: 6px; word-break: break-all; }
        .add-contact-section { padding: 12px; display: flex; gap: 8px; }
        .add-contact-section input { flex: 1; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; }
        .add-contact-section button { padding: 8px 16px; background: #0084ff; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 500; font-size: 14px; }
        .add-contact-section button:hover { background: #0073e6; }
        .chat-list { flex: 1; overflow-y: auto; }
        .chat-item { padding: 12px 16px; border-bottom: 1px solid #f0f0f0; cursor: pointer; display: flex; align-items: center; gap: 12px; transition: background 0.2s; }
        .chat-item:hover { background: #f5f5f5; }
        .chat-item.active { background: #e7f3ff; border-left: 3px solid #0084ff; }
        .avatar { width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 600; font-size: 18px; flex-shrink: 0; }
        .chat-info h3 { font-size: 15px; font-weight: 500; margin: 0; }
        .chat-info p { font-size: 12px; color: #888; margin: 4px 0 0 0; }
        .main { flex: 1; display: flex; flex-direction: column; background: #fff; }
        .chat-header { padding: 12px 20px; border-bottom: 1px solid #e5e5e5; display: flex; align-items: center; gap: 12px; }
        .chat-header-info { flex: 1; }
        .chat-header-info h2 { font-size: 15px; font-weight: 600; margin: 0; }
        .chat-header-info p { font-size: 12px; color: #888; margin: 4px 0 0 0; }
        .messages-area { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
        .message { display: flex; margin-bottom: 8px; }
        .message.sent { justify-content: flex-end; }
        .message.received { justify-content: flex-start; }
        .message-bubble { max-width: 60%; padding: 10px 14px; border-radius: 12px; word-wrap: break-word; font-size: 15px; line-height: 1.4; }
        .message.sent .message-bubble { background: #0084ff; color: white; }
        .message.received .message-bubble { background: #e5e5ea; color: #000; }
        .message-time { font-size: 11px; color: #999; margin-top: 4px; padding: 0 12px; }
        .input-section { padding: 12px 20px; border-top: 1px solid #e5e5e5; display: flex; gap: 8px; }
        .input-section input { flex: 1; padding: 10px 16px; border: 1px solid #ddd; border-radius: 20px; font-size: 15px; outline: none; }
        .input-section input:focus { border-color: #0084ff; }
        .input-section button { padding: 10px 24px; background: #0084ff; color: white; border: none; border-radius: 20px; cursor: pointer; font-weight: 600; font-size: 14px; }
        .input-section button:hover { background: #0073e6; }
        .placeholder { display: flex; align-items: center; justify-content: center; height: 100%; color: #999; font-size: 16px; }
        .empty-state { padding: 20px; text-align: center; color: #999; font-size: 14px; }
        @media (max-width: 768px) { .sidebar { display: none; } }
    </style>
</head>
<body>
    <div id="app"></div>
 
    <script>
        const API = 'https://chatapp-hltm.onrender.com/api';
 
        function generateColor(str) {
            const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2'];
            let hash = 0;
            for (let i = 0; i < str.length; i++) { hash = str.charCodeAt(i) + ((hash << 5) - hash); }
            return colors[Math.abs(hash) % colors.length];
        }
 
        function getInitials(name) {
            return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || 'U';
        }
 
        function formatTime(timestamp) {
            const date = new Date(timestamp);
            return date.getHours().toString().padStart(2, '0') + ':' + date.getMinutes().toString().padStart(2, '0');
        }
 
        let currentUser = null;
        let selectedChat = null;
        let refreshInterval = null;
 
        async function initUser(phone) {
            try {
                const res = await fetch(API + '/init-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone })
                });
                return await res.json();
            } catch (error) { return { error: 'Cannot connect to server' }; }
        }
 
        async function addContact(phone, contact) {
            try {
                const res = await fetch(API + '/add-contact', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone, contact })
                });
                return await res.json();
            } catch (error) { return { error: 'Error' }; }
        }
 
        async function getContacts(phone) {
            try {
                const res = await fetch(API + '/contacts/' + phone);
                return await res.json();
            } catch (error) { return { contacts: [] }; }
        }
 
        async function sendMessage(sender, receiver, text) {
            try {
                const res = await fetch(API + '/send-message', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sender, receiver, text })
                });
                return await res.json();
            } catch (error) { return { error: 'Error' }; }
        }
 
        async function getMessages(user1, user2) {
            try {
                const res = await fetch(API + '/messages/' + user1 + '/' + user2);
                return await res.json();
            } catch (error) { return { messages: [] }; }
        }
 
        function renderStructure() {
            const app = document.getElementById('app');
            if (!currentUser) {
                app.innerHTML = \`
                    <div class="setup-screen">
                        <div class="setup-card">
                            <h1>Chat</h1>
                            <input type="text" id="phoneInput" placeholder="Enter your phone number" />
                            <button onclick="handleSetup()">Start</button>
                            <div id="setupError" class="error"></div>
                        </div>
                    </div>
                \`;
                setTimeout(() => document.getElementById('phoneInput')?.focus(), 100);
                return;
            }
 
            app.innerHTML = \`
                <div class="container">
                    <div class="sidebar">
                        <div class="sidebar-header">
                            <h2>Chats</h2>
                            <div class="user-info">📱 \${currentUser}</div>
                        </div>
                        <div class="add-contact-section">
                            <input type="text" id="contactInput" placeholder="Add contact" />
                            <button onclick="handleAddContact()">Add</button>
                        </div>
                        <div class="chat-list" id="chatList"></div>
                    </div>
                    <div class="main" id="mainArea">
                        <div class="placeholder">Select a chat to start messaging</div>
                    </div>
                </div>
            \`;
            updateData();
        }
 
        async function updateData() {
            if (!currentUser) return;
 
            const chatList = document.getElementById('chatList');
            if (chatList) {
                const contactsData = await getContacts(currentUser);
                const contacts = contactsData.contacts || [];
                if (contacts.length === 0) {
                    chatList.innerHTML = '<div class="empty-state">No chats yet.<br>Add a contact to start!</div>';
                } else {
                    chatList.innerHTML = contacts.map(contact => \`
                        <div class="chat-item \${selectedChat === contact ? 'active' : ''}" onclick="handleSelectChat('\${contact}')">
                            <div class="avatar" style="background: \${generateColor(contact)};">
                                \${getInitials(contact)}
                            </div>
                            <div class="chat-info">
                                <h3>\${contact}</h3>
                                <p>Ready to chat</p>
                            </div>
                        </div>
                    \`).join('');
                }
            }
 
            const messagesArea = document.getElementById('messagesArea');
            if (selectedChat && messagesArea) {
                const messagesData = await getMessages(currentUser, selectedChat);
                const messages = messagesData.messages || [];
                
                const oldScrollHeight = messagesArea.scrollHeight;
                const wasAtBottom = messagesArea.scrollTop + messagesArea.clientHeight >= oldScrollHeight - 20;
 
                if (messages.length === 0) {
                    messagesArea.innerHTML = '<div style="flex: 1; display: flex; align-items: center; justify-content: center; color: #999;">Start a conversation</div>';
                } else {
                    messagesArea.innerHTML = messages.map(msg => \`
                        <div class="message \${msg.sender === currentUser ? 'sent' : 'received'}">
                            <div>
                                <div class="message-bubble">\${msg.text}</div>
                                <div class="message-time">\${formatTime(msg.timestamp)}</div>
                            </div>
                        </div>
                    \`).join('');
                    
                    if (wasAtBottom || oldScrollHeight === 0) {
                        messagesArea.scrollTop = messagesArea.scrollHeight;
                    }
                }
            }
        }
 
        async function handleSetup() {
            const input = document.getElementById('phoneInput');
            const phone = input.value.trim();
            if (!phone) {
                document.getElementById('setupError').textContent = 'Enter your phone number';
                return;
            }
            const result = await initUser(phone);
            if (result.error) {
                document.getElementById('setupError').textContent = result.error;
                return;
            }
            currentUser = phone;
            localStorage.setItem('user', phone);
            startSync();
            renderStructure();
        }
 
        async function handleAddContact() {
            const input = document.getElementById('contactInput');
            const contact = input.value.trim();
            if (!contact) return;
            if (contact === currentUser) {
                alert('Cannot add yourself');
                return;
            }
            await addContact(currentUser, contact);
            input.value = '';
            updateData();
        }
 
        function handleSelectChat(contact) {
            if (selectedChat === contact) return;
            selectedChat = contact;
            
            const mainArea = document.getElementById('mainArea');
            if (mainArea) {
                mainArea.innerHTML = \`
                    <div class="chat-header">
                        <div class="avatar" style="background: \${generateColor(selectedChat)};">
                            \${getInitials(selectedChat)}
                        </div>
                        <div class="chat-header-info">
                            <h2>\${selectedChat}</h2>
                            <p>Online</p>
                        </div>
                    </div>
                    <div class="messages-area" id="messagesArea"></div>
                    <div class="input-section">
                        <input type="text" id="messageInput" placeholder="Type a message..." />
                        <button onclick="handleSendMessage()">Send</button>
                    </div>
                \`;
                document.getElementById('messageInput')?.focus();
            }
            updateData();
        }
 
        async function handleSendMessage() {
            const input = document.getElementById('messageInput');
            if (!input) return;
            const text = input.value.trim();
            if (!text || !selectedChat) return;
 
            await sendMessage(currentUser, selectedChat, text);
            input.value = '';
            updateData();
        }
 
        document.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && e.target.id === 'messageInput') {
                handleSendMessage();
            }
        });
 
        function startSync() {
            if (refreshInterval) clearInterval(refreshInterval);
            refreshInterval = setInterval(updateData, 1500);
        }
 
        const saved = localStorage.getItem('user');
        if (saved) {
            currentUser = saved;
            startSync();
        }
 
        renderStructure();
    </script>
</body>
</html>`;
 
const server = http.createServer((req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
 
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Content-Type', 'application/json');
 
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
 
    if (pathname === '/api/init-user' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { phone } = JSON.parse(body);
                if (!phone) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Phone required' }));
                    return;
                }
                if (!users[phone]) {
                    users[phone] = { phone, contacts: [] };
                }
                res.writeHead(200);
                res.end(JSON.stringify({ success: true, phone }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid request' }));
            }
        });
        return;
    }
 
    if (pathname === '/api/add-contact' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { phone, contact } = JSON.parse(body);
                if (!phone || !contact) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Missing fields' }));
                    return;
                }
                if (!users[phone]) users[phone] = { phone, contacts: [] };
                if (!users[phone].contacts.includes(contact)) {
                    users[phone].contacts.push(contact);
                }
                res.writeHead(200);
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid request' }));
            }
        });
        return;
    }
 
    if (pathname.startsWith('/api/contacts/') && req.method === 'GET') {
        const phone = pathname.split('/')[3];
        const contacts = users[phone]?.contacts || [];
        res.writeHead(200);
        res.end(JSON.stringify({ contacts }));
        return;
    }
 
    if (pathname === '/api/send-message' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const { sender, receiver, text } = JSON.parse(body);
                if (!sender || !receiver || !text) {
                    res.writeHead(400);
                    res.end(JSON.stringify({ error: 'Missing fields' }));
                    return;
                }
                const chatId = [sender, receiver].sort().join('_');
                if (!chats[chatId]) chats[chatId] = [];
                chats[chatId].push({ sender, text, timestamp: Date.now() });
                res.writeHead(200);
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Invalid request' }));
            }
        });
        return;
    }
 
    if (pathname.startsWith('/api/messages/') && req.method === 'GET') {
        const parts = pathname.split('/');
        const user1 = parts[3];
        const user2 = parts[4];
        const chatId = [user1, user2].sort().join('_');
        const messages = chats[chatId] || [];
        res.writeHead(200);
        res.end(JSON.stringify({ messages }));
        return;
    }
 
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});
 
// Replace your old port setup with this:
// 1. Define the port using Render's environment variable, falling back to 3000 locally
// Define the port using Render's environment variable, falling back to 3000 locally
const PORT = process.env.PORT || 3000;

// Pass that PORT variable into your server's listen function
server.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running on port ${PORT}`);
});