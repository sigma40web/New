/**
 * CLI surface for the novel lifecycle. Same functions the API calls; the CLI is the path that needs no
 * browser and no second process:
 *
 *   novel:start   <project> <intake.json> [--identity=<composed-ref>]   spec + suggestions
 *   novel:approve <project> <concept-id> [--one-chapter-at-a-time] [--stop-after=N]
 *   novel:run     <project> [--once]                                    drive the run to rest (or one step)
 *   novel:status  <project>
 *   novel:pause | novel:resume | novel:cancel <project>
 *
 * `novel:start` composes the project's Narrative Identity from the intake when none is pinned, so a project
 * created with `project:create` is usable without an extra step; `--identity` pins a repository profile.
 */
import { readFileSync } from 'node:fs';
import {
  addMember,
  createUser,
  createWorkspace,
  getNovelRun,
  getProject,
  listNovelRunEvents,
  PgAuditStore,
  PgProviderAdmission,
  SharedBudget,
  type Pool,
} from '@yeonjae/db';
import { uuidFromKey } from '@yeonjae/domain';
import { Gateway, MemoryBudget, resolveProvidersFromEnv } from '@yeonjae/gateway';
import {
  advanceNovelRun,
  approveConcept,
  ArtifactLlmOutputStore,
  cancelNovelRun,
  NovelRunner,
  pauseNovelRun,
  resumeNovelRun,
  simulatedProvider,
  startNovel,
  WorkflowError,
  type NovelDeps,
} from '@yeonjae/workflows';

export interface CliResult {
  ok: boolean;
  output: unknown;
}

function depsFor(pool: Pool): (input: { workspaceId: string; projectId: string }) => NovelDeps {
  const resolved = resolveProvidersFromEnv(process.env, { simulated: simulatedProvider });
  const shared = process.env.YEONJAE_ENFORCEMENT_MODE === 'shared';
  const budgetCents = Number(process.env.YEONJAE_BUDGET_CENTS ?? '100000');
  return ({ workspaceId, projectId }) => ({
    pool,
    gateway: new Gateway({
      providers: resolved.providers(),
      routing: resolved.routing,
      roleRoutes: resolved.roleRoutes,
      budget: shared ? new SharedBudget(pool) : new MemoryBudget(budgetCents),
      ...(shared
        ? { admission: new PgProviderAdmission(pool, { holder: `cli:${process.pid}` }) }
        : {}),
      audit: new PgAuditStore(
        pool,
        { workspaceId, projectId },
        new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
      ),
    }),
  });
}

/**
 * `--identity=<composed-ref>` pins a repository profile (e.g. the fixture's) instead of the intake-derived
 * one `startNovel` would compose. Without the flag, a project keeps whatever it pins or gets one composed.
 */
async function ensureIdentity(
  pool: Pool,
  projectId: string,
  ref: string | undefined,
): Promise<void> {
  if (ref === undefined) return;
  const versionId = FIXTURE_IDENTITY_VERSIONS[ref] ?? uuidFromKey(`${projectId}:identity:${ref}`);
  await pool.query(
    'UPDATE projects SET settings = settings || $2::jsonb, updated_at = now() WHERE id = $1',
    [
      projectId,
      JSON.stringify({ narrative_identity_ref: ref, narrative_identity_version_id: versionId }),
    ],
  );
}

const FIXTURE_IDENTITY_VERSIONS: Readonly<Record<string, string>> = {
  'project/0191b2a0-0000-7000-8000-000000000001@1': '0191b2a0-0000-7000-8000-000000060001',
};

function flag(flags: readonly string[], name: string): string | undefined {
  return flags.find((f) => f.startsWith(`--${name}=`))?.slice(name.length + 3);
}

