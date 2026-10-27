/** Times, penalties and WCA-style trimmed averages. All times in milliseconds. */

export type Penalty = 'ok' | '+2' | 'dnf';

export interface Timed {
  timeMs: number;
  penalty: Penalty;
}

/** Time that counts, with +2 added; DNF is Infinity so it sorts as the worst. */
export function effectiveTime({ timeMs, penalty }: Timed): number {
  if (penalty === 'dnf') return Infinity;
  return penalty === '+2' ? timeMs + 2000 : timeMs;
}

/**
 * Average of n: drop the best and worst 5% (rounded up, so 1 each for ao5 and ao12)
 * and take the mean of the rest. More DNFs than can be dropped makes it a DNF.
 */
export function trimmedAverage(times: number[]): number {
  const trim = Math.ceil(times.length * 0.05);
  const sorted = [...times].sort((a, b) => a - b);
  const kept = sorted.slice(trim, sorted.length - trim);
  return kept.reduce((sum, t) => sum + t, 0) / kept.length;
}

/** Average of the last n solves ending at each index (null until there are n). */
export function rollingAverages(solves: Timed[], n: number): (number | null)[] {
  const times = solves.map(effectiveTime);
  return times.map((_, i) => (i + 1 < n ? null : trimmedAverage(times.slice(i + 1 - n, i + 1))));
}

export interface AverageStat {
  current: number | null;
  best: number | null;
}

export interface SessionStats {
  count: number;
  /** Mean of all non-DNF solves. */
  mean: number | null;
  single: AverageStat;
  averages: Record<5 | 12 | 100, AverageStat>;
}

function currentAndBest(values: (number | null)[]): AverageStat {
  const present = values.filter((v): v is number => v !== null);
  return {
    current: values.length ? values[values.length - 1] : null,
    best: present.length ? Math.min(...present) : null,
  };
}

export function sessionStats(solves: Timed[]): SessionStats {
  const times = solves.map(effectiveTime);
  const finished = times.filter(Number.isFinite);
  return {
    count: solves.length,
    mean: finished.length ? finished.reduce((a, b) => a + b, 0) / finished.length : null,
    single: currentAndBest(times),
    averages: {
      5: currentAndBest(rollingAverages(solves, 5)),
      12: currentAndBest(rollingAverages(solves, 12)),
      100: currentAndBest(rollingAverages(solves, 100)),
    },
  };
}

/** 9.876 s -> "9.87", 75.43 s -> "1:15.43"; truncated to hundredths like a stackmat. */
export function formatTime(ms: number | null): string {
  if (ms === null) return '–';
  if (!Number.isFinite(ms)) return 'DNF';
  const cs = Math.floor(ms / 10);
  const minutes = Math.floor(cs / 6000);
  const seconds = Math.floor((cs % 6000) / 100);
  const hundredths = String(cs % 100).padStart(2, '0');
  return minutes > 0
    ? `${minutes}:${String(seconds).padStart(2, '0')}.${hundredths}`
    : `${seconds}.${hundredths}`;
}

export function formatResult(solve: Timed): string {
  if (solve.penalty === 'dnf') return `DNF(${formatTime(solve.timeMs)})`;
  return formatTime(effectiveTime(solve)) + (solve.penalty === '+2' ? '+' : '');
}
