# API documentation — storygroove-be

Reference for HTTP endpoints implemented in this service. All paths are relative to the **API host** (e.g. `http://localhost:8086` in development).

## Layout

| Path | Description |
|------|----------------|
| [contracts/api-overview.md](contracts/api-overview.md) | Auth, errors, global behavior |
| [contracts/versioning-policy.md](contracts/versioning-policy.md) | URL versioning conventions |
| [endpoints/novel-endpoints.md](endpoints/novel-endpoints.md) | `/api/novel` |
| [endpoints/user-endpoints.md](endpoints/user-endpoints.md) | `/api/user` |
| [endpoints/chat-endpoints.md](endpoints/chat-endpoints.md) | `/api/v1` |
| [endpoints/assistant-endpoints.md](endpoints/assistant-endpoints.md) | `/api/assistant` |
| [endpoints/stripe-subscription-endpoints.md](endpoints/stripe-subscription-endpoints.md) | `/api/stripe`, `/api/subscription` |
| [endpoints/admin-endpoints.md](endpoints/admin-endpoints.md) | `/api/admin/*` |

Additional non-API routes documented in **`architecture/application-architecture.md`**: **`POST /webhook`**, **`GET /userData/*`**, **`GET /backgrounds/*`**, **`GET /`**.

End-to-end product journey (operator): [user-guide](../user-guide/README.md).
