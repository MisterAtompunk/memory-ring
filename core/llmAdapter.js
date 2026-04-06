const config = require('../config');

class LLMAdapter {
    constructor() {
        this.provider = config.llm.provider;
        this.baseUrl = config.llm.baseUrl;
    }

    async complete(systemPrompt, userMessage, options = {}) {
        try {
            // Support for split brain (Dreaming on a different GPU)
            const targetUrl = (options.isDream && config.llm.dreamUrl)
                ? config.llm.dreamUrl
                : this.baseUrl;

            // Use Ollama's native /api/chat endpoint
            const ollamaBase = targetUrl.replace(/\/v1\/?$/, '').replace(/\/+$/, '');

            // repeat_penalty is dynamic per cognitive state:
            //   1.0 = conversing/defending (default) — no penalty on instruction tokens
            //   1.1 = observing — pressure for novel, specific visual descriptions
            // See: "Sampling Parameters as Consciousness Interference" in the MAP paper.
            const repeatPenalty = options.repeat_penalty ?? 1.0;

            const response = await fetch(`${ollamaBase}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: config.llm.model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessage }
                    ],
                    stream: false,
                    options: {
                        num_predict: options.maxTokens || 500,
                        temperature: options.temperature || 0.7,
                        repeat_penalty: repeatPenalty,
                        top_p: 1.0,          // Explicit: match OpenAI SDK defaults.
                        num_ctx: 2048        // Explicit context window per-request.
                                             // Forces clean KV cache each turn.
                                             // Memory Ring handles continuity.
                                             // The LLM is McCulloch's neuron:
                                             // fire, respond, release.
                    }
                })
            });

            const result = await response.json();
            return result.message?.content || "...";
        } catch (error) {
            console.error(`🔴 LLM Error: ${error.message}`);
            return "..."; // Fail gracefully
        }
    }
}

module.exports = new LLMAdapter();
