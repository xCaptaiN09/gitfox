# 🦊 gitfox

**Private AI code review & issue triage for GitHub — powered by a local Ollama model.**

> Your code never leaves the runner. No API keys. No cloud LLM. Free forever.

![gitfox](https://img.shields.io/badge/AI-local%20Ollama-orange) ![privacy](https://img.shields.io/badge/privacy-100%25%20local-green)

---

## ✨ Features

- 🔍 **PR review** — bugs, security issues, bad practices — with severity tags
  - 🔴 critical · 🟡 warning · 🟢 suggestion
- 🐛 **Issue triage** — auto-labels (`bug`, `enhancement`, `question`, …) + a helpful comment
- 🧹 **Catch-up scan** — first launch? Run once with `scan-all: true` and gitfox reviews ALL open PRs/issues
- 🔁 **Never spams** — invisible markers ensure gitfox replies to each PR/issue only once
- 📝 **Team rules** — drop a `.gitfox/rules.md` file and gitfox enforces *your* standards
- 🛠️ **Suggested fixes** — ready-to-apply GitHub suggestion blocks
- 🔎 **"Already fixed?" detection** — searches closed PRs/issues and links prior fixes

## 🚀 Quick start

Create `.github/workflows/gitfox.yml` in your repo:

```yaml
name: gitfox
on:
  pull_request:
    types: [opened, synchronize, reopened]
  issues:
    types: [opened]
  workflow_dispatch:        # enables the catch-up scan

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

That's it. Zero config. Zero API keys. 🎉

### First launch (existing repos)

Open the **Actions** tab → **gitfox** → **Run workflow** with `scan_all: true`.
gitfox will scan all open PRs and issues and reply to anything it hasn't seen yet.

## ⚙️ Inputs

| Input | Default | Description |
|---|---|---|
| `github-token` | `${{ github.token }}` | Token for reading/posting |
| `model` | `qwen2.5-coder:7b` | Any Ollama model tag |
| `rules-path` | `.gitfox/rules.md` | Team rules file (optional) |
| `scan-all` | `false` | Scan ALL open PRs/issues (catch-up mode) |
| `max-scan-items` | `10` | Safety cap for scan runs |
| `max-comments` | `10` | Max findings posted per PR |
| `post-suggestions` | `true` | Include apply-ready suggestion blocks |
| `search-fixed` | `true` | Link to closed PRs/issues that may already fix a problem |

## 📝 Team rules

Create `.gitfox/rules.md` in your repo:

```markdown
# Our review rules
- All user input must be validated before parsing.
- No `any` types in TypeScript.
- Use parameterized SQL queries only.
- Every public function needs a doc comment.
```

gitfox reads it on every run and enforces it. 🦊

## 🤖 Model choice

Default is `qwen2.5-coder:7b` — a good balance for GitHub's free runners.
Smaller repos or tight budgets: `qwen2.5-coder:0.5b`. Bigger runners: `qwen2.5-coder:14b`.

## 🔒 Privacy

gitfox runs the model **on the GitHub runner itself** via Ollama:

```
your code → runner (Ollama) → review comment → runner destroyed
```

Nothing is sent to OpenAI, Anthropic, or GitHub's Copilot cloud.

## 📄 License

MIT — see [LICENSE](LICENSE).
