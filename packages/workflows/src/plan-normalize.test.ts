import { describe, expect, it } from 'vitest';
import { validatorFor } from '@yeonjae/domain';
import {
  normalizeArcSelfChecks,
  normalizeContractOutput,
  normalizeScenePlans,
} from './plan-normalize.js';
import { type ChapterContract } from './planning.js';

const MC = '0190b3a0-0000-7000-8000-000000000001';
const HEROINE = '0190b3a0-0000-7000-8000-000000000002';
const ACADEMY = '0190b3a0-0000-7000-8000-000000000003';
const SECRET = '0190b3a0-0000-7000-8000-000000000004';
const PROMISE = '0190b3a0-0000-7000-8000-000000000005';
const UNKNOWN = '0190b3a0-0000-7000-8000-00000000dead';

// The shape the v2.2.5 chapter_planner prompt asked for: close to the schema, but not the schema.
const LIVE = {
  purpose: '루카스가 입학식에서 원작과 어긋난 첫 장면을 목격한다',
  must_happen: [{ description: '입학식 배치표가 원작과 다르다', evidence: '배치표' }],
  must_not_happen: ['주인공의 정체가 드러난다'],
  pov: { character_id: MC, person: 'first' },
  participants: [
    { character_id: MC, role: '주인공', on_page: true },
    { character_id: HEROINE, role: 'love_interest', on_page: true },
    { character_id: UNKNOWN, role: 'ally', on_page: true },
  ],
  mentioned_only: ['에리카'],
  locations: [ACADEMY],
  story_time: {
    start: { chapter_no: 1, ordinal: 0, precision: 'exact' },
    elapsed_since_previous: '없음',
  },
  knowledge_deltas: [
    {
      knower: { kind: 'character', entity_id: HEROINE },
      proposition_id: 'secret-1',
      new_proposition: '루카스는 뭔가를 알고 있다',
      from_stance: 'unaware',
      to_stance: 'suspects',
      how: '눈치',
    },
  ],
  state_deltas: [],
  relationship_deltas: [{ source_id: HEROINE, target_id: MC, change: '호기심' }],
  introduces: [HEROINE],
  setups: [{ id: 'S-1', statement: '배치표의 빈칸', due_chapter_window: { min: 2, max: 5 } }],
  payoffs: [],
  progression: [{ milestone_id: 'm1', description: '첫 스킬', magnitude: 'minor' }],
  emotional_movement: { from: '체념', to: '불안' },
  conflict: { type: 'internal', description: '원작을 믿어도 되는가' },
  local_satisfaction: [{ type: 'cider', description: '귀족 도련님의 헛발질' }],
  ending_state: '배치표에 없는 이름이 불린다',
  hook: { type: 'cliffhanger', description: '자기 이름이 불린다' },
  opening: { type: 'in_medias_res', description: '입학식 한복판' },
  scene_count: 3,
  dialogue_density_target: 0.35,
  length_target: { unit: 'characters', value: 5000, tolerance_ratio: 0.12 },
  continuity_anchors: [{ fact: '루카스는 백작가의 셋째다' }],
  knowledge_guards: [{ character_id: HEROINE, must_not_know_proposition_ids: [SECRET] }],
  acceptance_criteria: [],
};

const envelope = (content: Record<string, unknown>) =>
  ({
    ...content,
    id: '0190b3a0-0000-7000-8000-0000000000c1',
    project_id: '0190b3a0-0000-7000-8000-0000000000c2',
    chapter_number: 1,
    version: 1,
    arc_id: '0190b3a0-0000-7000-8000-0000000000c3',
    timeline_id: '0190b3a0-0000-7000-8000-0000000000c4',
    status: 'draft',
    pinned: { spec_version: 1, bible_version: 1, canon_version: 1 },
    narrative_identity_version_id: '0190b3a0-0000-7000-8000-0000000000c5',
    active_constraints_ref: {
      id: '0190b3a0-0000-7000-8000-0000000000c6',
      content_hash: 'sha256:x',
      token_count: 10,
    },
  }) as unknown as ChapterContract;

