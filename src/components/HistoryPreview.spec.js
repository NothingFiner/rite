import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HistoryPreview from './HistoryPreview.vue'

// HistoryPreview renders a reconstructed past version read-only. It reuses the
// editor's HTML helpers, so what matters here is that the document becomes
// readable text — titles, chapter numbering, hidden-section dimming — and that a
// version with nothing in it says so instead of showing a blank sheet.

function paragraph(id, content) {
  return {
    id,
    elements: [{ textRun: { content, textStyle: {} } }],
    leftIndent: null,
    rightIndent: null,
    firstLineIndent: null,
  }
}

function section(id, title, sectionType, paragraphs, hidden = false) {
  return { id, title, sectionType, hidden, paragraphs }
}

function documentOf(sections) {
  return { title: 'Novel', author: 'A', authorContact: '', hasTOC: false, sections }
}

describe('HistoryPreview', () => {
  it('renders nothing without a document', () => {
    const wrapper = mount(HistoryPreview)

    expect(wrapper.find('.history-preview').exists()).toBe(false)
  })

  it('renders section titles and their paragraphs as readable text', () => {
    const wrapper = mount(HistoryPreview, {
      props: {
        document: documentOf([
          section('s1', 'The Arrival', 'chapter', [paragraph('p1', 'The door opened.')]),
        ]),
      },
    })

    const sheet = wrapper.find('.history-preview-doc')
    expect(sheet.text()).toContain('The Arrival')
    expect(sheet.text()).toContain('The door opened.')
    expect(sheet.findAll('.paragraph')).toHaveLength(1)
  })

  it('numbers chapters the same way the editor does', () => {
    const wrapper = mount(HistoryPreview, {
      props: {
        document: documentOf([
          section('s1', 'The Arrival', 'chapter', [paragraph('p1', 'One.')]),
          section('s2', 'The Descent', 'chapter', [paragraph('p2', 'Two.')]),
        ]),
      },
    })

    const titles = wrapper.findAll('.history-preview-doc .section-title')
    expect(titles[0].text()).toContain('Chapter 1')
    expect(titles[1].text()).toContain('Chapter 2')
  })

  it('marks a hidden section so the archive matches the editor', () => {
    const wrapper = mount(HistoryPreview, {
      props: {
        document: documentOf([
          section('s1', 'Epigram', 'section', [paragraph('p1', 'Only connect.')], true),
        ]),
      },
    })

    const title = wrapper.find('.history-preview-doc .section-title.section-hidden')
    expect(title.exists()).toBe(true)
    expect(title.attributes('data-section-hidden')).toBe('true')
  })

  it('says so when the version has no content', () => {
    const wrapper = mount(HistoryPreview, { props: { document: documentOf([]) } })

    expect(wrapper.find('.history-preview-empty').text()).toContain('This version is empty.')
  })

  it('renders a section title even when the section has no paragraphs', () => {
    const wrapper = mount(HistoryPreview, {
      props: { document: documentOf([section('s1', 'Empty Chapter', 'chapter', [])]) },
    })

    expect(wrapper.text()).toContain('Empty Chapter')
    expect(wrapper.findAll('.paragraph')).toHaveLength(0)
  })

  it('escapes markup in the document text instead of rendering it', () => {
    const wrapper = mount(HistoryPreview, {
      props: {
        document: documentOf([
          section('s1', 'Title', 'section', [paragraph('p1', '<img src=x onerror=alert(1)>')]),
        ]),
      },
    })

    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('<img src=x onerror=alert(1)>')
  })
})
