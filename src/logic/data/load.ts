// Alpha 0.1.0 §6/§7/§10 — shared pure-TypeScript CSV parse → validate →
// resolve pipeline. Browser and Node use different file-ACQUISITION adapters
// but converge on this module with the same raw text (§5.3). Validation runs
// in ordered phases, collects every safely discoverable error and warning,
// and constructs the resolved immutable runtime model ONLY when no errors
// exist (§10.1). There is no partial-row fallback and no hardcoded-content
// fallback (§10.2).

import { parseCsv } from './csv';
import { AREA_PATTERNS, isAreaPatternId } from './areas';
import { EFFECT_PARAM_NAMES, EffectParamName, effectContract, isEffectId } from './effects';
import {
  DATA_SCHEMA_VERSION,
  EffectParams,
  GAME_VERSION,
  PlanOp,
  ResolvedContent,
  ResolvedFunction,
  ResolvedProgram,
} from './content';
import { Color, Shape, Side } from '../types';

// ---- diagnostics (§10.3) ----

export interface DataIssue {
  severity: 'error' | 'warning';
  dataset: 'hacker-programs' | 'system-programs' | 'functions' | 'content';
  file: string;
  row?: number; // 1-based source row
  id?: string; // record ID when known
  field?: string;
  value?: string;
  expected?: string;
  reason: string;
}

export function formatIssue(i: DataIssue): string {
  const parts = [
    `[${i.severity.toUpperCase()}]`,
    `${i.dataset}`,
    i.file + (i.row !== undefined ? `:${i.row}` : ''),
    i.id ? `id=${i.id}` : '',
    i.field ? `field=${i.field}` : '',
    i.value !== undefined ? `value=${JSON.stringify(i.value)}` : '',
    i.expected ? `expected=${i.expected}` : '',
    `— ${i.reason}`,
  ];
  return parts.filter(Boolean).join(' ');
}

export interface DataFile {
  name: string; // source filename / resource identity
  text: string;
}

// The loader MANIFEST: each dataset's role is identified here explicitly and
// independently cross-checked by ID prefixes (§6 — never filename-only).
export interface DataFiles {
  hacker: DataFile;
  system: DataFile;
  functions: DataFile;
}

export interface LoadResult {
  content: ResolvedContent | null; // null iff any error exists
  issues: DataIssue[];
  errors: number;
  warnings: number;
}

// ---- vocabularies ----

// Engine enum vocabularies as CSV tokens (3-letter uppercase codes; the four
// codes unused by the current datasets — MAG/CYA/DIA/CRO — follow the same
// scheme and are documented in the post-build report).
const COLOR_TOKENS: Record<string, Color> = {
  RED: Color.Red,
  YEL: Color.Yellow,
  MAG: Color.Magenta,
  GRE: Color.Green,
  CYA: Color.Cyan,
  BLU: Color.Blue,
};
const SHAPE_TOKENS: Record<string, Shape> = {
  CIR: Shape.Circle,
  SQU: Shape.Square,
  TRI: Shape.Triangle,
  DIA: Shape.Diamond,
  STR: Shape.Star,
  CRO: Shape.Cross,
};

const PROGRAM_HEADER = ['PRG_ID', 'name', 'colors', 'shapes', 'functions', 'notes'];
const FUNCTION_HEADER = ['FNC_ID', 'name', 'cost', 'payload', 'notes', 'quantity', 'countdown', 'areaPattern', 'magnitude', 'damage'];

// §6.3/§6.4 phase-10 check: required Alpha record IDs must be present (their
// values are validated by the schema/contract rules; per designer ruling the
// dataset is the final authority on the values themselves).
const REQUIRED_FNC_IDS = ['FNC_001', 'FNC_002', 'FNC_003', 'FNC_004', 'FNC_005', 'FNC_006', 'FNC_007', 'FNC_008', 'FNC_009'];
const REQUIRED_PRG_H_IDS = ['PRG_H_001', 'PRG_H_002', 'PRG_H_003', 'PRG_H_004'];
const REQUIRED_PRG_S_IDS = ['PRG_S_001', 'PRG_S_002', 'PRG_S_003', 'PRG_S_004'];

