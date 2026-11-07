// Document and summary-entry fixtures for the Outline tab's tests (5.20).
//
// Three suites mount the same shape: a document whose sections the outline
// enumerates, and the `retrieve_summaries` array attached to them by section id.
// Keeping the builders here means a test file reads as tests rather than as
// data. This is test-only code and no production module imports it.

export const paragraph = (id, text) => ({
  id,
  elements: [{ textRun: { content: text, textStyle: {} } }],
  leftIndent: null,
  rightIndent: null,
  firstLineIndent: null,
})

/// A section with one paragraph, plus any overrides a case needs. `hidden` sits
/// on the section because 5.10's hidden sections still appear in the outline.
export const section = (id, title, sectionType, extra = {}) => ({
  id,
  title,
  sectionType,
  hidden: false,
  paragraphs: [paragraph(`p-${id}`, `Prose for ${id}.`)],
  ...extra,
})

export const doc = (sections) => ({
  title: 'Outline Novel',
  author: 'A',
  authorContact: '',
  hasTOC: false,
  sections,
})

/// One row of what `retrieve_summaries` returns: manuscript order, summarized
/// sections only, with the render context Rust derives.
export const entry = (
  sectionId,
  chapterIndex,
  title,
  sectionType,
  summary,
  stale = false,
) => ({ sectionId, chapterIndex, title, sectionType, summary, stale })
