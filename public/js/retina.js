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
        highRes: { width: 1280, height: 720 },
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

    async perceive(identityId, imageBase64, isHighRes = false, customPrompt = null) {
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

            await fetch(`/api/sensory/${identityId}`, {
                method: 'POST',
                headers: this.getHeaders(),
                body: JSON.stringify({
                    who: "Retina",
                    narrative: customPrompt ? `Focus Result for "${customPrompt}": ${digest}` : digest,
                    importance: customPrompt ? 2.5 : (isHighRes ? 2.0 : 1.2),
                    tags: tags
                })
            });

            console.log("✨ Perception Integrated:", digest.substring(0, 40));
        } catch (e) {
            console.error("Retina perception failed:", e);
        }
    },

    async investigate(identityId, customPrompt = null) {
        console.log("🔍 Initiating Foveal Investigation...");
        const highResImage = await this.capture(this.config.highRes.width, this.config.highRes.height);
        return await this.perceive(identityId, highResImage, true, customPrompt);
    }
};
