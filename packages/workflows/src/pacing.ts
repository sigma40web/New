/**
 * The pacing map (ADR-0056): a chapter-by-chapter rhythm plan for the whole series, part of the Story Bible.
 *
 * Seasons (40–60 chapters) are too coarse to pace a serial: one arc per season let arc plans leave most
 * chapters without a planned beat, and chapter planners filled the gaps by pulling events forward. The pacing
 * map splits every season into arcs of 8–30 chapters and gives EVERY chapter a role (buildup, incident,
 * climax, aftermath, daily, relationship…), a tension level, one core beat, a thread, a payoff and a hook.
 *
 * It is produced per season by the `pacing_designer` family from a deterministic rhythm skeleton, then
 * validated here. Structure (coverage, contiguity, one climax per arc) is enforced; rhythm rules (frustration
 * streaks, payoff gaps, tension plateaus, a slow opening) are repaired when a plan misses by a few slots and
 * rejected when it misses by more, so the design step regenerates rather than writing a rushed or stalled
 * plan into the bible.
 */
import { uuidFromKey } from '@yeonjae/domain';
import { WorkflowError } from './errors.js';

export const PACING_ROLES = [
  'hook',
  'setup',
  'daily',
  'buildup',
  'foreshadow',
  'incident',
  'confrontation',
  'climax',
  'aftermath',
  'reward',
  'relationship',
  'twist',
  'rest',
] as const;
export type PacingRole = (typeof PACING_ROLES)[number];
export const PACING_THREADS = [
  'main',
  'growth',
  'romance',
  'mystery',
  'rival',
  'daily',
  'world',
] as const;
export const PACING_PAYOFFS = ['cider', 'reveal', 'emotion', 'growth', 'humor', 'none'] as const;
export const PACING_HOOKS = [
  'cliffhanger',
  'reveal',
  'decision',
  'arrival_of_threat',
  'emotional_peak',
  'quiet_ominous',
] as const;
export const ARC_KINDS = [
  'introduction',
  'daily',
  'incident',
  'exam',
  'tournament',
  'dungeon',
  'conflict',
  'romance',
  'mystery',
  'war',
  'climax',
] as const;

export interface PacingArc {
  readonly ordinal: number;
  readonly season_ordinal: number;
  readonly title: string;
  readonly kind: (typeof ARC_KINDS)[number];
  readonly from: number;
  readonly to: number;
  readonly purpose: string;
  readonly climax_chapter: number;
  readonly focus_characters: readonly string[];
}

export interface PacingChapter {
  readonly chapter_no: number;
  readonly arc_ordinal: number;
  readonly role: PacingRole;
  readonly tension: number;
  readonly beat: string;
  readonly thread: (typeof PACING_THREADS)[number];
  readonly payoff: (typeof PACING_PAYOFFS)[number];
  readonly frustration: boolean;
  readonly hook: (typeof PACING_HOOKS)[number];
  readonly focus_character?: string | undefined;
}

export interface PacingMap {
  readonly arcs: readonly PacingArc[];
  readonly chapters: readonly PacingChapter[];
}

export interface SeasonWindow {
  readonly ordinal: number;
  readonly title: string;
  readonly from: number;
  readonly to: number;
}

export interface PacingRules {
  /** Longest run of pure-setback chapters (고구마) before relief. */
  readonly maxFrustrationStreak: number;
  /** Longest gap between chapters that pay something off. */
  readonly maxPayoffGap: number;
  /** Longest run of chapters at tension ≥ 8 (a climax plateau exhausts the reader). */
  readonly maxHighTensionRun: number;
  /** Chapters 1..N stay low and slow (tension ≤ 7, no climax). */
  readonly slowOpeningChapters: number;
}

export const DEFAULT_PACING_RULES: PacingRules = {
  maxFrustrationStreak: 3,
  maxPayoffGap: 5,
  maxHighTensionRun: 4,
  slowOpeningChapters: 10,
};

