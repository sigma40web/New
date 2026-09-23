# Story Planning Architecture

## 1. Goals

- Whole-series direction with a **committed ending** and **endgame requirements**, while near-term chapters
  are planned in detail and far chapters remain adjustable (rolling horizon, ADR-0012).
- Plans are **structured objects with validation**, not prose outlines; every chapter has a **Chapter
  Contract** that is the unit of acceptance (ADR-0013).
- Plans are **canon-aware**: they reference facts/events/promises by ID, are validated against canon after
  every commit, and are marked stale when dependencies change.
- Plans are Korean-webnovel-shaped: hook/cadence/payoff structure comes from the Narrative-Tradition
  Profile's structure rules (`planner_compact` block) and the genre overlays; manuscripts realizing them are
  composed in the project manuscript language, `en` or `ko` (OUTPUT-LANG-001, STYLE-KWN-001).
- **Planned ≠ happened**: plan objects live in `plan_*` tables and are stored as `frame=plan` when they
  appear in context; they never appear in canonical event tables until an accepted chapter realizes them.

## 2. Hierarchy

```
Series Blueprint (1)
 └─ Season (2–6 for 200–600 ch; 1 for short works)        "major narrative movement"
     └─ Arc: major (8–30 ch) ─ contains minor arcs (2–6 ch)  "conflict unit"
         └─ Chapter Contract (1 chapter, ~1,800–3,500 words)   "acceptance unit"
             └─ Scene Plan (2–4 per chapter)                    "drafting unit"
Volume = export grouping over chapters, not a planning level; default 25 chapters/volume, adjustable.
```

Why not plan volumes: volumes are a publication artifact and their boundaries move with platform needs;
arcs are the narrative unit that carries objectives. Volume boundaries are chosen to land near arc climaxes
by a deterministic rule (prefer boundary within ±2 chapters of a major arc end).

## 3. Series Blueprint (schema: `series-blueprint.schema.json`)

