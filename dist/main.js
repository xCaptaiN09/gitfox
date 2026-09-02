"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const core = __importStar(require("@actions/core"));
const github_1 = require("@actions/github");
const config_1 = require("./config");
const errors_1 = require("./errors");
const github_client_1 = require("./github-client");
const markers_1 = require("./markers");
const ollama_client_1 = require("./ollama-client");
const scanner_1 = require("./scanner");
const SUPPORTED_PR_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);
const SUPPORTED_ISSUE_ACTIONS = new Set(['opened']);
const COMMENT_ACTION = 'created';
async function runCommentCommand(config) {
    const payload = github_1.context.payload;
    const comment = payload.comment;
    const issue = payload.issue;
    if (comment === undefined || typeof comment.body !== 'string' || issue === undefined || typeof issue.number !== 'number') {
        core.info('gitfox: no comment/issue in payload, skipping');
        return;
    }
    if (payload.action !== COMMENT_ACTION) {
        core.info(`gitfox: ignoring issue_comment action "${String(payload.action)}"`);
        return;
    }
    if (comment.user?.type === 'Bot') {
        core.info('gitfox: ignoring bot comment');
        return;
    }
    if (!(0, markers_1.isGitfoxMention)(comment.body)) {
        core.info('gitfox: comment does not mention gitfox, staying silent');
        return;
    }
    const github = new github_client_1.GitHubClient(config.token);
    const ollama = new ollama_client_1.OllamaClient(config.ollamaUrl, config.model);
    const ref = repoRef();
    if (issue.pull_request !== undefined) {
        core.info(`gitfox: command received on PR #${issue.number} — re-reviewing`);
        const pr = await github.getPullRequest(ref, issue.number);
        const headSha = typeof pr.headSha === 'string' ? pr.headSha : undefined;
        await (0, scanner_1.reviewAndPost)(github, ollama, config, ref, pr, headSha);
        core.info('gitfox: re-review posted');
        return;
    }
    core.info(`gitfox: command received on issue #${issue.number} — re-triaging`);
    const issueContext = await github.getIssue(ref, issue.number);
    await (0, scanner_1.triageAndPost)(github, ollama, config, ref, issueContext);
    core.info('gitfox: re-triage posted');
}
function repoRef() {
    if (github_1.context.repo.owner === '' || github_1.context.repo.repo === '') {
        throw new errors_1.GitfoxError('Could not determine owner/repo from the GitHub context');
    }
    return { owner: github_1.context.repo.owner, repo: github_1.context.repo.repo };
}
async function runScanAll(config) {
    const github = new github_client_1.GitHubClient(config.token);
    const ollama = new ollama_client_1.OllamaClient(config.ollamaUrl, config.model);
    const ref = repoRef();
    core.info('gitfox: scan-all mode — checking all open PRs and issues');
    const stats = await (0, scanner_1.scanRepository)(github, ollama, config, ref);
    core.info(`gitfox scan complete: ${stats.prsReviewed} PRs reviewed, ${stats.prsSkipped} skipped, ` +
        `${stats.issuesTriaged} issues triaged, ${stats.issuesSkipped} skipped, ${stats.failed} failed`);
}
async function runPullRequest(config) {
    const payload = github_1.context.payload.pull_request;
    if (payload === undefined || typeof payload.number !== 'number') {
        core.info('gitfox: no pull request in payload, skipping');
        return;
    }
    if (!SUPPORTED_PR_ACTIONS.has(github_1.context.payload.action ?? '')) {
        core.info(`gitfox: ignoring pull_request action "${String(github_1.context.payload.action)}"`);
        return;
    }
    const github = new github_client_1.GitHubClient(config.token);
    const ollama = new ollama_client_1.OllamaClient(config.ollamaUrl, config.model);
    const ref = repoRef();
    if (await github.alreadyRepliedToPr(ref, payload.number)) {
        core.info(`gitfox: already reviewed PR #${payload.number}, skipping`);
        return;
    }
    const pr = await github.getPullRequest(ref, payload.number);
    const headSha = typeof payload.pull_request.head?.sha === 'string' ? payload.pull_request.head.sha : undefined;
    core.info(`gitfox: reviewing PR #${pr.number} — ${pr.title}`);
    await (0, scanner_1.reviewAndPost)(github, ollama, config, ref, pr, headSha);
    core.info('gitfox: review posted');
}
async function runIssue(config) {
    const payload = github_1.context.payload.issue;
    if (payload === undefined || typeof payload.number !== 'number') {
        core.info('gitfox: no issue in payload, skipping');
        return;
    }
    if (!SUPPORTED_ISSUE_ACTIONS.has(github_1.context.payload.action ?? '')) {
        core.info(`gitfox: ignoring issues action "${String(github_1.context.payload.action)}"`);
        return;
    }
    const github = new github_client_1.GitHubClient(config.token);
    const ollama = new ollama_client_1.OllamaClient(config.ollamaUrl, config.model);
    const ref = repoRef();
    if (await github.alreadyRepliedToIssue(ref, payload.number)) {
        core.info(`gitfox: already triaged issue #${payload.number}, skipping`);
        return;
    }
    const issue = await github.getIssue(ref, payload.number);
    core.info(`gitfox: triaging issue #${issue.number} — ${issue.title}`);
    await (0, scanner_1.triageAndPost)(github, ollama, config, ref, issue);
    core.info('gitfox: triage posted');
}
async function run() {
    const config = (0, config_1.loadConfig)();
    if (config.scanAll) {
        await runScanAll(config);
        return;
    }
    switch (github_1.context.eventName) {
        case 'pull_request':
            await runPullRequest(config);
            break;
        case 'issues':
            await runIssue(config);
            break;
        case 'issue_comment':
            await runCommentCommand(config);
            break;
        default:
            core.info(`gitfox: unsupported event "${github_1.context.eventName}", nothing to do`);
    }
}
run().catch((error) => {
    if (error instanceof errors_1.GitHubApiError && error.status === 403 && String(error.message).includes('rate limit')) {
        core.error('gitfox hit the GitHub API rate limit. Consider raising max-scan-items or running less often.');
    }
    core.setFailed(error instanceof Error ? error.message : String(error));
});
