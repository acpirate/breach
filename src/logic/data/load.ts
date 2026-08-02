// Alpha 0.1.0 §6/§7/§10, extended by Alpha 0.3.0 §4 — shared pure-TypeScript
// CSV parse → validate → resolve pipeline. Browser and Node use different
// file-ACQUISITION adapters but converge on this module with the same raw text
// (§4.1). Validation runs in ordered phases, collects every safely discoverable
// error and warning, and constructs the resolved immutable runtime model ONLY
// when no errors exist (§4.9). There is no partial-row fallback and no
// hardcoded-content fallback.

import { parseCsv } from './csv';
import { AREA_PATTERNS, isAreaPatternId } from './areas';
import {
  EFFECT_PARAM_NAMES,
  EffectParamName,
  EffectTupleField,
  TargetKind,
  effectContract,
  isEffectId,
} from './effects';
import { SkillEffectId, SkillParamKind, isSkillEffectId, skillContract, skillEffectIds } from './skills';
import {
  ACTIVE_BUILD_SIZE,
  BombParams,
  DATA_SCHEMA_VERSION,
  DEFAULT_DECK_ID,
  DEFAULT_HACKER_ID,
  EffectParams,
  GAME_VERSION,
  INVENTORY_SIZE,
  LineSliceParams,
  PORTFOLIO_SIZE,
  PlanOp,
  ResolvedContent,
  ResolvedDeck,
  ResolvedFunction,
  ResolvedHacker,
  ResolvedProgram,
  ResolvedSkill,
  ShakeParams,
  TARGETING_TARGETED,
} from './content';
import { Color, Shape, Side } from '../types';

// ---- diagnostics (§10.3) ----

export type DatasetName =
  | 'hacker-programs'
  | 'system-programs'
  | 'functions'
  | 'hackers'
  | 'skills'
  | 'decks'
  | 'content';

export interface DataIssue {
  severity: 'error' | 'warning';
  dataset: DatasetName;
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
  hackers: DataFile;
  skills: DataFile;
  decks: DataFile;
}

export interface LoadResult {
  content: ResolvedContent | null; // null iff any error exists
  issues: DataIssue[];
  errors: number;
  warnings: number;
}

// ---- vocabularies ----

// Engine enum vocabularies as CSV tokens (3-letter uppercase codes).
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

// §5.4 — the RECOGNIZED enum vocabularies in enum order. Weak sets are
// calculated complements over these lists, so derived sets always present in
// recognized order regardless of authored order.
const RECOGNIZED_COLORS: Color[] = Object.values(COLOR_TOKENS).sort((a, b) => a - b);
const RECOGNIZED_SHAPES: Shape[] = Object.values(SHAPE_TOKENS).sort((a, b) => a - b);

const PROGRAM_HEADER = ['PRG_ID', 'name', 'colors', 'shapes', 'functions', 'notes'];
// §4.6 — the existing columns are preserved and the new fields appended. The
// parser binds by header NAME, so the authored column order is irrelevant.
const FUNCTION_HEADER = [
  'FNC_ID',
  'name',
  'cost',
  'payload',
  'notes',
  'quantity',
  'countdown',
  'areaPattern',
  'magnitude',
  'damage',
  'params',
  'startCharged',
];
// §4.4/§4.5 — Alpha 0.4 activates PRG_SET on both identity datasets.
const HACKER_HEADER = ['HAK_ID', 'name', 'BASE_LINK', 'STRONG_COLORS', 'STRONG_SHAPES', 'PRG_SET', 'SKILL', 'BIO', 'GRAPHICS'];
const SKILL_HEADER = ['SKILL_ID', 'skill_effect', 'params', 'display'];
const DECK_HEADER = ['DEK_ID', 'name', 'ADD_LINK', 'PRG_SET', 'FUNCTIONS', 'DESCRIPT', 'GRAPHICS'];

// Required Alpha record IDs (their VALUES are validated by the schema/contract
// rules; per designer ruling the dataset is the final authority on the values).
const REQUIRED_FNC_IDS = [
  'FNC_001', 'FNC_002', 'FNC_003', 'FNC_004', 'FNC_005',
  'FNC_006', 'FNC_007', 'FNC_008', 'FNC_009', 'FNC_010',
  // Alpha 0.4.0 §4.7 — DATACUT and PLINK
  'FNC_011', 'FNC_012',
];
// Alpha 0.4.0 — NINJA and WEASEL complete the six-Program inventory.
const REQUIRED_PRG_H_IDS = ['PRG_H_001', 'PRG_H_002', 'PRG_H_003', 'PRG_H_004', 'PRG_H_005', 'PRG_H_006'];
const REQUIRED_PRG_S_IDS = ['PRG_S_001', 'PRG_S_002', 'PRG_S_003', 'PRG_S_004'];
const REQUIRED_HAK_IDS = ['HAK_01'];
const REQUIRED_SKL_IDS = ['SKL_001', 'SKL_002'];
const REQUIRED_DEK_IDS = ['DEK_01'];

// ---- Alpha 0.4.0 §4.2 spreadsheet-safe value normalization ----

// Spreadsheets prefix a cell with a single apostrophe to force text mode, so
// `'0:1:0:0:1` and `'7` survive editing as literal strings. Remove EXACTLY one
// leading apostrophe: a second one is data (`''VALUE` -> `'VALUE`), and
// embedded or trailing apostrophes are never touched. This runs BEFORE the
// trim, so a quoted-then-padded cell normalizes the same way an unquoted one
// does — which is what makes fingerprints agree across the two authorings.
export function stripLeadingApostrophe(raw: string): string {
  return raw.startsWith("'") ? raw.slice(1) : raw;
}

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

