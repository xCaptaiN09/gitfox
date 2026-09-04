# 🦊 Gitfox

![Release](https://img.shields.io/github/v/release/xCaptaiN09/gitfox) ![License](https://img.shields.io/github/license/xCaptaiN09/gitfox) ![Tests](https://img.shields.io/badge/tests-35%2F35-brightgreen)

**Private AI code review & issue triage for GitHub — powered by a local Ollama model.**

Your code never leaves the runner. No API keys. No cloud LLM. Free forever.

## Features

- **PR review** — detects bugs, security issues, and bad practices in pull request diffs, with severity labels:
  - 🔴 critical · 🟡 warning · 🟢 suggestion
- **Issue triage** — auto-labels new issues (`bug`, `enhancement`, `question`, ...) and posts a helpful comment
- **Catch-up scan** — run once with `scan-all: true` to review all currently open PRs and issues
- **Deduplication** — invisible comment markers ensure gitfox replies to each PR/issue only once
- **Team rules** — a `.gitfox/rules.md` file in your repo defines project-specific standards that gitfox enforces
- **Suggested fixes** — posts ready-to-apply GitHub suggestion blocks where possible, including multi-line ranges
- **Prior fix detection** — searches closed PRs/issues for related fixes and links them
- **Blocking reviews (v1.2)** — opt in with `request-changes: true` and critical 🔴 findings formally block the merge
- **Repo context (v1.2)** — gitfox reads the repo file tree plus related source files to catch cross-file issues
- **Progress reactions (v1.2)** — 🚀 on the PR/issue while reviewing, 👍 when done
- **Incremental re-review (v1.2)** — new pushes re-analyze only the commits since the last reviewed SHA

## Quick start

Create `.github/workflows/gitfox.yml` in your repository:

```yaml
name: gitfox
on:
  pull_request:
    types: [opened, synchronize, reopened]
  issues:
    types: [opened]
  issue_comment:
    types: [created]
  workflow_dispatch:

jobs:
  gitfox:
    runs-on: ubuntu-latest
    timeout-minutes: 45
    permissions:
      contents: read
      issues: write
      pull-requests: write
    concurrency:
      group: gitfox-${{ github.event.pull_request.number || github.event.issue.number || github.run_id }}
      cancel-in-progress: false
    steps:
      - uses: actions/checkout@v4
      - uses: xCaptaiN09/gitfox@v1
```

No configuration, accounts, or API keys are required.

> **Tip:** the `concurrency` block queues gitfox runs for the same PR/issue so parallel
> events (a `/gitfox` command plus a new push, for example) never double-review.

### Commands

Comment `/gitfox` or `@gitfox` on any PR or issue and gitfox will re-run its review or triage. Without a mention, gitfox stays silent on follow-up comments.

### First launch on an existing repository

Open the **Actions** tab, select **gitfox**, and run the workflow with `scan_all: true`.
gitfox will scan all open PRs and issues and reply to any it has not already handled.

## Inputs

| Input              | Default               | Description                                              |
| ------------------ | --------------------- | -------------------------------------------------------- |
| `github-token`     | `${{ github.token }}` | Token used to read PRs/issues and post comments          |
| `model`            | `qwen2.5-coder:7b`    | Any Ollama model tag                                     |
| `rules-path`       | `.gitfox/rules.md`    | Path to the team rules file (optional)                   |
| `scan-all`         | `false`               | Scan all open PRs/issues (catch-up mode)                 |
| `max-scan-items`   | `10`                  | Safety cap for scan runs                                 |
| `max-comments`     | `10`                  | Maximum findings posted per PR                           |
| `post-suggestions` | `true`                | Include apply-ready suggestion blocks                    |
| `inline-comments`  | `true`                | Post findings inline on the exact changed lines          |
| `search-fixed`     | `true`                | Link to closed PRs/issues that may already fix a problem |
| `request-changes`  | `false`               | Submit REQUEST_CHANGES reviews when critical findings exist (blocks merge) |
| `repo-context`     | `true`                | Include repo file tree + related files in the review prompt |
| `progress-reactions` | `true`              | React 🚀 while reviewing and 👍 when done                |
| `incremental-review` | `true`              | On new pushes, review only changes since the last reviewed commit |

## Team rules

Create `.gitfox/rules.md` in your repository:

```markdown
# Our review rules

- All user input must be validated before parsing.
- No `any` types in TypeScript.
- Use parameterized SQL queries only.
- Every public function needs a doc comment.
```

gitfox reads this file on every run and enforces it during review and triage.

## Model choice

The default model is `qwen2.5-coder:7b`, which balances review quality and runtime on GitHub's free runners. Use `qwen2.5-coder:0.5b` for faster, lighter runs, or larger models on bigger runners.

## Privacy

gitfox runs the model on the GitHub Actions runner itself via Ollama:

```
your code -> runner (Ollama) -> review comment -> runner destroyed
```

No code is sent to OpenAI, Anthropic, or any other cloud service.

## License

[MIT](LICENSE)

## Releases / Changelog

| Version | Date | Highlights |
|---------|------|------------|
| **v1.2.2** | 2026-09-04 | Action hardening verified in live end-to-end runs: sudo-free Ollama install into the runner temp dir, correct tarball URL (`.tar.zst`) with zstd extract + installer fallback, no workspace-scoped caches, Node 22, binary+model caching |
| **v1.2.1** | 2026-09-04 | Model caching (Ollama binary + model persisted between runs — no more 4.7GB download every run), npm dependency cache, deterministic single Ollama server, 45-min job timeout guard, `qwen2.5-coder:7b` standardized everywhere |
| **v1.2.0** | 2026-09-04 | `request-changes` mode blocks merges on critical findings, repo-context prompts (file tree + related source files), multi-line suggestions, 🚀/👍 progress reactions, incremental re-review of only new commits |
| **v1.1.2** | 2026-09-04 | Retry once on malformed model output, then skip gracefully — model hiccups no longer fail the workflow. Summary-table counts fixed; dedup now also checks posted reviews, not just comments |
| **v1.1.0** | 2026-09-02 | Re-review on every new PR commit, `/gitfox` comment command, inline review comments on exact lines, summary table with verdict |
| **v1.0.0** | 2026-09-02 | First release: PR review, issue triage, catch-up scan, dedup, team rules, suggested fixes |

> Users always get the latest stable behavior via `uses: xCaptaiN09/gitfox@v1` — the tag is kept up to date with fixes.
> Full notes: [Releases page](https://github.com/xCaptaiN09/gitfox/releases)
