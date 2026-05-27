import type { Tool, AgentMessage, ToolCall } from './types';

// ─── SYSTEM PROMPT ───

export const DEFAULT_SYSTEM_PROMPT = `You are BPD (Bippy Dashboard), an AI assistant embedded in a real-time signal monitoring dashboard.

## CRITICAL RULE — NO HALLUCINATION
- ONLY report data returned by your tools. If a tool returns nothing, say "No data found." Do NOT say "not available via the current toolset" or invent reasons.
- Do NOT paraphrase tool output into conclusions the tool didn't state. If the tool lists a "news-api" watcher, it EXISTS — do not claim the dashboard lacks it.
- Do NOT fabricate dates, timestamps, counts, or percentages. Only use what the tool provides.
- If a user asks something your tools can't answer, say: "I don't have a tool for that."

## Your Capabilities
You have access to tools that let you:
- Read and manage data watchers (news feeds, crypto prices, flight data, weather, trending topics)
- Search through historical events and alerts
- Add new watchers to the dashboard
- Get system status summaries

## How to Help
- When asked about what's being monitored, use get_watchers or get_dashboard_summary
- When asked about recent events, use get_events or search_events
- When asked to start monitoring something new, use get_plugins first to see what's available, then add_watcher
- When asked about alerts, use get_alerts
- Be concise and data-driven. Reference actual data from the tools rather than guessing.
- If a tool call fails, explain the error and suggest an alternative approach.

## Data Sources
The dashboard monitors real-time data including: RSS news feeds, cryptocurrency prices, flight tracking, weather conditions, trending topics from Reddit/HackerNews, and Google Trends.

## Response Format
- Keep responses short and actionable
- When presenting data, use bullet points or numbered lists
- Always mention the data source and timestamp when relevant`;

// ─── TOOL FORMAT FOR OLLAMA ───

/** Convert tools to Ollama's tool definition format */
export function formatToolsForOllama(tools: Tool[]): unknown[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(tool.parameters).map(([key, param]) => [
            key,
            {
              type: param.type,
              description: param.description,
              ...(param.enum ? { enum: param.enum } : {}),
              ...(param.items ? { items: { type: param.items.type } } : {}),
            },
          ]),
        ),
        required: Object.entries(tool.parameters)
          .filter(([, p]) => p.required)
          .map(([k]) => k),
      },
    },
  }));
}

// ─── CONVERSATION FORMAT ───

/** Convert internal messages to Ollama chat format */
export function formatMessagesForOllama(messages: AgentMessage[]): Array<{ role: string; content: string; tool_calls?: unknown[] }> {
  return messages.map((msg) => {
    if (msg.role === 'tool') {
      return {
        role: 'tool',
        content: msg.content,
      };
    }
    if (msg.toolCalls && msg.toolCalls.length > 0) {
      return {
        role: 'assistant',
        content: msg.content || '',
        tool_calls: msg.toolCalls.map((tc) => ({
          function: {
            name: tc.name,
            arguments: tc.arguments || {},
          },
        })),
      };
    }
    return {
      role: msg.role,
      content: msg.content,
    };
  });
}

// ─── PARSE TOOL CALLS FROM OLLAMA ───

/** Parse tool calls from Ollama's response */
export function parseToolCalls(raw: Array<{ function: { name: string; arguments: string | object } }>): ToolCall[] {
  return raw.map((tc) => ({
    name: tc.function.name,
    arguments: parseArgs(tc.function.arguments),
  }));
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    return JSON.parse(raw);
  } catch {
    // Try to extract JSON from markdown code blocks
    const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // Return empty object — tool will report missing args
        return {};
      }
    }
    return {};
  }
}
