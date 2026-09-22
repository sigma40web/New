import { describe, expect, it } from 'vitest';
import { WorkflowError } from './errors.js';
import {
  mergePacing,
  normalizePacingSeason,
  pacingRulesFor,
  renderArcRhythm,
  renderRhythmPosition,
  rhythmSkeleton,
  type PacingChapter,
} from './pacing.js';

const SEASON = { ordinal: 1, title: '입학', from: 1, to: 30 };
const rules = pacingRulesFor(200);

function slot(n: number, over: Partial<PacingChapter> = {}) {
  const climax = n === 14 || n === 29;
  return {
    chapter_no: n,
    role: climax ? 'climax' : n === 1 ? 'hook' : n === 15 || n === 30 ? 'aftermath' : 'buildup',
    tension: climax ? 8 : n <= 10 ? 4 : 6,
    beat: `${n}화 핵심 사건`,
    thread: 'main',
    payoff: n % 3 === 0 || climax ? 'cider' : 'none',
    frustration: false,
    hook: 'cliffhanger',
    ...over,
  };
}
const good = () => ({
  arcs: [
    {
      ordinal: 1,
      title: '입학 시험',
      kind: 'exam',
      from: 1,
      to: 15,
      purpose: '입학',
      climax_chapter: 14,
      focus_characters: ['엘리제'],
    },
    {
      ordinal: 2,
      title: '첫 실습',
      kind: 'dungeon',
      from: 16,
      to: 30,
      purpose: '실습',
      climax_chapter: 29,
      focus_characters: [],
    },
  ],
  chapters: Array.from({ length: 30 }, (_, i) => slot(i + 1)),
});

const rejects = (raw: unknown, pattern: RegExp) => {
  try {
    normalizePacingSeason(raw, SEASON, 0, rules);
    throw new Error('expected a rejection');
  } catch (err) {
    expect(err).toBeInstanceOf(WorkflowError);
    expect((err as WorkflowError).code).toBe('ARC_PLAN_INVALID');
    expect((err as Error).message).toMatch(pattern);
  }
};

describe('pacing map (ADR-0056)', () => {
  it('accepts a season whose every chapter has a slot and whose arcs build to one climax each', () => {
    const map = normalizePacingSeason(good(), SEASON, 0, rules);
    expect(map.arcs.map((a) => [a.ordinal, a.from, a.to, a.climax_chapter])).toEqual([
      [1, 1, 15, 14],
      [2, 16, 30, 29],
    ]);
    expect(map.chapters).toHaveLength(30);
    expect(map.chapters[20]?.arc_ordinal).toBe(2);
  });

  it('numbers arcs series-globally across seasons', () => {
    const s2 = { ordinal: 2, title: '축제', from: 31, to: 45 };
    const raw = {
      arcs: [
        {
          ordinal: 1,
          title: '축제',
          kind: 'tournament',
          from: 31,
          to: 45,
          purpose: '',
          climax_chapter: 44,
          focus_characters: [],
        },
      ],
      chapters: Array.from({ length: 15 }, (_, i) =>
        slot(31 + i, {
          role: 31 + i === 44 ? 'climax' : 'buildup',
          payoff: i % 2 ? 'none' : 'cider',
        }),
      ),
    };
    const map = mergePacing([
      normalizePacingSeason(good(), SEASON, 0, rules),
      normalizePacingSeason(raw, s2, 2, rules),
    ]);
    expect(map.arcs.map((a) => a.ordinal)).toEqual([1, 2, 3]);
    expect(map.chapters.find((c) => c.chapter_no === 40)?.arc_ordinal).toBe(3);
  });

  it('rejects a missing chapter slot', () => {
    const raw = good();
    raw.chapters.splice(9, 1);
    rejects(raw, /chapters without a slot: 10/);
  });

  it('rejects an arc with no climax', () => {
    const raw = good();
    raw.chapters[28] = slot(29, { role: 'incident' });
    rejects(raw, /arc 2 has no climax/);
  });

  it('rejects a frustration streak beyond three chapters', () => {
    const raw = good();
    for (const n of [17, 18, 19, 20]) raw.chapters[n - 1] = slot(n, { frustration: true });
    rejects(raw, /frustration streak/);
  });

  it('rejects a payoff drought', () => {
    const raw = good();
    for (let n = 16; n <= 22; n++) raw.chapters[n - 1] = slot(n, { payoff: 'none' });
    rejects(raw, /no payoff for more than 5 chapters/);
  });

  it('rejects a climax plateau and a rushed opening', () => {
    const plateau = good();
    for (let n = 20; n <= 24; n++) plateau.chapters[n - 1] = slot(n, { tension: 9 });
    rejects(plateau, /tension stays ≥ 8/);
    const rushed = good();
    rushed.chapters[4] = slot(5, { role: 'climax', tension: 9 });
    rejects(rushed, /too intense for the slow opening/);
  });

  it('renders the arc rhythm and a chapter rhythm position in Korean', () => {
    const map = normalizePacingSeason(good(), SEASON, 0, rules);
    const arc = renderArcRhythm(map, 1);
    expect(arc).toContain('아크 1 「입학 시험」');
    expect(arc).toContain('14화 [클라이맥스·긴장 8');
    const pos = renderRhythmPosition(map, 13);
    expect(pos).toContain('이번 회차: 13화 [빌드업');
    expect(pos).toContain('클라이맥스는 14화 (1화 뒤)');
    expect(pos).toContain('뒤 회차의 사건을 당겨 오지 않고');
    expect(renderRhythmPosition(undefined, 3)).toContain('페이싱 지도 없음');
  });

  it('skeletons suggest arcs and the slow opening only for long serials', () => {
    expect(rhythmSkeleton(SEASON, 200, rules)).toContain('연재 초반');
    expect(
      rhythmSkeleton({ ordinal: 1, title: 't', from: 1, to: 2 }, 2, pacingRulesFor(2)),
    ).not.toContain('연재 초반');
  });
});