/** Rules for a series length: a slow opening only makes sense for a long serial. */
export function pacingRulesFor(targetChapters: number): PacingRules {
  return {
    ...DEFAULT_PACING_RULES,
    slowOpeningChapters: targetChapters >= 60 ? DEFAULT_PACING_RULES.slowOpeningChapters : 0,
  };
}

const ROLE_KO: Readonly<Record<PacingRole, string>> = {
  hook: '훅',
  setup: '설정·상황 제시',
  daily: '일상',
  buildup: '빌드업',
  foreshadow: '전조·떡밥',
  incident: '사건',
  confrontation: '대결',
  climax: '클라이맥스',
  aftermath: '여운',
  reward: '보상',
  relationship: '관계',
  twist: '반전',
  rest: '숨 고르기',
};
const PAYOFF_KO: Readonly<Record<string, string>> = {
  cider: '사이다',
  reveal: '폭로',
  emotion: '감정',
  growth: '성장',
  humor: '웃음',
  none: '없음',
};
const THREAD_KO: Readonly<Record<string, string>> = {
  main: '메인',
  growth: '성장',
  romance: '관계·로맨스',
  mystery: '미스터리',
  rival: '라이벌',
  daily: '일상',
  world: '세계',
};
const HOOK_KO: Readonly<Record<string, string>> = {
  cliffhanger: '클리프행어',
  reveal: '폭로',
  decision: '결단',
  arrival_of_threat: '위협 등장',
  emotional_peak: '감정 정점',
  quiet_ominous: '불길한 여운',
};

/**
 * Deterministic rhythm skeleton for one season: suggested arc boundaries and a sawtooth tension baseline.
 * It is guidance for the designer, not the plan; the validator checks rules, not this exact split.
 */
export function rhythmSkeleton(
  season: SeasonWindow,
  targetChapters: number,
  rules: PacingRules = DEFAULT_PACING_RULES,
): string {
  const len = season.to - season.from + 1;
  const arcCount = Math.max(1, Math.min(6, Math.round(len / 14)));
  const lines: string[] = [
    `시즌 ${season.ordinal} 「${season.title}」: ${season.from}~${season.to}화 (${len}화, 전체 ${targetChapters}화 중). 권장 아크 수 ${arcCount}개.`,
  ];
  let start = season.from;
  for (let i = 0; i < arcCount; i++) {
    const remaining = season.to - start + 1;
    const size = i === arcCount - 1 ? remaining : Math.round(remaining / (arcCount - i));
    const end = start + size - 1;
    const climax = Math.max(start, end - Math.max(1, Math.round(size * 0.12)));
    const lastArc = i === arcCount - 1;
    const peak = lastArc
      ? '시즌 클라이맥스 아크: 최고 긴장 9~10.'
      : `최고 긴장 ${Math.min(9, 6 + i)}.`;
    lines.push(
      `- 아크 ${i + 1} 권장: ${start}~${end}화. 빌드업 ${start}~${Math.max(start, climax - 2)}화 → 클라이맥스 ${climax}화 전후 → 여운·보상 ${Math.min(end, climax + 1)}~${end}화. ${peak}`,
    );
    start = end + 1;
  }
  if (season.from === 1 && rules.slowOpeningChapters > 0)
    lines.push(
      `- 연재 초반: 1~3화는 상황 제시와 첫 훅(긴장 3~5), 3화 안에 첫 작은 사이다. 4~${rules.slowOpeningChapters}화는 규칙·인물 소개와 첫 목표(긴장 4~6). ${rules.slowOpeningChapters}화까지는 긴장 7을 넘기지 않는다(작은 도입 아크의 클라이맥스도 7 이하).`,
    );
  lines.push(
    `- 규칙: 고구마 최대 ${rules.maxFrustrationStreak}화 연속, 보상(payoff가 none이 아닌 회차) 간격 최대 ${rules.maxPayoffGap}화, 긴장 8 이상 최대 ${rules.maxHighTensionRun}화 연속, 아크마다 climax 역할 회차 하나 이상.`,
  );
  return lines.join('\n');
}

