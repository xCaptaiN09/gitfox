# 🦊 Gitfox

**Private AI code review & issue triage for GitHub — powered by a local Ollama model.**

Your code never leaves the runner. No API keys. No cloud LLM. Free forever.

## Features

- **PR review** — detects bugs, security issues, and bad practices in pull request diffs, with severity labels:
  - 🔴 critical · 🟡 warning · 🟢 suggestion
- **Issue triage** — auto-labels new issues (`bug`, `enhancement`, `question`, ...) and posts a helpful comment
- **Catch-up scan** — run once with `scan-all: true` to review all currently open PRs and issues
- **Deduplication** — invisible comment markers ensure gitfox replies to each PR/issue only once
- **Team rules** — a `.gitfox/rules.md` file in your repo defines project-specific standards that gitfox enforces
- **Suggested fixes** — posts ready-to-apply GitHub suggestion blocks where possible
- **Prior fix detection** — searches closed PRs/issues for related fixes and links them

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
    permissions:
      contents: read
      issues: write
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: xCaptaiN09/gitfox@v1
```

No configuration, accounts, or API keys are required.

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
| `search-fixed`     | `true`                | Link to closed PRs/issues that may already fix a problem |

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
