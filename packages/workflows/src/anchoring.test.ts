import { describe, expect, it } from 'vitest';
import { normalizeSceneDraft } from './anchoring.js';

describe('scene draft normalization', () => {
  it('joins list-shaped writer notes into the schema string (recorded live output)', () => {
    const out = normalizeSceneDraft({
      text: '이름이 불렸다.\n\n‘……내 이름이 아닌데.’',
      writer_notes: ['속마음으로만 처리했다.', '히로인은 실루엣만 스친다.', 3],
    });
    expect(out.writer_notes).toBe('속마음으로만 처리했다.\n히로인은 실루엣만 스친다.');
    expect(out.paragraphs).toHaveLength(2);
  });

  it('keeps a string note and drops an unreadable one', () => {
    expect(normalizeSceneDraft({ text: '문장.', writer_notes: '메모' }).writer_notes).toBe('메모');
    expect('writer_notes' in normalizeSceneDraft({ text: '문장.', writer_notes: [] })).toBe(false);
  });
});
