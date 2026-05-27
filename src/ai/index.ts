// ═══ BPD AI — PUBLIC API ═══
// This module initializes the AI agent with access to the app store.
// Import `initAI` at app startup and use `queryAI` for external queries.

import type { AgentConfig, QueryRequest, QueryResponse, AgentState } from './types';
import { BPDAgent } from './agent';
import { createTools } from './tools';

let agent: BPDAgent | null = null;

/**
 * Initialize the BPD AI agent.
 * Call this once at app startup after plugins are registered.
 *
 * The `storeAccess` object provides the agent with read/write access
 * to the app state. This keeps the AI module decoupled from SolidJS.
 */
export function initAI(
  storeAccess: Parameters<typeof createTools>[0],
  config?: AgentConfig,
): void {
  const tools = createTools(storeAccess);
  agent = new BPDAgent(config || {}, tools);
  console.log(`[ai] Agent initialized: ${tools.length} tools, model=${config?.model || '(none)'}`);
}

/**
 * Query the AI agent.
 * This is the main entry point for both in-app and external queries.
 * Returns the agent's response plus any tool calls executed.
 */
export async function queryAI(request: QueryRequest): Promise<QueryResponse> {
  if (!agent) {
    throw new Error('AI agent not initialized. Call initAI() first.');
  }
  return agent.query(request);
}

/** Get the agent's current conversation history */
export function getAIHistory() {
  return agent?.getHistory() ?? [];
}

/** Clear the agent's conversation history */
export function clearAIHistory(): void {
  agent?.clearHistory();
}

/** Get agent status */
export function getAIStatus(): AgentState | null {
  return agent?.getState() ?? null;
}

/** Set the model for future queries */
export function setAIModel(model: string): void {
  agent?.setModel(model);
}

/** Check if the agent is initialized */
export function isAIReady(): boolean {
  return agent !== null;
}

/** Get available tool names */
export function getAIToolNames(): string[] {
  return agent?.getToolNames() ?? [];
}

// Re-export types for consumers
export type { QueryRequest, QueryResponse, AgentState, AgentConfig } from './types';
