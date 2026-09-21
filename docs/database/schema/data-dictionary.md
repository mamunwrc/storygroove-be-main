# Data dictionary — storygroove-be

This dictionary highlights **cross-cutting identifiers** and **relationships**. For verbatim field lists open the referenced `models/*.js` files.

## Identifiers

- **`_id`**: MongoDB **`ObjectId`** primary key on all persisted documents unless noted.
- **`user` / `userId`**: reference to **`User`**; API code must constrain queries using **`req.user._id`** unless acting as elevated admin tooling.
- **`novel` / implicit novel linkage**: Novel-scoped docs include **`Novel`** `ObjectId` or are reachable only through novel routes (controllers enforce ownership).
- **`threadId`**: external string identifier returned to clients (`Thread.threadId`), distinct from `_id`.

## Novel (`Novel`)

- **`user`** (required): owning account.
- **`storyBible`**: dossier-free narrative bible excerpt used in prompts (`masterPrompt` remains legacy snapshot container).
- **`deletedAt`**: soft-delete; default queries exclude deleted rows unless `includeDeleted` option is set per schema middleware.
- **`oliviaSceneMemoryVectorStoreId`**: OpenAI vector store for advanced retrieval (nullable on older novels).
- **`oliviaLayeredInserts`**: mapping between layering stable keys and outline `promptKey` values.

## User (`User`)

- **`username`**, **`email`**: unique where configured in schema validations.
- **`password`**: hashed; authentication compares via model helper.
- **`stripeCustomerId`**: binds user to Stripe customer for subscription lookups.
- **`role`**: `superadmin`, `admin`, or `user` (defaults to `user`)

## Subscriber (`Subscriber`)

- **`userid`**: FK-style reference to **`User`**.
- **`cycleEndingOn`**: consulted by admin dashboards and entitlement helpers outside `isSubscribedUser` paths.

## Thread / Message

- **`Thread.agentName`**: drives subscription agent gating for `/api/v1` POST endpoints.
- **`Message`**: chronological chat rows; retrieval via `chatController` aggregates.

## Memory V2 triple (`StoryState`, `SceneMemory`, `EpisodicEvent`)

Used when **`OLIVIA_MEMORY_V2_ENABLED`** is truthy:

- **`StoryState`**: hierarchical summary of arcs and beats (see schema for nested shape).
- **`SceneMemory`**: text + metadata keyed by `(novel, scene)`.
- **`EpisodicEvent`**, **`RelationshipEdge`**: retrieval surfaces for assembler/rerank logic.

---

Update this file whenever new query parameters or webhook-driven fields alter externally visible semantics.
