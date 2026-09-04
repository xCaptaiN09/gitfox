import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config';
import { buildReviewPayload } from '../src/github-client';
import { hasAnyMarker, parseReviewedSha } from '../src/markers';
import { normalizeFindings, renderReviewComment } from '../src/reviewer';
import { formatFileTree, relatedSourceFiles } from '../src/scanner';
import type { PullRequestContext } from '../src/types';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const SHA_C = 'c'.repeat(40);

const SAMPLE_DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -9,6 +10,7 @@ export function a() {',
  '   const a = 1;',
  '+  const b = 2;',
  '   return a + b;',
  ' }'
].join('\n');

const OVERRIDE_DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 3333333..4444444 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,3 +2,4 @@ function b() {',
  '+  const x = 1;'
].join('\n');

function makePr(overrides: Partial<PullRequestContext> = {}): PullRequestContext {
  return {
    number: 7,
    title: 'Add feature',
    body: '',
    author: 'someone',
    headSha: SHA_A,
    baseSha: SHA_B,
    baseRef: 'main',
    diff: SAMPLE_DIFF,
    files: [],
    ...overrides
  };
}

describe('parseReviewedSha', () => {
  it('returns the newest reviewed SHA across comment bodies', () => {
    const bodies = [`<!-- gitfox:v1:pr-review:7:${SHA_A} -->`, `text\n<!-- gitfox:v1:pr-review:7:${SHA_B} -->`];
    assert.equal(parseReviewedSha(bodies, 7), SHA_B);
  });

  it('ignores other issues and malformed SHAs', () => {
    const bodies = [`<!-- gitfox:v1:pr-review:9:${SHA_C} -->`, `<!-- gitfox:v1:pr-review:7:${'d'.repeat(39)} -->`];
    assert.equal(parseReviewedSha(bodies, 7), undefined);
    assert.equal(parseReviewedSha(bodies, 9), SHA_C);
  });
});

describe('hasAnyMarker strict prefix', () => {
  it('does not match sibling issue numbers', () => {
    assert.equal(hasAnyMarker(['<!-- gitfox:v1:pr-review:12 -->'], 'pr-review', 1), false);
    assert.equal(hasAnyMarker([`<!-- gitfox:v1:pr-review:7:${SHA_A} -->`], 'pr-review', 7), true);
  });
});

describe('normalizeFindings multi-line', () => {
  it('parses valid start_line/line ranges', () => {
    const findings = normalizeFindings(
      [
        { severity: 'critical', file: 'a.ts', start_line: 10, line: 12, comment: 'broken loop' },
        { severity: 'warning', file: 'b.ts', line: 3, comment: 'single line' }
      ],
      10
    );
    assert.deepEqual(findings[0], { severity: 'critical', file: 'a.ts', line: 12, startLine: 10, comment: 'broken loop', suggestion: undefined });
    assert.equal(findings[1].startLine, undefined);
  });

  it('keeps findings but drops invalid start_line ranges', () => {
    const findings = normalizeFindings(
      [
        { file: 'a.ts', start_line: 12, line: 10, comment: 'start after end' },
        { file: 'a.ts', start_line: 5, line: 5, comment: 'start equals end' },
        { file: 'a.ts', start_line: 1.5, line: 9, comment: 'non-integer start' },
        { file: 'a.ts', start_line: 3, comment: 'start without line' },
        { file: 'a.ts', line: 4, comment: 'valid single' }
      ],
      10
    );
    assert.equal(findings.length, 5);
    for (const finding of findings) {
      assert.equal(finding.startLine, undefined);
    }
    assert.equal(findings[4]?.line, 4);
  });
});

