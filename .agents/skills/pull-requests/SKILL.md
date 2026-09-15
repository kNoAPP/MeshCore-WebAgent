---
# Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
# (https://github.com/kNoAPP/MeshCore-WebAgent)

name: pull-requests
description: >
  Pull request conventions and requirements: local validation before pushing,
  the PR template, and before/after images for UI changes. Use when creating a
  pull request, writing a PR description, preparing changes for review, or
  referencing the PR template — for ticket work and spontaneous work alike.
license: Proprietary. See LICENSE for complete terms.
metadata:
  author: kNoAPP
  version: '1.5.0'
---

# Pull Request Requirements

The human-facing process lives in [`CONTRIBUTING.md`](../../../CONTRIBUTING.md)
("Pull Request Process"); follow it. The points below are the agent-specific
detail, and they apply to **every** pull request — whether it closes an issue or
came from spontaneous work.

**A pull request is the only way code reaches `develop`.** It is the protected
default branch — never commit, push, or force-push to it directly, no matter how
small the change. Work that is too trivial to justify a PR is still too trivial
to justify bypassing one.

- Branch from and open the PR against `develop` (the default branch), using the
  branch-naming convention in the `commits` skill.
- Follow the PR template at `.github/PULL_REQUEST_TEMPLATE.md`.
- PR titles must follow Conventional Commits and use imperative mood.
- For the "Type of Change" section, select all applicable types based on the
  changes made. Do not delete the other options.
- Do not delete the comments in the PR template; replace the "None" placeholders
  with appropriate content.
- If the PR touches `lib/meshcore/`, the Description must list the affected
  commands and link to the relevant
  [Companion Protocol docs](https://docs.meshcore.io/companion_protocol/).
- `@kNoAPP` is requested for review automatically via CODEOWNERS — no need to
  add a reviewer manually.
- Once the PR is open, follow the `copilot-review-loop` skill: drive GitHub
  Actions to green, then resolve the Copilot review until the newest review
  approves the current head. That skill also defines the legitimate non-approval
  endings — a draft PR, no review requested, a timeout, the iteration cap — and
  reaching one of those is a documented stop, not a failure to follow this rule.

## Validate locally before you push

All five checks must pass before you push — CI runs the same ones, and fixing
failures locally is far faster than round-tripping through Actions:

```bash
npm run spell-check && npm run format:check && npm run lint \
  && npm run type-check && npm run build
```

`npm run format` auto-fixes formatting. New product terms belong in
`cspell.json`, not in a `cspell:ignore` comment. Re-run all five after any
commit you push to an open PR, including review-feedback fixes.

There is no automated test suite. For behavior `type-check` and `build` cannot
prove, exercise it in `npm run dev` — against a connected radio when one is
available — and say in the description what you verified and what still needs
hardware to confirm.

## Before/after images for UI changes

If the change alters the UI or UX in any perceivable way — layout, copy, color,
icons, states, motion, a new or removed control — the PR **description** must
show a before/after pair. A comment is not enough.

Capture the pair with the chrome-devtools MCP server:

1. **Before** — on `develop` (or with the change stashed), navigate to the
   affected view at a consistent viewport and take the screenshot.
2. **After** — on the working branch, same view, same viewport, same data.

Frame both shots identically so the diff is obvious, one pair per distinct
surface you changed, and write them to a scratch path such as `.git/shots/`.

Host them on a throwaway asset branch so nothing ships in the diff. The branch
is named after the PR, so this happens **after** `gh pr create` — capture the
images first, open the PR, then host and link them and re-upload the body. Build
it in a separate worktree — an orphan branch in the current worktree leaves
every tracked file untracked and can strand you there:

```bash
PR=$(gh pr view --json number --jq .number)
SHOT_BRANCH=assets/pr-$PR
# --orphan modifies `add`; the branch name comes from -b (verified, git 2.54).
git worktree add --orphan -b "$SHOT_BRANCH" ../shots-worktree
cp .git/shots/*.png ../shots-worktree/
git -C ../shots-worktree add -A
git -C ../shots-worktree commit -m "chore: add PR $PR screenshots"
git -C ../shots-worktree push -u origin "$SHOT_BRANCH"
git worktree remove ../shots-worktree
```

Your PR branch stays checked out and untouched throughout. To refresh the images
later the branch already exists, so check it out instead of creating it:
`git worktree add ../shots-worktree "$SHOT_BRANCH"`.

Then reference them from the body file and re-upload the whole body with
`gh pr edit "$PR" --body-file .git/PR_BODY.md`:

```md
| Before                                                                                                 | After                                                                                                |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| ![before](https://raw.githubusercontent.com/kNoAPP/MeshCore-WebAgent/assets/pr-123/before-sidebar.png) | ![after](https://raw.githubusercontent.com/kNoAPP/MeshCore-WebAgent/assets/pr-123/after-sidebar.png) |
```

Never commit screenshots to the working branch, to `public/`, or anywhere the
static export would pick them up. Edit the body file and re-upload it; never
round-trip a PR body through PowerShell (see
`/memories/repo/pr-workflow-windows.md`). Open the rendered PR page afterwards
to confirm both images load — a broken image is worse than none.

If a later commit changes the UI again, refresh the "after" image so the
description never describes an earlier version of the change.
