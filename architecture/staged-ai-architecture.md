# Staged AI architecture — cost and scale proposal

**Status:** Proposed (not implemented)  
**Date:** 2026-09-01  
**Audience:** engineering, product, ops  
**Companion ADR:** [ADRs/0003-staged-story-runtime.md](ADRs/0003-staged-story-runtime.md)

This document is the plan to stop paying frontier-model prices to re-read entire conversations on every writer turn, while keeping the product sequence writers already know: Simone Story Starter Kit → Olivia Story Bible and studio → Ellis developmental edit.

It is **not** a rewrite of the React app, Stripe, or auth. The frontend stays a streaming chat and editor client. The change is what the backend sends to the model, and how stages hand work to each other.

---

## 1. What the product actually is

Story Groove is a **staged novel pipeline**, not an open-ended chatbot.

```
Simone intake (20+ Qs)  →  Story Starter Kit artifact
        ↓
Olivia Story Bible intake  →  Bible + dossiers artifact
        ↓
Olivia Outline & Draft Studio (15 scenes, layering, draft)
        ↓
Ellis (map, editorial letter, chapter reviews)   [Studio]
```

Each stage has a **deliverable**. Writers experience it as chat because that is how the coaches teach. The model does not need the full chat transcript once the deliverable exists.

Writer-facing steps: `storygroove-fe/docs/user-guide/04-simone-story-starter-kit.md` through `06-ellis-manuscript-review.md`.

---

## 2. Current architecture (as shipped)

```
Browser  →  Express  →  Mongo (Thread, Message, Novel, …)
                     →  OpenAI Responses API  (gpt-5.4 for Simone, Olivia, Ellis)
```

Three different context strategies already coexist. That split is the cost problem.

| Surface | Code | What goes to OpenAI today |
|---|---|---|
| **Dashboard Simone / Olivia chat** `POST /api/v1/chat` | `chatController.js` → `chatWithResponsesAPIStream` | **Full `Message` history every turn.** `DASHBOARD_CHAT_MEMORY_V2_ENABLED` is **false** in `constants/oliviaMemory.js`. Comment in that file: windowing dropped early intake facts (e.g. author name). |
| **Olivia Book Editor / scene chat** | `novelController` + `contextAssembler.js` | Memory V2 **on**. Cursor + `previous_response_id` + rolling summary. Then **undone in part** by `OLIVIA_FULL_CANON_CONTEXT_ENABLED = true` and `OLIVIA_FULL_CANON_TOKEN_BUDGET = 60000`. Vector store flag is **off**. |
| **Ellis editor chat** | `ellisMemory.js` | Windowed history + chain **on** (`ELLIS_MEMORY_V2_ENABLED`). |
| **Batch generate / chapter loops** | `generateStoryFromResponses`, `reviewNovel` chapter loop | **Growing `conversationHistory` array**: each scene/chapter call resends all prior prompts and model output. Quadratic tokens. Also attaches `code_interpreter` on several of these jobs. |
| **Ellis one-shot manuscript JSON** | `ellisReviewByResponses` | Whole manuscript + long instructions in one `gpt-5.4` call. |

Models (`constants/models.js`): interactive coaches use **`gpt-5.4`**. Extraction/summary is supposed to use `OLIVIA_MEMORY_MODEL` (`gpt-5.4-mini`), but the dashboard path never reaches that compressor because the memory pipeline is off.

Pricing (`constants/modelPricing.js`): `gpt-5.4` is $2.50 / $15 per million input/output (cached input $0.25). Output is 6× input. Replaying a 40-turn intake on every turn bills the same tokens again as **uncached input** unless the prefix is byte-stable and cache hits.

### Why “send all history” was chosen

Intake quality depends on early answers (name, genre, premise). A naive last-N window (Simone window size is already 24 in constants) silently forgets Q1–Q5 when the writer is on Q18. The team disabled dashboard memory V2 rather than **persist those answers as structured fields** and inject them every turn as a small state block.

