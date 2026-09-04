import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { OllamaClient } from '../src/ollama-client';
import { reviewPullRequest } from '../src/reviewer';
import type { PullRequestContext } from '../src/types';

const SHA_A = 'a'.repeat(40);

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

describe('reviewPullRequest v1.2 options', () => {
  it('accepts a diff override and passes repo context through', async () => {
    let captured = '';
    const stub = {
      chat: async (messages: unknown, _options: unknown) => {
        captured = JSON.stringify(messages);
        return JSON.stringify({
          summary: 'incremental ok',
          findings: [{ severity: 'suggestion', file: 'src/a.ts', line: 3, comment: 'minor' }]
        });
      }
    } as unknown as OllamaClient;

    const pr: PullRequestContext = {
      number: 7,
      title: 'Add feature',
      body: '',
      author: 'someone',
      headSha: SHA_A,
      baseSha: '',
      baseRef: 'main',
      diff: SAMPLE_DIFF,
      files: []
    };
    const result = await reviewPullRequest(stub, pr, '', 10, { diffTextOverride: OVERRIDE_DIFF, repoContext: '<repo_tree>a.ts</repo_tree>' });
    assert.equal(result.findings[0]?.file, 'src/a.ts');
    assert.ok(captured.includes('+  const x = 1;'));
    assert.ok(captured.includes('@@ -1,3 +2,4 @@ function b() {'));
    assert.ok(!captured.includes('+  const b = 2;'));
    assert.ok(captured.includes('<repo_tree>'));
    assert.equal(pr.files.length, 1);
  });
});
