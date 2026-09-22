import { describe, expect, it } from 'vitest';
import { designPartsEnabled, mergeParts } from './design-parts.js';

describe('part-scoped design calls (ADR-0057)', () => {
  it('concatenates arrays across parts and lets a later part refine an item with the same key', () => {
    const merged = mergeParts([
      {
        characters: [{ display_name: '카일', role: 'protagonist' }],
        propositions: [{ statement: 'A' }],
      },
      {
        characters: [
          { display_name: '엘리제', role: 'love_interest' },
          { display_name: '카일', role: 'protagonist', background: '빙의자' },
        ],
        propositions: [{ statement: 'B' }],
      },
    ]);
    expect(merged.characters).toEqual([
      { display_name: '카일', role: 'protagonist', background: '빙의자' },
      { display_name: '엘리제', role: 'love_interest' },
    ]);
    expect(merged.propositions).toEqual([{ statement: 'A' }, { statement: 'B' }]);
  });

  it('keeps the first non-empty scalar or object and merges pacing windows by chapter', () => {
    const merged = mergeParts([
      {
        story_promise: '약속',
        ending: { type: 'happy' },
        seasons: [{ title: '입학' }],
        promises: [],
      },
      { story_promise: '', ending: {}, seasons: [], promises: [{ statement: '떡밥' }] },
      { chapters: [{ chapter_no: 1 }, { chapter_no: 2 }] },
      { chapters: [{ chapter_no: 2, beat: '수정' }, { chapter_no: 3 }] },
    ]);
    expect(merged.story_promise).toBe('약속');
    expect(merged.ending).toEqual({ type: 'happy' });
    expect(merged.seasons).toEqual([{ title: '입학' }]);
    expect(merged.promises).toEqual([{ statement: '떡밥' }]);
    expect(merged.chapters).toEqual([
      { chapter_no: 1 },
      { chapter_no: 2, beat: '수정' },
      { chapter_no: 3 },
    ]);
  });

  it('is an explicit operator choice', () => {
    expect(designPartsEnabled({})).toBe(false);
    expect(designPartsEnabled({ YEONJAE_DESIGN_PARTS: 'on' })).toBe(true);
  });
});
