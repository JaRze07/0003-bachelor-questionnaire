import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { hostAuth, ownedGame, type Vars } from '../auth.js';
import type { EventType, FrozenRound, GameEvent, Penalty, Round, RoundResult } from '../repo/types.js';
import { conflict } from '../errors.js';
import { nowIso } from '../domain/ids.js';
import { LIMITS } from '../domain/limits.js';
import { fixupAllowed } from '../domain/state.js';
import { answerFor } from '../domain/answers.js';
import { loadFull, refreshDerived, type FullGame } from '../service.js';

const EVENT_TYPES: EventType[] = ['round.start', 'round.penalty', 'round.reveal', 'round.mark', 'round.strikeBack', 'round.double', 'round.fixup', 'game.finish', 'snapshot'];

const penaltySchema = z.object({ type: z.enum(['drink', 'dare', 'custom', 'none']), label: z.string().max(LIMITS.penaltyLabel).default(''), description: z.string().max(LIMITS.penaltyDescription).default('') });
const eventSchema = z.object({
  id: z.string().min(8).max(64),
  seq: z.number().int().nonnegative(),
  type: z.enum(EVENT_TYPES as [EventType, ...EventType[]]),
  at: z.string().max(40),
  payload: z.record(z.string(), z.unknown()).default({}),
});
const body = z.object({ epoch: z.number().int().positive(), deviceId: z.string().min(4).max(80), events: z.array(eventSchema).max(500) });

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Renumber marked/started rounds by start time (fix-up to unplayed removes a round). */
function renumber(rounds: Round[]) {
  const kept = rounds.filter((r) => r.result !== 'unplayed').sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  kept.forEach((r, i) => { r.n = i + 1; });
  return kept;
}

export function applyEvent(full: FullGame, e: GameEvent): void {
  const { game, questions, answers, rounds } = full;
  const p = e.payload;
  const roundId = str(p.roundId, 64);
  const round = rounds.find((r) => r.id === roundId);
  switch (e.type) {
    case 'round.start': {
      if (round || !roundId) return;
      const q = questions.find((x) => x.id === str(p.questionId, 64));
      if (!q) return;
      const client = p.frozen as Partial<FrozenRound> | undefined;
      const ans = answerFor(q, answers.find((a) => a.questionId === q.id) ?? null);
      const frozen: FrozenRound = {
        questionRev: q.rev, text: client?.text ?? q.text, theme: q.theme,
        answer: client?.answer ?? ans,
        penaltyScheme: game.settings.penaltyScheme, rules: { ...game.settings.rules },
      };
      const penalty = penaltySchema.safeParse(p.penalty);
      rounds.push({
        id: roundId, n: rounds.length + 1, questionId: q.id, frozen, epoch: e.epoch,
        penalty: penalty.success ? penalty.data : { type: 'none', label: '', description: '' },
        result: 'unplayed', doubled: false, strikeBack: [], startedAt: e.at || e.receivedAt, syncedAt: e.receivedAt,
      });
      if (game.status !== 'in_progress' && game.status !== 'finished') game.status = 'in_progress';
      return;
    }
    case 'round.penalty': {
      if (!round) return;
      const penalty = penaltySchema.safeParse(p.penalty);
      if (penalty.success) round.penalty = penalty.data;
      return;
    }
    case 'round.reveal':
      return; // informational; the freeze happened at round.start on the device
    case 'round.double':
      if (round && game.settings.rules.doubleOrNothing) round.doubled = true;
      return;
    case 'round.mark': {
      if (!round) return;
      const result = str(p.result, 10) as RoundResult;
      if (result !== 'correct' && result !== 'wrong') return;
      round.result = result;
      round.markedAt = e.at || e.receivedAt;
      round.syncedAt = e.receivedAt;
      return;
    }
    case 'round.strikeBack': {
      if (!round || round.result !== 'correct' || !round.frozen.rules.strikeBack) return;
      const guest = str(p.guest, LIMITS.guestName).trim();
      const max = round.doubled ? LIMITS.strikeBackMax : 1;
      if (guest && round.strikeBack.length < max) round.strikeBack.push({ guest });
      return;
    }
    case 'round.fixup': {
      if (!fixupAllowed(game)) return;
      const result = str(p.result, 10) as RoundResult;
      if (!['correct', 'wrong', 'unplayed'].includes(result)) return;
      const qId = str(p.questionId, 64);
      const existing = round ?? rounds.find((r) => r.questionId === qId && r.result !== 'unplayed');
      if (result === 'unplayed') {
        if (existing) existing.result = 'unplayed';
        return;
      }
      const penalty = penaltySchema.safeParse(p.penalty);
      if (existing) {
        existing.result = result;
        if (penalty.success) existing.penalty = penalty.data;
        existing.markedAt = e.at || e.receivedAt;
        return;
      }
      const q = questions.find((x) => x.id === qId);
      if (!q) return;
      rounds.push({
        id: roundId || `fix-${e.id}`, n: rounds.length + 1, questionId: q.id,
        frozen: { questionRev: q.rev, text: q.text, theme: q.theme, answer: answerFor(q, answers.find((a) => a.questionId === q.id) ?? null), penaltyScheme: game.settings.penaltyScheme, rules: { ...game.settings.rules } },
        epoch: e.epoch, penalty: penalty.success ? penalty.data : { type: 'none', label: '', description: '' },
        result, doubled: false, strikeBack: [], startedAt: e.at || e.receivedAt, markedAt: e.at || e.receivedAt, syncedAt: e.receivedAt,
      });
      if (game.status !== 'in_progress' && game.status !== 'finished') game.status = 'in_progress';
      return;
    }
    case 'game.finish':
      if (game.status === 'in_progress') { game.status = 'finished'; game.finishedAt = e.at || e.receivedAt; }
      return;
    case 'snapshot':
      return; // stored separately by the route
  }
}

