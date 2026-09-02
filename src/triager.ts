import { ModelResponseError } from './errors';
import type { OllamaClient } from './ollama-client';
import { buildTriageMessages, extractJson } from './prompts';
import type { IssueContext, TriageResult } from './types';

const ALLOWED_LABELS: ReadonlySet<string> = new Set([
  'bug',
  'enhancement',
  'question',
  'documentation',
  'duplicate',
  'invalid',
  'wontfix',
  'good first issue',
  'help wanted'
]);

interface RawTriage {
  labels?: unknown;
  comment?: unknown;
}

export function normalizeLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    throw new ModelResponseError('Model JSON is missing the "labels" array');
  }
  const labels = raw
    .filter((label): label is string => typeof label === 'string')
    .map((label) => label.trim().toLowerCase())
    .filter((label) => ALLOWED_LABELS.has(label));
  return [...new Set(labels)].slice(0, 3);
}

export async function triageIssue(
  ollama: OllamaClient,
  issue: IssueContext,
  rulesContent: string
): Promise<TriageResult> {
  const { system, user } = buildTriageMessages(issue, rulesContent);

  const content = await ollama.chat(
    [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    { json: true }
  );

  const parsed = extractJson<RawTriage>(content);
  if (typeof parsed.comment !== 'string' || parsed.comment.trim() === '') {
    throw new ModelResponseError('Model JSON is missing the "comment" string');
  }
  return {
    labels: normalizeLabels(parsed.labels),
    comment: parsed.comment.trim()
  };
}

export function renderTriageComment(
  issue: IssueContext,
  result: TriageResult,
  priorFixes: Array<{ number: number; title: string }>,
  marker: string
): string {
  const sections: string[] = [];
  sections.push(marker);
  sections.push(`## 🦊 gitfox triage of #${issue.number}`);

  if (result.labels.length > 0) {
    sections.push(`**Labels:** ${result.labels.map((label) => `\`${label}\``).join(' ')}`);
  }

  sections.push(result.comment);

  if (priorFixes.length > 0) {
    sections.push('### 🔎 Possibly related closed items');
    for (const fix of priorFixes) {
      sections.push(`- #${fix.number} — ${fix.title}`);
    }
  }

  sections.push('---');
  sections.push('*🦊 gitfox — private local AI triage (Ollama).*');
  return sections.join('\n\n');
}
