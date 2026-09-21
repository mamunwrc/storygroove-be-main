import test from "node:test";
import assert from "node:assert/strict";

import {
  detectCoverGenerateIntent,
  detectIncrementalRefinement,
  applyCoverClassifierDecision,
  resolveCoverUserActionHeuristic,
  isCoverActionClassifierEnabled,
  resolveCoverUserAction,
} from "../service/coverUserActionResolver.js";
import { COVER_METADATA_KIND_GENERATE_OFFER } from "../constants/coverUiMessages.js";

const renderedCoverMessages = [
  {
    role: "assistant",
    kind: "render_notice",
    text: "Cover version 1 is ready.",
  },
];

const pendingOfferMessages = [
  ...renderedCoverMessages,
  {
    role: "assistant",
    kind: "chat",
    metadata: { kind: COVER_METADATA_KIND_GENERATE_OFFER },
    text: "Click Generate cover image on this message when you are ready.",
  },
];

test("detectCoverGenerateIntent matches explicit generate phrasing", () => {
  assert.equal(
    detectCoverGenerateIntent("let's generate it", { priorMessages: [] }),
    true
  );
  assert.equal(
    detectCoverGenerateIntent("create a cover image", { priorMessages: [] }),
    true
  );
  assert.equal(
    detectCoverGenerateIntent("deliver cover", { priorMessages: [] }),
    true
  );
});

test("detectCoverGenerateIntent does not match title-only refinement without classifier", () => {
  assert.equal(
    detectCoverGenerateIntent(
      "I like this cover but keep title as Valley of the Dudes only",
      { priorMessages: renderedCoverMessages }
    ),
    false
  );
});

test("detectIncrementalRefinement requires prior cover or working concept", () => {
  assert.equal(
    detectIncrementalRefinement("keep the title as Lunatics only", {
      priorMessages: renderedCoverMessages,
      hasWorkingConcept: false,
    }),
    true
  );
  assert.equal(
    detectIncrementalRefinement("keep the title as Lunatics only", {
      priorMessages: [],
      hasWorkingConcept: false,
    }),
    false
  );
});

test("applyCoverClassifierDecision maps incremental title fix to offer_generation", () => {
  const result = applyCoverClassifierDecision({
    parsed: {
      action: "offer_generation",
      refinementMode: "incremental",
      confidence: "high",
    },
    priorMessages: renderedCoverMessages,
    hasWorkingConcept: true,
  });
  assert.deepEqual(result, {
    action: "offer_generation",
    source: "classifier",
    refinementMode: "incremental",
  });
});

test("applyCoverClassifierDecision downgrades incremental without prior cover", () => {
  const result = applyCoverClassifierDecision({
    parsed: {
      action: "offer_generation",
      refinementMode: "incremental",
      confidence: "high",
    },
    priorMessages: [],
    hasWorkingConcept: false,
  });
  assert.deepEqual(result, {
    action: "offer_generation",
    source: "classifier",
    refinementMode: "full",
  });
});

test("resolveCoverUserActionHeuristic prefers refine_concept for visual direction", () => {
  const result = resolveCoverUserActionHeuristic({
    message: "make the palette darker and more gothic",
    priorMessages: [],
    hasAttachments: false,
    hasWorkingConcept: false,
  });
  assert.equal(result.action, "refine_concept");
  assert.equal(result.source, "visual_direction");
});

test("resolveCoverUserAction uses regex fast-path without openai", async () => {
  const result = await resolveCoverUserAction({
    message: "generate it",
    priorMessages: pendingOfferMessages,
    hasWorkingConcept: true,
  });
  assert.equal(result.action, "offer_generation");
  assert.equal(result.source, "generate_intent");
});

test("resolveCoverUserAction falls back to heuristic when classifier disabled", async () => {
  const prev = process.env.COVER_ACTION_CLASSIFIER_ENABLED;
  process.env.COVER_ACTION_CLASSIFIER_ENABLED = "false";
  try {
    const result = await resolveCoverUserAction({
      message: "try a darker purple palette with more gothic mood",
      priorMessages: [],
      hasWorkingConcept: false,
      openai: {},
      model: "gpt-test",
    });
    assert.equal(result.action, "refine_concept");
    assert.equal(result.source, "visual_direction");
  } finally {
    if (prev === undefined) {
      delete process.env.COVER_ACTION_CLASSIFIER_ENABLED;
    } else {
      process.env.COVER_ACTION_CLASSIFIER_ENABLED = prev;
    }
  }
});

test("isCoverActionClassifierEnabled defaults to true", () => {
  const prev = process.env.COVER_ACTION_CLASSIFIER_ENABLED;
  delete process.env.COVER_ACTION_CLASSIFIER_ENABLED;
  try {
    assert.equal(isCoverActionClassifierEnabled(), true);
  } finally {
    if (prev === undefined) {
      delete process.env.COVER_ACTION_CLASSIFIER_ENABLED;
    } else {
      process.env.COVER_ACTION_CLASSIFIER_ENABLED = prev;
    }
  }
});
