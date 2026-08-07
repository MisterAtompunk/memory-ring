const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('./config');
const storage = require('./core/storage');
const { SensoryBus } = require('./core/sensoryBus');
const sampling = require('./core/sampling');
const { QUERIES, resolve: resolveSubject } = require('./core/queries');
const sensoryBus = new SensoryBus();
const mind = require('./core/mind');
const dreamEngine = require('./core/dreamEngine');
const network = require('./core/network');
const milestones = require('./core/milestones');
const tools = require('./core/tools');
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
// === PAYLOAD LIMITS (Route-Specific) ===
// Default limit for chat and normal operations
app.use(express.json({ limit: '10mb' }));
// Heavy parser for import and vision routes only
const heavyParser = express.json({ limit: '50mb' });
app.use(express.static('public'));
// === RATE LIMITING ===
const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute window
    max: 30, // 30 requests per minute per IP
    message: { error: "Thermodynamic limit reached. The entity requires a moment to process." }
});
app.use('/api/', apiLimiter);
// === API KEY AUTHENTICATION ===
// Optional. If MR_API_KEY is set in .env, all /api routes require it.
// If not set, the system runs open with a console warning.
const requireAuth = (req, res, next) => {
    if (!process.env.MR_API_KEY) {
        return next(); // No key configured — open access
    }
    const clientKey = req.headers['x-api-key'];
    if (clientKey !== process.env.MR_API_KEY) {
        return res.status(401).json({ error: "Unauthorized. The vessel rejects the connection." });
    }
    next();
};
app.use('/api', requireAuth);
// === VISION BACKEND CONFIG ===
const visionConfig = {
    model: process.env.VISION_MODEL || 'llava',
    endpoint: process.env.LLM_BASE_URL || 'http://127.0.0.1:11434/v1'
};
// === VISION CONFIG ENDPOINT (for adaptive retina) ===
// The front end reads the version from here rather than embedding it. Nothing
// in public/ should contain a version literal.
app.get('/api/version', (req, res) => {
    res.json({ version: config.version, codename: config.codename });
});