const isRec = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
const int = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.round(v)
    : typeof v === 'string' && /^\d+$/.test(v)
      ? Number(v)
      : undefined;

function reject(message: string, season: SeasonWindow): never {
  throw new WorkflowError(
    'ARC_PLAN_INVALID',
    `pacing map for season ${season.ordinal}: ${message}`,
    { step: 'pacing', recommendedActions: ['regenerate'] },
  );
}

/**
 * Coerce and validate one season of pacing-designer output. Arc ordinals are series-global
 * (`arcOffset` = arcs already planned in earlier seasons).
 */
export function normalizePacingSeason(
  raw: unknown,
  season: SeasonWindow,
  arcOffset: number,
  rules: PacingRules = DEFAULT_PACING_RULES,
  /** Receives the deterministic rhythm repairs applied to a near-miss plan. */
  notes?: string[],
): PacingMap {
  const r = isRec(raw) ? raw : {};
  const rawArcs = (Array.isArray(r.arcs) ? (r.arcs as unknown[]) : []).filter(isRec);
  const rawChapters = (Array.isArray(r.chapters) ? (r.chapters as unknown[]) : []).filter(isRec);
  if (rawArcs.length === 0) reject('no arcs', season);

  // Arcs: sorted, contiguous, covering the season exactly (±1 chapter of seam slack is aligned).
  const sortedArcs = rawArcs
    .map((a) => ({ a, from: int(a.from), to: int(a.to) }))
    .filter(
      (x): x is { a: Record<string, unknown>; from: number; to: number } =>
        x.from !== undefined && x.to !== undefined && x.to >= x.from,
    )
    .sort((x, y) => x.from - y.from);
  if (sortedArcs.length === 0) reject('arcs carry no chapter ranges', season);
  const arcs: PacingArc[] = [];
  let expected = season.from;
  sortedArcs.forEach((x, i) => {
    if (Math.abs(x.from - expected) > 1)
      reject(
        `arc ${i + 1} starts at ${x.from}, expected ${expected} (arcs must be contiguous)`,
        season,
      );
    const from = expected;
    const to = i === sortedArcs.length - 1 ? season.to : x.to;
    if (to < from) reject(`arc ${i + 1} is empty after alignment`, season);
    arcs.push({
      ordinal: arcOffset + i + 1,
      season_ordinal: season.ordinal,
      title: str(x.a.title) ?? `아크 ${arcOffset + i + 1}`,
      kind: oneOf(x.a.kind, ARC_KINDS, 'incident'),
      from,
      to,
      purpose: str(x.a.purpose) ?? '',
      climax_chapter: to,
      focus_characters: (Array.isArray(x.a.focus_characters)
        ? (x.a.focus_characters as unknown[])
        : []
      )
        .map(str)
        .filter((s): s is string => !!s),
    });
    expected = to + 1;
  });
  const lastArc = arcs[arcs.length - 1];
  if (lastArc?.to !== season.to) reject('arcs do not reach the end of the season', season);
  if (arcs.length > 1)
    for (const a of arcs)
      if (a.to - a.from + 1 < 3)
        reject(
          `arc ${a.ordinal} is ${a.to - a.from + 1} chapters; an arc needs room to build`,
          season,
        );

  // Chapters: exactly one slot per chapter of the season.
  const byNo = new Map<number, Record<string, unknown>>();
  for (const c of rawChapters) {
    const n = int(c.chapter_no);
    if (n !== undefined && n >= season.from && n <= season.to && !byNo.has(n)) byNo.set(n, c);
  }
  const missing: number[] = [];
  for (let n = season.from; n <= season.to; n++) if (!byNo.has(n)) missing.push(n);
  if (missing.length > 0)
    reject(
      `chapters without a slot: ${missing.slice(0, 12).join(', ')}${missing.length > 12 ? ' …' : ''}`,
      season,
    );
  const arcOf = (n: number) => arcs.find((a) => n >= a.from && n <= a.to) ?? lastArc;
  const chapters: PacingChapter[] = [];
  for (let n = season.from; n <= season.to; n++) {
    const c = byNo.get(n) ?? {};
    const beat = str(c.beat);
    if (!beat) reject(`chapter ${n} has no core beat`, season);
    chapters.push({
      chapter_no: n,
      arc_ordinal: arcOf(n).ordinal,
      role: oneOf(c.role, PACING_ROLES, 'buildup'),
      tension: Math.min(10, Math.max(1, int(c.tension) ?? 5)),
      beat,
      thread: oneOf(c.thread, PACING_THREADS, 'main'),
      payoff: oneOf(c.payoff, PACING_PAYOFFS, 'none'),
      frustration: c.frustration === true,
      hook: oneOf(c.hook, PACING_HOOKS, 'cliffhanger'),
      ...(str(c.focus_character) ? { focus_character: str(c.focus_character) } : {}),
    });
  }

  // Rhythm rules are REPAIRED deterministically when the plan is close (a few slots off), and the plan
  // is rejected when it needs more than a small number of repairs: a near-miss is a label, a far miss is
  // a plan that does not pace.
  const repairs: string[] = [];
  const budget = Math.max(3, Math.ceil(chapters.length * 0.1));
  const set = (i: number, patch: Partial<PacingChapter>, why: string) => {
    const c = chapters[i];
    if (!c) return;
    chapters[i] = { ...c, ...patch };
    repairs.push(`${c.chapter_no}화: ${why}`);
  };

  // Every arc has a climax slot; the arc's climax chapter is its most tense climax slot.
  arcs.forEach((a, ai) => {
    const idx = chapters.map((c, i) => ({ c, i })).filter(({ c }) => c.arc_ordinal === a.ordinal);
    if (!idx.some(({ c }) => c.role === 'climax')) {
      const pick = idx.reduce((m, x) => (x.c.tension >= m.c.tension ? x : m));
      set(pick.i, { role: 'climax', tension: Math.max(pick.c.tension, 7) }, 'climax role assigned');
    }
    const climaxes = chapters.filter((c) => c.arc_ordinal === a.ordinal && c.role === 'climax');
    const peak = climaxes.reduce((m, c) => (c.tension > m.tension ? c : m));
    arcs[ai] = { ...a, climax_chapter: peak.chapter_no };
  });

  let streak = 0;
  let high = 0;
  let sincePayoff = 0;
  chapters.forEach((c0, i) => {
    let c = c0;
    if (c.chapter_no <= rules.slowOpeningChapters && c.tension > 7) {
      set(i, { tension: 7 }, 'slow opening: tension capped at 7');
      c = chapters[i] ?? c;
    }
    streak = c.frustration ? streak + 1 : 0;
    if (streak > rules.maxFrustrationStreak) {
      set(i, { frustration: false }, `frustration streak capped at ${rules.maxFrustrationStreak}`);
      streak = 0;
    }
    high = c.tension >= 8 ? high + 1 : 0;
    if (high > rules.maxHighTensionRun) {
      if (c.role !== 'climax') set(i, { tension: 7 }, 'tension plateau broken');
      else set(i - 1, { tension: 7 }, 'tension plateau broken before the climax');
      high = c.role === 'climax' ? 1 : 0;
    }
    sincePayoff = c.payoff === 'none' ? sincePayoff + 1 : 0;
    if (sincePayoff > rules.maxPayoffGap) {
      set(i, { payoff: 'emotion' }, `payoff gap capped at ${rules.maxPayoffGap}`);
      sincePayoff = 0;
    }
  });
  if (repairs.length > budget)
    reject(
      `needs ${repairs.length} rhythm repairs (budget ${budget}): ${repairs.slice(0, 8).join('; ')}`,
      season,
    );
  notes?.push(...repairs);
  return { arcs, chapters };
}

