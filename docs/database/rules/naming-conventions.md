# Database naming conventions — storygroove-be

- **Model names**: singular **PascalCase** in JavaScript (`Novel`, `ApiUsageLog`).
- **Collection names**: default Mongoose pluralization / lowercasing unless explicitly overridden—when writing raw aggregations, confirm actual collection string (e.g. pipeline `from: "apiusagelogs"` as used in `apiUsageController.js`).
- **Field names**: prefer **camelCase** (`threadId`, `stripeCustomerId`, `apiUsageStatus`). Legacy fields keep historical spelling—do not bulk-rename without a migration plan.
- **Enums**: store short lowercase or descriptive string tokens matching schema `enum` arrays for predictability in queries and logs.
- **Foreign keys**: store Mongo **`ObjectId`** values; name fields **`user`**, **`userId`**, **`novel`**, etc., consistently with existing models when adding relations.
