const SIGNATURE_START_RE = /\n\s*Sincerely,\s*\n/i;

const ACT_LEAD_IN_RE =
  /(^|\n\n)(In Act (?:One|Two|Three|[123]|I{1,3}))([,.\s])/gim;

const SECTION_MARKER_SPLIT_RE =
  /([.!?])(["']?)\s+(?=\d\.\s+(?:Core manuscript strengths|Recurring structural risks|Character arc evaluation|Global revision recommendations|Genre[- ]specific performance|Tentpole scenes|Tentpole scene opportunities))/gi;

/** Ellis often bolds chapter refs; unwrap so they render as plain prose. */
const CHAPTER_BOLD_MARKDOWN_RE =
  /\*\*(Chapters?\s+(?:\d+(?:\s+[A-Z])?|[A-Z][a-z]+(?:[\s-][A-Za-z]+)*)(?:\s+(?:and|through|to|–|—|-)\s+(?:\d+(?:\s+[A-Z])?|[A-Z][a-z]+(?:[\s-][A-Za-z]+)*))*)\*\*/gi;

const SECTION_TRANSITIONS = [
  {
    pattern: /^1\.\s+Core manuscript strengths/i,
    label: "1. Core Manuscript Strengths",
  },
  {
    pattern: /^2\.\s+Recurring structural risks/i,
    label: "2. Recurring Structural Risks",
  },
  {
    pattern: /^3\.\s+Character arc evaluation/i,
    label: "3. Character Arc Evaluation",
  },
  {
    pattern: /^4\.\s+Global revision recommendations/i,
    label: "4. Global Revision Recommendations",
  },
  {
    pattern: /^5\.\s+Genre[- ]specific performance/i,
    label: "5. Genre Performance",
  },
  {
    pattern: /^6\.\s+Tentpole scenes/i,
    label: "6. Tentpole Scenes",
  },
  {
    pattern: /^7\.\s+Tentpole scene opportunities/i,
    label: "7. Tentpole Scene Opportunities",
  },
];

/**
 * Turn plain-text (or lightly markdown) editorial letters into structured
 * markdown with clear paragraphs, act emphasis, and a signature block.
 */
export const formatEditorialLetterMarkdown = (raw) => {
  if (!raw) return "";

  let text = String(raw).replace(/\r\n/g, "\n").trim();
  if (!text) return "";

  const signatureIndex = text.search(SIGNATURE_START_RE);
  let body = text;
  let signature = "";

  if (signatureIndex !== -1) {
    body = text.slice(0, signatureIndex).trim();
    signature = text.slice(signatureIndex).trim();
  }

  body = promotePlainTextParagraphs(body);
  body = splitSectionTransitions(body);
  body = emphasizeActLeadIns(body);
  body = formatGreeting(body);
  body = emphasizeSectionTransitions(body);
  body = escapeOrderedListMarkers(body);

  if (signature) {
    signature = formatSignatureBlock(signature);
    return unwrapChapterNameBoldMarkdown(
      escapeOrderedListMarkers(`${body}\n\n---\n\n${signature}`)
    );
  }

  return unwrapChapterNameBoldMarkdown(body);
};

const unwrapChapterNameBoldMarkdown = (text) =>
  text.replace(CHAPTER_BOLD_MARKDOWN_RE, "$1");

const promotePlainTextParagraphs = (text) => {
  let normalized = text.replace(/\n{3,}/g, "\n\n").trim();

  if (/\n\n/.test(normalized)) {
    return normalized
      .split(/\n\n+/)
      .map((block) => block.replace(/\n+/g, " ").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .join("\n\n");
  }

  if (/\n/.test(normalized)) {
    return normalized
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join("\n\n");
  }

  return normalized
    .replace(/([.!?])(["']?)\s+(?=[A-Z"'])/g, "$1$2\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
};

const splitSectionTransitions = (text) =>
  text.replace(SECTION_MARKER_SPLIT_RE, "$1$2\n\n");

const resolveSectionDisplayLabel = (block) => {
  const line = String(block || "").trim();
  for (const { pattern, label } of SECTION_TRANSITIONS) {
    if (pattern.test(line)) return label;
  }
  return null;
};

const emphasizeSectionTransitions = (text) =>
  text
    .split(/\n\n+/)
    .map((block) => {
      const label = resolveSectionDisplayLabel(block);
      if (!label) return block;
      return `**${label}**`;
    })
    .join("\n\n");

const emphasizeActLeadIns = (text) =>
  text.replace(ACT_LEAD_IN_RE, (_, prefix, actPhrase, trailing) => {
    return `${prefix}**${actPhrase.trim()}**${trailing}`;
  });

const formatGreeting = (text) => {
  const match = text.match(/^Hello [^,\n]+,/);
  if (!match) return text;

  const greeting = match[0];
  const rest = text.slice(greeting.length).trim();
  if (!rest) return `**${greeting}**`;
  return `**${greeting}**\n\n${rest}`;
};

/** Prevent CommonMark from turning letter section numbers into <ol><li>. */
const escapeOrderedListMarkers = (text) =>
  text.replace(/^(\d+)\.\s+/gm, "$1\\. ");

const formatSignatureBlock = (signature) => {
  const lines = signature
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return signature;

  const closing = lines[0];
  const signer = lines[1] || "Ellis";
  const affiliation = lines[2] || "";
  const note = lines.slice(3).join(" ").trim();

  let formatted = `${closing}\n\n**${signer}**`;
  if (affiliation) formatted += `\n\n${affiliation}`;
  if (note) formatted += `\n\n*${note}*`;
  return formatted;
};
