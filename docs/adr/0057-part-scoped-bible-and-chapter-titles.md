# ADR-0057: Part-scoped bible generation, per-role routes, and chapter titles

- **Status:** Accepted
- **Date:** 2026-09-22
- **Deciders:** product owner
- **Relates to:** ADR-0051 (live providers), ADR-0052, ADR-0053, ADR-0056,
  docs/08-delivery/13-korean-pipeline-sequence-audit.md

## Context

The live Genspark bridge is reached through a quick tunnel that drops any response slower than roughly two
minutes (HTTP 524). A complete bible stage — a ten-person cast, a season of fifty chapter slots, a series
blueprint with thirty promises — is a single long Korean generation on the bible model and routinely takes three
to five minutes, so the upstream finishes, the response is lost, and a retry is exactly as long. The same cap
applies to the chapter-stage planners when they share the bible model's class. Separately, the sequence audit
found that Korean episodes had no titles and exports used English headings.

## Decision

1. **Part-scoped design calls.** The bible families (`character_designer`, `world_builder`,
   `power_system_designer`, `story_architect`, `pacing_designer`) gain a `part` variable (v3.2.0). With
   `YEONJAE_DESIGN_PARTS=on` the workflow asks for bounded parts — named characters two at a time then the rest,
   world rules then places, progression rules then growth, blueprint core then character arcs then promises, a
   season's arcs then 15-chapter windows of slots — each part seeing what earlier parts decided, and merges them
   (arrays concatenate, a later item with the same identifying key refines the earlier one). Every part is its own
   checkpointed call. The default remains one call per stage; a job pinned to an older prompt set (ADR-0053)
   makes the call it always made. Validation of the merged stage is unchanged.
2. **Per-role routes.** `YEONJAE_ROLE_MODELS` (genspark mode) routes named roles to a model regardless of their
   class, e.g. arc and chapter planners on the chapter-writing model while the bible designers stay on the bible
   model. The gateway's class routes are unchanged for every other role.
3. **Chapter titles.** `chapter-contract.title` (optional) is written by the chapter planner; the chapter row uses
   it, and Korean exports use `N화. 제목` headings.

## Alternatives considered

- Wait for a tunnel without a cap — rejected: the operator's endpoint is what exists, and bounded calls also
  reduce truncation and regeneration cost on any provider.
- Lower the bible's detail to fit one call — rejected: it trades plan quality for transport.

## Consequences

- Six v3.2.0 prompt versions; one optional contract field; two operator variables (`YEONJAE_DESIGN_PARTS`,
  `YEONJAE_ROLE_MODELS`) listed in `.env.example`.
- Part mode multiplies bible calls (≈ 4 + 2 + 2 + 3 + seasons × 5) while keeping each call short.
