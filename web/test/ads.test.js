import { beforeEach, describe, expect, it } from 'vitest';
import { syncBanner } from '../src/native/ads.js';

const slot = () => document.getElementById('ad-slot');

beforeEach(() => { document.body.innerHTML = '<div id="ad-slot" hidden>ad</div><div id="ad-slot-score" hidden>ad</div>'; });

describe('banner stand-in in a browser', () => {
  it('marks the banner position on the allowed screens while developing', async () => {
    await syncBanner('home', false, 'localhost');
    expect(slot().hidden).toBe(false);
    await syncBanner('question', false, 'localhost');
    expect(slot().hidden).toBe(true);
    await syncBanner('home', true, 'localhost');          // premium: never
    expect(slot().hidden).toBe(true);
  });

  it('never shows on the deployed web version, which has no ads', async () => {
    await syncBanner('home', false, 'bachelor.91-98-25-205.sslip.io');
    expect(slot().hidden).toBe(true);
    await syncBanner('scoreboard', false, 'bachelor.91-98-25-205.sslip.io');
    expect(document.getElementById('ad-slot-score').hidden).toBe(true);
  });
});
