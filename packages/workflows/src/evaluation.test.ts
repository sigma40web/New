import { describe, expect, it } from 'vitest';
import { driftFlags, likertScores } from './evaluation.js';

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

describe('drift flags', () => {
  const PROSE = { translation_like: /번역/, literary: /서구|수필/ };
  it('maps free-text flags from live judges onto the enum (recorded live output)', () => {
    expect(
      driftFlags(
        [
          "p152에 수필적 수사와 서구식 딕션('감각이 있었다')이 남아 있다.",
          '번역투 어미가 반복된다.',
          '회차 절단이 약하다.',
          'literary',
          7,
        ],
        PROSE,
      ),
    ).toEqual(['literary', 'translation_like']);
    expect(driftFlags(undefined, PROSE)).toEqual([]);
  });
});
