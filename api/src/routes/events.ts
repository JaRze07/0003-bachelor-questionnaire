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
/** Journal and round ids become Firestore document ids, so '/' and friends are not allowed. */
const safeId = z.string().min(8).max(64).regex(/^[A-Za-z0-9_-]+$/);
const eventSchema = z.object({
  id: safeId,
  seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  type: z.enum(EVENT_TYPES as [EventType, ...EventType[]]),
  at: z.string().datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()).default({}),
});
const body = z.object({ epoch: z.number().int().positive(), deviceId: z.string().min(4).max(80), events: z.array(eventSchema).max(200) });

/** Firestore documents stop at 1 MiB; refuse oversized payloads before anything is written. */
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_SNAPSHOT_BYTES = 512 * 1024;

const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v ?? null));
const ROUND_ID = /^[A-Za-z0-9_-]{4,64}$/;

/**
 * Round numbers follow order of play. Rounds fixed back to `unplayed` keep their document (the id is the
 * client's idempotency key) but lose their number and leave the projection.
 */
function renumber(rounds: Round[]) {
  const kept = rounds.filter((r) => r.result !== 'unplayed').sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  kept.forEach((r, i) => { r.n = i + 1; });
  for (const r of rounds) if (r.result === 'unplayed') r.n = 0;
  return kept;
}

/** Gameplay is frozen once a game is finished; only fix-ups inside the 24 h window still apply. */
function allowedAfterFinish(type: EventType) {
  return type === 'round.fixup' || type === 'snapshot';
}

export function applyEvent(full: FullGame, e: GameEvent): boolean {
  const { game, questions, answers, rounds } = full;
  const p = e.payload;
  const roundId = ROUND_ID.test(String(p.roundId ?? '')) ? String(p.roundId) : '';
  const round = rounds.find((r) => r.id === roundId);
  if (game.status === 'finished' && !allowedAfterFinish(e.type)) return false;
  switch (e.type) {
    case 'round.start': {
      if (!roundId) return false;
      if (round) return true; // already applied
      const q = questions.find((x) => x.id === str(p.questionId, 64));
      if (!q || game.hiddenQuestionIds.includes(q.id)) return false;
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
        result: 'unplayed', voided: false, doubled: false, strikeBack: [], startedAt: e.at || e.receivedAt, syncedAt: e.receivedAt,
      });
      if (game.status !== 'in_progress' && game.status !== 'finished') game.status = 'in_progress';
      return true;
    }
    case 'round.penalty': {
      if (!round) return false;
      const penalty = penaltySchema.safeParse(p.penalty);
      if (!penalty.success) return false;
      round.penalty = penalty.data;
      return true;
    }
    case 'round.reveal':
      // From here on the guest page may show the partner's answer for this round (spec 002 FR-102).
      if (!round) return false;
      if (!round.revealedAt) round.revealedAt = e.receivedAt;
      return true;
    case 'round.double':
      if (!round || !game.settings.rules.doubleOrNothing) return false;
      round.doubled = true;
      return true;
    case 'round.mark': {
      if (!round) return false;
      const result = str(p.result, 10) as RoundResult;
      if (result !== 'correct' && result !== 'wrong') return false;
      round.result = result;
      round.markedAt = e.at || e.receivedAt;
      round.syncedAt = e.receivedAt;
      return true;
    }
    case 'round.strikeBack': {
      if (!round || round.result !== 'correct' || !round.frozen.rules.strikeBack) return false;
      const guest = str(p.guest, LIMITS.guestName).trim();
      const max = round.doubled ? LIMITS.strikeBackMax : 1;
      if (!guest) return false;
      // Idempotent: a retried upload must not name the same guest twice.
      if (round.strikeBack.some((g) => g.guest === guest)) return true;
      if (round.strikeBack.length >= max) return false;
      round.strikeBack.push({ guest });
      return true;
    }
    case 'round.fixup': {
      if (!fixupAllowed(game)) return false;
      const result = str(p.result, 10) as RoundResult;
      if (!['correct', 'wrong', 'unplayed'].includes(result)) return false;
      const qId = str(p.questionId, 64);
      const existing = round ?? rounds.find((r) => r.questionId === qId && r.result !== 'unplayed');
      if (result === 'unplayed') {
        if (!existing) return false;
        existing.result = 'unplayed';
        existing.voided = true;          // the question goes back into the queue
        return true;
      }
      const penalty = penaltySchema.safeParse(p.penalty);
      if (existing) {
        existing.result = result;
        existing.voided = false;
        if (penalty.success) existing.penalty = penalty.data;
        existing.markedAt = e.at || e.receivedAt;
        return true;
      }
      const q = questions.find((x) => x.id === qId);
      if (!q || game.hiddenQuestionIds.includes(q.id)) return false;
      rounds.push({
        id: roundId || `fix-${e.id}`, n: rounds.length + 1, questionId: q.id,
        frozen: { questionRev: q.rev, text: q.text, theme: q.theme, answer: answerFor(q, answers.find((a) => a.questionId === q.id) ?? null), penaltyScheme: game.settings.penaltyScheme, rules: { ...game.settings.rules } },
        epoch: e.epoch, penalty: penalty.success ? penalty.data : { type: 'none', label: '', description: '' },
        result, voided: false, doubled: false, strikeBack: [], startedAt: e.at || e.receivedAt, markedAt: e.at || e.receivedAt, syncedAt: e.receivedAt,
      });
      if (game.status !== 'in_progress' && game.status !== 'finished') game.status = 'in_progress';
      return true;
    }
    case 'game.finish':
      if (game.status === 'finished') return true;
      if (game.status !== 'in_progress') return false;
      game.status = 'finished';
      game.finishedAt = e.receivedAt;
      return true;
    case 'snapshot':
      return true; // stored separately by the route
  }
}

