// The document-level recap's triggers (SPEC.md 5.20b, S-020 and S-038).
//
// The overview page's summary is generated from the whole manuscript, and it
// must come from the same composable the sections do — one place decides
// whether generation is running, so `Regenerate all` cannot start two
// overlapping loops. These sentences pin the composable's own contract: what it
// exposes to the view, and that bulk generation covers the document too.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { useSummaries } from './useSummaries.js'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => null) }))

function makeStore() {
  return reactive({
    doc: {
      sections: [
        { id: 'c1', title: 'The Arrival', sectionType: 'chapter', paragraphs: [] },
        { id: 's1', title: 'Interlude', sectionType: 'section', paragraphs: [] },
      ],
    },
    docVersion: 0,
  })
}

function makeSettings() {
  return {
    settings: {
      value: { endpoint: 'http://localhost:11434', apiKey: '', model: 'llama3' },
    },
  }
}

function makeSummaries() {
  return useSummaries(makeStore(), makeSettings())
}

const callsOf = (cmd) => invoke.mock.calls.filter(([name]) => name === cmd)

describe('useSummaries document recap', () => {
  beforeEach(() => {
    invoke.mockClear()
    invoke.mockImplementation(async () => null)
  })

  it('S-020: exposes summarizeOne so a recap can be regenerated for one section', () => {
    const summaries = makeSummaries()

    expect(typeof summaries.summarizeOne).toBe('function')
  })

  it('S-034: exposes the document summary and its staleness for the overview page', () => {
    const summaries = makeSummaries()

    expect(summaries.documentSummary).toBeDefined()
    expect(summaries.documentSummaryStale).toBeDefined()
    expect(summaries.documentSummary.value).toBe(null)
  })

  it('S-038: generateSummaries regenerates the document recap after the sections', async () => {
    const summaries = makeSummaries()

    await summaries.generateSummaries()

    expect(callsOf('summarize_and_store_section')).toHaveLength(2)
    expect(callsOf('summarize_and_store_document')).toHaveLength(1)
  })
})
