// The Outline tab's row model (5.20).
//
// `retrieve_summaries` answers "which summaries exist, and where do they sit?"
// It leaves out sections that have no summary. The outline needs the opposite
// direction: every section, in document order, with its summary attached when
// there is one. Joining here rather than in Rust also keeps the naming rule in
// one place, so an untitled chapter reads "Chapter 1" via `sectionDisplayTitle`.
import { sectionDisplayTitle } from './useSectionFormat.js'

// Join the document to the stored summaries: one row per section of `doc`, in
// document order, looking its summary up by `sectionId`. The chapter number is
// render-derived (see useSectionFormat.js), so it counts chapters here too.
export function outlineRows(doc, entries) {
  const entryBySectionId = new Map((entries ?? []).map((entry) => [entry.sectionId, entry]))
  let chapterCount = 0
  return (doc?.sections ?? []).map((section) => {
    const chapterIndex = section.sectionType === 'chapter' ? ++chapterCount : null
    const entry = entryBySectionId.get(section.id)
    return {
      sectionId: section.id,
      title: sectionDisplayTitle(section, chapterIndex),
      chapterIndex,
      hidden: Boolean(section.hidden),
      summary: entry?.summary ?? '',
      hasSummary: entry !== undefined,
      stale: entry?.stale ?? false,
    }
  })
}
