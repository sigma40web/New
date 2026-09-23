import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compactDesign, validateContract } from './planning.js';

const CONTRACT = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../examples/fixture/chapter-contract.ch12.json', import.meta.url)),
    'utf8',
  ),
) as Parameters<typeof validateContract>[0];

describe('contract length-unit consistency (ADR-0054)', () => {
  const knownEntities = new Set<string>([
    ...CONTRACT.participants.map((p) => p.character_id),
    ...CONTRACT.locations,
  ]);
  const knownProps = new Set<string>([
    ...CONTRACT.knowledge_guards.flatMap((g) => g.must_not_know_proposition_ids),
    ...CONTRACT.knowledge_deltas.map((d) => d.proposition_id).filter((x) => !!x),
  ]);
  const input = (unit: 'words' | 'characters') => ({
    chapterNo: CONTRACT.chapter_number,
    mainTimelineId: CONTRACT.timeline_id,
    spec: { version: CONTRACT.pinned.spec_version, items: [] },
    lengthTarget: { unit, value: CONTRACT.length_target.value, tolerance_ratio: 0.12 },
  });

  it('accepts a contract whose length unit matches the project target unit', () => {
    expect(validateContract(CONTRACT, input('words'), knownProps, knownEntities)).toEqual([]);
  });

  it('rejects a words contract when the project target unit is characters (ko)', () => {
    const issues = validateContract(CONTRACT, input('characters'), knownProps, knownEntities);
    expect(issues.join(' ')).toMatch(
      /length_target unit words does not match the project target unit characters/,
    );
  });
});

describe('compact design rendering', () => {
  it('drops quoting, empty fields and duplicated propositions but keeps every authored value', () => {
    const out = compactDesign({
      characters: {
        characters: [
          {
            display_name: '카일 라인하르트',
            age_at_start: 18,
            aliases: ['결함 회로'],
            goals: ['생존한다'],
            flaws: [],
            registers: [{ toward: '리아', formality: 2 }],
          },
        ],
        propositions: [{ statement: '빙의자다' }],
      },
      world: { terminology: [{ term: '마나', english: 'Mana', decision: 'preserve' }] },
    });
    expect(out).toBe(
      '{characters: {characters: [{display_name: 카일 라인하르트; age_at_start: 18; goals: [생존한다]; registers: [{toward: 리아; formality: 2}]}]}; world: {terminology: [{term: 마나}]}}',
    );
  });
});
