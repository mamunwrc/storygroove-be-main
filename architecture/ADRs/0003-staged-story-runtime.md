# Adopt a staged Story Runtime (artifacts over transcript replay)

## Status

Proposed.

## Context

Story Groove is a staged novel product (Simone kit → Olivia bible/studio → Ellis). Dashboard agent chat (`POST /api/v1/chat`) still loads the full Mongo `Message` history into every OpenAI Responses call because `DASHBOARD_CHAT_MEMORY_V2_ENABLED` is false — naive windowing dropped early intake facts. Several batch paths (`generateStoryFromResponses`, Ellis chapter loops) append growing `conversationHistory`. Interactive coaches use `gpt-5.4`. Olivia editor Memory V2 exists but still allows a 60k-token full-canon exception. Cost scales roughly with the square of turns, which is already painful at current volume.

LangGraph (and similar graph frameworks) were suggested as a revamp. Graphs orchestrate stages; they do not reduce tokens unless the payload is redesigned.

## Decision

1. Treat **staged artifacts** (intake state, starter kit, bible, per-scene design, per-chapter review) as the model-facing source of truth. Chat logs remain UX and audit.
2. **Do not** start with a LangGraph rewrite of Express. Extend the existing Node Memory V2 patterns to dashboard chat and batch jobs first (extract-then-window, slice-not-replay, model router, drop unnecessary `code_interpreter`).
3. Revisit **LangGraph.js** only if stage graphs become too complex in controllers (Phase 3 in `architecture/staged-ai-architecture.md`).
4. Keep the frontend streaming UI and HTTP contracts.

## Consequences

**Positive**

- Cost per turn can flatten versus thread length.
- Handoffs (Simone → Olivia) pass a kit document instead of a transcript.
- Quality rationale for disabling dashboard V2 is encoded as extract-then-window, not “always send everything.”

**Negative**

- Extractor bugs can omit facts; requires golden-thread evals before enabling the dashboard flag.
- More Mongo documents and a compile step per stage.

**Neutral**

- OpenAI remains the generator; unit price changes are a later per-node eval.
- Full design and phases: `architecture/staged-ai-architecture.md`.

## Alternatives considered

1. **LangGraph (Python or JS) as the first rewrite** — extra runtime, same tokens if transcripts still flow through `add_messages`. Rejected as phase 1.
2. **CrewAI / multi-agent debate** — more tokens. Rejected.
3. **Wholesale cheaper model swap** — risks kit/bible quality. Allowed later per node, not as the architecture.
4. **Keep full history** — unbounded cost. Rejected.
