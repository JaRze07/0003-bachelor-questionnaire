import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// jsdom rewrites import.meta.url to an http URL, so files are read relative to the project root instead
const file = (name) => readFileSync(resolve(process.cwd(), 'web', name), 'utf8');
const html = file('spectator.html');
const en = JSON.parse(file('i18n/en.json'));
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script'));

const base = { language: 'en', title: "Anna's night", status: 'in_progress', revision: 1, updatedAt: new Date().toISOString(), rounds: [], score: { correct: 0, wrong: 0, played: 0, total: 20 } };
const live = (extra) => ({ n: 1, question: 'What is my go-to karaoke song?', theme: 'Music', doubled: false, penalty: { type: 'dare', label: 'Dare', description: 'sing the chorus' }, ...extra });

let next;   // what the API answers on the next poll
function mockFetch() {
  globalThis.fetch = vi.fn(async (url) => {
    if (String(url).includes('i18n/')) return new Response(JSON.stringify(en), { status: 200 });
    return new Response(JSON.stringify(next), { status: 200, headers: { etag: `"${next.revision}"` } });
  });
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const text = (id) => document.getElementById(id).textContent;

beforeEach(() => {
  vi.resetModules();
  document.body.innerHTML = body;
  location.hash = '#t=guest-token-guest-token-guest-token';
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  mockFetch();
});

describe('guest page', () => {
  it('shows the question and the dare but keeps the answer hidden until it is revealed', async () => {
    next = { ...base, live: live({ answerRevealed: false }) };
    await import('../src/spectator.js');
    await tick(); await tick();
    expect(document.getElementById('live').hidden).toBe(false);
    expect(text('live-question')).toBe('What is my go-to karaoke song?');
    expect(text('live-penalty-text')).toBe('sing the chorus');
    expect(text('live-answer-label')).toBe(en['spectator.answerHidden']);
    expect(text('live-answer')).not.toContain('Dancing');
    expect(globalThis.fetch.mock.calls.some(([u, init]) => String(u).includes('/v1/s/summary') && init.headers['X-Game-Token'])).toBe(true);
  });

  it('shows the answer once the organiser has revealed it', async () => {
    next = { ...base, revision: 2, live: live({ answerRevealed: true, answer: 'Dancing Queen' }) };
    await import('../src/spectator.js');
    await tick(); await tick();
    expect(text('live-answer-label')).toBe(en['spectator.answer']);
    expect(text('live-answer')).toBe('Dancing Queen');
  });

  it('lists played rounds with answer, result and who took the penalty', async () => {
    next = { ...base, revision: 3, live: null, score: { correct: 1, wrong: 0, played: 1, total: 20 },
      rounds: [{ n: 1, question: 'Beach or mountains?', answer: 'Mountains', result: 'correct', doubled: true, takenBy: ['Ola'], penalty: { type: 'drink', label: 'Drink', description: '4 fingers' } }] };
    await import('../src/spectator.js');
    await tick(); await tick();
    expect(document.getElementById('live').hidden).toBe(true);
    expect(text('correct')).toBe('1');
    const card = document.getElementById('rounds').textContent;
    expect(card).toContain('Beach or mountains?');
    expect(card).toContain('Mountains');
    expect(card).toContain('×2');
    expect(card).toContain('Ola');
  });

  it('renders text as text, never as markup', async () => {
    next = { ...base, revision: 4, live: live({ answerRevealed: true, answer: '<img src=x onerror=alert(1)>', question: '<b>bold?</b>' }) };
    await import('../src/spectator.js');
    await tick(); await tick();
    expect(document.querySelector('#live img')).toBeNull();
    expect(text('live-question')).toBe('<b>bold?</b>');
  });

  it('clears the board when the link is gone', async () => {
    globalThis.fetch = vi.fn(async (url) => (String(url).includes('i18n/')
      ? new Response(JSON.stringify(en), { status: 200 })
      : new Response(JSON.stringify({ error: { code: 'link_unavailable' } }), { status: 404 })));
    await import('../src/spectator.js');
    await tick(); await tick();
    expect(document.getElementById('board').hidden).toBe(true);
    expect(document.getElementById('gone').hidden).toBe(false);
  });
});