// ---- numeric parsing (§6.2 rules) ----

// blank/whitespace-only = absent; only plain non-negative integer digits are
// valid syntax (no sign, decimal, exponent, hex); must be a safe integer.
function parseIntField(raw: string): { present: boolean; value?: number; invalid?: boolean } {
  const t = raw.trim();
  if (t === '') return { present: false };
  if (!/^[0-9]+$/.test(t)) return { present: true, invalid: true };
  const v = Number(t);
  if (!Number.isSafeInteger(v)) return { present: true, invalid: true };
  return { present: true, value: v };
}

// ---- row models ----

interface ProgramRow {
  file: string;
  dataset: 'hacker-programs' | 'system-programs';
  row: number;
  id: string;
  name: string;
  colors: Color[];
  shapes: Shape[];
  functionId: string;
  notes: string;
}

interface FunctionRow {
  file: string;
  row: number;
  id: string;
  name: string;
  cost: number;
  payloadRaw: string;
  notes: string;
  params: Record<EffectParamName, string>; // raw field text
}

// ---- the pipeline ----

export function loadContent(files: DataFiles): LoadResult {
  const issues: DataIssue[] = [];
  const err = (i: Omit<DataIssue, 'severity'>): void => void issues.push({ severity: 'error', ...i });
  const warn = (i: Omit<DataIssue, 'severity'>): void => void issues.push({ severity: 'warning', ...i });

  // Phase 2/3 — headers + rows, per dataset.
  const readTable = (
    file: DataFile,
    dataset: DataIssue['dataset'],
    expectedHeader: string[],
  ): { header: string[]; rows: { line: number; get: (col: string) => string }[] } | null => {
    const parsed = parseCsv(file.text);
    if (parsed.error) {
      err({ dataset, file: file.name, reason: `CSV structure invalid: ${parsed.error}` });
      return null;
    }
    if (!parsed.rows.length) {
      err({ dataset, file: file.name, reason: 'file is empty (no header row)' });
      return null;
    }
    const header = parsed.rows[0].fields.map((h) => h.trim());
    const expectedSet = new Set(expectedHeader);
    const seen = new Set<string>();
    let headerOk = true;
    for (const h of header) {
      if (!expectedSet.has(h)) {
        err({ dataset, file: file.name, row: parsed.rows[0].line, field: h, expected: expectedHeader.join(','), reason: 'unknown header column' });
        headerOk = false;
      } else if (seen.has(h)) {
        err({ dataset, file: file.name, row: parsed.rows[0].line, field: h, reason: 'duplicate header column' });
        headerOk = false;
      }
      seen.add(h);
    }
    for (const h of expectedHeader) {
      if (!seen.has(h)) {
        err({ dataset, file: file.name, row: parsed.rows[0].line, field: h, expected: expectedHeader.join(','), reason: 'missing required header column' });
        headerOk = false;
      }
    }
    if (!headerOk) return null;
    // bind by header name, not position (§6.2)
    const idx = new Map(header.map((h, i) => [h, i] as const));
    const rows = parsed.rows.slice(1).map((r) => ({
      line: r.line,
      get: (col: string): string => r.fields[idx.get(col)!] ?? '',
    }));
    for (const r of parsed.rows.slice(1)) {
      if (r.fields.length !== header.length) {
        err({ dataset, file: file.name, row: r.line, expected: `${header.length} fields`, value: `${r.fields.length} fields`, reason: 'row field count does not match header' });
      }
    }
    return { header, rows };
  };

  // §6.1 list parsing for colors/shapes.
  const parseTokenList = <T>(
    raw: string,
    vocab: Record<string, T>,
    ctx: { dataset: DataIssue['dataset']; file: string; row: number; id: string; field: string },
  ): T[] | null => {
    const tokens = raw.split(':').map((t) => t.trim());
    const out: T[] = [];
    const seen = new Set<string>();
    let ok = true;
    if (raw.trim() === '') {
      err({ ...ctx, value: raw, reason: 'at least one entry is required' });
      return null;
    }
    for (const t of tokens) {
      if (t === '') {
        err({ ...ctx, value: raw, reason: 'blank token in list' });
        ok = false;
        continue;
      }
      if (seen.has(t)) {
        err({ ...ctx, value: t, reason: 'duplicate token in list' });
        ok = false;
        continue;
      }
      seen.add(t);
      if (!(t in vocab)) {
        err({ ...ctx, value: t, expected: Object.keys(vocab).join('|'), reason: 'unknown enum value' });
        ok = false;
        continue;
      }
      out.push(vocab[t]);
    }
    return ok ? out : null;
  };

  const checkName = (
    raw: string,
    ctx: { dataset: DataIssue['dataset']; file: string; row: number; id: string },
  ): string | null => {
    const name = raw.trim();
    if (!name) {
      err({ ...ctx, field: 'name', value: raw, reason: 'name must be nonempty' });
      return null;
    }
    if (name !== name.toUpperCase()) {
      err({ ...ctx, field: 'name', value: name, reason: 'name must be uppercase' });
      return null;
    }
    return name;
  };

  // ---- Phase 3/4 — parse Program datasets ----

  const programRows: ProgramRow[] = [];
  const readPrograms = (file: DataFile, dataset: 'hacker-programs' | 'system-programs', prefix: string): void => {
    const table = readTable(file, dataset, PROGRAM_HEADER);
    if (!table) return;
    for (const r of table.rows) {
      const id = r.get('PRG_ID').trim();
      const ctx = { dataset, file: file.name, row: r.line, id };
      if (!id) {
        err({ ...ctx, field: 'PRG_ID', reason: 'PRG_ID is required' });
        continue;
      }
      if (!id.startsWith(prefix)) {
        // §6 — prefixes independently cross-check the manifest's dataset role
        err({ ...ctx, field: 'PRG_ID', value: id, expected: `${prefix}*`, reason: 'wrong Program ID prefix for this dataset' });
        continue;
      }
      const name = checkName(r.get('name'), ctx);
      const colors = parseTokenList(r.get('colors'), COLOR_TOKENS, { ...ctx, field: 'colors' });
      const shapes = parseTokenList(r.get('shapes'), SHAPE_TOKENS, { ...ctx, field: 'shapes' });
      const fnRaw = r.get('functions').trim();
      // Alpha 0.1.0: exactly one FNC reference per Program (§6.1)
      let functionId: string | null = null;
      if (!fnRaw) {
        err({ ...ctx, field: 'functions', reason: 'exactly one FNC_* reference is required' });
      } else if (fnRaw.includes(':')) {
        err({ ...ctx, field: 'functions', value: fnRaw, reason: 'Alpha 0.1.0 permits exactly one Function per Program' });
      } else if (!fnRaw.startsWith('FNC_')) {
        err({ ...ctx, field: 'functions', value: fnRaw, expected: 'FNC_*', reason: 'not a Function ID' });
      } else {
        functionId = fnRaw;
      }
      if (name === null || colors === null || shapes === null || functionId === null) continue;
      programRows.push({ file: file.name, dataset, row: r.line, id, name, colors, shapes, functionId, notes: r.get('notes').trim() });
    }
  };
  readPrograms(files.hacker, 'hacker-programs', 'PRG_H_');
  readPrograms(files.system, 'system-programs', 'PRG_S_');

  // ---- Phase 3/4 — parse Function dataset ----

  const functionRows: FunctionRow[] = [];
  {
    const table = readTable(files.functions, 'functions', FUNCTION_HEADER);
    if (table) {
      for (const r of table.rows) {
        const id = r.get('FNC_ID').trim();
        const ctx = { dataset: 'functions' as const, file: files.functions.name, row: r.line, id };
        if (!id) {
          err({ ...ctx, field: 'FNC_ID', reason: 'FNC_ID is required' });
          continue;
        }
        if (!id.startsWith('FNC_')) {
          err({ ...ctx, field: 'FNC_ID', value: id, expected: 'FNC_*', reason: 'wrong Function ID prefix' });
          continue;
        }
        const name = checkName(r.get('name'), ctx);
        const costP = parseIntField(r.get('cost'));
        let cost: number | null = null;
        if (!costP.present || costP.invalid || costP.value === undefined) {
          err({ ...ctx, field: 'cost', value: r.get('cost'), expected: 'integer 1-9999', reason: 'cost must be a positive integer' });
        } else if (costP.value < 1 || costP.value > 9999) {
          err({ ...ctx, field: 'cost', value: r.get('cost'), expected: '1-9999', reason: 'cost out of range' });
        } else {
          cost = costP.value;
        }
        const payloadRaw = r.get('payload').trim();
        if (!payloadRaw) err({ ...ctx, field: 'payload', reason: 'payload is required' });
        if (name === null || cost === null || !payloadRaw) continue;
        const params = {} as Record<EffectParamName, string>;
        for (const p of EFFECT_PARAM_NAMES) params[p] = r.get(p);
        functionRows.push({ file: files.functions.name, row: r.line, id, name, cost, payloadRaw, notes: r.get('notes').trim(), params });
      }
    }
  }

  // ---- Phase 5 — global ID uniqueness + duplicate-name warnings ----

  const idHome = new Map<string, { dataset: DataIssue['dataset']; file: string; row: number }>();
  const claimId = (id: string, ctx: { dataset: DataIssue['dataset']; file: string; row: number }): boolean => {
    const prev = idHome.get(id);
    if (prev) {
      err({ ...ctx, id, field: 'ID', value: id, reason: `duplicate ID (already defined in ${prev.dataset} ${prev.file}:${prev.row})` });
      return false;
    }
    idHome.set(id, ctx);
    return true;
  };
  const uniquePrograms = programRows.filter((p) => claimId(p.id, { dataset: p.dataset, file: p.file, row: p.row }));
  const uniqueFunctions = functionRows.filter((f) => claimId(f.id, { dataset: 'functions', file: f.file, row: f.row }));

  {
    const names = new Map<string, { dataset: DataIssue['dataset']; file: string; row: number; id: string }>();
    for (const rec of [
      ...uniquePrograms.map((p) => ({ name: p.name, dataset: p.dataset, file: p.file, row: p.row, id: p.id })),
      ...uniqueFunctions.map((f) => ({ name: f.name, dataset: 'functions' as const, file: f.file, row: f.row, id: f.id })),
    ]) {
      const prev = names.get(rec.name);
      if (prev) {
        warn({ dataset: rec.dataset, file: rec.file, row: rec.row, id: rec.id, field: 'name', value: rec.name, reason: `duplicate display name (also used by ${prev.id})` });
      } else {
        names.set(rec.name, rec);
      }
    }
  }

  const fnById = new Map(uniqueFunctions.map((f) => [f.id, f] as const));

  // ---- Phase 7/8 — payload grammar, references, nesting/cycles ----

  interface ParsedPayload {
    kind: 'leaf' | 'composite';
    effectId?: string; // leaf
    children?: string[]; // composite (repeats allowed, §7.2 rule 9)
  }
  const payloads = new Map<string, ParsedPayload>();
  for (const f of uniqueFunctions) {
    const ctx = { dataset: 'functions' as const, file: f.file, row: f.row, id: f.id, field: 'payload' };
    const tokens = f.payloadRaw.split(':').map((t) => t.trim());
    if (tokens.some((t) => t === '')) {
      err({ ...ctx, value: f.payloadRaw, reason: 'blank token in payload' });
      continue;
    }
    const effectTokens = tokens.filter((t) => t.startsWith('EFFECT_'));
    const fnTokens = tokens.filter((t) => t.startsWith('FNC_'));
    if (effectTokens.length + fnTokens.length !== tokens.length) {
      const badToken = tokens.find((t) => !t.startsWith('EFFECT_') && !t.startsWith('FNC_'));
      err({ ...ctx, value: badToken, expected: 'EFFECT_* or FNC_*', reason: 'payload entry is neither an Effect ID nor a Function ID' });
      continue;
    }
    if (effectTokens.length > 0 && fnTokens.length > 0) {
      err({ ...ctx, value: f.payloadRaw, reason: 'payload may not mix EFFECT_* and FNC_* entries' });
      continue;
    }
    if (effectTokens.length > 1) {
      err({ ...ctx, value: f.payloadRaw, reason: 'a leaf payload must be exactly one EFFECT_* ID' });
      continue;
    }
    if (effectTokens.length === 1) {
      if (!isEffectId(effectTokens[0])) {
        err({ ...ctx, value: effectTokens[0], reason: 'unknown Effect ID' });
        continue;
      }
      payloads.set(f.id, { kind: 'leaf', effectId: effectTokens[0] });
    } else {
      if (fnTokens.includes(f.id)) {
        err({ ...ctx, value: f.id, reason: 'self-reference in payload is invalid' });
        continue;
      }
      payloads.set(f.id, { kind: 'composite', children: fnTokens });
    }
  }

  // composite children must exist and be LEAF Functions (§7.2 rules 4/5/8 —
  // one-level nesting only, which also excludes all direct/indirect cycles)
  for (const f of uniqueFunctions) {
    const p = payloads.get(f.id);
    if (!p || p.kind !== 'composite') continue;
    const ctx = { dataset: 'functions' as const, file: f.file, row: f.row, id: f.id, field: 'payload' };
    let ok = true;
    for (const child of p.children!) {
      const childPayload = payloads.get(child);
      if (!fnById.has(child)) {
        err({ ...ctx, value: child, reason: 'payload references an unknown Function ID' });
        ok = false;
      } else if (!childPayload) {
        // child failed its own payload validation; error already reported there
        ok = false;
      } else if (childPayload.kind === 'composite') {
        err({ ...ctx, value: child, reason: 'a composite Function may not reference another composite Function (one-level nesting only)' });
        ok = false;
      }
    }
    if (!ok) payloads.delete(f.id);
  }

  // ---- Phase 4 (cont.) — Effect parameter contracts (§9) ----

  const fnParams = new Map<string, EffectParams>(); // leaf functions only
  for (const f of uniqueFunctions) {
    const p = payloads.get(f.id);
    if (!p || p.kind !== 'leaf') {
      // composite rows: every effect-parameter column is unused (warn if populated)
      if (p?.kind === 'composite') {
        for (const col of EFFECT_PARAM_NAMES) {
          if (f.params[col].trim() !== '') {
            warn({ dataset: 'functions', file: f.file, row: f.row, id: f.id, field: col, value: f.params[col], reason: 'populated parameter is unused by a composite Function' });
          }
        }
      }
      continue;
    }
    const contract = effectContract(p.effectId!)!;
    const ctx = { dataset: 'functions' as const, file: f.file, row: f.row, id: f.id };
    const out: EffectParams = {};
    let ok = true;
    const required = new Set<EffectParamName>(contract.required);
    for (const col of EFFECT_PARAM_NAMES) {
      const raw = f.params[col];
      const isRequired = required.has(col);
      if (col === 'areaPattern') {
        const t = raw.trim();
        if (isRequired) {
          if (!t) {
            err({ ...ctx, field: col, expected: Object.keys(AREA_PATTERNS).join('|'), reason: `missing required parameter for ${p.effectId}` });
            ok = false;
          } else if (!isAreaPatternId(t)) {
            err({ ...ctx, field: col, value: t, expected: Object.keys(AREA_PATTERNS).join('|'), reason: 'unknown area pattern' });
            ok = false;
          } else {
            out.areaPattern = t;
          }
        } else if (t) {
          warn({ ...ctx, field: col, value: t, reason: `populated parameter is unused by ${p.effectId}` });
        }
        continue;
      }
      const parsed = parseIntField(raw);
      if (isRequired) {
        if (!parsed.present || parsed.invalid || parsed.value === undefined) {
          err({ ...ctx, field: col, value: raw.trim() || undefined, expected: 'positive integer', reason: `missing or invalid required parameter for ${p.effectId}` });
          ok = false;
          continue;
        }
        const v = parsed.value;
        const range: [number, number] =
          col === 'quantity' ? [1, 64] : col === 'countdown' ? [1, 9999] : [1, 999999];
        if (v < range[0] || v > range[1]) {
          err({ ...ctx, field: col, value: raw.trim(), expected: `${range[0]}-${range[1]}`, reason: 'parameter out of range' });
          ok = false;
          continue;
        }
        out[col] = v;
      } else if (parsed.present) {
        // populated-but-unused is a warning, including numeric 0 (§9)
        warn({ ...ctx, field: col, value: raw.trim(), reason: `populated parameter is unused by ${p.effectId}` });
      }
    }
    if (ok) fnParams.set(f.id, out);
  }

  // ---- Phase 6 — Program → Function references ----

  for (const p of uniquePrograms) {
    if (!fnById.has(p.functionId)) {
      err({ dataset: p.dataset, file: p.file, row: p.row, id: p.id, field: 'functions', value: p.functionId, reason: 'reference to unknown Function ID' });
    }
  }

  // ---- Phase 9 — expand composites, targeting constraints (§7.3) ----

  const buildPlan = (fnId: string): PlanOp[] | null => {
    const payload = payloads.get(fnId);
    if (!payload) return null;
    if (payload.kind === 'leaf') {
      const params = fnParams.get(fnId);
      if (!params) return null;
      return [{ fnId, effectId: payload.effectId! as PlanOp['effectId'], params }];
    }
    const plan: PlanOp[] = [];
    for (const child of payload.children!) {
      const childPlan = buildPlan(child); // children are validated leaves (depth 1)
      if (!childPlan) return null;
      plan.push(...childPlan);
    }
    return plan;
  };

  const plans = new Map<string, PlanOp[]>();
  for (const f of uniqueFunctions) {
    const plan = buildPlan(f.id);
    if (!plan) continue; // upstream errors already reported
    const ctx = { dataset: 'functions' as const, file: f.file, row: f.row, id: f.id, field: 'payload' };
    const targetedIdxs = plan
      .map((op, i) => ({ op, i }))
      .filter(({ op }) => effectContract(op.effectId)!.targeted);
    const drainCount = plan.filter((op) => op.effectId === 'EFFECT_DRAIN').length;
    let ok = true;
    if (drainCount > 1) {
      err({ ...ctx, reason: 'two Drain operations in one expanded payload are invalid' });
      ok = false;
    }
    if (targetedIdxs.length > 1) {
      err({ ...ctx, reason: 'more than one non-random targeted operation in one expanded payload' });
      ok = false;
    } else if (targetedIdxs.length === 1 && targetedIdxs[0].i !== 0) {
      err({ ...ctx, reason: 'a non-random targeted operation must be the first expanded operation' });
      ok = false;
    }
    if (ok) plans.set(f.id, plan);
  }

  // ---- Phase 10 — required Alpha records present ----

  const requireIds = (ids: string[], have: (id: string) => boolean, dataset: DataIssue['dataset'], file: string): void => {
    for (const id of ids) {
      if (!have(id)) err({ dataset, file, id, reason: 'required Alpha 0.1.0 record is missing' });
    }
  };
  requireIds(REQUIRED_FNC_IDS, (id) => fnById.has(id), 'functions', files.functions.name);
  const prgIds = new Set(uniquePrograms.map((p) => p.id));
  requireIds(REQUIRED_PRG_H_IDS, (id) => prgIds.has(id), 'hacker-programs', files.hacker.name);
  requireIds(REQUIRED_PRG_S_IDS, (id) => prgIds.has(id), 'system-programs', files.system.name);

  // ---- Phase 11 — construct the resolved model (errors block it) ----

  const errors = issues.filter((i) => i.severity === 'error').length;
  const warnings = issues.length - errors;
  if (errors > 0) return { content: null, issues, errors, warnings };

  const functions = new Map<string, ResolvedFunction>();
  for (const f of uniqueFunctions) {
    const plan = plans.get(f.id);
    if (!plan) {
      // unreachable when errors === 0; guard against pipeline bugs
      return {
        content: null,
        issues: [...issues, { severity: 'error', dataset: 'functions', file: f.file, row: f.row, id: f.id, reason: 'internal: no resolved plan despite zero errors' }],
        errors: errors + 1,
        warnings,
      };
    }
    functions.set(f.id, {
      id: f.id,
      name: f.name,
      cost: f.cost,
      composite: payloads.get(f.id)!.kind === 'composite',
      plan,
      notes: f.notes,
    });
  }

  const resolveSide = (side: Side, rows: ProgramRow[]): ResolvedProgram[] =>
    rows.map((p) => {
      const fn = functions.get(p.functionId)!;
      return {
        id: p.id,
        side,
        name: p.name,
        colors: p.colors,
        shapes: p.shapes,
        functionId: p.functionId,
        fn,
        cost: fn.cost,
        // §11.1 — with one Function per Program the cap equals its cost
        chargeCap: fn.cost,
        notes: p.notes,
      };
    });

  const hacker = resolveSide('player', uniquePrograms.filter((p) => p.dataset === 'hacker-programs'));
  const system = resolveSide('enemy', uniquePrograms.filter((p) => p.dataset === 'system-programs'));
  const programsById = new Map([...hacker, ...system].map((p) => [p.id, p] as const));

  const fingerprint = computeFingerprint(hacker, system, functions);
  const content: ResolvedContent = {
    gameVersion: GAME_VERSION,
    schemaVersion: DATA_SCHEMA_VERSION,
    fingerprint,
    hacker,
    system,
    functions,
    programsById,
  };
  return { content, issues, errors, warnings };
}

