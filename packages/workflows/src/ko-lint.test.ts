import { describe, expect, it } from 'vitest';
import { koreanProseLint, renderKoLint } from './ko-lint.js';

const WEBNOVEL = [
  '“이름.”',
  '감독관은 명부에서 눈도 떼지 않았다.',
  '“……없습니다.”',
  '펜 끝이 멈췄다.',
  '‘그래. 그 반응일 줄 알았다.’',
  '[돌발 퀘스트가 생성되었습니다.]',
  '……하필 지금?',
].join('\n\n');

const WESTERN = [
  '그는 창밖을 바라보았다. 그는 자신의 운명에 대해 생각하고 있었다. 마치 오래된 그림처럼 마을은 고요했고, 마치 시간이 멈춘 듯했다. 공기가 무거워졌다. 그것은 형언할 수 없는 감정이었다.',
  '그녀는 그의 손을 통해 온기를 느꼈다. 그녀는 그 사실을 알고 있는 중이었다. 그들은 서로에 대해 많은 것을 가지고 있었다.',
  '그날 밤, 그는 알지 못했다. 그것이 시작이었다는 것을. 그들을 기다리고 있을 줄은 아무도 알지 못했다.',
].join('\n\n');

describe('Korean-webnovel prose lint (ADR-0056)', () => {
  it('finds nothing to report in short-paragraph webnovel prose', () => {
    const r = koreanProseLint(WEBNOVEL);
    expect(r.paragraphs).toBe(7);
    expect(r.longParagraphs).toEqual([]);
    expect(r.findings).toEqual([]);
    expect(r.maxNarrationRun).toBeLessThanOrEqual(2);
    expect(renderKoLint(r)).toContain('번역투·상투구 적중 없음');
  });

  it('flags long paragraphs, pronoun-led sentences, translationese and Western stock phrases', () => {
    const r = koreanProseLint(WESTERN);
    expect(r.longParagraphs.length).toBeGreaterThanOrEqual(1);
    expect(r.pronounLedSentences).toBeGreaterThanOrEqual(4);
    const ids = r.findings.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['KO-SLOP-01', 'KO-SLOP-02', 'TRN-KO-06']));
    const text = renderKoLint(r);
    expect(text).toContain('긴 문단');
    expect(text).toContain('서구 소설식 상투구');
  });
});
