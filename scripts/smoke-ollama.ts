import { reviewPullRequest } from '../src/reviewer';
import { OllamaClient } from '../src/ollama-client';
import type { PullRequestContext } from '../src/types';

const model = process.env.GITFOX_MODEL ?? 'qwen2.5-coder:0.5b';

const fakePr: PullRequestContext = {
  number: 1,
  title: 'Add user login endpoint',
  body: 'Adds POST /login using the new user table.',
  author: 'tester',
  files: [],
  diff: [
    'diff --git a/src/login.js b/src/login.js',
    '--- a/src/login.js',
    '+++ b/src/login.js',
    '@@ -0,0 +1,6 @@',
    '+const express = require("express");',
    '+const app = express();',
    '+app.post("/login", (req, res) => {',
    '+  const query = "SELECT * FROM users WHERE name = \'" + req.body.name + "\'";',
    '+  db.run(query);',
    '+});'
  ].join('\n')
};

async function main(): Promise<void> {
  const ollama = new OllamaClient(process.env.GITFOX_OLLAMA_URL ?? 'http://127.0.0.1:11434', model);
  console.log(`smoke test with model: ${model}`);
  const result = await reviewPullRequest(ollama, fakePr, '', 10);
  console.log('summary:', result.summary);
  console.log('findings:', JSON.stringify(result.findings, null, 2));
}

main().catch((error: unknown) => {
  console.error('SMOKE TEST FAILED:', error instanceof Error ? error.message : error);
  process.exit(1);
});
