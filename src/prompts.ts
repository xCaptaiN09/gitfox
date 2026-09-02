import { ModelResponseError } from './errors';
import type { IssueContext, PullRequestContext } from './types';

export const REVIEW_JSON_CONTRACT = `{
  "summary": "one short paragraph describing what this PR does and overall assessment",
  "findings": [
    {
      "severity": "critical | warning | suggestion",
      "file": "path/relative/to/repo.ext",
      "line": 42,
      "comment": "what is wrong and why it matters",
      "suggestion": "optional: complete replacement code for the offending lines"
    }
  ]
}`;

export const TRIAGE_JSON_CONTRACT = `{
  "labels": ["bug", "question"],
  "comment": "a short helpful triage comment: what the issue is about, what info is missing, possible cause or next step"
}`;

const SEVERITY_RULES = `- "critical": bugs, security vulnerabilities, data loss, crashes, broken behavior
- "warning": likely problems, edge cases, performance issues, bad practices
- "suggestion": style, readability, minor improvements`;

export function buildReviewMessages(pr: PullRequestContext, rulesContent: string, diffText: string): { system: string; user: string } {
  const system = [
    'You are gitfox, a precise senior code reviewer running fully locally.',
    'You review pull request diffs and report ONLY real, concrete problems you can point to in the diff.',
    'Never invent files or lines that are not in the diff. Never comment on code that was not changed.',
    'Reply with valid JSON only, no markdown fences, matching exactly this shape:',
    REVIEW_JSON_CONTRACT,
    'Severity rules:',
    SEVERITY_RULES,
    'If there are no issues, return an empty findings array and say so in the summary.',
    rulesContent === '' ? '' : `\nThe team has extra rules you MUST enforce:\n${rulesContent}`
  ].filter((part) => part !== '').join('\n');

  const user = [
    `Pull request #${pr.number}: ${pr.title}`,
    `Author: ${pr.author}`,
    pr.body.trim() === '' ? '' : `Description:\n${pr.body.slice(0, 3000)}`,
    'Diff to review:',
    diffText
  ].filter((part) => part !== '').join('\n\n');

  return { system, user };
}

export function buildTriageMessages(issue: IssueContext, rulesContent: string): { system: string; user: string } {
  const system = [
    'You are gitfox, an issue triage assistant running fully locally.',
    'You read GitHub issues and classify them.',
    'Reply with valid JSON only, no markdown fences, matching exactly this shape:',
    TRIAGE_JSON_CONTRACT,
    'Allowed labels (use only these): bug, enhancement, question, documentation, duplicate, invalid, wontfix, "good first issue", "help wanted".',
    'Choose 1 to 3 labels. Write a short, kind, useful comment (max 120 words).',
    rulesContent === '' ? '' : `\nThe team has extra triage rules you MUST follow:\n${rulesContent}`
  ].filter((part) => part !== '').join('\n');

  const user = [
    `Issue #${issue.number}: ${issue.title}`,
    `Author: ${issue.author}`,
    issue.body.trim() === '' ? '' : `Body:\n${issue.body.slice(0, 4000)}`,
    issue.labels.length > 0 ? `Existing labels: ${issue.labels.join(', ')}` : ''
  ].filter((part) => part !== '').join('\n\n');

  return { system, user };
}

export function extractJson<T>(text: string): T {
  const trimmed = text.trim();
  const withoutFences = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(withoutFences) as T;
  } catch {
    // fall through to balanced-brace extraction
  }

  const firstBrace = withoutFences.indexOf('{');
  const lastBrace = withoutFences.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = withoutFences.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch (error) {
      throw new ModelResponseError('Model returned malformed JSON inside braces', { cause: error });
    }
  }

  throw new ModelResponseError(`Model response contains no JSON object. Response started with: ${withoutFences.slice(0, 200)}`);
}
