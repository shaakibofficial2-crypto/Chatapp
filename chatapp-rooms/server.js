require('dotenv').config();
const http = require('http');
const url = require('url');
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const mongoUri = process.env.MONGO_URI;
if (!mongoUri) {
    console.error("❌ ERROR: MONGO_URI environment variable is missing!");
    process.exit(1);
}

const client = new MongoClient(mongoUri);
let db, usersCollection, roomsCollection, messagesCollection;

async function connectDB() {
    try {
        await client.connect();
        db = client.db('chat-app-db');
        usersCollection = db.collection('users');
        roomsCollection = db.collection('rooms');
        messagesCollection = db.collection('messages');
        console.log("✅ Successfully connected to MongoDB!");
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

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;
    
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') return res.writeHead(200).end();
    
    // Serve the clean HTML file!
    if (pathname === '/' && req.method === 'GET') {
        try {
            const html = fs.readFileSync(path.join(__dirname, 'index.html'));
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.writeHead(200).end(html);
        } catch (err) {
            return res.writeHead(500).end("Error loading index.html");
        }
    }
    
    if (pathname === '/api/init-user' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const { name, email, phone } = parseJSON(body);
            let user = await usersCollection.findOne({ email });
            if (!user) {
                const result = await usersCollection.insertOne({ name, email, phone, createdAt: new Date() });
                user = { _id: result.insertedId, name, email, phone };
            }
            res.writeHead(200).end(JSON.stringify({ success: true, user }));
        });
        return;
    }
    
    if (pathname === '/api/create-room' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const { creator, roomName } = parseJSON(body);
            const roomId = generateRoomId();
            const result = await roomsCollection.insertOne({ roomId, roomName, creator, members: [creator], createdAt: new Date() });
            res.writeHead(200).end(JSON.stringify({ success: true, roomId }));
        });
        return;
    }
    
    if (pathname === '/api/join-room' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const { email, roomId } = parseJSON(body);
            await roomsCollection.updateOne({ roomId }, { $addToSet: { members: email } });
            res.writeHead(200).end(JSON.stringify({ success: true }));
        });
        return;
    }
    
    if (pathname.startsWith('/api/rooms/') && req.method === 'GET') {
        const email = pathname.split('/')[3];
        const rooms = await roomsCollection.find({ members: email }).toArray();
        return res.writeHead(200).end(JSON.stringify({ rooms }));
    }
    
    if (pathname === '/api/send-message' && req.method === 'POST') {
        let body = ''; req.on('data', c => body += c);
        req.on('end', async () => {
            const data = parseJSON(body);
            data.timestamp = Date.now();
            await messagesCollection.insertOne(data);
            res.writeHead(200).end(JSON.stringify({ success: true }));
        });
        return;
    }
    
    if (pathname.startsWith('/api/messages/') && req.method === 'GET') {
        const roomId = pathname.split('/')[3];
        const messages = await messagesCollection.find({ roomId }).sort({ timestamp: 1 }).toArray();
        return res.writeHead(200).end(JSON.stringify({ messages }));
    }
    
    res.writeHead(404).end(JSON.stringify({ error: 'Not found' }));
});

const PORT = process.env.PORT || 3000;
startServer();

async function startServer() {
    await connectDB();
    server.listen(PORT, '0.0.0.0', () => console.log(`✅ ChatApp running on port ${PORT}`));
}