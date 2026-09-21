import mongoose from "mongoose";

const CharacterSchema = new mongoose.Schema(
  {
    novel: { type: mongoose.Schema.Types.ObjectId, ref: "Novel", required: true },
    archetype: { type: String },
    role: { type: String },
    name: { type: String, required: true },
    age: { type: String },
    gender: { type: String },
    occupation: { type: String },
    ethnicity: { type: String },
    appearance: { type: String },
    style: { type: String },
    traits: { type: String },
    responseText: { type: String },
    characterId: { type: mongoose.Schema.Types.ObjectId },
    character: { type: String, required: true },
    /**
     * Phase 2 — optional list of nicknames / variant spellings used
     * by the assembler to match user-message mentions to this
     * character even when the prose says "Mom" or "Eli" instead of
     * the canonical name.
     */
    aliases: { type: [String], default: [] },
    /**
     * Writer-defined display order in the Characters tab (0-based).
     * Unset until the first reorder so list order stays insertion/natural.
     */
    sortOrder: { type: Number },
  },
  { timestamps: true }
);

// Uniqueness is by (novel, name, character type) for all cast types so a
// novel may have multiple protagonists and multiple antagonists. The legacy
// single-slot unique index on { novel, character } for protagonist/antagonist
// must be dropped in MongoDB on deploy (Mongoose will not remove it).
CharacterSchema.index(
  { novel: 1, name: 1, character: 1 },
  {
    unique: true,
    partialFilterExpression: { character: { $exists: true } },
  }
);

const Character = mongoose.model("Character", CharacterSchema);
export default Character;
