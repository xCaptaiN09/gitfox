"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OllamaClient = void 0;
const errors_1 = require("./errors");
const DEFAULT_TIMEOUT_MS = 900000;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_NUM_CTX = 16384;
class OllamaClient {
    baseUrl;
    model;
    constructor(baseUrl, model) {
        try {
            const parsed = new URL(baseUrl);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                throw new errors_1.OllamaError(`Ollama URL must use http or https, got: ${parsed.protocol}`);
            }
            this.baseUrl = baseUrl.replace(/\/+$/, '');
        }
        catch (error) {
            if (error instanceof errors_1.OllamaError) {
                throw error;
            }
            throw new errors_1.OllamaError(`Invalid Ollama base URL: ${baseUrl}`, { cause: error });
        }
        if (model.trim() === '') {
            throw new errors_1.OllamaError('Ollama model name must not be empty');
        }
        this.model = model.trim();
    }
    async chat(messages, options = {}) {
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(`${this.baseUrl}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: this.model,
                    messages,
                    stream: false,
                    ...(options.json === true ? { format: 'json' } : {}),
                    options: {
                        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
                        num_ctx: options.numCtx ?? DEFAULT_NUM_CTX
                    }
                }),
                signal: controller.signal
            });
            if (!response.ok) {
                const bodyText = await response.text().catch(() => '');
                throw new errors_1.OllamaError(`Ollama returned HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
            }
            const data = (await response.json());
            if (typeof data.error === 'string' && data.error !== '') {
                throw new errors_1.OllamaError(`Ollama error: ${data.error}`);
            }
            const content = data.message?.content;
            if (typeof content !== 'string' || content.trim() === '') {
                throw new errors_1.OllamaError('Ollama returned an empty response');
            }
            return content;
        }
        catch (error) {
            if (error instanceof errors_1.OllamaError) {
                throw error;
            }
            if (error instanceof Error && error.name === 'AbortError') {
                throw new errors_1.OllamaError(`Ollama request timed out after ${timeoutMs}ms`, { cause: error });
            }
            throw new errors_1.OllamaError(`Failed to reach Ollama at ${this.baseUrl}`, { cause: error });
        }
        finally {
            clearTimeout(timer);
        }
    }
}
exports.OllamaClient = OllamaClient;
