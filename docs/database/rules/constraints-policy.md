# Constraints policy — storygroove-be

MongoDB does not enforce relational constraints like SQL **FOREIGN KEY** — application code and Mongoose schema options provide integrity.

## Uniqueness

Use `unique: true` index or compound unique indexes when business rules demand a single document per key (e.g. usernames, scene-level artifacts per novel).

## Referential integrity

Validate **ObjectId** shape where relevant and ensure **parent documents** exist before embedding references. On delete flows, either **soft-delete** (preferred for novels) or explicitly cascade in controllers/workers.

## Soft delete

`Novel` applies query middleware to hide documents with **`deletedAt != null`** unless `includeDeleted` is passed in options. Any new models adopting soft delete should document the query hook contract.

## Validation

Use Mongoose **required**, **enum**, **min**/**max**, and custom validators for user-generated fields. For uploads, also validate at Multer / controller level.

## Check constraints

Not applicable in MongoDB for arbitrary predicates—encode business rules in services and transactional updates where needed.
