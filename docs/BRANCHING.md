# Branching Model

A lightweight Git-flow suited to a small team / solo pilot, structured the way
larger projects are so it scales without a rewrite.

## Long-lived branches

| Branch | Purpose | Deploys to | Protected |
| --- | --- | --- | --- |
| `main` | Production-ready code only. Every commit is releasable. | Production (Render backend + Vercel frontend) | Yes |
| `develop` | Integration branch. All feature work merges here first. | Preview / staging | Yes |

Never commit directly to `main`. `main` only ever receives merges from
`release/*` or `hotfix/*` (via pull request).

## Short-lived branches

Branch off `develop` (except hotfixes, which branch off `main`):

| Prefix | For | Example |
| --- | --- | --- |
| `feature/` | New functionality | `feature/document-upload-ui` |
| `fix/` | Non-urgent bug fixes | `fix/readyz-timeout` |
| `chore/` | Tooling, deps, config | `chore/bump-next` |
| `docs/` | Documentation only | `docs/env-keys` |
| `refactor/` | Internal changes, no behaviour change | `refactor/api-client` |
| `release/` | Stabilize a version before release | `release/0.2.0` |
| `hotfix/` | Urgent production fix (branch from `main`) | `hotfix/cors-origin` |

Naming: lowercase, kebab-case, short and descriptive. Optionally prefix with an
issue number: `feature/42-sse-run-events`.

## Everyday flow

```bash
# start work
git checkout develop
git pull
git checkout -b feature/my-thing

# ... commit as you go ...
git push -u origin feature/my-thing
# open a Pull Request into develop
```

1. Open a PR into `develop`. CI (lint, typecheck, tests) must pass.
2. Review, then squash-merge into `develop`. Delete the branch.
3. To release: branch `release/x.y.z` off `develop`, finalize, then PR into
   `main` and tag `vX.Y.Z`. Merge `main` back into `develop`.
4. Urgent prod bug: branch `hotfix/...` off `main`, PR into `main`, tag, then
   merge back into `develop`.

## Environment mapping

- `main` → **production** (Render + Vercel production).
- `develop` → **preview/staging** (Vercel preview deployments; a staging Render
  service if/when added).
- `feature/*` → Vercel preview deployment per PR (optional).

See [ENVIRONMENTS.md](ENVIRONMENTS.md).

## Recommended branch protection (GitHub → Settings → Branches)

Set these once the repo is pushed. They can't be configured from the CLI
without admin rights, so do them in the GitHub UI:

For `main` **and** `develop`:

- Require a pull request before merging. For the solo pilot, require zero
  approvals but all status checks; switch to at least one approval when a
  second human collaborator joins.
- Require status checks to pass: `Backend quality`, `build`, and
  `Full-history secret scan`.
- Require branches to be up to date before merging.
- Do not allow direct pushes / force pushes.
- Include administrators.

Keep the repository **private** for the pilot; no secrets in Git.

## Commit messages

Short imperative subject (“Add SSE client”, “Fix CORS origin”). Conventional
Commits (`feat:`, `fix:`, `docs:`, `chore:`) are encouraged but not required.
