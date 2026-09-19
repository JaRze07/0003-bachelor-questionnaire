// Repository interface: everything the API stores. Two implementations: Firestore (production)
// and in-memory (tests, local dev with REPO=memory). Timestamps are ISO-8601 strings everywhere.

export type Language = 'en' | 'de' | 'es' | 'pt' | 'pl';
export const LANGUAGES: Language[] = ['en', 'de', 'es', 'pt', 'pl'];

export type GameStatus = 'draft' | 'awaiting_partner' | 'ready' | 'in_progress' | 'finished';
export type Tier = 'free' | 'premium';
export type PremiumState = 'none' | 'pending' | 'active' | 'revoked' | 'unknown';
export type Platform = 'play' | 'appstore';
export type TokenRole = 'partner' | 'spectator';
export type PenaltyScheme = 'drink_or_dare' | 'drink' | 'dare' | 'custom';
export type PenaltyType = 'drink' | 'dare' | 'custom' | 'none';
export type RoundResult = 'correct' | 'wrong' | 'unplayed';

export interface Premium {
  state: PremiumState;
  platform?: Platform;
  productId?: string;
  purchaseToken?: string;
  since?: string;
  lastVerifiedAt?: string;
  revokedAt?: string;
  revokeReason?: string;
}

export interface User {
  uid: string;
  premium: Premium;
  locale?: string;
  createdAt: string;
  lastSeenAt: string;
}

export interface Purchase {
  token: string;            // purchase token (Play) or original transaction id (App Store)
  uid: string;
  platform: Platform;
  productId: string;
  orderId?: string;
  state: PremiumState;      // pending | active | revoked | unknown
  boundAt: string;
  verifiedAt: string;
  raw?: Record<string, unknown>;
}

export interface CustomPenalty { label: string; description?: string }
export interface Rules { strikeBack: boolean; doubleOrNothing: boolean }
export interface GameSettings {
  penaltyScheme: PenaltyScheme;
  customPenalties: CustomPenalty[];
  rules: Rules;
  randomOrder: boolean;
}

export interface TokenState { hash: string; version: number; revokedAt?: string }

export interface GameCounts { questions: number; answered: number; rounds: number; correct: number; wrong: number }

export interface Lease { deviceId: string; label: string; updatedAt: string; lastSyncAt: string }

export interface Game {
  id: string;
  hostUid: string;
  status: GameStatus;
  language: Language;
  title?: string;
  settings: GameSettings;
  tier: Tier;
  hiddenQuestionIds: string[];
  tokens: { partner: TokenState; spectator: TokenState };
  epoch: number;
  lease?: Lease;
  revision: number;
  counts: GameCounts;
  partnerOpenedAt?: string;
  partnerLastAnswerAt?: string;
  partnerLastLoadedAt?: string;
  lastActivityAt: string;
  retentionWarnedAt?: string;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
}

export interface Question {
  id: string;
  text: string;
  theme?: string;
  order: number;
  rev: number;
  source: 'curated' | 'custom';
  createdAt: string;
  hostAnswer?: string;
}

export interface Answer {
  questionId: string;
  text: string;
  rev: number;
  questionRev: number;
  updatedAt: string;
}

export interface Penalty { type: PenaltyType; label: string; description: string }

export interface FrozenRound {
  questionRev: number;
  text: string;
  theme?: string;
  answer: { text: string; source: 'partner' | 'host' | 'none' };
  penaltyScheme: PenaltyScheme;
  rules: Rules;
}

export interface Round {
  id: string;
  n: number;
  questionId: string;
  frozen: FrozenRound;
  epoch: number;
  penalty: Penalty;
  result: RoundResult;
  /** A round holds its question while it exists; a fix-up back to "unplayed" voids it and frees the question. */
  voided?: boolean;
  doubled: boolean;
  strikeBack: { guest: string }[];
  startedAt: string;
  markedAt?: string;
  syncedAt: string;
}

export type EventType =
  | 'round.start' | 'round.penalty' | 'round.reveal' | 'round.mark' | 'round.strikeBack'
  | 'round.double' | 'round.fixup' | 'game.finish' | 'snapshot';

