import { type Component, For, Show, createEffect, onCleanup, onMount, createSignal } from 'solid-js';
import type { WatcherState, WatcherStatus } from '../types';
import {
  state,
  setWatcherStatus,
  ensureLayout,
  moveWindowToCell,
  resizeWindow,
  GRID_COLS,
} from '../store/appStore';
import { WatcherCard } from './WatcherCard';
import { detectStaleWatchers } from '../engine/pluginRegistry';

// Grid geometry (px). Kept in JS so drag/resize math matches the CSS grid.
const ROW_H = 240;
const GAP = 12;
const PAD = 16;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

interface DragState {
  id: string;
  colSpan: number;
  rowSpan: number;
  previewCol: number;
  previewRow: number;
}

interface ResizeState {
  id: string;
  startX: number;
  startY: number;
  startColSpan: number;
  startRowSpan: number;
}

export const Dashboard: Component = () => {
  let container: HTMLDivElement | undefined;

  // Responsive column count (max GRID_COLS at wide widths).
  const [colCount, setColCount] = createSignal(GRID_COLS);
  const [drag, setDrag] = createSignal<DragState | null>(null);
  const [resize, setResize] = createSignal<ResizeState | null>(null);

  // Stable order (by id) so the DOM never reorders on move/resize/maximize — the whole
  // reason component state (e.g. YouTube playback) survives being moved around.
  const visibleWindows = () =>
    Object.values(state.watchers)
      .filter((w) => !w.minimized)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  onMount(() => {
    if (!container) return;
    const update = () => {
      const w = container!.clientWidth;
      if (w > 1400) setColCount(GRID_COLS);
      else if (w > 1000) setColCount(3);
      else if (w > 640) setColCount(2);
      else setColCount(1);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    onCleanup(() => ro.disconnect());
  });

  // Periodic stale detection (unchanged behaviour).
  createEffect(() => {
    const timer = setInterval(() => {
      detectStaleWatchers((id, status, error) => {
        setWatcherStatus(id, status as WatcherStatus, error);
      });
    }, 30_000);
    onCleanup(() => clearInterval(timer));
  });

  // Reset scroll when maximizing so the absolute-filled window covers the visible area.
  createEffect(() => {
    if (state.maximizedWatcher && container) container.scrollTop = 0;
  });

  function cellMetrics() {
    const rect = container!.getBoundingClientRect();
    const cols = colCount();
    const innerW = rect.width - PAD * 2;
    const cellW = (innerW - GAP * (cols - 1)) / cols;
    return { rect, cols, cellW, cellH: ROW_H };
  }

  // ─── DRAG (move) ───
  function onDragStart(id: string, e: PointerEvent) {
    e.preventDefault();
    const l = ensureLayout(state.watchers[id], colCount());
    setDrag({ id, colSpan: l.colSpan, rowSpan: l.rowSpan, previewCol: l.gridCol, previewRow: l.gridRow });
  }

  // ─── RESIZE (span) ───
  function onResizeStart(id: string, e: PointerEvent) {
    e.preventDefault();
    e.stopPropagation();
    const l = ensureLayout(state.watchers[id], colCount());
    setResize({ id, startX: e.clientX, startY: e.clientY, startColSpan: l.colSpan, startRowSpan: l.rowSpan });
  }

  onMount(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag();
      const r = resize();
      if (d) {
        const { rect, cols, cellW, cellH } = cellMetrics();
        const x = e.clientX - rect.left - PAD;
        const y = e.clientY - rect.top - PAD + (container?.scrollTop ?? 0);
        const col = clamp(Math.floor(x / (cellW + GAP)), 0, cols - d.colSpan);
        const row = Math.max(0, Math.floor(y / (cellH + GAP)));
        if (col !== d.previewCol || row !== d.previewRow) {
          setDrag({ ...d, previewCol: col, previewRow: row });
        }
      } else if (r) {
        const { cols, cellW, cellH } = cellMetrics();
        const dCols = Math.round((e.clientX - r.startX) / (cellW + GAP));
        const dRows = Math.round((e.clientY - r.startY) / (cellH + GAP));
        const newColSpan = clamp(r.startColSpan + dCols, 1, cols);
        const newRowSpan = Math.max(1, r.startRowSpan + dRows);
        resizeWindow(r.id, newColSpan, newRowSpan, cols);
      }
    };
    const onUp = () => {
      const d = drag();
      if (d) {
        moveWindowToCell(d.id, d.previewCol, d.previewRow, colCount());
        setDrag(null);
      }
      if (resize()) setResize(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    onCleanup(() => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    });
  });

  function windowStyle(w: WatcherState): Record<string, string | number> {
    if (state.maximizedWatcher === w.id) {
      return { position: 'absolute', inset: '0', 'z-index': 50 };
    }
    const l = ensureLayout(w, colCount());
    const isDragging = drag()?.id === w.id;
    return {
      'grid-column': `${l.gridCol + 1} / span ${l.colSpan}`,
      'grid-row': `${l.gridRow + 1} / span ${l.rowSpan}`,
      'z-index': isDragging ? 40 : state.selectedWatcher === w.id ? 2 : 1,
      'min-height': 0,
      'min-width': 0,
    };
  }

  return (
    <div
      ref={container}
      style={{
        flex: 1,
        padding: `${PAD}px`,
        'overflow-y': state.maximizedWatcher ? 'hidden' : 'auto',
        position: 'relative',
        'z-index': 1,
        display: 'grid',
        'grid-template-columns': `repeat(${colCount()}, minmax(0, 1fr))`,
        'grid-auto-rows': `${ROW_H}px`,
        gap: `${GAP}px`,
        'align-content': 'start',
      }}
    >
      <Show when={visibleWindows().length === 0}>
        <div
          style={{
            'grid-column': '1 / -1',
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
            No Windows
          </div>
          <div style={{ 'font-size': '11px', 'max-width': '300px' }}>
            Click <span style={{ color: 'var(--accent-cyan)' }}>+ Add Watcher</span> in the sidebar to start monitoring.
          </div>
        </div>
      </Show>

      {/* Capture overlay while dragging/resizing so pointer events keep firing even
          over cross-origin iframes (e.g. a playing YouTube video would otherwise
          swallow pointermove and freeze the drag). */}
      <Show when={drag() || resize()}>
        <div
          style={{
            position: 'fixed',
            inset: 0,
            'z-index': 9998,
            cursor: resize() ? 'nwse-resize' : 'grabbing',
          }}
        />
      </Show>

      {/* Snap preview while dragging */}
      <Show when={drag()}>
        {(d) => (
          <div
            style={{
              'grid-column': `${d().previewCol + 1} / span ${d().colSpan}`,
              'grid-row': `${d().previewRow + 1} / span ${d().rowSpan}`,
              'z-index': 30,
              border: '1px dashed var(--accent-cyan)',
              background: 'rgba(0, 229, 255, 0.06)',
              'border-radius': '2px',
              'pointer-events': 'none',
            }}
          />
        )}
      </Show>

      {/* Windows — one stable-keyed node each; layout is style-only */}
      <For each={visibleWindows()}>
        {(watcher) => (
          <div style={windowStyle(watcher)}>
            <WatcherCard
              watcher={watcher}
              onDragStart={(e) => onDragStart(watcher.id, e)}
              onResizeStart={(e) => onResizeStart(watcher.id, e)}
            />
          </div>
        )}
      </For>
    </div>
  );
};
