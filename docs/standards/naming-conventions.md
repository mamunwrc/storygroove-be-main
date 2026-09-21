# Naming conventions — storygroove-be

- **Files**: `camelCase.js` for source (`novelController.js`).
- **Functions**: `camelCase` verbs (`getNovelDetails`, `isSubscribedUser`).
- **Constants**: `camelCase` for locals; environment variables are `UPPER_SNAKE`.
- **Mongoose models**: `PascalCase` export matching collection intent (`Novel`, `Thread`).
- **Routes**: Express paths use **kebab-case segments** where multi-word (`/activity-logs`, `/create-portal-session`).

When adding new public env vars, prefix clearly (`PRICE_STUDIO_MONTHLY`, `OLIVIA_MEMORY_V2_ENABLED`).