export interface GameEvent {
  id: string;
  seq: number;
  epoch: number;
  deviceId: string;
  type: EventType;
  at: string;
  payload: Record<string, unknown>;
  receivedAt: string;
}

export interface TokenDoc { hash: string; gameId: string; role: TokenRole; version: number; createdAt: string }

export interface ProjectionRound { n: number; question: string; result: 'correct' | 'wrong'; penalty: { type: PenaltyType; label: string }; doubled: boolean }
export interface Projection {
  gameId: string;
  language: Language;
  title?: string;
  status: GameStatus;
  score: { correct: number; wrong: number; played: number; total: number };
  rounds: ProjectionRound[];
  revision: number;
  updatedAt: string;
}

export interface Snapshot { id: string; createdAt: string; data: unknown }

/** Our own sign-in session: the id is the sha256 of the bearer token, the token itself is never stored. */
export interface Session { id: string; uid: string; provider: 'google' | 'apple' | 'dev'; createdAt: string; expiresAt: string }

export interface Repo {
  /**
   * Run `fn` as one unit: everything it writes is committed together or not at all, and no other
   * writer runs in between. Nested calls join the outer transaction.
   */
  tx<T>(fn: () => Promise<T>): Promise<T>;
  sessions: {
    get(id: string): Promise<Session | null>;
    set(s: Session): Promise<void>;
    delete(id: string): Promise<void>;
    deleteExpired(nowIso: string): Promise<number>;
  };
  users: {
    get(uid: string): Promise<User | null>;
    set(user: User): Promise<void>;
    update(uid: string, fields: Partial<User>): Promise<void>;
  };
  purchases: {
    get(token: string): Promise<Purchase | null>;
    set(p: Purchase): Promise<void>;
    listByUid(uid: string): Promise<Purchase[]>;
    /** Bind a token to a uid, atomically. Returns the owner if it already belongs to someone else. */
    claim(token: string, uid: string): Promise<{ ok: true } | { ok: false; uid: string }>;
    /** Drop a reservation that never became a verified purchase. */
    release(token: string, uid: string): Promise<void>;
  };
  games: {
    get(id: string): Promise<Game | null>;
    set(game: Game): Promise<void>;
    /** Merge a few fields without rewriting the document (avoids stomping a concurrent takeover). */
    update(id: string, fields: Partial<Game>): Promise<void>;
    listByHost(uid: string): Promise<Game[]>;
    listIdleBefore(iso: string): Promise<Game[]>;
    deleteTree(id: string): Promise<void>;
  };
  questions: {
    list(gameId: string): Promise<Question[]>;
    get(gameId: string, id: string): Promise<Question | null>;
    set(gameId: string, q: Question): Promise<void>;
    setMany(gameId: string, qs: Question[]): Promise<void>;
    delete(gameId: string, id: string): Promise<void>;
  };
  answers: {
    list(gameId: string): Promise<Answer[]>;
    get(gameId: string, questionId: string): Promise<Answer | null>;
    set(gameId: string, a: Answer): Promise<void>;
    /** Write only if the stored revision is still `expectedRev` (0 = no answer yet). */
    setIfRev(gameId: string, a: Answer, expectedRev: number): Promise<{ ok: true } | { ok: false; current: Answer | null }>;
    delete(gameId: string, questionId: string): Promise<void>;
  };
  rounds: {
    list(gameId: string): Promise<Round[]>;
    get(gameId: string, id: string): Promise<Round | null>;
    set(gameId: string, r: Round): Promise<void>;
    delete(gameId: string, id: string): Promise<void>;
  };
  events: {
    has(gameId: string, id: string): Promise<boolean>;
    add(gameId: string, e: GameEvent): Promise<void>;
    list(gameId: string): Promise<GameEvent[]>;
  };
  tokens: {
    get(hash: string): Promise<TokenDoc | null>;
    set(t: TokenDoc): Promise<void>;
    delete(hash: string): Promise<void>;
  };
  projections: {
    get(gameId: string): Promise<Projection | null>;
    set(p: Projection): Promise<void>;
    delete(gameId: string): Promise<void>;
  };
  snapshots: {
    add(gameId: string, s: Snapshot, keep: number): Promise<void>;
    latest(gameId: string): Promise<Snapshot | null>;
  };
}
