"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanRepository = scanRepository;
exports.reviewAndPost = reviewAndPost;
exports.selectInlineFindings = selectInlineFindings;
exports.renderInlineComment = renderInlineComment;
exports.triageAndPost = triageAndPost;
const keywords_1 = require("./keywords");
const diff_parser_1 = require("./diff-parser");
const reviewer_1 = require("./reviewer");
const triager_1 = require("./triager");
async function scanRepository(github, ollama, config, ref) {
    const stats = {
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
        }
        catch (error) {
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
        }
        catch (error) {
            stats.failed += 1;
            console.error(`gitfox: failed to triage issue #${number}:`, error instanceof Error ? error.message : error);
        }
    }
    return stats;
}
async function reviewAndPost(github, ollama, config, ref, pr, headSha) {
    const result = await (0, reviewer_1.reviewPullRequest)(ollama, pr, config.rulesContent, config.maxComments);
    let priorFixes = [];
    if (config.searchFixed) {
        const keywords = (0, keywords_1.extractKeywords)(pr.title);
        priorFixes = await github.searchClosedFixes(ref, keywords).catch(() => []);
    }
    const inlineFindings = selectInlineFindings(pr, result);
    let inlinePosted = false;
    if (config.inlineComments && inlineFindings.length > 0) {
        const comments = inlineFindings.map((finding) => ({
            path: finding.file,
            line: finding.line,
            body: renderInlineComment(finding, config.postSuggestions)
        }));
        const remaining = result.findings.filter((f) => !inlineFindings.includes(f));
        const summaryBody = (0, reviewer_1.renderReviewComment)(pr, { ...result, findings: remaining }, priorFixes, github.prMarker(pr.number, headSha), config.postSuggestions, headSha, inlineFindings.length);
        inlinePosted = await github.createInlineReview(ref, pr.number, summaryBody, comments).catch(() => false);
    }
    if (!inlinePosted) {
        const body = (0, reviewer_1.renderReviewComment)(pr, result, priorFixes, github.prMarker(pr.number, headSha), config.postSuggestions, headSha);
        await github.createComment(ref, pr.number, body);
    }
}
function selectInlineFindings(pr, result) {
    const selected = [];
    for (const finding of result.findings) {
        if (finding.line === undefined) {
            continue;
        }
        const file = pr.files.find((candidate) => candidate.path === finding.file);
        if (file === undefined || !(0, diff_parser_1.isLineInDiff)(file, finding.line)) {
            continue;
        }
        selected.push(finding);
    }
    return selected;
}
function renderInlineComment(finding, postSuggestions) {
    const emoji = reviewer_1.SEVERITY_EMOJI[finding.severity];
    const parts = [`${emoji} ${finding.comment}`];
    if (postSuggestions && finding.suggestion !== undefined) {
        parts.push('```suggestion\n' + finding.suggestion + '\n```');
    }
    return parts.join('\n\n');
}
async function triageAndPost(github, ollama, config, ref, issue) {
    const result = await (0, triager_1.triageIssue)(ollama, issue, config.rulesContent);
    let priorFixes = [];
    if (config.searchFixed) {
        const keywords = (0, keywords_1.extractKeywords)(issue.title);
        priorFixes = await github.searchClosedFixes(ref, keywords).catch(() => []);
    }
    const body = (0, triager_1.renderTriageComment)(issue, result, priorFixes, github.issueMarker(issue.number));
    await github.createComment(ref, issue.number, body);
    if (result.labels.length > 0) {
        await github.addLabels(ref, issue.number, result.labels);
    }
}
