import type { Game, GameStatus } from '../repo/types.js';
import { conflict } from '../errors.js';
import { LIMITS } from './limits.js';

/** Spec §4: monotonic except awaiting_partner <-> ready. */
const ALLOWED: Record<GameStatus, GameStatus[]> = {
  draft: ['awaiting_partner', 'ready', 'in_progress'],
  awaiting_partner: ['ready', 'in_progress'],
  ready: ['awaiting_partner', 'in_progress'],
  in_progress: ['finished'],
  finished: [],
};

export function canTransition(from: GameStatus, to: GameStatus): boolean {
  return ALLOWED[from].includes(to);
}

export function assertTransition(game: Game, to: GameStatus): void {
  if (!canTransition(game.status, to)) throw conflict('invalid_transition', `${game.status} → ${to}`);
}

export const countsTowardLimit = (g: Game) => g.status !== 'finished';

export function isPlayable(g: Game) { return g.status === 'in_progress' || g.status === 'ready' || g.status === 'awaiting_partner'; }

/** Fix-up allowed before finishing and for 24 h afterwards. */
export function fixupAllowed(g: Game, now = Date.now()): boolean {
  if (g.status !== 'finished') return true;
  if (!g.finishedAt) return false;
  return now - Date.parse(g.finishedAt) <= LIMITS.fixupAfterFinishHours * 3600_000;
}

/** Partner writes only while the game is open (spec data-model validation). */
export const partnerMayWrite = (g: Game) => g.status === 'awaiting_partner' || g.status === 'ready' || g.status === 'in_progress';

/**
 * Recompute awaiting_partner/ready from answer completeness. Only applies while the game has not started.
 */
export function completenessStatus(g: Game, playableQuestions: number, answered: number): GameStatus {
  if (g.status !== 'draft' && g.status !== 'awaiting_partner' && g.status !== 'ready') return g.status;
  return playableQuestions > 0 && answered >= playableQuestions ? 'ready' : 'awaiting_partner';
}
