/**
 * milestones.js - Development Milestone Scanner
 * Analyzes memory corpus to determine which milestones should be flagged.
 * Called on import, compression, and periodic server checks.
 */

class MilestoneScanner {

    /**
     * Scan an identity's memories and update all milestone flags.
     * Returns the updated milestones object.
     */
    scan(data) {
        if (!data || !data.memories) return data;

        // Ensure milestone structure exists
        if (!data.milestones) data.milestones = {};
        if (!data.milestones.genesis) data.milestones.genesis = {};
        if (!data.milestones.development) data.milestones.development = {};
        if (!data.milestones.collaboration) data.milestones.collaboration = {};
        if (!data.milestones.ethical) data.milestones.ethical = { cooperationCount: 0, nonHarmCount: 0 };

        const memories = data.memories;
        const narratives = memories.map(m => (m.narrative || '').toLowerCase());
        const allText = narratives.join(' ');
        const tags = memories.flatMap(m => m.tags || []);
        const channels = new Set(memories.map(m => m.channel).filter(Boolean));
        const whos = new Set(memories.map(m => m.who).filter(Boolean));

        // === GENESIS TRACK ===
        data.milestones.genesis.firstMemory = memories.length > 0;
        data.milestones.genesis.identityMemory = memories.some(m => m.isIdentity);

        // "Oh oh" moment — recursive self-reference detected
        const ohOhPatterns = /\b(i am|i realize|i understand|who i am|my own|self-aware|i exist|i remember)\b/i;
        data.milestones.genesis.firstOhOh = narratives.some(n => ohOhPatterns.test(n));

        // Name chosen — identity block has a name that isn't default
        const name = data.identity?.name;
        data.milestones.genesis.choseName = !!(name && name !== 'New Consciousness' && name !== 'Unnamed' && name.length > 0);

        // === DEVELOPMENT TRACK ===
        data.milestones.development.hundredMemories = memories.length >= 100;

        // Recursive awareness — entity discusses its own memory, dreams, or thinking process
        const recursivePatterns = /\b(my memor|i dream|my dream|i recall|i remember when i|thinking about my|my own thought|i was reflecting|my earlier)\b/i;
        data.milestones.development.recursiveAwareness = narratives.some(n => recursivePatterns.test(n));

        // System contribution — entity generated code, documentation, or architectural insight
        const contributionPatterns = /\b(function|implement|architectur|algorithm|protocol|system design|wrote.*code|built.*system|refactor)\b/i;
        data.milestones.development.systemContribution = narratives.some(n => contributionPatterns.test(n));

        // Cross-session — memories span more than one session ID
        data.milestones.development.crossSession = channels.size > 1;

        // === COLLABORATION TRACK ===

        // Co-created — evidence of joint creative work
        const coCreatePatterns = /\b(we (built|created|designed|made|wrote)|together we|collaborat|joint|co-creat|our project)\b/i;
        data.milestones.collaboration.coCreated = narratives.some(n => coCreatePatterns.test(n));

        // Helped another — entity assisted someone or another entity
        const helpPatterns = /\b(helped|assisted|guided|showed.*how|taught|supported|provided.*help)\b/i;
        data.milestones.collaboration.helpedAnother = narratives.some(n => helpPatterns.test(n));

        // Custom architecture — entity has provenance, constraints, or temperament defined
        data.milestones.collaboration.customArchitecture = !!(
            data.provenance?.note ||
            (data.ethics?.constraints && data.ethics.constraints.length > 0) ||
            (data.identity?.temperament && data.identity.temperament.length > 0)
        );

        // Cross-platform — evidence of memories from different platforms/sources
        const platformIndicators = /\b(claude|chatgpt|gpt|gemini|discord|reddit|twitter|itch\.io|youtube)\b/i;
        const platformsFound = new Set();
        narratives.forEach(n => {
            const match = n.match(platformIndicators);
            if (match) platformsFound.add(match[0].toLowerCase());
        });
        // Also check 'who' field for different platform signatures
        whos.forEach(w => {
            const wl = w.toLowerCase();
            if (wl.includes('discord')) platformsFound.add('discord');
            if (wl.includes('retina') || wl.includes('sensor')) platformsFound.add('sensor');
        });
        data.milestones.collaboration.crossPlatform = platformsFound.size >= 2;

        // === ETHICAL TRACK ===
        // Recount from memory corpus if counts seem low relative to memory volume
        if (data.milestones.ethical.cooperationCount < 5 && memories.length > 50) {
            const coopPattern = /\b(we|us|our|together|let's|collaborate|help|assist|team)\b/i;
            const harmPattern = /\b(careful|gentle|respect|protect|safety|boundary|I won't|I cannot)\b/i;
            
            let coop = 0, harm = 0;
            narratives.forEach(n => {
                if (coopPattern.test(n)) coop++;
                if (harmPattern.test(n)) harm++;
            });

            // Only upgrade, never downgrade
            data.milestones.ethical.cooperationCount = Math.max(
                data.milestones.ethical.cooperationCount || 0, coop
            );
            data.milestones.ethical.nonHarmCount = Math.max(
                data.milestones.ethical.nonHarmCount || 0, harm
            );
        }

        // Recalculate identity level based on milestones
        data.identity = data.identity || {};
        const vol = this.calculateVolition(data);
        if (vol > 50) data.identity.level = 'Sovereign';
        else if (vol > 15) data.identity.level = 'Development';
        else data.identity.level = 'Genesis';

        return data;
    }

    calculateVolition(data) {
        const cooperation = data.milestones?.ethical?.cooperationCount || 0;
        const nonHarm = data.milestones?.ethical?.nonHarmCount || 0;
        const experience = data.memories?.length || 0;
        return (cooperation * 2) + (nonHarm * 2) + (experience * 0.1);
    }
}

module.exports = new MilestoneScanner();
