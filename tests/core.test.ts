import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractJson } from '../src/prompts';
import { hasMarker, markerFor } from '../src/markers';
import { extractKeywords } from '../src/keywords';

describe('extractJson', () => {
  it('parses plain JSON', () => {
    const result = extractJson<{ a: number }>('{"a": 1}');
    assert.deepEqual(result, { a: 1 });
  });

  it('parses JSON wrapped in markdown fences', () => {
    const result = extractJson<{ a: number }>('```json\n{"a": 1}\n```');
    assert.deepEqual(result, { a: 1 });
  });

  it('parses JSON embedded in prose', () => {
    const result = extractJson<{ a: number }>('Here is the review: {"a": 1} hope it helps!');
    assert.deepEqual(result, { a: 1 });
  });

  it('throws when no JSON exists', () => {
    assert.throws(() => extractJson('no json here at all'), /no JSON object/i);
  });
});

describe('markers', () => {
  it('builds stable markers', () => {
    assert.equal(markerFor('pr-review', 42), '<!-- gitfox:v1:pr-review:42 -->');
  });

  it('detects markers in comment bodies', () => {
    const comments = ['some text', '## 🦊 gitfox\n<!-- gitfox:v1:issue-triage:7 -->'];
    assert.equal(hasMarker(comments, 'issue-triage', 7), true);
    assert.equal(hasMarker(comments, 'pr-review', 7), false);
  });
});

describe('extractKeywords', () => {
  it('drops stop words and short words', () => {
    const keywords = extractKeywords('Fix the bug in the charging driver for VOOC');
    assert.ok(!keywords.includes('fix'));
    assert.ok(!keywords.includes('the'));
    assert.ok(keywords.includes('charging') || keywords.includes('driver') || keywords.includes('vooc'));
  });

  it('limits keyword count', () => {
    const keywords = extractKeywords('alpha beta gamma delta epsilon zeta eta theta', 3);
    assert.equal(keywords.length, 3);
  });
});
