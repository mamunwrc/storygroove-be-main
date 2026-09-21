# Current schema — storygroove-be

All paths refer to **`storygroove-be/`**. Mongoose **model names** are shown; MongoDB collection names are typically lowercase plural forms of the model name unless overridden.

## User and access

### User (`models/user.js`)

Core account: profile, **hashed password**, **JWT** issuance helpers, **`openaiKey`**, Stripe **`stripeCustomerId`**, Simone one-time fields (`simoneCreditsRemaining`, …), **`role`** (`user` | `admin` | `superadmin`), **`status`**, signup type, **`apiUsageStatus`**, spend limits.

### Token (`models/token.js`)

Password reset tokens (hashed payload + expiry).

### UserAgent (`models/userAgent.js`)

Assistants-era agent metadata keyed to users (legacy paths).

### SimoneConfig (`models/simoneConfigModel.js`)

Shared Simone configuration blob (managed via superadmin API).

### AgentPrompt (`models/agentPromptModel.js`)

Configurable agent prompt documents for admin tooling.

### MethodologyRule, PromptTemplate, GenreOverlay (`methodologyRuleModel.js`, `promptTemplateModel.js`, `genreOverlayModel.js`)

Methodology bundles for Olivia: rules JSON, Markdown templates, per-genre overlays.

## Novels and authoring

### Novel (`novelModel.js`)

Book metadata, **`storyBible`**, layering fields, Olivia thread ids, **`deletedAt`** soft delete with query middleware, vector store id for scene memory Phase 3, timestamps.

### Character (`characterModel.js`)

Characters linked to novels (roles, dossier text). Unique partial index on `{ novel, name, character }` for all cast types (multiple protagonists/antagonists allowed). Legacy unique index on `{ novel, character }` for leads must be dropped in MongoDB on deploy.

### Notes (`notesModel.js`)

Notebook entries per novel.

### UserContent (`userContentModel.js`)

Per-novel prompt slot content keyed by **`promptKey`**.

### StoryResponse (`storyResponseModel.js`)

Stored AI generations tied to workflows.

### Image (`models/image.js`)

Image metadata references (covers, uploads as applicable).

### ReviewPillar (`reviewPillarModel.js`)

Structured review scaffolding.

### EllisSceneReview (`ellisSceneReviewModel.js`)

Ellis outputs per manuscript scene slices.

### OliviaSceneSuggestion (`oliviaSceneSuggestionModel.js`)

Olivia Scene Design structured suggestions.

## Chat

### Thread (`threadModel.js`)

Conversation threads: OpenAI/external **`threadId`**, **`agentName`**, pinning, activity flag.

### Message (`messageModel.js`)

Individual chat messages referencing **Thread**.

## Olivia memory (bounded context)

### StoryState, SceneMemory (`storyStateModel.js`, `sceneMemoryModel.js`)

Aggregated progressive state and per-scene memory text.

### EpisodicEvent, RelationshipEdge (`episodicEventModel.js`, `relationshipEdgeModel.js`)

Retrieval graph for episodic facts and edges.

### ActiveSceneState, ConversationCursor, CharacterState (`activeSceneStateModel.js`, `conversationCursorModel.js`, `characterStateModel.js`)

Focus, cursors, and per-character state for memory pipeline.

### SceneCheckpoint (`sceneCheckpointModel.js`)

Optional checkpoints for Olivia drafting (feature-gated).

## Billing

### Subscriber (`subscriberModel.js`)

Stripe linkage and subscription lifecycle fields (`userid`, Stripe ids, **`cycleEndingOn`**, statuses).

### Subscription (`subscriptionModel.js`)

Commercial **plan catalog** displayed to visitors (DTO builder on instance).

### Invoice (`invoicesModel.js`)

Billing history snapshots from Stripe hooks.

## Operations and auditing

### ApiUsageLog, ApiUsageSettings (`apiUsageLogModel.js`, `apiUsageSettingsModel.js`)

Instrumented AI usage quantities and administrator-configured ceilings.

### RateLimitEvent (`rateLimitEventModel.js`)

Events when users bump configured limits.

### ActivityLog (`activityLogModel.js`)

Cross-module audit rows (module/action/source facets).

---

For exhaustive per-field descriptions, inspect the Mongoose schemas in **`models/`** and extend `data-dictionary.md` whenever you expose new fields externally.
