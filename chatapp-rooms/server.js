require('dotenv').config();
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    console.error("❌ ERROR: MONGO_URI environment variable is missing!");
    process.exit(1);
}

const client = new MongoClient(mongoUri, { maxPoolSize: 15 });
let db, usersCollection, roomsCollection, messagesCollection, reportsCollection;

// ---------------------------------------------------------------------------
// Hardcoded real-world settings (no .env needed for these — just constants)
// ---------------------------------------------------------------------------
const RATE_LIMIT_WINDOW_MS = 60 * 1000;   // 1 minute window
const RATE_LIMIT_MAX_REQUESTS = 60;       // 60 requests per IP per window
const MAX_NAME_LEN = 50;
const MAX_ROOM_NAME_LEN = 50;
const MAX_MESSAGE_LEN = 2000;
const MAX_REPORT_LEN = 1000;

async function connectDB() {
    try {
        await client.connect();
        db = client.db('chat-app-db');
        usersCollection = db.collection('users');
        roomsCollection = db.collection('rooms');
        messagesCollection = db.collection('messages');
        reportsCollection = db.collection('reports');

        // Indexes — created once, MongoDB no-ops if they already exist
        await usersCollection.createIndex({ email: 1 }, { unique: true });
        await roomsCollection.createIndex({ roomId: 1 }, { unique: true });
        await roomsCollection.createIndex({ members: 1 });
        await messagesCollection.createIndex({ roomId: 1, timestamp: 1 });

        console.log("✅ Successfully connected to MongoDB Collections + indexes ready!");
    } catch (err) {
        console.error("❌ MongoDB connection failed:", err);
        process.exit(1);
    }
}

function generateRoomId() {
    return 'ROOM-' + Math.random().toString(36).substring(2, 11).toUpperCase();
}

function parseJSON(str) {
    try { return JSON.parse(str); } catch { return null; }
}

