// MK9.6/9.7 — server-side log-storage defaults. Single named source shared by
// the dev-server raw-log sink (vite.config.ts) and the dump/wipe CLI
// (logs.cjs). Per the approved "server-only" interpretation, log retention and
// the storage threshold live entirely in this dev-tooling layer, measured
// against the real filesystem (fs.statfsSync) rather than a browser quota.
'use strict';

const os = require('node:os');

// Suppress raw-event writes and dump appends once measured disk usage exceeds
// this fraction. Gameplay-independent; affects logging only. Default 0.99 (the
// dev machine runs a nearly-full drive); the BREACH_LOG_THRESHOLD env var
// overrides it (0..1) for tuning/testing.
const DEFAULT_THRESHOLD = 0.99;
const envT = Number(process.env.BREACH_LOG_THRESHOLD);
const LOG_STORAGE_THRESHOLD = Number.isFinite(envT) && envT >= 0 && envT <= 1 ? envT : DEFAULT_THRESHOLD;

// The exact sentinel line that replaces affected raw-log / dump content while
// storage is over threshold. Per user override (2026-07-17) the wording tracks
// the 99% default threshold instead of the spec's literal "80%"; the
// requirements doc will be reconciled in the next update.
const STORAGE_SENTINEL = 'storage media more than 99% full';

// Best-available honest usage measurement for the filesystem holding `dir`.
// Returns a fraction in [0,1], or null when it cannot be measured (old Node,
// permission error, unusual FS) — callers treat null as "unknown, proceed".
function usageFraction(dir) {
  try {
    if (typeof fs_statfs() !== 'function') return null;
    const s = fs_statfs()(dir);
    if (!s || !s.blocks || s.bfree == null) return null;
    const total = Number(s.blocks);
    const free = Number(s.bfree);
    if (!(total > 0) || free < 0 || free > total) return null;
    return (total - free) / total;
  } catch {
    return null;
  }
}

// Lazily resolve fs.statfsSync so requiring this module never throws on Node
// builds that lack it.
let _statfs;
function fs_statfs() {
  if (_statfs === undefined) {
    try {
      _statfs = require('node:fs').statfsSync;
    } catch {
      _statfs = null;
    }
  }
  return _statfs;
}

// Convenience: is the FS holding `dir` over threshold? null usage → false
// (unknown never blocks logging).
function overThreshold(dir) {
  const f = usageFraction(dir);
  return f !== null && f > LOG_STORAGE_THRESHOLD;
}

module.exports = { LOG_STORAGE_THRESHOLD, STORAGE_SENTINEL, usageFraction, overThreshold, tmpdir: os.tmpdir };
