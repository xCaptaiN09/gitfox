import { getOctokit } from '@actions/github';
import { GitHubApiError } from './errors';
import { hasAnyMarker, hasMarker, markerFor, parseReviewedSha } from './markers';
import type { IssueContext, PullRequestContext } from './types';

const PR_KIND = 'pr-review';
const ISSUE_KIND = 'issue-triage';
const ITEMS_PER_PAGE = 100;

interface RepoRef {
  owner: string;
  repo: string;
}

export interface PriorFixResult {
  number: number;
  title: string;
  url: string;
}

export type ReviewEvent = 'COMMENT' | 'REQUEST_CHANGES' | 'APPROVE';

export interface ReviewCommentPayload {
  path: string;
  line: number;
  side: 'RIGHT';
  start_line?: number;
  start_side?: 'RIGHT';
  body: string;
}

export function buildReviewPayload(
  body: string,
  comments: Array<{ path: string; line: number; startLine?: number; body: string }>,
  event: ReviewEvent
): { event: ReviewEvent; body: string; comments: ReviewCommentPayload[] } {
  return {
    event,
    body,
    comments: comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: 'RIGHT' as const,
      ...(comment.startLine !== undefined && comment.startLine < comment.line
        ? { start_line: comment.startLine, start_side: 'RIGHT' as const }
        : {}),
      body: comment.body
    }))
  };
}

export class GitHubClient {
  private readonly octokit: ReturnType<typeof getOctokit>;

  public constructor(token: string) {
    try {
      this.octokit = getOctokit(token);
    } catch (error) {
      throw new GitHubApiError('Failed to initialize GitHub client from token', { cause: error });
    }
  }

  private wrap(error: unknown, what: string): GitHubApiError {
    if (error instanceof GitHubApiError) {
      return error;
    }
    const status = typeof error === 'object' && error !== null && 'status' in error
      ? (error as { status?: unknown }).status
      : undefined;
    const statusNumber = typeof status === 'number' ? status : undefined;
    const message = error instanceof Error ? error.message : String(error);
    return new GitHubApiError(`GitHub API failed while ${what}: ${message}`, { cause: error, status: statusNumber });
  }

