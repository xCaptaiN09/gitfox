import { OllamaError } from './errors';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  json?: boolean;
  temperature?: number;
  numCtx?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 900000;
const DEFAULT_TEMPERATURE = 0.2;
const DEFAULT_NUM_CTX = 16384;

/**
 * Folds one NDJSON stream line into the accumulated content/error state.
 * Exported for tests; keeps `chat` lean.
 */
export function foldStreamLine(
  state: { content: string; error: string },
  line: string
): { content: string; error: string } {
  const trimmed = line.trim();
  if (trimmed === '') {
    return state;
  }
  try {
    const chunk = JSON.parse(trimmed) as { message?: { content?: string }; error?: string };
    return {
      content: typeof chunk.message?.content === 'string' ? state.content + chunk.message.content : state.content,
      error: typeof chunk.error === 'string' && chunk.error !== '' ? chunk.error : state.error
    };
  } catch {
    // Ignore partial or malformed lines (e.g. keep-alive comments).
    return state;
  }
}

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly model: string;

  public constructor(baseUrl: string, model: string) {
    try {
      const parsed = new URL(baseUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new OllamaError(`Ollama URL must use http or https, got: ${parsed.protocol}`);
      }
      this.baseUrl = baseUrl.replace(/\/+$/, '');
    } catch (error) {
      if (error instanceof OllamaError) {
        throw error;
      }
      throw new OllamaError(`Invalid Ollama base URL: ${baseUrl}`, { cause: error });
    }
    if (model.trim() === '') {
      throw new OllamaError('Ollama model name must not be empty');
    }
    this.model = model.trim();
  }

  public async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Stream NDJSON instead of `stream: false`: with a non-streaming request Ollama
      // sends no response headers until generation finishes, and undici's hardcoded
      // 300s headers timeout kills long reviews (~5 min on 4-core runners).
      // With streaming, bytes flow continuously so the socket never times out.
      const response = await fetch(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: true,
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
        throw new OllamaError(`Ollama returned HTTP ${response.status}: ${bodyText.slice(0, 500)}`);
      }
      if (response.body === null) {
        throw new OllamaError('Ollama returned an empty response body');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let state = { content: '', error: '' };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex !== -1) {
          state = foldStreamLine(state, buffer.slice(0, newlineIndex));
          buffer = buffer.slice(newlineIndex + 1);
          newlineIndex = buffer.indexOf('\n');
        }
      }
      state = foldStreamLine(state, buffer);

      if (state.error !== '') {
        throw new OllamaError(`Ollama error: ${state.error}`);
      }
      if (state.content.trim() === '') {
        throw new OllamaError('Ollama returned an empty response');
      }
      return state.content;
    } catch (error) {
      if (error instanceof OllamaError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new OllamaError(`Ollama request timed out after ${timeoutMs}ms`, { cause: error });
      }
      throw new OllamaError(`Failed to reach Ollama at ${this.baseUrl}`, { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}
