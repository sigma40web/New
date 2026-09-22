# Korean pipeline sequence audit (step 7)

Design review of the order in which the novel pipeline runs for a Korean-manuscript project, and of the steps it
was missing. Status of what is implemented lives in `09-progress.md` (ADR-0043); this document records the
audited sequence and the reasoning behind the additions.

## 1. Audited sequence

| # | Stage | Family / code | Inputs it depends on | Order correct? |
| --- | --- | --- | --- | --- |
| 1 | Intake validation | `validateIntake` | — | yes |
| 2 | Narrative identity (Korean layers, ADR-0055) | `ensureProjectIdentity` | intake | yes — composed before any model call, so every prompt is Korean |
| 3 | Story spec | `requirement_interpreter` (+ `assumption_explainer`) | intake | yes |
| 4 | Concepts → operator approval | `concept_generator` × N | spec | yes |
| 5 | Cast | `character_designer` | spec, concept | yes |
| 6 | World | `world_builder` | spec, concept | yes (independent of cast) |
| 7 | Progression | `power_system_designer` | spec, concept, world rules | yes — needs the world's numeric rules |
| 8 | Series blueprint | `story_architect` | spec, concept, cast + world + progression summary | yes — seasons and heroine arcs are planned with the full design in hand |
| 9 | **Pacing map** (ADR-0056) | `pacing_designer` × season | blueprint, skeleton, bible summary | **added** — without it, 40–60-chapter seasons were planned as single arcs |
| 10 | Bible assembly + seed canon | `bible_assembly`, `buildStoryBible` | 5–9 | yes |
| 11 | Arc plan (rolling, per pacing arc) | `arc_planner` | blueprint, arc rhythm, previous arc exit | yes — planned when its first chapter is reached |
| 12 | Chapter contract | `chapter_planner` | arc plan, **rhythm position**, previous accepted summary, canon, knowledge, ACS | yes — gated on chapter k−1 being accepted |
| 13 | Writer pack | context assembly | contract, canon, previous tail | yes |
| 14 | Scene plan | `scene_planner` | contract, registers, previous tail | yes |
| 15 | Scene drafts (sequential) | `scene_writer` | scene plan, pack, previous scene text | yes |
| 16 | Assembly | deterministic concatenation | drafts | see §2.4 |
| 17 | Evaluation | deterministic checks, **Korean prose lint**, contract / continuity / knowledge checkers, prose / structure / genre / voice judges | chapter text, pack | yes |
| 18 | Targeted revision | `targeted_reviser` | issues | yes — patch-first (ADR-0014) |
| 19 | Gate → approval lock | policy gates | scorecard | yes |
| 20 | Canon extraction, reconciliation, atomic commit | `canon_extractor`, commit | approved text | yes — extraction only from approval-locked text |
| 21 | L1 summary, retrieval index | `factual_summarizer`, indexer | accepted version | yes — feeds chapter k+1 |

No stage reads an output that is produced later, and every chapter-level stage reads only accepted canon.

## 2. Missing or weak steps found

1. **No chapter-level rhythm (fixed in K2, ADR-0056).** Seasons were planned as one arc; chapter planners
   invented events for chapters without a beat. The pacing map and rhythm position close this.
2. **No Korean prose measurement (fixed in K2).** The prose judge saw one line of evidence; it now reads the
   deterministic Korean lint.
3. **No chapter titles (fixed in K3).** Korean serials show a title per episode; the chapter row stored a
   truncated `purpose`. The chapter planner now writes `title` (optional contract field) and the chapter row
   and export use it.
4. **English export headings (fixed in K3).** Korean exports now use `N화. 제목` headings.
5. **Registered but unused families.** `chapter_assembler` (seam smoothing), `concept_comparator` and
   `extraction_reconciler` are registered but not called by the novel loop. Seams are safe because every scene
   is drafted from the exact previous text; the families stay registered for their documented surfaces.
6. **Considered, not added: a model critique of the whole bible.** The deterministic pacing validator and the
   completeness checks (ADR-0052) cover the structural failures seen live; a semantic critic would add an
   R-class call per project with uncalibrated value. Revisit after live runs show semantic plan defects.
7. **Considered, not added: lint-gated revision.** Lint thresholds are uncalibrated (ADR-0029); the judge
   weighs the lint evidence instead of the lint gating on its own.
