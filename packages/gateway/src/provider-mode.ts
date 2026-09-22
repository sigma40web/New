/**
 * Provider mode: how a process decides which model provider its gateway calls.
 *
 * There is no default that reaches a paid provider. `YEONJAE_PROVIDER_MODE` must be one of:
 *   * `replay`   — recorded fixture responses (tests, CLI demos); needs `YEONJAE_REPLAY_FILE`.
 *   * `genspark` — the local Genspark bridge (`tools/genspark_provider_bridge.py`).
 *   * `live`     — an OpenAI-compatible or Anthropic API keyed by `YEONJAE_LIVE_*` (see live-config.ts).
 *   * `simulated` — a deterministic role-scripted stand-in supplied by the caller (`@yeonjae/workflows`
 *     ships one); no network, no spend, no prose quality claim. For local dry runs of the whole loop.
 *
 * Shared by the worker and the API so both processes resolve the same providers and routing from the
 * same variables; the enforcement wrapper (budget, admission, audit) stays with the caller.
 */
import { readFileSync } from 'node:fs';
import { type RouteEntry, type RoutingTable } from './gateway.js';
import { DEFAULT_GENSPARK_BRIDGE_URL, GensparkProvider } from './genspark-provider.js';
import { liveGatewayFromEnv } from './live-config.js';
import { ReplayProvider, type Recording } from './replay-provider.js';
import { type Provider } from './types.js';

export type ProviderMode = 'replay' | 'genspark' | 'live' | 'simulated';

export function providerModeFromEnv(env: NodeJS.ProcessEnv = process.env): ProviderMode {
  const mode = env.YEONJAE_PROVIDER_MODE;
  if (mode === 'replay') return 'replay';
  if (mode === 'genspark') return 'genspark';
  if (mode === 'live') return 'live';
  if (mode === 'simulated') return 'simulated';
  throw new Error(
    "YEONJAE_PROVIDER_MODE must be set to 'replay', 'genspark', 'live' or 'simulated'; the process refuses to start without an explicit " +
      'provider mode so a misconfigured deployment cannot issue paid calls',
  );
}

/** Optional variant: undefined when the variable is absent, so a process can report "not configured". */
export function providerModeIfSet(env: NodeJS.ProcessEnv = process.env): ProviderMode | undefined {
  return env.YEONJAE_PROVIDER_MODE ? providerModeFromEnv(env) : undefined;
}

function replayRoute(modelId: string, family: string) {
  return [
    {
      modelId,
      provider: 'replay',
      priority: 1,
      family,
      priceInPerMTokCents: 100,
      priceOutPerMTokCents: 400,
      maxContextTokens: 200_000,
      supportsJsonSchema: true,
    },
  ];
}

export function replayRouting(): RoutingTable {
  return {
    R: replayRoute('replay-r', 'alpha'),
    P: replayRoute('replay-p', 'alpha'),
    M: replayRoute('replay-m', 'beta'),
    C: replayRoute('replay-c', 'beta'),
    E: [],
  };
}

export function gensparkRouting(env: NodeJS.ProcessEnv = process.env): RoutingTable {
  const route = (modelId: string, family: string) => [
    {
      modelId,
      provider: 'genspark',
      priority: 1,
      family,
      priceInPerMTokCents: 0,
      priceOutPerMTokCents: 0,
      maxContextTokens: 128_000,
      supportsJsonSchema: true,
    },
  ];
  const r = env.YEONJAE_MODEL_R ?? 'claude-opus-4-7';
  const rest = env.YEONJAE_MODEL_DEFAULT ?? 'gemini-3.8-flash';
  return {
    R: route(r, 'anthropic'),
    P: route(env.YEONJAE_MODEL_P ?? rest, 'google'),
    M: route(env.YEONJAE_MODEL_M ?? rest, 'google'),
    C: route(env.YEONJAE_MODEL_C ?? rest, 'google'),
    E: [],
  };
}