const titleCase = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();

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
  params: Record<EffectParamName, string>; // raw discrete-column text
  tupleRaw: string; // raw `params` column text
  startCharged: boolean;
}

interface HackerRow {
  file: string;
  row: number;
  id: string;
  name: string;
  baseLink: number;
  strongColors: Color[];
  strongShapes: Shape[];
  portfolio: string[]; // §4.4 — ordered PRG_SET
  skillIds: string[];
  bio: string;
  graphics: string;
}

interface SkillRow {
  file: string;
  row: number;
  id: string;
  effectType: SkillEffectId;
  color: Color;
  magnitude: number;
  display: string;
  displayTemplate: string;
  paramTokens: string[];
}

interface DeckRow {
  file: string;
  row: number;
  id: string;
  name: string;
  addLink: number;
  portfolio: string[]; // §4.5 — ordered PRG_SET
  functionId: string;
  descript: string;
  graphics: string;
}

// ---- the pipeline ----

export function loadContent(files: DataFiles): LoadResult {
  const issues: DataIssue[] = [];
  const err = (i: Omit<DataIssue, 'severity'>): void => void issues.push({ severity: 'error', ...i });
  const warn = (i: Omit<DataIssue, 'severity'>): void => void issues.push({ severity: 'warning', ...i });

  // Phase 2/3 — headers + rows, per dataset.
  const readTable = (
    file: DataFile,
    dataset: DatasetName,
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
    // bind by header name, not position (§4.2)
    const idx = new Map(header.map((h, i) => [h, i] as const));
    const rows = parsed.rows.slice(1).map((r) => ({
      line: r.line,
      // Alpha 0.4.0 §4.2 — spreadsheet-safe normalization happens HERE, once,
      // for every data cell of every dataset, before any field-specific
      // trimming, parsing, resolution, validation, or fingerprinting. Header
      // names keep their Alpha 0.3 handling (trim only), as §4.2 permits.
      get: (col: string): string => stripLeadingApostrophe(r.fields[idx.get(col)!] ?? ''),
    }));
    for (const r of parsed.rows.slice(1)) {
      if (r.fields.length !== header.length) {
        err({ dataset, file: file.name, row: r.line, expected: `${header.length} fields`, value: `${r.fields.length} fields`, reason: 'row field count does not match header' });
      }
    }
    return { header, rows };
  };

  interface Ctx {
    dataset: DatasetName;
    file: string;
    row: number;
    id: string;
  }

  // §4.2 list parsing for enum token lists (colors/shapes): duplicates have no
  // defined meaning here, so they are rejected.
  const parseTokenList = <T>(
    raw: string,
    vocab: Record<string, T>,
    ctx: Ctx & { field: string },
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

  // §4.2 list parsing for stable-ID REFERENCE lists. `allowDuplicates` is true
  // where repeats carry defined meaning — duplicate Hacker Skills stack
  // additively (§6.4), so they must not be rejected.
  const parseRefList = (
    raw: string,
    prefix: string,
    ctx: Ctx & { field: string },
    allowDuplicates: boolean,
  ): string[] | null => {
    if (raw.trim() === '') {
      err({ ...ctx, value: raw, reason: 'at least one entry is required' });
      return null;
    }
    const tokens = raw.split(':').map((t) => t.trim());
    const out: string[] = [];
    const seen = new Set<string>();
    let ok = true;
    for (const t of tokens) {
      if (t === '') {
        err({ ...ctx, value: raw, reason: 'blank token in list' });
        ok = false;
        continue;
      }
      if (!allowDuplicates && seen.has(t)) {
        err({ ...ctx, value: t, reason: 'duplicate token in list' });
        ok = false;
        continue;
      }
      seen.add(t);
      if (!t.startsWith(prefix)) {
        err({ ...ctx, value: t, expected: `${prefix}*`, reason: 'wrong ID prefix for this reference' });
        ok = false;
        continue;
      }
      out.push(t);
    }
    return ok ? out : null;
  };

  // §4.4/§4.5 — an ordered Program portfolio: exactly PORTFOLIO_SIZE distinct
  // valid PRG_H_* references. Authored order is preserved and is gameplay
  // significant, so this deliberately does NOT sort or deduplicate silently.
  const parsePortfolio = (raw: string, ctx: Ctx & { field: string }): string[] | null => {
    const ids = parseRefList(raw, 'PRG_H_', ctx, false);
    if (ids === null) return null;
    if (ids.length !== PORTFOLIO_SIZE) {
      err({
        ...ctx,
        value: raw.trim(),
        expected: `exactly ${PORTFOLIO_SIZE} PRG_H_* references`,
        reason: `PRG_SET must contain exactly ${PORTFOLIO_SIZE} distinct Programs`,
      });
      return null;
    }
    return ids;
  };

  const checkName = (raw: string, ctx: Ctx): string | null => {
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

  // Bounded integer field with an explicit accepted range.
  const readInt = (
    raw: string,
    ctx: Ctx & { field: string },
    min: number,
    max: number,
  ): number | null => {
    const p = parseIntField(raw);
    if (!p.present || p.invalid || p.value === undefined) {
      err({ ...ctx, value: raw.trim() || undefined, expected: `integer ${min}-${max}`, reason: `${ctx.field} must be an integer` });
      return null;
    }
    if (p.value < min || p.value > max) {
      err({ ...ctx, value: raw.trim(), expected: `${min}-${max}`, reason: `${ctx.field} is out of range` });
      return null;
    }
    return p.value;
  };

  // §4.6 — Y / N / blank. Blank is interpreted as N.
  const readStartCharged = (raw: string, ctx: Ctx): boolean | null => {
    const t = raw.trim();
    if (t === '' || t === 'N') return false;
    if (t === 'Y') return true;
    err({ ...ctx, field: 'startCharged', value: t, expected: 'Y|N|blank', reason: 'invalid startCharged token' });
    return null;
  };

  // §4.6/§8.2 — a compound colon-delimited integer-enum tuple. `0` is a
  // supplied value, not absence. Exact length, token type, and allowed values
  // are validated here so runtime never parses the raw string.
  const readTuple = (
    raw: string,
    fields: ReadonlyArray<EffectTupleField>,
    ctx: Ctx & { field: string },
  ): number[] | null => {
    const tokens = raw.split(':').map((t) => t.trim());
    if (tokens.length !== fields.length) {
      err({
        ...ctx,
        value: raw.trim(),
        expected: fields.map((f) => f.name).join(':'),
        reason: `tuple must have exactly ${fields.length} colon-delimited values`,
      });
      return null;
    }
    const out: number[] = [];
    let ok = true;
    tokens.forEach((tok, i) => {
      const f = fields[i];
      const p = parseIntField(tok);
      if (!p.present || p.invalid || p.value === undefined) {
        err({ ...ctx, value: tok, expected: `${f.name} ${f.min}-${f.max}`, reason: `malformed tuple value for ${f.name}` });
        ok = false;
        return;
      }
      if (p.value < f.min || p.value > f.max) {
        err({ ...ctx, value: tok, expected: `${f.name} ${f.min}-${f.max}`, reason: `tuple value out of range for ${f.name}` });
        ok = false;
        return;
      }
      out.push(p.value);
    });
    return ok ? out : null;
  };

  // ---- Phase 3/4 — parse Program datasets ----

  const programRows: ProgramRow[] = [];
  const readPrograms = (file: DataFile, dataset: 'hacker-programs' | 'system-programs', prefix: string): void => {
    const table = readTable(file, dataset, PROGRAM_HEADER);
    if (!table) return;
    for (const r of table.rows) {
      const id = r.get('PRG_ID').trim();
      const ctx: Ctx = { dataset, file: file.name, row: r.line, id };
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
      // exactly one FNC reference per Program (§6.1)
      let functionId: string | null = null;
      if (!fnRaw) {
        err({ ...ctx, field: 'functions', reason: 'exactly one FNC_* reference is required' });
      } else if (fnRaw.includes(':')) {
        err({ ...ctx, field: 'functions', value: fnRaw, reason: 'exactly one Function per Program is permitted' });
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
        const ctx: Ctx = { dataset: 'functions', file: files.functions.name, row: r.line, id };
        if (!id) {
          err({ ...ctx, field: 'FNC_ID', reason: 'FNC_ID is required' });
          continue;
        }
        if (!id.startsWith('FNC_')) {
          err({ ...ctx, field: 'FNC_ID', value: id, expected: 'FNC_*', reason: 'wrong Function ID prefix' });
          continue;
        }
        const name = checkName(r.get('name'), ctx);
        const cost = readInt(r.get('cost'), { ...ctx, field: 'cost' }, 1, 9999);
        const payloadRaw = r.get('payload').trim();
        if (!payloadRaw) err({ ...ctx, field: 'payload', reason: 'payload is required' });
        const startCharged = readStartCharged(r.get('startCharged'), ctx);
        if (name === null || cost === null || !payloadRaw || startCharged === null) continue;
        const params = {} as Record<EffectParamName, string>;
        for (const p of EFFECT_PARAM_NAMES) params[p] = r.get(p);
        functionRows.push({
          file: files.functions.name,
          row: r.line,
          id,
          name,
          cost,
          payloadRaw,
          notes: r.get('notes').trim(),
          params,
          tupleRaw: r.get('params').trim(),
          startCharged,
        });
      }
    }
  }

  // ---- Phase 3/4 — parse Skill dataset (§4.4) ----

  const skillRows: SkillRow[] = [];
  {
    const table = readTable(files.skills, 'skills', SKILL_HEADER);
    if (table) {
      for (const r of table.rows) {
        const id = r.get('SKILL_ID').trim();
        const ctx: Ctx = { dataset: 'skills', file: files.skills.name, row: r.line, id };
        if (!id) {
          err({ ...ctx, field: 'SKILL_ID', reason: 'SKILL_ID is required' });
          continue;
        }
        if (!id.startsWith('SKL_')) {
          err({ ...ctx, field: 'SKILL_ID', value: id, expected: 'SKL_*', reason: 'wrong Skill ID prefix' });
          continue;
        }
        const effectRaw = r.get('skill_effect').trim();
        if (!isSkillEffectId(effectRaw)) {
          err({ ...ctx, field: 'skill_effect', value: effectRaw, expected: skillEffectIds().join('|'), reason: 'unknown Skill effect type' });
          continue;
        }
        const contract = skillContract(effectRaw)!;
        // typed parameter tuple, validated by the selected skill_effect
        const paramsRaw = r.get('params').trim();
        const tokens = paramsRaw.split(':').map((t) => t.trim());
        if (paramsRaw === '' || tokens.length !== contract.params.length) {
          err({
            ...ctx,
            field: 'params',
            value: paramsRaw,
            expected: contract.params.join(':'),
            reason: `Skill params must have exactly ${contract.params.length} colon-delimited values`,
          });
          continue;
        }
        let tupleOk = true;
        let color: Color | null = null;
        let magnitude: number | null = null;
        contract.params.forEach((kind: SkillParamKind, i) => {
          const tok = tokens[i];
          if (tok === '') {
            err({ ...ctx, field: 'params', value: paramsRaw, reason: 'blank token in Skill params' });
            tupleOk = false;
            return;
          }
          if (kind === 'color') {
            if (!(tok in COLOR_TOKENS)) {
              err({ ...ctx, field: 'params', value: tok, expected: Object.keys(COLOR_TOKENS).join('|'), reason: 'unknown color enum value in Skill params' });
              tupleOk = false;
              return;
            }
            color = COLOR_TOKENS[tok];
          } else {
            const p = parseIntField(tok);
            if (!p.present || p.invalid || p.value === undefined || p.value < 1 || p.value > 999999) {
              err({ ...ctx, field: 'params', value: tok, expected: 'positive integer', reason: 'invalid magnitude in Skill params' });
              tupleOk = false;
              return;
            }
            magnitude = p.value;
          }
        });
        // §4.4 display: presentation ONLY, never gameplay authority. %N refers
        // to the zero-based ordered parsed parameter tokens; unsupported or
        // out-of-range placeholders are startup errors.
        const template = r.get('display').trim();
        let displayOk = true;
        if (!template) {
          err({ ...ctx, field: 'display', reason: 'display is required' });
          displayOk = false;
        } else {
          for (const m of template.matchAll(/%(\d*)/g)) {
            if (m[1] === '') {
              err({ ...ctx, field: 'display', value: m[0], reason: 'unsupported Skill display placeholder (expected %N)' });
              displayOk = false;
              continue;
            }
            const n = Number(m[1]);
            if (n >= contract.params.length) {
              err({ ...ctx, field: 'display', value: m[0], expected: `%0-%${contract.params.length - 1}`, reason: 'Skill display placeholder out of range' });
              displayOk = false;
            }
          }
        }
        if (!tupleOk || !displayOk || color === null || magnitude === null) continue;
        // Current enum tokens render in normal player-facing title case
        // (RED -> Red); numeric tokens render as authored. Deliberately NOT a
        // generalized localization or expression engine (§4.4).
        const shown = contract.params.map((kind, i) => (kind === 'color' ? titleCase(tokens[i]) : tokens[i]));
        const display = template.replace(/%(\d+)/g, (_all, d: string) => shown[Number(d)]);
        skillRows.push({
          file: files.skills.name,
          row: r.line,
          id,
          effectType: effectRaw,
          color,
          magnitude,
          display,
          displayTemplate: template,
          paramTokens: tokens,
        });
      }
    }
  }

  // ---- Phase 3/4 — parse Hacker dataset (§4.3) ----

  const hackerRows: HackerRow[] = [];
  {
    const table = readTable(files.hackers, 'hackers', HACKER_HEADER);
    if (table) {
      for (const r of table.rows) {
        const id = r.get('HAK_ID').trim();
        const ctx: Ctx = { dataset: 'hackers', file: files.hackers.name, row: r.line, id };
        if (!id) {
          err({ ...ctx, field: 'HAK_ID', reason: 'HAK_ID is required' });
          continue;
        }
        if (!id.startsWith('HAK_')) {
          err({ ...ctx, field: 'HAK_ID', value: id, expected: 'HAK_*', reason: 'wrong Hacker ID prefix' });
          continue;
        }
        const name = checkName(r.get('name'), ctx);
        const baseLink = readInt(r.get('BASE_LINK'), { ...ctx, field: 'BASE_LINK' }, 1, 9999);
        const strongColors = parseTokenList(r.get('STRONG_COLORS'), COLOR_TOKENS, { ...ctx, field: 'STRONG_COLORS' });
        const strongShapes = parseTokenList(r.get('STRONG_SHAPES'), SHAPE_TOKENS, { ...ctx, field: 'STRONG_SHAPES' });
        const portfolio = parsePortfolio(r.get('PRG_SET'), { ...ctx, field: 'PRG_SET' });
        // duplicates permitted: repeated qualifying Skills stack additively
        const skillIds = parseRefList(r.get('SKILL'), 'SKL_', { ...ctx, field: 'SKILL' }, true);
        if (name === null || baseLink === null || strongColors === null || strongShapes === null || portfolio === null || skillIds === null) continue;
        hackerRows.push({
          file: files.hackers.name,
          row: r.line,
          id,
          name,
          baseLink,
          strongColors,
          strongShapes,
          portfolio,
          skillIds,
          // §2.12 placeholders: retained verbatim, never interpreted
          bio: r.get('BIO').trim(),
          graphics: r.get('GRAPHICS').trim(),
        });
      }
    }
  }

  // ---- Phase 3/4 — parse Deck dataset (§4.5) ----

  const deckRows: DeckRow[] = [];
  {
    const table = readTable(files.decks, 'decks', DECK_HEADER);
    if (table) {
      for (const r of table.rows) {
        const id = r.get('DEK_ID').trim();
        const ctx: Ctx = { dataset: 'decks', file: files.decks.name, row: r.line, id };
        if (!id) {
          err({ ...ctx, field: 'DEK_ID', reason: 'DEK_ID is required' });
          continue;
        }
        // A HAK_* value in this field is invalid (§4.5 — the corrected typo).
        if (!id.startsWith('DEK_')) {
          err({ ...ctx, field: 'DEK_ID', value: id, expected: 'DEK_*', reason: 'wrong Deck ID prefix' });
          continue;
        }
        const name = checkName(r.get('name'), ctx);
        const addLink = readInt(r.get('ADD_LINK'), { ...ctx, field: 'ADD_LINK' }, 0, 9999);
        const portfolio = parsePortfolio(r.get('PRG_SET'), { ...ctx, field: 'PRG_SET' });
        // §4.5 — Alpha 0.3 requires EXACTLY one Function; more than one is an error
        const fnRefs = parseRefList(r.get('FUNCTIONS'), 'FNC_', { ...ctx, field: 'FUNCTIONS' }, false);
        let functionId: string | null = null;
        if (fnRefs !== null) {
          if (fnRefs.length !== 1) {
            err({ ...ctx, field: 'FUNCTIONS', value: r.get('FUNCTIONS').trim(), expected: 'exactly one FNC_* reference', reason: 'Alpha 0.3 permits exactly one Deck Function' });
          } else {
            functionId = fnRefs[0];
          }
        }
        if (name === null || addLink === null || portfolio === null || functionId === null) continue;
        deckRows.push({
          file: files.decks.name,
          row: r.line,
          id,
          name,
          addLink,
          portfolio,
          functionId,
          descript: r.get('DESCRIPT').trim(),
          graphics: r.get('GRAPHICS').trim(),
        });
      }
    }
  }

  // ---- Phase 5 — global ID uniqueness + duplicate-name warnings ----

  const idHome = new Map<string, { dataset: DatasetName; file: string; row: number }>();
  const claimId = (id: string, ctx: { dataset: DatasetName; file: string; row: number }): boolean => {
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
  const uniqueSkills = skillRows.filter((s) => claimId(s.id, { dataset: 'skills', file: s.file, row: s.row }));
  const uniqueHackers = hackerRows.filter((h) => claimId(h.id, { dataset: 'hackers', file: h.file, row: h.row }));
  const uniqueDecks = deckRows.filter((d) => claimId(d.id, { dataset: 'decks', file: d.file, row: d.row }));

  {
    // §4.2 — duplicate display names are valid but produce a startup warning.
    const names = new Map<string, { dataset: DatasetName; file: string; row: number; id: string }>();
    for (const rec of [
      ...uniquePrograms.map((p) => ({ name: p.name, dataset: p.dataset, file: p.file, row: p.row, id: p.id })),
      ...uniqueFunctions.map((f) => ({ name: f.name, dataset: 'functions' as const, file: f.file, row: f.row, id: f.id })),
      ...uniqueHackers.map((h) => ({ name: h.name, dataset: 'hackers' as const, file: h.file, row: h.row, id: h.id })),
      ...uniqueDecks.map((d) => ({ name: d.name, dataset: 'decks' as const, file: d.file, row: d.row, id: d.id })),
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
  const sklById = new Map(uniqueSkills.map((s) => [s.id, s] as const));

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

  // ---- Phase 4 (cont.) — Effect parameter contracts (§9/§4.6) ----

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
        if (f.tupleRaw !== '') {
          warn({ dataset: 'functions', file: f.file, row: f.row, id: f.id, field: 'params', value: f.tupleRaw, reason: 'populated parameter is unused by a composite Function' });
        }
      }
      continue;
    }
    const contract = effectContract(p.effectId!)!;
    const ctx: Ctx = { dataset: 'functions', file: f.file, row: f.row, id: f.id };
    const out: EffectParams = {};
    let ok = true;
    const required = new Set<EffectParamName>(contract.required);
    const optional = new Set<EffectParamName>(contract.optional ?? []);
    for (const col of EFFECT_PARAM_NAMES) {
      const raw = f.params[col];
      const isRequired = required.has(col);
      // §14.3 — an OPTIONAL column is validated when supplied and simply
      // absent otherwise. Blank is meaningful (immediate Bomb resolution), so
      // it is neither an error nor a populated-but-unused warning.
      if (!isRequired && optional.has(col) && col !== 'areaPattern') {
        const parsed = parseIntField(raw);
        if (!parsed.present) continue;
        if (parsed.invalid || parsed.value === undefined) {
          err({ ...ctx, field: col, value: raw.trim(), expected: 'non-negative integer', reason: `invalid ${col} for ${p.effectId}` });
          ok = false;
          continue;
        }
        // countdown 0 is explicitly "resolve immediately" (§14.3); a negative
        // value cannot reach here because the integer syntax rejects the sign.
        if (parsed.value > 9999) {
          err({ ...ctx, field: col, value: raw.trim(), expected: '0-9999', reason: 'parameter out of range' });
          ok = false;
          continue;
        }
        out[col] = parsed.value;
        continue;
      }
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
    // §4.6 — the compound `params` tuple, when the Effect contract declares one
    if (contract.tuple) {
      if (f.tupleRaw === '') {
        err({ ...ctx, field: 'params', expected: contract.tuple.map((t) => t.name).join(':'), reason: `missing required params tuple for ${p.effectId}` });
        ok = false;
      } else {
        const vals = readTuple(f.tupleRaw, contract.tuple, { ...ctx, field: 'params' });
        if (!vals) ok = false;
        else if (p.effectId === 'EFFECT_BOMB') {
          // §14.2 — all three values are mandatory; readTuple has already
          // enforced exact length and per-field range.
          out.bomb = { targeting: vals[0], dealDamage: vals[1], gainCharge: vals[2] } as BombParams;
        } else if (p.effectId === 'EFFECT_LINESLICE') {
          out.line = {
            dimension: vals[0],
            targeting: vals[1],
            specialRetention: vals[2],
            dealDamage: vals[3],
            gainCharge: vals[4],
          } as LineSliceParams;
        } else if (p.effectId === 'EFFECT_SHAKE') {
          const shake: ShakeParams = {
            boardComposition: vals[0] as ShakeParams['boardComposition'],
            specialGems: vals[1] as ShakeParams['specialGems'],
            matches: vals[2] as ShakeParams['matches'],
            cascades: vals[3] as ShakeParams['cascades'],
          };
          out.shake = shake;
          // §4.9 semantic warnings: valid data whose combination is inert.
          if (shake.boardComposition === 1 && shake.specialGems === 0) {
            warn({ ...ctx, field: 'params', value: f.tupleRaw, reason: 'EFFECT_SHAKE Replace mode combined with Retain-specials mode — Retain is ineffective because Replace removes prior tile state' });
          }
          if (shake.matches === 0 && shake.cascades !== 0) {
            warn({ ...ctx, field: 'params', value: f.tupleRaw, reason: 'EFFECT_SHAKE matches are disabled while a nonzero cascade mode is supplied — the cascade mode is currently ignored' });
          }
        }
      }
    } else if (f.tupleRaw !== '') {
      warn({ ...ctx, field: 'params', value: f.tupleRaw, reason: `populated parameter is unused by ${p.effectId}` });
    }
    // §12.3 — a PLAYER-TARGETED configuration deploys exactly once. Quantity
    // above one would mean accumulating several player-chosen targets, which
    // is deferred multi-target behavior and explicitly out of scope (§22).
    // Random targeting may still deploy more than once.
    const targeting = out.bomb?.targeting ?? out.line?.targeting;
    if (targeting === TARGETING_TARGETED && (out.quantity ?? 1) !== 1) {
      err({
        ...ctx,
        field: 'quantity',
        value: String(out.quantity),
        expected: '1',
        reason: `a targeted ${p.effectId} must have quantity 1 (multi-target selection is out of scope)`,
      });
      ok = false;
    }
    if (ok) fnParams.set(f.id, out);
  }

  // ---- Phase 6 — cross-dataset references ----

  for (const p of uniquePrograms) {
    if (!fnById.has(p.functionId)) {
      err({ dataset: p.dataset, file: p.file, row: p.row, id: p.id, field: 'functions', value: p.functionId, reason: 'reference to unknown Function ID' });
    }
  }
  for (const d of uniqueDecks) {
    if (!fnById.has(d.functionId)) {
      err({ dataset: 'decks', file: d.file, row: d.row, id: d.id, field: 'FUNCTIONS', value: d.functionId, reason: 'reference to unknown Function ID' });
    }
  }
  for (const h of uniqueHackers) {
    for (const sid of h.skillIds) {
      if (!sklById.has(sid)) {
        err({ dataset: 'hackers', file: h.file, row: h.row, id: h.id, field: 'SKILL', value: sid, reason: 'reference to unknown Skill ID' });
      }
    }
  }

  // ---- Alpha 0.4.0 §4.6 — portfolio references and combined inventory ----

  const hackerProgramIds = new Set(uniquePrograms.filter((p) => p.dataset === 'hacker-programs').map((p) => p.id));
  const portfolioOk = new Map<string, boolean>(); // by HAK_/DEK_ id
  const checkPortfolioRefs = (
    id: string,
    portfolio: string[],
    ctx: { dataset: DatasetName; file: string; row: number },
  ): void => {
    let ok = true;
    for (const pid of portfolio) {
      if (!hackerProgramIds.has(pid)) {
        err({ ...ctx, id, field: 'PRG_SET', value: pid, expected: 'a loaded PRG_H_* Program', reason: 'PRG_SET references an unknown Hacker Program ID' });
        ok = false;
      }
    }
    portfolioOk.set(id, ok);
  };
  for (const h of uniqueHackers) checkPortfolioRefs(h.id, h.portfolio, { dataset: 'hackers', file: h.file, row: h.row });
  for (const d of uniqueDecks) checkPortfolioRefs(d.id, d.portfolio, { dataset: 'decks', file: d.file, row: d.row });

  // §4.6 — because every Deck is compatible with every Hacker (§2.7), EVERY
  // pairing must be able to produce a valid six-Program inventory. Overlap
  // between a Hacker and a Deck portfolio is a startup content error: Alpha
  // 0.4 has no owned Program instances and no duplicate copies of one PRG_ID
  // (§2.2), so the pairing simply could not yield six distinct Programs.
  for (const h of uniqueHackers) {
    if (!portfolioOk.get(h.id)) continue;
    for (const d of uniqueDecks) {
      if (!portfolioOk.get(d.id)) continue;
      const overlap = h.portfolio.filter((pid) => d.portfolio.includes(pid));
      if (overlap.length) {
        err({
          dataset: 'content',
          file: files.decks.name,
          id: d.id,
          field: 'PRG_SET',
          value: overlap.join(':'),
          reason: `Hacker ${h.id} and Deck ${d.id} portfolios overlap — the pairing cannot produce ${INVENTORY_SIZE} distinct Programs`,
        });
        continue;
      }
      const combined = new Set([...h.portfolio, ...d.portfolio]);
      if (combined.size !== INVENTORY_SIZE) {
        err({
          dataset: 'content',
          file: files.hackers.name,
          id: `${h.id}/${d.id}`,
          reason: `combined inventory resolves ${combined.size} distinct Programs, expected ${INVENTORY_SIZE}`,
        });
      } else if (h.portfolio.length < ACTIVE_BUILD_SIZE / 2 || d.portfolio.length < ACTIVE_BUILD_SIZE / 2) {
        // §4.13 — content that cannot produce the required default build.
        err({
          dataset: 'content',
          file: files.hackers.name,
          id: `${h.id}/${d.id}`,
          reason: `pairing cannot produce the default ${ACTIVE_BUILD_SIZE}-Program build from portfolio order`,
        });
      }
    }
  }

  // ---- Phase 9 — expand composites, targeting constraints (§7.3) ----

  // §12/§13.2/§14.2 — resolve THIS row's targeting requirement. An Effect is
  // targeted either always (Drain) or because its typed tuple says so
  // (Bomb/LineSlice with targeting=1). Resolved once here so neither
  // validation nor combat ever re-reads the raw tuple.
  const resolveTarget = (effectId: string, params: EffectParams): TargetKind | null => {
    const contract = effectContract(effectId)!;
    if (contract.targeted) return contract.targetKind ?? 'unit';
    const targeting = params.bomb?.targeting ?? params.line?.targeting;
    return targeting === TARGETING_TARGETED ? (contract.targetKind ?? 'packet') : null;
  };

  const buildPlan = (fnId: string): PlanOp[] | null => {
    const payload = payloads.get(fnId);
    if (!payload) return null;
    if (payload.kind === 'leaf') {
      const params = fnParams.get(fnId);
      if (!params) return null;
      const effectId = payload.effectId! as PlanOp['effectId'];
      return [{ fnId, effectId, params, target: resolveTarget(effectId, params) }];
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
    // §7.3 — payload-order validation now reads the RESOLVED per-op target, so
    // a Bomb row configured for random placement is correctly not targeted
    // while the same Effect configured for player selection is.
    const targetedIdxs = plan
      .map((op, i) => ({ op, i }))
      .filter(({ op }) => op.target !== null);
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

  // ---- Phase 10 — required Alpha records and explicit defaults present ----

  const requireIds = (ids: string[], have: (id: string) => boolean, dataset: DatasetName, file: string): void => {
    for (const id of ids) {
      if (!have(id)) err({ dataset, file, id, reason: 'required Alpha record is missing' });
    }
  };
  requireIds(REQUIRED_FNC_IDS, (id) => fnById.has(id), 'functions', files.functions.name);
  const prgIds = new Set(uniquePrograms.map((p) => p.id));
  requireIds(REQUIRED_PRG_H_IDS, (id) => prgIds.has(id), 'hacker-programs', files.hacker.name);
  requireIds(REQUIRED_PRG_S_IDS, (id) => prgIds.has(id), 'system-programs', files.system.name);
  const hakIds = new Set(uniqueHackers.map((h) => h.id));
  const dekIds = new Set(uniqueDecks.map((d) => d.id));
  requireIds(REQUIRED_HAK_IDS, (id) => hakIds.has(id), 'hackers', files.hackers.name);
  requireIds(REQUIRED_SKL_IDS, (id) => sklById.has(id), 'skills', files.skills.name);
  requireIds(REQUIRED_DEK_IDS, (id) => dekIds.has(id), 'decks', files.decks.name);

  // §5.2 — a missing or invalid explicit default BLOCKS startup. There is no
  // fallback to another row.
  if (!hakIds.has(DEFAULT_HACKER_ID)) {
    err({ dataset: 'content', file: files.hackers.name, id: DEFAULT_HACKER_ID, reason: `DEFAULT_HACKER_ID ${DEFAULT_HACKER_ID} is not a valid loaded Hacker` });
  }
  if (!dekIds.has(DEFAULT_DECK_ID)) {
    err({ dataset: 'content', file: files.decks.name, id: DEFAULT_DECK_ID, reason: `DEFAULT_DECK_ID ${DEFAULT_DECK_ID} is not a valid loaded Deck` });
  }

  // §4.9 — valid but currently unreferenced content rows WARN (never fail).
  {
    const referencedFns = new Set<string>();
    for (const p of uniquePrograms) referencedFns.add(p.functionId);
    for (const d of uniqueDecks) referencedFns.add(d.functionId);
    for (const [id, payload] of payloads) {
      if (payload.kind === 'composite' && referencedFns.has(id)) {
        for (const child of payload.children!) referencedFns.add(child);
      }
    }
    // A composite that is itself referenced propagates to its children above;
    // children of an unreferenced composite stay unreferenced with it.
    for (const f of uniqueFunctions) {
      if (!referencedFns.has(f.id)) {
        warn({ dataset: 'functions', file: f.file, row: f.row, id: f.id, reason: 'valid Function row is not referenced by any Program, Deck, or composite payload' });
      }
    }
    const referencedSkills = new Set<string>();
    for (const h of uniqueHackers) for (const sid of h.skillIds) referencedSkills.add(sid);
    for (const s of uniqueSkills) {
      if (!referencedSkills.has(s.id)) {
        warn({ dataset: 'skills', file: s.file, row: s.row, id: s.id, reason: 'valid Skill row is not referenced by any Hacker' });
      }
    }
  }

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
      startCharged: f.startCharged,
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

  const skills = new Map<string, ResolvedSkill>();
  for (const s of uniqueSkills) {
    skills.set(s.id, {
      id: s.id,
      effectType: s.effectType,
      color: s.color,
      magnitude: s.magnitude,
      display: s.display,
      displayTemplate: s.displayTemplate,
      paramTokens: s.paramTokens,
    });
  }

  const hackers = new Map<string, ResolvedHacker>();
  for (const h of uniqueHackers) {
    // §5.4 — weak sets are calculated complements in recognized enum order
    const weakColors = RECOGNIZED_COLORS.filter((c) => !h.strongColors.includes(c));
    const weakShapes = RECOGNIZED_SHAPES.filter((s) => !h.strongShapes.includes(s));
    hackers.set(h.id, {
      id: h.id,
      name: h.name,
      baseLink: h.baseLink,
      strongColors: h.strongColors,
      weakColors,
      strongShapes: h.strongShapes,
      weakShapes,
      skillIds: h.skillIds,
      skills: h.skillIds.map((sid) => skills.get(sid)!),
      portfolioProgramIds: h.portfolio,
      bio: h.bio,
      graphics: h.graphics,
    });
  }

  const decks = new Map<string, ResolvedDeck>();
  for (const d of uniqueDecks) {
    decks.set(d.id, {
      id: d.id,
      name: d.name,
      addLink: d.addLink,
      functionId: d.functionId,
      fn: functions.get(d.functionId)!,
      portfolioProgramIds: d.portfolio,
      descript: d.descript,
      graphics: d.graphics,
    });
  }

  const fingerprint = computeFingerprint(hacker, system, functions, hackers, skills, decks);
  const content: ResolvedContent = {
    gameVersion: GAME_VERSION,
    schemaVersion: DATA_SCHEMA_VERSION,
    fingerprint,
    hacker,
    system,
    functions,
    programsById,
    hackers,
    skills,
    decks,
    hackerOrder: uniqueHackers.map((h) => h.id),
    deckOrder: uniqueDecks.map((d) => d.id),
  };
  return { content, issues, errors, warnings };
}

// §4.10 — normalized gameplay-content fingerprint. Includes gameplay-affecting
// values from ALL required datasets: program IDs/side/bindings/function refs,
// function IDs/costs/ordered payload plans/validated parameters/startCharged,
// the area-pattern definitions the content uses, Hacker LINK and strong sets
// and ordered Skill IDs, Skill effect types and typed parameters, and Deck
// added LINK and Function references. EXCLUDES notes, display names, BIO,
// GRAPHICS, DESCRIPT, presentational Skill display text, and CSV formatting.
function computeFingerprint(
  hacker: ResolvedProgram[],
  system: ResolvedProgram[],
  functions: Map<string, ResolvedFunction>,
  hackers: Map<string, ResolvedHacker>,
  skills: Map<string, ResolvedSkill>,
  decks: Map<string, ResolvedDeck>,
): string {
  const usedAreas = new Set<string>();
  const byId = <T extends { id: string }>(m: Map<string, T>): T[] =>
    [...m.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const fnNorm = byId(functions).map((f) => ({
    id: f.id,
    cost: f.cost,
    sc: f.startCharged,
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
        shake: op.params.shake
          ? [op.params.shake.boardComposition, op.params.shake.specialGems, op.params.shake.matches, op.params.shake.cascades]
          : null,
        // §4.12 — the Alpha 0.4 typed tuples and the resolved targeting they
        // select are gameplay-affecting and therefore fingerprinted.
        bomb: op.params.bomb ? [op.params.bomb.targeting, op.params.bomb.dealDamage, op.params.bomb.gainCharge] : null,
        line: op.params.line
          ? [
              op.params.line.dimension,
              op.params.line.targeting,
              op.params.line.specialRetention,
              op.params.line.dealDamage,
              op.params.line.gainCharge,
            ]
          : null,
        tgt: op.target,
      };
    }),
  }));
  const progNorm = (list: ResolvedProgram[]): unknown =>
    list.map((p) => ({ id: p.id, side: p.side, colors: [...p.colors], shapes: [...p.shapes], fn: p.functionId }));
  // §4.12 — portfolio ORDER is mandatory fingerprint input: it determines the
  // default build and the inventory's source display.
  const hakNorm = byId(hackers).map((h) => ({
    id: h.id,
    link: h.baseLink,
    sc: [...h.strongColors],
    ss: [...h.strongShapes],
    skills: [...h.skillIds],
    prg: [...h.portfolioProgramIds],
  }));
  const sklNorm = byId(skills).map((s) => ({ id: s.id, effect: s.effectType, color: s.color, mag: s.magnitude }));
  const dekNorm = byId(decks).map((d) => ({ id: d.id, add: d.addLink, fn: d.functionId, prg: [...d.portfolioProgramIds] }));
  const areas = [...usedAreas].sort().map((id) => ({ id, cells: AREA_PATTERNS[id as keyof typeof AREA_PATTERNS] }));
  const canonical = JSON.stringify({
    schema: DATA_SCHEMA_VERSION,
    hacker: progNorm(hacker),
    system: progNorm(system),
    functions: fnNorm,
    areas,
    hackers: hakNorm,
    skills: sklNorm,
    decks: dekNorm,
  });
  let h = 5381;
  for (let i = 0; i < canonical.length; i++) h = ((h << 5) + h + canonical.charCodeAt(i)) >>> 0;
  return `${h.toString(16).padStart(8, '0')}-${canonical.length.toString(36)}`;
}
