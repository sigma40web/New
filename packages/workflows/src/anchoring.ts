/**
 * Deterministic re-anchoring of model-reported spans (policy `extraction.fuzzy_anchor_min_ratio`).
 *
 * A live model is asked for Unicode code-point offsets AND the quoted text. Models get the text right and
 * the arithmetic wrong far more often than the reverse, so before verification we locate each quote in
 * the NFC manuscript and rewrite the offsets to where the quote actually is. Nothing is invented: a
 * quote that does not occur in the text is left as the model gave it and fails verification exactly as
 * before, which makes the extractor regenerate. This is anchoring, not repair of the claim.
 *
 * The same idea normalizes scene drafts: paragraph boundaries are recomputed from the prose (the only
 * source of truth for them), and annotations whose spans fall outside the text are dropped rather than
 * failing the draft.
 */
import {
  codePointLength,
  segmentParagraphs,
  sliceCodePoints,
  toNfcText,
  utf16IndexToCodePoint,
  type NfcText,
} from '@yeonjae/prose';

export interface SpanLike {
  start: number;
  end: number;
  quote?: string | undefined;
}

/** Find `quote` in `text` (exact, then whitespace-insensitive). Returns code-point offsets or undefined. */
export function locateQuote(
  text: NfcText,
  quote: string,
  near?: number,
): { start: number; end: number; quote: string } | undefined {
  const q = toNfcText(quote).text;
  if (q.trim().length === 0) return undefined;
  const hay = text.text;
  const candidates: number[] = [];
  let idx = hay.indexOf(q);
  while (idx >= 0) {
    candidates.push(idx);
    idx = hay.indexOf(q, idx + 1);
  }
  if (candidates.length > 0) {
    const pick =
      near === undefined
        ? candidates[0]
        : candidates.reduce((best, c) =>
            Math.abs(utf16IndexToCodePoint(hay, c) - near) <
            Math.abs(utf16IndexToCodePoint(hay, best) - near)
              ? c
              : best,
          );
    if (pick === undefined) return undefined;
    const start = utf16IndexToCodePoint(hay, pick);
    return { start, end: start + codePointLength(q), quote: q };
  }
  // Whitespace-insensitive: collapse runs of whitespace on both sides and map the match back.
  const norm = q.replace(/\s+/g, ' ').trim();
  if (norm.length < 8) return undefined;
  const re = new RegExp(norm.split(' ').map(escapeRegExp).join('\\s+'));
  const m = re.exec(hay);
  if (!m) return undefined;
  const start = utf16IndexToCodePoint(hay, m.index);
  const matched = m[0];
  return { start, end: start + codePointLength(matched), quote: matched };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Rewrite one span so that `text[start:end] === quote` when the quote can be located. */
export function anchorSpan<T extends SpanLike>(text: NfcText, span: T): T {
  if (!span.quote) return span;
  const total = codePointLength(text.text);
  const inRange = span.start >= 0 && span.end <= total && span.start < span.end;
  if (inRange && sliceCodePoints(text, span.start, span.end) === toNfcText(span.quote).text)
    return span;
  const found = locateQuote(text, span.quote, span.start);
  return found ? { ...span, start: found.start, end: found.end, quote: found.quote } : span;
}

/** Anchor every `evidence[]` entry in a delta-like list of items (mutating copies, not the input). */
export function anchorEvidence<
  I extends { evidence: readonly (SpanLike & { manuscript_version_id: string })[] },
>(text: NfcText, versionId: string, items: readonly I[]): I[] {
  return items.map((item) => ({
    ...item,
    evidence: item.evidence.map((ev) =>
      ev.manuscript_version_id === versionId ? anchorSpan(text, ev) : ev,
    ),
  }));
}

interface DraftLike {
  text: string;
  paragraphs?: {
    id: string;
    start: number;
    end: number;
    kind?: string;
    stylistic_repeat?: boolean;
  }[];
  speaker_annotations?: { utterance_start: number; utterance_end: number; [k: string]: unknown }[];
  claims?: { statement: string; paragraph_id: string; [k: string]: unknown }[];
  system_blocks?: { paragraph_id: string; kind: string }[];
  language?: string;
  [k: string]: unknown;
}

const PARAGRAPH_KINDS = new Set(['narration', 'dialogue', 'monologue', 'system_block', 'mixed']);

/**
 * Normalize a scene draft from a live model: prose is NFC and stripped of markdown emphasis, paragraph
 * boundaries are recomputed from the prose, and dependent annotations are re-anchored or dropped.
 */
export function normalizeSceneDraft<T extends DraftLike>(raw: T): T {
  if (typeof raw.text !== 'string') return raw;
  const cleaned = raw.text
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*#{1,6}\s+.*$/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const nfc = toNfcText(cleaned);
  const segments = segmentParagraphs(nfc);
  const total = codePointLength(nfc.text);
  const modelKinds = raw.paragraphs ?? [];
  const paragraphs = segments.map((p, i) => {
    const guess =
      modelKinds.length === segments.length ? modelKinds[i]?.kind : kindOfParagraph(p.text);
    const kind = guess && PARAGRAPH_KINDS.has(guess) ? guess : kindOfParagraph(p.text);
    return { id: p.id, start: p.start, end: p.end, kind };
  });
  const ids = new Set(paragraphs.map((p) => p.id));
  const speaker = (raw.speaker_annotations ?? [])
    .map((s) => {
      const quote = typeof s.quote === 'string' ? s.quote : undefined;
      const { quote: _q, ...rest } = s;
      const anchored = quote
        ? anchorSpan(nfc, { start: s.utterance_start, end: s.utterance_end, quote })
        : { start: s.utterance_start, end: s.utterance_end };
      return { ...rest, utterance_start: anchored.start, utterance_end: anchored.end };
    })
    .filter(
      (s) =>
        Number.isInteger(s.utterance_start) &&
        Number.isInteger(s.utterance_end) &&
        s.utterance_start >= 0 &&
        s.utterance_start < s.utterance_end &&
        s.utterance_end <= total,
    );
  const claims = (raw.claims ?? [])
    .filter((c) => typeof c.statement === 'string' && c.statement.trim().length > 0)
    .map((c) => (ids.has(c.paragraph_id) ? c : { ...c, paragraph_id: paragraphs[0]?.id ?? 'p1' }));
  const systemBlocks = (raw.system_blocks ?? []).filter((b) => ids.has(b.paragraph_id));
  // Live models write their notes as a list; the schema holds one string.
  const notes = Array.isArray(raw.writer_notes)
    ? raw.writer_notes.filter((n): n is string => typeof n === 'string').join('\n')
    : raw.writer_notes;
  const { writer_notes: _notes, ...rest } = raw;
  return {
    ...(rest as T),
    ...(typeof notes === 'string' && notes.trim() ? { writer_notes: notes } : {}),
    language: raw.language ?? 'en',
    text: nfc.text,
    paragraphs,
    speaker_annotations: speaker,
    claims,
    ...(raw.system_blocks ? { system_blocks: systemBlocks } : {}),
  };
}

function kindOfParagraph(text: string): string {
  const t = text.trim();
  const quoted = /^[“"']/.test(t) || /[”"']\s*$/.test(t);
  const hasQuote = /[“”"]/.test(t);
  if (quoted && hasQuote) return 'dialogue';
  if (hasQuote) return 'mixed';
  if (/^[*_].*[*_]$/.test(t) || /^\[.*\]$/.test(t)) return 'monologue';
  return 'narration';
}
