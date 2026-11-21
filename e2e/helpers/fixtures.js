// Document and reference-entry shapes handed to the app over IPC.
//
// The e2e suites each need a document the manuscript can render, and the
// reference suites need entries the drawer and the lookup can match. Sharing the
// builders keeps a spec readable as behaviour. `e2e/**` is protected, so the
// shape a test asserts cannot drift silently.

export const paragraph = (id, text) => ({
  id,
  elements: [
    {
      textRun: {
        content: text,
        textStyle: { bold: false, italic: false, underline: false, fontSize: null },
      },
    },
  ],
  leftIndent: null,
  rightIndent: null,
  firstLineIndent: null,
})

export const section = (id, title, sectionType, paragraphs) => ({
  id,
  title,
  sectionType,
  hidden: false,
  paragraphs,
})

/// A reference entry in the shape `retrieve_references` returns. `overrides`
/// carries the fields a case is about: a definition with a link, an alias, or a
/// kind other than the default.
export const referenceEntry = (id, kind, name, overrides = {}) => ({
  id,
  kind,
  name,
  definition: '',
  aliases: [],
  tags: [],
  facts: [],
  includedSections: [],
  excludedSections: [],
  ...overrides,
})
