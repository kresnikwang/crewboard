#!/usr/bin/env node
'use strict';

// Synthetic local benchmark. Never opens the development/production DB or loads .env.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { fork } = require('child_process');
const { monitorEventLoopDelay } = require('perf_hooks');

if (process.argv.includes('--server')) {
  // Optional diagnostic comparison: emulate the former blocking verifier.
  if (process.argv.includes('--sync-login')) {
    crypto.scrypt = (password, salt, size, callback) => {
      try { callback(null, crypto.scryptSync(password, salt, size)); }
      catch (err) { callback(err); }
    };
  }
  const histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  const { server } = require('../server');
  server.on('listening', () => process.send({ port: server.address().port }));
  process.on('message', () => {
    process.send({
      rssMB: Math.round(process.memoryUsage().rss / 1048576),
      eventLoopP95Ms: Math.round(histogram.percentile(95) / 1e6),
      eventLoopMaxMs: Math.round(histogram.max / 1e6),
    });
    histogram.reset();
  });
  process.on('disconnect', () => process.exit(0));
} else {
  main().catch(err => { console.error(err.message); process.exitCode = 1; });
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crewboard-benchmark-'));
  const dbPath = path.join(tmp, 'synthetic.db');
  const agent = new http.Agent({ keepAlive: true, maxSockets: 60 });
  const streams = [];
  let child, db, port;
  const password = 'SyntheticTest123!';
  try {
    db = require('../db/schema').initDB(dbPath);
    const salt = 'synthetic-benchmark-salt';
    const hash = salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
    let records = 0;
    db.transaction(() => {
      db.prepare('INSERT INTO enterprises(id,name,code) VALUES(1,?,?)').run('Synthetic company', 'BENCHMARK');
      const resource = db.prepare('INSERT INTO resources(id,name,email,team,enterprise_id) VALUES(?,?,?,?,1)');
      const user = db.prepare('INSERT INTO users(id,name,email,password_hash,enterprise_id,resource_id,role) VALUES(?,?,?,?,1,?,?)');
      const session = db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)');
      for (let i = 1; i <= 30; i++) {
        resource.run(i, 'Resource ' + i, `perf${i}@example.test`, 'Team ' + i % 3);
        user.run(i, 'User ' + i, `perf${i}@example.test`, hash, i, 'admin');
        session.run('synthetic-token-' + i, i, '2099-01-01T00:00:00.000Z');
      }
      const project = db.prepare('INSERT INTO projects(id,name,enterprise_id,created_by,budget_hours) VALUES(?,?,1,1,1000)');
      for (let i = 1; i <= 20; i++) project.run(i, 'Project ' + i);
      const booking = db.prepare('INSERT INTO bookings(resource_id,project_id,date,hours,created_by) VALUES(?,?,?,8,1)');
      const timesheet = db.prepare('INSERT INTO timesheets(resource_id,project_id,date,hours) VALUES(?,?,?,8)');
      for (let d = new Date('2024-01-01T00:00:00Z'); d < new Date('2027-01-01T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1)) {
        if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
        const date = d.toISOString().slice(0, 10);
        for (let i = 1; i <= 30; i++) {
          booking.run(i, 1 + i % 20, date);
          timesheet.run(i, 1 + i % 20, date);
          records++;
        }
      }
    })();
    db.close();
    db = null;
    const sync = process.argv.includes('--sync-login');
    child = fork(__filename, ['--server', ...(sync ? ['--sync-login'] : [])], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, ENV_FILE: '/dev/null', DB_PATH: dbPath, PORT: '0', NODE_ENV: 'test', SEED_DEMO: '0' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    port = (await receive()).port;
    const results = { environment: {
      node: process.version, cpu: os.cpus()[0].model, users: 30, resources: 30,
      projects: 20, bookings: records, timesheets: records, sseConnections: 30,
      transport: 'loopback HTTP; no proxy, compression or browser rendering',
      loginVerifier: sync ? 'synchronous comparison' : 'asynchronous',
    } };
    function receive() {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => done(new Error('server response timeout')), 15000);
        function done(err, value) {
          clearTimeout(timeout);
          child.off('message', onMessage); child.off('exit', onExit); child.off('error', onError);
          if (err) reject(err); else resolve(value);
        }
        const onMessage = message => done(null, message);
        const onExit = () => done(new Error('benchmark server exited'));
        const onError = err => done(err);
        child.once('message', onMessage); child.once('exit', onExit); child.once('error', onError);
      });
    }
    async function metrics() { const pending = receive(); child.send('metrics'); return pending; }
    function request(url, i = 0, body) {
      return new Promise((resolve, reject) => {
        const start = performance.now();
        const req = http.request({ host: '127.0.0.1', port, path: url, agent,
          method: body ? 'POST' : 'GET', headers: {
            Authorization: 'Bearer synthetic-token-' + (1 + i % 30),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
        }, res => {
          let bytes = 0;
          res.on('data', chunk => { bytes += chunk.length; });
          res.on('error', reject);
          res.on('end', () => resolve({ ms: performance.now() - start, status: res.statusCode, bytes }));
        });
        req.setTimeout(15000, () => req.destroy(new Error('HTTP timeout')));
        req.on('error', reject);
        req.end(body ? JSON.stringify(body) : undefined);
      });
    }
    function stats(rows) {
      const latencies = rows.map(row => row.ms).sort((a, b) => a - b);
      const at = percentile => Math.round(latencies[Math.ceil(percentile * rows.length) - 1]);
      return { requests: rows.length, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: Math.round(latencies.at(-1)),
        errors: rows.filter(row => row.status !== 200).length,
        meanBytes: Math.round(rows.reduce((sum, row) => sum + row.bytes, 0) / rows.length) };
    }
    async function run(name, rounds, fn) {
      await metrics();
      const rows = [], start = performance.now();
      for (let k = 0; k < rounds; k++) rows.push(...await Promise.all(Array.from({ length: 30 }, (_, i) => fn(i, k))));
      results[name] = { ...stats(rows), elapsedMs: Math.round(performance.now() - start), server: await metrics() };
    }
    await Promise.all(Array.from({ length: 30 }, (_, i) => new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/sse?token=synthetic-token-' + (i + 1), agent: false }, res => {
        if (res.statusCode !== 200) return reject(new Error('SSE connection failed'));
        res.once('data', () => { req.setTimeout(0); resolve(); });
        res.on('data', () => {}); res.on('error', reject);
      });
      streams.push(req);
      req.setTimeout(15000, () => req.destroy(new Error('SSE timeout')));
      req.on('error', reject);
    })));
    const week = '/api/schedule-data?start=2026-10-05&end=2026-10-11';
    const month = '/api/schedule-data?start=2026-09-28&end=2026-11-08';
    const report = '/api/reports/utilization?start=2026-01-01&end=2026-12-31';
    const projects = '/api/reports/projects?start=2026-01-01&end=2026-12-31';
    for (const url of [week, month, report, projects]) await request(url);
    await run('scheduleWeek30', 10, i => request(week, i));
    await run('scheduleMonth30', 10, i => request(month, i));
    await run('scheduleMonthSingleRow30', 10, i => request(month + '&resource_ids=' + (i + 1), i));
    await run('annualUtilization30', 5, i => request(report, i));
    await run('annualProjects30', 5, i => request(projects, i));
    const entries = i => Array.from({ length: 5 }, (_, d) => ({ resource_id: i + 1, project_id: 1 + (i + 1) % 20,
      date: '2026-10-' + String(5 + d).padStart(2, '0'), hours: 8 }));
    await run('writeWeek30', 1, i => request('/api/timesheets/batch', i, { entries: entries(i) }));
    await run('mixed30', 5, i => i % 3 === 0 ? request(month, i) : i % 3 === 1 ? request(report, i)
      : request('/api/timesheets/batch', i, { entries: entries(i) }));
    await metrics();
    const loginRows = [], healthRows = [];
    let loggingIn = true;
    // Start login burst before probing health so both workloads overlap.
    const logins = Promise.all(Array.from({ length: 30 }, (_, i) =>
      request('/api/auth/login', i, { account: `perf${i + 1}@example.test`, password })));
    const probe = (async () => {
      await new Promise(resolve => setTimeout(resolve, 5));
      while (loggingIn) {
        healthRows.push(await request('/api/health'));
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    })();
    const started = performance.now();
    try { loginRows.push(...await logins); } finally { loggingIn = false; }
    await probe;
    results.login30 = { ...stats(loginRows), elapsedMs: Math.round(performance.now() - started), server: await metrics() };
    results.healthDuringLogin = stats(healthRows);
    console.log(JSON.stringify(results, null, 2));
    if (Object.values(results).some(value => value.errors > 0)) throw new Error('benchmark had failed HTTP requests');
  } finally {
    streams.forEach(req => req.destroy()); agent.destroy();
    if (db) db.close();
    if (child && child.exitCode === null && child.signalCode === null) {
      const stopped = new Promise(resolve => child.once('exit', resolve));
      child.kill(); await stopped;
    }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
