# CrewBoard Developer Navigation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the repository easier for Codex and developers to navigate by documenting the actual runtime structure, separating development and operations guidance, and clearly identifying source files versus generated artifacts.

**Architecture:** Keep the existing runtime paths stable. Add a small documentation tree under `docs/` and make `AGENTS.md` the concise repository-level index. Update the existing README and Claude compatibility file to point at the canonical documentation instead of duplicating stale directory and deployment details.

**Tech Stack:** Markdown, Node.js scripts, Express route modules, native JavaScript frontend, Playwright, PM2, SQLite.

---

## Task 1: Create the canonical documentation map

**Files:**
- Create `docs/README.md`
- Create `docs/architecture/code-map.md`
- Create `docs/development/workflow.md`
- Create `docs/development/testing.md`
- Create `docs/operations/deployment.md`
- Create `docs/operations/security.md`

**Steps:**
1. Describe the shortest path for common changes: server boot, auth, business API, frontend page, styles, database, scheduled jobs, tests, and deployment.
2. Document the actual route and frontend module boundaries from the current tree.
3. Mark generated files (`public/js/dist/*`, `public/css/dist/*`, and `public/js/schedule.js`) as build outputs and name their source files.
4. Record local commands, test tiers, isolated E2E database behavior, and production deployment prerequisites without copying secrets.
5. Add links between the docs so a developer can start at `docs/README.md` and reach the relevant workflow in one or two clicks.

## Task 2: Make root-level agent guidance accurate and short

**Files:**
- Modify `AGENTS.md`
- Modify `CLAUDE.md`

**Steps:**
1. Replace the stale full inventory with a concise map, invariants, and links to the canonical docs.
2. Remove the plaintext production password and state that credentials must come from the local SSH agent or environment.
3. Call out the source/generated-file rule, SQLite single-writer rule, PM2 fork requirement, and deployment path as operational facts.
4. Keep `CLAUDE.md` as a compatibility pointer to `AGENTS.md` so the two files cannot drift again.

## Task 3: Add developer navigation to the user-facing README

**Files:**
- Modify `README.md`

**Steps:**
1. Add a developer quick map near the top with links to the code map, workflow, testing, deployment, and security docs.
2. Correct the top-level directory description so it points readers to the actual `routes/api/` and `public/js/schedule/` structures.
3. Keep the existing product and user-facing material intact unless it directly conflicts with the current code.

## Task 4: Verify documentation and deployment safety

**Files:**
- Modify `deploy.sh` only if the existing deployment behavior needs a small, evidence-based documentation or persistence fix.

**Steps:**
1. Check all new relative links and referenced paths against the repository.
2. Run `bash -n deploy.sh`, the existing API/security test suite, and the frontend build where practical.
3. Confirm the worktree contains no database, report, or other generated artifacts that should be committed.
4. Summarize any remaining operational risks, especially the lack of E2E coverage for this change.