Fields: `story_promise` (what the reader is promised each chapter), `reader_fantasy` (from concept),
`main_conflict`, `protagonist_arc` (start state → end state, 3–5 turning points), `character_arcs[]`
(per key character), `relationship_arcs[]` (pair, start, milestones, end), `progression_arc` (power/rank/
asset curve with milestones bound to chapter ranges; genre cadence), `mysteries[]` (question, answer (secret
proposition ID), reveal window), `foreshadowing_register[]` (planned promises with due windows),
`red_herrings[]` (false trails with resolution), `themes[]`, `ending` (type from user preference; final
state assertions), `endgame_requirements[]` (facts/knowledge states that must hold before the ending can be
written — e.g., "the protagonist must know the mastermind's identity", "the leads have shared their secrets
with each other"), `seasons[]`
(summary, objective, entry/exit states, chapter range estimate), `hard_requirement_bindings[]` (which spec
requirements are satisfied where).

Validation: every user mandatory scene is bound to a season/arc; every forbidden development becomes a
`must_not` inherited by all contracts; ending preference realized in `ending`; endgame requirements each
have at least one planned path (arc) that produces them.

### 3.1 Pacing map (ADR-0056)

After the blueprint, `pacing_designer` designs each season as arcs of 8–30 chapters and assigns every chapter a
rhythm slot: role (hook, setup, daily, buildup, foreshadow, incident, confrontation, climax, aftermath, reward,
relationship, twist, rest), tension 1–10, one core beat, thread, payoff, frustration flag, hook type and
relationship focus. A deterministic skeleton suggests arc boundaries and a sawtooth tension curve. The workflow
validates coverage, contiguous arcs, a climax per arc, frustration streaks, payoff gaps, tension plateaus and a
slow opening for long serials, and rejects (regenerates) a plan that breaks them. The merged map is stored as
`series-blueprint.pacing`; arc plans are scheduled per pacing arc, the arc planner reads the arc's rhythm table
and the chapter planner reads the chapter's rhythm position, so no chapter has to invent its own event.

## 4. Season & Arc plans (schema: `arc-plan.schema.json`)

Season: objective, thesis, entry state (reference to canon at a chapter), exit state (assertions),
arcs[] outline, promise budget (which blueprint promises open/close here).

Arc (major/minor): `objective`, `conflict`, `antagonistic_force`, `stakes`, `entry_state`, `exit_state`
(assertions to be realized), `participants`, `locations`, `story_time_window`, `beats[]` (ordered; each with
type: setup, escalation, reversal, satisfaction (사이다), revelation, emotional, progression, climax, aftermath; and target
chapter offset), `promises_opened[]`, `promises_advanced[]`, `promises_paid[]`, `progression_milestones[]`,
`relationship_milestones[]`, `knowledge_changes_planned[]` (who will learn what, when — as `plan` frame),
`cadence_check` (deterministic validation vs the tradition/genre profiles: satisfaction-beat interval,
progression interval, max frustration streak), `risks[]` (continuity risks, e.g., "watch the recovery
timeline of the protagonist's left-arm injury").

Minor arcs nest inside major arcs and map to 2–6 chapters; chapter contracts are generated from minor-arc
beats.

## 5. Rolling horizon

Parameters (project settings): `detail_horizon_chapters` H = 6, `arc_outline_horizon` = 2 arcs, `season
outline` = all.

Triggers for re-planning (`PlanningHorizonWorkflow`):
1. Canon commit of chapter k → ensure contracts exist for k+1..k+H; validate existing contracts against
   the new canon version; adjust or regenerate stale ones; advance arc outlines if the current arc has
   < 2 chapters left.
2. New direction (FR-1.5) → scope-based invalidation (e.g., character-scoped direction invalidates
   contracts where the character participates).
3. User plan edit at level L → children stale.
4. Retcon/correction → dependency edges from canon items to plan items mark stale.
5. Reader feedback (Beta) → soft re-weighting for the next arc outline generation only.

Stale contracts are not silently regenerated in Assisted mode; the UI shows a diff ("this contract
materially depends on 3 facts changed in canon v128") and offers regenerate/keep. Only **material**
dependency edges trigger staleness; contextual edges produce a "review suggested" hint (ADR-0032).

## 6. Promise Ledger (schema: `promise.schema.json`)

`Promise { id, type: foreshadowing|mystery|chekhov|relationship_beat|character_goal|world_question|
running_gag|threat|debt, statement, opened_in (chapter/evidence or plan), due_window {min_chapter,
max_chapter or arc ref}, importance: core|major|minor, status: planned|open|advanced|paid|abandoned,
advances[] (chapter refs), payoff (chapter/evidence), related_propositions[], related_entities[] }`

Rules: a `paid` status requires evidence from an accepted chapter (extraction confirms the payoff); a payoff
without any prior `open` promise raises `payoff_without_setup` (major, unless the chapter itself opens and
pays a micro-promise); overdue `core` promises block arc plan approval until scheduled; `abandoned` requires a
user decision and reason (never automatic).

## 7. Chapter Contract (schema: `chapter-contract.schema.json`)

See `02-chapter-contract-specification.md` for every field. Key idea: a contract is validated on three
axes before drafting starts —

1. **Canon validity** (deterministic + retrieval): participants exist and are alive/available at the
   story time; locations reachable from last known locations (travel-time facts if any); states referenced
   (injuries, items, ranks) match canon at `story_time.start`; knowledge deltas are possible (a character
   can only learn something present in canon or introduced in this chapter's `introduces[]`).
2. **Plan validity**: realizes ≥ 1 arc beat; respects arc must/must-not; opens/advances/pays promises as
   scheduled; cadence check passes.
3. **Narrative validity**: hook type, ending type, local payoff type, dialogue density, scene count and
   length target (words) within the Narrative-Tradition Profile's structure rules.

A contract failing validation is fixed by the planner role (one repair call) or escalated.

## 8. Scene Plan (embedded in contract; schema `scene-plan.schema.json`)

Per scene: `objective`, `pov`, `participants`, `location`, `story_time`, `beats[]` (each beat: type,
description, emotional target, information revealed (proposition refs), tags
satisfaction/emotion/information/humor/growth/tension), `entry_state`/`exit_state` deltas,
`dialogue_density_target`, `length_target_words`, `opening_beat_type`,
`ending_beat_type`, `continuity_anchors[]` (facts that must appear consistent, with evidence refs),
`must_not[]`, `speaker_pairs[]` (pairs who will talk → **English dialogue register** (formality, address terms,
titles, contraction usage) pre-resolved from the register policy and relationship ledger so the writer
receives it explicitly).

## 9. Planning roles and calls

| Step | Role | Model class | Candidates |
| --- | --- | --- | --- |
| Blueprint | `series_architect` | reasoning-strong | 2 (Standard), 3 (Premium); pairwise judged |
| Season outline | `season_planner` | reasoning-strong | 1 (+1 on request) |
| Arc plan | `arc_planner` | reasoning-strong | 2 (Standard), judged on objective fit, cadence, promise handling, novelty vs prior arcs (repetition judge) |
| Chapter contract | `chapter_planner` | reasoning-strong or mid | 1 (+repair) |
| Scene plan | `scene_planner` | mid | 1 (+repair) |
| Plan validators | deterministic + `plan_continuity_checker` (mid) | — | — |

Every planner call carries: the Active Constraint Set (hard requirements in scope, ADR-0033) plus soft
preferences and labelled assumptions, the `planner_compact` Narrative Identity Block,
relevant blueprint section, parent plan, canon summary at the appropriate tier, promise ledger slice,
protagonist state & progression position, recent arc summaries (L2) for repetition avoidance, and explicit
`must_not[]`.

## 10. Repetition and novelty management

- Arc-level: `repetition_judge` compares the proposed arc to L2 summaries of all prior arcs (structural
  fingerprint: conflict type, antagonist type, setting, resolution type). Score < threshold → planner asked
  for variation with explicit "avoid" list.
- Chapter-level: contract `local_satisfaction` and `ending_type` distributions over the last 10 chapters
  are checked deterministically (no more than 3 identical ending types in a row; vary payoff types).
- Scene-level: deterministic repeated-paragraph checks after drafting (lint `EP-REP-*`).

## 11. Reacting to feedback (Beta)

Imported reader feedback is sanitized (untrusted), classified (pacing, character popularity, confusion,
requests), aggregated into **soft signals** attached to the next arc-outline generation with weights; the
planner reports which signals it acted on. Signals never alter hard requirements or canon.

## 12. Complete-bible gate for automatic production

After concept approval, the studio prepares the complete character, world and progression design and
the series blueprint before drafting chapter one (ADR-0052). The immutable full-bible artifact retains
the original designer documents as well as normalized registry/seed data. Series, arc and chapter
planners receive this design as **planned** context, never as evidence of realized events.

An automatically generated plan must contain a named cast preserving supplied characters, with authored
roles, backgrounds, goals, flaws, voice guidance and arcs; world rules and described locations;
progression rules, capabilities and milestones; a concrete protagonist arc, ending and endgame requirements; and
authored seasons covering the requested chapters without gaps or overlaps. Missing content stops the
run before prose; generic fallback objectives are not a substitute for an authored plan. Scene and
chapter contracts still use rolling-horizon planning against accepted canon.

Scene-writer entity cards include selected voice, motivation and mechanics guidance rather than the
complete author-only design. Secret and arc payloads do not enter these cards; knowledge guards remain
authoritative. Explicit retry regenerates semantically rejected design output, while crash replay without
a recorded rejection reuses the paid response.
