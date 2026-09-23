import { describe, expect, it } from 'vitest';
import { contentHash, PromptRegistry, PromptRegistryError, renderPrompt } from './registry.js';

const REQUIRED_FAMILIES = [
  'requirement_interpreter',
  'assumption_explainer',
  'concept_generator',
  'concept_comparator',
  'chapter_comparator',
  'character_designer',
  'world_builder',
  'power_system_designer',
  'story_architect',
  'arc_planner',
  'chapter_planner',
  'scene_planner',
  'scene_writer',
  'chapter_assembler',
  'contract_checker',
  'continuity_checker',
  'knowledge_leak_checker',
  'prose_judge',
  'structure_judge',
  'genre_judge',
  'voice_judge',
  'targeted_reviser',
  'canon_extractor',
  'extraction_reconciler',
  'factual_summarizer',
  'pacing_designer',
];
const TOTAL_PROMPT_VERSIONS = 273;
/** The active default set (latest `active` version of every family). */
const ACTIVE_MAJOR = /@3\.\d+\.\d+$/;

describe('prompt registry (ADR-0016)', () => {
  const reg = PromptRegistry.fromDirectory();

  it('loads all production families with verified immutable content hashes', () => {
    expect(reg.families()).toEqual([...REQUIRED_FAMILIES].sort());
    expect(reg.list()).toHaveLength(TOTAL_PROMPT_VERSIONS);
    for (const v of reg.list()) {
      expect(v.status).toBe('active');
      expect(v.content_hash).toBe(contentHash(v, v.system_template, v.user_template));
      expect(v.changelog.length).toBeGreaterThan(10);
      expect(v.regression_cases.length).toBeGreaterThan(0);
    }
  });

  it('style-sensitive prompts embed the identity block and name a variant; manuscript prompts are style-sensitive', () => {
    for (const v of reg.list()) {
      if (v.style_sensitive) {
        expect(v.identity_variant, v.id).not.toBeNull();
        expect(v.system_template, v.id).toContain('{{narrative_identity_block}}');
      }
      if (v.manuscript_producing) expect(v.style_sensitive, v.id).toBe(true);
    }
    expect(reg.get('scene_writer@1.0.0')).toMatchObject({
      manuscript_producing: true,
      identity_variant: 'writer_full',
      model_class: 'P',
    });
    expect(reg.get('prose_judge@1.0.0').identity_variant).toBe('judge_rubric_prose');
    expect(reg.get('structure_judge@1.0.0').identity_variant).toBe('judge_rubric_structure');
    expect(reg.get('canon_extractor@1.0.0').style_sensitive).toBe(false);
  });

  it('Korean v2 prompts are authored in Korean; no prompt asks for a translation step (ADR-0054, NO-TRANSLATION-001)', () => {
    for (const v of reg.list()) {
      const text = `${v.system_template}\n${v.user_template}`;
      expect(text, v.id).not.toMatch(/translate (it|this|the text) into English/i);
      const hasHangul = /[\uac00-\ud7a3]/.test(text);
      if (!v.version.startsWith('1.')) {
        expect(hasHangul, `${v.id} Korean version must be authored in Korean`).toBe(true);
      } else {
        expect(hasHangul, `${v.id} legacy version contains Hangul`).toBe(false);
      }
    }
  });

  it('rejects a version whose recorded hash does not match its content (immutability)', () => {
    const v = reg.get('scene_writer@1.0.0');
    const r2 = new PromptRegistry();
    expect(() =>
      r2.add(
        { ...v, version: '1.0.1', content_hash: v.content_hash },
        v.system_template + ' edited',
        v.user_template,
      ),
    ).toThrow(PromptRegistryError);
    expect(() =>
      r2.add(
        { ...v, version: '1.0.1', content_hash: v.content_hash },
        v.system_template + ' edited',
        v.user_template,
      ),
    ).toThrow(/HASH_MISMATCH/);
  });

  it('rejects undeclared template variables and style-sensitive prompts without the block', () => {
    const base = reg.get('assumption_explainer@1.0.0');
    const r2 = new PromptRegistry();
    expect(() =>
      r2.add(
        { ...base, version: '2.0.0', content_hash: undefined },
        'hello {{unknown_var}}',
        base.user_template,
      ),
    ).toThrow(/UNKNOWN_VARIABLE/);
    expect(() =>
      r2.add(
        {
          ...base,
          version: '2.0.0',
          content_hash: undefined,
          style_sensitive: true,
          identity_variant: 'planner_compact',
        },
        'no block here',
        base.user_template,
      ),
    ).toThrow(/MISSING_VARIABLE/);
    expect(() =>
      r2.add(
        {
          ...base,
          version: '2.0.0',
          content_hash: undefined,
          style_sensitive: true,
          identity_variant: null,
        },
        base.system_template,
        base.user_template,
      ),
    ).toThrow(/IDENTITY_VARIANT_REQUIRED/);
  });

  it('renders with all declared variables and refuses missing ones', () => {
    const v = reg.get('assumption_explainer@1.0.0');
    const r = renderPrompt(v, { assumptions_json: '[{"assumption_id":"a1"}]' });
    expect(r.user).toContain('"assumption_id":"a1"');
    expect(r.promptHash).toBe(v.content_hash);
    expect(() => renderPrompt(v, {})).toThrow(/MISSING_VARIABLE/);
    const w = reg.get('scene_writer@1.0.0');
    expect(() =>
      renderPrompt(w, Object.fromEntries(w.input_variables.map((x) => [x, 'x']))),
    ).toThrow(/narrative_identity_block/);
  });

  it('v3 prompts are Korean end to end: no English section labels or instructions (ADR-0055)', () => {
    const provenanceTags = new Set(['FACT', 'PLANNED', 'SUMMARY', 'EVIDENCE', 'UNTRUSTED']);
    for (const v of reg.list().filter((x) => x.version.startsWith('3.'))) {
      const text = `${v.system_template}\n${v.user_template}`;
      for (const m of text.matchAll(/\[([A-Z][A-Z ]{2,})/g)) {
        const label = (m[1] ?? '').trim();
        expect(provenanceTags.has(label), `${v.id} has English label [${label}`).toBe(true);
      }
      // Single-brace placeholders never substitute; they reached the model verbatim in v2.x.
      expect(text, v.id).not.toMatch(/(?<!\{)\{[a-z_]+\}(?!\})/);
      // Instruction prose outside the JSON shape must not contain English sentences.
      const prose = text
        .split('\n')
        .filter((l) => !l.trim().startsWith('{') && !l.includes('{{'))
        .join('\n');
      expect(prose, v.id).not.toMatch(/\b(the|and|must|never|return|write)\b [a-z]+ [a-z]+/i);
    }
  });

  it('builds a pinned prompt set from the active versions', () => {
    const set = reg.activeSet();
    expect(Object.keys(set.mapping)).toHaveLength(26);
    expect(set.mapping.pacing_designer).toBe('pacing_designer@3.2.0');
    expect(set.mapping.scene_writer).toBe('scene_writer@3.1.0');
    for (const fam of Object.keys(set.mapping)) {
      expect(set.mapping[fam], fam).toMatch(ACTIVE_MAJOR);
    }
    expect(set.id).toMatch(/^set:[0-9a-f]{16}$/);
  });

  it('pins the full-bible contracts in the revised planning prompts', () => {
    expect(reg.get('character_designer@1.1.0').system_template).toMatch(
      /every supplied character name is authoritative/i,
    );
    expect(reg.get('world_builder@1.1.0').system_template).toMatch(
      /at least one meaningful location/i,
    );
    expect(reg.get('power_system_designer@1.1.0').system_template).toMatch(/need not be magical/i);
    expect(reg.get('story_architect@1.1.0').system_template).toMatch(
      /contiguous, non-overlapping/i,
    );
    expect(reg.get('story_architect@1.1.0').system_template).toMatch(
      /target chapter count through the committed ending/i,
    );
    expect(reg.get('arc_planner@1.1.0').system_template).toMatch(
      /complete supplied planned bible/i,
    );
    expect(reg.get('chapter_planner@1.1.0').system_template).toMatch(/complete \[PLANNED\] bible/i);
    for (const family of ['story_architect', 'arc_planner', 'chapter_planner']) {
      expect(reg.get(`${family}@1.1.0`).system_template).toContain('[PLANNED]');
    }
  });
});
