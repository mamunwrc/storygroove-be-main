# Coding style — storygroove-be

- **Language**: Modern JavaScript with **ES modules**.
- **Semicolons**: Yes, match existing controllers and routers.
- **Quotes**: Either single or double — stay consistent inside a single file when editing.
- **Imports**: Group standard library, vendors, local modules; avoid deep relative chains when refactor can shorten them.
- **Controllers**: Early returns on validation failures; avoid deeply nested conditionals.
- **Async**: Prefer `async`/`await` over long `.then()` chains.

Use `eslint`/`prettier` if the repository adds them; until then mirror neighboring files exactly.
