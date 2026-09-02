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
    const suggestion = typeof candidate.suggestion === 'string' && candidate.suggestion.trim() !== ''
      ? candidate.suggestion.trim()
      : undefined;
    findings.push({
      severity,
      file: candidate.file.trim(),
      line,
      comment: candidate.comment.trim(),
      suggestion
    });
  }
  return findings.slice(0, maxComments);
}

export async function reviewPullRequest(
  ollama: OllamaClient,
  pr: PullRequestContext,
  rulesContent: string,
  maxComments: number
): Promise<ReviewResult> {
  const files = parseDiff(pr.diff);
  pr.files = files;
  const diffText = formatDiffForPrompt(files);
  const { system, user } = buildReviewMessages(pr, rulesContent, diffText);

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

export function renderReviewComment(
  pr: PullRequestContext,
  result: ReviewResult,
  priorFixes: PriorFixResult[],
  marker: string,
  postSuggestions: boolean
): string {
  const sections: string[] = [];
  sections.push(`${marker}`);
  sections.push(`## 🦊 gitfox review of #${pr.number}`);
  sections.push(result.summary === '' ? '*(no summary returned)*' : result.summary);

  if (result.findings.length === 0) {
    sections.push('✅ **No issues found.** Looks good to me!');
  } else {
    sections.push('### Findings');
    for (const finding of result.findings) {
      const location = finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
      sections.push(`#### ${SEVERITY_EMOJI[finding.severity]} \`${location}\``);
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
