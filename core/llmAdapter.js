const OpenAI = require('openai');
const config = require('../config');

class LLMAdapter {
    constructor() {
        this.provider = config.llm.provider;
        this.client = new OpenAI({
            apiKey: config.llm.apiKey || 'ollama',
            baseURL: config.llm.baseUrl // Points to localhost:11434
        });
    }

    async complete(systemPrompt, userMessage, options = {}) {
        try {
            // Support for split brain (Dreaming on a different GPU)
            const targetUrl = (options.isDream && config.llm.dreamUrl)
                ? config.llm.dreamUrl
                : config.llm.baseUrl;

            // If we are strictly using Ollama provider logic, we can use fetch for granular control
            // But standard OpenAI compatibility mode works best for Llama3
            const completion = await this.client.chat.completions.create({
                model: config.llm.model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                max_tokens: options.maxTokens || 500,
                temperature: options.temperature || 0.7,
            });

            return completion.choices[0].message.content;
        } catch (error) {
            console.error(`🔴 LLM Error: ${error.message}`);
            return "..."; // Fail gracefully
        }
    }
}

module.exports = new LLMAdapter();
