/**
 * Copy for Cover Studio UI-only thread messages (persisted in NovelCoverMessage).
 */

export const COVER_METADATA_KIND_WELCOME = "cover_welcome";
export const COVER_METADATA_KIND_CONVERSATIONAL = "cover_conversational";
export const COVER_METADATA_KIND_GENERATE_OFFER = "cover_generate_offer";
export const COVER_METADATA_KIND_RENDER_NOTICE = "cover_render_notice";

export const COVER_WELCOME_TEXT =
  "🎨 **Welcome to Your Book Cover Concept Studio** ✨\n\n" +
  "Book cover concepts are an inspiration tool. They help you visualize your book, see where it belongs on the shelf, and feel more immersed in your story as you write and revise. 📖\n\n" +
  "A strong cover communicates **genre, tone, and audience** in seconds.\n\n" +
  "⚠️ **Important:** Reader expectations and sales psychology may point in a different direction from the cover you originally imagined. Color, typography, imagery, and composition all shape that response in readers. 🎯\n\n" +
  "I'll create the concept I believe best positions your book for its **genre, readership, and market.** You can then ask me to refine the mood, palette, imagery, or title treatment. 🎨✨\n\n" +
  "Every version will be saved in **Covers**, where you can compare concepts and choose your favorite. When you are ready, say **deliver cover** or **generate my cover**, and I'll confirm the direction before giving you a **Generate cover image** button to click. 👆\n\n" +
  "**Ready for your first concept? Just say: deliver cover. 😊**";

export const COVER_RENDER_REFINE_CTA =
  "👉 **Want to make changes or explore a different direction?** Use **Refine cover** to adjust this version, or tell me in chat what kind of new concept you would like to see. 🎨";

/** @deprecated Legacy footer appended to render_notice text; stripped in UI. */
export const COVER_RENDER_FOOTER_TEXT =
  "Cover image ready. Browse all versions in **Covers**, or keep refining direction in chat for your next version.";

export const coverUiMessageMetadata = (kind, extra = {}) => ({
  kind,
  ...extra,
});

export const coverWelcomeMetadata = () => ({
  excludeFromModelInput: true,
  kind: COVER_METADATA_KIND_WELCOME,
});

export const coverGenerateOfferMetadata = (extra = {}) => ({
  kind: COVER_METADATA_KIND_GENERATE_OFFER,
  generationConsumed: false,
  ...extra,
});

export const coverRenderNoticeMetadata = (coverVersionId) => ({
  excludeFromModelInput: true,
  kind: COVER_METADATA_KIND_RENDER_NOTICE,
  refineCta: COVER_RENDER_REFINE_CTA,
  ...(coverVersionId ? { coverVersionId: String(coverVersionId) } : {}),
});
