import type { BlockNoteDocument } from './document.js'

/**
 * Study-note templates for new Rich Notes (Slice 5C).
 *
 * Each template returns ordinary, fully editable BlockNote content — no hidden
 * attributes, schema extensions, or magic metadata. The page title is separate
 * from the document body, so templates use generic section headings the user
 * renames freely.
 */

export type RichTemplateKey = 'blank' | 'subject' | 'chapter' | 'revision'

interface RichTemplateDef {
  key: RichTemplateKey
  labelKey: 'templateBlank' | 'templateSubject' | 'templateChapter' | 'templateRevision'
  build: () => BlockNoteDocument
}

function text(value: string): { type: 'text'; text: string; styles: Record<string, never> } {
  return { type: 'text', text: value, styles: {} }
}

function paragraph(value = ''): BlockNoteDocument[number] {
  return { type: 'paragraph', content: value ? [text(value)] : [] }
}

function heading(level: 1 | 2 | 3, value: string): BlockNoteDocument[number] {
  return { type: 'heading', props: { level }, content: [text(value)] }
}

function bullet(value: string): BlockNoteDocument[number] {
  return { type: 'bulletListItem', content: [text(value)] }
}

function numbered(value: string): BlockNoteDocument[number] {
  return { type: 'numberedListItem', content: [text(value)] }
}

function check(value: string, checked = false): BlockNoteDocument[number] {
  return { type: 'checkListItem', props: { checked }, content: [text(value)] }
}

const blank: RichTemplateDef = {
  key: 'blank',
  labelKey: 'templateBlank',
  build: () => [{ type: 'paragraph' }]
}

const subject: RichTemplateDef = {
  key: 'subject',
  labelKey: 'templateSubject',
  build: () => [
    heading(1, 'Subject Overview'),
    paragraph('One-line summary of what this subject covers and why it matters.'),
    heading(2, 'Key Concepts'),
    bullet('Concept one — short definition or intuition.'),
    bullet('Concept two — short definition or intuition.'),
    bullet('Concept three — short definition or intuition.'),
    heading(2, 'Notes'),
    paragraph('Capture explanations, examples, and open questions here.'),
    heading(2, 'Resources'),
    bullet('Link or reference to primary source.')
  ]
}

const chapter: RichTemplateDef = {
  key: 'chapter',
  labelKey: 'templateChapter',
  build: () => [
    heading(1, 'Chapter / Topic'),
    paragraph('What this chapter is about and how it fits the larger subject.'),
    heading(2, 'Summary'),
    paragraph('A few sentences capturing the core idea.'),
    heading(2, 'Key Points'),
    numbered('First important point.'),
    numbered('Second important point.'),
    numbered('Third important point.'),
    heading(2, 'Questions to Answer'),
    bullet('What is still unclear?'),
    bullet('How does this connect to earlier material?')
  ]
}

const revision: RichTemplateDef = {
  key: 'revision',
  labelKey: 'templateRevision',
  build: () => [
    heading(1, 'Revision Sheet'),
    heading(2, 'Must Know'),
    check('Core fact or definition one.'),
    check('Core fact or definition two.'),
    check('Core fact or definition three.'),
    heading(2, 'Formulas'),
    paragraph('Write the key formulas here.'),
    heading(2, 'Self-Test'),
    check('Can I explain this in my own words?'),
    check('Can I solve a worked example?'),
    check('Can I teach it to someone else?')
  ]
}

export const RICH_TEMPLATES: Record<RichTemplateKey, RichTemplateDef> = {
  blank,
  subject,
  chapter,
  revision
}

/** Serializes a template to the canonical BlockNote JSON string. */
export function buildTemplateContent(key: RichTemplateKey): string {
  return JSON.stringify(RICH_TEMPLATES[key].build())
}
