/**
 * Deterministic Korean-webnovel prose lint (ADR-0056).
 *
 * The prose judge used to receive one line ("output-language check: confidence …; length …"). This lint
 * measures what the Korean-webnovel style guide asks for and what Western/AI drift looks like in Korean:
 * paragraph length and rhythm, narration runs without dialogue or inner voice, pronoun-led sentences,
 * 번역투 patterns and Western-novel stock phrases. It never gates on its own; its report is evidence the
 * judge cites, so a finding the judge disagrees with costs nothing.
 */

export interface KoLintFinding {
  readonly id: string;
  readonly label: string;
  readonly count: number;
  readonly examples: readonly string[];
}

export interface KoLintReport {
  readonly paragraphs: number;
  readonly medianParagraphChars: number;
  readonly longParagraphs: readonly string[];
  readonly dialogueRatio: number;
  readonly innerVoiceRatio: number;
  readonly maxNarrationRun: number;
  readonly pronounLedSentences: number;
  readonly findings: readonly KoLintFinding[];
}

interface Pattern {
  readonly id: string;
  readonly label: string;
  readonly re: RegExp;
  /** Occurrences per chapter tolerated before the pattern is reported. */
  readonly allow: number;
}

const PATTERNS: readonly Pattern[] = [
  { id: 'TRN-KO-01', label: '‘~에 대해/대한’ 번역투', re: /에 대(?:해서?|한)/g, allow: 2 },
  { id: 'TRN-KO-03', label: '‘~를 통해’ 번역투', re: /[을를] 통(?:해|하여)/g, allow: 1 },
  { id: 'TRN-KO-04', label: '‘~에 있어(서)’ 번역투', re: /에 있어(?:서)?/g, allow: 0 },
  { id: 'TRN-KO-05', label: '이중 피동', re: /(?:되어지|되어져|지어지|잊혀지|보여지)/g, allow: 0 },
  { id: 'TRN-KO-06', label: '‘~를 가지고 있다’ 번역투', re: /[을를] 가지고 있/g, allow: 0 },
  { id: 'TRN-KO-07', label: '‘~하는 중이다’ 번역투', re: /하는 중이(?:다|었다)/g, allow: 1 },
  { id: 'KO-STYLE-01', label: '‘~것이었다’ 반복', re: /것이었다/g, allow: 2 },
  { id: 'KO-STYLE-02', label: '‘마치 ~처럼/듯’ 비유 남발', re: /마치 /g, allow: 3 },
  {
    id: 'KO-SLOP-01',
    label: '서구 소설식 상투구',
    re: /(?:공기가 무거워|시간이 멈춘 듯|형언할 수 없|운명의 수레바퀴|침묵이 내려앉|정적이 흘렀|심연|폭풍전야|의 무게가)/g,
    allow: 0,
  },
  {
    id: 'KO-SLOP-02',
    label: '회차·장면 끝 내레이터 예고',
    re: /(?:아무도 알지 못했다|아직 몰랐다|기다리고 있을 줄은|그것이 시작이었다)/g,
    allow: 0,
  },
];

const PRONOUN_LEAD = /(?:^|[.!?…]\s+)(?:그는|그녀는|그가|그녀가|그의|그녀의)\s/g;

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

const isDialogue = (p: string) => /^[“"「]/.test(p);
const isInner = (p: string) => /^[‘']/.test(p);
const isSystem = (p: string) => p.startsWith('[');

/** Unicode code points (Hangul is BMP, but the length model counts code points everywhere). */
function cpLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function koreanProseLint(text: string): KoLintReport {
  const paras = paragraphsOf(text);
  const lengths = paras.map(cpLen).sort((a, b) => a - b);
  const median = lengths.length ? (lengths[Math.floor(lengths.length / 2)] ?? 0) : 0;
  const total = cpLen(text.replace(/\s+/g, '')) || 1;
  const quoted = (re: RegExp) =>
    [...text.matchAll(re)].reduce((a, m) => a + cpLen(m[0].replace(/\s+/g, '')), 0);
  const long = paras
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => cpLen(p) > 120 || (p.match(/[.!?](?:\s|$)/g)?.length ?? 0) > 3)
    .map(({ p, i }) => `p${i + 1}: ${p.slice(0, 40)}…`);
  let run = 0;
  let maxRun = 0;
  for (const p of paras) {
    run = isDialogue(p) || isInner(p) || isSystem(p) ? 0 : run + 1;
    maxRun = Math.max(maxRun, run);
  }
  const findings: KoLintFinding[] = [];
  for (const pat of PATTERNS) {
    const hits = [...text.matchAll(pat.re)];
    if (hits.length > pat.allow)
      findings.push({
        id: pat.id,
        label: pat.label,
        count: hits.length,
        examples: hits.slice(0, 3).map((m) => {
          const at = m.index;
          return text.slice(Math.max(0, at - 12), at + m[0].length + 12).replace(/\s+/g, ' ');
        }),
      });
  }
  return {
    paragraphs: paras.length,
    medianParagraphChars: median,
    longParagraphs: long,
    dialogueRatio: Math.round((quoted(/“[^”]*”/g) / total) * 100) / 100,
    innerVoiceRatio: Math.round((quoted(/‘[^’]*’/g) / total) * 100) / 100,
    maxNarrationRun: maxRun,
    pronounLedSentences: [...text.matchAll(PRONOUN_LEAD)].length,
    findings,
  };
}

/** The report as the Korean evidence block the prose judge and reviser read. */
export function renderKoLint(r: KoLintReport): string {
  const lines = [
    `문단 ${r.paragraphs}개, 문단 길이 중앙값 ${r.medianParagraphChars}자 (권장: 150~220개, 중앙값 20~45자).`,
    `대사 비중 ${Math.round(r.dialogueRatio * 100)}%, 속마음 비중 ${Math.round(r.innerVoiceRatio * 100)}%, 대사·속마음 없는 서술 최장 연속 ${r.maxNarrationRun}문단 (권장: 5 이하).`,
    `‘그는/그녀는’으로 시작하는 문장 ${r.pronounLedSentences}개 (권장: 3 이하).`,
  ];
  if (r.longParagraphs.length)
    lines.push(
      `긴 문단(120자 초과 또는 네 문장 이상) ${r.longParagraphs.length}개: ${r.longParagraphs.slice(0, 6).join(' / ')}`,
    );
  for (const f of r.findings)
    lines.push(`${f.id} ${f.label} ${f.count}회: ${f.examples.map((e) => `“${e}”`).join(', ')}`);
  if (!r.longParagraphs.length && !r.findings.length) lines.push('번역투·상투구 적중 없음.');
  return lines.join('\n');
}
