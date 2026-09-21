/**
 * Run: node --test storygroove-be/__tests__/characterCanonContext.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  isCanonInventoryQuery,
  classifyOliviaCanonIntent,
  selectCharactersForContext,
  CANON_QUERY_DOSSIER_CHARS,
  MENTIONED_CHARACTER_DOSSIER_CHARS,
  buildChainHotMemoryBlock,
  stripDossierBlocksFromMasterPrompt,
  buildStoryBibleCanonExcerpt,
  buildNovelFoundationBlock,
  buildFallbackCastFromNovel,
  resolveCharactersForOlivia,
  isSparseCanon,
} = await import("../service/characterCanonContext.js");

const { OLIVIA_CANON_INTEGRITY_RULE } = await import(
  "../constants/oliviaUiMessages.js"
);

test("isCanonInventoryQuery detects story bible and roster questions", () => {
  assert.equal(isCanonInventoryQuery("what you know about Story Bible"), true);
  assert.equal(isCanonInventoryQuery("what characters you have"), true);
  assert.equal(isCanonInventoryQuery("what information you have about David Mercer"), true);
  assert.equal(isCanonInventoryQuery("write scene 3 with more tension"), false);
});

test("classifyOliviaCanonIntent detects dossier and named character questions", () => {
  const chars = [
    { _id: "1", name: "David Mercer", character: "protagonist" },
    { _id: "2", name: "Bob", character: "supporting character" },
  ];
  assert.equal(
    classifyOliviaCanonIntent("What's in David Mercer's 17-point dossier?", chars)
      .requiresCanonExpansion,
    true
  );
  assert.equal(
    classifyOliviaCanonIntent("Tell me about David Mercer", chars).hasNamedCharacterQuestion,
    true
  );
  assert.equal(
    classifyOliviaCanonIntent("list all character dossiers", chars).dossierQuery,
    true
  );
  assert.equal(
    classifyOliviaCanonIntent("continue scene 3 with more tension", chars)
      .requiresCanonExpansion,
    false
  );
  assert.equal(
    classifyOliviaCanonIntent("Who is David Mercer?", chars).requiresCanonExpansion,
    true
  );
});

test("selectCharactersForContext uses higher canon cap and full dossier for mentions", () => {
  const chars = [
    { _id: "1", name: "Alice", character: "protagonist", responseText: "x".repeat(5000) },
    { _id: "2", name: "Bob", character: "supporting character", responseText: "y".repeat(500) },
  ];
  const canon = selectCharactersForContext(chars, [], "list all characters");
  assert.equal(canon.includeAll, true);
  assert.equal(canon.dossierMaxChars, CANON_QUERY_DOSSIER_CHARS);

  const named = selectCharactersForContext(chars, ["2"], "Tell me about Bob", {
    requiresCanonExpansion: true,
    mentionedIds: ["2"],
  });
  assert.ok(named.fullDossierCharacterIds.has("2"));
  assert.equal(MENTIONED_CHARACTER_DOSSIER_CHARS, 0);
});

test("buildChainHotMemoryBlock includes antagonist full dossier", () => {
  const chars = [
    {
      _id: "1",
      name: "Lola Reyes",
      character: "protagonist",
      responseText: "Protagonist bio ".repeat(50),
    },
    {
      _id: "2",
      name: "Marcus Reyes",
      character: "antagonist",
      responseText: "**Marcus Reyes: 17-Point Dossier**\nAge: 45\nRole: Husband",
    },
  ];
  const block = buildChainHotMemoryBlock({
    novel: { storyBible: "**Genre**\nWomen's Fiction" },
    characters: chars,
    characterStates: [],
    mentionedIds: [],
  });
  assert.ok(block?.content?.includes("Marcus Reyes"));
  assert.ok(block.content.includes("Age: 45"));
  assert.ok(block.content.includes("Women's Fiction"));
});

test("buildChainHotMemoryBlock lists the full cast roster but full dossier only for leads/mentioned", () => {
  const chars = [
    {
      _id: "1",
      name: "Lola Reyes",
      character: "protagonist",
      responseText: "Lead bio with secret history ".repeat(20),
    },
    {
      _id: "2",
      name: "Ana Vance",
      character: "supporting character",
      responseText: "Side dossier detail UNIQUEMARKER ".repeat(20),
    },
  ];
  const block = buildChainHotMemoryBlock({
    novel: { storyBible: "**Genre**\nWomen's Fiction" },
    characters: chars,
    characterStates: [],
    mentionedIds: [],
  });
  // The complete roster (names + roles) is present, including the non-lead,
  // non-mentioned side character — so Olivia cannot invent a stand-in for her.
  assert.ok(block?.content?.includes("Lola Reyes"));
  assert.ok(block.content.includes("Ana Vance"));
  // But the side character's full dossier body is NOT shipped on the chain-hot
  // turn (only leads/mentioned get dossiers).
  assert.ok(!block.content.includes("UNIQUEMARKER"));
});

test("buildChainHotMemoryBlock stays non-null when there are supporting characters but no leads/mentioned", () => {
  const chars = [
    { _id: "2", name: "Ana Vance", character: "supporting character" },
    { _id: "3", name: "Bea Cruz", character: "supporting character" },
  ];
  const block = buildChainHotMemoryBlock({
    novel: {},
    characters: chars,
    characterStates: [],
    mentionedIds: [],
  });
  assert.ok(block?.content?.includes("Ana Vance"));
  assert.ok(block.content.includes("Bea Cruz"));
});

test("OLIVIA_CANON_INTEGRITY_RULE forbids new names and supersedes naming rules", () => {
  const rule = OLIVIA_CANON_INTEGRITY_RULE;
  assert.match(rule, /NEVER invent/i);
  assert.match(rule, /SUPERSEDES/);
  assert.match(rule, /generic (role )?label/i);
  assert.match(rule, /ONLY/);
});

test("selectCharactersForContext returns full roster on canon query", () => {
  const chars = [
    { _id: "1", name: "Alice", character: "protagonist" },
    { _id: "2", name: "Bob", character: "supporting character" },
  ];
  const { characters, includeAll } = selectCharactersForContext(chars, [], "list all characters");
  assert.equal(includeAll, true);
  assert.equal(characters.length, 2);
});

test("stripDossierBlocksFromMasterPrompt keeps setup sections", () => {
  const mp = `**1. Genre**\nFantasy\n\n**👤 David Mercer: 17-Point Dossier**\n1. Archetype\nHero`;
  const stripped = stripDossierBlocksFromMasterPrompt(mp);
  assert.match(stripped, /Fantasy/);
  assert.doesNotMatch(stripped, /Archetype/);
});

test("stripDossierBlocksFromMasterPrompt cuts at CHARACTER DOSSIERS section heading", () => {
  const mp = [
    "**📘 Story Bible**",
    "",
    "**1. Genre**",
    "Contemporary Women's Fiction",
    "",
    "✨ This is the heartbeat of your novel: your **Story Bible**.",
    "🎭 One more beautiful piece: I've also built **17-point character dossiers** ...",
    "",
    "**👤 CHARACTER DOSSIERS — 17-Point Dossiers**",
    "",
    "**👤 Lola Reyes: 17-Point Dossier**",
    "Age: 40",
    "",
    "**👤 Marcus Reyes: 17-Point Dossier**",
    "Age: 45",
    "",
    "**👤 Camila Virelli: 17-Point Dossier**",
    "Age: 41",
    "",
    "🎭 Here are your full **17-point character dossiers** ...",
  ].join("\n");
  const stripped = stripDossierBlocksFromMasterPrompt(mp);
  assert.match(stripped, /Story Bible/);
  assert.match(stripped, /Contemporary Women's Fiction/);
  assert.doesNotMatch(stripped, /CHARACTER DOSSIERS/);
  assert.doesNotMatch(stripped, /Camila Virelli/);
  assert.doesNotMatch(stripped, /Marcus Reyes/);
  assert.doesNotMatch(stripped, /Age:\s*41/);
  assert.doesNotMatch(stripped, /Here are your full/);
});

test("stripDossierBlocksFromMasterPrompt is idempotent when no dossiers present", () => {
  const mp = "**📘 Story Bible**\n\n**1. Genre**\nThriller";
  const stripped = stripDossierBlocksFromMasterPrompt(mp);
  assert.equal(stripped, mp.trim());
  assert.equal(stripDossierBlocksFromMasterPrompt(stripped), stripped);
});

test("stripDossierBlocksFromMasterPrompt legacy fallback strips per-block dossier when section heading is missing", () => {
  const mp = [
    "**📘 Story Bible**",
    "",
    "**1. Genre**",
    "Mystery",
    "",
    "**👤 Alice Carter: 17-Point Dossier**",
    "1. Archetype",
    "Detective",
    "",
    "**👤 Bob Frank: 17-Point Dossier**",
    "1. Archetype",
    "Suspect",
  ].join("\n");
  const stripped = stripDossierBlocksFromMasterPrompt(mp);
  assert.match(stripped, /Mystery/);
  assert.doesNotMatch(stripped, /Alice Carter/);
  assert.doesNotMatch(stripped, /Bob Frank/);
  assert.doesNotMatch(stripped, /Archetype/);
});

test("buildStoryBibleCanonExcerpt includes non-dossier master prompt", () => {
  const excerpt = buildStoryBibleCanonExcerpt("**1. Genre**\nThriller\n", {});
  assert.match(excerpt, /STORY BIBLE/);
  assert.match(excerpt, /Thriller/);
});

test("buildNovelFoundationBlock uses novel fields when no masterPrompt", () => {
  const block = buildNovelFoundationBlock({
    name: "Test Book",
    genre: "Mystery",
    protagonist: "Jane Doe",
    protagonistDescription: "A retired detective.",
  });
  assert.match(block, /Jane Doe/);
  assert.match(block, /retired detective/);
});

test("resolveCharactersForOlivia falls back to novel cast without DB dossiers", () => {
  const novel = {
    protagonist: "David Mercer",
    protagonistDescription: "War correspondent with a guilty past.",
    antagonist: "The Colonel",
    antagonistMotivation: "Wants to bury the truth.",
  };
  const chars = resolveCharactersForOlivia(novel, "novel123", []);
  assert.ok(chars.length >= 2);
  assert.ok(chars.some((c) => /David Mercer/i.test(c.name) && /correspondent/i.test(c.responseText)));
  assert.equal(isSparseCanon(novel, chars), false);
});

test("selectCharactersForContext includes all when sparseCanon", () => {
  const chars = [
    { _id: "1", name: "A", character: "protagonist", responseText: "Bio A" },
    { _id: "2", name: "B", character: "supporting character", responseText: "Bio B" },
  ];
  const { includeAll } = selectCharactersForContext(chars, [], "continue scene", {
    sparseCanon: true,
  });
  assert.equal(includeAll, true);
});
