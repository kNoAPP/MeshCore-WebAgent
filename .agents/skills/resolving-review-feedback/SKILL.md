---
# Required Notice: Copyright 2026 Knoban LLC. All rights reserved.
# (https://github.com/kNoAPP/MeshCore-WebAgent)

name: resolving-review-feedback
description: >
  Workflow for evaluating and resolving pull request review feedback. Use when
  asked to "resolve feedback" on a PR, respond to review comments, address
  reviewer suggestions, or work through unresolved review threads.
license: Proprietary. See LICENSE for complete terms.
metadata:
  author: kNoAPP
  version: '1.0.0'
---

# Resolving Review Feedback

When asked to "resolve feedback" on a PR (usually with a link), do **not**
blindly apply every suggestion. Evaluate each comment on its merits, then act.

Work through every unresolved review thread one at a time:

1. **Read the full context.** Fetch the PR, the thread, the diff hunk it points
   at, the surrounding code, and any linked issue. Weigh the comment against the
   code's actual goals and this project's conventions.
2. **Judge whether the feedback is correct.** Reviewers are not always right.
   - If valid, make the smallest code change that addresses it.
   - If wrong, out of scope, or based on a misunderstanding, do **not** change
     the code. Explain your reasoning instead.
   - If partially valid, apply what's correct and explain the rest.
3. **Reply on the thread.** Always post a comment on the thread stating what you
   did and why — whether you accepted it ("Done — …"), declined it ("Leaving as
   is because …"), or partially addressed it. Be specific and reference the
   code.
4. **Resolve the thread.** Mark the conversation resolved so GitHub shows it the
   same as clicking "Resolve conversation." This requires the GraphQL
   `resolveReviewThread` mutation — `gh pr` has no direct command for it:

   ```bash
   PR=102          # the PR number
   THREAD_ID=...   # a reviewThread node id from the query below

   # List review threads (the isResolved field tells you which are still open)
   gh api graphql -f query='
     query($owner:String!,$repo:String!,$pr:Int!){
       repository(owner:$owner,name:$repo){
         pullRequest(number:$pr){
           reviewThreads(first:100){
             nodes{ id isResolved comments(first:20){ nodes{ body path } } }
           }
         }
       }
     }' -f owner=kNoAPP -f repo=MeshCore-WebAgent -F pr="$PR"

   # Reply to a thread, then resolve it
   gh api graphql -f query='
     mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread{ isResolved } } }' \
     -f id="$THREAD_ID"
   ```

   Use the comment's reply endpoint (or `addPullRequestReviewThreadReply`) to
   post the reply before resolving.

5. **Commit and push any code changes.** If a thread led to a code change,
   stage, commit, and push to the PR branch automatically — no need to ask.
   Follow the `commits` skill (Conventional Commits, imperative mood). Group
   related fixes into sensible commits; one commit per thread is fine when
   they're unrelated. Re-run the five checks (`spell-check`, `format:check`,
   `lint`, `type-check`, `build`) before pushing if code changed.

Do not resolve a thread you disagree with silently — leave the reply explaining
why, then resolve it. Only leave a thread unresolved if it needs a decision from
the author that you genuinely cannot make.
