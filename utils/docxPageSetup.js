/**
 * Shared Word page setup for .docx exports.
 *
 * The `docx` library defaults to A4. US Word + a Letter printer then warns
 * that a section's paper size does not match, and mixed section breaks can
 * surface as landscape / tiny-margin print errors (especially after Vellum).
 * Pin every section to US Letter portrait with 1" margins.
 */
import { convertInchesToTwip, PageOrientation } from "docx";

export const LETTER_PAGE_WIDTH_TWIPS = convertInchesToTwip(8.5);
export const LETTER_PAGE_HEIGHT_TWIPS = convertInchesToTwip(11);

export const LETTER_PAGE_SIZE = {
  width: LETTER_PAGE_WIDTH_TWIPS,
  height: LETTER_PAGE_HEIGHT_TWIPS,
  orientation: PageOrientation.PORTRAIT,
};

export const manuscriptPageMargins = ({ withHeaderFooter = false } = {}) => {
  const inch = convertInchesToTwip(1);
  const margins = {
    top: inch,
    right: inch,
    bottom: inch,
    left: inch,
  };
  if (withHeaderFooter) {
    const half = convertInchesToTwip(0.5);
    margins.header = half;
    margins.footer = half;
  }
  return margins;
};

export const letterPage = (marginOpts) => ({
  size: { ...LETTER_PAGE_SIZE },
  margin: manuscriptPageMargins(marginOpts),
});