describe('renderReviewComment v1.2', () => {
  const base = makePr();

  it('renders multi-line locations as file:start-end', () => {
    const body = renderReviewComment(
      base,
      { summary: 's', findings: [{ severity: 'warning', file: 'src/a.ts', line: 12, startLine: 10, comment: 'range issue' }] },
      [],
      '<!-- m -->',
      false
    );
    assert.ok(body.includes('`src/a.ts:10-12`'));
    assert.ok(!body.includes('`src/a.ts:12`'));
  });

  it('adds REQUEST_CHANGES banner only when requested', () => {
    const body = renderReviewComment(base, { summary: 's', findings: [] }, [], '<!-- m -->', false, SHA_A, undefined, undefined, 'REQUEST_CHANGES');
    assert.ok(body.includes('gitfox requested changes'));
    const plain = renderReviewComment(base, { summary: 's', findings: [] }, [], '<!-- m -->', false, SHA_A);
    assert.ok(!plain.includes('gitfox requested changes'));
  });
});

describe('repo context helpers', () => {
  it('formatFileTree preserves full paths for the prompt', () => {
    const tree = formatFileTree(['src/index.ts', 'src/lib/deep/x.ts', 'README.md']);
    assert.equal(tree, 'src/index.ts\nsrc/lib/deep/x.ts\nREADME.md');
  });

  it('relatedSourceFiles scores same-dir/basename, skips changed files', () => {
    const related = relatedSourceFiles(
      ['src/a.ts', 'src/b.ts', 'src/c.js', 'src/util/helper.ts', 'docs/readme.md'],
      ['src/a.ts']
    );
    assert.deepEqual(related, ['src/b.ts', 'src/c.js']);
  });
});

describe('loadConfig v1.2 inputs', () => {
  it('defaults new flags', () => {
    process.env.GITFOX_GITHUB_TOKEN = 't';
    process.env.GITFOX_MODEL = 'm';
    for (const key of ['GITFOX_REQUEST_CHANGES', 'GITFOX_REPO_CONTEXT', 'GITFOX_PROGRESS_REACTIONS', 'GITFOX_INCREMENTAL_REVIEW']) {
      delete process.env[key];
    }
    try {
      const config = loadConfig();
      assert.equal(config.requestChanges, false);
      assert.equal(config.repoContext, true);
      assert.equal(config.progressReactions, true);
      assert.equal(config.incrementalReview, true);
    } finally {
      delete process.env.GITFOX_GITHUB_TOKEN;
      delete process.env.GITFOX_MODEL;
    }
  });

  it('parses explicit values', () => {
    process.env.GITFOX_GITHUB_TOKEN = 't';
    process.env.GITFOX_MODEL = 'm';
    process.env.GITFOX_REQUEST_CHANGES = 'true';
    process.env.GITFOX_REPO_CONTEXT = 'false';
    try {
      const config = loadConfig();
      assert.equal(config.requestChanges, true);
      assert.equal(config.repoContext, false);
    } finally {
      delete process.env.GITFOX_GITHUB_TOKEN;
      delete process.env.GITFOX_MODEL;
      delete process.env.GITFOX_REQUEST_CHANGES;
      delete process.env.GITFOX_REPO_CONTEXT;
    }
  });
});

describe('buildReviewPayload', () => {
  it('maps multi-line comments to start_line/start_side and passes the event through', () => {
    const payload = buildReviewPayload(
      'review body',
      [
        { path: 'src/a.ts', line: 12, startLine: 10, body: 'multi-line note' },
        { path: 'src/b.ts', line: 3, body: 'single-line note' }
      ],
      'REQUEST_CHANGES'
    );
    assert.equal(payload.event, 'REQUEST_CHANGES');
    assert.equal(payload.body, 'review body');
    assert.deepEqual(payload.comments[0], {
      path: 'src/a.ts',
      line: 12,
      side: 'RIGHT',
      start_line: 10,
      start_side: 'RIGHT',
      body: 'multi-line note'
    });
    assert.deepEqual(payload.comments[1], { path: 'src/b.ts', line: 3, side: 'RIGHT', body: 'single-line note' });
  });

  it('supports APPROVE events and empty comment lists', () => {
    const payload = buildReviewPayload('nice', [], 'APPROVE');
    assert.equal(payload.event, 'APPROVE');
    assert.deepEqual(payload.comments, []);
  });
});
