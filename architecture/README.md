# Architecture documentation — storygroove-be

This directory describes the **backend service** at this repository root (`storygroove-be/`).

## Index

| Document | Contents |
|----------|----------|
| [system-architecture.md](system-architecture.md) | Major components, external systems, high-level diagram |
| [application-architecture.md](application-architecture.md) | Express structure, route mounts, layers |
| [data-flow.md](data-flow.md) | End-to-end flows (auth, novels, chat, billing, Olivia memory) |
| [security-architecture.md](security-architecture.md) | JWT, roles, subscription gates, secrets |
| [infrastructure.md](infrastructure.md) | Runtime, ports, env vars, MongoDB, S3 |
| [ADRs/](ADRs/) | Architectural decisions (example: `0002-stripe-webhook-raw-body.md`, template `0001-template.md`) |
| [staged-ai-architecture.md](staged-ai-architecture.md) | **Proposed** cost/scale plan: artifacts over full-history replay; LangGraph later, not first |
| [ADRs/0003-staged-story-runtime.md](ADRs/0003-staged-story-runtime.md) | ADR for the Story Runtime decision (Proposed) |

## Related documentation

- API reference: `docs/api/`
- Mongoose models: `docs/database/schema/`
- Feature inventory: `docs/features/README.md`
- Operator user guide (checkout → coaches → billing): `docs/user-guide/README.md`
