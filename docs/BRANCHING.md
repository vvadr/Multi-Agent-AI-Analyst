# Branching Model

> **The rule: do all work on `staging`, and push to `staging`.**
> Never commit or push directly to `main`. `main` only ever changes through a
> pull request from `staging`.

A deliberately small model for a solo pilot / small team: one branch you work
on, one branch that is releasable.

## Long-lived branches

| Branch | Purpose | Deploys to | Protected |
| --- | --- | --- | --- |
| `main` | Production-ready code only. Every commit is releasable. | Production (Render backend + Vercel frontend) | Yes |
| `staging` | **The working branch.** All day-to-day commits land here. | Preview / staging | Yes |

`staging` is the default branch for everyday work. If you are unsure where a
change belongs, it belongs on `staging`.

## Everyday flow

```bash
# start work — always from staging
git checkout staging
git pull

# ... edit, commit as you go ...
git add <paths>
git commit -m "Add SSE client"

# publish
git push
```

Before starting, confirm you are on the right branch:

```bash
git branch --show-current   # expect: staging
git status -sb              # expect: no divergence from origin/staging
```

If `git status` reports your branch has diverged from `origin/staging`, pull
before pushing:

```bash
git pull --rebase
```

## Optional short-lived branches

Working directly on `staging` is the norm. For a large or risky change that you
want reviewed in isolation, branch off `staging` and merge back into `staging`
— never into `main`:

| Prefix | For | Example |
| --- | --- | --- |
| `feature/` | New functionality | `feature/document-upload-ui` |
| `fix/` | Non-urgent bug fixes | `fix/readyz-timeout` |
| `chore/` | Tooling, deps, config | `chore/bump-next` |
| `docs/` | Documentation only | `docs/env-keys` |
| `refactor/` | Internal changes, no behaviour change | `refactor/api-client` |
| `hotfix/` | Urgent production fix (branch from `main`) | `hotfix/cors-origin` |

Naming: lowercase, kebab-case, short and descriptive. Optionally prefix with an
issue number: `feature/42-sse-run-events`.

```bash
git checkout staging
git pull
git checkout -b feature/my-thing
git push -u origin feature/my-thing
# open a Pull Request into staging, then delete the branch after merge
```

## Releasing to production

1. Open a pull request from `staging` into `main`. CI (lint, typecheck, tests)
   must pass.
2. Merge, then tag the release on `main`: `git tag vX.Y.Z && git push --tags`.
3. `main` and `staging` now match; keep working on `staging`.

Urgent production bug: branch `hotfix/...` off `main`, PR into `main`, tag, then
merge `main` back into `staging` so the fix is not lost.

## Environment mapping

- `main` → **production** (Render + Vercel production).
- `staging` → **preview/staging** (Vercel preview deployments; a staging Render
  service if/when added).
- `feature/*` → Vercel preview deployment per PR (optional).

See [ENVIRONMENTS.md](ENVIRONMENTS.md).

## Recommended branch protection (GitHub → Settings → Branches)

Set these once the repo is pushed. They can't be configured from the CLI
without admin rights, so do them in the GitHub UI:

For `main`:

- Require a pull request before merging. For the solo pilot, require zero
  approvals but all status checks; switch to at least one approval when a
  second human collaborator joins.
- Require status checks to pass: `Backend quality`, `build`, and
  `Full-history secret scan`.
- Require branches to be up to date before merging.
- Do not allow direct pushes / force pushes.
- Include administrators.

For `staging`:

- Require status checks to pass, but **allow direct pushes** — this is the
  branch everyone works on.
- Do not allow force pushes, so shared history stays intact.

Consider setting `staging` as the repository's **default branch** so clones and
pull requests target it automatically.

Keep the repository **private** for the pilot; no secrets in Git.

## Commit messages

Short imperative subject (“Add SSE client”, “Fix CORS origin”). Conventional
Commits (`feat:`, `fix:`, `docs:`, `chore:`) are encouraged but not required.
