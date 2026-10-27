import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { normalizeTodoData, getTodoDay } from '../src/features/todo/todoCore.js'
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/todo-contract.json', import.meta.url), 'utf8'))
for (const fixture of fixtures.cases) {
  test(`JS/Java shared Todo fixture: ${fixture.name}`, () => {
    const data = normalizeTodoData(fixture.data)
    for (const query of fixture.queries) {
      const actual = getTodoDay(data, query.date).map(({ id, key, title, completed }) => ({ id, key, title, completed }))
      assert.deepEqual(actual, query.expected, query.date)
    }
  })
}