// Safely converts a string to a MongoDB ObjectId without crashing the server
function safelyGetObjectId(id) {
    try {
        return ObjectId.isValid(id) ? new ObjectId(id) : null;
    } catch (e) {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------
function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function isValidString(str, maxLen) {
    return typeof str === 'string' && str.trim().length > 0 && str.length <= maxLen;
}

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per IP)
// ---------------------------------------------------------------------------
const rateLimitMap = new Map();

function isRateLimited(ip) {
    const now = Date.now();
    const record = rateLimitMap.get(ip);
    if (!record || now - record.start > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(ip, { count: 1, start: now });
        return false;
    }
    record.count++;
    return record.count > RATE_LIMIT_MAX_REQUESTS;
}

// Periodically clear stale rate-limit entries so the Map doesn't grow forever
setInterval(() => {
    const now = Date.now();
    for (const [ip, record] of rateLimitMap.entries()) {
        if (now - record.start > RATE_LIMIT_WINDOW_MS) rateLimitMap.delete(ip);
    }
}, RATE_LIMIT_WINDOW_MS);

function sendJSON(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // Basic security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');

    if (req.method === 'OPTIONS') return res.writeHead(200).end();

    // Health check — used by Render to confirm the service is alive
    if (pathname === '/api/health' && req.method === 'GET') {
        return sendJSON(res, 200, { status: 'ok', uptime: process.uptime() });
    }

    // Rate limit all /api/* traffic
    if (pathname.startsWith('/api/')) {
        const ip = req.socket.remoteAddress || 'unknown';
        if (isRateLimited(ip)) {
            return sendJSON(res, 429, { error: 'Too many requests, slow down.' });
        }
    }

    if (pathname === '/' && req.method === 'GET') {
        try {
            const html = fs.readFileSync(path.join(__dirname, 'index.html'));
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.writeHead(200).end(html);
        } catch (err) {
            return res.writeHead(500).end("Error loading index.html");
        }
    }

    // Initialize User Profile Setup
    if (pathname === '/api/init-user' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON payload' });
            const { name, email, avatar, isPrivate } = data;

            if (!isValidString(name, MAX_NAME_LEN)) return sendJSON(res, 400, { error: 'Invalid name' });
            if (!isValidEmail(email)) return sendJSON(res, 400, { error: 'Invalid email' });

            let user = await usersCollection.findOne({ email });
            if (!user) {
                const defaultSettings = { theme: 'dark', notifications: true, soundEnabled: true };
                const result = await usersCollection.insertOne({
                    name, email, avatar: avatar || '', isPrivate: !!isPrivate,
                    settings: defaultSettings, createdAt: new Date()
                });
                user = { _id: result.insertedId, name, email, avatar, isPrivate, settings: defaultSettings };
            }
            sendJSON(res, 200, { success: true, user });
        });
        return;
    }

    // Real-Time Update Profile (Name, Avatar, Privacy)
    if (pathname === '/api/update-profile' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON payload' });
            const { email, name, avatar, isPrivate } = data;

            if (!isValidEmail(email)) return sendJSON(res, 400, { error: 'Invalid email' });
            if (!isValidString(name, MAX_NAME_LEN)) return sendJSON(res, 400, { error: 'Invalid name' });

            await usersCollection.updateOne({ email }, { $set: { name, avatar, isPrivate: !!isPrivate } });
            sendJSON(res, 200, { success: true });
        });
        return;
    }

    // Update user settings (theme, notifications, sound)
    if (pathname === '/api/update-settings' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON payload' });
            const { email, settings } = data;

            if (!isValidEmail(email)) return sendJSON(res, 400, { error: 'Invalid email' });
            if (!settings || typeof settings !== 'object') return sendJSON(res, 400, { error: 'Invalid settings' });

            const safeSettings = {
                theme: settings.theme === 'light' ? 'light' : 'dark',
                notifications: !!settings.notifications,
                soundEnabled: !!settings.soundEnabled
            };

            await usersCollection.updateOne({ email }, { $set: { settings: safeSettings } });
            sendJSON(res, 200, { success: true, settings: safeSettings });
        });
        return;
    }

    // Submit Direct Issue Report
    if (pathname === '/api/submit-report' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const reportData = parseJSON(body);
            if (!reportData) return sendJSON(res, 400, { error: 'Invalid JSON payload' });
            if (!isValidEmail(reportData.sender)) return sendJSON(res, 400, { error: 'Invalid sender' });
            if (!isValidString(reportData.details, MAX_REPORT_LEN)) return sendJSON(res, 400, { error: 'Invalid report details' });

            reportData.timestamp = new Date();
            await reportsCollection.insertOne(reportData);
            sendJSON(res, 200, { success: true });
        });
        return;
    }

    // Create Room with Invite permissions by default
    if (pathname === '/api/create-room' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON payload' });
            const { creator, roomName } = data;

            if (!isValidEmail(creator)) return sendJSON(res, 400, { error: 'Invalid creator email' });
            if (!isValidString(roomName, MAX_ROOM_NAME_LEN)) return sendJSON(res, 400, { error: 'Invalid room name' });

            const roomId = generateRoomId();
            await roomsCollection.insertOne({ roomId, roomName, creator, members: [creator], allowInvites: true, createdAt: new Date() });
            sendJSON(res, 200, { success: true, roomId });
        });
        return;
    }

    // Dynamic configuration modifier for invites
    if (pathname === '/api/room-allow-invites' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON payload' });
            const { roomId, allowInvites } = data;
            const objId = safelyGetObjectId(roomId);

            if (!objId) return sendJSON(res, 400, { error: 'Invalid Room Identification format' });

            await roomsCollection.updateOne({ _id: objId }, { $set: { allowInvites: !!allowInvites } });
            sendJSON(res, 200, { success: true });
        });
        return;
    }

    // Join Group validation logic checking restrictions
    if (pathname === '/api/join-room' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON payload' });
            const { email, roomId } = data;

            if (!isValidEmail(email)) return sendJSON(res, 400, { error: 'Invalid email' });
            if (!isValidString(roomId, 50)) return sendJSON(res, 400, { error: 'Invalid room ID' });

            const targetRoom = await roomsCollection.findOne({ roomId });
            if (!targetRoom) return sendJSON(res, 200, { error: 'Room does not exist' });
            if (!targetRoom.allowInvites && targetRoom.creator !== email) {
                return sendJSON(res, 200, { error: 'Room joins are currently locked by owner' });
            }
            await roomsCollection.updateOne({ roomId }, { $addToSet: { members: email } });
            sendJSON(res, 200, { success: true });
        });
        return;
    }

    // Permanent Group deletion endpoint
    if (pathname === '/api/delete-room' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON payload' });
            const { id, email } = data;
            const objId = safelyGetObjectId(id);

            if (!objId) return sendJSON(res, 400, { error: 'Invalid Room reference mapping' });
            if (!isValidEmail(email)) return sendJSON(res, 400, { error: 'Invalid email' });

            const room = await roomsCollection.findOne({ _id: objId });
            if (room && room.creator === email) {
                // Wipe history messages tied to this space ID as both raw text and mapped ObjectId values
                await messagesCollection.deleteMany({ $or: [{ roomId: id }, { roomId: objId }] });
                await roomsCollection.deleteOne({ _id: objId });
                sendJSON(res, 200, { success: true });
            } else {
                sendJSON(res, 403, { error: 'Unauthorized deletion request' });
            }
        });
        return;
    }

    if (pathname.startsWith('/api/rooms/') && req.method === 'GET') {
        const email = pathname.split('/')[3];
        if (!isValidEmail(email)) return sendJSON(res, 400, { error: 'Invalid email' });
        const rooms = await roomsCollection.find({ members: email }).toArray();
        return sendJSON(res, 200, { rooms });
    }

    if (pathname === '/api/send-message' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON payload' });
            const { roomId, sender, senderName, text } = data;

            if (!isValidString(roomId, 50)) return sendJSON(res, 400, { error: 'Invalid roomId' });
            if (!isValidEmail(sender)) return sendJSON(res, 400, { error: 'Invalid sender' });
            if (!isValidString(senderName, MAX_NAME_LEN)) return sendJSON(res, 400, { error: 'Invalid senderName' });
            if (!isValidString(text, MAX_MESSAGE_LEN)) return sendJSON(res, 400, { error: 'Invalid message text' });

            await messagesCollection.insertOne({ roomId, sender, senderName, text, timestamp: Date.now() });
            sendJSON(res, 200, { success: true });
        });
        return;
    }

    if (pathname.startsWith('/api/messages/') && req.method === 'GET') {
        const roomId = pathname.split('/')[3];
        const objId = safelyGetObjectId(roomId);

        // Find messages where the roomId matches either the string format or the ObjectId format
        const messages = await messagesCollection.find({
            $or: [{ roomId: roomId }, { roomId: objId }]
        }).sort({ timestamp: 1 }).toArray();

        return sendJSON(res, 200, { messages });
    }

    sendJSON(res, 404, { error: 'Not found' });
});

const PORT = process.env.PORT || 3000;
startServer();

async function startServer() {
    await connectDB();
    server.listen(PORT, '0.0.0.0', () => console.log(`✅ ChatApp running on port ${PORT}`));
}