# System architecture — storygroove-be

## Purpose

The **storygroove-be** service is the **authoritative HTTP API** for Story Groove novel data, AI-assisted writing, agent chat, subscriptions, and administrative usage reporting. A separate **React SPA** (not in this repo) consumes this API.

## High-level diagram

```text
                     ┌─────────────────┐
Browser / SPA ──────►│  Express (API)   │
                     │  storygroove-be  │
                     └────────┬────────┘
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
     ┌─────────┐      ┌──────────┐      ┌──────────┐
     │ MongoDB │      │ OpenAI   │      │  Stripe  │
     │(Mongoose)      │Responses/│      │ REST +   │
     └─────────┘      │Assistants│      │ webhooks │
                      └──────────┘      └──────────┘
          │
          ▼
     ┌─────────┐
     │ AWS S3  │  (user uploads, generated assets; GET /userData/* proxy)
     └─────────┘
```

## Major components

| Component | Responsibility |
|-----------|----------------|
| **Express app** (`index.js`) | Routing, CORS, JSON limits, Stripe webhook (raw body), S3 asset proxy, static backgrounds |
| **Routers** (`routers/`) | HTTP surface: `/api/user`, `/api/novel`, `/api/v1`, `/api/assistant`, `/api/stripe`, `/api/subscription`, `/api/admin/*` |
| **Controllers** (`controllers/`) | Request validation, orchestration, MongoDB access |
| **Services** (`service/`) | OpenAI clients, Stripe helpers, S3, Olivia memory / retrieval / methodology |
| **Models** (`models/`) | Persistence schemas and indexes |
| **Middleware** (`middleware/`, `config/tokenverify.js`) | JWT, subscription gating, roles, rate limiting |

## External systems

- **MongoDB**: primary data store; connection in `config/db.js` using `MONGO_URI` / `MONGODB_NAME`.
- **OpenAI**: story generation, Ellis/Olivia pipelines, Simone/Olivia chat; default path uses **Responses API** (`service/responsesApiService.js`).
- **Stripe**: subscription lifecycle, customer portal, Simone one-time checkout; **webhook** at `POST /webhook`.
- **AWS S3**: optional object storage for uploads and generated media; **GetObject** proxy for `GET /userData/*`.

## Non-goals (in this repo)

- Serving the React UI build (handled by the frontend app or CDN).
- Server-side rendered HTML pages.
