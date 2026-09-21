# Olivia Methodology Seed Source

This directory holds the **content of the two Olivia methodology PDFs**, extracted into structured markdown so the seed scripts in Phase 1.5A of the [Olivia Memory Pipeline Redesign plan](../../../.cursor/plans/olivia_memory_pipeline_redesign_fd6f1a5d.plan.md) can turn it into Mongo rows without re-reading the PDFs at build time.

## Source PDFs

- `olivia-brain.pdf` — 4-page index/methodology overview (Scene Layering Quality Gate, Pre-Outline Story Bible Retrieval, 15-Scene + Genre Overlay Hierarchy, Book Coaching format).
- `v5_MP.pdf` — 21-page craft engine (Multiple POV, ~24 Genre Overlays, Act/Pacing distribution, 15-Scene Novel Blueprint, Tentpole definition, 15 prompt templates, output format spec, subplot rules).

Both PDFs live at the repository root: `/home/emonsingha/sji-client-project/story-groove/`.

## Layout

```
seed/olivia-methodology/
├── README.md                     ← this file
└── source/
    ├── olivia-brain.md           ← faithful transcription of olivia-brain.pdf
    ├── v5_MP.md                  ← faithful transcription of v5_MP.pdf
    ├── methodology-rules.md      ← organized for the MethodologyRule collection
    ├── prompt-templates.md       ← organized for the PromptTemplate collection (15 entries)
    └── genre-overlays.md         ← organized for the GenreOverlay collection (24 entries)
```

## How to use these during seeding (Phase 1.5A)

1. Engineer reads the three **organized** markdown files (`methodology-rules.md`, `prompt-templates.md`, `genre-overlays.md`).
2. Each `##` heading is one row; the YAML-style key/value block under it maps 1:1 to the Mongoose schema fields in the plan §5.
3. Engineer converts these to JSON (`methodology-rules.json`, `prompt-templates.json`, `genre-overlays.json`) in the parent directory.
4. `scripts/seedMethodologyFromJson.js` upserts the JSON into Mongo by `key` / `sceneIndex` / `genreKey`.
5. The raw transcriptions (`olivia-brain.md`, `v5_MP.md`) stay as canonical reference so any disagreement between source and seed can be traced.

## Conventions used in the organized files

Each row appears under a `##` heading whose name is the **collection's primary key** (`key` / `sceneIndex` / `genreKey`). Under the heading is a key/value block followed by the long-form text content. Example:

```markdown
## scene_layering_quality_gate

- key: scene_layering_quality_gate
- scope: phase
- phase: [phase1_table, phase2_expansion]
- priority: 90
- source: olivia-brain.pdf#scene_layering_quality_gate
- enabled: true
- summary: Every NEW scene must strengthen the 15-scene spine; no filler.

text:

Every NEW scene must build from the existing 15-scene Core Spine...
```

## When the PDFs are re-issued

1. Re-transcribe into `source/olivia-brain.md` / `source/v5_MP.md` (faithful copy).
2. Re-organize affected rows in the bucket files.
3. Re-export JSON.
4. Run `scripts/seedMethodologyFromJson.js --bump-version`.
5. Review snapshot diffs in Phase 1.5C tests before shipping.
