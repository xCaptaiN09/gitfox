"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.markerFor = exports.ISSUE_KIND = exports.PR_KIND = exports.GitHubClient = void 0;
const github_1 = require("@actions/github");
const errors_1 = require("./errors");
const markers_1 = require("./markers");
Object.defineProperty(exports, "markerFor", { enumerable: true, get: function () { return markers_1.markerFor; } });
const PR_KIND = 'pr-review';
exports.PR_KIND = PR_KIND;
const ISSUE_KIND = 'issue-triage';
exports.ISSUE_KIND = ISSUE_KIND;
const ITEMS_PER_PAGE = 100;
class GitHubClient {
    octokit;
    constructor(token) {
        try {
            this.octokit = (0, github_1.getOctokit)(token);
        }
        catch (error) {
            throw new errors_1.GitHubApiError('Failed to initialize GitHub client from token', { cause: error });
        }
    }
    wrap(error, what) {
        if (error instanceof errors_1.GitHubApiError) {
            return error;
        }
        const status = typeof error === 'object' && error !== null && 'status' in error
            ? error.status
            : undefined;
        const statusNumber = typeof status === 'number' ? status : undefined;
        const message = error instanceof Error ? error.message : String(error);
        return new errors_1.GitHubApiError(`GitHub API failed while ${what}: ${message}`, { cause: error, status: statusNumber });
    }
    async getPullRequest(ref, number) {
        try {
            const { data: pr } = await this.octokit.rest.pulls.get({
                owner: ref.owner,
                repo: ref.repo,
                pull_number: number
            });
            const diffResponse = await this.octokit.rest.pulls.get({
                owner: ref.owner,
                repo: ref.repo,
                pull_number: number,
                mediaType: { format: 'diff' }
            });
            const diff = typeof diffResponse.data === 'string' ? diffResponse.data : '';
            return {
                number,
                title: pr.title ?? '',
                body: pr.body ?? '',
                author: pr.user?.login ?? 'unknown',
                headSha: pr.head?.sha ?? '',
                diff,
                files: []
            };
        }
        catch (error) {
            throw this.wrap(error, `fetching pull request #${number}`);
        }
    }
    async getIssue(ref, number) {
        try {
            const { data: issue } = await this.octokit.rest.issues.get({
                owner: ref.owner,
                repo: ref.repo,
                issue_number: number
            });
            return {
                number,
                title: issue.title ?? '',
                body: issue.body ?? '',
                author: issue.user?.login ?? 'unknown',
                labels: issue.labels
                    .map((label) => (typeof label === 'string' ? label : label.name ?? ''))
                    .filter((name) => name !== '')
            };
        }
        catch (error) {
            throw this.wrap(error, `fetching issue #${number}`);
        }
    }
    async listOpenPullRequests(ref) {
        try {
            const { data } = await this.octokit.rest.pulls.list({
                owner: ref.owner,
                repo: ref.repo,
                state: 'open',
                per_page: ITEMS_PER_PAGE
            });
            return data.map((pr) => pr.number);
        }
        catch (error) {
            throw this.wrap(error, 'listing open pull requests');
        }
    }
    async listOpenIssues(ref) {
        try {
            const { data } = await this.octokit.rest.issues.listForRepo({
                owner: ref.owner,
                repo: ref.repo,
                state: 'open',
                per_page: ITEMS_PER_PAGE
            });
            return data
                .filter((issue) => issue.pull_request === undefined)
                .map((issue) => issue.number);
        }
        catch (error) {
            throw this.wrap(error, 'listing open issues');
        }
    }
    async listCommentBodies(ref, number) {
        try {
            const { data } = await this.octokit.rest.issues.listComments({
                owner: ref.owner,
                repo: ref.repo,
                issue_number: number,
                per_page: ITEMS_PER_PAGE
            });
            return data.map((comment) => comment.body ?? '');
        }
        catch (error) {
            throw this.wrap(error, `listing comments on #${number}`);
        }
    }
    async createComment(ref, number, body) {
        try {
            await this.octokit.rest.issues.createComment({
                owner: ref.owner,
                repo: ref.repo,
                issue_number: number,
                body
            });
        }
        catch (error) {
            throw this.wrap(error, `posting comment on #${number}`);
        }
    }
    async addLabels(ref, number, labels) {
        try {
            await this.octokit.rest.issues.addLabels({
                owner: ref.owner,
                repo: ref.repo,
                issue_number: number,
                labels
            });
        }
        catch (error) {
            throw this.wrap(error, `adding labels to #${number}`);
        }
    }
    async createInlineReview(ref, number, body, comments) {
        try {
            await this.octokit.rest.pulls.createReview({
                owner: ref.owner,
                repo: ref.repo,
                pull_number: number,
                event: 'COMMENT',
                body,
                comments
            });
            return true;
        }
        catch (error) {
            const status = typeof error === 'object' && error !== null && 'status' in error
                ? error.status
                : undefined;
            if (status === 422 || status === 400 || status === 404) {
                return false;
            }
            throw this.wrap(error, `posting inline review on #${number}`);
        }
    }
    async searchClosedFixes(ref, keywords) {
        if (keywords.length === 0) {
            return [];
        }
        const query = [
            `repo:${ref.owner}/${ref.repo}`,
            'is:closed',
            ...keywords.slice(0, 5)
        ].join(' ');
        try {
            const response = await this.octokit.rest.search.issuesAndPullRequests({
                q: query,
                per_page: 3,
                sort: 'updated',
                order: 'desc'
            });
            return response.data.items.map((item) => ({
                number: item.number,
                title: item.title ?? '',
                url: item.html_url ?? ''
            }));
        }
        catch (error) {
            throw this.wrap(error, 'searching closed PRs/issues for prior fixes');
        }
    }
    async alreadyRepliedToPr(ref, number, headSha) {
        const bodies = await this.listCommentBodies(ref, number);
        return (0, markers_1.hasMarker)(bodies, PR_KIND, number, headSha);
    }
    async alreadyRepliedToIssue(ref, number) {
        const bodies = await this.listCommentBodies(ref, number);
        return (0, markers_1.hasMarker)(bodies, ISSUE_KIND, number);
    }
    prMarker(number, headSha) {
        return (0, markers_1.markerFor)(PR_KIND, number, headSha);
    }
    issueMarker(number) {
        return (0, markers_1.markerFor)(ISSUE_KIND, number);
    }
}
exports.GitHubClient = GitHubClient;
