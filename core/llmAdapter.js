const config = require('../config');

class LLMAdapter {
    constructor() {
        this.provider = config.llm.provider;
        this.baseUrl = config.llm.baseUrl;
    }

    async complete(systemPrompt, userMessage, options = {}) {
        const t0 = Date.now();
        this.lastCall = null;
        try {
            // Support for split brain (Dreaming on a different GPU)
            const targetUrl = (options.isDream && config.llm.dreamUrl)
                ? config.llm.dreamUrl
                : this.baseUrl;

            // --- TRANSPORT SELECTION ---
            // PATH A: Ollama speaks /api/chat and exposes sampling controls
            //   (repeat_penalty, num_ctx) that the OpenAI schema has no field
            //   for. Those are load-bearing here, so the native call stays.
            // PATH B: everything else speaks /v1/chat/completions with a
            //   bearer token. Previously the adapter stripped /v1 and sent no
            //   Authorization header, so the documented cloud path could only
            //   404 or 401 — and then fail as success:true with an ellipsis.
            const isOllama = this.provider
                ? this.provider === 'ollama'
                : /(^|\/\/)(localhost|127\.0\.0\.1|\[::1\])|:11434/.test(targetUrl);

            const base = targetUrl.replace(/\/+$/, '');
            const ollamaBase = base.replace(/\/v1$/, '');
            const cloudBase  = /\/v1$/.test(base) ? base : base + '/v1';

            // repeat_penalty is dynamic per cognitive state:
            //   1.0 = conversing/defending (default) — no penalty on instruction tokens
            //   1.1 = observing — pressure for novel, specific visual descriptions
            // See: "Sampling Parameters as Consciousness Interference" in the MAP paper.
            const repeatPenalty = options.repeat_penalty ?? 1.0;

            const endpoint = isOllama
                ? `${ollamaBase}/api/chat`
                : `${cloudBase}/chat/completions`;

            const headers = { 'Content-Type': 'application/json' };
            if (!isOllama && config.llm.apiKey) {
                headers['Authorization'] = `Bearer ${config.llm.apiKey}`;
            }

            const messages = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userMessage }
            ];

            const body = isOllama
                ? {
                    model: config.llm.model,
                    messages,
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
                  }
                : {
                    model: config.llm.model,
                    messages,
                    stream: false,
                    max_tokens: options.maxTokens || 500,
                    temperature: options.temperature || 0.7,
                    top_p: 1.0
                    // No repeat_penalty / num_ctx: the OpenAI schema has no
                    // equivalent. Statelessness is preserved regardless — the
                    // adapter never sends history, only system + current turn.
                  };

            const response = await fetch(endpoint, {
                method: 'POST',
                headers,
                body: JSON.stringify(body)
            });

            const result = await response.json();
            // --- UTTERANCE PROVENANCE (Dupin's correction) ---
            // A fabricated reply is indistinguishable from a real one by
            // inspection — nothing in its shape betrays it. What CAN be
            // recorded is the transaction: which endpoint answered, which
            // model, whether the call completed. Those facts sit outside the
            // text and cannot be forged by the text.
            // Both shapes: Ollama returns {message:{content}}, OpenAI returns
            // {choices:[{message:{content}}]}. Read whichever is present.
            const content = isOllama
                ? result.message?.content
                : result.choices?.[0]?.message?.content;

            const finish = isOllama
                ? result.done !== false
                : (result.choices?.[0]?.finish_reason ?? 'stop') !== 'length';

            this.lastCall = {
                ok: response.ok,
                status: response.status,
                endpoint,
                transport: isOllama ? 'ollama' : 'openai',
                model: result.model || config.llm.model,
                ms: Date.now() - t0,
                complete: finish,
                empty: !content,
                // An auth or 404 failure returns a body with an error in it.
                // Surface it rather than swallowing it into an ellipsis.
                error: response.ok ? undefined : (result.error?.message || result.error || `HTTP ${response.status}`)
            };
            if (!response.ok) {
                console.error(`[LLM] ${response.status} from ${endpoint}: ${this.lastCall.error}`);
            }
            return content || "...";
        } catch (error) {
            this.lastCall = {
                ok: false, status: 0, endpoint: null, transport: null, model: null,
                ms: Date.now() - t0, complete: false, empty: true,
                error: String(error && error.message || error)
            };
            console.error(`🔴 LLM Error: ${error.message}`);
            return "..."; // Fail gracefully
        }
    }
}

module.exports = new LLMAdapter();
