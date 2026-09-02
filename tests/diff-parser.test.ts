import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatDiffForPrompt, isLineInDiff, parseDiff, truncatePatch } from '../src/diff-parser';

const SAMPLE_DIFF = [
  'diff --git a/src/index.js b/src/index.js',
  'index 1234567..89abcde 100644',
  '--- a/src/index.js',
  '+++ b/src/index.js',
  '@@ -1,3 +1,4 @@',
  ' const a = 1;',
  '+const b = 2;',
  ' console.log(a);',
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1,2 @@',
  '# Hello',
  '+World'
].join('\n');

describe('parseDiff', () => {
  it('extracts file paths and patches', () => {
    const files = parseDiff(SAMPLE_DIFF);
    assert.equal(files.length, 2);
    assert.equal(files[0].path, 'src/index.js');
    assert.ok(files[0].patch?.includes('+const b = 2;'));
    assert.equal(files[1].path, 'README.md');
    assert.ok(files[1].patch?.includes('+World'));
  });

  it('returns empty array for empty diff', () => {
    assert.deepEqual(parseDiff(''), []);
  });

  it('handles new files without an a/ prefix', () => {
    const diff = [
      'diff --git a/new-file.ts b/new-file.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new-file.ts',
      '@@ -0,0 +1 @@',
      '+export {}'
    ].join('\n');
    const files = parseDiff(diff);
    assert.equal(files.length, 1);
    assert.equal(files[0].path, 'new-file.ts');
  });

  it('throws on non-string input', () => {
    assert.throws(() => parseDiff(undefined as unknown as string));
  });
});

describe('truncatePatch', () => {
  it('keeps short patches intact', () => {
    assert.equal(truncatePatch('abc', 10), 'abc');
  });

  it('truncates long patches with a notice', () => {
    const long = 'x'.repeat(100);
    const result = truncatePatch(long, 10);
    assert.ok(result.startsWith('xxxxxxxxxx'));
    assert.ok(result.includes('truncated'));
  });
});

describe('isLineInDiff', () => {
  const files = parseDiff(SAMPLE_DIFF);

  it('accepts lines inside a hunk', () => {
    assert.equal(isLineInDiff(files[0], 3), true);
  });

  it('rejects lines outside the hunk', () => {
    assert.equal(isLineInDiff(files[0], 999), false);
  });

  it('rejects when patch is missing', () => {
    assert.equal(isLineInDiff({ path: 'x', patch: null }, 1), false);
  });
});

describe('formatDiffForPrompt', () => {
  it('renders files as fenced diff sections', () => {
    const files = parseDiff(SAMPLE_DIFF);
    const output = formatDiffForPrompt(files);
    assert.ok(output.includes('### File: src/index.js'));
    assert.ok(output.includes('```diff'));
  });

  it('respects the total char budget', () => {
    const files = parseDiff(SAMPLE_DIFF);
    const output = formatDiffForPrompt(files, 50);
    assert.ok(output.length < 2000);
  });
});
