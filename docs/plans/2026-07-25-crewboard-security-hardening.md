# CrewBoard Security Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Harden the production server against the observed SSH password spray while preserving the CrewBoard service and its authorized deployment access.

**Architecture:** Take a timestamped, recoverable snapshot of SSH and PM2 state, verify that an authorized public key can open a second SSH session, then apply a small SSH drop-in that disables password authentication and limits brute-force cost. Clean the PM2 in-memory process definition so CrewBoard is not forced into a restart loop, keep the watchdog as a one-shot health check, and verify both local and HTTPS health before closing the maintenance session.

**Tech Stack:** OpenSSH/sshd, PM2, Node.js/Express, SQLite/WAL, Nginx, shell diagnostics.

---

### Task 1: Capture production state and confirm the operator key

**Files / systems:**
- Inspect: `/etc/ssh/sshd_config`, `/etc/ssh/sshd_config.d/`, `/root/.ssh/authorized_keys`
- Inspect: PM2 process metadata and `/www/wwwroot/resource.skandstudio.com/ecosystem.config.js`
- Create backup: `/root/crewboard-hardening-backup-<timestamp>/`

**Steps:**
1. Record current SSH configuration, authorized-key fingerprints, PM2 JSON, process list, listeners, and active SSH sessions in a root-only backup directory.
2. Match the local operator public-key fingerprints to the server authorized keys without printing private key material.
3. Open a separate SSH connection with `PasswordAuthentication=no` and `IdentitiesOnly=yes`; continue only if key authentication succeeds.

### Task 2: Apply SSH hardening with a validated rollback

**Files:**
- Create: `/etc/ssh/sshd_config.d/99-crewboard-hardening.conf`

**Steps:**
1. Add a drop-in setting `PermitRootLogin prohibit-password`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `MaxAuthTries 3`, `LoginGraceTime 30`, and bounded connection-start limits.
2. Run `sshd -t` and verify the effective configuration with `sshd -T` before reloading.
3. Reload sshd without interrupting existing sessions, then prove a new key-only session works and a password-only probe is rejected.

### Task 3: Remove PM2 restart drift and keep health checks safe

**Files:**
- Modify locally if needed: `ecosystem.config.js`, `scripts/auth-watchdog.js`
- Production state: PM2 process definition for `crewboard`

**Steps:**
1. Confirm the source ecosystem config has no `cron_restart` on the long-running `crewboard` app and that the watchdog is a separate one-shot cron process.
2. Remove stale in-memory `cron_restart` state by replacing only the `crewboard` PM2 process from the checked-in ecosystem config; save the clean process list.
3. Ensure watchdog failures distinguish connection failure from HTTP authentication failure and verify that the default demo credential is not silently used for production monitoring.
4. Run the watchdog once, then observe at least one scheduled health tick without a process restart.

### Task 4: Verify application and host security signals

**Checks:**
- `GET /api/health` locally and through HTTPS
- PM2 status/restart count and effective cron fields
- SSH journal for accepted/failed sessions
- Nginx auth access log and recent file changes
- SQLite integrity and session counts, without exposing tokens or password hashes

**Steps:**
1. Confirm CrewBoard remains online and the watchdog is healthy.
2. Confirm no unexpected code, SSH key, cron, or systemd-timer changes appeared during the maintenance window.
3. Report any still-active unrecognized root session separately; do not terminate an ambiguous authorized session without confirmation.

### Task 5: Document operational follow-up

**Files:**
- Modify: `AGENTS.md` or deployment documentation only if the production SSH policy or watchdog configuration is changed in source.

**Steps:**
1. Record the SSH key-only policy, the required deployment key, and the PM2 clean-start rule.
2. Replace live E2E use of production email/admin credentials with a dedicated test account or non-production SMTP path.
3. Run the focused test suite for any local code change and leave unrelated worktree changes untouched.
