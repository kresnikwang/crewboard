# Concurrent Performance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Support 30 simultaneous CrewBoard users with responsive login and smaller schedule refreshes while preserving tenant and account protections.

**Architecture:** Keep Express and the single SQLite WAL writer. Move login verification to Node's async scrypt worker pool, recheck account state after awaiting, and use layered IP/account login limits. Carry affected resource IDs through SSE, query only their schedule rows, and merge them into the current view with serialized refreshes and stale-view guards.

**Tech Stack:** Node.js, Express 4, better-sqlite3, vanilla JavaScript, Nginx, Playwright.

---

### Task 1: Login concurrency and limits

**Files:** Modify `server.js`, `routes/auth.js`, `tests/test_security.js`, `docs/operations/security.md`.

1. Add security checks for >30 logins sharing an IP, normalized per-account throttling, and 300/IP ceiling; use synthetic unknown accounts for cheap limit checks.
2. Add `promisify(crypto.scrypt)` for login only; preserve stored password format, other password flows, and timing-safe comparison. Wrap the async Express 4 handler with rejection forwarding.
3. After verification, reload the user and reject a changed password, disabled/deleted user, or changed login identity before creating a session.
4. Handle `/api` routes before static files so filesystem checks do not compete with scrypt for the worker pool. Apply 300 requests per IP and 30 per normalized account per 15 minutes. Known email/phone aliases use the same user ID limit key; unknown accounts use normalized text.
5. Run `npm run test:security` and `npm run test:email`; add deterministic coverage for state changes during verification.

### Task 2: Incremental schedule reads and SSE

**Files:** Modify `routes/api/schedule-data.js`, `routes/api/bookings.js`, `routes/api/leave.js`, `public/js/core.js`, `public/js/schedule/01-setup.js`, `public/js/schedule/02-load-render.js`, `tests/test_security.js`, `e2e/schedule.spec.js`.

1. Test `resource_ids` filtering, invalid input, and cross-enterprise IDs.
2. Add an optional validated resource ID list (at most 500) to all three schedule queries, preserving enterprise filters and existing response shape. Validate ordered YYYY-MM-DD dates and cap schedule reads at 366 days.
3. Add affected resource IDs to every booking/leave SSE event, including both rows for moves.
4. Merge partial results by resource into bookings, leave, and resources; preserve untouched rows and update the complete cached snapshot. Reject responses for a different view, tenant, or newer full render.
5. Serialize and debounce queued local/SSE updates; retain updates arriving during an in-flight refresh, and use full reload when the snapshot/rows are unavailable.
6. Add browser tests for actual SSE updates, deletion/moves, unaffected DOM preservation, coalescing, and navigation during pending reads.
7. Run `npm run bundle:schedule`, `npm run build`, and `npm run test:e2e`.

### Task 3: Transfer and operational documentation

**Files:** Modify `nginx.conf`, `docs/operations/deployment.md`.

1. Retain the existing gzip and safe revalidation cache strategy; enable compression variance and tune compression level. Do not introduce long-lived caching on mutable asset filenames.
2. Give SSE a dedicated unbuffered/uncompressed proxy location with a long read timeout.
3. Document that panel-managed Nginx changes require applying and testing the site configuration separately from `deploy.sh`.
4. Validate with available Nginx syntax tooling, `bash -n deploy.sh`, and `git diff --check`.

### Task 4: Validate and compare

**Files:** Create `scripts/benchmark-concurrency.js`, modify `package.json`, `docs/development/testing.md`.

1. Add a reproducible synthetic benchmark using a temporary database, separate server/client processes, 30 real sessions, 30 SSE streams, and three years of records. Disable real environment config and remove temporary files/processes on exit.
2. Measure full/partial schedule reads, report reads, mixed reads/writes, concurrent login, and health responsiveness during login. Report p50/p95/errors, response bytes, event-loop lag, and server memory; never print tokens.
3. Run `npm test`, `npm run test:e2e`, `npm run benchmark:concurrency`, and `git diff --check`.
4. Inspect final diff/status; report local performance and deployment limitations. No production deployment is part of this change.

## Implementation and local verification

Implemented login verification and layered limits, API-before-static routing, tenant-scoped partial schedule reads, affected-row SSE payloads, serialized row merges, obsolete-response protection, Nginx reference tuning, and the synthetic benchmark.

Local benchmark (Node v22.17.0, Apple M5 Max, 30 sessions/SSE streams, 23,520 rows each in bookings/timesheets):

| Metric | Synchronous-login comparison | Final implementation |
| --- | ---: | ---: |
| Concurrent login p95 | 587 ms | 160 ms |
| Health maximum during login | 603 ms | 1 ms |
| Login event-loop maximum | 567 ms | 12 ms |

The login comparison emulates the former synchronous verifier in the new code, rather than checking out an old release. API routing was subsequently moved ahead of static file handling; avoiding filesystem operations on API paths prevents health requests from competing with scrypt for worker-pool time.

The final month-view full response averaged 372,688 bytes, while a single-resource refresh averaged 12,882 bytes (96.5% smaller); under 30 concurrent requests their p95 times were 117 ms and 7 ms. Benchmark HTTP errors: zero. Measurements exclude network/proxy/browser costs and are not production capacity guarantees.

Security (91), regression (37), and email (50) checks passed after the server-routing change. All 22 browser tests passed on the final frontend build. Browser verification covers week/month views, real cross-user booking/leave SSE, two-row moves, deletions, event coalescing, updates during pending requests, stale-week responses, and cache replacement races. Nginx is not installed on this workstation, so the panel-managed site config still requires `nginx -t` before reload on its deployment host. Production has not been deployed by this task.
