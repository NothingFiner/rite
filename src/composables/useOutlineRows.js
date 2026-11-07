// The Outline tab's row model (5.20).
//
// `retrieve_summaries` answers "which summaries exist, and where do they sit?"
// It leaves out sections that have no summary. The outline needs the opposite
// direction: every section, in document order, with its summary attached when
// there is one. Joining here rather than in Rust also keeps the naming rule in
// one place, so an untitled chapter reads "Chapter 1" via `sectionDisplayTitle`.
export function outlineRows(doc, entries) {
  throw new Error('not implemented')
}
