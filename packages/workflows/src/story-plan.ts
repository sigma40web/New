/**
 * Story planning: the model-driven path from a user's intake to a COMPLETE Story Bible and series plan.
 *
 *   intake → Story Spec (requirement_interpreter) → concept candidates (concept_generator × N)
 *   → [operator approves one concept] → cast (character_designer) → world (world_builder)
 *   → progression system (power_system_designer) → Series Blueprint (story_architect)
 *   → assembled StoryBible (entities, propositions, promises, seed canon commits) → arc plans per season.
 *
 * Every step is a Postgres-checkpointed `runStep` under one planning job (`plan:<project>`), so a crash or
 * a provider outage resumes exactly where it stopped and never re-spends a completed call. The bible the
 * chapter loop consumes (`StoryBible`) is ASSEMBLED deterministically from the model outputs: ids are
 * derived from stable keys, every reference is checked against the registry, and anything a model
 * emitted that does not resolve is dropped with a recorded note rather than silently invented.
 *
 * The bible is PLANNED data (ADR-0038): entities and promises become registry rows, seed facts become the
 * `bible` canon commit inside `buildStoryBible` when chapter 1 runs. Nothing here writes realized canon.
 */
import {
  ensureJob,
  ensurePromptSet,
  getJobByWorkflowId,
  getArtifactById,
  getProject,
  updateJob,
  upsertPromptVersions,
  type JobRow,
  type Pool,
} from '@yeonjae/db';
import {
  canonicalPolicyHash,
  type Generated,
  requirePolicy,
  uuidFromKey,
  validatorFor,
  type PolicyRef,
} from '@yeonjae/domain';
import { composeIdentity, ProfileStore, type ComposedIdentity } from '@yeonjae/narrative';
import { PromptRegistry } from '@yeonjae/prompts';
import { type Gateway } from '@yeonjae/gateway';
import { resolveWorkflowPins } from './workflow-pins.js';
import { callInParts, type DesignPart } from './design-parts.js';
import {
  mergePacing,
  normalizePacingSeason,
  pacingArcId,
  pacingRulesFor,
  renderArcRhythm,
  rhythmSkeleton,
  type PacingMap,
  type SeasonWindow,
} from './pacing.js';
import { WorkflowError } from './errors.js';
import { assertDesignOutput } from './design-output.js';
import { composedRefFor, loadIntoStore } from './identity-from-intake.js';
import {
  compileFor,
  interpretRequirements,
  langOf,
  renderBibleDesign,
  renderPromiseLines,
  validateIntake,
  type ArcPlan,
  type StoryBible,
  type StoryIntake,
  type StorySpec,
} from './planning.js';
import {
  existingArtifact,
  modelCall,
  runStep,
  saveArtifact,
  type WorkflowContext,
  type WorkflowPins,
} from './runtime.js';

export type Concept = Generated.ConceptSchema.ConceptCandidate;
export type SeriesBlueprint = Generated.SeriesBlueprintSchema.SeriesBlueprint;

export interface StoryPlanDeps {
  readonly pool: Pool;
  readonly gateway: Gateway;
  readonly registry?: PromptRegistry | undefined;
  readonly profiles?: ProfileStore | undefined;
}

export function planWorkflowIdFor(projectId: string): string {
  return `plan:${projectId}`;
}

/** Stable ids for plan objects so a resumed run (or chapter k) addresses the same season/arc/contract. */
export const planIds = {
  season: (projectId: string, ordinal: number) => uuidFromKey(`${projectId}:season:${ordinal}`),
  arc: (projectId: string, seasonOrdinal: number, arcOrdinal: number) =>
    uuidFromKey(`${projectId}:season:${seasonOrdinal}:arc:${arcOrdinal}`),
  contract: (projectId: string, chapterNo: number) =>
    uuidFromKey(`${projectId}:contract:${chapterNo}`),
  entity: (projectId: string, kind: string, name: string) =>
    uuidFromKey(`${projectId}:entity:${kind}:${name.trim().toLowerCase()}`),
  promise: (projectId: string, statement: string) =>
    uuidFromKey(`${projectId}:promise:${statement.trim().toLowerCase()}`),
  concept: (projectId: string, specVersion: number, angle: string) =>
    uuidFromKey(`${projectId}:concept:${specVersion}:${angle.trim().toLowerCase()}`),
};

/**
 * Build the planning job context. Mirrors `makeContext` for chapters but keyed on the project, because the
 * bible is produced once per project (per spec version) and shared by every chapter.
 */
export async function makePlanContext(
  deps: StoryPlanDeps,
  projectId: string,
  cancellation?: WorkflowContext['cancellation'],
): Promise<{ ctx: WorkflowContext; mainTimelineId: string; identity: ComposedIdentity }> {
  const project = await getProject(deps.pool, projectId);
  const registry = deps.registry ?? PromptRegistry.fromDirectory();
  const policies = requirePolicy(project.production_policy_version as PolicyRef);
  const policyHash = canonicalPolicyHash(policies);
  const settings = project.settings;
  const identityRef =
    typeof settings.narrative_identity_ref === 'string'
      ? settings.narrative_identity_ref
      : undefined;
  const identityVersionId =
    typeof settings.narrative_identity_version_id === 'string'
      ? settings.narrative_identity_version_id
      : undefined;
  if (!identityRef || !identityVersionId)
    throw new WorkflowError(
      'IDENTITY_UNPINNED',
      `project ${projectId} pins no composed Narrative Identity`,
      { step: 'init', recommendedActions: ['edit_manually'] },
    );
  const store = deps.profiles ?? ProfileStore.fromDirectory();
  // A project-owned composed identity (derived from the intake) lives in identity_documents, not on disk.
  if (identityRef === composedRefFor(projectId)) await loadIntoStore(deps.pool, projectId, store);
  const main = await deps.pool.query<{ id: string }>(
    `SELECT id FROM timelines WHERE project_id = $1 AND kind = 'main' ORDER BY id LIMIT 1`,
    [projectId],
  );
  const mainTimelineId = main.rows[0]?.id;
  if (!mainTimelineId)
    throw new WorkflowError('INTERNAL', 'project has no main timeline', { step: 'init' });
  const workflowId = planWorkflowIdFor(projectId);
  const pinRequest = {
    workflowId,
    step: 'init',
    policyVersion: project.production_policy_version,
    policyHash,
    identityRef,
    identityVersionId,
    canonVersionRead: project.canon_version,
  };
  const existingJob = await getJobByWorkflowId(deps.pool, workflowId);
  let job: JobRow;
  let resolved: Awaited<ReturnType<typeof resolveWorkflowPins>>;
  let identity: ComposedIdentity | undefined;
  if (existingJob) {
    job = existingJob;
    resolved = await resolveWorkflowPins(deps.pool, registry, job, pinRequest);
  } else {
    // Validate identity before any prompt or job row is persisted for a new workflow.
    identity = composeIdentity(store, identityRef, identityVersionId);
    const activePromptSet = registry.activeSet();
    const pins: WorkflowPins = {
      promptSetId: activePromptSet.id,
      promptSet: activePromptSet.mapping,
      productionPolicyVersion: project.production_policy_version,
      productionPolicyHash: policyHash,
      narrativeIdentityVersionId: identityVersionId,
      narrativeIdentityRef: identityRef,
      canonVersionRead: project.canon_version,
    };
    await upsertPromptVersions(
      deps.pool,
      registry
        .list()
        .filter((v) => Object.values(activePromptSet.mapping).includes(v.id))
        .map((v) => ({
          id: v.id,
          family: v.family,
          version: v.version,
          content_hash: v.content_hash,
          role: v.role,
          style_sensitive: v.style_sensitive,
          manuscript_producing: v.manuscript_producing,
          identity_variant: v.identity_variant,
          model_class: v.model_class,
          output_schema: v.output_schema,
          status: v.status,
          meta: { purpose: v.purpose, params: v.params },
        })),
    );
    await ensurePromptSet(deps.pool, activePromptSet);
    const ensured = await ensureJob(deps.pool, {
      workspaceId: project.workspace_id,
      projectId,
      kind: 'story_plan',
      workflowId,
      idempotencyKey: workflowId,
      targetKind: 'project',
      targetId: projectId,
      canonVersionRead: project.canon_version,
      productionPolicyVersion: project.production_policy_version,
      promptSetId: activePromptSet.id,
      narrativeIdentityVersionId: identityVersionId,
      pins: {
        prompt_set_id: pins.promptSetId,
        prompt_set: pins.promptSet,
        production_policy_version: pins.productionPolicyVersion,
        production_policy_hash: pins.productionPolicyHash,
        narrative_identity_ref: pins.narrativeIdentityRef,
        narrative_identity_version_id: pins.narrativeIdentityVersionId,
        canon_version_read: pins.canonVersionRead,
      },
    });
    job = ensured.job;
    resolved = await resolveWorkflowPins(deps.pool, registry, job, pinRequest);
  }
  // Resolve persisted pins before loading the identity so changed project inputs fail as
  // STEP_NONDETERMINISTIC instead of as an incidental profile lookup error.
  const resolvedIdentity =
    identity ??
    composeIdentity(
      store,
      resolved.pins.narrativeIdentityRef,
      resolved.pins.narrativeIdentityVersionId,
    );
  const bindings: Record<string, string> = {
    ...(job.progress as { bindings?: Record<string, string> }).bindings,
    project: projectId,
    main_timeline: mainTimelineId,
  };
  const ctx: WorkflowContext = {
    pool: deps.pool,
    gateway: deps.gateway,
    registry,
    promptSet: resolved.promptSet,
    policy: policies,
    identity: resolvedIdentity,
    workspaceId: project.workspace_id,
    projectId,
    job,
    workflowId,
    pins: resolved.pins,
    trace: [],
    bindings,
    ...(cancellation ? { cancellation } : {}),
  };
  return { ctx, mainTimelineId, identity: resolvedIdentity };
}