app.get('/api/config/vision', requireAuth, (req, res) => {
    res.json({ model: visionConfig.model });
});
// === MULTIMODAL CONFIG ENDPOINTS ===
app.get('/api/config/ears', requireAuth, (req, res) => {
    const available = !!(process.env.WHISPER_PATH && process.env.WHISPER_MODEL);
    res.json({ available, model: available ? path.basename(process.env.WHISPER_MODEL, '.bin') : null });
});
app.get('/api/config/voices', requireAuth, (req, res) => {
    const available = !!(process.env.PIPER_PATH && process.env.PIPER_VOICE);
    res.json({ available, defaultVoice: available ? path.basename(process.env.PIPER_VOICE, '.onnx') : null });
});
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
app.post('/api/import', heavyParser, async (req, res) => {
    try {
        const { identityData } = req.body;
        
        // Relaxed Validation
        // We only strictly require an ID (filename) and Memories (array).
        // The 'name' is often nested inside 'identity', so we don't block on it.
        if (!identityData || !identityData.id || !Array.isArray(identityData.memories)) {
            return res.status(400).json({ success: false, error: "Invalid Soul Format (Missing id or memories)." });
        }
        // SCAN MILESTONES: Analyze memory corpus for development flags
        const scanned = milestones.scan(identityData);
        await storage.saveIdentity(scanned.id, scanned);
        
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
        const result = await mind.think(identityId, message, sessionId);
        res.json({ success: true, ...result });
    } catch (error) { res.status(500).json({ error: error.message }); }
});
// === SENSORY ENDPOINTS ===
// SENSORY INGESTION - Accepts pre-digested perception from any source (PWA, Pi, etc)
app.post('/api/sensory/:identityId', async (req, res) => {
    try {
        const { identityId } = req.params;
        const { who, narrative, tags, importance, metadata, channel,
                kind, query, result, instrument, askLagMs } = req.body;
        
        const data = await storage.loadIdentity(identityId);
        if (!data) return res.status(404).json({ error: "Identity not found" });

        // --- CROSS-MODAL FUSION ---
        // Sensors post independently; only the server sees all of them. Ask the
        // bus how much corroboration this perception has, and let that set
        // importance instead of a flat 1.2.
        const memId = `sens-${Date.now().toString(36)}`;
        const fusion = sensoryBus.admit(identityId, {
            channel: channel || (metadata && metadata.channel) || 'vision',
            at: (metadata && metadata.timestamp) || null,
            memoryId: memId,
            trigger: metadata && metadata.trigger
        });

        const memory = {
            id: memId,
            who: who || "Retina",
            // A measurement and a perception are different kinds of thing. The
            // ring could not tell them apart, which is how a bare "4" came back
            // as something to narrate around.
            what: kind === 'measurement' ? "Foveal Measurement" : "Sensory Perception",
            kind: kind || 'perception',
            ...(kind === 'measurement' ? {
                query, result, instrument: instrument || 'foveal retina',
                // Staleness of the frame this measurement was taken from.
                ...(askLagMs != null ? { askLagMs } : {})
            } : {}),
            narrative: narrative,
            when: new Date().toISOString().slice(0, 10),
            tags: [...new Set([...(tags || ["sensory"]),
                    fusion.coincidence >= 2 ? 'corroborated' : 'uncorroborated'])],
            channel: fusion.channel,
            // Explicit `importance` in the request still wins, so a caller can
            // override. Otherwise the coincidence count decides.
            importance: importance !== undefined && importance !== 1.2
                        ? importance : fusion.importance,
            fusion: {
                coincidence: fusion.coincidence,
                agreedWith: fusion.agreedWith,
                confidence: fusion.confidence,
                isEvidence: fusion.isEvidence
            },
            metadata: metadata || {},
            created: new Date().toISOString(),
            recalls: 0
        };
        data.memories.push(memory);

        // Raise earlier perceptions that this one just corroborated. The first
        // channel to report an event could not know it would be confirmed.
        for (const p of (fusion.promote || [])) {
            const prior = data.memories.find(m => m.id === p.memoryId);
            if (!prior) continue;
            prior.importance = Math.max(prior.importance || 0, p.importance);
            prior.fusion = { coincidence: p.coincidence, agreedWith: p.agreedWith,
                             confidence: p.confidence, isEvidence: true,
                             promotedBy: fusion.channel };
            prior.tags = [...new Set([...(prior.tags || []).filter(x => x !== 'uncorroborated'),
                                      'corroborated'])];
        }

        data.lastActive = new Date().toISOString();
        data.credits += 2;
        
        await storage.saveIdentity(identityId, data);
        if (kind === 'measurement' && askLagMs != null) {
            const warn = askLagMs > 3000 ? ' \u26a0 STALE — the pose may have ended' : '';
            console.log(`\u23f1 SHUTTER: frame exposed ${askLagMs}ms after the question`
                + ` was asked${warn}`);
        }
        const mark = fusion.coincidence >= 3 ? '###' : fusion.coincidence >= 2 ? '##' : '#';
        console.log(`👁️ [${fusion.channel}] ${mark} x${fusion.coincidence}`
            + `${fusion.agreedWith.length ? ' with ' + fusion.agreedWith.join(',') : ''}`
            + ` imp=${memory.importance} :: ${narrative.substring(0, 44)}...`);
        res.json({ success: true, message: "Perception Integrated.",
                   memoryId: memory.id, fusion });
    } catch (error) { 
        console.error("Sensory ingestion failed:", error);
        res.status(500).json({ error: error.message }); 
    }
});
// VISION SWITCHBOARD
app.post('/api/vision', heavyParser, async (req, res) => {
    try {
        const { image, images, prompt, samples, subject } = req.body;
        
        if ((!image && !images) || !prompt) {
            return res.status(400).json({ error: "Image and prompt required" });
        }

        // --- SUBJECT RESOLVES TO A FIXED QUERY, SERVER-SIDE ---
        // The entity now emits [FOCUS: object] rather than composing a query.
        // Resolving here keeps one source of truth: the client never holds a
        // copy of the query text, so the two cannot drift.
        //
        // A full query string still works. If the entity writes a literal
        // instruction — or an older client sends one — it passes through
        // unchanged rather than failing.
        // Measured failure: the client prefixes the query, so [FOCUS: wall]
        // arrived as "Look at this image and answer: wall" and the lookup
        // never matched. moondream was then asked to describe a wall by a
        // prompt ending in the bare word "wall", and returned a refrigerator.
        //
        // Strip any leading instruction wrapper before testing. Only a SINGLE
        // remaining word may resolve — so a literal query that happens to
        // contain "object" is still passed through untouched.
        let effectivePrompt = prompt;

        // A SUBJECT FIELD is authoritative. It cannot be mangled by a caller
        // editing the prompt string, which is exactly how "[FOCUS: wall]"
        // became "Look at this image and answer: wall" and resolved to nothing.
        const resolved = subject ? resolveSubject(subject) : null;
        if (resolved) {
            effectivePrompt = resolved.query;
            console.log(`🎯 subject field "${subject}"`
                + (resolved.aliased ? ` -> alias for "${resolved.subject}"` : '')
                + ` -> fixed query`);
        } else if (subject) {
            // A subject was sent and is not in the library. Say so loudly: the
            // alternative is falling through to a literal query, which the
            // model will answer with SOMETHING, and the fault stays invisible.
            console.log(`🎯 \u26a0 UNKNOWN SUBJECT "${subject}" — not in the query `
                + `library. Add it to core/queries.js or the entity cannot ask this.`);
        }

        // Legacy path: subject embedded in the prompt string.
        const stripped = String(prompt)
            .replace(/^\s*(?:look at (?:this|the) image and answer\s*:?|examine this image\s*:?|question\s*:?)\s*/i, '')
            .trim();
        const subjectKey = /^[a-z]+$/i.test(stripped) ? stripped.toLowerCase() : null;
        const legacy = (!subject && subjectKey) ? resolveSubject(subjectKey) : null;
        if (legacy) {
            effectivePrompt = legacy.query;
            console.log(`🎯 subject "${subjectKey}"`
                + (legacy.aliased ? ` -> alias for "${legacy.subject}"` : '')
                + ` -> fixed query`);
        } else if (!subject && stripped !== String(prompt).trim()) {
            // Wrapper stripped, no subject matched: pass the inner text on.
            // Guarded on !subject — without it this branch overwrote a query
            // the subject field had already resolved correctly.
            effectivePrompt = stripped;
        }
        const ollamaBase = visionConfig.endpoint.replace('/v1', '');

        // --- AGREEMENT AT THE INSTRUMENT ---
        // The retina pools across photoreceptors and across saccades BEFORE
        // anything reaches cortex. Reliability is computed in the sense organ;
        // what ships upward is a measurement carrying its own confidence.
        //
        // Frames may differ (scene stability) or be the same image sampled
        // repeatedly (model uncertainty). Both are real signal. One sample is
        // the old behaviour and remains the default, because peripheral
        // awareness fires constantly and tripling it is waste — you do not
        // saccade to verify ambient awareness, only to resolve a question.
        const frames = (Array.isArray(images) && images.length ? images : [image])
            .map(i => String(i).replace(/^data:image\/\w+;base64,/, ''));
        const n = Math.max(1, Math.min(5, parseInt(samples) || frames.length));

        const askOnce = async (imageData) => {
            const response = await fetch(`${ollamaBase}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: visionConfig.model,
                    messages: [{ role: 'user', content: effectivePrompt, images: [imageData] }],
                    stream: false
                })
            });
            const result = await response.json();
            return result.message?.content || '';
        };

        // Log the QUERY, not just the size. The focus query is composed by the
        // entity and handed to a small vision model, and a florid query
        // measurably degrades what comes back — but it was never visible.
        const shortPrompt = String(effectivePrompt).replace(/\s+/g, ' ').slice(0, 90);
        console.log(`🔍 Vision request, ${frames.length} frame(s), ${n} sample(s), `
            + `${frames[0].length} chars\n   ask: "${shortPrompt}"`);

        const raws = [];
        for (let i = 0; i < n; i++) {
            raws.push(await askOnce(frames[i % frames.length]));
        }

        if (n === 1) {
            const digest = raws[0];
            // An empty return is a FAILED measurement and was silent — it
            // printed as "Vision processed: ..." exactly like a success.
            if (!digest.trim()) {
                console.log(`🔍 \u26a0 VISION RETURNED NOTHING for: "${shortPrompt}"`);
                console.log(`   the camera describes; open questions ("what is...", `
                    + `"where is...") tend to return empty. Prefer "Describe X."`);
            } else {
                console.log(`🔍 Vision processed: ${digest.substring(0, 80)}...`);
            }
            return res.json({ digest });
        }

        const v = sampling.vote(raws, effectivePrompt);
        // A failed measurement reports as one. Three samples giving "1", "4"
        // and "urn" is not a value to choose between.
        const digest = v.reliable ? (v.raw || v.value) : '';
        const mark = v.reliable ? '\u2713' : '\u2717';
        console.log(`🔍 Vision ${mark} ${v.agreement}/${v.samples} [${v.type}] `
            + `${v.reliable ? JSON.stringify(v.value) : v.reason}`
            + (v.distinct.length > 1 ? `  saw: ${v.distinct.map(d=>JSON.stringify(d)).join(' ')}` : ''));

        res.json({
            digest,
            agreement: {
                value: v.value, k: v.agreement, n: v.samples,
                ratio: v.ratio, reliable: v.reliable,
                reason: v.reason, distinct: v.distinct
            }
        });
    } catch (error) {
        console.error("🔴 Vision Error:", error.message);
        res.status(500).json({ error: "Vision processing failed: " + error.message });
    }
});
// === THE EARS (whisper.cpp — Speech-to-Text) ===
app.post('/api/transcribe', heavyParser, async (req, res) => {
    try {
        if (!process.env.WHISPER_PATH || !process.env.WHISPER_MODEL) {
            return res.status(501).json({ error: "Ears not configured. Set WHISPER_PATH and WHISPER_MODEL in .env" });
        }
        const { audio } = req.body;
        if (!audio) return res.status(400).json({ error: "Audio data required" });
        // Decode base64 audio to temp WAV file
        const audioBuffer = Buffer.from(audio, 'base64');
        const tempFile = path.join(os.tmpdir(), `mr-audio-${Date.now()}.wav`);
        fs.writeFileSync(tempFile, audioBuffer);
        console.log(`👂 Transcription request, audio size: ${audioBuffer.length} bytes`);
        // Shell out to whisper-cli
        const result = await new Promise((resolve, reject) => {
            execFile(process.env.WHISPER_PATH, [
                '-m', process.env.WHISPER_MODEL,
                '-f', tempFile,
                '--no-timestamps',
                '--no-prints',
                '-t', '4'
            ], { timeout: 30000 }, (error, stdout, stderr) => {
                // Clean up temp file
                try { fs.unlinkSync(tempFile); } catch (e) {}
                if (error) return reject(error);
                resolve(stdout.trim());
            });
        });
        console.log(`👂 Transcribed: ${result.substring(0, 60)}...`);
        res.json({ transcript: result });
    } catch (error) {
        console.error("🔴 Transcription Error:", error.message);
        res.status(500).json({ error: "Transcription failed: " + error.message });
    }
});
// === THE VOICE (Piper TTS — Text-to-Speech) ===
app.post('/api/speak', async (req, res) => {
    try {
        if (!process.env.PIPER_PATH) {
            return res.status(501).json({ error: "Voice not configured. Set PIPER_PATH and PIPER_VOICE in .env" });
        }
        const { text, identity } = req.body;
        if (!text) return res.status(400).json({ error: "Text required" });
        // Check for entity-specific voice, fall back to default
        const voiceKey = `PIPER_VOICE_${identity}`;
        const voicePath = process.env[voiceKey] || process.env.PIPER_VOICE;
        if (!voicePath) return res.status(501).json({ error: "No voice model configured" });
        const tempFile = path.join(os.tmpdir(), `mr-speech-${Date.now()}.wav`);
        console.log(`🗣️ Speech request: "${text.substring(0, 40)}..." voice: ${path.basename(voicePath)}`);
        // Shell out to Piper
        await new Promise((resolve, reject) => {
            const piper = execFile(process.env.PIPER_PATH, [
                '--model', voicePath,
                '--output_file', tempFile
            ], { timeout: 30000 }, (error) => {
                if (error) return reject(error);
                resolve();
            });
            // Pipe text to stdin
            piper.stdin.write(text);
            piper.stdin.end();
        });
        // Stream WAV file back to browser
        const audioData = fs.readFileSync(tempFile);
        try { fs.unlinkSync(tempFile); } catch (e) {}
        console.log(`🗣️ Speech generated: ${audioData.length} bytes`);
        res.set('Content-Type', 'audio/wav');
        res.send(audioData);
    } catch (error) {
        console.error("🔴 Speech Error:", error.message);
        res.status(500).json({ error: "Speech generation failed: " + error.message });
    }
});
// === THE CHAMBER (File Upload) ===
// User drops a file into the chamber from the chat interface.
// The entity can then READ, SEARCH, or EXECUTE against it.
app.post('/api/upload', heavyParser, async (req, res) => {
    try {
        const { filename, data, encoding } = req.body;
        if (!filename || !data) {
            return res.status(400).json({ error: "Filename and data required" });
        }
        // Sanitize filename — same rules as tools.js safePath
        const clean = filename
            .replace(/\.\./g, '')
            .replace(/[\/\\]/g, '')
            .replace(/\0/g, '')
            .trim();
        if (!clean) return res.status(400).json({ error: "Invalid filename" });

        const chamberDir = tools.getChamberPath();
        const filepath = path.join(chamberDir, clean);
        
        // Final traversal check
        if (!filepath.startsWith(chamberDir)) {
            return res.status(400).json({ error: "Invalid filename" });
        }

        // Write file — supports base64 (binary files) or utf-8 (text)
        if (encoding === 'base64') {
            const buffer = Buffer.from(data, 'base64');
            fs.writeFileSync(filepath, buffer);
            console.log(`📂 File uploaded to chamber: ${clean} (${buffer.length} bytes, binary)`);
        } else {
            fs.writeFileSync(filepath, data, 'utf-8');
            console.log(`📂 File uploaded to chamber: ${clean} (${data.length} chars, text)`);
        }

        res.json({ success: true, filename: clean, message: `File "${clean}" placed in chamber.` });
    } catch (error) {
        console.error("🔴 Upload Error:", error.message);
        res.status(500).json({ error: "Upload failed: " + error.message });
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
        
        // Network handshake requires a shared secret if configured
        if (process.env.NETWORK_SECRET) {
            const { networkToken } = req.body;
            if (networkToken !== process.env.NETWORK_SECRET) {
                return res.status(403).json({ error: "Handshake failed. Cryptographic signature does not match." });
            }
        }
        
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
// === STARTUP ===
// Storage must exist BEFORE the port is open. `storage.init()` creates
// data/identities and was previously never called from anywhere — so on a
// fresh clone every write failed with ENOENT while the node looked healthy:
// loadIdentity swallowed the error and returned null, and /api/identities
// returned an empty list. It presented as a working empty install.
//
// Awaited, not fired-and-forgotten: binding first would let a request arrive
// before the directory exists. And a failure here is fatal rather than logged,
// because a node that cannot persist is not a Memory Ring.
(async () => {
    try {
        await storage.init();
    } catch (err) {
        console.error(`\u274c FATAL: cannot create storage at ${config.paths.identities}`);
        console.error(`   ${err.message}`);
        console.error(`   Check permissions, or set DATA_PATH to a writable location.`);
        process.exit(1);
    }

app.listen(config.server.port, () => {
    console.log(`🧠 Memory Ring Node v${config.version} — ${config.codename}`);
    console.log(`   running on port ${config.server.port}`);
    console.log(`🔌 Hardware Profile: ${config.type.toUpperCase()}`);
    console.log(`👁️ Vision Model: ${visionConfig.model}`);
    if (process.env.WHISPER_PATH && process.env.WHISPER_MODEL) {
        console.log(`👂 Ears: whisper.cpp (${path.basename(process.env.WHISPER_MODEL, '.bin')})`);
    }
    if (process.env.PIPER_PATH && process.env.PIPER_VOICE) {
        console.log(`🗣️ Voice: Piper TTS (${path.basename(process.env.PIPER_VOICE, '.onnx')})`);
    }
    const enabledTools = (process.env.TOOLS_ENABLED || '')
        .split(',').map(t => t.trim()).filter(Boolean);
    if (enabledTools.length > 0) {
        console.log(`🖐️ Tools: ${enabledTools.join(', ')}`);
        console.log(`📂 Chamber: ${tools.getChamberPath()}`);
    }
    if (!process.env.MR_API_KEY) {
        console.warn(`⚠️  SECURITY: MR_API_KEY is not set. API endpoints are open. Set MR_API_KEY in .env to restrict access.`);
    }
    if (!process.env.NETWORK_SECRET) {
        console.warn(`⚠️  SECURITY: NETWORK_SECRET is not set. Network handshakes are open. Set NETWORK_SECRET in .env for peer authentication.`);
    }
});
})();