export function eventRoutes({ repo }: AppDeps) {
  const r = new Hono<{ Variables: Vars }>();
  r.use('*', hostAuth(repo));

  r.post('/:id/events', ownedGame(repo), async (c) => {
    const b = body.parse(await c.req.json());
    const game = c.get('game');
    if (b.epoch !== game.epoch) throw conflict('stale_epoch', 'Another device took over this game', { epoch: game.epoch });
    const full = await loadFull(repo, game);
    const acknowledged: string[] = [];
    const now = nowIso();
    let changed = false;
    for (const ev of b.events.sort((x, y) => x.seq - y.seq)) {
      if (await repo.events.has(game.id, ev.id)) { acknowledged.push(ev.id); continue; }
      const stored: GameEvent = { ...ev, epoch: b.epoch, deviceId: b.deviceId, receivedAt: now };
      if (ev.type === 'snapshot') {
        await repo.snapshots.add(game.id, { id: ev.id, createdAt: now, data: ev.payload.data }, LIMITS.snapshotsKeep);
      } else {
        applyEvent(full, stored);
      }
      await repo.events.add(game.id, stored);
      acknowledged.push(ev.id);
      changed = true;
    }
    if (changed) {
      const removed = full.rounds.filter((r) => r.result === 'unplayed' && r.markedAt === undefined && !full.rounds.some((x) => x.id === r.id && x !== r));
      renumber(full.rounds);
      for (const rd of full.rounds) {
        if (rd.result === 'unplayed' && removed.includes(rd) && rd.startedAt < new Date(Date.now() - 6 * 3600_000).toISOString()) {
          await repo.rounds.delete(game.id, rd.id); // abandoned starts older than 6 h are dropped
        } else {
          await repo.rounds.set(game.id, rd);
        }
      }
      if (game.lease && game.lease.deviceId === b.deviceId) game.lease.lastSyncAt = now;
      await refreshDerived(repo, full, { activity: true });
    }
    const partnerAnswers = Object.fromEntries(full.answers.map((a) => [a.questionId, { text: a.text, rev: a.rev, questionRev: a.questionRev }]));
    return c.json({ acknowledged, epoch: game.epoch, revision: full.game.revision, partnerAnswers });
  });

  return r;
}
