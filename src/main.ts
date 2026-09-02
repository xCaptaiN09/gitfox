import * as core from '@actions/core';
import { context } from '@actions/github';
import { loadConfig } from './config';
import { GitHubApiError, GitfoxError } from './errors';
import { GitHubClient } from './github-client';
import { OllamaClient } from './ollama-client';
import { reviewAndPost, scanRepository, triageAndPost } from './scanner';
import type { GitfoxConfig } from './types';

const SUPPORTED_PR_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);
const SUPPORTED_ISSUE_ACTIONS = new Set(['opened']);

function repoRef(): { owner: string; repo: string } {
  if (context.repo.owner === '' || context.repo.repo === '') {
    throw new GitfoxError('Could not determine owner/repo from the GitHub context');
  }
  return { owner: context.repo.owner, repo: context.repo.repo };
}

async function runScanAll(config: GitfoxConfig): Promise<void> {
  const github = new GitHubClient(config.token);
  const ollama = new OllamaClient(config.ollamaUrl, config.model);
  const ref = repoRef();
  core.info('gitfox: scan-all mode — checking all open PRs and issues');
  const stats = await scanRepository(github, ollama, config, ref);
  core.info(
    `gitfox scan complete: ${stats.prsReviewed} PRs reviewed, ${stats.prsSkipped} skipped, ` +
    `${stats.issuesTriaged} issues triaged, ${stats.issuesSkipped} skipped, ${stats.failed} failed`
  );
}

async function runPullRequest(config: GitfoxConfig): Promise<void> {
  const payload = context.payload.pull_request;
  if (payload === undefined || typeof payload.number !== 'number') {
    core.info('gitfox: no pull request in payload, skipping');
    return;
  }
  if (!SUPPORTED_PR_ACTIONS.has(context.payload.action ?? '')) {
    core.info(`gitfox: ignoring pull_request action "${String(context.payload.action)}"`);
    return;
  }

  const github = new GitHubClient(config.token);
  const ollama = new OllamaClient(config.ollamaUrl, config.model);
  const ref = repoRef();

  if (await github.alreadyRepliedToPr(ref, payload.number)) {
    core.info(`gitfox: already reviewed PR #${payload.number}, skipping`);
    return;
  }

  const pr = await github.getPullRequest(ref, payload.number);
  core.info(`gitfox: reviewing PR #${pr.number} — ${pr.title}`);
  await reviewAndPost(github, ollama, config, ref, pr);
  core.info('gitfox: review posted');
}

async function runIssue(config: GitfoxConfig): Promise<void> {
  const payload = context.payload.issue;
  if (payload === undefined || typeof payload.number !== 'number') {
    core.info('gitfox: no issue in payload, skipping');
    return;
  }
  if (!SUPPORTED_ISSUE_ACTIONS.has(context.payload.action ?? '')) {
    core.info(`gitfox: ignoring issues action "${String(context.payload.action)}"`);
    return;
  }

  const github = new GitHubClient(config.token);
  const ollama = new OllamaClient(config.ollamaUrl, config.model);
  const ref = repoRef();

  if (await github.alreadyRepliedToIssue(ref, payload.number)) {
    core.info(`gitfox: already triaged issue #${payload.number}, skipping`);
    return;
  }

  const issue = await github.getIssue(ref, payload.number);
  core.info(`gitfox: triaging issue #${issue.number} — ${issue.title}`);
  await triageAndPost(github, ollama, config, ref, issue);
  core.info('gitfox: triage posted');
}

async function run(): Promise<void> {
  const config = loadConfig();

  if (config.scanAll) {
    await runScanAll(config);
    return;
  }

  switch (context.eventName) {
    case 'pull_request':
      await runPullRequest(config);
      break;
    case 'issues':
      await runIssue(config);
      break;
    default:
      core.info(`gitfox: unsupported event "${context.eventName}", nothing to do`);
  }
}

run().catch((error: unknown) => {
  if (error instanceof GitHubApiError && error.status === 403 && String(error.message).includes('rate limit')) {
    core.error('gitfox hit the GitHub API rate limit. Consider raising max-scan-items or running less often.');
  }
  core.setFailed(error instanceof Error ? error.message : String(error));
});
