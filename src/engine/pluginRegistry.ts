import type { WatcherPlugin, PluginRegistration } from '../types';

// ─── REGISTRY ───
const registry = new Map<string, PluginRegistration>();

export function registerPlugin<T>(
  plugin: WatcherPlugin<T>,
  config: Record<string, unknown> = {}
): void {
  registry.set(plugin.id, { plugin, config });
}

export function getPlugin(id: string): PluginRegistration | undefined {
  return registry.get(id);
}

export function getAllPlugins(): PluginRegistration[] {
  return Array.from(registry.values());
}

export function unregisterPlugin(id: string): void {
  registry.delete(id);
}

// ─── CRON PARSER ───
// Parses standard 5-field cron expressions: minute hour dayOfMonth month dayOfWeek
// Returns milliseconds until the next scheduled time

export function nextCronMs(cron: string): number {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression: "${cron}". Expected 5 fields (min hour dom month dow)`);
  }

  const [minPattern, hourPattern, domPattern, monthPattern, dowPattern] = fields;
  const now = new Date();

  // Try each minute for the next 366 days
  const maxMs = 366 * 24 * 60 * 60 * 1000;
  let check = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 0, 0);

  for (let ms = 0; ms < maxMs; ms += 60_000) {
    if (
      matchField(check.getMinutes(), minPattern) &&
      matchField(check.getHours(), hourPattern) &&
      matchField(check.getDate(), domPattern) &&
      matchField(check.getMonth() + 1, monthPattern) &&
      matchField(check.getDay(), dowPattern)
    ) {
      return check.getTime() - now.getTime();
    }
    check = new Date(check.getTime() + 60_000);
  }

  throw new Error(`No matching time found for cron: "${cron}"`);
}

function matchField(value: number, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.includes(',')) {
    return pattern.split(',').some((part) => matchSingle(value, part.trim()));
  }
  if (pattern.includes('-')) {
    const parts = pattern.split('-');
    const start = parseInt(parts[0], 10);
    const end = parseInt(parts[1], 10);
    return value >= start && value <= end;
  }
  if (pattern.includes('/')) {
    const parts = pattern.split('/');
    const base = parts[0] === '*' ? 0 : parseInt(parts[0], 10);
    const step = parseInt(parts[1], 10);
    return value >= base && (value - base) % step === 0;
  }
  return matchSingle(value, pattern);
}

function matchSingle(value: number, pattern: string): boolean {
  return parseInt(pattern, 10) === value;
}

// ─── CRON DESCRIPTION ───
// Human-readable description of a cron expression

export function describeCron(cron: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return cron;

  const [min, hour, dom, month, dow] = fields;

  // Common patterns
  if (min === '0' && hour === '9' && dom === '*' && month === '*' && dow === '*') return 'Daily at 9:00 AM';
  if (min === '0' && hour === '0' && dom === '*' && month === '*' && dow === '*') return 'Daily at midnight';
  if (min === '0' && hour === '12' && dom === '*' && month === '*' && dow === '*') return 'Daily at noon';
  if (min === '30' && hour === '9' && dom === '*' && month === '*' && dow === '1-5') return 'Weekdays at 9:30 AM';
  if (min === '0' && hour === '0' && dom === '*' && month === '*' && dow === '2') return 'Every Tuesday at midnight';
  if (min === '0' && hour === '9' && dom === '1' && month === '*' && dow === '*') return '1st of each month at 9:00 AM';

  // Generic description
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const timeStr = `${pad(hour)}:${pad(min)}`;

  if (dom === '*' && month === '*' && dow !== '*') {
    return `Every ${dow === '1-5' ? 'weekday' : days[parseInt(dow, 10)]} at ${timeStr}`;
  }
  if (dom !== '*' && month === '*' && dow === '*') {
    return `${dom}th of each month at ${timeStr}`;
  }
  return `${timeStr} ${dom}/${month}/${dow === '*' ? '*' : days[parseInt(dow, 10)]}`;
}

function pad(n: string): string {
  const num = parseInt(n, 10);
  return num < 10 ? `0${num}` : `${num}`;
}

// ─── SCHEDULING ───

interface ScheduledWatcher {
  watcherId: string;
  scheduleMode: 'interval' | 'cron';
  interval: number;
  cron?: string;
  timerId: ReturnType<typeof setTimeout> | null;
  running: boolean;
  runningSince: number; // epoch ms, for stuck-fetch detection
  failCount: number;     // consecutive failure counter
  lastSuccess: number;   // epoch ms of last successful fetch
  fetchFn: (() => Promise<void>) | null;
}

const scheduled = new Map<string, ScheduledWatcher>();

// Max consecutive failures before hard backoff cap
const MAX_FAIL_COUNT = 6;
// Base delay for backoff (ms)
const BACKOFF_BASE = 5000;
// Max backoff delay (5 minutes)
const BACKOFF_MAX = 300_000;
// Stale threshold multiplier
const STALE_MULTIPLIER = 3;
// Stuck fetch timeout (3x interval, min 10s, max 60s)
function stuckFetchTimeout(interval: number): number {
  return Math.max(10_000, Math.min(60_000, interval * 3));
}

export function scheduleWatcher(
  watcherId: string,
  interval: number,
  fetchFn: () => Promise<void>,
  scheduleMode: 'interval' | 'cron' = 'interval',
  cron?: string,
): void {
  cancelWatcher(watcherId);

  const entry: ScheduledWatcher = {
    watcherId,
    scheduleMode,
    interval,
    cron,
    timerId: null,
    running: false,
    runningSince: 0,
    failCount: 0,
    lastSuccess: 0,
    fetchFn,
  };

  if (scheduleMode === 'cron' && cron) {
    const scheduleCron = () => {
      if (entry.running) return;
      entry.running = true;
      entry.runningSince = Date.now();

      const timeout = stuckFetchTimeout(entry.interval);
      const stuckGuard = setTimeout(() => {
        if (entry.running) {
          console.warn(`[scheduler] ${watcherId}: fetch stuck after ${timeout}ms, aborting`);
          entry.running = false;
          entry.failCount = Math.min(entry.failCount + 1, MAX_FAIL_COUNT);
        }
      }, timeout);

      fetchFn()
        .then(() => {
          entry.failCount = 0;
          entry.lastSuccess = Date.now();
        })
        .catch(() => { })
        .finally(() => {
          clearTimeout(stuckGuard);
          entry.running = false;

          // Self-healing: reset after prolonged failures
          if (entry.failCount >= MAX_FAIL_COUNT && entry.lastSuccess > 0) {
            const timeAtMaxFail = Date.now() - entry.lastSuccess;
            if (timeAtMaxFail > 15 * 60 * 1000) {
              console.log(`[scheduler] ${watcherId}: auto-recovering after ${Math.round(timeAtMaxFail / 1000)}s at max backoff`);
              entry.failCount = 0;
            }
          }

          try {
            const delay = nextCronMs(cron);
            entry.timerId = setTimeout(scheduleCron, delay);
          } catch {
            // Invalid cron — fall back to interval
            entry.timerId = setTimeout(scheduleCron, interval);
          }
        });
    };

    // Schedule first run
    try {
      const delay = nextCronMs(cron);
      entry.timerId = setTimeout(scheduleCron, delay);
    } catch {
      // Invalid cron — run immediately then fall back
      scheduleCron();
    }
  } else {
    // Interval mode with backoff
    const tick = async () => {
      if (entry.running) return;
      entry.running = true;
      entry.runningSince = Date.now();

      const timeout = stuckFetchTimeout(entry.interval);
      const stuckGuard = setTimeout(() => {
        if (entry.running) {
          console.warn(`[scheduler] ${watcherId}: fetch stuck after ${timeout}ms, aborting`);
          entry.running = false;
          entry.failCount = Math.min(entry.failCount + 1, MAX_FAIL_COUNT);
        }
      }, timeout);

      try {
        await fetchFn();
        entry.failCount = 0;
        entry.lastSuccess = Date.now();
      } catch (err) {
        // Detect CoinGecko 429 rate-limit errors — jump straight to long backoff
        const isRateLimit = err instanceof Error && err.name === 'CoinGeckoRateLimitError';
        if (isRateLimit) {
          entry.failCount = MAX_FAIL_COUNT; // force max backoff (5 min cooldown)
        } else {
          entry.failCount = Math.min(entry.failCount + 1, MAX_FAIL_COUNT);
        }
      } finally {
        clearTimeout(stuckGuard);
        entry.running = false;
        // Backoff: 5s, 10s, 20s, 40s, 80s, 160s → cap at 5min
        let delay = entry.failCount > 0
          ? Math.min(BACKOFF_BASE * Math.pow(2, entry.failCount - 1), BACKOFF_MAX)
          : entry.interval;

        // Self-healing: if stuck at max backoff for 15+ min, reset and try fresh
        if (entry.failCount >= MAX_FAIL_COUNT && entry.lastSuccess > 0) {
          const timeAtMaxFail = Date.now() - entry.lastSuccess;
          if (timeAtMaxFail > 15 * 60 * 1000) {
            console.log(`[scheduler] ${watcherId}: auto-recovering after ${Math.round(timeAtMaxFail / 1000)}s at max backoff`);
            entry.failCount = 0;
            delay = entry.interval;
          }
        }

        entry.timerId = setTimeout(tick, delay);
      }
    };

    // Start first tick immediately
    tick();
  }

  scheduled.set(watcherId, entry);
}

export function cancelWatcher(watcherId: string): void {
  const entry = scheduled.get(watcherId);
  if (entry?.timerId) {
    clearTimeout(entry.timerId);
    entry.timerId = null;
  }
  scheduled.delete(watcherId);
}

// ─── MANUAL REFRESH ───
// Trigger a fetch immediately for a specific watcher, without resetting the polling timer.
export async function refreshWatcher(watcherId: string): Promise<void> {
  const entry = scheduled.get(watcherId);
  if (!entry) {
    console.warn(`[scheduler] ${watcherId}: not scheduled, cannot refresh`);
    return;
  }
  if (entry.running) {
    console.warn(`[scheduler] ${watcherId}: already running, skipping refresh`);
    return;
  }
  if (!entry.fetchFn) {
    console.warn(`[scheduler] ${watcherId}: no fetchFn stored, cannot refresh`);
    return;
  }

  entry.running = true;
  entry.runningSince = Date.now();
  try {
    await entry.fetchFn();
    entry.failCount = 0;
    entry.lastSuccess = Date.now();
  } catch (err) {
    entry.failCount = Math.min(entry.failCount + 1, MAX_FAIL_COUNT);
  } finally {
    entry.running = false;
  }
}

// ─── STALE DETECTION ───
// Check all scheduled watchers and mark stale if they haven't succeeded in >3x their interval.
// Call periodically (e.g. every 30s) from the app layer.
export function detectStaleWatchers(setWatcherStatus: (id: string, status: string, error?: string) => void): void {
  const now = Date.now();
  for (const [id, entry] of scheduled) {
    if (entry.running) continue;
    // If we have a recorded last success, check against interval
    if (entry.lastSuccess > 0) {
      const elapsed = now - entry.lastSuccess;
      const staleThreshold = entry.interval * STALE_MULTIPLIER;
      if (elapsed > staleThreshold) {
        setWatcherStatus(id, 'stale', `No successful fetch in ${Math.round(elapsed / 1000)}s`);
      }
    }
  }
}

export function cancelAllWatchers(): void {
  for (const id of scheduled.keys()) {
    cancelWatcher(id);
  }
}

// ─── STALE RECOVERY ───
// Returns watcher IDs that are stale (no success for > 3x interval).
// The app layer should reschedule these watchers to recover from persistent failures.
export function getStaleWatcherIds(): string[] {
  const now = Date.now();
  const stale: string[] = [];
  for (const [id, entry] of scheduled) {
    if (entry.running) continue;
    if (entry.lastSuccess > 0) {
      const elapsed = now - entry.lastSuccess;
      if (elapsed > entry.interval * STALE_MULTIPLIER) {
        stale.push(id);
      }
    }
  }
  return stale;
}

// ─── RECOVER STALE WATCHER ───
// Reset a watcher's fail counter and restart it immediately.
// Call this from the app layer when a watcher has been stuck too long.
export function recoverWatcher(watcherId: string, fetchFn: () => Promise<void>): void {
  const entry = scheduled.get(watcherId);
  if (!entry) return;

  console.log(`[scheduler] ${watcherId}: recovering stale watcher`);
  entry.failCount = 0;
  entry.lastSuccess = 0;
  entry.running = false;

  // Cancel existing timer and restart immediately
  if (entry.timerId) {
    clearTimeout(entry.timerId);
    entry.timerId = null;
  }

  // Start a fresh tick
  const tick = async () => {
    if (entry.running) return;
    entry.running = true;
    entry.runningSince = Date.now();

    const timeout = stuckFetchTimeout(entry.interval);
    const stuckGuard = setTimeout(() => {
      if (entry.running) {
        console.warn(`[scheduler] ${watcherId}: fetch stuck after ${timeout}ms, aborting`);
        entry.running = false;
        entry.failCount = Math.min(entry.failCount + 1, MAX_FAIL_COUNT);
      }
    }, timeout);

    try {
      await fetchFn();
      entry.failCount = 0;
      entry.lastSuccess = Date.now();
    } catch (err) {
      const isRateLimit = err instanceof Error && err.name === 'CoinGeckoRateLimitError';
      if (isRateLimit) {
        entry.failCount = MAX_FAIL_COUNT;
      } else {
        entry.failCount = Math.min(entry.failCount + 1, MAX_FAIL_COUNT);
      }
    } finally {
      clearTimeout(stuckGuard);
      entry.running = false;
      const delay = entry.failCount > 0
        ? Math.min(BACKOFF_BASE * Math.pow(2, entry.failCount - 1), BACKOFF_MAX)
        : entry.interval;
      entry.timerId = setTimeout(tick, delay);
    }
  };

  tick();
}
