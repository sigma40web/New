/**
 * Compact chapter mode (ADR-0059).
 *
 * Standard mode makes a scene-planner call, one writer call per scene and seven evaluation calls in
 * sequence. Behind a slow bridge (4–8 minutes per long call) that is ~50 minutes a chapter, most of it
 * spent re-sending the same context. Compact mode keeps every artifact, gate and checkpoint of the standard
 * loop and changes only how many calls produce them:
 *
 * - the scene plan is derived deterministically from the locked contract as one whole-chapter scene (no
 *   scene-planner call), so the writer writes the episode in one pass;
 * - the evaluation calls (contract, continuity, knowledge leak, four judges) run concurrently — still
 *   separate judges with separate rubrics and separate gates.
 *
 * The plan is stored under the same `scene_plan` step, so a chapter whose plan was already made in standard
 * mode replays it unchanged; the mode only applies to plans not yet made.
 */
import { type ChapterContract } from './planning.js';
import { type ScenePlan } from './drafting.js';

export function compactChapterMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.YEONJAE_CHAPTER_MODE === 'compact';
}

type Beat = ScenePlan['beats'][number];
type BeatType = Beat['type'];

const MUST_TO_BEAT: Record<ChapterContract['must_happen'][number]['kind'], BeatType> = {
  event: 'action',
  revelation: 'revelation',
  decision: 'decision',
  progression: 'progression',
  relationship: 'emotional',
  comedic_beat: 'comedic',
  required_scene: 'action',
};

/**
 * One scene covering the whole chapter, built only from the contract: opening → required events →
 * local payoff → hook. Returns undefined when the contract names no location (the scene plan requires
 * one); the caller then falls back to the scene planner.
 */
export function wholeChapterScene(
  contract: ChapterContract,
  lang: 'en' | 'ko',
): ScenePlan | undefined {
  const location = contract.locations[0];
  if (!location) return undefined;
  const ko = lang === 'ko';
  const beats: [Beat, ...Beat[]] = [
    {
      type: 'action',
      description: `${ko ? '도입' : 'Opening'} (${contract.opening.type}): ${contract.opening.description}`,
      tags: ['tension'],
    },
    ...contract.must_happen.map((m): Beat => ({
      type: MUST_TO_BEAT[m.kind],
      description: `[${m.id}] ${m.description}`,
      ...(m.proposition_ids?.length ? { reveals_proposition_ids: m.proposition_ids } : {}),
    })),
    ...contract.local_satisfaction.map((s): Beat => ({
      type: 'progression',
      description: `${ko ? '로컬 보상' : 'Local payoff'} (${s.type}): ${s.description}`,
      tags: ['satisfaction'],
    })),
    {
      type: 'cliffhanger',
      description: `${ko ? '절단' : 'Hook'} (${contract.hook.type}): ${contract.hook.description}${
        contract.hook.question_raised
          ? ` — ${ko ? '남길 질문' : 'question'}: ${contract.hook.question_raised}`
          : ''
      }`,
      tags: ['tension'],
    },
  ];
  const onPage = contract.participants.filter((p) => p.on_page).map((p) => p.character_id);
  const [first = contract.pov.character_id, ...rest] = onPage;
  return {
    scene_no: 1,
    objective: ko
      ? `회차 전체를 한 번에 쓴다. ${contract.purpose}`
      : `Write the whole chapter in one pass. ${contract.purpose}`,
    pov: { character_id: contract.pov.character_id, person: contract.pov.person },
    participants: [first, ...rest],
    location_id: location,
    story_time: { start: contract.story_time.start, end: contract.story_time.end },
    opening_beat_type: contract.opening.type,
    ending_beat_type: contract.hook.type,
    beats,
    exit_state: contract.ending_state,
    dialogue_density_target: contract.dialogue_density_target,
    must_not: contract.must_not_happen.map((m) => m.description),
    speaker_pairs: [],
    length_target: contract.length_target,
  };
}

/**
 * A call that starts on first use and is shared after. Compact mode starts every evaluation call up front
 * and lets them all settle (so each succeeded call is checkpointed) before any result is read in order.
 */
export function once<T>(f: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | undefined;
  return () => (p ??= f());
}