// ---------------------------------------------------------------------------------------------------------
// Stage 1: spec + concept suggestions
// ---------------------------------------------------------------------------------------------------------

export interface ConceptRound {
  readonly specVersion: number;
  readonly specArtifactId: string;
  readonly concepts: readonly Concept[];
  readonly artifactId: string;
}

const ANGLES = [
  'the most faithful reading of the premise, maximizing the genre core fantasy',
  'a sharper hook: raise the stakes of chapter one and tighten the central mystery',
  'a character-forward angle: foreground relationships and register conflict without softening progression',
  'a subversive angle: keep every hard requirement but invert one reader expectation of the genre',
];

/**
 * Interpret the intake into a Story Spec and propose N distinct story concepts for the operator to choose
 * from. `count` defaults to the pinned policy's `candidates.concept_candidates`, floored at 2.
 */
export async function suggestConcepts(
  ctx: WorkflowContext,
  input: { intake: StoryIntake; specVersion?: number | undefined; count?: number | undefined },
): Promise<ConceptRound> {
  const specVersion = input.specVersion ?? 1;
  const spec = await interpretRequirements(ctx, input.intake, specVersion);
  const count = Math.max(
    2,
    Math.min(ANGLES.length, input.count ?? ctx.policy.candidates.concept_candidates),
  );
  const block = compileFor(ctx, 'planner_compact');
  const concepts: Concept[] = [];
  for (let i = 0; i < count; i++) {
    const angle = ANGLES[i] ?? `alternative angle ${i + 1}`;
    const result = await runStep(
      ctx,
      'concept',
      async () => {
        const call = await modelCall<Partial<Concept>>(ctx, {
          step: 'concept',
          family: 'concept_generator',
          activityId: `concept:v${specVersion}:${i + 1}`,
          variables: {
            story_spec: renderSpec(spec.spec, langOf(ctx)),
            angle_seed: angle,
            spec_version: String(specVersion),
          },
          block,
        });
        const candidate: Concept = {
          ...(call.output as Concept),
          id: planIds.concept(ctx.projectId, specVersion, `${i + 1}`),
          project_id: ctx.projectId,
          spec_version: specVersion,
          angle:
            typeof call.output.angle === 'string' && call.output.angle ? call.output.angle : angle,
          status: 'candidate',
          generator_call_id: call.llmCallId,
        };
        const v = validatorFor<Concept>('concept.schema.json')(candidate);
        if (!v.ok)
          throw new WorkflowError(
            'SPEC_INVALID',
            `concept ${i + 1} does not validate: ${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
            { step: 'concept', recommendedActions: ['regenerate'] },
          );
        const ref = await saveArtifact(ctx, {
          step: 'concept',
          kind: 'concept',
          key: `v${specVersion}:${i + 1}`,
          schema: 'concept.schema.json',
          payload: v.value,
        });
        return { concept: v.value, artifactId: ref.artifact_id };
      },
      `v${specVersion}:${i + 1}`,
    );
    concepts.push(result.concept);
  }
  const round = await saveArtifact(ctx, {
    step: 'concept',
    kind: 'concept_round',
    key: `v${specVersion}`,
    payload: { spec_version: specVersion, concept_ids: concepts.map((c) => c.id) },
  });
  await updateJob(ctx.pool, ctx.job.id, {
    status: 'waiting_review',
    currentStep: 'concept_review',
    progress: { stage: 'concepts_ready', spec_version: specVersion },
  });
  return { specVersion, specArtifactId: spec.artifactId, concepts, artifactId: round.artifact_id };
}

// ---------------------------------------------------------------------------------------------------------
// Stage 2: full bible from the approved concept
// ---------------------------------------------------------------------------------------------------------

interface CastOutput extends Record<string, unknown> {
  characters?: {
    display_name?: string;
    role?: string;
    age_at_start?: number | string;
    background?: string;
    goals?: string[] | string;
    flaws?: string[] | string;
    secrets?: (
      string | { statement?: string; known_by?: string[]; reveal_not_before_chapter?: number }
    )[];
    arc?:
      | string
      | {
          start_state?: string;
          end_state?: string;
          turning_points?: { description?: string; chapter_from?: number; chapter_to?: number }[];
        };
    voice_notes?: string[] | string;
    short_forms?: string[];
    aliases?: string[];
    rank?: string;
    registers?: {
      toward?: string;
      type?: string;
      formality?: number;
      deference?: number;
      familiarity?: number;
      directness?: number;
      contractions?: string;
      address_terms?: string[];
    }[];
  }[];
  propositions?: { statement?: string; kind?: string; secret?: unknown; entity_names?: string[] }[];
}

interface WorldOutput extends Record<string, unknown> {
  world_rules?: { attribute?: string; statement?: string; value?: unknown; locked?: boolean }[];
  locations?: { display_name?: string; description?: string; aliases?: string[] }[];
  organizations?: { display_name?: string; description?: string; short_forms?: string[] }[];
  terminology?: { term?: string; decision?: string; english?: string }[];
}

interface PowerOutput extends Record<string, unknown> {
  system_rules?: { attribute?: string; statement?: string; locked?: boolean }[];
  ranks?: { name?: string; description?: string }[];
  abilities?: { display_name?: string; description?: string; owner?: string }[];
  milestones?: { description?: string; chapter_from?: number; chapter_to?: number }[];
}

export interface StoryPlanResult {
  readonly specVersion: number;
  readonly concept: Concept;
  readonly bible: StoryBible;
  readonly bibleArtifactId: string;
  readonly blueprint: SeriesBlueprint;
  readonly blueprintArtifactId: string;
  readonly cast: number;
  readonly locations: number;
  readonly organizations: number;
  readonly propositions: number;
  readonly promises: number;
  readonly seasons: number;
  readonly notes: readonly string[];
}

const ENTITY_TYPES = new Set([
  'character',
  'location',
  'organization',
  'item',
  'ability',
  'term',
  'event_anchor',
  'timeline',
]);
const PROP_KINDS = new Set([
  'identity',
  'event',
  'location',
  'ability',
  'intent',
  'relationship',
  'world_rule',
  'secret',
  'other',
]);
const REL_TYPES = new Set([
  'stranger',
  'acquaintance',
  'colleague',
  'friend',
  'mentor',
  'disciple',
  'rival',
  'enemy',
  'ally',
  'family',
  'romantic_interest',
  'lover',
  'spouse',
  'superior',
  'subordinate',
  'other',
]);

/**
 * Generate the complete bible for the approved concept. Idempotent: every model call is checkpointed and
 * the assembled bible is a content-addressed artifact keyed by spec version + concept id.
 */
export async function buildFullBible(
  ctx: WorkflowContext,
  input: { intake: StoryIntake; spec: StorySpec; concept: Concept; mainTimelineId: string },
): Promise<StoryPlanResult> {
  const { spec, concept, intake } = input;
  const block = compileFor(ctx, 'planner_compact');
  const lang = langOf(ctx);
  const specText = renderSpec(spec, lang);
  const conceptText = JSON.stringify(concept, null, 1);
  const notes: string[] = [];

  const castBrief =
    lang === 'ko'
      ? [
          intake.main_character
            ? `주인공: ${sketch(intake.main_character, lang)}`
            : '주인공: 전제와 콘셉트에서 도출한다.',
          ...(intake.supporting_characters ?? []).map((c) => `조연: ${sketch(c, lang)}`),
          '인물 6~12명을 설계한다: 주인공, 적대자, 동료·스승 2~4명, 로맨스가 있으면 연애 상대(하렘이면 히로인마다 등장 시기와 관계 단계가 다르게), 대비 인물 하나 이상. 모든 인물은 주요 상대마다 말높이(registers)를 가진다. 위에 이름이 주어진 인물은 그 이름 그대로 포함한다.',
        ].join('\n')
      : [
          intake.main_character
            ? `Main character: ${sketch(intake.main_character)}`
            : 'Main character: derive from the premise and concept.',
          ...(intake.supporting_characters ?? []).map((c) => `Supporting: ${sketch(c)}`),
          `Design 6–12 characters: protagonist, antagonist(s), 2–4 allies/mentors, love interest if romance is present, at least one foil. Every character needs registers toward each key counterpart.`,
        ].join('\n');

  // Part-scoped cast (ADR-0057): one named character per call, then the two the story still needs.
  const named = [intake.main_character, ...(intake.supporting_characters ?? [])]
    .filter(isDefined)
    .map((c) => c.name);
  const confirmed = (soFar: Record<string, unknown>) => {
    const list = Array.isArray(soFar.characters)
      ? (soFar.characters as Record<string, unknown>[])
      : [];
    return list.length
      ? list.map((c) => `${txt(c.display_name, '?')}(${txt(c.role, '?')})`).join(', ')
      : '(없음)';
  };
  const castParts: DesignPart[] = [];
  for (let i = 0; i < named.length; i++) {
    const group = named.slice(i, i + 1);
    castParts.push({
      key: `named-${i + 1}`,
      instruction: (soFar) =>
        `이번 호출에서는 다음 인물만 완전히 설계한다: ${group.join(', ')}. 이 인물들에 관한 비밀·명제만 propositions에 넣는다. 이미 확정된 인물: ${confirmed(soFar)}.`,
    });
  }
  for (const [key, who] of [
    ['rest-antagonist', '적대 세력 쪽 핵심 인물 1명'],
    ['rest-ally', '조력자·스승 또는 대비 인물 1명'],
  ] as const)
    castParts.push({
      key,
      instruction: (soFar) =>
        `이번 호출에서는 캐스트 브리프에 이름이 없지만 이야기에 꼭 필요한 새 인물 중 ${who}만 설계한다. 이미 확정된 인물: ${confirmed(soFar)}. 이미 확정된 인물은 다시 쓰지 않는다.`,
    });
  const cast = await runDesignStep(ctx, 'cast', `cast:${concept.id}`, async (activityId) => {
    const call = {
      output: await callInParts<CastOutput>(ctx, {
        step: 'cast',
        family: 'character_designer',
        activityId,
        variables: { story_spec: specText, concept: conceptText, cast_brief: castBrief },
        block,
        parts: castParts,
      }),
    };
    assertDesignOutput('cast', call.output);
    if (!Array.isArray(call.output.characters) || call.output.characters.length === 0)
      throw new WorkflowError('SPEC_INVALID', 'character_designer returned no characters', {
        step: 'cast',
        recommendedActions: ['regenerate'],
      });
    const names = new Set(
      call.output.characters.map((c) => fieldText(c, 'display_name')?.toLowerCase()),
    );
    const requiredNames = [intake.main_character, ...(intake.supporting_characters ?? [])]
      .filter(isDefined)
      .map((c) => c.name.trim().toLowerCase());
    if (names.has(undefined) || requiredNames.some((name) => !names.has(name)))
      incompletePlan(
        'cast',
        'Every character needs a name, and supplied characters must be retained.',
      );
    const ref = await saveArtifact(ctx, {
      step: 'cast',
      kind: 'cast',
      key: concept.id,
      payload: call.output,
    });
    return { output: call.output, artifactId: ref.artifact_id };
  });

  const listed = (soFar: Record<string, unknown>, key: string, field: string) => {
    const list = Array.isArray(soFar[key]) ? (soFar[key] as Record<string, unknown>[]) : [];
    return (
      list
        .map((x) => txt(x[field]))
        .filter(Boolean)
        .join('; ') || '(없음)'
    );
  };
  const world = await runDesignStep(ctx, 'world', `world:${concept.id}`, async (activityId) => {
    const call = {
      output: await callInParts<WorldOutput>(ctx, {
        step: 'world',
        family: 'world_builder',
        activityId,
        variables: { story_spec: specText, concept: conceptText },
        block,
        parts: [
          {
            key: 'rules',
            instruction: () =>
              '이번 호출에서는 world_rules만 설계한다(8~14개). locations, organizations, terminology는 빈 배열로 둔다.',
          },
          {
            key: 'organizations',
            instruction: (soFar) =>
              `이번 호출에서는 organizations만 설계한다. 다른 배열은 빈 배열로 둔다. 이미 확정된 세계 규칙: ${listed(soFar, 'world_rules', 'statement')}.`,
          },
          {
            key: 'places',
            instruction: (soFar) =>
              `이번 호출에서는 locations와 terminology만 설계한다. world_rules와 organizations는 빈 배열로 둔다. 이미 확정된 조직: ${listed(soFar, 'organizations', 'display_name')}.`,
          },
        ],
      }),
    };
    assertDesignOutput('world', call.output);
    if (
      !Array.isArray(call.output.world_rules) ||
      !call.output.world_rules.length ||
      !Array.isArray(call.output.locations) ||
      !call.output.locations.length
    )
      incompletePlan(
        'world',
        'World rules and named locations are required before chapter production.',
      );
    if (
      call.output.world_rules.some((r) => !fieldText(r, 'statement')) ||
      call.output.locations.some((l) => !fieldText(l, 'display_name'))
    )
      incompletePlan('world', 'World rules and locations must contain authored content.');
    const ref = await saveArtifact(ctx, {
      step: 'world',
      kind: 'world',
      key: concept.id,
      payload: call.output,
    });
    return { output: call.output, artifactId: ref.artifact_id };
  });

  const power = await runDesignStep(
    ctx,
    'power_system',
    `power:${concept.id}`,
    async (activityId) => {
      const call = {
        output: await callInParts<PowerOutput>(ctx, {
          step: 'power_system',
          family: 'power_system_designer',
          activityId,
          variables: {
            story_spec: specText,
            concept: conceptText,
            world_rules: JSON.stringify(world.output.world_rules ?? [], null, 1),
          },
          block,
          parts: [
            {
              key: 'rules',
              instruction: () =>
                '이번 호출에서는 system_rules와 ranks만 설계한다. abilities와 milestones는 빈 배열로 둔다.',
            },
            {
              key: 'abilities',
              instruction: (soFar) =>
                `이번 호출에서는 abilities만 설계한다. 다른 배열은 빈 배열로 둔다. 이미 확정된 등급: ${listed(soFar, 'ranks', 'name')}.`,
            },
            {
              key: 'milestones',
              instruction: (soFar) =>
                `이번 호출에서는 milestones만 설계한다. 다른 배열은 빈 배열로 둔다. 전체 ${intake.target_chapters}화에 고르게 퍼뜨린다. 이미 확정된 등급: ${listed(soFar, 'ranks', 'name')}.`,
            },
          ],
        }),
      };
      assertDesignOutput('power_system', call.output);
      if (
        !Array.isArray(call.output.system_rules) ||
        !call.output.system_rules.length ||
        call.output.system_rules.some((r) => !fieldText(r, 'statement'))
      )
        incompletePlan(
          'power_system',
          'Progression rules must be authored before chapter production.',
        );
      const ref = await saveArtifact(ctx, {
        step: 'power_system',
        kind: 'power_system',
        key: concept.id,
        payload: call.output,
      });
      return { output: call.output, artifactId: ref.artifact_id };
    },
  );

  // ---- deterministic assembly of the registry ------------------------------------------------------
  const entities: StoryBible['entities'][number][] = [];
  const byName = new Map<string, string>();
  const addEntity = (
    type: string,
    name: string | undefined,
    extra: {
      description?: string;
      short_forms?: string[];
      aliases?: string[];
      design?: Record<string, unknown>;
    } = {},
  ): string | undefined => {
    const display = (name ?? '').trim();
    if (!display) return undefined;
    const key = display.toLowerCase();
    const existing = byName.get(key);
    if (existing) return existing;
    const id = planIds.entity(ctx.projectId, ENTITY_TYPES.has(type) ? type : 'term', display);
    entities.push({
      id,
      type: ENTITY_TYPES.has(type) ? type : 'term',
      display_name: display,
      ...(extra.short_forms?.length ? { short_forms: dedupe(extra.short_forms) } : {}),
      ...(extra.aliases?.length ? { aliases: dedupe(extra.aliases) } : {}),
      ...(extra.description ? { description: extra.description } : {}),
      ...(extra.design ? { design: extra.design } : {}),
    });
    byName.set(key, id);
    for (const alias of [...(extra.short_forms ?? []), ...(extra.aliases ?? [])])
      if (alias.trim() && !byName.has(alias.trim().toLowerCase()))
        byName.set(alias.trim().toLowerCase(), id);
    return id;
  };
  const resolve = (name: string | undefined): string | undefined =>
    name ? byName.get(name.trim().toLowerCase()) : undefined;

  const characters = cast.output.characters ?? [];
  for (const c of characters) {
    addEntity('character', c.display_name, {
      design: c,
      description: [
        c.age_at_start !== undefined ? `${String(c.age_at_start)}.` : '',
        c.role ? `${c.role}.` : '',
        c.background ?? '',
      ]
        .filter(Boolean)
        .join(' ')
        .slice(0, 600),
      short_forms: c.short_forms ?? [],
      aliases: c.aliases ?? [],
    });
  }
  for (const l of world.output.locations ?? [])
    addEntity('location', l.display_name, {
      design: l,
      ...(l.description ? { description: l.description.slice(0, 400) } : {}),
      aliases: l.aliases ?? [],
    });
  for (const o of world.output.organizations ?? [])
    addEntity('organization', o.display_name, {
      design: o,
      ...(o.description ? { description: o.description.slice(0, 400) } : {}),
      short_forms: o.short_forms ?? [],
    });
  for (const a of power.output.abilities ?? [])
    addEntity('ability', a.display_name, {
      design: a,
      ...(a.description ? { description: a.description.slice(0, 400) } : {}),
    });
  const worldTermId = addEntity('term', 'World rules', {
    description: 'Locked world and progression rules of the setting.',
  });
  if (entities.length === 0)
    throw new WorkflowError('SPEC_INVALID', 'the bible has no entities after assembly', {
      step: 'bible_assembly',
      recommendedActions: ['regenerate'],
    });

  // ---- propositions (secrets + designer propositions) -----------------------------------------------
  const propositions: StoryBible['propositions'][number][] = [];
  const propKeys = new Set<string>();
  const addProposition = (
    statement: string | undefined,
    kind: string | undefined,
    entityIds: string[],
    secret?: {
      owner_ids: string[];
      allowed_knower_ids: string[];
      reveal_not_before_chapter?: number;
    },
  ): string | undefined => {
    const text = (statement ?? '').trim();
    if (!text) return undefined;
    const key = text.toLowerCase();
    if (propKeys.has(key)) return undefined;
    propKeys.add(key);
    const localId = `P${propositions.length + 1}`;
    propositions.push({
      local_id: localId,
      statement: text,
      kind: kind && PROP_KINDS.has(kind) ? kind : secret ? 'secret' : 'other',
      entity_ids: dedupe(entityIds),
      ...(secret ? { secret } : {}),
      truth: 'true',
    });
    return localId;
  };
  const secretHolders: { knowerId: string; localId: string }[] = [];
  for (const c of characters) {
    const ownerId = resolve(c.display_name);
    if (!ownerId) continue;
    for (const s of c.secrets ?? []) {
      const statement = typeof s === 'string' ? s : s.statement;
      const knownBy = typeof s === 'string' ? [] : (s.known_by ?? []);
      const knowers = dedupe([ownerId, ...knownBy.map(resolve).filter(isString)]);
      const notBefore = typeof s === 'string' ? undefined : s.reveal_not_before_chapter;
      const localId = addProposition(statement, 'secret', [ownerId], {
        owner_ids: [ownerId],
        allowed_knower_ids: knowers,
        ...(notBefore !== undefined && notBefore >= 1
          ? { reveal_not_before_chapter: notBefore }
          : {}),
      });
      if (localId) for (const k of knowers) secretHolders.push({ knowerId: k, localId });
    }
  }
  for (const p of cast.output.propositions ?? []) {
    const ids = (p.entity_names ?? []).map(resolve).filter(isString);
    addProposition(p.statement, p.kind, ids);
  }

  // ---- seed canon commit: world rules, ranks, registers, secret knowledge --------------------------
  const seedFacts: Record<string, unknown>[] = [];
  const clock0 = { chapter_no: 0, ordinal: 0, precision: 'exact' };
  const fact = (
    localId: string,
    entityId: string,
    attribute: string,
    value: unknown,
    valueText: string,
    importance: 'core' | 'major' | 'minor',
    locked = false,
  ): Record<string, unknown> => ({
    local_id: localId,
    type: 'fact',
    op: 'assert',
    frame: 'canonical',
    confidence: 1,
    importance,
    evidence: [],
    payload: {
      entity_id: entityId,
      attribute,
      value,
      value_text: valueText.slice(0, 500),
      valid_from: clock0,
      valid_to: null,
      ...(locked ? { locked: true } : {}),
    },
  });
  let n = 0;
  const rules = [
    ...(world.output.world_rules ?? []).map((r) => ({ ...r, prefix: 'world.rule' })),
    ...(power.output.system_rules ?? []).map((r) => ({ ...r, prefix: 'power.rule' })),
  ];
  if (worldTermId)
    for (const r of rules) {
      const statement = (r.statement ?? '').trim();
      if (!statement) continue;
      n++;
      const attr = `${r.prefix}.${slug(r.attribute ?? statement.split(/\s+/).slice(0, 4).join('_'))}_${slug(String(n))}`;
      seedFacts.push(
        fact(
          `rule-${n}`,
          worldTermId,
          attr,
          statement.slice(0, 120),
          statement,
          'core',
          r.locked ?? true,
        ),
      );
    }
  for (const c of characters) {
    const id = resolve(c.display_name);
    if (!id) continue;
    if (c.rank) {
      n++;
      seedFacts.push(
        fact(
          `rank-${n}`,
          id,
          'power.rank',
          c.rank,
          `${c.display_name ?? ''} is ${c.rank}`,
          'major',
        ),
      );
    }
    if (c.role) {
      n++;
      seedFacts.push(
        fact(
          `role-${n}`,
          id,
          'identity.role',
          c.role,
          `${c.display_name ?? ''}: ${c.role}`,
          'minor',
        ),
      );
    }
  }
  const relations: Record<string, unknown>[] = [];
  for (const c of characters) {
    const from = resolve(c.display_name);
    if (!from) continue;
    for (const r of c.registers ?? []) {
      const to = resolve(r.toward);
      if (!to || to === from) continue;
      n++;
      const level = (v: number | undefined) =>
        typeof v === 'number' ? Math.max(0, Math.min(5, Math.round(v))) : undefined;
      relations.push({
        local_id: `rel-${n}`,
        type: 'relationship_state',
        op: 'assert',
        frame: 'canonical',
        confidence: 1,
        importance: 'major',
        evidence: [],
        payload: {
          from_entity_id: from,
          to_entity_id: to,
          type: r.type && REL_TYPES.has(r.type) ? r.type : 'acquaintance',
          register: {
            ...(level(r.formality) !== undefined ? { formality: level(r.formality) } : {}),
            ...(level(r.deference) !== undefined ? { deference: level(r.deference) } : {}),
            ...(level(r.familiarity) !== undefined ? { familiarity: level(r.familiarity) } : {}),
            ...(level(r.directness) !== undefined ? { directness: level(r.directness) } : {}),
            ...(r.contractions && ['avoid', 'neutral', 'free'].includes(r.contractions)
              ? { contractions: r.contractions }
              : {}),
            ...(r.address_terms?.length ? { address_terms: dedupe(r.address_terms) } : {}),
          },
          valid_from: clock0,
          valid_to: null,
        },
      });
    }
  }
  const knowledge: Record<string, unknown>[] = secretHolders.map((s, i) => ({
    local_id: `k-${i + 1}`,
    type: 'knowledge_state',
    op: 'assert',
    frame: 'canonical',
    confidence: 1,
    importance: 'core',
    evidence: [],
    payload: {
      knower: { kind: 'character', entity_id: s.knowerId },
      proposition_id: `{{proposition.${s.localId}}}`,
      stance: 'knows',
      source: { kind: 'remembered', chapter_id: '{{chapter.1}}' },
      valid_from: clock0,
      valid_to: null,
    },
  }));

  // ---- Series Blueprint (seasons, arcs, endgame, promises) -----------------------------------------
  const draftBible: StoryBible = {
    version: spec.version,
    design: { characters: cast.output, world: world.output, progression: power.output },
    entities,
    propositions,
    promises: [],
    commits: [[...seedFacts, ...relations], knowledge].filter((c) => c.length > 0),
  };
  const blueprintStep = await runDesignStep(
    ctx,
    'blueprint',
    `blueprint:${concept.id}`,
    async (activityId) => {
      const seasonsOf = (soFar: Record<string, unknown>) => {
        const list = Array.isArray(soFar.seasons)
          ? (soFar.seasons as Record<string, unknown>[])
          : [];
        return (
          list
            .map((x) => {
              const w = x.chapter_range_est as { from?: unknown; to?: unknown } | undefined;
              return `${txt(x.title, '?')} (${txt(w?.from, '?')}~${txt(w?.to, '?')}화): ${txt(x.objective)}`;
            })
            .join(' / ') || '(없음)'
        );
      };
      const call = {
        output: await callInParts<Partial<SeriesBlueprint> & { promises?: RawPromise[] }>(ctx, {
          step: 'blueprint',
          family: 'story_architect',
          activityId,
          variables: {
            story_spec: specText,
            concept: conceptText,
            bible_summary: renderBibleSummary(draftBible, lang),
            target_chapters: String(intake.target_chapters),
          },
          block,
          parts: [
            {
              key: 'core',
              instruction: () =>
                'story_promise, reader_fantasy, main_conflict, protagonist_arc, ending, endgame_requirements만 작성한다. seasons, character_arcs, promises는 빈 배열로 두고 progression_arc는 생략한다.',
            },
            {
              key: 'seasons',
              instruction: () =>
                'seasons와 progression_arc만 작성한다. 다른 배열은 빈 배열로 둔다. 시즌은 목표 회차 수 전체를 빈틈없이 덮는다.',
            },
            {
              key: 'character-arcs-heroines',
              instruction: (soFar) =>
                `character_arcs만 작성한다: 히로인과 연애 상대 전원. 다른 배열은 빈 배열로 둔다. 이미 확정된 시즌: ${seasonsOf(soFar)}.`,
            },
            {
              key: 'character-arcs-others',
              instruction: (soFar) =>
                `character_arcs만 작성한다: 히로인이 아닌 주요 인물 3~4명(적대자, 원작 주인공, 조력자). 다른 배열은 빈 배열로 둔다. 이미 확정된 시즌: ${seasonsOf(soFar)}.`,
            },
            {
              key: 'promises-early',
              instruction: (soFar) =>
                `promises만 작성한다: 앞쪽 두 시즌에 심는 떡밥·미스터리·관계 비트 8~14개. 다른 배열은 빈 배열로 둔다. 이미 확정된 시즌: ${seasonsOf(soFar)}.`,
            },
            {
              key: 'promises-late',
              instruction: (soFar) =>
                `promises만 작성한다: 뒤쪽 시즌에 심거나 크게 회수되는 떡밥·미스터리·관계 비트 8~14개. 앞서 확정된 약속과 겹치지 않게 한다. 다른 배열은 빈 배열로 둔다. 이미 확정된 시즌: ${seasonsOf(soFar)}.`,
            },
          ],
        }),
      };
      const raw = call.output;
      if (
        !str(raw.ending?.summary) ||
        !Array.isArray(raw.ending?.final_state_assertions) ||
        !raw.ending.final_state_assertions.length ||
        raw.ending.final_state_assertions.some((s) => !str(s))
      )
        incompletePlan(
          'blueprint',
          'The ending needs a summary and concrete final-state assertions.',
        );
      if (
        !Array.isArray(raw.endgame_requirements) ||
        !raw.endgame_requirements.length ||
        raw.endgame_requirements.some((r) => !fieldText(r, 'statement'))
      )
        incompletePlan('blueprint', 'The complete series needs authored endgame requirements.');
      const protagonistId =
        resolve(intake.main_character?.name) ??
        resolve(characters[0]?.display_name) ??
        entities[0]?.id;
      const seasons = normalizeSeasons(raw.seasons, intake.target_chapters, ctx.projectId);
      const promises = normalizePromises(
        raw.promises,
        ctx.projectId,
        resolve,
        intake.target_chapters,
      );
      const candidate: SeriesBlueprint = {
        project_id: ctx.projectId,
        version: spec.version,
        pinned: { spec_version: spec.version, bible_version: spec.version },
        story_promise: str(raw.story_promise) ?? concept.story_promise,
        reader_fantasy: str(raw.reader_fantasy) ?? concept.reader_fantasy,
        main_conflict: str(raw.main_conflict) ?? concept.main_conflict,
        ...(Array.isArray(raw.themes) ? { themes: raw.themes.filter(isString) } : {}),
        protagonist_arc: normalizeArc(
          raw.protagonist_arc,
          protagonistId ?? '',
          intake.target_chapters,
        ),
        ...(raw.character_arcs !== undefined
          ? {
              character_arcs: (assertRecordItems(raw.character_arcs, 'character_arcs') ?? [])
                .map((a) => {
                  const id =
                    isUuidLike(a.entity_id) && entities.some((e) => e.id === a.entity_id)
                      ? a.entity_id
                      : resolve(str(a.entity_name) ?? str(a.entity_id));
                  return id ? normalizeArc(a, id, intake.target_chapters) : undefined;
                })
                .filter(isDefined),
            }
          : {}),
        ...(raw.progression_arc
          ? {
              progression_arc: {
                ...(str(raw.progression_arc.system_summary)
                  ? { system_summary: str(raw.progression_arc.system_summary) }
                  : {}),
                ...(raw.progression_arc.milestones !== undefined
                  ? {
                      milestones: (
                        assertRecordItems(
                          raw.progression_arc.milestones,
                          'progression_arc.milestones',
                        ) ?? []
                      )
                        .map((m) => normalizeMilestone(m, intake.target_chapters))
                        .filter(isDefined),
                    }
                  : {}),
                ...(typeof raw.progression_arc.cadence_chapters === 'number' &&
                raw.progression_arc.cadence_chapters >= 1
                  ? { cadence_chapters: Math.round(raw.progression_arc.cadence_chapters) }
                  : {}),
              },
            }
          : {}),
        ending: {
          type: endingType(raw.ending.type, intake.ending_preference),
          ...(str(raw.ending.summary) ? { summary: str(raw.ending.summary) } : {}),
          final_state_assertions:
            Array.isArray(raw.ending.final_state_assertions) &&
            raw.ending.final_state_assertions.filter(isString).length > 0
              ? raw.ending.final_state_assertions.filter(isString)
              : [concept.ending_direction],
        },
        endgame_requirements: (
          assertRecordItems(raw.endgame_requirements, 'endgame_requirements') ?? []
        )
          .map((r, i) => ({
            id: str(r.id) ?? `EG-${i + 1}`,
            statement: str(r.statement) ?? '',
            kind:
              typeof r.kind === 'string' &&
              ['fact', 'knowledge', 'relationship', 'promise_paid', 'progression'].includes(r.kind)
                ? r.kind
                : 'fact',
          }))
          .filter((r) => r.statement.length > 0),
        seasons,
        foreshadowing_register: promises.map((p) => p.id),
      } as SeriesBlueprint;
      const v = validatorFor<SeriesBlueprint>('series-blueprint.schema.json')(candidate);
      if (!v.ok)
        throw new WorkflowError(
          'ARC_PLAN_INVALID',
          `series blueprint does not validate: ${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
          { step: 'blueprint', recommendedActions: ['regenerate'] },
        );
      const ref = await saveArtifact(ctx, {
        step: 'blueprint',
        kind: 'series_blueprint',
        key: `v${spec.version}`,
        schema: 'series-blueprint.schema.json',
        payload: v.value,
      });
      return { blueprint: v.value, promises, artifactId: ref.artifact_id };
    },
  );

  const bible: StoryBible = { ...draftBible, promises: blueprintStep.promises };

  // ---- Pacing map (ADR-0056): every chapter gets a rhythm slot, season by season -------------------
  // A job pinned to a prompt set without pacing_designer (ADR-0053) keeps the season-level arcs.
  let blueprint = blueprintStep.blueprint;
  let blueprintArtifactId = blueprintStep.artifactId;
  if (ctx.promptSet.mapping.pacing_designer) {
    const parts: PacingMap[] = [];
    for (const season of blueprint.seasons) {
      const window: SeasonWindow = {
        ordinal: season.ordinal,
        title: season.title,
        from: season.chapter_range_est.from,
        to: season.chapter_range_est.to,
      };
      const arcOffset = parts.reduce((a, p) => a + p.arcs.length, 0);
      const part = await runDesignStep(
        ctx,
        `pacing:s${season.ordinal}`,
        `pacing:${concept.id}:s${season.ordinal}`,
        async (activityId) => {
          const windows: DesignPart[] = [
            {
              key: 'arcs',
              instruction: () =>
                '이번 호출에서는 이 시즌의 arcs만 설계한다. chapters는 빈 배열로 둔다.',
            },
          ];
          for (let from = window.from; from <= window.to; from += 15) {
            const to = Math.min(window.to, from + 14);
            windows.push({
              key: `ch${from}-${to}`,
              instruction: (soFar) => {
                const arcs = Array.isArray(soFar.arcs)
                  ? (soFar.arcs as Record<string, unknown>[])
                  : [];
                const slots = Array.isArray(soFar.chapters)
                  ? (soFar.chapters as Record<string, unknown>[])
                  : [];
                const recent = slots
                  .slice(-3)
                  .map((c) => `${txt(c.chapter_no)}화 ${txt(c.role)}: ${txt(c.beat)}`)
                  .join(' / ');
                const arcList = arcs
                  .map(
                    (a) =>
                      `${txt(a.title)}(${txt(a.from)}~${txt(a.to)}화, 클라이맥스 ${txt(a.climax_chapter)}화)`,
                  )
                  .join(', ');
                return `이번 호출에서는 ${from}~${to}화의 chapters만 작성한다. arcs는 빈 배열로 둔다. 확정된 아크: ${arcList || '(없음)'}. 직전 회차: ${recent || '(없음)'}.`;
              },
            });
          }
          const output = await callInParts<Record<string, unknown>>(ctx, {
            step: `pacing:s${season.ordinal}`,
            family: 'pacing_designer',
            activityId,
            parts: windows,
            variables: {
              story_spec: specText,
              blueprint: renderBlueprint(blueprint, lang),
              season: `시즌 ${season.ordinal} 「${season.title}」 (${window.from}~${window.to}화): ${season.objective}${season.thesis ? ` / 핵심 갈등: ${season.thesis}` : ''}${season.entry_state ? ` / 진입: ${season.entry_state}` : ''}${season.exit_state ? ` / 이탈: ${season.exit_state}` : ''}`,
              skeleton: rhythmSkeleton(
                window,
                intake.target_chapters,
                pacingRulesFor(intake.target_chapters),
              ),
              bible_summary: renderBibleSummary(bible, lang),
              target_chapters: String(intake.target_chapters),
            },
            block,
          });
          const map = normalizePacingSeason(
            output,
            window,
            arcOffset,
            pacingRulesFor(intake.target_chapters),
          );
          await saveArtifact(ctx, {
            step: `pacing:s${season.ordinal}`,
            kind: 'pacing_season',
            key: `v${spec.version}:s${season.ordinal}`,
            payload: map,
          });
          return map;
        },
      );
      parts.push(part);
    }
    const paced = { ...blueprint, pacing: mergePacing(parts) } as SeriesBlueprint;
    const pacedRef = await runStep(ctx, 'pacing_assembly', async () => {
      const v = validatorFor<SeriesBlueprint>('series-blueprint.schema.json')(paced);
      if (!v.ok)
        throw new WorkflowError(
          'ARC_PLAN_INVALID',
          `paced blueprint does not validate: ${v.errors.map((e) => `${e.path} ${e.message}`).join('; ')}`,
          { step: 'pacing_assembly', recommendedActions: ['regenerate'] },
        );
      const ref = await saveArtifact(ctx, {
        step: 'pacing_assembly',
        kind: 'series_blueprint',
        key: `v${spec.version}:paced`,
        schema: 'series-blueprint.schema.json',
        payload: v.value,
      });
      return { artifactId: ref.artifact_id, blueprint: v.value };
    });
    blueprint = pacedRef.blueprint;
    blueprintArtifactId = pacedRef.artifactId;
  }

  const bibleRef = await runStep(ctx, 'bible_assembly', async () => {
    const ref = await saveArtifact(ctx, {
      step: 'bible_assembly',
      kind: 'full_bible',
      key: `v${spec.version}:${concept.id}`,
      payload: bible,
    });
    return { artifactId: ref.artifact_id };
  });
  if (blueprintStep.promises.length === 0)
    notes.push('the architect proposed no promises; arcs open their own');

  return {
    specVersion: spec.version,
    concept,
    bible,
    bibleArtifactId: bibleRef.artifactId,
    blueprint,
    blueprintArtifactId,
    cast: entities.filter((e) => e.type === 'character').length,
    locations: entities.filter((e) => e.type === 'location').length,
    organizations: entities.filter((e) => e.type === 'organization').length,
    propositions: propositions.length,
    promises: blueprintStep.promises.length,
    seasons: blueprintStep.blueprint.seasons.length,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Stage 3: arc plans per season (rolling horizon, ADR-0012)
// ---------------------------------------------------------------------------------------------------------

export interface ArcSchedule {
  readonly arcs: readonly {
    id: string;
    seasonId: string;
    seasonOrdinal: number;
    from: number;
    to: number;
    ordinal: number;
  }[];
}

/**
 * Which arc a chapter belongs to. A paced blueprint (ADR-0056) schedules its pacing arcs (8–30 chapters);
 * an unpaced one keeps one major arc per season.
 */
export function scheduleFromBlueprint(projectId: string, blueprint: SeriesBlueprint): ArcSchedule {
  const seasonId = (ordinal: number) =>
    blueprint.seasons.find((s) => s.ordinal === ordinal)?.id ?? planIds.season(projectId, ordinal);
  if (blueprint.pacing?.arcs.length)
    return {
      arcs: blueprint.pacing.arcs.map((a) => ({
        id: pacingArcId(projectId, a),
        seasonId: seasonId(a.season_ordinal),
        seasonOrdinal: a.season_ordinal,
        from: a.from,
        to: a.to,
        ordinal: a.ordinal,
      })),
    };
  const arcs = blueprint.seasons.map((s) => ({
    id: planIds.arc(projectId, s.ordinal, 1),
    seasonId: s.id ?? planIds.season(projectId, s.ordinal),
    seasonOrdinal: s.ordinal,
    from: s.chapter_range_est.from,
    to: s.chapter_range_est.to,
    ordinal: s.ordinal,
  }));
  return { arcs };
}

export function arcForChapter(schedule: ArcSchedule, chapterNo: number) {
  return (
    schedule.arcs.find((a) => chapterNo >= a.from && chapterNo <= a.to) ??
    schedule.arcs[schedule.arcs.length - 1]
  );
}

/**
 * Plan one arc from the blueprint season and the bible. Checkpointed per arc id, so chapter k reuses the
 * arc chapter 1 planned. Unlike the fixture path, the brief comes from the blueprint, not from a hardcoded
 * string.
 */
export async function planArcFromBlueprint(
  ctx: WorkflowContext,
  input: {
    blueprint: SeriesBlueprint;
    bible: StoryBible;
    arc: ArcSchedule['arcs'][number];
    previousArcExit?: string | undefined;
  },
): Promise<{ arcPlan: ArcPlan; artifactId: string }> {
  const season = input.blueprint.seasons.find((s) => s.ordinal === input.arc.seasonOrdinal);
  return runStep(
    ctx,
    'arc_plan',
    async () => {
      const stored = await existingArtifact(ctx, {
        step: 'arc_plan',
        kind: 'arc_plan',
        key: input.arc.id,
      });
      if (stored) return { arcPlan: stored.payload as ArcPlan, artifactId: stored.artifact_id };
      const block = compileFor(ctx, 'planner_compact');
      const lang = langOf(ctx);
      const ko = lang === 'ko';
      const call = await modelCall<Partial<ArcPlan>>(ctx, {
        step: 'arc_plan',
        family: 'arc_planner',
        activityId: `arc_plan:${input.arc.id}`,
        variables: {
          blueprint: renderBlueprint(input.blueprint, lang),
          season: ko
            ? season
              ? `시즌 ${season.ordinal} 「${season.title}」 (id ${input.arc.seasonId}), ${season.chapter_range_est.from}~${season.chapter_range_est.to}화: ${season.objective}${season.thesis ? ` 핵심 갈등: ${season.thesis}` : ''}`
              : `시즌 ${input.arc.ordinal} (id ${input.arc.seasonId})`
            : season
              ? `Season ${season.ordinal} "${season.title}" (id ${input.arc.seasonId}), chapters ${season.chapter_range_est.from}–${season.chapter_range_est.to}: ${season.objective}${season.thesis ? ` Thesis: ${season.thesis}` : ''}`
              : `Season ${input.arc.ordinal} (id ${input.arc.seasonId})`,
          arc_brief: ko
            ? `아크 ${input.arc.ordinal} (id ${input.arc.id})는 ${input.arc.from}~${input.arc.to}화를 덮는다. ${season?.entry_state ? `진입 상태: ${season.entry_state}. ` : ''}${season?.exit_state ? `도달할 이탈 상태: ${season.exit_state}.` : ''}${input.previousArcExit ? ` 이전 아크의 끝: ${input.previousArcExit}` : ''} 비트의 target_chapter_offset은 0(${input.arc.from}화)부터 ${input.arc.to - input.arc.from}까지다. 참여자와 장소는 아래 정사 상태의 등록부 id만 쓴다.`
            : `Arc ${input.arc.ordinal} (id ${input.arc.id}) covers chapters ${input.arc.from}–${input.arc.to}. ${season?.entry_state ? `Entry state: ${season.entry_state}. ` : ''}${season?.exit_state ? `Exit state to reach: ${season.exit_state}.` : ''}${input.previousArcExit ? ` Previous arc ended: ${input.previousArcExit}` : ''} Beats must carry target_chapter_offset from 0 (chapter ${input.arc.from}) to ${input.arc.to - input.arc.from}. Participants and locations must be registry ids from the canon state below.`,
          rhythm: renderArcRhythm(input.blueprint.pacing, input.arc.ordinal),
          canon_state: renderBibleSummary(input.bible, lang),
          open_promises: renderPromiseLines(input.bible, lang),
        },
        block,
      });
      const known = new Set(input.bible.entities.map((e) => e.id));
      const promiseIds = new Set(input.bible.promises.map((p) => p.id));
      const raw = call.output;
      const onlyKnown = (ids: unknown): string[] =>
        Array.isArray(ids) ? ids.filter((x): x is string => isString(x) && known.has(x)) : [];
      const onlyPromises = (ids: unknown): string[] =>
        Array.isArray(ids) ? ids.filter((x): x is string => isString(x) && promiseIds.has(x)) : [];
      const beats = (Array.isArray(raw.beats) ? raw.beats : []).map((b, i) => ({
        ...b,
        id: str(b.id) ?? `arc${input.arc.ordinal}.beat.${String(i + 1).padStart(2, '0')}`,
        target_chapter_offset: Math.max(
          0,
          Math.min(input.arc.to - input.arc.from, Math.round(b.target_chapter_offset || 0)),
        ),
        ...(b.participants ? { participants: onlyKnown(b.participants) } : {}),
        ...(b.promise_refs ? { promise_refs: onlyPromises(b.promise_refs) } : {}),
      }));
      const candidate = {
        ...raw,
        id: input.arc.id,
        project_id: ctx.projectId,
        season_id: input.arc.seasonId,
        kind: 'major',
        ordinal: input.arc.ordinal,
        version: 1,
        title:
          str(raw.title) ??
          input.blueprint.pacing?.arcs.find((a) => a.ordinal === input.arc.ordinal)?.title ??
          season?.title ??
          `Arc ${input.arc.ordinal}`,
        objective: str(raw.objective) ?? season?.objective ?? '',
        conflict: str(raw.conflict) ?? input.blueprint.main_conflict,
        chapter_range_est: { from: input.arc.from, to: input.arc.to },
        beats,
        participants: onlyKnown(raw.participants),
        locations: onlyKnown(raw.locations),
        promises_opened: onlyPromises(raw.promises_opened),
        promises_advanced: onlyPromises(raw.promises_advanced),
        promises_paid: onlyPromises(raw.promises_paid),
        status: 'validated',
      };
      const v = validatorFor<ArcPlan>('arc-plan.schema.json')(candidate);
      if (!v.ok)
        throw new WorkflowError(
          'ARC_PLAN_INVALID',
          v.errors.map((e) => `${e.path}: ${e.message}`).join('; '),
          { step: 'arc_plan', recommendedActions: ['regenerate'] },
        );
      const ref = await saveArtifact(ctx, {
        step: 'arc_plan',
        kind: 'arc_plan',
        key: input.arc.id,
        schema: 'arc-plan.schema.json',
        payload: v.value,
      });
      return { arcPlan: v.value, artifactId: ref.artifact_id };
    },
    input.arc.id,
  );
}

// ---------------------------------------------------------------------------------------------------------
// Stored plan: what the chapter loop reads
// ---------------------------------------------------------------------------------------------------------

export interface StoredStoryPlan {
  readonly spec_version: number;
  readonly intake_artifact_id: string;
  readonly spec_artifact_id: string;
  readonly concept_id: string;
  readonly bible_artifact_id: string;
  readonly blueprint_artifact_id: string;
  readonly target_chapters: number;
}

export async function loadStoredPlan(
  pool: Pool,
  projectId: string,
): Promise<
  | {
      plan: StoredStoryPlan;
      intake: StoryIntake;
      bible: StoryBible;
      blueprint: SeriesBlueprint;
    }
  | undefined
> {
  const project = await getProject(pool, projectId);
  const plan = project.settings.story_plan as StoredStoryPlan | undefined;
  if (!plan) return undefined;
  const [intake, bible, blueprint] = await Promise.all([
    getArtifactById(pool, plan.intake_artifact_id),
    getArtifactById(pool, plan.bible_artifact_id),
    getArtifactById(pool, plan.blueprint_artifact_id),
  ]);
  if (!intake || !bible || !blueprint)
    throw new WorkflowError(
      'INTERNAL',
      `project ${projectId} story plan references missing artifacts`,
      {
        step: 'init',
      },
    );
  return {
    plan,
    intake: validateIntake(intake.payload),
    bible: bible.payload as StoryBible,
    blueprint: blueprint.payload as SeriesBlueprint,
  };
}

// ---------------------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------------------

interface RawPromise {
  id?: unknown;
  type?: unknown;
  statement?: unknown;
  importance?: unknown;
  due_min_chapter?: unknown;
  due_max_chapter?: unknown;
  related_entity_names?: unknown;
  related_entity_ids?: unknown;
}

const PROMISE_TYPES = new Set([
  'foreshadowing',
  'mystery',
  'chekhov',
  'relationship_beat',
  'character_goal',
  'world_question',
  'running_gag',
  'threat',
  'debt',
  'red_herring',
]);

function normalizePromises(
  raw: unknown,
  projectId: string,
  resolve: (name: string | undefined) => string | undefined,
  targetChapters: number,
): StoryBible['promises'][number][] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw))
    incompletePlan('blueprint', 'The architect returned malformed promises; expected an array.');
  const out: StoryBible['promises'][number][] = [];
  const seen = new Set<string>();
  for (const [index, value] of raw.entries()) {
    if (!isRecord(value))
      incompletePlan(
        'blueprint',
        `The architect returned malformed promise ${index + 1}; expected an object.`,
      );
    const p = value as RawPromise;
    const statement = str(p.statement);
    if (!statement || seen.has(statement.toLowerCase())) continue;
    seen.add(statement.toLowerCase());
    const names = Array.isArray(p.related_entity_names)
      ? p.related_entity_names.filter(isString)
      : [];
    const min = clampChapter(p.due_min_chapter, targetChapters);
    const max = clampChapter(p.due_max_chapter, targetChapters);
    out.push({
      id: planIds.promise(projectId, statement),
      type: PROMISE_TYPES.has(String(p.type)) ? String(p.type) : 'foreshadowing',
      statement,
      importance: ['core', 'major', 'minor'].includes(String(p.importance))
        ? (p.importance as 'core' | 'major' | 'minor')
        : 'major',
      ...(min !== undefined ? { due_min_chapter: min } : {}),
      ...(max !== undefined ? { due_max_chapter: Math.max(max, min ?? max) } : {}),
      related_entity_ids: dedupe(names.map(resolve).filter(isString)),
    });
  }
  return out;
}

function normalizeSeasons(
  raw: unknown,
  targetChapters: number,
  projectId: string,
): SeriesBlueprint['seasons'] {
  const list = assertRecordItems(raw, 'seasons') ?? [];
  if (!list.length) incompletePlan('blueprint', 'The architect returned no authored seasons.');
  type Season = SeriesBlueprint['seasons'][number];
  const seasons: Season[] = [];
  let cursor = 1;
  for (const [i, s] of list.entries()) {
    const ordinal = i + 1;
    if (!fieldText(s, 'title') || !fieldText(s, 'objective'))
      incompletePlan('blueprint', `Season ${ordinal} needs an authored title and objective.`);
    const range = (s.chapter_range_est ?? {}) as { from?: unknown; to?: unknown };
    const from = range.from;
    const to = range.to;
    if (
      typeof from !== 'number' ||
      typeof to !== 'number' ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from !== cursor ||
      to < from ||
      to > targetChapters
    )
      incompletePlan(
        'blueprint',
        `Season ${ordinal} must cover a contiguous chapter window starting at ${cursor}.`,
      );
    if (!str(s.title) || !str(s.objective))
      incompletePlan('blueprint', `Season ${ordinal} needs an authored title and objective.`);
    seasons.push({
      id: planIds.season(projectId, ordinal),
      ordinal,
      title: str(s.title) ?? `Season ${ordinal}`,
      objective: str(s.objective) ?? '',
      ...(str(s.thesis) ? { thesis: str(s.thesis) } : {}),
      ...(str(s.entry_state) ? { entry_state: str(s.entry_state) } : {}),
      ...(str(s.exit_state) ? { exit_state: str(s.exit_state) } : {}),
      chapter_range_est: { from, to },
    } as SeriesBlueprint['seasons'][number]);
    cursor = to + 1;
  }
  if (cursor !== targetChapters + 1)
    incompletePlan(
      'blueprint',
      `The series plan must cover all ${targetChapters} requested chapters.`,
    );
  const [first, ...rest] = seasons;
  if (!first) throw new Error('unreachable: seasons is non-empty');
  return [first, ...rest];
}

function normalizeArc(
  raw: unknown,
  entityId: string,
  targetChapters: number,
): SeriesBlueprint['protagonist_arc'] {
  const a = (raw ?? {}) as Record<string, unknown>;
  const points = (assertRecordItems(a.turning_points, 'turning_points') ?? [])
    .map((m) => normalizeMilestone(m, targetChapters))
    .filter(isDefined);
  const [first, ...rest] = points;
  if (!str(a.start_state) || !str(a.end_state) || !first)
    incompletePlan(
      'blueprint',
      'Character arcs need authored start/end states and turning points.',
    );
  const turning: SeriesBlueprint['protagonist_arc']['turning_points'] = [first, ...rest];
  return {
    entity_id: entityId,
    start_state: str(a.start_state) ?? 'as introduced in chapter 1',
    end_state: str(a.end_state) ?? 'as resolved in the final chapter',
    turning_points: turning,
  };
}

type Milestone = Generated.SeriesBlueprintSchema.Milestone;

function normalizeMilestone(raw: unknown, targetChapters: number): Milestone | undefined {
  const m = assertRecord(raw, 'milestone');
  const description = str(m.description);
  if (!description) return undefined;
  const w = (m.window ?? {}) as { from?: unknown; to?: unknown };
  const from = clampChapter(w.from ?? m.chapter_from, targetChapters) ?? 1;
  const to = Math.max(from, clampChapter(w.to ?? m.chapter_to, targetChapters) ?? from);
  const id = str(m.id);
  return {
    ...(id !== undefined ? { id } : {}),
    description,
    window: { from, to },
    status: 'planned',
  };
}

function endingType(
  raw: unknown,
  preference: StoryIntake['ending_preference'],
): 'happy' | 'bittersweet' | 'open' | 'tragic' {
  const allowed = ['happy', 'bittersweet', 'open', 'tragic'] as const;
  if (preference && preference !== 'unspecified') return preference;
  return allowed.includes(raw as (typeof allowed)[number])
    ? (raw as (typeof allowed)[number])
    : 'happy';
}

function clampChapter(v: unknown, max: number): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.max(1, Math.min(max, Math.round(n)));
}

