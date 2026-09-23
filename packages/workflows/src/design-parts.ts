/**
 * Part-scoped design calls (ADR-0057).
 *
 * A complete bible stage (a 10-person cast, a season of 50 chapter slots) is one long generation. Behind a
 * provider or tunnel with a response-time cap, a long generation is lost whole: the upstream finishes, the
 * response never arrives, and the retry is exactly as long. Asking for the design in bounded parts keeps
 * every call short, and lets each part see what earlier parts decided (the part instruction is built from
 * the merged output so far).
 *
 * Parts are only used when the PINNED prompt version declares a `part` variable (ADR-0053): a job pinned to
 * an older version makes the single call it always made. Every part is its own checkpointed model call with
 * its own activity id, so a crash replays paid parts instead of regenerating them.
 */
import { type WorkflowContext, modelCall } from './runtime.js';

type Rec = Record<string, unknown>;
type Block = Parameters<typeof modelCall>[1]['block'];

export interface DesignPart {
  readonly key: string;
  /** The Korean scope instruction for this part, built from what earlier parts produced. */
  readonly instruction: (soFar: Rec) => string;
  /** Output budget for this part in characters (default 3,500). */
  readonly budgetChars?: number | undefined;
  /**
   * Fields this part is responsible for. A field owned by some part is taken only from its owner: live
   * models fill fields they were told to leave empty with placeholders (`{"statement": ""}`), which would
   * otherwise merge into the owner's list. Fields no part owns merge from any part.
   */
  readonly fields?: readonly string[] | undefined;
}

// Measured on the live bridge: an unbounded single-character part ran past the tunnel's ~2-minute cap,
// the same part with a ~3,000-character budget returned in under a minute.
const DEFAULT_PART_BUDGET = 3500;

/** True when the pinned version of `family` declares a `part` variable. */
export function declaresPart(ctx: WorkflowContext, family: string): boolean {
  const id = ctx.promptSet.mapping[family];
  if (!id) return false;
  try {
    return ctx.registry.get(id).input_variables.includes('part');
  } catch {
    return false;
  }
}

/**
 * Part mode is an operator choice for providers with a response-time cap (`YEONJAE_DESIGN_PARTS=on`); the
 * default makes one call per stage with an unrestricted scope.
 */
export function designPartsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.YEONJAE_DESIGN_PARTS === 'on';
}

const WHOLE_SCOPE = '범위 제한 없음. 모든 필드를 한 번에 설계한다.';

const nameOf = (v: unknown): string | undefined => {
  if (typeof v !== 'object' || v === null) return undefined;
  const r = v as Rec;
  for (const k of [
    'display_name',
    'name',
    'term',
    'attribute',
    'statement',
    'chapter_no',
    'entity_name',
    'title',
  ])
    if (typeof r[k] === 'string' || typeof r[k] === 'number') return `${k}:${String(r[k])}`;
  return undefined;
};

const PLACEHOLDER_KEYS = new Set(['id', 'kind', 'type']);

/** An object item with no authored text or numbers besides its id/kind — a model's schema filler. */
export function isPlaceholderItem(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false;
  return Object.entries(v as Rec).every(
    ([k, x]) =>
      PLACEHOLDER_KEYS.has(k) ||
      x === null ||
      x === undefined ||
      (typeof x === 'string' && x.trim() === '') ||
      (Array.isArray(x) && x.length === 0),
  );
}

/** Keep only the fields `part` may contribute: its own, and those no part owns. */
export function scopeToPart(output: Rec, part: DesignPart, parts: readonly DesignPart[]): Rec {
  const owned = new Set(parts.flatMap((p) => p.fields ?? []));
  if (owned.size === 0) return output;
  return Object.fromEntries(
    Object.entries(output).filter(([k]) => part.fields?.includes(k) === true || !owned.has(k)),
  );
}

/**
 * Merge part outputs: arrays concatenate (a later item with the same identifying key replaces the earlier
 * one, so a part may refine what it was shown; placeholder items are dropped), scalars and objects keep
 * the first non-empty value.
 */
export function mergeParts(parts: readonly Rec[]): Rec {
  const out: Rec = {};
  for (const part of parts) {
    for (const [k, v] of Object.entries(part)) {
      if (Array.isArray(v)) {
        const prev = Array.isArray(out[k]) ? (out[k] as unknown[]) : [];
        const merged = [...prev];
        for (const item of v) {
          if (isPlaceholderItem(item)) continue;
          const key = nameOf(item);
          const at = key === undefined ? -1 : merged.findIndex((x) => nameOf(x) === key);
          if (at >= 0) merged[at] = item;
          else merged.push(item);
        }
        out[k] = merged;
      } else if (v !== undefined && v !== null && v !== '') {
        const cur = out[k];
        const empty =
          cur === undefined ||
          cur === null ||
          cur === '' ||
          (typeof cur === 'object' && !Array.isArray(cur) && Object.keys(cur).length === 0);
        if (empty) out[k] = v;
      }
    }
  }
  return out;
}

/**
 * Live models write `null` for a field they cannot fill (an antagonist's unknown age). The design
 * contracts treat such a FIELD as absent, so null-valued fields are removed before validation. A null
 * array ITEM is left alone: it is a malformed item the validator must still reject.
 */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNulls);
  if (typeof value === 'object' && value !== null)
    return Object.fromEntries(
      Object.entries(value as Rec)
        .filter(([, v]) => v !== null)
        .map(([k, v]) => [k, stripNulls(v)]),
    );
  return value;
}

export async function callInParts<T extends Rec>(
  ctx: WorkflowContext,
  input: {
    readonly step: string;
    readonly family: string;
    readonly activityId: string;
    readonly variables: Readonly<Record<string, string>>;
    readonly block: Block;
    readonly parts: readonly DesignPart[];
  },
): Promise<T> {
  const declares = declaresPart(ctx, input.family);
  if (!declares || !designPartsEnabled() || input.parts.length === 0) {
    const call = await modelCall<T>(ctx, {
      step: input.step,
      family: input.family,
      activityId: input.activityId,
      variables: declares ? { ...input.variables, part: WHOLE_SCOPE } : input.variables,
      block: input.block,
    });
    return stripNulls(call.output) as T;
  }
  const outputs: Rec[] = [];
  for (const part of input.parts) {
    const call = await modelCall<Rec>(ctx, {
      step: input.step,
      family: input.family,
      activityId: `${input.activityId}:part:${part.key}`,
      variables: {
        ...input.variables,
        part: `${part.instruction(mergeParts(outputs))}\n출력 분량: 이번 응답(JSON 전체)은 ${String(part.budgetChars ?? DEFAULT_PART_BUDGET)}자 이내로 쓴다. 서술 필드는 한두 문장으로 압축하고, 필요한 항목은 빠뜨리지 않는다.`,
      },
      block: input.block,
    });
    outputs.push(scopeToPart(call.output, part, input.parts));
  }
  return stripNulls(mergeParts(outputs)) as T;
}
