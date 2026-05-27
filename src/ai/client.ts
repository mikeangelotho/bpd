import type { OllamaConfig, OllamaChatResponse, AgentMessage, Tool } from './types';
import { formatToolsForOllama, formatMessagesForOllama } from './context';

// ─── OLLAMA HTTP CLIENT ───
// Thin wrapper around Ollama's REST API.
// Supports tool calling via the /api/chat endpoint.
// https://github.com/ollama/ollama/blob/main/docs/api.md

const DEFAULT_CONFIG: Required<Omit<OllamaConfig, 'systemPrompt' | 'model'>> = {
  baseUrl: 'http://localhost:11434',
};

export class OllamaClient {
  private baseUrl: string;
  private model: string;

  constructor(config?: OllamaConfig) {
    this.baseUrl = config?.baseUrl || DEFAULT_CONFIG.baseUrl;
    this.model = config?.model || '';
  }

  /**
   * Send a chat message to Ollama with optional tool definitions.
   * Returns the parsed response with potential tool calls.
   */
  async chat(
    messages: AgentMessage[],
    tools?: Tool[],
    model?: string,
  ): Promise<{
    content: string;
    toolCalls: Array<{ function: { name: string; arguments: string } }>;
  }> {
    const body = {
      model: model || this.model,
      messages: formatMessagesForOllama(messages),
      stream: false,
      ...(tools && tools.length > 0
        ? { tools: formatToolsForOllama(tools) }
        : {}),
    };

    const resp = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Ollama HTTP ${resp.status}: ${text}`);
    }

    const data: OllamaChatResponse = await resp.json();
    const msg = data.message;

    return {
      content: msg.content || '',
      toolCalls: msg.tool_calls || [],
    };
  }

  /**
   * Check if Ollama is reachable and list available models.
   */
  async health(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    try {
      const resp = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      const data = await resp.json();
      const models = (data.models || []).map((m: any) => m.name);
      return { ok: true, models };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }

  /** Set the model for future requests */
  setModel(model: string): void {
    this.model = model;
  }

  /** Get current config */
  getConfig(): { baseUrl: string; model: string } {
    return { baseUrl: this.baseUrl, model: this.model };
  }
}