export interface ResolvedProviders {
  readonly mode: ProviderMode;
  /** A fresh provider map per gateway; replay providers are stateful (misses/served), so a factory. */
  readonly providers: () => Map<string, Provider>;
  readonly routing: RoutingTable;
  /** Per-role model overrides (`YEONJAE_ROLE_MODELS`, genspark mode). */
  readonly roleRoutes?: Readonly<Record<string, readonly RouteEntry[]>> | undefined;
}

/**
 * `YEONJAE_ROLE_MODELS="arc_planner=gemini-3.8-flash,chapter_planner=gemini-3.8-flash"` routes those roles to
 * the named model on the genspark bridge regardless of their class. Unknown syntax is a startup error.
 */
export function gensparkRoleRoutes(
  env: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, readonly RouteEntry[]>> | undefined {
  const raw = env.YEONJAE_ROLE_MODELS?.trim();
  if (!raw) return undefined;
  const out: Record<string, RouteEntry[]> = {};
  for (const pair of raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)) {
    const m = /^([a-z_]+)=([A-Za-z0-9._:-]+)$/.exec(pair);
    if (!m?.[1] || !m[2])
      throw new Error(`YEONJAE_ROLE_MODELS entry must look like role=model, got "${pair}"`);
    out[m[1]] = [
      {
        modelId: m[2],
        provider: 'genspark',
        priority: 1,
        family: m[2].split('-')[0] ?? 'genspark',
        priceInPerMTokCents: 0,
        priceOutPerMTokCents: 0,
        maxContextTokens: 128_000,
        supportsJsonSchema: true,
      },
    ];
  }
  return out;
}

/** Resolve providers and routing from the environment, validating the mode's configuration once. */
export function resolveProvidersFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  opts: { readonly simulated?: (() => Provider) | undefined } = {},
): ResolvedProviders {
  const mode = providerModeFromEnv(env);
  if (mode === 'simulated') {
    const make = opts.simulated;
    if (!make)
      throw new Error(
        'YEONJAE_PROVIDER_MODE=simulated needs a simulated provider, which this process does not supply',
      );
    const routing = replayRouting();
    const rename = (rs: readonly RouteEntry[]) => rs.map((r) => ({ ...r, provider: 'simulated' }));
    return {
      mode,
      providers: () => new Map<string, Provider>([['simulated', make()]]),
      routing: {
        R: rename(routing.R),
        P: rename(routing.P),
        M: rename(routing.M),
        C: rename(routing.C),
        E: [],
      },
    };
  }
  if (mode === 'live') {
    const live = liveGatewayFromEnv(env);
    return { mode, providers: () => live.providers, routing: live.routing };
  }
  if (mode === 'genspark') {
    return {
      mode,
      providers: () =>
        new Map<string, Provider>([
          [
            'genspark',
            new GensparkProvider({
              baseUrl: env.YEONJAE_GENSPARK_URL ?? DEFAULT_GENSPARK_BRIDGE_URL,
              // An explicitly configured bridge URL (e.g. a tunnel to the operator's bridge host) is
              // deliberate operator config; the default stays loopback-only.
              ...(env.YEONJAE_GENSPARK_URL ? { allowNonLoopback: true } : {}),
              // Big bible-stage calls can run many minutes on a long-timeout bridge.
              ...(env.YEONJAE_GENSPARK_TIMEOUT_MS
                ? { timeoutMs: Number(env.YEONJAE_GENSPARK_TIMEOUT_MS) }
                : {}),
              ...(env.YEONJAE_GENSPARK_TOKEN
                ? { headers: { authorization: `Bearer ${env.YEONJAE_GENSPARK_TOKEN}` } }
                : {}),
            }),
          ],
        ]),
      routing: gensparkRouting(env),
      roleRoutes: gensparkRoleRoutes(env),
    };
  }
  const replayFile = env.YEONJAE_REPLAY_FILE;
  if (!replayFile)
    throw new Error('YEONJAE_REPLAY_FILE must name a recording when YEONJAE_PROVIDER_MODE=replay');
  const recording = JSON.parse(readFileSync(replayFile, 'utf8')) as Record<string, Recording>;
  return {
    mode,
    providers: () => new Map<string, Provider>([['replay', new ReplayProvider(recording)]]),
    routing: replayRouting(),
  };
}