export async function runNovelCommand(
  pool: Pool,
  cmd: string,
  rest: readonly string[],
  usage: string,
): Promise<CliResult> {
  if (cmd === 'user:create') {
    const [email, password, displayName, ...flags] = rest;
    if (!email || !password) return { ok: false, output: usage };
    if (password.length < 12)
      return { ok: false, output: { error: 'PASSWORD_TOO_SHORT', min: 12 } };
    const user = await createUser(pool, { email, displayName: displayName ?? email, password });
    const wsFlag = flag(flags, 'workspace');
    const role = (flag(flags, 'role') ?? 'owner') as 'owner' | 'editor' | 'viewer';
    if (!['owner', 'editor', 'viewer'].includes(role)) return { ok: false, output: usage };
    const workspaceId = wsFlag ?? (await createWorkspace(pool, `${displayName ?? email}'s studio`));
    await addMember(pool, { workspaceId, userId: user.id, role });
    return { ok: true, output: { user_id: user.id, workspace_id: workspaceId, role } };
  }
  if (cmd === 'member:add') {
    const [workspaceId, email, roleRaw] = rest;
    const role = (roleRaw ?? 'editor') as 'owner' | 'editor' | 'viewer';
    if (!workspaceId || !email || !['owner', 'editor', 'viewer'].includes(role))
      return { ok: false, output: usage };
    const user = await pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [
      email.trim().toLowerCase(),
    ]);
    const userId = user.rows[0]?.id;
    if (!userId) return { ok: false, output: { error: 'USER_NOT_FOUND' } };
    await addMember(pool, { workspaceId, userId, role });
    return { ok: true, output: { workspace_id: workspaceId, user_id: userId, role } };
  }
  const [projectId, ...args] = rest;
  if (!projectId) return { ok: false, output: usage };
  try {
    switch (cmd) {
      case 'novel:start': {
        const [file, ...flags] = args;
        if (!file) return { ok: false, output: usage };
        await ensureIdentity(pool, projectId, flag(flags, 'identity'));
        const project = await getProject(pool, projectId);
        const intake = JSON.parse(readFileSync(file, 'utf8')) as unknown;
        const make = depsFor(pool);
        const result = await startNovel(make({ workspaceId: project.workspace_id, projectId }), {
          projectId,
          intake,
        });
        return {
          ok: true,
          output: {
            run: result.run.status,
            spec_version: result.specVersion,
            suggestions: result.concepts.map((c) => ({
              id: c.id,
              angle: c.angle,
              logline: c.logline,
              story_promise: c.story_promise,
              chapter_one_hook: c.chapter_one_hook,
              ending_direction: c.ending_direction,
            })),
            next: `pnpm cli novel:approve ${projectId} <id>`,
          },
        };
      }
      case 'novel:approve': {
        const [conceptId, ...flags] = args;
        if (!conceptId) return { ok: false, output: usage };
        const stop = flag(flags, 'stop-after');
        const run = await approveConcept(pool, {
          projectId,
          conceptId,
          autoContinue: !flags.includes('--one-chapter-at-a-time'),
          stopAfterChapter: stop ? Number(stop) : undefined,
        });
        return {
          ok: true,
          output: { run: run.status, next: `pnpm cli novel:run ${projectId}` },
        };
      }
      case 'novel:run': {
        const project = await getProject(pool, projectId);
        const make = depsFor(pool);
        if (args.includes('--once')) {
          const run = await getNovelRun(pool, projectId);
          if (!run) return { ok: false, output: { error: 'NO_RUN' } };
          const outcome = await advanceNovelRun(
            make({ workspaceId: project.workspace_id, projectId }),
            run,
          );
          return {
            ok: true,
            output: {
              outcome: outcome.kind,
              run: outcome.run.status,
              next_chapter: outcome.run.next_chapter,
            },
          };
        }
        const runner = new NovelRunner({ pool, makeDeps: make, runnerId: `cli:${process.pid}` });
        // Drive until nothing is claimable: the run rests (completed, paused, needs_attention, failed).
        while (await runner.tick()) {
          /* keep claiming while work remains */
        }
        const run = await getNovelRun(pool, projectId);
        return { ok: run?.status !== 'failed', output: await statusView(pool, projectId) };
      }
      case 'novel:status':
        return { ok: true, output: await statusView(pool, projectId) };
      case 'novel:pause':
        return { ok: true, output: { run: (await pauseNovelRun(pool, projectId)).status } };
      case 'novel:resume': {
        const stop = flag(args, 'stop-after');
        const run = await resumeNovelRun(pool, {
          projectId,
          stopAfterChapter: stop ? Number(stop) : undefined,
        });
        return { ok: true, output: { run: run.status, next_chapter: run.next_chapter } };
      }
      case 'novel:cancel':
        return { ok: true, output: { run: (await cancelNovelRun(pool, projectId)).status } };
      default:
        return { ok: false, output: usage };
    }
  } catch (err) {
    if (err instanceof WorkflowError)
      return { ok: false, output: { error: err.code, detail: err.detail, step: err.options.step } };
    throw err;
  }
}

async function statusView(pool: Pool, projectId: string) {
  const run = await getNovelRun(pool, projectId);
  if (!run) return { error: 'NO_RUN', hint: 'pnpm cli novel:start <project> <intake.json>' };
  const chapters = await pool.query<{ number: number; status: string }>(
    'SELECT number, status FROM chapters WHERE project_id = $1 ORDER BY number',
    [projectId],
  );
  const events = await listNovelRunEvents(pool, run.id, 0, 500);
  return {
    status: run.status,
    spec_version: run.spec_version,
    approved_concept_id: run.approved_concept_id,
    target_chapters: run.target_chapters,
    next_chapter: run.next_chapter,
    auto_continue: run.auto_continue,
    stop_after_chapter: run.stop_after_chapter,
    last_error: run.last_error,
    accepted_chapters: chapters.rows.filter((c) => c.status === 'accepted').length,
    chapters: chapters.rows,
    recent_events: events.slice(-12).map((e) => ({ seq: e.seq, kind: e.kind, ...e.payload })),
  };
}

export const NOVEL_COMMANDS = new Set([
  'user:create',
  'member:add',
  'novel:start',
  'novel:approve',
  'novel:run',
  'novel:status',
  'novel:pause',
  'novel:resume',
  'novel:cancel',
]);

export const NOVEL_USAGE = `
Operators (DATABASE_URL required):
  user:create <email> <password> [display-name] [--workspace=<id>] [--role=owner|editor|viewer]
                                               create a sign-in for the web console; without --workspace a new
                                               workspace is created and the user becomes its owner
  member:add <workspace> <email> [role]        add an existing user to a workspace (default editor)

Novel lifecycle (DATABASE_URL + YEONJAE_PROVIDER_MODE required; live mode needs YEONJAE_LIVE_*):
  novel:start <project> <intake.json> [--identity=<composed-ref>]
                                               interpret the intake and propose story directions (spends R-class calls)
  novel:approve <project> <concept-id> [--one-chapter-at-a-time] [--stop-after=N]
                                               approve a direction; queues full-bible planning then production
  novel:run <project> [--once]                 drive the run: build the bible, then write chapters until it rests
  novel:status <project>                       run state, chapter progress, recent events
  novel:pause <project> | novel:resume <project> [--stop-after=N] | novel:cancel <project>
`;
