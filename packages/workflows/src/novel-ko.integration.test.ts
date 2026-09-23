/**
 * The Korean-manuscript product loop end to end with the simulated model (ADR-0054/0055): a Korean intake
 * composes the Korean identity layers, the requirement interpreter returns Korean requirements with no
 * English paraphrase, and chapters are planned, drafted, evaluated and accepted in Korean.
 *
 * Regression: before ADR-0055 the Active Constraint Set demanded an English `text_en` for every non-English
 * requirement, so the first Korean chapter contract failed with CONSTRAINT_UNRENDERABLE.
 */
import { afterAll, beforeAll, expect, it, describe } from 'vitest';
import { createProject, createWorkspace, getNovelRun, PgAuditStore, type Pool } from '@yeonjae/db';
import { databaseUrl, freshDatabase } from '@yeonjae/db/testkit';
import { Gateway, MemoryBudget, MockProvider, type ProviderRequest } from '@yeonjae/gateway';
import { simulatedModelScript as script } from './simulated-model.js';
import { approveConcept, resumeNovelRun, startNovel } from './novel.js';
import { NovelRunner } from './novel-runner.js';
import { ArtifactLlmOutputStore } from './runtime.js';
import { REPLAY_ROUTING } from './testkit.js';

const run = databaseUrl() ? describe : describe.skip;

const INTAKE = {
  title_working: '재의 장부',
  premise:
    '파면당한 길드 회계사가 도시의 게이트 방위 자금 장부가 조작됐다는 걸 알아채고, 그걸 증명하려고 직접 헌터 서열을 오른다.',
  premise_language: 'ko',
  manuscript_language: 'ko',
  genre: { primary: 'hunter-gate', secondary: ['academy'] },
  main_character: { name: '서지안', role: 'protagonist', description: '29세. 전직 길드 회계사.' },
  supporting_characters: [
    { name: '백태호', role: 'mentor', description: '48세, 은퇴한 B급 척후.' },
    { name: '문해린', role: 'antagonist', description: '35세, 길드 재무 담당.' },
  ],
  content_restrictions: ['성적인 묘사 금지'],
  target_chapters: 2,
  target_characters_per_chapter: 1400,
  operating_mode: 'autopilot',
};

const routing = {
  ...REPLAY_ROUTING,
  R: REPLAY_ROUTING.R.map((r) => ({ ...r, provider: 'mock' })),
  P: REPLAY_ROUTING.P.map((r) => ({ ...r, provider: 'mock' })),
  M: REPLAY_ROUTING.M.map((r) => ({ ...r, provider: 'mock' })),
  C: REPLAY_ROUTING.C.map((r) => ({ ...r, provider: 'mock' })),
};

for (const mode of ['standard', 'compact'] as const)
  run(
    `Korean novel run (${mode} chapters): intake → bible → chapters, prompts in Korean (simulated live model)`,
    () => {
      let pool: Pool;
      let workspaceId: string;
      let projectId: string;
      const seen: ProviderRequest[] = [];
      const provider = new MockProvider((req) => {
        seen.push(req);
        return script(req);
      });

      const priorMode = process.env.YEONJAE_CHAPTER_MODE;
      beforeAll(async () => {
        if (mode === 'compact') process.env.YEONJAE_CHAPTER_MODE = 'compact';
        else delete process.env.YEONJAE_CHAPTER_MODE;
        pool = await freshDatabase();
        workspaceId = await createWorkspace(pool, `novel-ko-e2e-${mode}`);
        ({ projectId } = await createProject(pool, {
          workspaceId,
          title: '재의 장부',
          operatingMode: 'autopilot',
        }));
      }, 120_000);

      afterAll(async () => {
        if (priorMode === undefined) delete process.env.YEONJAE_CHAPTER_MODE;
        else process.env.YEONJAE_CHAPTER_MODE = priorMode;
        await pool.end();
      });

      const makeDeps = () => ({
        pool,
        gateway: new Gateway({
          providers: new Map([['mock', provider]]),
          routing,
          budget: new MemoryBudget(10_000_000),
          audit: new PgAuditStore(
            pool,
            { workspaceId, projectId },
            new ArtifactLlmOutputStore(pool, { workspaceId, projectId }),
          ),
        }),
      });

      it('plans and accepts Korean chapters from Korean requirements', async () => {
        const started = await startNovel(makeDeps(), { projectId, intake: INTAKE });
        expect(started.run.status).toBe('awaiting_approval');
        const concept = started.concepts[0];
        await approveConcept(pool, { projectId, conceptId: concept?.id ?? '', autoContinue: true });
        const runner = new NovelRunner({ pool, makeDeps, runnerId: 'ko-runner', leaseSeconds: 30 });
        while (await runner.tick()) {
          const r = await getNovelRun(pool, projectId);
          if (r?.status === 'paused') await resumeNovelRun(pool, { projectId, autoContinue: true });
        }
        const after = await getNovelRun(pool, projectId);
        expect(after?.last_error ?? null).toBeNull();
        expect(after?.status).toBe('completed');

        const chapters = await pool.query<{ number: number; status: string }>(
          'SELECT number, status FROM chapters WHERE project_id = $1 ORDER BY number',
          [projectId],
        );
        expect(chapters.rows).toEqual([
          { number: 1, status: 'accepted' },
          { number: 2, status: 'accepted' },
        ]);

        // Every style-sensitive prompt carried the Korean identity block, and the writer saw a Korean contract.
        const writer = seen.filter((r) => r.trace?.role === 'scene_writer');
        expect(writer.length).toBeGreaterThan(0);
        for (const r of writer) {
          expect(r.system).toMatch(/lang=ko\/ko-KR/);
          expect(r.system).toMatch(/## 출력 언어 계약 \(한국어\)/);
          expect(r.system).not.toMatch(/Output-Language Contract/);
          expect(`${r.system}\n${r.user}`).toMatch(/회차 계약/);
        }
        // Compact mode: no scene-planner call, one whole-chapter writer call per chapter.
        const scenePlanners = seen.filter((r) => r.trace?.role === 'scene_planner').length;
        if (mode === 'compact') {
          expect(scenePlanners).toBe(0);
          expect(writer).toHaveLength(2);
          expect(writer[0]?.user).toMatch(/회차 전체를 한 번에 쓴다/);
        } else {
          expect(scenePlanners).toBe(2);
          expect(writer.length).toBeGreaterThan(2);
        }
        // The bible carries a pacing map (ADR-0056); arc and chapter planners read their rhythm from it.
        expect(seen.some((r) => r.trace?.role === 'pacing_designer')).toBe(true);
        const arcPlanner = seen.find((r) => r.trace?.role === 'arc_planner');
        expect(arcPlanner?.user).toMatch(/회차별 리듬/);
        const planner = seen.filter((r) => r.trace?.role === 'chapter_planner');
        expect(planner.map((r) => /이번 회차: (\d+)화/.exec(r.user)?.[1])).toEqual(['1', '2']);
        for (const r of planner) {
          expect(r.user).toMatch(/하드 요구사항/);
          expect(r.user).not.toMatch(/Use ONLY the entity ids above/);
        }
      }, 300_000);
    },
  );
