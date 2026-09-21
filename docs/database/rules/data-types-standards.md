# Data type standards — storygroove-be

Use Mongoose schema types aligned with how data is produced and consumed.

| Kind | Mongoose type | Notes |
|------|---------------|-------|
| Identifiers | `ObjectId` | Store references; use `ref` for `populate` when needed |
| Free text | `String` | Large markdown/HTML lives in string fields; watch document size |
| Rich subdocuments | nested `Schema` or `[subSchema]` | Prefer explicit sub-schemas for arrays of structured objects |
| Enumerations | `String` with `enum` | Keep values in sync with frontend constants |
| Flags | `Boolean` | Default explicitly |
| Counts | `Number` | Use `min`/`max` when applicable |
| Money (Stripe) | `Number` or String depending on field | Follow existing `Subscription` / `Invoice` patterns |
| Dates | `Date` | Use server-side `new Date()` or ISO strings parsed once |
| Mixed / untyped | `mongoose.Schema.Types.Mixed` | Avoid unless ingesting arbitrary provider payloads |

### JSON from OpenAI

Store provider responses in **String** (serialized) or structured subdocuments when you need queryability—balance document size against MongoDB’s 16MB limit per document.

### Arrays

Default empty arrays for list fields that are always iterable client-side.
