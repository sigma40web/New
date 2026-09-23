# ADR-0056: A chapter-by-chapter pacing map in the bible, and explicit Korean-webnovel craft rules

- **Status:** Accepted
- **Date:** 2026-09-22
- **Deciders:** product owner
- **Relates to:** ADR-0012 (rolling-horizon planning), ADR-0052 (complete bible before prose), ADR-0053, ADR-0055,
  docs/03-story-planning/01-story-planning-architecture.md, docs/05-generation/03-prompt-architecture.md

## Context

The series blueprint divided a 200–300-chapter serial into seasons of 40–60 chapters, and each season was planned
as ONE arc. An arc plan with a handful of beats left most chapters without a planned beat; chapter planners
filled the gaps by pulling events forward, so stories felt rushed in places and stalled in others. Nothing
checked the rhythm (고구마 streaks, payoff droughts, climax plateaus, a slow opening). On the prose side the
writer was told "short paragraphs, dialogue-forward", which models satisfy with Western-novel sentences
split into lines; the prose judge received no measurement of what Korean-webnovel prose looks like.

## Decision

1. **Pacing map.** After the series blueprint, a new `pacing_designer` family (R class) designs each season as
   arcs of 8–30 chapters and gives **every chapter** a slot: role (hook, setup, daily, buildup, foreshadow,
   incident, confrontation, climax, aftermath, reward, relationship, twist, rest), tension 1–10, one core beat,
   thread, payoff, frustration flag, hook type and relationship focus. A deterministic rhythm skeleton (arc
   count and sawtooth tension per season, slow opening for long serials) is supplied as guidance.
2. **Deterministic pacing validation.** Coverage (every chapter exactly once), contiguous arcs, one or more
   climax per arc, frustration streak ≤ 3, payoff gap ≤ 5, tension ≥ 8 for ≤ 4 chapters, and no climax or
   tension > 7 in chapters 1–10 of a serial of 60+ chapters. A violation is a planning rejection
   (regenerate), never a silently accepted plan.
3. **The map is part of the bible.** `series-blueprint.pacing` (optional, additive) stores the merged map; the
   arc schedule uses pacing arcs when present (season arcs otherwise, so older projects are unchanged).
   `arc_planner` receives the arc's rhythm table; `chapter_planner` receives the chapter's rhythm position (its
   slot, two neighbours on each side, distance to the arc climax) and is told not to pull later events forward.
   Jobs pinned to a prompt set without `pacing_designer` (ADR-0053) skip the step.
4. **Episode shape and craft rules (v3.1.0 prompts).** Planners get the Korean episode shape (도입 10% /
   전개 70% with a mid-episode payoff / 절단 10%) and POV discipline; the scene planner designs 4–8 concrete
   beats per scene; the writer, reviser and assembler get a concrete Korean-webnovel style guide (paragraph and
   beat rhythm, ‘ ’ inner voice, bracketed system lines, dialogue without tag repetition, and explicit
   anti-translationese and anti-Western-stock-phrase lists) plus a newly written rhythm example with no
   copyable names or setting. The rules come from Korean serial-platform practice and Korean 번역투 style guides
   and a structural reading of a completed reference work (paragraph length, paragraphs per episode); no
   reference text is quoted.
5. **Korean prose lint.** A deterministic lint (`ko-lint.ts`) measures paragraph count and median length, long
   paragraphs, dialogue and inner-voice ratios, the longest narration run, pronoun-led sentences, 번역투
   patterns (TRN-KO-01…07) and Western stock phrases, and its report is the prose judge's evidence. It never
   gates on its own.

## Alternatives considered

- Plan every chapter inside the story architect call — rejected: one call cannot author 200–300 detailed slots
  reliably; seasons are the natural unit.
- Enforce pacing only in prompts — rejected: the observed failure is that models ignore rhythm under load; the
  validator makes the rules hold.
- Gate chapters on the lint — rejected for now: thresholds are uncalibrated (ADR-0029); the judge weighs them.

## Consequences

- New prompt family and 11 v3.1.0 versions; `series-blueprint.schema.json` gains `pacing`; bible generation
  makes one more R-class call per season.
- Tests: pacing validator rules and renderings; Korean lint; the Korean simulated run asserts the pacing step,
  the arc rhythm and per-chapter rhythm positions.
