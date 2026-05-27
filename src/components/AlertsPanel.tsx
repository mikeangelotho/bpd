import { type Component, For, Show, createMemo } from 'solid-js';
import { state, acknowledgeAlert, clearAcknowledgedAlerts } from '../store/appStore';
import type { Alert } from '../types';

export const AlertsPanel: Component = () => {
  const pendingAlerts = createMemo(() =>
    state.alerts.filter((a) => !a.acknowledged).reverse()
  );

  const historyAlerts = createMemo(() =>
    state.alerts.filter((a) => a.acknowledged).reverse().slice(0, 20)
  );

  const formatTime = (ts: number): string => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const severityColor = (sev: Alert['severity']): string => {
    if (sev === 'error') return 'var(--accent-red)';
    if (sev === 'warn') return 'var(--accent-amber)';
    return 'var(--accent-cyan)';
  };

  const severityIcon = (sev: Alert['severity']): string => {
    if (sev === 'error') return '⊘';
    if (sev === 'warn') return '⚠';
    return '◈';
  };

  return (
    <div
      style={{
        flex: 1,
        padding: '16px',
        'overflow-y': 'auto',
        position: 'relative',
        'z-index': 1,
        display: 'flex',
        'flex-direction': 'column',
        gap: '16px',
      }}
    >
      {/* Pending alerts */}
      <div>
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'space-between',
            'margin-bottom': '8px',
          }}
        >
          <span style={{
            'font-size': '10px',
            'text-transform': 'uppercase',
            'letter-spacing': '0.1em',
            color: 'var(--text-muted)',
          }}>
            Pending ({pendingAlerts().length})
          </span>
          <Show when={pendingAlerts().length > 0}>
            <button
              onClick={clearAcknowledgedAlerts}
              style={{
                background: 'transparent',
                border: '1px solid var(--border)',
                color: 'var(--text-muted)',
                padding: '2px 8px',
                'font-family': 'var(--font-mono)',
                'font-size': '10px',
                cursor: 'pointer',
              }}
            >
              Clear All
            </button>
          </Show>
        </div>

        <Show when={pendingAlerts().length === 0}>
          <div style={{ color: 'var(--text-dim)', 'font-size': '11px', padding: '20px 0', 'text-align': 'center' }}>
            All clear — no pending alerts
          </div>
        </Show>

        <For each={pendingAlerts()}>
          {(alert) => (
            <div
              onClick={() => acknowledgeAlert(alert.id)}
              style={{
                display: 'flex',
                'align-items': 'flex-start',
                gap: '10px',
                padding: '8px 10px',
                background: 'var(--bg-card)',
                border: `1px solid var(--border)`,
                'border-left': `2px solid ${severityColor(alert.severity)}`,
                'margin-bottom': '4px',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'rgba(0, 229, 255, 0.03)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = 'var(--bg-card)';
              }}
            >
              <span style={{
                color: severityColor(alert.severity),
                'font-size': '12px',
                'flex-shrink': 0,
                'margin-top': '1px',
              }}>
                {severityIcon(alert.severity)}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ 'font-size': '11px', color: 'var(--text-primary)' }}>
                  {alert.message}
                </div>
                <div style={{ 'font-size': '10px', color: 'var(--text-dim)', 'margin-top': '2px' }}>
                  {alert.watcherName} · {formatTime(alert.timestamp)}
                </div>
              </div>
            </div>
          )}
        </For>
      </div>

      {/* History */}
      <Show when={historyAlerts().length > 0}>
        <div>
          <span style={{
            'font-size': '10px',
            'text-transform': 'uppercase',
            'letter-spacing': '0.1em',
            color: 'var(--text-dim)',
          }}>
            History ({state.alerts.filter((a) => a.acknowledged).length})
          </span>
          <For each={historyAlerts()}>
            {(alert) => (
              <div
                style={{
                  display: 'flex',
                  'align-items': 'flex-start',
                  gap: '10px',
                  padding: '6px 10px',
                  opacity: 0.5,
                  'font-size': '10px',
                }}
              >
                <span style={{ color: 'var(--text-dim)', 'flex-shrink': 0 }}>
                  {formatTime(alert.timestamp)}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>
                  {alert.message}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
