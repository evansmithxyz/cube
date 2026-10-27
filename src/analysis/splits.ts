/** Splitting a solve into its method's stages, turn by turn. */

import { applyMove } from '../cube/facelets';
import type { Move } from '../cube/moves';
import { rotateState, type Rotation } from '../cube/rotations';
import type { TimedMove } from '../timer/solveTimer';
import { ollCase, pllCase, type LastLayerCase } from './cases';
import type { Method, Stage } from './methods';

export interface StageSplit {
  stage: string;
  /** ms from the solve's first turn to the end of the stage */
  at: number;
  duration: number;
  /** pause before the stage's first turn (look-ahead or case recognition) */
  recognition: number;
  /** from the stage's first turn to its end */
  execution: number;
  turns: number;
  case?: LastLayerCase;
}

function recognise(stage: Stage | undefined, view: string): LastLayerCase | undefined {
  if (stage?.caseKind === 'oll') return ollCase(view);
  if (stage?.caseKind === 'pll') return pllCase(view);
  return undefined;
}

export class StageTracker {
  readonly splits: StageSplit[] = [];
  private state: string;
  private frame: Rotation | null = null;
  private reached = 0;
  private stageStart = 0;
  private firstTurn: number | null = null;
  private turns = 0;
  private stageCase: LastLayerCase | undefined;

  constructor(
    private readonly method: Method,
    start: string,
  ) {
    this.state = start;
  }

  /** Feed one turn, `t` ms after the solve's first turn. */
  turn(move: Move, t: number): void {
    const { stages } = this.method;
    if (this.reached === stages.length) return;
    this.state = applyMove(this.state, move);
    this.firstTurn ??= t;
    this.turns++;

    const progress = this.progress();
    if (!progress) return;
    const [frame, view, level] = progress;
    this.frame = frame; // keep the first point of view that shows progress
    for (let k = this.reached; k < level; k++) {
      const first = k === this.reached; // stages after it were skipped
      this.splits.push({
        stage: stages[k].name,
        at: t,
        duration: first ? t - this.stageStart : 0,
        recognition: first ? this.firstTurn - this.stageStart : 0,
        execution: first ? t - this.firstTurn : 0,
        turns: first ? this.turns : 0,
        case: first ? this.stageCase : recognise(stages[k], view),
      });
    }
    this.reached = level;
    this.stageStart = t;
    this.firstTurn = null;
    this.turns = 0;
    this.stageCase = recognise(stages[level], view);
  }

  /** The point of view with the most stages done, if it's more than before. */
  private progress(): [Rotation, string, number] | null {
    const { stages } = this.method;
    let best: [Rotation, string, number] | null = null;
    for (const frame of this.frame ? [this.frame] : this.method.frames) {
      const view = rotateState(this.state, frame);
      let level = this.reached;
      while (level < stages.length && stages[level].done(view)) level++;
      if (level > (best?.[2] ?? this.reached)) best = [frame, view, level];
    }
    return best;
  }
}

export function analyzeSolve(method: Method, start: string, moves: TimedMove[]): StageSplit[] {
  const tracker = new StageTracker(method, start);
  for (const { move, t } of moves) tracker.turn(move, t);
  return tracker.splits;
}
