import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validatorFor } from '@yeonjae/domain';
import { compactChapterMode, once, wholeChapterScene } from './compact-mode.js';
import { type ChapterContract } from './planning.js';

const CONTRACT = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../examples/fixture/chapter-contract.ch12.json', import.meta.url)),
    'utf8',
  ),
) as ChapterContract;

describe('compact chapter mode (ADR-0059)', () => {
  it('is an explicit operator choice', () => {
    expect(compactChapterMode({ YEONJAE_CHAPTER_MODE: 'compact' })).toBe(true);
    expect(compactChapterMode({})).toBe(false);
    expect(compactChapterMode({ YEONJAE_CHAPTER_MODE: 'standard' })).toBe(false);
  });

  it('derives one schema-valid whole-chapter scene from the contract', () => {
    const scene = wholeChapterScene(CONTRACT, 'ko');
    expect(scene).toBeDefined();
    const v = validatorFor('scene-plan.schema.json')(scene);
    expect(v.ok ? [] : v.errors).toEqual([]);
    expect(scene?.length_target).toEqual(CONTRACT.length_target);
    expect(scene?.pov.character_id).toBe(CONTRACT.pov.character_id);
    // Opening first, every required event in between, the hook last.
    expect(scene?.beats[0]?.description).toContain(CONTRACT.opening.description);
    for (const m of CONTRACT.must_happen)
      expect(scene?.beats.some((b) => b.description.includes(m.id))).toBe(true);
    expect(scene?.beats.at(-1)?.type).toBe('cliffhanger');
    expect(scene?.must_not).toEqual(CONTRACT.must_not_happen.map((m) => m.description));
  });

  it('falls back to the scene planner when the contract names no location', () => {
    expect(wholeChapterScene({ ...CONTRACT, locations: [] }, 'en')).toBeUndefined();
  });

  it('starts a call once and shares its result', async () => {
    let calls = 0;
    const c = once(() => Promise.resolve(++calls));
    await Promise.all([c(), c()]);
    expect(await c()).toBe(1);
    expect(calls).toBe(1);
  });
});
