import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './useMarkdown.js'

// 5.17 note preview rendering. The sentences are about the HTML a writer sees
// and the markup a model must never inject. They do not care which library
// produced the output.

describe('renderMarkdown', () => {
  it('S-003: keeps headings, emphasis and lists', () => {
    const html = renderMarkdown('# Title\n\nSome **bold** and *italic* text.\n\n- one\n- two')

    expect(html).toContain('<h1')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('<li>two</li>')
  })

  it('S-003: turns a single newline into a line break inside the paragraph', () => {
    const html = renderMarkdown('first line\nsecond line')

    expect(html).toContain('<br')
    expect(html).toContain('first line')
    expect(html).toContain('second line')
  })

  it('S-003: removes scripts, raw HTML event handlers and embedded frames', () => {
    const html = renderMarkdown(
      'Hello\n\n<script>alert("boom")</script>\n\n<img src="x" onerror="alert(1)">\n<iframe src="https://example.com"></iframe>',
    )

    expect(html).toContain('Hello')
    expect(html).not.toContain('<script')
    expect(html).not.toMatch(/onerror/i)
    expect(html).not.toContain('<iframe')
  })
})
