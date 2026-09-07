import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { foldStreamLine } from '../src/ollama-client';

describe('foldStreamLine', () => {
  it('accumulates content across NDJSON chunks', () => {
    let state = { content: '', error: '' };
    state = foldStreamLine(state, '{"message":{"content":"Hello"}}');
    state = foldStreamLine(state, '{"message":{"content":" world"}}');
    assert.equal(state.content, 'Hello world');
    assert.equal(state.error, '');
  });

  it('captures stream errors without losing prior content', () => {
    const state = foldStreamLine({ content: 'partial', error: '' }, '{"error":"model exploded"}');
    assert.equal(state.error, 'model exploded');
    assert.equal(state.content, 'partial');
  });

  it('ignores malformed and empty lines (keep-alives, partial chunks)', () => {
    let state = foldStreamLine({ content: '', error: '' }, 'not json at all');
    state = foldStreamLine(state, '');
    state = foldStreamLine(state, '   ');
    assert.equal(state.content, '');
    assert.equal(state.error, '');
  });

  it('tolerates chunks without message.content', () => {
    const state = foldStreamLine({ content: 'keep', error: '' }, '{"done":false}');
    assert.equal(state.content, 'keep');
  });
});