describe('live planner output normalization', () => {
  const validate = validatorFor<ChapterContract>('chapter-contract.schema.json');
  const input = {
    chapterNo: 1,
    lengthTarget: { unit: 'characters' as const, value: 5500, tolerance_ratio: 0.12 },
    knownEntityIds: new Set([MC, HEROINE, ACADEMY]),
    knownPropositionIds: new Set([SECRET]),
    knownPromiseIds: new Set([PROMISE]),
  };

  it('the raw v2.2.5 shape fails the schema; the normalized contract validates', () => {
    expect(validate(envelope(LIVE)).ok).toBe(false);
    const normalized = normalizeContractOutput(LIVE, input);
    const v = validate(envelope(normalized));
    expect(v.ok ? [] : v.errors).toEqual([]);
  });

  it('keeps grounded content and drops what cannot be grounded', () => {
    const n = normalizeContractOutput(LIVE, input) as unknown as ChapterContract;
    expect(n.participants.map((p) => p.character_id)).toEqual([MC, HEROINE]);
    expect(n.participants[1]?.role_in_chapter).toBe('love_interest');
    expect(n.mentioned_only).toEqual([]);
    expect(n.must_happen[0]).toMatchObject({ id: 'MH-1', kind: 'event', verifiable_by: 'judge' });
    expect(n.must_not_happen[0]).toMatchObject({ id: 'MNH-1', source: 'local' });
    expect(n.knowledge_deltas[0]).toMatchObject({ new_proposition: '루카스는 뭔가를 알고 있다' });
    expect(n.knowledge_deltas[0]?.proposition_id).toBeUndefined();
    expect(n.relationship_deltas[0]).toMatchObject({ from_id: HEROINE, to_id: MC, axis: 'trust' });
    expect(n.setups).toEqual([]);
    expect(n.local_satisfaction[0].type).toBe('satisfaction');
    expect(n.emotional_movement).toEqual({ start: '체념', end: '불안' });
    expect(n.length_target).toEqual({ unit: 'characters', value: 5500, tolerance_ratio: 0.12 });
    expect(n.continuity_risks[0]?.description).toContain('루카스는 백작가의 셋째다');
    expect(n.acceptance_criteria[0]).toMatchObject({ id: 'AC-MH-1', check_ref: 'MH-1' });
  });

  it('grounds scene plans in the contract and rescales lengths to the chapter target', () => {
    const contract = normalizeContractOutput(LIVE, input) as unknown as ChapterContract;
    const scenes = normalizeScenePlans(
      [
        {
          scene_no: 1,
          objective: '입학식',
          pov: { character_id: MC },
          participants: [MC, UNKNOWN],
          location_id: UNKNOWN,
          beats: [
            { type: 'reaction', description: '속으로 한숨', emotion: '체념' },
            { type: 'interior', description: '원작 회상' },
          ],
          length_target: { unit: 'characters', value: 1800 },
          speaker_pairs: [{ a: '루카스', b: '에리카' }],
        },
        {
          scene_no: 2,
          objective: '배치표',
          pov: { character_id: HEROINE },
          participants: [HEROINE],
          location_id: ACADEMY,
          beats: [{ type: 'dialogue', description: '말다툼' }],
          length_target: { unit: 'characters', value: 1800 },
        },
      ],
      { contract },
    );
    const v = validatorFor('scene-plan.schema.json');
    for (const s of scenes) expect(v(s).ok).toBe(true);
    expect(scenes[0]?.location_id).toBe(ACADEMY);
    expect(scenes[0]?.participants).toEqual([MC]);
    const total = scenes.reduce(
      (a, s) => a + ((s.length_target as { value: number } | undefined)?.value ?? 0),
      0,
    );
    expect(total).toBe(5500);
  });
});

describe('arc planner self-checks', () => {
  it('turns the prompt-shaped prose repetition_check into notes (recorded live output)', () => {
    const out = normalizeArcSelfChecks({
      title: '빙의, 그리고 3개월의 시한부',
      repetition_check: '이전 아크가 없는 도입부 아크로서 고유의 훅을 확립함.',
      cadence_check: { cider_interval_ok: true, notes: ['사이다 비트: 3화, 7화, 11화'], extra: 1 },
    });
    expect(out.repetition_check).toEqual({
      notes: '이전 아크가 없는 도입부 아크로서 고유의 훅을 확립함.',
    });
    expect(out.cadence_check).toEqual({
      cider_interval_ok: true,
      notes: ['사이다 비트: 3화, 7화, 11화'],
    });
    expect(out.title).toBe('빙의, 그리고 3개월의 시한부');
  });

  it('keeps a well-formed object, drops ungrounded ids, and drops unreadable values', () => {
    const id = '0190f0a0-0000-7000-8000-000000000001';
    expect(
      normalizeArcSelfChecks({
        repetition_check: { compared_arc_ids: [id, '아크 1'], similarity_score: 1.4, notes: 'ok' },
      }).repetition_check,
    ).toEqual({ compared_arc_ids: [id], similarity_score: 1, notes: 'ok' });
    const dropped = normalizeArcSelfChecks({ repetition_check: 3, cadence_check: null });
    expect('repetition_check' in dropped || 'cadence_check' in dropped).toBe(false);
  });
});