That is the correct product instinct and the wrong long-term mechanism.

### Frontend

The SPA (`AIAgentChatPage`, Book Editor, Ellis upload studio) streams SSE tokens and stores **display** history. It does not assemble OpenAI payloads. Cost control cannot be fixed in React. Keep the UI; change the runtime behind `/api/v1/chat` and `/api/novel/*`.

---

## 3. Cost model (why this gets worse at scale)

Let:

- \(T\) = tokens in one writer turn (question + answer)
- \(N\) = turns so far in the thread
- \(S\) = stable system prompt (agent prompt + methodology)

**Today (dashboard):** each turn sends roughly \(S + \sum_{i=1}^{N} T_i\).

Simone kit ≈ 20–25 turns. Olivia Bible ≈ 15+ turns plus long model essays (dossiers). Cost per thread is **O(N²)** in transcript size, on `gpt-5.4`, before the writer even reaches the studio.

**Target:** each turn sends \(S_{\text{cached}} + State + Window(k) + UserTurn\).

- \(State\) is a structured JSON/markdown artifact (few thousand tokens, grows slowly).
- \(Window(k)\) is the last 4–8 raw messages for conversational coherence.
- \(S\) is a stable prefix so OpenAI prompt cache can hit (`cached_tokens` at 10% of input price).

Batch scene generation today is the same quadratic pattern with **15 scene-sized completions** in one request chain. Target: scene \(i\) sees outline slice + scene \(i\) brief + maybe adjacent scenes, not scenes 1…\(i-1\) full text.

A second multiplier: **one model for everything**. Classification (“is this Q11?”), fact extraction, and kit synthesis all hit `gpt-5.4`. Routing cheap work to mini/nano is usually a larger saving than changing frameworks.

---

## 4. What LangGraph is (and is not)

