import { extractKeywords } from './keywords';
import { isLineInDiff, parseDiff } from './diff-parser';
import { ModelResponseError } from './errors';
import type { GitHubClient, PriorFixResult } from './github-client';
import type { OllamaClient } from './ollama-client';
import { reviewPullRequest, renderReviewComment, SEVERITY_EMOJI, type ReviewOptions } from './reviewer';
import { renderTriageComment, triageIssue } from './triager';
import type { Finding, GitfoxConfig, IssueContext, PullRequestContext, ReviewResult } from './types';

const REPO_CONTEXT_MAX_RELATED = 4;
const REPO_CONTEXT_FILE_BUDGET = 24000;

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

export function formatFileTree(paths: string[]): string {
  return paths.join('\n');
}

export function relatedSourceFiles(tree: string[], changedPaths: string[], max: number = REPO_CONTEXT_MAX_RELATED): string[] {
  const changedDirs = new Set<string>();
  const changedBaseNames = new Set<string>();
  for (const changed of changedPaths) {
    const segments = changed.split('/');
    const base = segments.pop() ?? changed;
    changedBaseNames.add(base);
    if (segments.length > 0) {
      changedDirs.add(segments.join('/'));
    }
  }

  const scored: Array<{ path: string; score: number }> = [];
  for (const path of tree) {
    if (changedPaths.includes(path)) {
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|c|cc|cpp|h|hpp|cs|swift|kt|sh)$/.test(path)) {
      continue;
    }
    const segments = path.split('/');
    const base = segments.pop() ?? path;
    const dir = segments.join('/');
    let score = 0;
    if (changedBaseNames.has(base)) {
      score += 4;
    }
    if (dir !== '' && changedDirs.has(dir)) {
      score += 3;
    }
    if (/^(src|lib|app|index|main)/.test(base)) {
      score += 1;
    }
    if (score > 0) {
      scored.push({ path, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, max)
    .map((entry) => entry.path);
}

export async function buildRepoContext(
  github: GitHubClient,
  ref: RepoRef,
  pr: PullRequestContext,
  headSha?: string
): Promise<string> {
  const treeSha = headSha ?? (pr.headSha !== '' ? pr.headSha : pr.baseSha);
  if (treeSha === undefined || treeSha === '') {
    return '';
  }
  if (pr.files.length === 0) {
    pr.files = parseDiff(pr.diff);
  }
  const changedPaths = pr.files.map((file) => file.path);
  if (changedPaths.length === 0) {
    return '';
  }

  const tree = await github.getFileTree(ref, treeSha);
  if (tree.length === 0) {
    return '';
  }

  const sections: string[] = [
    `<repo_tree total_files="${tree.length}">`,
    formatFileTree(tree.slice(0, 400)),
    '</repo_tree>'
  ];

  const related = relatedSourceFiles(tree, changedPaths);
  let budget = REPO_CONTEXT_FILE_BUDGET;
  for (const path of related) {
    if (budget <= 0) {
      break;
    }
    const content = await github.getFileContent(ref, treeSha, path);
    if (content === null) {
      continue;
    }
    const clipped = content.slice(0, budget);
    budget -= clipped.length;
    sections.push(`<file path="${path}">\n${clipped}\n</file>`);
  }

  return sections.join('\n\n');
}

export async function reviewAndPost(
  github: GitHubClient,
  ollama: OllamaClient,
  config: GitfoxConfig,
  ref: RepoRef,
  pr: PullRequestContext,
  headSha?: string
): Promise<void> {
  if (config.progressReactions) {
    await github.addReaction(ref, pr.number, 'rocket').catch(() => undefined);
  }

  const options: ReviewOptions = {};
  let incrementalNote = '';
  if (config.incrementalReview && headSha !== undefined && headSha !== '') {
    const lastSha = await github.getLastReviewedSha(ref, pr.number).catch(() => undefined);
    if (lastSha !== undefined && lastSha !== headSha) {
      const incrementalDiff = await github.compareDiff(ref, lastSha, headSha).catch(() => '');
      if (incrementalDiff.trim() !== '') {
        options.diffTextOverride = incrementalDiff;
        incrementalNote =
          `\n\n> ⚡ **Incremental review** — only changes since \`${lastSha.slice(0, 7)}\` were re-analyzed. ` +
          'Earlier lines were reviewed at that commit.';
      }
    }
  }
  if (config.repoContext) {
    options.repoContext = await buildRepoContext(github, ref, pr, headSha).catch(() => '');
  }

  let result: ReviewResult;
  try {
    result = await reviewPullRequest(ollama, pr, config.rulesContent, config.maxComments, options);
  } catch (error) {
    if (!(error instanceof ModelResponseError)) {
      throw error;
    }
    console.warn('gitfox: model returned malformed output for PR review, retrying once');
    result = await reviewPullRequest(ollama, pr, config.rulesContent, config.maxComments, options);
  }

  let priorFixes: PriorFixResult[] = [];
  if (config.searchFixed) {
    const keywords = extractKeywords(pr.title);
    priorFixes = await github.searchClosedFixes(ref, keywords).catch(() => []);
  }

  const hasCritical = result.findings.some((finding) => finding.severity === 'critical');
  const reviewEvent: 'COMMENT' | 'REQUEST_CHANGES' = config.requestChanges && hasCritical ? 'REQUEST_CHANGES' : 'COMMENT';

  const inlineFindings = selectInlineFindings(pr, result);
  let posted = false;

  if (config.inlineComments && inlineFindings.length > 0) {
    const comments = inlineFindings.map((finding) => ({
      path: finding.file,
      line: finding.line as number,
      ...(finding.startLine !== undefined ? { startLine: finding.startLine } : {}),
      body: renderInlineComment(finding, config.postSuggestions)
    }));
    const remaining = result.findings.filter((f) => !inlineFindings.includes(f));
    const summaryBody =
      renderReviewComment(
        pr,
        { ...result, findings: remaining },
        priorFixes,
        github.prMarker(pr.number, headSha),
        config.postSuggestions,
        headSha,
        inlineFindings.length,
        result.findings,
        reviewEvent
      ) + incrementalNote;
    posted = await github.createReview(ref, pr.number, summaryBody, comments, reviewEvent).catch(() => false);
  }

  if (!posted) {
    const body =
      renderReviewComment(
        pr,
        result,
        priorFixes,
        github.prMarker(pr.number, headSha),
        config.postSuggestions,
        headSha,
        undefined,
        undefined,
        reviewEvent
      ) + incrementalNote;
    if (config.inlineComments) {
      posted = await github.createReview(ref, pr.number, body, [], reviewEvent).catch(() => false);
    }
    if (!posted) {
      await github.createComment(ref, pr.number, body);
    }
  }

  if (config.progressReactions) {
    await github.addReaction(ref, pr.number, '+1').catch(() => undefined);
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
  if (config.progressReactions) {
    await github.addReaction(ref, issue.number, 'rocket').catch(() => undefined);
  }

  let result: Awaited<ReturnType<typeof triageIssue>>;
  try {
    result = await triageIssue(ollama, issue, config.rulesContent);
  } catch (error) {
    if (!(error instanceof ModelResponseError)) {
      throw error;
    }
    console.warn('gitfox: model returned malformed output for issue triage, retrying once');
    result = await triageIssue(ollama, issue, config.rulesContent);
  }

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

  if (config.progressReactions) {
    await github.addReaction(ref, issue.number, '+1').catch(() => undefined);
  }
}