function sketch(c: NonNullable<StoryIntake['main_character']>, lang: 'en' | 'ko' = 'en'): string {
  return [
    c.name,
    c.role ? `(${c.role})` : '',
    c.description ?? '',
    c.speech_notes ? `${lang === 'ko' ? '말투' : 'Speech'}: ${c.speech_notes}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}
function assertRecordItems(
  value: unknown,
  label: string,
): readonly Record<string, unknown>[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((item) => !isRecord(item)))
    incompletePlan('blueprint', `${label} must be an array of objects.`);
  return value as readonly Record<string, unknown>[];
}
function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) incompletePlan('blueprint', `${label} must be an object.`);
  return value;
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function isString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}
function isDefined<T>(v: T | undefined): v is T {
  return v !== undefined;
}
function isUuidLike(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
}
function dedupe(xs: readonly string[]): string[] {
  return [...new Set(xs.map((x) => x.trim()).filter(Boolean))];
}
/** Fact attribute segment: the schema pattern allows only `[a-z_]`, so digits are spelled out. */
function slug(s: string): string {
  const digits = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const out = s
    .toLowerCase()
    .replace(/[0-9]/g, (d) => `_${digits[Number(d)] ?? ''}_`)
    .replace(/[^a-z_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
    .replace(/_+$/g, '');
  return out || 'rule';
}

export function renderSpec(spec: StorySpec, lang: 'en' | 'ko' = 'en'): string {
  return spec.items
    .map(
      (i) =>
        `- [${i.id}] (${i.kind}, ${i.category}${i.scope.level !== 'series' ? `, ${i.scope.level}` : ''}) ${lang === 'ko' ? i.text : (i.text_en ?? i.text)}`,
    )
    .join('\n');
}

export function renderBibleSummary(b: StoryBible, lang: 'en' | 'ko' = 'en'): string {
  const ko = lang === 'ko';
  return [
    renderBibleDesign(b, lang),
    ...b.entities.map(
      (e) =>
        `- [${e.id}] ${e.display_name} (${e.type})${e.short_forms?.length ? ` ${ko ? '약칭' : 'a.k.a.'} ${e.short_forms.join(', ')}` : ''}${e.description ? `: ${e.description}` : ''}`,
    ),
    ...b.propositions.map(
      (p) =>
        `- ${ko ? '명제' : 'proposition'} ${p.local_id}: ${p.statement} [${p.truth}${p.secret ? (ko ? ', 비밀' : ', secret') : ''}]`,
    ),
  ].join('\n');
}

function incompletePlan(step: string, message: string): never {
  throw new WorkflowError('ARC_PLAN_INVALID', message, {
    step,
    recommendedActions: ['regenerate'],
  });
}

function fieldText(value: unknown, field: string): string | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? str((value as Record<string, unknown>)[field])
    : undefined;
}

async function runDesignStep<T>(
  ctx: WorkflowContext,
  step: string,
  baseActivityId: string,
  generate: (activityId: string) => Promise<T>,
): Promise<T> {
  return runStep(ctx, step, async () => {
    let generation = 0;
    let activityId = baseActivityId;
    while (await existingArtifact(ctx, { step, kind: 'planning_rejection', key: activityId })) {
      activityId = `${baseActivityId}:regeneration:${++generation}`;
    }
    try {
      return await generate(activityId);
    } catch (err) {
      if (err instanceof WorkflowError && ['ARC_PLAN_INVALID', 'SPEC_INVALID'].includes(err.code)) {
        // Only rejected output gets a new model key. A crash still replays the paid response.
        await saveArtifact(ctx, {
          step,
          kind: 'planning_rejection',
          key: activityId,
          payload: { code: err.code, message: err.detail },
        });
      }
      throw err;
    }
  });
}

function renderBlueprint(b: SeriesBlueprint, lang: 'en' | 'ko' = 'en'): string {
  if (lang === 'ko')
    return [
      `스토리 프라미스: ${b.story_promise}`,
      `독자 판타지: ${b.reader_fantasy}`,
      `주 갈등: ${b.main_conflict}`,
      `결말 (${b.ending.type}): ${b.ending.summary ?? ''} 최종 상태: ${b.ending.final_state_assertions.join('; ')}`,
      `엔드게임 요구사항: ${b.endgame_requirements.map((r) => `[${r.id}] ${r.statement}`).join('; ') || '(없음)'}`,
      `시즌:`,
      ...b.seasons.map(
        (s) =>
          `  ${s.ordinal}. ${s.title} (${s.chapter_range_est.from}~${s.chapter_range_est.to}화): ${s.objective}${s.exit_state ? ` → ${s.exit_state}` : ''}`,
      ),
      `주인공 아크: ${b.protagonist_arc.start_state} → ${b.protagonist_arc.end_state}; 전환점: ${b.protagonist_arc.turning_points.map((t) => `${t.description} (${t.window.from}~${t.window.to}화)`).join('; ')}`,
    ].join('\n');
  return [
    `Story promise: ${b.story_promise}`,
    `Reader fantasy: ${b.reader_fantasy}`,
    `Main conflict: ${b.main_conflict}`,
    `Ending (${b.ending.type}): ${b.ending.summary ?? ''} Final state: ${b.ending.final_state_assertions.join('; ')}`,
    `Endgame requirements: ${b.endgame_requirements.map((r) => `[${r.id}] ${r.statement}`).join('; ') || '(none)'}`,
    `Seasons:`,
    ...b.seasons.map(
      (s) =>
        `  ${s.ordinal}. ${s.title} (ch.${s.chapter_range_est.from}–${s.chapter_range_est.to}): ${s.objective}${s.exit_state ? ` → ${s.exit_state}` : ''}`,
    ),
    `Protagonist arc: ${b.protagonist_arc.start_state} → ${b.protagonist_arc.end_state}; turning points: ${b.protagonist_arc.turning_points.map((t) => `${t.description} (ch.${t.window.from}–${t.window.to})`).join('; ')}`,
  ].join('\n');
}

/** Text of a scalar model field for a part instruction; objects and absent values render as the fallback. */
function txt(v: unknown, fallback = ''): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : fallback;
}
