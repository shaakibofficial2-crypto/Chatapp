const dns = require('node:dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
require('dotenv').config();
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { MongoClient, ObjectId } = require('mongodb');

const mongoUri = "mongodb+srv://shaaqibofficial_db_user:ShakibPass2026@cluster0.c2gzhsw.mongodb.net/?appName=Cluster0";
if (!mongoUri) {
    console.error("❌ ERROR: MONGO_URI environment variable is missing!");
    process.exit(1);
}

const client = new MongoClient(mongoUri, { maxPoolSize: 15 });
let db, usersCollection, roomsCollection, messagesCollection, reportsCollection;

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;
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

function safelyGetObjectId(id) {
    try { return ObjectId.isValid(id) ? new ObjectId(id) : null; } 
    catch (e) { return null; }
}

function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function isValidString(str, maxLen) {
    return typeof str === 'string' && str.trim().length > 0 && str.length <= maxLen;
}

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
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');

    if (req.method === 'OPTIONS') return res.writeHead(200).end();

    if (pathname === '/favicon.ico') {
        res.writeHead(204); 
        return res.end();
    }

    if (pathname === '/api/health' && req.method === 'GET') {
        return sendJSON(res, 200, { status: 'ok', uptime: process.uptime() });
    }

    if (pathname.startsWith('/api/')) {
        const ip = req.socket.remoteAddress || 'unknown';
        if (isRateLimited(ip)) return sendJSON(res, 429, { error: 'Too many requests, slow down.' });
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

    /* Secure Google Authentication Endpoint */
    if (pathname === '/api/auth/google' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data || !data.token) return sendJSON(res, 400, { error: 'Missing token data' });

            try {
                const googleVerifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${data.token}`;
                
                https.get(googleVerifyUrl, (googleRes) => {
                    let rawData = '';
                    googleRes.on('data', (chunk) => rawData += chunk);
                    googleRes.on('end', async () => {
                        const payload = parseJSON(rawData);
                        
                        if (!payload || payload.error_description) {
                            return sendJSON(res, 401, { error: 'Invalid Google Identity token' });
                        }

                        const expectedClientId = "157699985261-179mbdt1jlpv4qm85vtkrmkg37mdiie3.apps.googleusercontent.com";
                        if (payload.aud !== expectedClientId) {
                            return sendJSON(res, 401, { error: 'Audience mismatch authentication failed' });
                        }

                        const email = payload.email;
                        const name = payload.name;
                        const avatar = payload.picture || '';

                        let user = await usersCollection.findOne({ email });
                        if (!user) {
                            const defaultSettings = { theme: 'dark', notifications: true, soundEnabled: true };
                            const result = await usersCollection.insertOne({
                                name, email, avatar, isPrivate: false,
                                settings: defaultSettings, createdAt: new Date()
                            });
                            user = { _id: result.insertedId, name, email, avatar, isPrivate: false, settings: defaultSettings };
                        }

                        sendJSON(res, 200, { success: true, user });
                    });
                }).on('error', (e) => {
                    sendJSON(res, 500, { error: 'Google gateway verification system timeout' });
                });

            } catch (err) {
                sendJSON(res, 500, { error: 'Internal Auth execution exception error' });
            }
        });
        return;
    }

    if (pathname === '/api/update-profile' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON' });
            const { email, name, avatar, isPrivate } = data;
            if (!isValidEmail(email)) return sendJSON(res, 400, { error: 'Invalid email' });
            await usersCollection.updateOne({ email }, { $set: { name, avatar, isPrivate: !!isPrivate } });
            sendJSON(res, 200, { success: true });
        });
        return;
    }

    if (pathname === '/api/update-settings' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON payload' });
            const { email, settings } = data;
            if (!isValidEmail(email)) return sendJSON(res, 400, { error: 'Invalid email' });
            
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

    if (pathname === '/api/submit-report' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON payload' });
            data.timestamp = new Date();
            await reportsCollection.insertOne(data);
            sendJSON(res, 200, { success: true });
        });
        return;
    }

    if (pathname === '/api/create-room' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON payload' });
            const roomId = generateRoomId();
            await roomsCollection.insertOne({ roomId, roomName: data.roomName, creator: data.creator, members: [data.creator], allowInvites: true, createdAt: new Date() });
            sendJSON(res, 200, { success: true, roomId });
        });
        return;
    }

    if (pathname === '/api/room-allow-invites' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON' });
            const objId = safelyGetObjectId(data.roomId);
            await roomsCollection.updateOne({ _id: objId }, { $set: { allowInvites: !!data.allowInvites } });
            sendJSON(res, 200, { success: true });
        });
        return;
    }

    if (pathname === '/api/join-room' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON payload' });
            const targetRoom = await roomsCollection.findOne({ roomId: data.roomId });
            if (!targetRoom) return sendJSON(res, 200, { error: 'Room does not exist' });
            await roomsCollection.updateOne({ roomId: data.roomId }, { $addToSet: { members: data.email } });
            sendJSON(res, 200, { success: true });
        });
        return;
    }

    if (pathname === '/api/delete-room' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON' });
            const objId = safelyGetObjectId(data.id);
            const room = await roomsCollection.findOne({ _id: objId });
            if (room && room.creator === data.email) {
                await messagesCollection.deleteMany({ $or: [{ roomId: data.id }, { roomId: objId }] });
                await roomsCollection.deleteOne({ _id: objId });
                sendJSON(res, 200, { success: true });
            } else {
                sendJSON(res, 403, { error: 'Unauthorized' });
            }
        });
        return;
    }

    if (pathname.startsWith('/api/rooms/') && req.method === 'GET') {
        const email = pathname.split('/')[3];
        const rooms = await roomsCollection.find({ members: email }).toArray();
        return sendJSON(res, 200, { rooms });
    }

    if (pathname === '/api/send-message' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            if (!data) return sendJSON(res, 400, { error: 'Invalid JSON' });
            await messagesCollection.insertOne({ roomId: data.roomId, sender: data.sender, senderName: data.senderName, text: data.text, timestamp: Date.now() });
            sendJSON(res, 200, { success: true });
        });
        return;
    }

    if (pathname.startsWith('/api/messages/') && req.method === 'GET') {
        const roomId = pathname.split('/')[3];
        const objId = safelyGetObjectId(roomId);
        const messages = await messagesCollection.find({ $or: [{ roomId: roomId }, { roomId: objId }] }).sort({ timestamp: 1 }).toArray();
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