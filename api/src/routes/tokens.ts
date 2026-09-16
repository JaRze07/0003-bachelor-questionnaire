import { Hono } from 'hono';
import type { AppDeps } from '../app.js';
import { hostAuth, ownedGame, type Vars } from '../auth.js';
import type { TokenRole } from '../repo/types.js';
import { badRequest } from '../errors.js';
import { nowIso } from '../domain/ids.js';
import { issueToken, linkFor } from './games.js';

const roleOf = (s: string): TokenRole => {
  if (s !== 'partner' && s !== 'spectator') throw badRequest('bad_role');
  return s;
};

export function tokenRoutes(deps: AppDeps) {
  const { repo } = deps;
  const r = new Hono<{ Variables: Vars }>();
  r.use('*', hostAuth(repo));

  r.post('/:id/tokens/:role/regenerate', ownedGame(repo), async (c) => {
    const role = roleOf(c.req.param('role'));
    const game = c.get('game');
    const token = await issueToken(deps, game, role);
    game.updatedAt = nowIso();
    await repo.games.update(game.id, { tokens: game.tokens, updatedAt: game.updatedAt });
    return c.json({ url: linkFor(role, token), version: game.tokens[role].version });
  });

  r.delete('/:id/tokens/:role', ownedGame(repo), async (c) => {
    const role = roleOf(c.req.param('role'));
    const game = c.get('game');
    const state = game.tokens[role];
    if (state.hash) await repo.tokens.delete(state.hash);
    game.tokens[role] = { hash: '', version: state.version, revokedAt: nowIso() };
    game.updatedAt = nowIso();
    await repo.games.update(game.id, { tokens: game.tokens, updatedAt: game.updatedAt });
    return c.body(null, 204);
  });

  return r;
}