/** Merge seasons into one map (seasons are validated independently and are disjoint by construction). */
export function mergePacing(parts: readonly PacingMap[]): PacingMap {
  return {
    arcs: parts.flatMap((p) => p.arcs),
    chapters: parts.flatMap((p) => p.chapters).sort((a, b) => a.chapter_no - b.chapter_no),
  };
}

function slotLine(c: PacingChapter): string {
  const tags = [
    ROLE_KO[c.role],
    `긴장 ${c.tension}`,
    THREAD_KO[c.thread] ?? c.thread,
    ...(c.payoff !== 'none' ? [`보상 ${PAYOFF_KO[c.payoff] ?? c.payoff}`] : []),
    ...(c.frustration ? ['고구마'] : []),
  ].join('·');
  const tail = `절단: ${HOOK_KO[c.hook] ?? c.hook}${c.focus_character ? `, 초점: ${c.focus_character}` : ''}`;
  return `${c.chapter_no}화 [${tags}] ${c.beat} (${tail})`;
}

/** The arc's rhythm for the arc planner: arc intent plus every chapter slot. */
export function renderArcRhythm(map: PacingMap | undefined, arcOrdinal: number): string {
  const arc = map?.arcs.find((a) => a.ordinal === arcOrdinal);
  if (!map || !arc) return '(페이싱 지도 없음 — 시즌 목표를 기준으로 비트를 고르게 배치한다)';
  const slots = map.chapters.filter((c) => c.arc_ordinal === arcOrdinal);
  return [
    `아크 ${arc.ordinal} 「${arc.title}」 (${arc.kind}): ${arc.from}~${arc.to}화. 목적: ${arc.purpose}. 클라이맥스: ${arc.climax_chapter}화.${arc.focus_characters.length ? ` 관계 초점: ${arc.focus_characters.join(', ')}.` : ''}`,
    '회차별 리듬 (비트는 이 배치를 따른다. 사건을 앞당기지 않는다):',
    ...slots.map(slotLine),
  ].join('\n');
}

