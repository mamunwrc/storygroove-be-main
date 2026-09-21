# Error handling — storygroove-be

## HTTP responses

Controllers and middleware should return JSON objects with **`error`** and/or **`message`** keys so the SPA can branch predictably.

| Code | Typical cause |
|------|----------------|
| 400 | Malformed JSON, invalid parameters |
| 401 | JWT missing/expired/invalid |
| 403 | Subscription/role/OpenAI-key guard |
| 404 | Missing user/resource |
| 500 | Unexpected exception (logged server-side) |

## Middleware

`config/tokenverify.js` centralizes JWT failures (`TokenExpiredError`, `JsonWebTokenError`). Preserve those shapes when extending auth.

## Global JSON handler

Located in `index.js` for body parser errors—do not duplicate unless replacing the mechanism wholesale.

## Streaming

For SSE/OpenAI streams, fail before streaming begins when possible so clients still receive JSON errors.
