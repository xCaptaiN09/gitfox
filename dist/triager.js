"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeLabels = normalizeLabels;
exports.triageIssue = triageIssue;
exports.renderTriageComment = renderTriageComment;
const errors_1 = require("./errors");
const prompts_1 = require("./prompts");
const ALLOWED_LABELS = new Set([
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
function normalizeLabels(raw) {
    if (!Array.isArray(raw)) {
        throw new errors_1.ModelResponseError('Model JSON is missing the "labels" array');
    }
    const labels = raw
        .filter((label) => typeof label === 'string')
        .map((label) => label.trim().toLowerCase())
        .filter((label) => ALLOWED_LABELS.has(label));
    return [...new Set(labels)].slice(0, 3);
}
async function triageIssue(ollama, issue, rulesContent) {
    const { system, user } = (0, prompts_1.buildTriageMessages)(issue, rulesContent);
    const content = await ollama.chat([
        { role: 'system', content: system },
        { role: 'user', content: user }
    ], { json: true });
    const parsed = (0, prompts_1.extractJson)(content);
    if (typeof parsed.comment !== 'string' || parsed.comment.trim() === '') {
        throw new errors_1.ModelResponseError('Model JSON is missing the "comment" string');
    }
    return {
        labels: normalizeLabels(parsed.labels),
        comment: parsed.comment.trim()
    };
}
function renderTriageComment(issue, result, priorFixes, marker) {
    const sections = [];
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