/** Where this chapter sits in the rhythm: its slot plus two neighbours on each side. */
export function renderRhythmPosition(map: PacingMap | undefined, chapterNo: number): string {
  if (!map) return '(페이싱 지도 없음 — 아크 계획의 비트 배치를 따른다)';
  const slot = map.chapters.find((c) => c.chapter_no === chapterNo);
  if (!slot) return '(이 회차의 페이싱 슬롯 없음 — 아크 계획의 비트 배치를 따른다)';
  const arc = map.arcs.find((a) => a.ordinal === slot.arc_ordinal);
  const near = map.chapters.filter(
    (c) =>
      c.chapter_no >= chapterNo - 2 && c.chapter_no <= chapterNo + 2 && c.chapter_no !== chapterNo,
  );
  const lines = [`이번 회차: ${slotLine(slot)}`];
  if (arc) {
    const where =
      chapterNo < arc.climax_chapter
        ? `${arc.climax_chapter - chapterNo}화 뒤`
        : chapterNo === arc.climax_chapter
          ? '바로 이번 회차'
          : '지났음 — 여운과 다음 떡밥';
    lines.push(
      `아크 「${arc.title}」 ${arc.to - arc.from + 1}화 중 ${chapterNo - arc.from + 1}번째, 클라이맥스는 ${arc.climax_chapter}화 (${where}).`,
    );
  }
  lines.push('앞뒤 회차:', ...near.map((c) => `- ${slotLine(c)}`));
  lines.push(
    '이번 회차는 자기 역할만 해낸다. 뒤 회차의 사건을 당겨 오지 않고, 앞 회차의 사건을 되풀이하지 않는다.',
  );
  return lines.join('\n');
}

/** Stable arc id for a pacing arc (season-scoped, like the season-level arcs it refines). */
export function pacingArcId(
  projectId: string,
  arc: Pick<PacingArc, 'season_ordinal' | 'ordinal'>,
): string {
  return uuidFromKey(`${projectId}:season:${arc.season_ordinal}:pacing-arc:${arc.ordinal}`);
}
