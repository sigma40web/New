import { describe, expect, it } from 'vitest';
import {
  gensparkRoleRoutes,
  gensparkRouting,
  notionRouting,
  resolveProvidersFromEnv,
} from './provider-mode.js';

describe('genspark per-role routes', () => {
  it('parses YEONJAE_ROLE_MODELS into genspark routes', () => {
    const routes = gensparkRoleRoutes({
      YEONJAE_ROLE_MODELS: 'arc_planner=gemini-3.8-flash, chapter_planner=gemini-3.8-flash',
    });
    expect(Object.keys(routes ?? {})).toEqual(['arc_planner', 'chapter_planner']);
    expect(routes?.chapter_planner?.[0]).toMatchObject({
      modelId: 'gemini-3.8-flash',
      provider: 'genspark',
    });
    expect(gensparkRoleRoutes({})).toBeUndefined();
  });

  it('refuses a malformed entry at startup', () => {
    expect(() => gensparkRoleRoutes({ YEONJAE_ROLE_MODELS: 'chapter_planner' })).toThrow(
      /role=model/,
    );
  });

  it('is part of the resolved genspark configuration', () => {
    const resolved = resolveProvidersFromEnv({
      YEONJAE_PROVIDER_MODE: 'genspark',
      YEONJAE_ROLE_MODELS: 'arc_planner=gemini-3.8-flash',
    });
    expect(resolved.roleRoutes?.arc_planner?.[0]?.modelId).toBe('gemini-3.8-flash');
  });

  it('retries the same model once, because the gateway retries only by moving to the next route', () => {
    const r = gensparkRouting({ YEONJAE_MODEL_R: 'claude-opus-4-6' }).R;
    expect(r.map((e) => [e.modelId, e.priority])).toEqual([
      ['claude-opus-4-6', 1],
      ['claude-opus-4-6', 2],
    ]);
    const role = gensparkRoleRoutes({ YEONJAE_ROLE_MODELS: 'chapter_planner=gemini-3.8-flash' });
    expect(role?.chapter_planner?.map((e) => e.modelId)).toEqual([
      'gemini-3.8-flash',
      'gemini-3.8-flash',
    ]);
  });
});

describe('notion bridge mode (ADR-0058)', () => {
  it('routes every class to the one bridge model, with the same-model retry', () => {
    const resolved = resolveProvidersFromEnv({
      YEONJAE_PROVIDER_MODE: 'notion',
      YEONJAE_NOTION_URL: 'https://bridge.example/notion/v1/complete',
      // Genspark model names must not leak into a bridge that does not serve them.
      YEONJAE_MODEL_R: 'claude-opus-4-6',
      YEONJAE_ROLE_MODELS: 'chapter_planner=gemini-3.8-flash',
    });
    expect(resolved.mode).toBe('notion');
    expect([...resolved.providers().keys()]).toEqual(['notion']);
    for (const cls of ['R', 'P', 'M', 'C'] as const)
      expect(resolved.routing[cls].map((e) => [e.modelId, e.provider])).toEqual([
        ['notion-ai', 'notion'],
        ['notion-ai', 'notion'],
      ]);
    expect(resolved.roleRoutes).toBeUndefined();
    expect(notionRouting({ YEONJAE_NOTION_MODEL: 'notion-x' }).R[0]?.modelId).toBe('notion-x');
  });

  it('refuses to start without a bridge URL', () => {
    expect(() => resolveProvidersFromEnv({ YEONJAE_PROVIDER_MODE: 'notion' })).toThrow(
      /YEONJAE_NOTION_URL/,
    );
  });
});
