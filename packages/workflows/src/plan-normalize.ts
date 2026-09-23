/**
 * Normalizers for live planner output (chapter contracts and scene plans).
 *
 * A live model follows the requested JSON shape closely but not exactly: strings where objects are
 * expected, near-miss enum values ("reaction", "cider"), names where ids are expected, invented ids. The
 * schemas are strict (`additionalProperties: false`), so one stray key fails the whole contract. These
 * functions keep what is meaningful, coerce what is unambiguous, and DROP what cannot be grounded (an id that
 * is not in the registry is never invented or guessed). The workflow-owned envelope is not touched here.
 * The result is still validated against the schema by the caller; normalization never replaces validation.
 */
import { type LengthTarget } from '@yeonjae/prose';
import { type ChapterContract } from './planning.js';

type Rec = Record<string, unknown>;
type Contract = ChapterContract;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clamp01 = (v: unknown, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;

const MUST_KINDS = [
  'event',
  'revelation',
  'decision',
  'progression',
  'relationship',
  'comedic_beat',
  'required_scene',
] as const;
const VERIFY = ['extraction', 'judge', 'lexical_marker', 'human'] as const;
const MNH_SOURCES = ['spec', 'arc', 'local', 'content_restriction'] as const;
const PERSONS = ['first', 'third_limited', 'third_omniscient'] as const;
const ROLES = [
  'protagonist',
  'antagonist',
  'ally',
  'foil',
  'cameo',
  'love_interest',
  'mentor',
  'comic_relief',
] as const;
const STANCES = [
  'knows',
  'suspects',
  'believes_false',
  'pretends',
  'unaware',
  'forgot',
  'doubts',
] as const;
const CHANNELS = [
  'witnessed',
  'told',
  'inferred',
  'read',
  'overheard',
  'deduced',
  'remembered',
  'prior_loop_memory',
  'source_story',
] as const;
const AXES = ['trust', 'affection', 'respect', 'hostility', 'dependency', 'type'] as const;
const DIRECTIONS = ['up', 'down', 'change'] as const;
const INTRO_KINDS = [
  'character',
  'location',
  'organization',
  'item',
  'ability',
  'term',
  'proposition',
] as const;
const CONFLICTS = ['external', 'internal', 'interpersonal', 'social'] as const;
const PAYOFFS = [
  'satisfaction',
  'revelation',
  'emotional_step',
  'growth_confirmed',
  'humor_beat',
] as const;
const ENDINGS = [
  'cliffhanger',
  'reveal',
  'decision',
  'arrival_of_threat',
  'emotional_peak',
  'quiet_ominous',
] as const;
const OPENINGS = [
  'continue_cliffhanger',
  'in_medias_res',
  'sharp_dialogue',
  'status_update',
  'time_skip_with_tension',
] as const;
const WHEN = ['early', 'middle', 'late'] as const;
const PRECISION = ['exact', 'approx', 'unknown'] as const;
const CRITERIA = ['deterministic', 'judge', 'human'] as const;

const PAYOFF_ALIASES: Readonly<Record<string, (typeof PAYOFFS)[number]>> = {
  cider: 'satisfaction',
  사이다: 'satisfaction',
  reveal: 'revelation',
  폭로: 'revelation',
  emotion: 'emotional_step',
  emotional: 'emotional_step',
  감정: 'emotional_step',
  growth: 'growth_confirmed',
  성장: 'growth_confirmed',
  humor: 'humor_beat',
  comedy: 'humor_beat',
  웃음: 'humor_beat',
};

export interface ContractNormalizeInput {
  readonly chapterNo: number;
  readonly lengthTarget: LengthTarget;
  readonly knownEntityIds: ReadonlySet<string>;
  readonly knownPropositionIds: ReadonlySet<string>;
  readonly knownPromiseIds: ReadonlySet<string>;
}

function clock(raw: unknown, chapterNo: number, ordinal: number, precision: 'exact' | 'approx') {
  const r = isRec(raw) ? raw : {};
  const ord =
    typeof r.ordinal === 'number' && Number.isInteger(r.ordinal) && r.ordinal >= 0
      ? Math.min(999_999, r.ordinal)
      : ordinal;
  return {
    chapter_no: chapterNo,
    ordinal: ord,
    precision: oneOf(r.precision, PRECISION, precision),
    ...(str(r.world_date) ? { world_date: str(r.world_date) } : {}),
    ...(str(r.calendar) ? { calendar: str(r.calendar) } : {}),
  };
}

/**
 * The model-authored content fields of a chapter contract, coerced toward chapter-contract.schema.json.
 * Returns only content fields; the caller adds the workflow envelope and validates.
 */
export function normalizeContractOutput(raw: unknown, input: ContractNormalizeInput): Rec {
  const r = isRec(raw) ? raw : {};
  const ent = (v: unknown) =>
    typeof v === 'string' && input.knownEntityIds.has(v) ? v : undefined;
  const prop = (v: unknown) =>
    typeof v === 'string' && input.knownPropositionIds.has(v) ? v : undefined;
  const ch = input.chapterNo;

  const mustHappen = arr(r.must_happen)
    .map((m, i) => {
      const o = isRec(m) ? m : { description: m };
      const description = str(o.description) ?? str(o.text);
      if (!description) return undefined;
      const entityIds = arr(o.entity_ids)
        .map(ent)
        .filter((x): x is string => !!x);
      const propositionIds = arr(o.proposition_ids)
        .map(prop)
        .filter((x): x is string => !!x);
      return {
        id: str(o.id) ?? `MH-${i + 1}`,
        kind: oneOf(o.kind, MUST_KINDS, 'event'),
        description,
        verifiable_by: oneOf(o.verifiable_by, VERIFY, 'judge'),
        ...(entityIds.length ? { entity_ids: entityIds } : {}),
        ...(propositionIds.length ? { proposition_ids: propositionIds } : {}),
        ...(str(o.requirement_id) ? { requirement_id: str(o.requirement_id) } : {}),
      };
    })
    .filter((x) => x !== undefined);

  const mustNot = arr(r.must_not_happen)
    .map((m, i) => {
      const o = isRec(m) ? m : { description: m };
      const description = str(o.description) ?? str(o.text);
      if (!description) return undefined;
      return {
        id: str(o.id) ?? `MNH-${i + 1}`,
        description,
        source: oneOf(o.source, MNH_SOURCES, str(o.requirement_id) ? 'spec' : 'local'),
        ...(str(o.requirement_id) ? { requirement_id: str(o.requirement_id) } : {}),
      };
    })
    .filter((x) => x !== undefined);

  const participantsRaw = arr(r.participants)
    .map((p) => {
      const o = isRec(p) ? p : { character_id: p };
      const id = ent(o.character_id) ?? ent(o.entity_id) ?? ent(o.id);
      if (!id) return undefined;
      const role = str(o.role_in_chapter) ?? str(o.role);
      return {
        character_id: id,
        role_in_chapter: oneOf(role, ROLES, 'ally'),
        on_page: typeof o.on_page === 'boolean' ? o.on_page : true,
      };
    })
    .filter((x) => x !== undefined);
  const participants = participantsRaw.filter(
    (p, i) => participantsRaw.findIndex((q) => q.character_id === p.character_id) === i,
  );
  const povRaw = isRec(r.pov) ? r.pov : {};
  const povId =
    ent(povRaw.character_id) ??
    participants.find((p) => p.role_in_chapter === 'protagonist')?.character_id ??
    participants[0]?.character_id;
  if (povId && !participants.some((p) => p.character_id === povId))
    participants.unshift({ character_id: povId, role_in_chapter: 'protagonist', on_page: true });

  const storyTime = isRec(r.story_time) ? r.story_time : {};
  const knowledgeDeltas = arr(r.knowledge_deltas)
    .map((d) => {
      if (!isRec(d)) return undefined;
      const knower = isRec(d.knower) ? d.knower : {};
      const knowerId = ent(knower.entity_id) ?? ent(d.character_id);
      const kind = oneOf(knower.kind, ['character', 'narrator', 'reader'] as const, 'character');
      if (kind === 'character' && !knowerId) return undefined;
      const propositionId = prop(d.proposition_id);
      const newProposition = str(d.new_proposition);
      if (!propositionId && !newProposition) return undefined;
      return {
        knower: kind === 'character' ? { kind, entity_id: knowerId } : { kind },
        ...(propositionId ? { proposition_id: propositionId } : {}),
        ...(!propositionId && newProposition ? { new_proposition: newProposition } : {}),
        from_stance: oneOf(d.from_stance, STANCES, 'unaware'),
        to_stance: oneOf(d.to_stance, STANCES, 'knows'),
        how: str(d.how) ?? str(d.channel) ?? '지면에서 드러남',
        ...(typeof d.channel_kind === 'string' &&
        (CHANNELS as readonly string[]).includes(d.channel_kind)
          ? { channel_kind: d.channel_kind }
          : {}),
        ...(ent(d.informer_id) ? { informer_id: ent(d.informer_id) } : {}),
      };
    })
    .filter((x) => x !== undefined);

  const stateDeltas = arr(r.state_deltas)
    .map((d) => {
      if (!isRec(d)) return undefined;
      const id = ent(d.entity_id);
      const attribute = str(d.attribute);
      if (!id || !attribute || d.to === undefined) return undefined;
      return {
        entity_id: id,
        attribute,
        ...(str(d.key) ? { key: str(d.key) } : {}),
        ...(d.from !== undefined ? { from: d.from } : {}),
        to: d.to,
        ...(typeof d.when_in_chapter === 'string' &&
        (WHEN as readonly string[]).includes(d.when_in_chapter)
          ? { when_in_chapter: d.when_in_chapter }
          : {}),
        ...(str(d.description) ? { description: str(d.description) } : {}),
      };
    })
    .filter((x) => x !== undefined);

  const relationshipDeltas = arr(r.relationship_deltas)
    .map((d) => {
      if (!isRec(d)) return undefined;
      const from = ent(d.from_id) ?? ent(d.source_id);
      const to = ent(d.to_id) ?? ent(d.target_id);
      if (!from || !to) return undefined;
      const magnitude =
        typeof d.magnitude === 'number'
          ? Math.min(5, Math.max(1, Math.round(d.magnitude)))
          : undefined;
      const description = str(d.description) ?? str(d.change);
      return {
        from_id: from,
        to_id: to,
        axis: oneOf(d.axis, AXES, 'trust'),
        direction: oneOf(d.direction, DIRECTIONS, 'change'),
        ...(magnitude ? { magnitude } : {}),
        ...(str(d.new_type) ? { new_type: str(d.new_type) } : {}),
        ...(description ? { description } : {}),
      };
    })
    .filter((x) => x !== undefined);

  const touches = (v: unknown, kind: 'open' | 'advance' | 'pay') =>
    arr(v)
      .map((t) => {
        if (!isRec(t)) return undefined;
        const id = str(t.promise_id) ?? str(t.id);
        if (!id || !input.knownPromiseIds.has(id)) return undefined;
        return {
          promise_id: id,
          how: str(t.how) ?? str(t.statement) ?? '',
          kind: oneOf(t.kind, ['open', 'advance', 'pay'] as const, kind),
        };
      })
      .filter((x) => x !== undefined && x.how.length > 0);

  const progressionRaw: unknown = Array.isArray(r.progression)
    ? (r.progression as unknown[])[0]
    : r.progression;
  const progression = isRec(progressionRaw)
    ? {
        ...(str(progressionRaw.milestone_id)
          ? { milestone_id: str(progressionRaw.milestone_id) }
          : {}),
        magnitude: oneOf(progressionRaw.magnitude, ['minor', 'major'] as const, 'minor'),
        ...((str(progressionRaw.mechanism) ?? str(progressionRaw.description))
          ? { mechanism: str(progressionRaw.mechanism) ?? str(progressionRaw.description) }
          : {}),
      }
    : undefined;

  const em = isRec(r.emotional_movement) ? r.emotional_movement : {};
  const conflict = isRec(r.conflict) ? r.conflict : {};
  const purpose = str(r.purpose) ?? '';
  const localSatisfaction = arr(r.local_satisfaction)
    .map((s) => {
      const o = isRec(s) ? s : { description: s };
      const description = str(o.description);
      if (!description) return undefined;
      const t = typeof o.type === 'string' ? (PAYOFF_ALIASES[o.type] ?? o.type) : undefined;
      return { type: oneOf(t, PAYOFFS, 'satisfaction'), description };
    })
    .filter((x) => x !== undefined);
  const hook = isRec(r.hook) ? r.hook : {};
  const opening = isRec(r.opening) ? r.opening : {};

  const risks = [
    ...arr(r.continuity_risks).map((x) => {
      const o = isRec(x) ? x : { description: x };
      const description = str(o.description);
      return description
        ? { description, ...(str(o.mitigation) ? { mitigation: str(o.mitigation) } : {}) }
        : undefined;
    }),
    // An anchor must cite a canon fact id; one the model could not ground is kept as a risk to watch.
    ...arr(r.continuity_anchors).map((x) => {
      const o = isRec(x) ? x : { fact: x };
      const text = str(o.statement) ?? str(o.fact) ?? str(o.description);
      return text && !(typeof o.fact_id === 'string' && UUID.test(o.fact_id))
        ? { description: `유지할 사실: ${text}` }
        : undefined;
    }),
  ].filter((x) => x !== undefined);

  const guards = arr(r.knowledge_guards)
    .map((g) => {
      if (!isRec(g)) return undefined;
      const id = ent(g.character_id);
      const ids = arr(g.must_not_know_proposition_ids)
        .map(prop)
        .filter((x): x is string => !!x);
      return id && ids.length
        ? { character_id: id, must_not_know_proposition_ids: ids }
        : undefined;
    })
    .filter((x) => x !== undefined);

  let criteria = arr(r.acceptance_criteria)
    .map((c, i) => {
      const o = isRec(c) ? c : { description: c };
      const description = str(o.description);
      if (!description) return undefined;
      return {
        id: str(o.id) ?? `AC-${i + 1}`,
        kind: oneOf(o.kind, CRITERIA, 'judge'),
        description,
        ...(str(o.check_ref) ? { check_ref: str(o.check_ref) } : {}),
        ...(typeof o.threshold === 'number' ? { threshold: o.threshold } : {}),
      };
    })
    .filter((x) => x !== undefined);
  if (criteria.length === 0)
    criteria = mustHappen.map((m) => ({
      id: `AC-${m.id}`,
      kind: 'judge' as const,
      description: m.description,
      check_ref: m.id,
    }));

  const sceneCount =
    typeof r.scene_count === 'number' ? Math.min(5, Math.max(1, Math.round(r.scene_count))) : 3;
  const introduces = arr(r.introduces)
    .map((x) => {
      const o = isRec(x) ? x : { name: x };
      const name = str(o.name) ?? str(o.display_name);
      if (!name || UUID.test(name)) return undefined;
      return {
        kind: oneOf(o.kind, INTRO_KINDS, 'term'),
        name,
        ...(str(o.note) ? { note: str(o.note) } : {}),
      };
    })
    .filter((x) => x !== undefined);

  const title = str(r.title);
  const out: Rec = {
    purpose,
    ...(title ? { title: title.slice(0, 80) } : {}),
    ...(str(r.reader_experience) ? { reader_experience: str(r.reader_experience) } : {}),
    ...(str(r.arc_objective_contribution)
      ? { arc_objective_contribution: str(r.arc_objective_contribution) }
      : {}),
    must_happen: mustHappen,
    must_not_happen: mustNot,
    pov: { character_id: povId ?? '', person: oneOf(povRaw.person, PERSONS, 'third_limited') },
    participants,
    mentioned_only: arr(r.mentioned_only)
      .map(ent)
      .filter((x): x is string => !!x),
    locations: arr(r.locations)
      .map(ent)
      .filter((x): x is string => !!x),
    story_time: {
      start: clock(storyTime.start, ch, 0, 'exact'),
      end: clock(storyTime.end, ch, 999, 'approx'),
      ...(str(storyTime.elapsed_since_previous)
        ? { elapsed_since_previous: str(storyTime.elapsed_since_previous) }
        : {}),
    },
    knowledge_deltas: knowledgeDeltas,
    state_deltas: stateDeltas,
    relationship_deltas: relationshipDeltas,
    ...(introduces.length ? { introduces } : {}),
    setups: touches(r.setups, 'open'),
    payoffs: touches(r.payoffs, 'pay'),
    ...(progression ? { progression } : {}),
    emotional_movement: {
      start: str(em.start) ?? str(em.from) ?? '긴장',
      ...(str(em.peak) ? { peak: str(em.peak) } : {}),
      end: str(em.end) ?? str(em.to) ?? '새로운 긴장',
    },
    conflict: {
      type: oneOf(conflict.type, CONFLICTS, 'external'),
      description: str(conflict.description) ?? purpose,
      ...(str(conflict.reversal) ? { reversal: str(conflict.reversal) } : {}),
    },
    local_satisfaction: localSatisfaction.length
      ? localSatisfaction
      : [{ type: 'satisfaction' as const, description: purpose || '작은 해소' }],
    ending_state: str(r.ending_state) ?? '',
    hook: {
      type: oneOf(hook.type, ENDINGS, 'cliffhanger'),
      description: str(hook.description) ?? '',
      ...(str(hook.question_raised) ? { question_raised: str(hook.question_raised) } : {}),
    },
    opening: {
      type: oneOf(opening.type, OPENINGS, ch > 1 ? 'continue_cliffhanger' : 'in_medias_res'),
      description: str(opening.description) ?? '',
    },
    scene_count: sceneCount,
    dialogue_density_target: clamp01(r.dialogue_density_target, 0.35),
    ...(r.monologue_density_target !== undefined
      ? { monologue_density_target: clamp01(r.monologue_density_target, 0.15) }
      : {}),
    // The project owns the length target; the model only restates it (ADR-0054 §5).
    length_target: {
      unit: input.lengthTarget.unit,
      value: input.lengthTarget.value,
      tolerance_ratio: input.lengthTarget.tolerance_ratio ?? 0.12,
    },
    tone_notes: arr(r.tone_notes)
      .map(str)
      .filter((x): x is string => !!x),
    continuity_risks: risks,
    continuity_anchors: arr(r.continuity_anchors)
      .filter(isRec)
      .filter((a) => typeof a.fact_id === 'string' && UUID.test(a.fact_id) && !!str(a.statement))
      .map((a) => ({ fact_id: a.fact_id as string, statement: str(a.statement) ?? '' })),
    knowledge_guards: guards,
    acceptance_criteria: criteria,
  };
  return out;
}

const BEAT_TYPES = [
  'action',
  'dialogue',
  'revelation',
  'decision',
  'emotional',
  'comedic',
  'progression',
  'transition',
  'status_text',
  'cliffhanger',
] as const;
const BEAT_ALIASES: Readonly<Record<string, (typeof BEAT_TYPES)[number]>> = {
  reaction: 'emotional',
  interior: 'emotional',
  monologue: 'emotional',
  reveal: 'revelation',
  humor: 'comedic',
  comedy: 'comedic',
  system: 'status_text',
  status: 'status_text',
  hook: 'cliffhanger',
  growth: 'progression',
};
const BEAT_TAGS = ['satisfaction', 'emotion', 'information', 'humor', 'growth', 'tension'] as const;

export interface ScenePlanNormalizeInput {
  readonly contract: Pick<Contract, 'pov' | 'participants' | 'locations' | 'length_target'>;
}

/**
 * Scene plans coerced toward scene-plan.schema.json and grounded in the contract: POV, participants and
 * locations fall back to the contract's; scene length targets are rescaled so they sum to the chapter
 * target (the model's proportions are kept, its arithmetic is not trusted).
 */
export function normalizeScenePlans(raw: unknown, input: ScenePlanNormalizeInput): Rec[] {
  const c = input.contract;
  const allowed = new Set(c.participants.map((p) => p.character_id));
  const scenes = arr(raw).filter(isRec);
  const drafts = scenes.map((s, i) => {
    const pov = isRec(s.pov) ? s.pov : {};
    const povId =
      typeof pov.character_id === 'string' && allowed.has(pov.character_id)
        ? pov.character_id
        : c.pov.character_id;
    const participants = arr(s.participants).filter(
      (p): p is string => typeof p === 'string' && allowed.has(p),
    );
    if (!participants.includes(povId)) participants.unshift(povId);
    const location =
      typeof s.location_id === 'string' && c.locations.includes(s.location_id)
        ? s.location_id
        : c.locations[0];
    const beats = arr(s.beats)
      .map((b) => {
        const o = isRec(b) ? b : { description: b };
        const description = str(o.description);
        if (!description) return undefined;
        const t = typeof o.type === 'string' ? (BEAT_ALIASES[o.type] ?? o.type) : undefined;
        const tags = arr(o.tags).filter(
          (x): x is (typeof BEAT_TAGS)[number] =>
            typeof x === 'string' && (BEAT_TAGS as readonly string[]).includes(x),
        );
        const emotional = str(o.emotional_target) ?? str(o.emotion);
        return {
          type: oneOf(t, BEAT_TYPES, 'action'),
          description,
          ...(emotional ? { emotional_target: emotional } : {}),
          ...(tags.length ? { tags } : {}),
        };
      })
      .filter((x) => x !== undefined);
    const lt = isRec(s.length_target) ? s.length_target : {};
    const weight = typeof lt.value === 'number' && lt.value > 0 ? lt.value : 1;
    return {
      scene_no: i + 1,
      objective: str(s.objective) ?? str(s.purpose) ?? '',
      pov: { character_id: povId, person: oneOf(pov.person, PERSONS, c.pov.person) },
      participants,
      location_id: location,
      ...(str(s.opening_beat_type) ? { opening_beat_type: str(s.opening_beat_type) } : {}),
      ...(str(s.ending_beat_type) ? { ending_beat_type: str(s.ending_beat_type) } : {}),
      beats: beats.length
        ? beats
        : [{ type: 'action' as const, description: str(s.objective) ?? '' }],
      ...(str(s.entry_state) ? { entry_state: str(s.entry_state) } : {}),
      ...(str(s.exit_state) ? { exit_state: str(s.exit_state) } : {}),
      ...(s.dialogue_density_target !== undefined
        ? { dialogue_density_target: clamp01(s.dialogue_density_target, 0.35) }
        : {}),
      must_not: arr(s.must_not)
        .map(str)
        .filter((x): x is string => !!x),
      speaker_pairs: [],
      weight,
    };
  });
  const total = drafts.reduce((a, d) => a + d.weight, 0) || 1;
  const target = c.length_target.value;
  let assigned = 0;
  return drafts.map(({ weight, ...d }, i) => {
    const value =
      i === drafts.length - 1
        ? Math.max(50, target - assigned)
        : Math.max(50, Math.round((target * weight) / total));
    assigned += value;
    return {
      ...d,
      length_target: {
        unit: c.length_target.unit,
        value,
        tolerance_ratio: c.length_target.tolerance_ratio ?? 0.12,
      },
    };
  });
}

/**
 * The arc planner's self-report fields. The Korean arc_planner prompts (3.0.0–3.2.0) show
 * `"repetition_check": "..."` in their example although the schema wants an object, so live output
 * carries prose there; prose becomes `notes`. Anything else that cannot be read is dropped (both fields
 * are optional).
 */
export function normalizeArcSelfChecks(raw: Rec): Rec {
  const out: Rec = { ...raw };
  const rep = raw.repetition_check;
  delete out.repetition_check;
  if (str(rep)) out.repetition_check = { notes: str(rep) };
  else if (isRec(rep)) {
    const ids = arr(rep.compared_arc_ids).filter(
      (x): x is string => typeof x === 'string' && UUID.test(x),
    );
    out.repetition_check = {
      ...(ids.length ? { compared_arc_ids: ids } : {}),
      ...(typeof rep.similarity_score === 'number'
        ? { similarity_score: clamp01(rep.similarity_score, 0) }
        : {}),
      ...(str(rep.notes) ? { notes: str(rep.notes) } : {}),
    };
  }
  const cad = raw.cadence_check;
  delete out.cadence_check;
  const notes = (v: unknown) =>
    arr(v)
      .map(str)
      .filter((x): x is string => x !== undefined);
  if (str(cad) || Array.isArray(cad)) out.cadence_check = { notes: notes(cad) };
  else if (isRec(cad)) {
    const flags = [
      'cider_interval_ok',
      'progression_interval_ok',
      'frustration_streak_ok',
    ] as const;
    out.cadence_check = {
      ...Object.fromEntries(
        flags.filter((f) => typeof cad[f] === 'boolean').map((f) => [f, cad[f]]),
      ),
      ...(cad.notes !== undefined ? { notes: notes(cad.notes) } : {}),
    };
  }
  return out;
}

const ANNOTATION_KEYS = new Set([
  'utterance_start',
  'utterance_end',
  'speaker_id',
  'addressee_ids',
  'intentional_shift',
  'is_monologue',
]);

/**
 * The reviser's self-reported patch fields. The Korean targeted_reviser prompts show `regression: false`,
 * `changed_claims` as before/after objects and paragraph-keyed speaker notes, none of which is the patch
 * schema's shape. Claims become "before → after" strings; a boolean regression becomes `{ passed }` (the
 * workflow runs its own regression checks); speaker annotations are kept only when every item is
 * offset-anchored with no foreign keys (they are optional).
 */
export function normalizePatchOutput(raw: Rec): Rec {
  const out: Rec = { ...raw };
  const claims = arr(raw.changed_claims)
    .map((c) => {
      if (str(c)) return str(c);
      if (!isRec(c)) return undefined;
      const before = str(c.before);
      const after = str(c.after);
      return before && after ? `${before} → ${after}` : (after ?? before);
    })
    .filter((c): c is string => c !== undefined);
  out.changed_claims = claims;
  const reg = raw.regression;
  delete out.regression;
  if (typeof reg === 'boolean') out.regression = { passed: !reg };
  else if (isRec(reg))
    out.regression = {
      ...(Array.isArray(reg.checks_run)
        ? { checks_run: reg.checks_run.filter((x): x is string => typeof x === 'string') }
        : {}),
      ...(typeof reg.passed === 'boolean' ? { passed: reg.passed } : {}),
      ...(typeof reg.reverted === 'boolean' ? { reverted: reg.reverted } : {}),
      ...(str(reg.notes) ? { notes: str(reg.notes) } : {}),
    };
  const notes = arr(raw.speaker_annotations);
  const anchored = notes.every(
    (s) =>
      isRec(s) &&
      Number.isInteger(s.utterance_start) &&
      Number.isInteger(s.utterance_end) &&
      typeof s.speaker_id === 'string' &&
      UUID.test(s.speaker_id) &&
      Object.keys(s).every((k) => ANNOTATION_KEYS.has(k)),
  );
  if (!anchored || notes.length === 0) delete out.speaker_annotations;
  return out;
}
