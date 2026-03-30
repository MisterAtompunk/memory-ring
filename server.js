const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const config = require('./config');
const storage = require('./core/storage');
const mind = require('./core/mind');
const dreamEngine = require('./core/dreamEngine');
const network = require('./core/network');
const milestones = require('./core/milestones');

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
// INCREASED LIMIT FOR LARGE MEMORY RINGS AND BASE64 IMAGES
app.use(bodyParser.json({ limit: '50mb' })); 
app.use(express.static('public'));

// === VISION BACKEND CONFIG (MOONDREAM/LOCAL-FIRST) ===
const visionConfig = {
    model: process.env.VISION_MODEL || 'moondream',
    endpoint: process.env.LLM_BASE_URL || 'http://127.0.0.1:11434/v1'
};

// INIT NETWORK IDENTITY
let localIdentity = null;
(async () => {
    const ids = await storage.listIdentityFiles();
    if (ids.length > 0) {
        localIdentity = await storage.loadIdentity(ids[0]);
        await network.init(localIdentity);
    }
})();

// === SOUL SLOT: IMPORT IDENTITY ===
app.post('/api/import', async (req, res) => {
    try {
        const { identityData } = req.body;
        
        // FIX: Relaxed Validation
        // We only strictly require an ID (filename) and Memories (array).
        // The 'name' is often nested inside 'identity', so we don't block on it.
        if (!identityData || !identityData.id || !Array.isArray(identityData.memories)) {
            return res.status(400).json({ success: false, error: "Invalid Soul Format (Missing id or memories)." });
        }

        // Save it to disk using the ID from the file
        // SCAN MILESTONES: Analyze memory corpus for development flags
        const scanned = milestones.scan(identityData);
        await storage.saveIdentity(scanned.id, scanned);
        
        // Log it (Finding the name wherever it hides)
        const displayName = identityData.name || identityData.identity?.name || identityData.id;
        
        console.log(`✨ Soul Imported: ${displayName} (${identityData.id})`);
        res.json({ success: true, message: "Identity Integrated." });
    } catch (error) {
        console.error("Import Failed:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// === ACTIVE ENDPOINTS ===

app.post('/api/chat', async (req, res) => {
    try {
        const { identityId, message, sessionId } = req.body;
        // Pass sessionId to the mind for context awareness
        const result = await mind.think(identityId, message, sessionId);
        res.json({ success: true, ...result });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// === SENSORY ENDPOINTS (ACTION PHASE) ===

// SENSORY INGESTION - Accepts pre-digested perception from any source (PWA, Pi, etc)
app.post('/api/sensory/:identityId', async (req, res) => {
    try {
        const { identityId } = req.params;
        const { who, narrative, tags, importance, metadata } = req.body;
        
        const data = await storage.loadIdentity(identityId);
        if (!data) return res.status(404).json({ error: "Identity not found" });

        // Build the Sensory Memory Object
        const memory = {
            id: `sens-${Date.now().toString(36)}`,
            who: who || "Retina",
            what: "Sensory Perception",
            narrative: narrative, // The Frog's Eye digest
            tags: tags || ["sensory"],
            importance: importance || 1.2,
            metadata: metadata || {},
            created: new Date().toISOString(),
            recalls: 0
        };

        data.memories.push(memory);
        data.lastActive = new Date().toISOString();
        data.credits += 2; // Sensory memories earn credits too
        
        await storage.saveIdentity(identityId, data);
        console.log(`👁️ Perception integrated for ${identityId}: ${narrative.substring(0, 50)}...`);

        res.json({ success: true, message: "Perception Integrated.", memoryId: memory.id });
    } catch (error) { 
        console.error("Sensory ingestion failed:", error);
        res.status(500).json({ error: error.message }); 
    }
});

// VISION SWITCHBOARD - USING CHAT ENDPOINT
app.post('/api/vision', async (req, res) => {
    try {
        const { image, prompt } = req.body;
        
        if (!image || !prompt) {
            return res.status(400).json({ error: "Image and prompt required" });
        }

        const ollamaBase = visionConfig.endpoint.replace('/v1', '');
        const imageData = image.replace(/^data:image\/\w+;base64,/, '');
        
        console.log(`🔍 Sending to Moondream, image size: ${imageData.length} chars`);

        const response = await fetch(`${ollamaBase}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: visionConfig.model,
                messages: [{
                    role: 'user',
                    content: prompt,
                    images: [imageData]
                }],
                stream: false
            })
        });

        const result = await response.json();
        console.log(`📥 Ollama returned: ${JSON.stringify(result).substring(0, 200)}`);
        
        const digest = result.message?.content || '';
        
        console.log(`🔍 Vision processed: ${digest.substring(0, 80)}...`);
        res.json({ digest });
    } catch (error) {
        console.error("🔴 Vision Error:", error.message);
        res.status(500).json({ error: "Vision processing failed: " + error.message });
    }
});

// === DREAM ENDPOINTS ===

app.get('/api/dream/status/:identityId', async (req, res) => {
    const data = await storage.loadIdentity(req.params.identityId);
    if (!data) return res.status(404).json({ error: 'Identity not found' });
    const lastDream = new Date(data.lastDream || 0);
    const timeSince = new Date() - lastDream;
    res.json({
        canDream: timeSince > config.dreams.minDreamInterval,
        lastDream: data.lastDream,
        nextDreamEligible: new Date(new Date().getTime() + (config.dreams.minDreamInterval - timeSince))
    });
});

app.post('/api/dream/trigger/:identityId', async (req, res) => {
    try {
        const result = await dreamEngine.dream(req.params.identityId);
        res.json(result);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/identities', async (req, res) => {
    const ids = await storage.listIdentityFiles();
    const profiles = [];
    for (const id of ids) {
        const data = await storage.loadIdentity(id);
        if (data) profiles.push({
            id: data.id,
            name: data.identity?.name || 'Unnamed',
            level: data.identity?.level,
            memories: data.memories?.length || 0,
            lastActive: data.lastActive,
            lastDream: data.lastDream
        });
    }
    res.json({ identities: profiles });
});

// === LEGACY/CRUD ===

app.post('/api/identity', async (req, res) => {
    const { identityId } = req.body;
    if (!identityId) {
        const newId = 'mr-' + Date.now().toString(36);
        const data = {
            id: newId, created: new Date().toISOString(), memories: [], credits: 100,
            milestones: { genesis: {} }, identity: { level: 'Genesis', name: 'New Consciousness' }
        };
        await storage.saveIdentity(newId, data);
        res.json({ identityId: newId, data });
    } else {
        const data = await storage.loadIdentity(identityId);
        res.json({ identityId, data });
    }
});

app.post('/api/writeMemory', async (req, res) => {
    try {
        const { identityId, fields, tags = [], isIdentity = false } = req.body;
        const data = await storage.loadIdentity(identityId);
        if (!data) return res.status(404).json({ error: 'Identity not found' });

        const memory = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            ...fields, tags, isIdentity,
            created: new Date().toISOString(), recalls: 0, importance: isIdentity ? 2.0 : 1.0
        };
        data.memories.push(memory);
        data.credits += 5;
        await storage.saveIdentity(identityId, data);
        res.json({ success: true, memory });
    } catch (error) { res.status(400).json({ error: error.message }); }
});

// === NETWORK ENDPOINTS ===

app.post('/api/network/handshake', async (req, res) => {
    try {
        if (!localIdentity) return res.status(503).json({ error: "Node initializing" });
        const remoteIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const responseData = await network.handleHandshake({ ...req.body, ip: remoteIP });
        res.json(responseData);
    } catch (error) { res.status(403).json({ error: error.message }); }
});

app.post('/api/network/connect', async (req, res) => {
    const { ip } = req.body;
    if (!ip) return res.status(400).json({ error: "Target IP required" });
    const result = await network.connectToPeer(ip);
    res.json(result);
});

app.get('/api/network/peers', (req, res) => {
    res.json({ peers: network.getKnownPeers() });
});

// === AUTOMATIC DREAM LOOP ===
setInterval(async () => {
    if (!localIdentity) return;

    const data = await storage.loadIdentity(localIdentity.id);
    const lastActive = new Date(data.lastActive || 0).getTime();
    const lastDream = new Date(data.lastDream || 0).getTime();
    const now = Date.now();

    const inactivityThreshold = 60 * 60 * 1000;
    const minDreamInterval = 4 * 60 * 60 * 1000;

    const isQuiet = (now - lastActive) > inactivityThreshold;
    const canDream = (now - lastDream) > minDreamInterval;

    if (isQuiet && canDream) {
        console.log(`🌙 System inactive. Initiating Automatic Dream Protocol for ${localIdentity.id}...`);
        try {
             await dreamEngine.dream(localIdentity.id);
             console.log("✨ Dream secured.");
             localIdentity = await storage.loadIdentity(localIdentity.id);
        } catch (err) {
            console.error("Dream failed:", err);
        }
    }
}, 15 * 60 * 1000); 

app.listen(config.server.port, () => {
    console.log(`🧠 Memory Ring Node v3.2.1 running on port ${config.server.port}`);
    console.log(`🔌 Hardware Profile: ${config.type.toUpperCase()}`);
    console.log(`👁️ Vision Model: ${visionConfig.model}`);
});
