"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDiff = parseDiff;
exports.truncatePatch = truncatePatch;
exports.extractHunkRanges = extractHunkRanges;
exports.isLineInDiff = isLineInDiff;
exports.formatDiffForPrompt = formatDiffForPrompt;
const errors_1 = require("./errors");
const DIFF_HEADER_PREFIX = 'diff --git ';
const MAX_PATCH_CHARS_PER_FILE = 12000;
function parseDiff(diffText) {
    if (typeof diffText !== 'string') {
        throw new errors_1.GitfoxError(`parseDiff expected a string, got: ${typeof diffText}`);
    }
    const files = [];
    let currentPath = null;
    let currentLines = [];
    const flush = () => {
        if (currentPath !== null) {
            files.push({ path: currentPath, patch: currentLines.join('\n') });
            currentPath = null;
            currentLines = [];
        }
    };
    for (const line of diffText.split('\n')) {
        if (line.startsWith(DIFF_HEADER_PREFIX)) {
            flush();
            const match = / b\/(.+?)(?:\t|$)/.exec(line);
            currentPath = match !== null ? match[1] : 'unknown';
        }
        else if (currentPath !== null) {
            currentLines.push(line);
        }
    }
    flush();
    return files;
}
function truncatePatch(patch, maxChars = MAX_PATCH_CHARS_PER_FILE) {
    if (patch.length <= maxChars) {
        return patch;
    }
    return `${patch.slice(0, maxChars)}\n... [patch truncated, ${patch.length - maxChars} chars omitted]`;
}
function extractHunkRanges(patch) {
    const ranges = [];
    const hunkRegex = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
    let match;
    while ((match = hunkRegex.exec(patch)) !== null) {
        const start = Number.parseInt(match[1], 10);
        const count = match[2] !== undefined ? Number.parseInt(match[2], 10) : 1;
        ranges.push({ start, count });
    }
    return ranges;
}
function isLineInDiff(file, line) {
    if (file.patch === null || !Number.isInteger(line) || line <= 0) {
        return false;
    }
    for (const range of extractHunkRanges(file.patch)) {
        if (line >= range.start && line < range.start + Math.max(range.count, 1)) {
            return true;
        }
    }
    return false;
}
function formatDiffForPrompt(files, maxTotalChars = 60000) {
    const sections = [];
    let totalChars = 0;
    for (const file of files) {
        if (file.patch === null || file.patch.trim() === '') {
            continue;
        }
        const truncated = truncatePatch(file.patch);
        const section = `### File: ${file.path}\n\`\`\`diff\n${truncated}\n\`\`\``;
        if (totalChars + section.length > maxTotalChars) {
            sections.push(`### File: ${file.path}\n[skipped: diff size budget exhausted]`);
            break;
        }
        sections.push(section);
        totalChars += section.length;
    }
    if (sections.length === 0) {
        return '[no textual diffs found — changes may be binary or empty]';
    }
    return sections.join('\n\n');
}