[LangGraph](https://langchain-ai.github.io/langgraph/) is a **durable state machine** for LLM workflows: nodes, edges, reducers, checkpoints, interrupts (human-in-the-loop), subgraphs.

| It is good at | It does not do by itself |
|---|---|
| Encoding Simone → Olivia → Ellis as explicit stages | Reducing tokens (a graph that still `add_messages` the full transcript costs the same) |
| Tool nodes (extract schema, retrieve scene, write kit) | Replacing Express, JWT, Stripe, or SSE |
| Retry, resume after crash, inspect checkpoints | Magically preserving intake quality without a state schema |
| Per-novel graph instance with typed state | Hosting the writer UI |

**Adopting LangGraph without changing payload shape would not move the bill.** It is a candidate for the **orchestrator**, not the memory model.

### Alternatives considered

| Option | Fit | Verdict |
|---|---|---|
| **LangGraph (Python) beside Node** | Strong graph semantics; extra runtime, two languages, ops cost | Only if we split a worker service. Do not put it on the Express request path for SSE. |
| **LangGraph.js** | Same ideas, stays in Node | Reasonable if we want checkpoints and tool graphs without a new language. |
| **Extend current Node runtime** (ConversationCursor, StoryState, memoryWorker) | Already in production for Olivia editor | **Fastest 80% of savings.** Missing: dashboard intake state, batch loops, model router. |
| **LlamaIndex / raw vector RAG** | Retrieval of scenes/bible | Use as **one node** (we already have `OLIVIA_NOVEL_VECTOR_STORE_ENABLED = false`). Not an orchestrator. |
| **CrewAI / AutoGen / “multi-agent debate”** | Extra agent chatter | Usually **increases** tokens. Reject for this product. |
| **Swap OpenAI for cheaper APIs only** | Can cut unit price | Quality of kit/bible/letter is the brand. Evaluate per **node**, not a wholesale swap. |
| **OpenAI Assistants threads as memory** | Server-side history | We already left Assistants for Responses; still billed; less control than our Mongo artifacts. |

**Recommendation:** do not start with a LangGraph rewrite. Start with a **Story Runtime** in this repo (section 5). Introduce **LangGraph.js** in phase 3 only if node graphs (intake extract → compile kit → handoff) are getting too ad hoc in controllers.

---

## 5. Target architecture — Story Runtime

### 5.1 Principle

**The source of truth is staged artifacts, not the chat log.**

The chat log is an audit trail and a UX. Models read:

1. Stage + phase
2. Compact **StoryState** for this novel/thread
3. Retrieved slices (this scene, this chapter, this kit section)
4. A short recent window
5. The new user message

### 5.2 Logical diagram

```
                         ┌─────────────────────────────────────┐
  Writer (unchanged UI)  │  SSE chat / editor / upload studio  │
                         └──────────────────┬──────────────────┘
                                            │ HTTP + JWT
                         ┌──────────────────▼──────────────────┐
                         │  Express (auth, billing, streams)    │
                         └──────────────────┬──────────────────┘
                                            │
                         ┌──────────────────▼──────────────────┐
                         │  Story Runtime                       │
                         │  - Stage graph (Simone / Olivia /    │
                         │    Ellis / studio)                   │
                         │  - Intent router (cheap model)       │
                         │  - Artifact store (Mongo)            │
                         │  - Retriever (state + optional vec)  │
                         │  - Model router (nano/mini/5.4)      │
                         └──────────────┬───────────┬───────────┘
                                        │           │
                               ┌────────▼──┐   ┌────▼────┐
                               │  Mongo    │   │ OpenAI  │
                               │  artifacts│   │ Responses│
                               └───────────┘   └─────────┘
```

Express stays the HTTP edge. Story Runtime is a service folder (`service/storyRuntime/` or similar), not a new public API for the browser. Existing routes keep their URLs.

### 5.3 Artifact types (canonical)

Extend what Memory V2 already started (`StoryState`, `SceneMemory`, `CharacterState`, `ConversationCursor`). Add intake artifacts that **dashboard chat currently lacks**.

| Artifact | Written by | Read by | Typical size |
|---|---|---|---|
| `IntakeState` (Simone) | After each Simone answer (mini extract) | Next Simone turn; kit compile | Small JSON (title, genre, premise, protagonist, …) |
| `StarterKit` | Simone compile node (5.4, once) | Olivia handoff, dashboard copy | One markdown/JSON kit |
| `IntakeState` (Olivia) | After each Bible question | Next Olivia turn; compile | Small JSON |
| `StoryBible` + dossiers | Olivia compile (5.4, once) | Studio, Ellis, cover | Bounded; not full chat |
| `Outline` / `SceneDesign[1..15]` | Studio nodes | Draft, layering, Ellis | Per-scene docs |
| `Draft[scene]` | Writer + optional rich-scene node | Coaching, Ellis | Per scene |
| `ManuscriptMap`, `EditorialLetter`, `ChapterReview[n]` | Ellis nodes | Later Ellis turns, cover | Per chapter, not whole MS every time |

Handoff Simone → Olivia today copies **the kit message text** into a hidden starter-kit Message (`chatController` / `createOliviaThread`). Keep that UX. Internally, Olivia should load `StarterKit` + `IntakeState`, not the Simone Q&A transcript.

### 5.4 Stage graph (conceptual)

Each coach is a subgraph. LangGraph terminology maps cleanly; implementation can be a switch statement until it is not.

**Simone subgraph**

1. `route` — cheap: greeting vs answer vs “compile kit now”
2. `extract` — mini: merge answers into `IntakeState` (schema, not prose)
3. `ask_next` — 5.4 **or** templated next question from remaining schema slots (often no model)
4. `compile_kit` — 5.4 once: produce `StarterKit` from `IntakeState` + last few turns
5. `scope_guard` — existing Simone spend cap stays; manuscript pages divert to Ellis message

**Olivia Bible subgraph** — same pattern: extract → slot fill → compile bible/dossiers.

**Olivia studio subgraph** — already closest: focus scene + assembler. Change: default **off** full 60k canon; retrieve cast/scene; 5.4 only for scene design / rich scene / coaching.

**Ellis subgraph**

1. Map / chunk manuscript **once** (no interpreter unless parsing fails)
2. Letter from map + sampled chapters, not infinite history
3. Chapter \(n\) review: chapter text + letter excerpt + map row + prior review **summary**, not chapters 1…\(n-1\) full reviews (`reviewNovel` loop today)

### 5.5 Model router

| Job | Model class |
|---|---|
| Intent / “which question was that?” / JSON extract into IntakeState | `gpt-5.4-nano` or mini |
| Rolling summary, episodic extract (existing `memoryWorker`) | mini (already intended) |
| Next canned intake question | **No model** if schema says Q7 next |
| Kit / Bible / editorial letter / rich scene / Scene Design | `gpt-5.4` (or later eval) |
| Cover brief | mini (already `COVER_CONTEXT_SUMMARY_MODEL`) |

Do not run `code_interpreter` on story JSON jobs. It is attached today on generate/review/ellis/olivia-scenes paths in `responsesApiService.js`. That adds tool latency and tokens for work that is structured text.

### 5.6 Caching and chaining

- Keep **Responses API** `previous_response_id` for hot conversational turns **after** state is in the artifact (Olivia editor already does this).
- Keep **stable `instructions`** (assembler already splits instructions vs input for cache). Dashboard chat should do the same: agent prompt + security suffix as `instructions`, not stuffed into `input`.
- Reset chain on artifact mutation (kit rewritten, scene saved) — `memoryInvalidator.js` already has this idea.
- Cap chain length (already `OLIVIA_CHAIN_MAX_TURNS = 12`).

### 5.7 Retrieval

Turn **on** novel vector store only after artifacts are clean. Until then, Mongo slices are enough: `IntakeState` fields, `SceneMemory` for scene \(i\), chapter body for Ellis \(n\).

LlamaIndex-style RAG is a retrieval node, not a replacement for IntakeState.

---

## 6. Frontend impact

| Change | Required? |
|---|---|
| Chat SSE contract | No |
| Progress strip (Question X of 20) | Keep; can later drive from `IntakeState.slotsFilled` instead of regex on `Question N:` |
| Kit / Bible completion CTAs | Keep string detection **or** switch to `artifact.status === "compiled"` (more reliable) |
| Handoff to Olivia | Same button; backend seeds Olivia from `StarterKit` |
| New screens | None for phase 1–2 |

Optional later: show “Simone saved: genre = X” as a side panel. Not required to save money.

---

## 7. Phased delivery

### Phase 0 — Measure (1 week, no model change)

Use existing `ApiUsageLog` / admin usage dashboard.

Break down cost by `endpoint` + `agentName` + `model`:

- `chat-stream` Simone vs Olivia vs Ellis
- `generateStory` scene loop
- `ellisReview` / chapter loops
- editor `olivia-chat`

Record p50/p95 `promptTokens` vs `cachedInputTokens` vs `N` turns. This proves which quadratic curve to kill first. Do not skip this; otherwise LangGraph work will be justified with anecdotes.

### Phase 1 — Stop the two biggest leaks (highest $ / engineering hour)

1. **Simone/Olivia dashboard `IntakeState` + enable `DASHBOARD_CHAT_MEMORY_V2_ENABLED`.** After each user turn, mini-extract into JSON; inject JSON as the memory block; window last k messages. This is the flag that is false **on purpose** today — turning it on without extract will regress quality. Tests: `__tests__/dashboardChatMemory.test.mjs` currently asserts the flag is false; invert that once extract exists.
2. **Break quadratic batch loops.** `generateStoryFromResponses` and the Ellis `chapterList` loop must not append full previous completions. Pass artifact slices only. Drop `code_interpreter` unless a parser node fails.
3. **Turn off `OLIVIA_FULL_CANON_CONTEXT_ENABLED` in production** (or drop budget from 60k to the 8–12k assembler budgets already defined). Keep a “canon Q&A” expansion path (`OLIVIA_CANON_EXPANSION_TOKEN_BUDGET`) for “who are my characters?”.

Success metric: p95 input tokens per Simone turn flat vs \(N\); kit quality checklist (logline, synopsis, comps, score) unchanged on a golden set of 10 threads.

### Phase 2 — Handoffs are artifacts

- Persist `StarterKit` document; Olivia thread create reads it, not 20k of Simone transcript.
- Persist compiled Story Bible separately from chat (partially exists as `Novel.storyBible` / `masterPrompt` — make compile an explicit node, not “whatever the last long message was”).
- Ellis chapter review reads letter excerpt + chapter, not growing chat.

### Phase 3 — Orchestrator (LangGraph.js only if needed)

If phase 1–2 leaves a tangle of `if (agent === simone && phase === compile)` in controllers, extract `service/storyRuntime/graphs/` using **LangGraph.js**:

- Checkpoint state in Mongo (or LangGraph checkpointer)
- Nodes call existing `callResponsesAPI` / stream helper
- Human-in-the-loop = the writer’s next chat message (interrupt)

Do **not** stand up Python LangGraph unless we hire a separate worker fleet. Streaming and JWT already live in Node.

### Phase 4 — Optional

- Enable `OLIVIA_NOVEL_VECTOR_STORE_ENABLED` for large bibles
- Per-node model eval (mini vs 5.4 for kit compile)
- Prompt-cache dashboards (`cached_tokens` / `promptTokens`)
- Batch API for overnight Ellis map jobs (non-interactive)

---

## 8. Quality guardrails (non-negotiable)

The reason memory V2 is off on dashboard is quality. The new architecture must encode that in tests, not comments.

- **Golden threads:** freeze 5 Simone kits and 3 Olivia bibles; after extract+window, compile output must still contain required sections.
- **Slot completeness:** kit compile refused until required `IntakeState` keys are filled (or writer skipped with explicit marker).
- **No silent truncation:** if retrieval drops a character, the coach must not invent them; assembler already has canon integrity rules — keep them.
- **Spend cap:** keep Simone session cap (`constants/simoneSession.js`); runtime should fail closed.

---

## 9. What we will not do

- Replace the SPA with a LangGraph Studio UI.
- Move auth/billing into the graph.
- Multi-agent “debate” patterns.
- Send the full transcript “just to be safe” on compile turns — compile reads artifacts; a short window is enough for tone.
- A big-bang rewrite of Olivia Memory V2. Studio path is the template; dashboard and batch jobs should **converge on it**, then slim the 60k canon exception.

---

## 10. Suggested ownership and files

| Area | Likely files (existing) |
|---|---|
| Dashboard full-history | `controllers/chatController.js`, `service/responsesApiService.js`, `constants/oliviaMemory.js` |
| Intake extract | new `service/storyRuntime/intakeExtract.js` + `models/intakeStateModel.js` |
| Batch quadratic | `generateStoryFromResponses`, Ellis chapter loop in `responsesApiService.js` |
| Studio canon budget | `constants/oliviaMemory.js`, `service/contextAssembler.js` |
| Usage proof | `utils/logApiUsage.js`, `/api/admin/usage` |
| Tests | `__tests__/dashboardChatMemory.test.mjs`, assembler budget tests |

---

## 11. Decision summary

| Question | Answer |
|---|---|
| Is LangGraph the best fit? | **Good orchestrator later.** Wrong first move. |
| What is the best fit now? | **Staged artifacts + windowed chat + model router**, extending Memory V2 to Simone/Olivia dashboard and to batch jobs. |
| What cuts cost immediately? | Stop O(N²) full-history `gpt-5.4` on `/api/v1/chat`; stop growing `conversationHistory` in scene/chapter loops; stop 60k full canon on every studio chain start; stop `code_interpreter` on JSON jobs. |
| What keeps quality? | Extract intake into schema **before** enabling dashboard memory V2. |

Next step after this document is accepted: Phase 0 measurement query on `ApiUsageLog`, then a Phase 1 implementation ticket list (not a second architecture essay).
