# ADR-0058: Notion bridge provider mode

- **Status:** Accepted
- **Date:** 2026-09-23
- **Deciders:** product owner
- **Relates to:** ADR-0051 (live providers), ADR-0057 (part-scoped bible, per-role routes)

## Context

The Genspark account behind the live run has a rolling five-hour usage cap that a bible stage exhausts in
about thirty calls. The operator has a second bridge in front of Notion AI that speaks the same
`/v1/complete` wire contract (`modelId`, `system`, `user`, `params` in; `text`, `finishReason`, `usage` out)
and serves one model, `notion-ai`, under a separate credit window.

## Decision

1. **`YEONJAE_PROVIDER_MODE=notion`.** A new explicit mode that reuses the HTTP bridge adapter under the
   provider name `notion`. `YEONJAE_NOTION_URL` is required (startup error otherwise);
   `YEONJAE_NOTION_TOKEN` (bearer) and `YEONJAE_NOTION_TIMEOUT_MS` are optional.
2. **One model for every class.** R, P, M and C route to `YEONJAE_NOTION_MODEL` (default `notion-ai`), with the
   same one same-model retry as genspark routes. The genspark model variables and `YEONJAE_ROLE_MODELS` are
   not read in this mode: they name models the bridge does not serve.
3. Readiness and the dependency report accept the mode; the simulator is reported as not in play.

## Consequences

- Bible and chapter roles share one model in this mode, so the "bible on the strongest model" split is not
  available; it is an operator fallback, not the recommended configuration.
- Jobs already pinned to prompt versions keep them; switching modes mid-run only changes which provider
  answers the next uncompleted call. Completed checkpoints replay.
- Three operator variables are listed by name in `.env.example`; no secret value is committed.
