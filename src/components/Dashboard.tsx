import { type Component, For, Show, createEffect, onCleanup, createMemo, createSignal, onMount } from 'solid-js';
import type { WatcherState, WatcherStatus } from '../types';
import { getOrderedWatchers, setWatcherStatus } from '../store/appStore';
import { WatcherCard } from './WatcherCard';
import { detectStaleWatchers } from '../engine/pluginRegistry';

// ─── MASONRY: round-robin distribution into N columns ───
function masonryLayout(items: WatcherState[], colCount: number): WatcherState[][] {
  const columns: WatcherState[][] = Array.from({ length: colCount }, () => []);
  items.forEach((item, i) => {
    columns[i % colCount].push(item);
  });
  return columns;
}

export const Dashboard: Component = () => {
  const watcherList = () => getOrderedWatchers();

  // Responsive column count based on container width
  const [colCount, setColCount] = createSignal(4);
  let containerRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!containerRef) return;
    const update = () => {
      const w = containerRef!.clientWidth;
      if (w > 1400) setColCount(4);
      else if (w > 1000) setColCount(3);
      else if (w > 640) setColCount(2);
      else setColCount(1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());
  });

  const columns = createMemo(() => masonryLayout(watcherList(), colCount()));

  // Periodic stale detection: check every 30s
  createEffect(() => {
    const timer = setInterval(() => {
      detectStaleWatchers((id, status, error) => {
        setWatcherStatus(id, status as WatcherStatus, error);
      });
    }, 30_000);
    onCleanup(() => clearInterval(timer));
  });

  return (
    <div
      ref={containerRef}
      style={{
        flex: 1,
        padding: '16px',
        'overflow-y': 'auto',
        position: 'relative',
        'z-index': 1,
      }}
    >
      <Show when={watcherList().length === 0}>
        <div
          style={{
            display: 'flex',
            'flex-direction': 'column',
            'align-items': 'center',
            'justify-content': 'center',
            gap: '12px',
            padding: '80px 20px',
            color: 'var(--text-dim)',
            'text-align': 'center',
          }}
        >
          <div style={{ 'font-size': '32px', color: 'var(--text-dim)', opacity: 0.3 }}>⊘</div>
          <div style={{ 'font-size': '14px', 'text-transform': 'uppercase', 'letter-spacing': '0.15em' }}>
            No Watchers
          </div>
          <div style={{ 'font-size': '11px', 'max-width': '300px' }}>
            Click <span style={{ color: 'var(--accent-cyan)' }}>+ Add Watcher</span> in the sidebar to start monitoring.
          </div>
        </div>
      </Show>

      {/* Masonry columns */}
      <div style={{ display: 'flex', gap: '12px', 'align-items': 'flex-start' }}>
        <For each={columns()}>
          {(col) => (
            <div style={{ flex: 1, display: 'flex', 'flex-direction': 'column', gap: '12px', 'min-width': 0 }}>
              <For each={col}>
                {(watcher) => <WatcherCard watcher={watcher} />}
              </For>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
