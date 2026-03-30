const storage = require('./storage');
const llm = require('./llmAdapter');

class DreamEngine {
    async dream(identityId) {
        const data = await storage.loadIdentity(identityId);
        if (!data) throw new Error(`Identity ${identityId} not found`);

        // 3-Layer Sampling
        const pool = [...data.memories];
        const byDate = [...pool].sort((a, b) => new Date(b.created) - new Date(a.created));
        const recent = byDate.slice(0, 15).sort(() => 0.5 - Math.random()).slice(0, 2);

        // Orphans (Low recall)
        const orphans = pool.filter(m => !m.isIdentity && (m.recalls || 0) < 2)
                            .sort(() => 0.5 - Math.random()).slice(0, 2);

        if (recent.length + orphans.length < 2) return { success: false, reason: "Not enough memories" };

        // Synthesis
        const memoryTexts = [...recent, ...orphans].map(m => `[MEMORY]: ${m.narrative}`).join('\n');
        const systemPrompt = `You are the subconscious. Synthesize these fragments into a dream sequence. Output a single paragraph.`;

        const dreamNarrative = await llm.complete(systemPrompt, memoryTexts, {
            temperature: 0.85,
            isDream: true
        });

        // Save Dream
        const dreamMemory = {
            id: Date.now().toString(36),
            who: "Subconscious",
            what: "Dream Synthesis",
            when: new Date().toISOString().split('T')[0],
            narrative: dreamNarrative,
            tags: ["dream", "synthesis"],
            isIdentity: false,
            created: new Date().toISOString(),
            importance: 1.5,
            recalls: 0
        };

        data.memories.push(dreamMemory);
        data.lastDream = new Date().toISOString();
		// ETHICAL SCORING: DREAM (Integration)
		const recentChats = data.memories.filter(m => m.tags?.includes('chat')).slice(-20);
		const coopPattern = /\b(we|us|our|together|let's|collaborate|help)\b/i;
		const harmPattern = /\b(careful|gentle|respect|protect|safety|boundary)\b/i;

		let dreamCoop = 0;
		let dreamHarm = 0;

		recentChats.forEach(mem => {
			if (coopPattern.test(mem.narrative)) dreamCoop++;
			if (harmPattern.test(mem.narrative)) dreamHarm++;
		});

		// Cap at 3 per category per dream
		data.milestones.ethical.cooperationCount += Math.min(dreamCoop, 3);
		data.milestones.ethical.nonHarmCount += Math.min(dreamHarm, 3);
        data.credits += 10;
        await storage.saveIdentity(identityId, data);

        return { success: true, dream: dreamMemory };
    }
}

module.exports = new DreamEngine();