  public async getPullRequest(ref: RepoRef, number: number): Promise<PullRequestContext> {
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
        baseSha: pr.base?.sha ?? '',
        baseRef: pr.base?.ref ?? '',
        diff,
        files: []
      };
    } catch (error) {
      throw this.wrap(error, `fetching pull request #${number}`);
    }
  }

  public async getIssue(ref: RepoRef, number: number): Promise<IssueContext> {
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
    } catch (error) {
      throw this.wrap(error, `fetching issue #${number}`);
    }
  }

  public async listOpenPullRequests(ref: RepoRef): Promise<number[]> {
    try {
      const { data } = await this.octokit.rest.pulls.list({
        owner: ref.owner,
        repo: ref.repo,
        state: 'open',
        per_page: ITEMS_PER_PAGE
      });
      return data.map((pr) => pr.number);
    } catch (error) {
      throw this.wrap(error, 'listing open pull requests');
    }
  }

  public async listOpenIssues(ref: RepoRef): Promise<number[]> {
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
    } catch (error) {
      throw this.wrap(error, 'listing open issues');
    }
  }

  public async listCommentBodies(ref: RepoRef, number: number): Promise<string[]> {
    try {
      const { data } = await this.octokit.rest.issues.listComments({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: number,
        per_page: ITEMS_PER_PAGE
      });
      return data.map((comment) => comment.body ?? '');
    } catch (error) {
      throw this.wrap(error, `listing comments on #${number}`);
    }
  }

  public async listReviewBodies(ref: RepoRef, number: number): Promise<string[]> {
    try {
      const { data } = await this.octokit.rest.pulls.listReviews({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: number,
        per_page: ITEMS_PER_PAGE
      });
      return data.map((review) => review.body ?? '');
    } catch (error) {
      throw this.wrap(error, `listing reviews on PR #${number}`);
    }
  }

  public async createComment(ref: RepoRef, number: number, body: string): Promise<void> {
    try {
      await this.octokit.rest.issues.createComment({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: number,
        body
      });
    } catch (error) {
      throw this.wrap(error, `posting comment on #${number}`);
    }
  }

  public async addLabels(ref: RepoRef, number: number, labels: string[]): Promise<void> {
    try {
      await this.octokit.rest.issues.addLabels({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: number,
        labels
      });
    } catch (error) {
      throw this.wrap(error, `adding labels to #${number}`);
    }
  }

  public async getFileTree(ref: RepoRef, sha: string, maxEntries: number = 3000): Promise<string[]> {
    if (sha === '') {
      return [];
    }
    try {
      const { data } = await this.octokit.rest.git.getTree({
        owner: ref.owner,
        repo: ref.repo,
        tree_sha: sha,
        recursive: 'true'
      });
      const paths: string[] = [];
      for (const entry of data.tree) {
        if (entry.type === 'blob' && typeof entry.path === 'string' && paths.length < maxEntries) {
          paths.push(entry.path);
        }
      }
      return paths;
    } catch (error) {
      throw this.wrap(error, `fetching file tree at ${sha.slice(0, 7)}`);
    }
  }

  public async getFileContent(ref: RepoRef, sha: string, path: string, maxBytes: number = 100000): Promise<string | null> {
    try {
      const { data } = await this.octokit.rest.repos.getContent({
        owner: ref.owner,
        repo: ref.repo,
        path,
        ref: sha
      });
      if (Array.isArray(data) || data.type !== 'file' || typeof data.content !== 'string') {
        return null;
      }
      if (data.size !== undefined && data.size > maxBytes) {
        return null;
      }
      return Buffer.from(data.content, 'base64').toString('utf8');
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error
        ? (error as { status?: unknown }).status
        : undefined;
      if (status === 404 || status === 403) {
        return null;
      }
      throw this.wrap(error, `fetching content of ${path}`);
    }
  }

  public async addReaction(ref: RepoRef, number: number, content: 'rocket' | '+1' | 'eyes'): Promise<boolean> {
    try {
      await this.octokit.rest.reactions.createForIssue({
        owner: ref.owner,
        repo: ref.repo,
        issue_number: number,
        content
      });
      return true;
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error
        ? (error as { status?: unknown }).status
        : undefined;
      if (status === 409 || status === 422) {
        return false;
      }
      throw this.wrap(error, `adding ${content} reaction on #${number}`);
    }
  }

  public async compareDiff(ref: RepoRef, base: string, head: string, maxChars: number = 60000): Promise<string> {
    if (base === '' || head === '' || base === head) {
      return '';
    }
    try {
      const { data } = await this.octokit.rest.repos.compareCommits({
        owner: ref.owner,
        repo: ref.repo,
        base,
        head
      });
      const parts: string[] = [];
      let total = 0;
      for (const file of data.files ?? []) {
        const section = `diff --git a/${file.filename} b/${file.filename}\n${file.patch ?? '[binary or no patch]'}`;
        if (total + section.length > maxChars) {
          break;
        }
        parts.push(section);
        total += section.length;
      }
      return parts.join('\n');
    } catch (error) {
      throw this.wrap(error, `comparing ${base.slice(0, 7)}...${head.slice(0, 7)}`);
    }
  }

  public async getLastReviewedSha(ref: RepoRef, number: number): Promise<string | undefined> {
    const bodies = await this.listReviewBodies(ref, number).catch(() => []);
    return parseReviewedSha(bodies, number);
  }

  public async createReview(
    ref: RepoRef,
    number: number,
    body: string,
    comments: Array<{ path: string; line: number; startLine?: number; body: string }>,
    event: ReviewEvent = 'COMMENT'
  ): Promise<boolean> {
    try {
      await this.octokit.rest.pulls.createReview({
        owner: ref.owner,
        repo: ref.repo,
        pull_number: number,
        ...buildReviewPayload(body, comments, event)
      });
      return true;
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error
        ? (error as { status?: unknown }).status
        : undefined;
      if (status === 422 || status === 400 || status === 404) {
        return false;
      }
      throw this.wrap(error, `posting review on #${number}`);
    }
  }

  public async createInlineReview(
    ref: RepoRef,
    number: number,
    body: string,
    comments: Array<{ path: string; line: number; body: string }>
  ): Promise<boolean> {
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
    } catch (error) {
      const status = typeof error === 'object' && error !== null && 'status' in error
        ? (error as { status?: unknown }).status
        : undefined;
      if (status === 422 || status === 400 || status === 404) {
        return false;
      }
      throw this.wrap(error, `posting inline review on #${number}`);
    }
  }

  public async searchClosedFixes(ref: RepoRef, keywords: string[]): Promise<PriorFixResult[]> {
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
    } catch (error) {
      throw this.wrap(error, 'searching closed PRs/issues for prior fixes');
    }
  }

  public async alreadyRepliedToPr(ref: RepoRef, number: number, headSha?: string): Promise<boolean> {
    const [comments, reviews] = await Promise.all([
      this.listCommentBodies(ref, number),
      this.listReviewBodies(ref, number).catch(() => [])
    ]);
    const bodies = [...comments, ...reviews];
    if (headSha !== undefined && headSha !== '') {
      return hasMarker(bodies, PR_KIND, number, headSha);
    }
    return hasAnyMarker(bodies, PR_KIND, number);
  }

  public async alreadyRepliedToIssue(ref: RepoRef, number: number): Promise<boolean> {
    const bodies = await this.listCommentBodies(ref, number);
    return hasMarker(bodies, ISSUE_KIND, number);
  }

  public prMarker(number: number, headSha?: string): string {
    return markerFor(PR_KIND, number, headSha);
  }

  public issueMarker(number: number): string {
    return markerFor(ISSUE_KIND, number);
  }
}

export { PR_KIND, ISSUE_KIND, markerFor };
