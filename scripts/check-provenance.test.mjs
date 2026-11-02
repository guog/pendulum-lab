import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateProvenance } from './check-provenance.mjs'

for (const [name, footer] of [
  ['AI', 'Assisted-by: LLM\nAI-Agent: OpenAI Codex'],
  ['human', 'AI-Usage: none'],
  ['automation', 'AI-Usage: automation\nAutomation-Agent: Dependabot'],
]) {
  test(`accepts ${name} disclosure`, () => {
    assert.doesNotThrow(() => validateProvenance(`chore: example\n\n${footer}\n`))
  })
}
for (const [name, text] of [
  ['missing declaration', 'chore: example'],
  ['agent missing', 'chore: example\n\nAssisted-by: LLM'],
  ['conflicting declarations', 'Assisted-by: LLM\nAI-Agent: Codex\nAI-Usage: none'],
  ['duplicate declarations', 'AI-Usage: none\nAI-Usage: none'],
  ['fenced example', 'text\n\n```text\nAssisted-by: LLM\nAI-Agent: Codex\n```'],
  ['nonfinal example', 'Assisted-by: LLM\nAI-Agent: Codex\n\nActual body'],
  ['unnamed automation', 'AI-Usage: automation'],
  ['misleading human declaration', 'AI-Usage: none\nAI-Agent: Codex'],
]) {
  test(`rejects ${name}`, () => assert.throws(() => validateProvenance(text)))
}

const aiFooter = 'Assisted-by: LLM\nAI-Agent: Codex'
for (const [name, prefix] of [
  ['cross-paragraph backtick fence', 'Body\n\n```text\n\n'],
  ['cross-paragraph tilde fence', 'Body\n\n~~~text\n\n'],
  ['cross-paragraph HTML comment', 'Body\n\n<!--\n\n'],
]) {
  test(`rejects ${name}`, () => assert.throws(() => validateProvenance(prefix + aiFooter)))
}
test('accepts footer after closed code fences and comments', () => {
  assert.doesNotThrow(() =>
    validateProvenance('```text\n\nexample\n```\n\n<!-- hidden -->\n\n' + aiFooter),
  )
})
