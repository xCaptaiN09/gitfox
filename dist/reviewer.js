"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEVERITY_EMOJI = void 0;
exports.normalizeFindings = normalizeFindings;
exports.reviewPullRequest = reviewPullRequest;
exports.renderReviewComment = renderReviewComment;
const diff_parser_1 = require("./diff-parser");
const errors_1 = require("./errors");
const prompts_1 = require("./prompts");
const SEVERITIES = new Set(['critical', 'warning', 'suggestion']);
function normalizeFindings(raw, maxComments) {
    if (!Array.isArray(raw)) {
        throw new errors_1.ModelResponseError('Model JSON is missing the "findings" array');
    }
    const findings = [];
    for (const item of raw) {
        if (typeof item !== 'object' || item === null) {
            continue;
        }
        const candidate = item;
        if (typeof candidate.file !== 'string' || candidate.file.trim() === '') {
            continue;
        }
        if (typeof candidate.comment !== 'string' || candidate.comment.trim() === '') {
            continue;
        }
        const severity = typeof candidate.severity === 'string' && SEVERITIES.has(candidate.severity)
            ? candidate.severity
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
async function reviewPullRequest(ollama, pr, rulesContent, maxComments) {
    const files = (0, diff_parser_1.parseDiff)(pr.diff);
    pr.files = files;
    const diffText = (0, diff_parser_1.formatDiffForPrompt)(files);
    const { system, user } = (0, prompts_1.buildReviewMessages)(pr, rulesContent, diffText);
    const content = await ollama.chat([
        { role: 'system', content: system },
        { role: 'user', content: user }
    ], { json: true });
    const parsed = (0, prompts_1.extractJson)(content);
    return {
        summary: typeof parsed.summary === 'string' ? parsed.summary.trim() : '',
        findings: normalizeFindings(parsed.findings, maxComments)
    };
}
const SEVERITY_EMOJI = {
    critical: '🔴',
    warning: '🟡',
    suggestion: '🟢'
};
exports.SEVERITY_EMOJI = SEVERITY_EMOJI;
function renderReviewComment(pr, result, priorFixes, marker, postSuggestions, commitSha, inlineCount) {
    const sections = [];
    sections.push(`${marker}`);
    sections.push(`## 🦊 gitfox review of #${pr.number}`);
    if (commitSha !== undefined && commitSha !== '') {
        sections.push(`Reviewed commit: \`${commitSha.slice(0, 7)}\``);
    }
    const critical = result.findings.filter((f) => f.severity === 'critical').length;
    const warnings = result.findings.filter((f) => f.severity === 'warning').length;
    const suggestions = result.findings.filter((f) => f.severity === 'suggestion').length;
    const verdict = critical > 0 ? '🔴 Fix required' : warnings > 0 ? '⚠️ Improvements advised' : '✅ Looks good';
    sections.push('| Files changed | 🔴 Critical | 🟡 Warning | 🟢 Suggestion | Verdict |\n' +
        '|---|---|---|---|---|\n' +
        `| ${pr.files.length} | ${critical} | ${warnings} | ${suggestions} | ${verdict} |`);
    sections.push(result.summary === '' ? '*(no summary returned)*' : result.summary);
    if (inlineCount !== undefined && inlineCount > 0) {
        sections.push(`📍 ${inlineCount} finding(s) posted inline on the changed lines.`);
    }
    if (result.findings.length === 0) {
        sections.push('✅ **No issues found.** Looks good to me!');
    }
    else {
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
