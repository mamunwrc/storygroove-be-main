# API versioning policy — storygroove-be

## Philosophy

Routing favors **explicit path segments** for meaningful variants instead of global **`/api/v1`** versioning across the board.

## Current patterns

| Pattern | Meaning | Examples |
|---------|---------|-----------|
| `/api/v1/...` | **Chat subsystem** Responses API defaults | `/api/v1/chat`, `/api/v1/thread` |
| `.../v2/...` | Alternate response shape alongside legacy | Stripe **`/api/stripe/v2/get`**, subscription **`/api/subscription/v2/list`** |
| `*-old` suffix | Deprecated Assistants API parity | `/api/v1/chat-old`, `/api/novel/generate-old`, etc. |

## Breaking changes

Prefer introducing **new routes** (`/v2`, `-old`) or additive JSON fields rather than silently changing behaviors of existing URLs used by deployed SPAs.

## Client expectations

The React client typically targets **`REACT_APP_BASE_URL`**. Maintain backward-compatible routes until all clients migrate.
