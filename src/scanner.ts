import { extractKeywords } from './keywords';
import { isLineInDiff } from './diff-parser';
import type { GitHubClient, PriorFixResult } from './github-client';
import type { OllamaClient } from './ollama-client';
import { reviewPullRequest, renderReviewComment, SEVERITY_EMOJI } from './reviewer';
import { renderTriageComment, triageIssue } from './triager';
import type { Finding, GitfoxConfig, IssueContext, PullRequestContext, ReviewResult } from './types';

export interface ScanStats {
  prsReviewed: number;
  prsSkipped: number;
  issuesTriaged: number;
  issuesSkipped: number;
  failed: number;
}

interface RepoRef {
  owner: string;
  repo: string;
}

export async function scanRepository(
  github: GitHubClient,
  ollama: OllamaClient,
  config: GitfoxConfig,
  ref: RepoRef
): Promise<ScanStats> {
  const stats: ScanStats = {
    prsReviewed: 0,
    prsSkipped: 0,
    issuesTriaged: 0,
    issuesSkipped: 0,
    failed: 0
  };

  const prNumbers = await github.listOpenPullRequests(ref);
  for (const number of prNumbers) {
    if (stats.prsReviewed + stats.prsSkipped >= config.maxScanItems) {
      break;
    }
    try {
      if (await github.alreadyRepliedToPr(ref, number)) {
        stats.prsSkipped += 1;
        continue;
      }
      const pr = await github.getPullRequest(ref, number);
      await reviewAndPost(github, ollama, config, ref, pr);
      stats.prsReviewed += 1;
    } catch (error) {
      stats.failed += 1;
      console.error(`gitfox: failed to review PR #${number}:`, error instanceof Error ? error.message : error);
    }
  }

  const issueNumbers = await github.listOpenIssues(ref);
  for (const number of issueNumbers) {
    if (stats.prsReviewed + stats.prsSkipped + stats.issuesTriaged + stats.issuesSkipped >= config.maxScanItems) {
      break;
    }
    try {
      if (await github.alreadyRepliedToIssue(ref, number)) {
        stats.issuesSkipped += 1;
        continue;
      }
      const issue = await github.getIssue(ref, number);
      await triageAndPost(github, ollama, config, ref, issue);
      stats.issuesTriaged += 1;
    } catch (error) {
      stats.failed += 1;
      console.error(`gitfox: failed to triage issue #${number}:`, error instanceof Error ? error.message : error);
    }
  }

  return stats;
}

export async function reviewAndPost(
  github: GitHubClient,
  ollama: OllamaClient,
  config: GitfoxConfig,
  ref: RepoRef,
  pr: PullRequestContext,
  headSha?: string
): Promise<void> {
  const result = await reviewPullRequest(ollama, pr, config.rulesContent, config.maxComments);

  let priorFixes: PriorFixResult[] = [];
  if (config.searchFixed) {
    const keywords = extractKeywords(pr.title);
    priorFixes = await github.searchClosedFixes(ref, keywords).catch(() => []);
  }

  const inlineFindings = selectInlineFindings(pr, result);
  let inlinePosted = false;

  if (config.inlineComments && inlineFindings.length > 0) {
    const comments = inlineFindings.map((finding) => ({
      path: finding.file,
      line: finding.line as number,
      body: renderInlineComment(finding, config.postSuggestions)
    }));
    const remaining = result.findings.filter((f) => !inlineFindings.includes(f));
    const summaryBody = renderReviewComment(pr, { ...result, findings: remaining }, priorFixes, github.prMarker(pr.number, headSha), config.postSuggestions, headSha, inlineFindings.length);
    inlinePosted = await github.createInlineReview(ref, pr.number, summaryBody, comments).catch(() => false);
  }

  if (!inlinePosted) {
    const body = renderReviewComment(pr, result, priorFixes, github.prMarker(pr.number, headSha), config.postSuggestions, headSha);
    await github.createComment(ref, pr.number, body);
  }
}

export function selectInlineFindings(pr: PullRequestContext, result: ReviewResult): Finding[] {
  const selected: Finding[] = [];
  for (const finding of result.findings) {
    if (finding.line === undefined) {
      continue;
    }
    const file = pr.files.find((candidate) => candidate.path === finding.file);
    if (file === undefined || !isLineInDiff(file, finding.line)) {
      continue;
    }
    selected.push(finding);
  }
  return selected;
}

export function renderInlineComment(finding: Finding, postSuggestions: boolean): string {
  const emoji = SEVERITY_EMOJI[finding.severity];
  const parts = [`${emoji} ${finding.comment}`];
  if (postSuggestions && finding.suggestion !== undefined) {
    parts.push('```suggestion\n' + finding.suggestion + '\n```');
  }
  return parts.join('\n\n');
}

export async function triageAndPost(
  github: GitHubClient,
  ollama: OllamaClient,
  config: GitfoxConfig,
  ref: RepoRef,
  issue: IssueContext
): Promise<void> {
  const result = await triageIssue(ollama, issue, config.rulesContent);

  let priorFixes: PriorFixResult[] = [];
  if (config.searchFixed) {
    const keywords = extractKeywords(issue.title);
    priorFixes = await github.searchClosedFixes(ref, keywords).catch(() => []);
  }

  const body = renderTriageComment(issue, result, priorFixes, github.issueMarker(issue.number));
  await github.createComment(ref, issue.number, body);
  if (result.labels.length > 0) {
    await github.addLabels(ref, issue.number, result.labels);
  }
}
