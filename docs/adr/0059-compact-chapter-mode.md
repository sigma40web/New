# ADR-0059: Compact chapter mode

- **Status:** Accepted
- **Date:** 2026-09-23
- **Deciders:** product owner
- **Relates to:** ADR-0014 (patch regression), ADR-0026 (separate evaluation dimensions), ADR-0057, ADR-0058

## Context

A standard chapter makes about thirteen model calls: contract, scene plan, one writer call per scene (three
to five), contract check, continuity, knowledge leak, four judges, and a revision when a gate fails. Behind
the operator's bridges a long call takes four to eight minutes, so a chapter took about fifty minutes, and
every call re-sent the same ~37k characters of story design. Folding the whole chapter into one call is not
an option: a writer that grades its own prose is lenient, canon must be extracted from the approved text,
and one 15-minute call exceeds the bridges' time limits and loses everything on any fault.

## Decision

`YEONJAE_CHAPTER_MODE=compact` (default: standard) keeps every artifact, gate and checkpoint and changes only
how many calls produce them:

1. **No scene-planner call.** The scene plan is derived deterministically from the locked contract as one
   whole-chapter scene: opening, every `must_happen` beat, the local payoffs, then the hook, with the
   contract's POV, participants, first location, `must_not_happen`, and chapter length target. It is
   validated against `scene-plan.schema.json` and stored under the same `scene_plan` step. A contract with
   no location falls back to the scene planner.
2. **One writer call** writes the episode in one pass from that plan and the contract.
3. **Concurrent evaluation.** Contract check, continuity, knowledge leak and the four judges start together
   and all settle before results are read in their usual order. They remain separate calls with separate
   rubrics and separate per-dimension gates (EVAL-SEPARATION-001); a merged judge was rejected for that
   reason.
4. Revision, patch regression, approval, canon extraction and summaries are unchanged.

## Consequences

- About 4–5 calls on the critical path instead of ~13 (contract, writer, evaluation in parallel, revision
  only when a gate fails, extraction); roughly half the wall time and fewer re-sent design tokens.
- The writer produces 5,000+ characters in one response; roles whose output cap is below a chapter still
  need standard mode.
- Because the plan is checkpointed under the same step, a chapter planned in standard mode replays its
  multi-scene plan; switching modes affects only chapters not yet planned.
- One operator variable, listed by name in `.env.example`.
