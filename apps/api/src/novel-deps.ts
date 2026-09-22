/**
 * Model-facing dependencies for the API's novel surface, from the environment.
 *
 * The API only needs a gateway to run the SUGGESTION stage inline (a few R-class calls). Everything after
 * approval is queued for a runner. When `YEONJAE_NOVEL_RUNNER=inline` the API also hosts a runner in the
 * same process, so a single `pnpm --filter @yeonjae/api start` is a complete studio for one operator;
 * `external` (the default in multi-process deployments) leaves production to `@yeonjae/worker`.
 *
 * The shared budget and admission ledgers (migration 0015) are used whenever they exist, so an API-hosted
 * runner spends against the same limits a worker would.
 */
import { PgAuditStore, PgProviderAdmission, SharedBudget, type Pool } from '@yeonjae/db';
import {
  Gateway,
  MemoryBudget,
  resolveProvidersFromEnv,
  type ResolvedProviders,
} from '@yeonjae/gateway';
import { type Metrics } from '@yeonjae/domain';
import { ArtifactLlmOutputStore, simulatedProvider, type NovelDeps } from '@yeonjae/workflows';

export type NovelRunnerMode = 'inline' | 'external';

export function novelRunnerModeFromEnv(env: NodeJS.ProcessEnv = process.env): NovelRunnerMode {
  const raw = env.YEONJAE_NOVEL_RUNNER ?? 'inline';
  if (raw === 'inline' || raw === 'external') return raw;
  throw new Error(`YEONJAE_NOVEL_RUNNER must be 'inline' or 'external'; got '${raw}'`);
}

/**
 * Returns a per-project factory, or undefined when no provider mode is configured. A missing mode is a
 * legitimate state for an API that only serves review screens; a MISCONFIGURED mode throws at startup.
 */
export function novelDepsFromEnv(
  pool: Pool,
  opts: { metrics: Metrics; shared: boolean; env?: NodeJS.ProcessEnv | undefined },
): ((input: { workspaceId: string; projectId: string }) => NovelDeps) | undefined {
  const env = opts.env ?? process.env;
  if (!env.YEONJAE_PROVIDER_MODE) return undefined;
  const resolved: ResolvedProviders = resolveProvidersFromEnv(env, {
    simulated: simulatedProvider,
  });
  const budgetCents = Number(env.YEONJAE_BUDGET_CENTS ?? '100000');
  const holder = `api:${env.YEONJAE_WORKER_ID ?? String(process.pid)}`;
  const maxWaitMs = Number(env.YEONJAE_RATE_MAX_WAIT_MS ?? '0');
  return ({ workspaceId, projectId }) => {
    const audit = new PgAuditStore(
      pool,
      { workspaceId, projectId },
      new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
    );
    return {
      pool,
      gateway: new Gateway({
        providers: resolved.providers(),
        routing: resolved.routing,
        roleRoutes: resolved.roleRoutes,
        budget: opts.shared ? new SharedBudget(pool) : new MemoryBudget(budgetCents),
        ...(opts.shared
          ? {
              admission: new PgProviderAdmission(pool, {
                holder,
                maxWaitMs,
                metrics: opts.metrics,
              }),
            }
          : {}),
        metrics: opts.metrics,
        audit,
      }),
    };
  };
}

/** True when migration 0015's shared enforcement functions exist. */
export async function sharedEnforcementAvailable(pool: Pool): Promise<boolean> {
  const r = await pool.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'canon' AND p.proname IN ('budget_reserve', 'budget_settle', 'rate_limit_admit')`,
  );
  return Number(r.rows[0]?.n ?? '0') >= 3;
}
