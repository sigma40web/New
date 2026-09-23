import { describe, expect, it } from 'vitest';
import { likertScores } from './evaluation.js';

describe('scorecard dimension scores', () => {
  it('maps the 0–100 answers live Korean judges give onto 1–5 (recorded live output)', () => {
    expect(likertScores({ structure: 86 })).toEqual({ structure: 4.4 });
    expect(likertScores({ prose: 100, voice: 0.5, genre: 4 })).toEqual({
      prose: 5,
      voice: 1,
      genre: 4,
    });
  });

  it('drops non-numbers and tolerates a missing map', () => {
    expect(likertScores({ a: '4', b: Number.NaN })).toEqual({});
    expect(likertScores(undefined)).toEqual({});
  });
});
