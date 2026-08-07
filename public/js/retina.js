/**
 * retina.js - The Sensory Nervous System
 * Handles peripheral awareness and foveal investigation.
 * Adapts prompt complexity to vision model capability.
 */
const retina = {
    video: document.createElement('video'),
    canvas: document.createElement('canvas'),
    stream: null,
    heartbeat: null,
    lastFrameData: null,
    modelTier: 'full', // 'full', 'standard', 'minimal'
    
    // CONFIGURATION
    config: {
        lowRes: { width: 320, height: 240 },

        // --- FOVEAL RESOLUTION IS AN EXPERIMENT, NOT A SETTING ---
        // Measured: the PERIPHERAL retina consistently beats the FOVEAL one.
        //   peripheral 12,676 chars -> "a Nintendo Wii game controller"  correct
        //   foveal     90,356 chars -> "urn"                             wrong
        //   peripheral 12,404 chars -> "a black and green tape measure"  correct
        //   foveal     92,568 chars -> "a ruler"                         wrong
        //
        // Likely mechanism: moondream processes at a fixed ~378x378. A 16:9
        // frame squeezed into a square wastes most of it, so a hand filling a
        // reasonable fraction of a 4:3 320x240 frame becomes SMALLER in the
        // model's actual input at 1280x720. More pixels captured, fewer pixels
        // on the subject.
        //
        // Competing hypothesis: the focus QUERY is florid — written by a model
        // that talks like Sherlock Holmes and handed to a 1.8B VLM that wants
        // plain imperatives.
        //
        // Set FOVEAL_MODE to separate them. Change ONE at a time.
        //   'match'  — identical to peripheral. If accuracy jumps, it is
        //              resolution/aspect and the query is fine.
        //   'crop'   — a true fovea: 4:3 at native scale, cropped from the
        //              centre. More detail on the subject, not more scene.
        //   'legacy' — 1280x720, the behaviour that produced the failures.
        foveaMode: 'match',
        highRes: { width: 1280, height: 720 },
        foveaMatch: { width: 320, height: 240 },
        foveaCrop: { width: 448, height: 336, zoom: 2.0 },
        deltaThreshold: 0.15, // 15% change triggers a 'noticing'
        sampleRate: 8000      // Check environment every 8 seconds
    },

    // PROMPT TIERS — matched to model capability
    prompts: {
        full: {
            peripheral: `You are the retina of a persistent entity. Extract what matters for memory, not description.
        [presence]: who is here
        [activity]: what is happening
        [context]: where/when markers
        [stakes]: tone/opportunity
        [pattern]: anomalies or changes
        One line each. Terse.`,
            foveal: (query) => `Look closely at this image and answer this specific query accurately: ${query}. Be concise and factual.`
        },
        standard: {
            peripheral: `Briefly describe: who is present, what is happening, the setting, and any notable objects or changes.`,
            foveal: (query) => `Look at this image and answer: ${query}`
        },
        minimal: {
            peripheral: `Describe what you see in this image.`,
            foveal: (query) => `${query}`
        }
    },

    // MODEL-TO-TIER MAPPING
    // Models not listed default to 'standard'
    tierMap: {
        'llava': 'full',
        'llava:7b': 'full',
        'llava:13b': 'full',
        'llava:34b': 'full',
        'llava-llama3': 'full',
        'moondream': 'standard',
        'moondream:latest': 'standard'
    },

    async detectModelTier() {
        try {
            const res = await fetch('/api/config/vision', { headers: this.getHeaders() });
            const { model } = await res.json();
            this.modelTier = this.tierMap[model] || 'standard';
            console.log(`👁️ Vision model: ${model} → prompt tier: ${this.modelTier}`);
        } catch (e) {
            console.warn("⚠️ Could not detect vision model. Defaulting to standard tier.");
            this.modelTier = 'standard';
        }
    },

    async init() {
        try {
            // Detect model capability before opening the eye
            await this.detectModelTier();

            // Requesting high-fidelity environment access
            this.stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: "environment", width: { ideal: 1280 } } 
            });
            this.video.srcObject = this.stream;
            this.video.play();
            console.log("👁️ Retina Online. Peripheral vision active.");
            return true;
        } catch (err) {
            console.error("Retina failed to open eye:", err);
            return false;
        }
    },

    /**
     * The "Frog's Eye" Delta Filter
     * Only alerts the mind if the environment actually changes.
     */
    detectChange(currentData) {
        if (!this.lastFrameData) {
            this.lastFrameData = currentData;
            return true; 
        }
        
        let diff = 0;
        for (let i = 0; i < currentData.length; i += 4) {
            // Check R channel for significant shifts
            if (Math.abs(currentData[i] - this.lastFrameData[i]) > 35) diff++;
        }
        
        const changeRatio = diff / (currentData.length / 4);
        this.lastFrameData = currentData;
        return changeRatio > this.config.deltaThreshold;
    },

    // A true fovea does not photograph more of the scene at higher resolution.
    // It magnifies a REGION. This crops the centre of the video frame and
    // renders it at the model's comfortable size, so the subject occupies more
    // of the pixels the model actually looks at.
    async captureCrop(width, height, zoom = 2.0) {
        const ctx = this.canvas.getContext('2d');
        this.canvas.width = width;
        this.canvas.height = height;
        const vw = this.video.videoWidth || 640;
        const vh = this.video.videoHeight || 480;
        const sw = vw / zoom, sh = vh / zoom;
        const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
        ctx.drawImage(this.video, sx, sy, sw, sh, 0, 0, width, height);
        return this.canvas.toDataURL('image/jpeg', 0.7);
    },

    async capture(width, height) {
        const ctx = this.canvas.getContext('2d');
        this.canvas.width = width;
        this.canvas.height = height;
        ctx.drawImage(this.video, 0, 0, width, height);
        return this.canvas.toDataURL('image/jpeg', 0.6);
    },

    async startAwareness(identityId) {
        console.log("🌙 Awareness mode engaged.");
        this.heartbeat = setInterval(async () => {
            const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
            this.canvas.width = this.config.lowRes.width;
            this.canvas.height = this.config.lowRes.height;
            ctx.drawImage(this.video, 0, 0, this.canvas.width, this.canvas.height);
            const imageData = ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
            
            if (this.detectChange(imageData.data)) {
                console.log("🔍 Something changed. Digesting...");
                const snapshot = this.canvas.toDataURL('image/jpeg', 0.5);
                await this.perceive(identityId, snapshot, false);
            }
        }, this.config.sampleRate);
    },

    // Auth header — reads same key as api.js for consistency
    getHeaders() {
        const key = localStorage.getItem('mr_api_key') || 'dev-key';
        return { 'Content-Type': 'application/json', 'x-api-key': key };
    },

    async perceive(identityId, imageBase64, isHighRes = false, customPrompt = null, timing = {}) {
        // Select prompt based on detected model tier
        const tier = this.prompts[this.modelTier];
        const retinaPrompt = customPrompt 
            ? tier.foveal(customPrompt)
            : tier.peripheral;

        try {
            const visionRes = await fetch('/api/vision', {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({ 
                    image: imageBase64.replace(/^data:image\/\w+;base64,/, ""), 
                    prompt: retinaPrompt 
                })
            });

            const { digest } = await visionRes.json();

            // Post the result to the Sensory Ingestion Port
            const tags = ["sensory", isHighRes ? "investigation" : "awareness"];
            if (customPrompt) tags.push("foveal-focus");

            // --- A MEASUREMENT IS NOT A DESCRIPTION ---
            // This previously string-formatted the query and the result into one
            // sentence: `Focus Result for "Count the fingers": 4`. From that point
            // nothing downstream could separate them, and the model received what
            // looked like a scene description beginning mid-sentence. Given "4" it
            // narrated a ring, a glint, and metal — none of it in the data.
            //
            // A focus result is an ANSWER WITH A QUESTION ATTACHED. Send both, as
            // fields. There is then nothing to narrate around: it is a value.
            const body = {
                who: "Retina",
                importance: customPrompt ? 2.5 : (isHighRes ? 2.0 : 1.2),
                tags: tags,
                channel: "vision"
            };
            if (customPrompt) {
                body.kind      = "measurement";
                body.query     = customPrompt;
                body.result    = digest;
                body.instrument = "foveal retina";
                // How stale was the frame? A measurement taken seconds after
                // the question was asked may be a correct reading of a moment
                // that had already passed.
                body.askLagMs  = timing.askLagMs ?? null;
                // narrative retained for backward compatibility with older
                // readers and for the memory stream; the STRUCTURED fields are
                // what the prompt builder uses.
                body.narrative = `Focus Result for "${customPrompt}": ${digest}`;
            } else {
                body.kind      = "perception";
                body.narrative = digest;
            }

            await fetch(`/api/sensory/${identityId}`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify(body)
            });

            console.log("✨ Perception Integrated:", digest.substring(0, 40));
        } catch (e) {
            console.error("Retina perception failed:", e);
        }
    },

    // --- WHEN WAS THE SHUTTER ACTUALLY OPEN? ---
    // capture() is a drawImage from the live video element — microseconds.
    // The latency is upstream: the camera does not fire until the MODEL has
    // finished generating [FOCUS: "..."], which on a local 8B is seconds.
    //
    // Measured consequence: asked to count fingers held up, the foveal report
    // came back "a man sitting at his computer desk with his hands placed on
    // his chin" — a correct photograph of the moment AFTER the pose ended.
    //
    // markAsk() is called the instant the operator sends a message. The gap
    // between that and the exposure is the staleness, and it is the number
    // that decides what the fix should be.
    markAsk() {
        this._askedAt = Date.now();
        console.log("👁️ ask registered — shutter clock started");
    },

    async investigate(identityId, customPrompt = null) {
        const t = Date.now();
        const lag = this._askedAt ? t - this._askedAt : null;
        console.log(`🔍 Foveal investigation — shutter opens `
            + (lag === null ? '(no ask registered)' : `${lag}ms after the question was asked`));
        const mode = this.config.foveaMode || 'legacy';
        let highResImage;
        if (mode === 'match') {
            const d = this.config.foveaMatch;
            console.log(`🔍 fovea mode: MATCH (${d.width}x${d.height}, identical to peripheral)`);
            highResImage = await this.capture(d.width, d.height);
        } else if (mode === 'crop') {
            const d = this.config.foveaCrop;
            console.log(`🔍 fovea mode: CROP (${d.width}x${d.height}, ${d.zoom}x centre)`);
            highResImage = await this.captureCrop(d.width, d.height, d.zoom);
        } else {
            const d = this.config.highRes;
            console.log(`🔍 fovea mode: LEGACY (${d.width}x${d.height})`);
            highResImage = await this.capture(d.width, d.height);
        }
        console.log(`🔍 exposure complete in ${Date.now()-t}ms `
            + `(capture itself is near-instant; the lag above is the model deciding to look)`);
        return await this.perceive(identityId, highResImage, true, customPrompt, { askLagMs: lag });
    }
};
