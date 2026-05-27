import { type Component, For, Show, createSignal, createEffect, onMount, onCleanup } from 'solid-js';
import { queryAI, getAIHistory, clearAIHistory, isAIReady, getAIStatus, getAIToolNames, setAIModel } from '../ai';
import type { QueryResponse } from '../ai/types';
import { Markdown } from './Markdown';

// ─── AI CHAT PANEL ───
// Full-featured chat overlay with:
// - Message history with timestamps
// - Tool call visualization (pending → executing → result)
// - Model selector
// - Clear conversation
// - Typing indicator
// - Error recovery
// - Enter to send, Shift+Enter for newline

interface Props {
  open: boolean;
  onClose: () => void;
}

type MessageStatus = 'sending' | 'done' | 'error';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  status: MessageStatus;
  toolCalls?: { name: string; args: string; output: string; error?: string }[];
}

export const AIChat: Component<Props> = (props) => {
  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [input, setInput] = createSignal('');
  const [isProcessing, setIsProcessing] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [model, setModel] = createSignal('');
  const [availableModels, setAvailableModels] = createSignal<string[]>([]);
  const [showModelPicker, setShowModelPicker] = createSignal(false);
  const [isReady, setIsReady] = createSignal(false);
  const [modelsLoading, setModelsLoading] = createSignal(true);
  const [modelsError, setModelsError] = createSignal<string | null>(null);

  let chatEndRef: HTMLDivElement | undefined;
  let inputRef: HTMLTextAreaElement | undefined;

  // Load history on open
  createEffect(() => {
    if (props.open) {
      const ready = isAIReady();
      setIsReady(ready);
      const history = getAIHistory();
      const loaded: ChatMessage[] = history
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
          timestamp: Date.now(),
          status: 'done' as MessageStatus,
        }));
      setMessages(loaded);
    }
  });

  // Poll Ollama for available models every 30s
  async function fetchModels() {
    try {
      setModelsLoading(true);
      setModelsError(null);
      const resp = await fetch('http://localhost:11434/api/tags', {
        signal: AbortSignal.timeout(5000),
      });
      if (!resp.ok) {
        setModelsError(`HTTP ${resp.status}`);
        return;
      }
      const data = await resp.json();
      const models = (data.models || []).map((m: any) => m.name);
      setAvailableModels(models);
      setModelsLoading(false);

      // If current model isn't available or not set, switch to the first one
      if (models.length > 0 && (!model() || !models.includes(model()))) {
        const preferred = models.find((m: string) => m.startsWith('qwen') || m.startsWith('granite') || m.startsWith('llama')) || models[0];
        setModel(preferred);
        setAIModel(preferred);
      }
    } catch (err) {
      setModelsError('Ollama unreachable');
      setModelsLoading(false);
    }
  }

  onMount(() => {
    fetchModels();
    const timer = setInterval(fetchModels, 30_000);
    onCleanup(() => clearInterval(timer));
  });

  // Auto-scroll to bottom
  createEffect(() => {
    messages();
    requestAnimationFrame(() => {
      chatEndRef?.scrollIntoView({ behavior: 'smooth' });
    });
  });

  // Focus input when opened
  createEffect(() => {
    if (props.open) {
      requestAnimationFrame(() => inputRef?.focus());
    }
  });

  async function handleSend() {
    const text = input().trim();
    if (!text || isProcessing()) return;

    setError(null);
    setInput('');
    setIsProcessing(true);

    // Add user message
    const userMsg: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
      status: 'sending',
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const result: QueryResponse = await queryAI({
        message: text,
        model: model(),
      });

      // Update user message to done
      setMessages((prev) =>
        prev.map((m, i) => (i === prev.length - 1 && m.role === 'user' ? { ...m, status: 'done' as MessageStatus } : m)),
      );

      // Add assistant message with tool calls
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: result.response,
        timestamp: Date.now(),
        status: 'done',
        toolCalls: result.toolCalls.map((tc) => ({
          name: tc.call.name,
          args: JSON.stringify(tc.call.arguments),
          output: tc.output,
          error: tc.error,
        })),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      // Update user message to error
      setMessages((prev) =>
        prev.map((m, i) => (i === prev.length - 1 && m.role === 'user' ? { ...m, status: 'error' as MessageStatus } : m)),
      );
      setError(`Failed to get response: ${String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleClear() {
    clearAIHistory();
    setMessages([]);
    setError(null);
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  }

  return (
    <Show when={props.open}>
      {/* Backdrop */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          'z-index': 999,
          backdropFilter: 'blur(2px)',
        }}
        onClick={props.onClose}
      />

      {/* Chat panel */}
      <div
        class="chat-panel-enter"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 'min(560px, 85vw)',
          'z-index': 1000,
          display: 'flex',
          'flex-direction': 'column',
          background: 'rgba(10, 10, 26, 0.82)',
          'backdrop-filter': 'blur(12px)',
          'border-left': '1px solid var(--border)',
          'box-shadow': '-8px 0 32px rgba(0, 0, 0, 0.5)',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            gap: '8px',
            padding: '12px 16px',
            'border-bottom': '1px solid var(--border)',
            'flex-shrink': 0,
          }}
        >
          <div
            style={{
              width: '24px',
              height: '24px',
              border: '1px solid var(--accent-cyan)',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              'font-size': '12px',
              color: 'var(--accent-cyan)',
              'clip-path': 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)',
            }}
          >
            ◆
          </div>
          <span
            style={{
              'font-size': '12px',
              'text-transform': 'uppercase',
              'letter-spacing': '0.1em',
              color: 'var(--accent-cyan)',
              flex: 1,
            }}
          >
            BPD AI
          </span>

          {/* Model selector */}
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowModelPicker((v) => !v)}
              style={{
                background: 'transparent',
                border: `1px solid ${modelsError() ? 'var(--accent-red)' : 'var(--border)'}`,
                color: modelsError() ? 'var(--accent-red)' : 'var(--text-muted)',
                padding: '2px 6px',
                'font-family': 'var(--font-mono)',
                'font-size': '9px',
                cursor: 'pointer',
              }}
              title={modelsError() ? modelsError()! : `${availableModels().length} models available`}
            >
              <Show when={modelsLoading()}>
                <span style={{ 'margin-right': '4px', animation: 'spin 0.8s linear infinite', display: 'inline-block' }}>⟳</span>
              </Show>
              {model().split(':')[0].slice(0, 12)} ▾
            </button>
            <Show when={showModelPicker()}>
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 4px)',
                  right: 0,
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  'min-width': '180px',
                  'max-height': '240px',
                  overflow: 'auto',
                  'z-index': 100,
                }}
              >
                {/* Header with count */}
                <div
                  style={{
                    padding: '4px 10px',
                    'font-size': '9px',
                    color: 'var(--text-dim)',
                    'border-bottom': '1px solid var(--border)',
                    display: 'flex',
                    'justify-content': 'space-between',
                  }}
                >
                  <span>Available models</span>
                  <span>{availableModels().length}</span>
                </div>

                <Show when={modelsLoading()}>
                  <div
                    style={{
                      padding: '12px 10px',
                      'font-size': '10px',
                      color: 'var(--text-dim)',
                      'text-align': 'center',
                    }}
                  >
                    Fetching models...
                  </div>
                </Show>

                <Show when={modelsError()}>
                  <div
                    style={{
                      padding: '8px 10px',
                      'font-size': '10px',
                      color: 'var(--accent-red)',
                      'text-align': 'center',
                      'border-bottom': '1px solid var(--border)',
                    }}
                  >
                    {modelsError()}
                  </div>
                </Show>

                <For each={availableModels()}>
                  {(m) => (
                    <div
                      onClick={() => {
                        setModel(m);
                        setAIModel(m);
                        setShowModelPicker(false);
                      }}
                      style={{
                        padding: '6px 10px',
                        cursor: 'pointer',
                        color: model() === m ? 'var(--accent-cyan)' : 'var(--text-primary)',
                        'font-size': '10px',
                        'font-family': 'var(--font-mono)',
                        'border-bottom': '1px solid var(--border)',
                      }}
                    >
                      {m}
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Clear button */}
          <button
            onClick={handleClear}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              width: '20px',
              height: '20px',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              'font-size': '10px',
              cursor: 'pointer',
              padding: 0,
            }}
            title="Clear conversation"
          >
            🗑
          </button>

          {/* Close button */}
          <button
            onClick={props.onClose}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              width: '20px',
              height: '20px',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              'font-size': '10px',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            ✕
          </button>
        </div>

        {/* Status bar */}
        <div
          style={{
            padding: '6px 16px',
            'font-size': '9px',
            color: isReady() ? 'var(--accent-green)' : 'var(--accent-red)',
            'border-bottom': '1px solid var(--border)',
            'flex-shrink': 0,
            display: 'flex',
            'justify-content': 'space-between',
          }}
        >
          <span>
            {isReady() ? `● Agent ready (${getAIToolNames().length} tools)` : '○ Agent not initialized'}
          </span>
          <span style={{ color: 'var(--text-dim)' }}>{messages().length} messages</span>
        </div>

        {/* Messages area */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: '12px 16px',
            display: 'flex',
            'flex-direction': 'column',
            gap: '12px',
          }}
        >
          {/* Welcome message */}
          <Show when={messages().length === 0}>
            <div
              style={{
                display: 'flex',
                'flex-direction': 'column',
                'align-items': 'center',
                'justify-content': 'center',
                gap: '12px',
                padding: '40px 20px',
                color: 'var(--text-dim)',
                'text-align': 'center',
              }}
            >
              <div style={{ 'font-size': '28px', color: 'var(--accent-cyan)', opacity: 0.4 }}>◆</div>
              <div style={{ 'font-size': '12px', 'text-transform': 'uppercase', 'letter-spacing': '0.1em' }}>
                BPD AI Assistant
              </div>
              <div style={{ 'font-size': '10px', 'max-width': '260px', 'line-height': 1.6 }}>
                Ask me about your watchers, events, alerts, or dashboard state.
                I can also add new watchers and manage your monitoring setup.
              </div>
              <div style={{ 'font-size': '9px', color: 'var(--text-dim)', 'margin-top': '8px' }}>
                Try: "What am I monitoring?" or "Show me recent alerts"
              </div>
            </div>
          </Show>

          <For each={messages()}>
            {(msg) => (
              <div
                style={{
                  display: 'flex',
                  'flex-direction': 'column',
                  'align-items': msg.role === 'user' ? 'flex-end' : 'flex-start',
                  gap: '4px',
                }}
              >
                {/* Timestamp */}
                <div style={{ 'font-size': '8px', color: 'var(--text-dim)', 'font-family': 'var(--font-mono)' }}>
                  {formatTime(msg.timestamp)}
                </div>

                {/* Message bubble */}
                <div
                  style={{
                    'max-width': '85%',
                    padding: '8px 12px',
                    'border-radius': msg.role === 'user' ? '8px 8px 2px 8px' : '8px 8px 8px 2px',
                    background: msg.role === 'user'
                      ? 'rgba(0, 229, 255, 0.1)'
                      : 'rgba(255, 255, 255, 0.05)',
                    border: `1px solid ${
                      msg.role === 'user'
                        ? msg.status === 'error'
                          ? 'var(--accent-red)'
                          : 'rgba(0, 229, 255, 0.3)'
                        : 'var(--border)'
                    }`,
                    'font-size': '11px',
                    'line-height': 1.6,
                    color: msg.status === 'error' ? 'var(--accent-red)' : 'var(--text-primary)',
                    'white-space': msg.role === 'user' ? 'pre-wrap' : 'normal',
                    'word-break': 'break-word',
                  }}
                >
                  {msg.status === 'sending' && msg.role === 'user' ? (
                    <span style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}>
                      {msg.content}
                      <span
                        style={{
                          display: 'inline-block',
                          width: '6px',
                          height: '6px',
                          border: '1px solid var(--accent-cyan)',
                          'border-top-color': 'transparent',
                          'border-radius': '50%',
                          animation: 'spin 0.8s linear infinite',
                        }}
                      />
                    </span>
                  ) : msg.role === 'user' ? (
                    msg.content
                  ) : (
                    <Markdown content={msg.content} />
                  )}
                </div>

                {/* Tool calls visualization */}
                <Show when={msg.toolCalls && msg.toolCalls.length > 0}>
                  <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', width: '100%' }}>
                    <For each={msg.toolCalls!}>
                      {(tc) => (
                        <div
                          style={{
                            padding: '6px 8px',
                            background: tc.error
                              ? 'rgba(255, 82, 82, 0.08)'
                              : 'rgba(0, 0, 0, 0.2)',
                            border: `1px solid ${tc.error ? 'rgba(255, 82, 82, 0.3)' : 'var(--border)'}`,
                            'border-radius': '2px',
                            'font-size': '9px',
                            'font-family': 'var(--font-mono)',
                          }}
                        >
                          <div style={{ display: 'flex', 'align-items': 'center', gap: '6px', 'margin-bottom': '4px' }}>
                            <span style={{ color: 'var(--accent-cyan)' }}>⚡</span>
                            <span style={{ color: 'var(--accent-cyan)', 'font-weight': 600 }}>{tc.name}</span>
                            {tc.error && (
                              <span style={{ color: 'var(--accent-red)', 'margin-left': 'auto' }}>ERROR</span>
                            )}
                          </div>
                          <Show when={tc.args && tc.args !== '{}'}>
                            <div style={{ color: 'var(--text-dim)', 'margin-bottom': '3px' }}>
                              args: {tc.args.slice(0, 100)}{tc.args.length > 100 ? '...' : ''}
                            </div>
                          </Show>
                          <div style={{ color: tc.error ? 'var(--accent-red)' : 'var(--text-muted)', 'max-height': '60px', overflow: 'auto', 'white-space': 'pre-wrap' }}>
                            {(() => {
                              const text = tc.error ? tc.error : (tc.output || '(no output)');
                              return text.length > 300 ? text.slice(0, 300) + '...' : text;
                            })()}
                          </div>
                        </div>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>

          {/* Typing indicator */}
          <Show when={isProcessing()}>
            <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', padding: '4px 0' }}>
              <div
                style={{
                  width: '8px',
                  height: '8px',
                  border: '1px solid var(--accent-cyan)',
                  'border-top-color': 'transparent',
                  'border-radius': '50%',
                  animation: 'spin 0.8s linear infinite',
                }}
              />
              <span style={{ 'font-size': '10px', color: 'var(--accent-cyan)' }}>
                {messages().length > 0 && messages()[messages().length - 1].status === 'sending'
                  ? 'Processing...'
                  : 'Thinking...'}
              </span>
            </div>
          </Show>

          {/* Error banner */}
          <Show when={error()}>
            <div
              style={{
                padding: '8px 12px',
                background: 'rgba(255, 82, 82, 0.1)',
                border: '1px solid rgba(255, 82, 82, 0.3)',
                'border-radius': '2px',
                'font-size': '10px',
                color: 'var(--accent-red)',
              }}
            >
              ⚠ {error()}
            </div>
          </Show>

          <div ref={chatEndRef} />
        </div>

        {/* Input area */}
        <div
          style={{
            padding: '12px 16px',
            'border-top': '1px solid var(--border)',
            'flex-shrink': 0,
            display: 'flex',
            gap: '8px',
            'align-items': 'flex-end',
          }}
        >
          <textarea
            ref={inputRef}
            value={input()}
            onInput={(e) => setInput(e.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder={isReady() ? 'Ask about your dashboard...' : 'AI not initialized'}
            rows={1}
            disabled={!isReady() || isProcessing()}
            style={{
              flex: 1,
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid var(--border)',
              color: 'var(--text-primary)',
              padding: '8px 10px',
              'font-family': 'var(--font-mono)',
              'font-size': '11px',
              'border-radius': '2px',
              resize: 'none',
              'min-height': '32px',
              'max-height': '100px',
              outline: 'none',
              'line-height': 1.5,
              opacity: !isReady() || isProcessing() ? 0.5 : 1,
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input().trim() || !isReady() || isProcessing()}
            style={{
              width: '32px',
              height: '32px',
              background: input().trim() && isReady() && !isProcessing()
                ? 'rgba(0, 229, 255, 0.2)'
                : 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${input().trim() && isReady() && !isProcessing() ? 'var(--accent-cyan)' : 'var(--border)'}`,
              color: input().trim() && isReady() && !isProcessing() ? 'var(--accent-cyan)' : 'var(--text-dim)',
              'font-size': '14px',
              cursor: input().trim() && isReady() && !isProcessing() ? 'pointer' : 'not-allowed',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              padding: 0,
              'border-radius': '2px',
              'clip-path': 'polygon(4px 0, 100% 0, 100% calc(100% - 4px), calc(100% - 4px) 100%, 0 100%, 0 4px)',
              transition: 'all 0.15s',
            }}
          >
            ▸
          </button>
        </div>
      </div>
    </Show>
  );
};
