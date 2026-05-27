import type {
  AgentConfig,
  AgentMessage,
  AgentState,
  QueryRequest,
  QueryResponse,
  Tool,
  ToolCall,
  ToolResult,
} from './types';
import { OllamaClient } from './client';
import { DEFAULT_SYSTEM_PROMPT, parseToolCalls } from './context';

// ─── BPD AI AGENT ───
// Core agent loop: receives a user message, optionally calls tools,
// and returns a response. The agent has no direct store access —
// it operates purely on the tools it's given.

// Model default lives in OllamaClient — this config only needs maxToolIterations
const DEFAULT_CONFIG: Required<Pick<AgentConfig, 'maxToolIterations'>> = {
  maxToolIterations: 5,
};

export class BPDAgent {
  private client: OllamaClient;
  private tools: Tool[];
  private systemPrompt: string;
  private maxToolIterations: number;
  private history: AgentMessage[] = [];

  constructor(config: AgentConfig, tools: Tool[]) {
    this.client = new OllamaClient(config);
    this.tools = tools;
    this.systemPrompt = config.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    this.maxToolIterations = config.maxToolIterations || DEFAULT_CONFIG.maxToolIterations;
  }

  /**
   * Process a user query through the full agent loop:
   * 1. Build conversation context
   * 2. Call Ollama with tool definitions
   * 3. If tool calls returned, execute them and loop back
   * 4. Return final text response
   */
  async query(request: QueryRequest): Promise<QueryResponse> {
    const start = Date.now();

    // Build message list: system + history + user
    const messages: AgentMessage[] = [
      { role: 'system', content: this.systemPrompt },
      ...this.history,
      { role: 'user', content: request.message },
    ];

    const allToolResults: ToolResult[] = [];
    let iteration = 0;

    while (iteration < this.maxToolIterations) {
      iteration++;

      // Call Ollama
      const response = await this.client.chat(messages, this.tools, request.model);

      // If no tool calls, we're done
      if (!response.toolCalls || response.toolCalls.length === 0) {
        // Save to history
        this.history.push({ role: 'user', content: request.message });
        this.history.push({ role: 'assistant', content: response.content });

        // Trim history to prevent context overflow
        if (this.history.length > 20) {
          this.history = this.history.slice(-16);
        }

        return {
          response: response.content,
          toolCalls: allToolResults,
          history: [...this.history],
          processingTime: Date.now() - start,
        };
      }

      // Parse and execute tool calls
      const toolCalls = parseToolCalls(response.toolCalls);

      // Add assistant message with tool calls to conversation
      messages.push({
        role: 'assistant',
        content: response.content,
        toolCalls,
      });

      // Execute each tool
      for (const tc of toolCalls) {
        const tool = this.tools.find((t) => t.name === tc.name);
        let result: ToolResult;

        if (!tool) {
          result = {
            call: tc,
            output: '',
            error: `Tool "${tc.name}" not found. Available tools: ${this.tools.map((t) => t.name).join(', ')}`,
          };
        } else {
          try {
            const output = await tool.execute(tc.arguments);
            result = { call: tc, output };
          } catch (err) {
            result = {
              call: tc,
              output: '',
              error: `Execution error: ${String(err)}`,
            };
          }
        }

        allToolResults.push(result);

        // Add tool result to conversation
        messages.push({
          role: 'tool',
          content: result.error
            ? `ERROR: ${result.error}`
            : result.output,
          toolCallId: `${tc.name}_${Date.now()}`,
          toolCallName: tc.name,
        });
      }

      // Continue loop — Ollama will see tool results and respond
    }

    // Max iterations reached — force a final response without tools
    messages.push({
      role: 'system',
      content: 'You have reached the maximum number of tool calls. Summarize what you found and provide a final answer without making additional tool calls.',
    });

    const finalResponse = await this.client.chat(messages, [], request.model);

    this.history.push({ role: 'user', content: request.message });
    this.history.push({ role: 'assistant', content: finalResponse.content });

    return {
      response: finalResponse.content,
      toolCalls: allToolResults,
      history: [...this.history],
      processingTime: Date.now() - start,
    };
  }

  /** Get the current conversation history */
  getHistory(): AgentMessage[] {
    return [...this.history];
  }

  /** Clear conversation history */
  clearHistory(): void {
    this.history = [];
  }

  /** Set the model for future queries */
  setModel(model: string): void {
    this.client.setModel(model);
  }

  /** Get agent status info */
  getState(): AgentState {
    const config = this.client.getConfig();
    return {
      initialized: true,
      model: config.model,
      baseUrl: config.baseUrl,
      toolCount: this.tools.length,
      lastQuery: this.history.length > 0
        ? Date.now() // approximate — history exists means we've been used
        : 0,
    };
  }

  /** Get available tool names */
  getToolNames(): string[] {
    return this.tools.map((t) => t.name);
  }
}