// §14.3 — normalized gameplay-content fingerprint. Includes program IDs/side/
// bindings/function refs, function IDs/costs/ordered payload plans/validated
// parameters, and the area-pattern definitions the content uses. Excludes
// notes, display names, and CSV formatting.
function computeFingerprint(
  hacker: ResolvedProgram[],
  system: ResolvedProgram[],
  functions: Map<string, ResolvedFunction>,
): string {
  const usedAreas = new Set<string>();
  const fnNorm = [...functions.values()]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((f) => ({
      id: f.id,
      cost: f.cost,
      plan: f.plan.map((op) => {
        if (op.params.areaPattern) usedAreas.add(op.params.areaPattern);
        return {
          fn: op.fnId,
          effect: op.effectId,
          q: op.params.quantity ?? null,
          cd: op.params.countdown ?? null,
          ap: op.params.areaPattern ?? null,
          mag: op.params.magnitude ?? null,
          dmg: op.params.damage ?? null,
        };
      }),
    }));
  const progNorm = (list: ResolvedProgram[]): unknown =>
    list.map((p) => ({ id: p.id, side: p.side, colors: [...p.colors], shapes: [...p.shapes], fn: p.functionId }));
  const areas = [...usedAreas].sort().map((id) => ({ id, cells: AREA_PATTERNS[id as keyof typeof AREA_PATTERNS] }));
  const canonical = JSON.stringify({ schema: DATA_SCHEMA_VERSION, hacker: progNorm(hacker), system: progNorm(system), functions: fnNorm, areas });
  let h = 5381;
  for (let i = 0; i < canonical.length; i++) h = ((h << 5) + h + canonical.charCodeAt(i)) >>> 0;
  return `${h.toString(16).padStart(8, '0')}-${canonical.length.toString(36)}`;
}