export function eventRoutes({ repo }: AppDeps) {
  const r = new Hono<{ Variables: Vars }>();
  r.use('*', hostAuth(repo));

  r.post('/:id/events', ownedGame(repo), async (c) => {
    const b = body.parse(await c.req.json());
    const game = c.get('game');
    if (b.epoch !== game.epoch) throw conflict('stale_epoch', 'Another device took over this game', { epoch: game.epoch });
    // The epoch alone does not say which device holds the game: a second phone of the same host
    // must take over explicitly before it can write (spec §7). A game with no holder yet (the host
    // played before the first lease call went through) is claimed by the uploading device.
    if (game.lease && game.lease.deviceId !== b.deviceId) {
      throw conflict('not_lease_holder', 'Another device is running this game', { epoch: game.epoch, holder: game.lease.label });
    }
    if (!game.lease) {
      game.lease = { deviceId: b.deviceId, label: '', updatedAt: nowIso(), lastSyncAt: nowIso() };
      await repo.games.update(game.id, { lease: game.lease });
    }
    const full = await loadFull(repo, game);
    const acknowledged: string[] = [];
    const rejected: { id: string; reason: string }[] = [];
    const now = nowIso();
    let changed = false;

    for (const ev of [...b.events].sort((x, y) => x.seq - y.seq)) {
      if (await repo.events.has(game.id, ev.id)) { acknowledged.push(ev.id); continue; }
      const limit = ev.type === 'snapshot' ? MAX_SNAPSHOT_BYTES : MAX_EVENT_BYTES;
      if (bytes(ev.payload) > limit) { rejected.push({ id: ev.id, reason: 'too_large' }); continue; }
      const stored: GameEvent = { ...ev, epoch: b.epoch, deviceId: b.deviceId, receivedAt: now };
      let applied = true;
      if (ev.type === 'snapshot') {
        await repo.snapshots.add(game.id, { id: ev.id, createdAt: now, data: ev.payload.data }, LIMITS.snapshotsKeep);
      } else {
        applied = applyEvent(full, stored);
      }
      if (!applied) { rejected.push({ id: ev.id, reason: 'not_applicable' }); continue; }
      // The journal document is written only after the event changed the game, so a retry that sees
      // it recorded can safely treat it as applied.
      if (ev.type !== 'snapshot') {
        renumber(full.rounds);
        for (const round of full.rounds) await repo.rounds.set(game.id, round);
        await refreshDerived(repo, full, { activity: true });
      }
      await repo.events.add(game.id, stored);
      acknowledged.push(ev.id);
      changed = true;
    }

    if (changed && game.lease && game.lease.deviceId === b.deviceId) {
      await repo.games.update(game.id, { lease: { ...game.lease, lastSyncAt: now } });
    }
    const partnerAnswers = Object.fromEntries(full.answers.map((a) => [a.questionId, { text: a.text, rev: a.rev, questionRev: a.questionRev }]));
    return c.json({ acknowledged, rejected, epoch: game.epoch, revision: full.game.revision, partnerAnswers });
  });

  return r;
}
