import { describe, expect, it } from 'vitest';
import {
  type DesignPart,
  designPartsEnabled,
  isPlaceholderItem,
  mergeParts,
  scopeToPart,
  stripNulls,
} from './design-parts.js';

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

  it('treats null fields as absent but keeps null items for the validator to reject', () => {
    expect(
      stripNulls({ characters: [{ display_name: '벨리알', age_at_start: null }, null] }),
    ).toEqual({
      characters: [{ display_name: '벨리알' }, null],
    });
  });

  it('takes an owned field only from its owner part (live placeholder filler)', () => {
    // Recorded live: the heroine-arcs part returned endgame_requirements: [{ id: 'EG-0', statement: '' }].
    const corePart: DesignPart = {
      key: 'core',
      fields: ['ending', 'endgame_requirements'],
      instruction: () => '',
    };
    const arcsPart: DesignPart = { key: 'arcs', fields: ['character_arcs'], instruction: () => '' };
    const parts = [corePart, arcsPart];
    const core = {
      ending: { summary: '재봉인' },
      endgame_requirements: [{ id: 'EG-1', statement: '봉인' }],
    };
    const arcs = {
      ending: { summary: '다른 결말' },
      endgame_requirements: [{ id: 'EG-0', kind: 'fact', statement: '봉인 해제' }],
      character_arcs: [{ entity_name: '엘리제' }],
      mysteries: [{ statement: '금서고' }],
    };
    const merged = mergeParts([
      scopeToPart(core, corePart, parts),
      scopeToPart(arcs, arcsPart, parts),
    ]);
    expect(merged.endgame_requirements).toEqual([{ id: 'EG-1', statement: '봉인' }]);
    expect(merged.ending).toEqual({ summary: '재봉인' });
    expect(merged.character_arcs).toEqual([{ entity_name: '엘리제' }]);
    // A field no part owns still merges from whichever part wrote it.
    expect(merged.mysteries).toEqual([{ statement: '금서고' }]);
  });

  it('drops placeholder array items that carry no authored content', () => {
    expect(isPlaceholderItem({ id: 'EG-0', kind: 'fact', statement: '' })).toBe(true);
    expect(isPlaceholderItem({ id: 'EG-0', statement: '봉인' })).toBe(false);
    expect(isPlaceholderItem({ chapter_no: 3 })).toBe(false);
    const merged = mergeParts([
      { characters: [{ display_name: '카일' }] },
      { characters: [{ display_name: '', goals: [] }] },
    ]);
    expect(merged.characters).toEqual([{ display_name: '카일' }]);
  });

  it('is an explicit operator choice', () => {
    expect(designPartsEnabled({})).toBe(false);
    expect(designPartsEnabled({ YEONJAE_DESIGN_PARTS: 'on' })).toBe(true);
  });
});
