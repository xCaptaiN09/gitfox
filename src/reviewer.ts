import { formatDiffForPrompt, parseDiff } from './diff-parser';
import { ModelResponseError } from './errors';
import type { PriorFixResult } from './github-client';
import type { OllamaClient } from './ollama-client';
import { buildReviewMessages, extractJson } from './prompts';
import type { Finding, PullRequestContext, ReviewResult, Severity } from './types';

const SEVERITIES: ReadonlySet<string> = new Set(['critical', 'warning', 'suggestion']);

interface RawFinding {
  severity?: unknown;
  file?: unknown;
  line?: unknown;
  start_line?: unknown;
  comment?: unknown;
  suggestion?: unknown;
}

interface RawReview {
  summary?: unknown;
  findings?: unknown;
}

export function normalizeFindings(raw: unknown, maxComments: number): Finding[] {
  if (!Array.isArray(raw)) {
    throw new ModelResponseError('Model JSON is missing the "findings" array');
  }
  const findings: Finding[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }
    const candidate = item as RawFinding;
    if (typeof candidate.file !== 'string' || candidate.file.trim() === '') {
      continue;
    }
    if (typeof candidate.comment !== 'string' || candidate.comment.trim() === '') {
      continue;
    }
    const severity = typeof candidate.severity === 'string' && SEVERITIES.has(candidate.severity)
      ? (candidate.severity as Severity)
      : 'warning';
    const line = typeof candidate.line === 'number' && Number.isInteger(candidate.line) && candidate.line > 0
      ? candidate.line
      : undefined;
    const rawStart = typeof candidate.start_line === 'number' && Number.isInteger(candidate.start_line) && candidate.start_line > 0
      ? candidate.start_line
      : undefined;
    const startLine = rawStart !== undefined && line !== undefined && rawStart < line ? rawStart : undefined;
    const suggestion = typeof candidate.suggestion === 'string' && candidate.suggestion.trim() !== ''
      ? candidate.suggestion.trim()
      : undefined;
    findings.push({
      severity,
      file: candidate.file.trim(),
      line,
      startLine,
      comment: candidate.comment.trim(),
      suggestion
    });
  }
  return findings.slice(0, maxComments);
}

export interface ReviewOptions {
  diffTextOverride?: string;
  repoContext?: string;
}

export async function reviewPullRequest(
  ollama: OllamaClient,
  pr: PullRequestContext,
  rulesContent: string,
  maxComments: number,
  options: ReviewOptions = {}
): Promise<ReviewResult> {
  const files = parseDiff(pr.diff);
  pr.files = files;
  const diffText = options.diffTextOverride !== undefined && options.diffTextOverride !== ''
    ? formatDiffForPrompt(parseDiff(options.diffTextOverride))
    : formatDiffForPrompt(files);
  const { system, user } = buildReviewMessages(pr, rulesContent, diffText, options.repoContext ?? '');

  const content = await ollama.chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    { json: true }
  );

  const parsed = extractJson<RawReview>(content);
  return {
    summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
    findings: normalizeFindings(parsed.findings, maxComments)
  };
}

const SEVERITY_EMOJI: Record<Severity, string> = {
  critical: '🔴',
  warning: '🟡',
  suggestion: '🟢'
};

export { SEVERITY_EMOJI };

export function renderReviewComment(
  pr: PullRequestContext,
  result: ReviewResult,
  priorFixes: PriorFixResult[],
  marker: string,
  postSuggestions: boolean,
  commitSha?: string,
  inlineCount?: number,
  totalFindings?: Finding[],
  reviewEvent: 'COMMENT' | 'REQUEST_CHANGES' = 'COMMENT'
): string {
  const all = totalFindings ?? result.findings;
  const critical = all.filter((f) => f.severity === 'critical').length;
  const warnings = all.filter((f) => f.severity === 'warning').length;
  const suggestions = all.filter((f) => f.severity === 'suggestion').length;
  const verdict = critical > 0 ? '🔴 Fix required' : warnings > 0 ? '⚠️ Improvements advised' : all.length > 0 ? '🟢 Minor notes' : '✅ Looks good';

  const sections: string[] = [];
  sections.push(`${marker}`);
  sections.push(`## 🦊 gitfox review of #${pr.number}`);
  if (commitSha !== undefined && commitSha !== '') {
    sections.push(`Reviewed commit: \`${commitSha.slice(0, 7)}\``);
  }

  sections.push(
    '| Files changed | 🔴 Critical | 🟡 Warning | 🟢 Suggestion | Verdict |\n' +
    '|---|---|---|---|---|\n' +
    `| ${pr.files.length} | ${critical} | ${warnings} | ${suggestions} | ${verdict} |`
  );

  sections.push(result.summary === '' ? '*(no summary returned)*' : result.summary);

  if (reviewEvent === 'REQUEST_CHANGES') {
    sections.push('🚫 **gitfox requested changes** — this PR has critical findings and merge is formally blocked until they are resolved.');
  }

  const locationFor = (finding: Finding): string => {
    if (finding.line === undefined) {
      return finding.file;
    }
    if (finding.startLine !== undefined && finding.startLine < finding.line) {
      return `${finding.file}:${finding.startLine}-${finding.line}`;
    }
    return `${finding.file}:${finding.line}`;
  };

  if (inlineCount !== undefined && inlineCount > 0) {
    sections.push(`📍 ${inlineCount} finding(s) posted inline on the changed lines.`);
  }

  if (all.length === 0) {
    sections.push('✅ **No issues found.** Looks good to me!');
  } else if (inlineCount !== undefined && inlineCount >= all.length) {
    // all findings are inline; nothing more to list
  } else {
    sections.push('### Findings');
    for (const finding of result.findings) {
      sections.push(`#### ${SEVERITY_EMOJI[finding.severity]} \`${locationFor(finding)}\``);
      sections.push(finding.comment);
      if (postSuggestions && finding.suggestion !== undefined) {
        sections.push('```suggestion\n' + finding.suggestion + '\n```');
      }
    }
  }

  if (priorFixes.length > 0) {
    sections.push('### 🔎 Possibly related to prior fixes');
    for (const fix of priorFixes) {
      sections.push(`- #${fix.number} — ${fix.title}`);
    }
  }

  sections.push('---');
  sections.push('*🦊 gitfox — private local AI review (Ollama). No code left this machine.*');
  return sections.join('\n\n');
}
