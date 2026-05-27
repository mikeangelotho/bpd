// ═══ AI CORE TYPES ═══

// ─── TOOL SYSTEM ───

/** JSON Schema for a tool parameter */
export interface ToolParam {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required?: boolean;
  items?: ToolParam;
  properties?: Record<string, ToolParam>;
  enum?: string[];
}

/** A callable tool the AI can invoke */
export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, ToolParam>;
  /** Execute the tool with parsed arguments. Returns a string result. */
  execute(args: Record<string, unknown>): Promise<string>;
}

/** A tool call request from the LLM */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/** A tool call result */
export interface ToolResult {
  call: ToolCall;
  output: string;
  error?: string;
}

// ─── MESSAGES ───

export type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AgentMessage {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string; // for tool result messages
  toolCallName?: string; // for tool result messages
}

// ─── OLLAMA CLIENT ───

export interface OllamaConfig {
  /** Base URL for Ollama API (default: http://localhost:11434) */
  baseUrl?: string;
  /** Model name to use (auto-detected from Ollama at startup) */
  model?: string;
  /** System prompt for the agent */
  systemPrompt?: string;
}

export interface OllamaChatResponse {
  message: {
    role: string;
    content: string;
    tool_calls?: Array<{
      function: {
        name: string;
        arguments: string;
      };
    }>;
  };
  done: boolean;
}

// ─── AGENT ───

export interface AgentConfig extends OllamaConfig {
  /** Max tool call iterations per query (prevent infinite loops) */
  maxToolIterations?: number;
}

export interface AgentState {
  initialized: boolean;
  model: string;
  baseUrl: string;
  toolCount: number;
  lastQuery: number;
}

// ─── QUERY INTERFACE ───

export interface QueryRequest {
  /** User query message */
  message: string;
  /** Override model for this query */
  model?: string;
  /** Conversation history (optional) */
  history?: AgentMessage[];
}

export interface QueryResponse {
  /** AI response text */
  response: string;
  /** Tool calls that were executed */
  toolCalls: ToolResult[];
  /** Updated conversation history */
  history: AgentMessage[];
  /** Total processing time in ms */
  processingTime: number;
}
