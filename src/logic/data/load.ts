// Alpha 0.1.0 §6/§7/§10, extended by Alpha 0.3.0 §4 — shared pure-TypeScript
// CSV parse → validate → resolve pipeline. Browser and Node use different
// file-ACQUISITION adapters but converge on this module with the same raw text
// (§4.1). Validation runs in ordered phases, collects every safely discoverable
// error and warning, and constructs the resolved immutable runtime model ONLY
// when no errors exist (§4.9). There is no partial-row fallback and no
// hardcoded-content fallback.

import { parseCsv } from './csv';
import { AREA_PATTERNS, AREA_PATTERN_ORDER, isAreaPatternId } from './areas';
import {
  EFFECT_AXIS_NAMES,
  EFFECT_PARAM_NAMES,
  EffectAxisName,
  EffectParamName,
  EffectTupleField,
  TargetKind,
  effectContract,
  isEffectId,
} from './effects';
import {
  ALL_SCOPE_TOKEN,
  AgentScope,
  PassiveActivation,
  PassiveEffectId,
  PassiveParamKind,
  isAgentScope,
  isPassiveActivation,
  isPassiveEffectId,
  passiveContract,
  passiveEffectIds,
} from './passives';
import {
  ACTIVE_BUILD_SIZE,
  AXIS_ALL,
  AXIS_NEUTRAL,
  AxisResult,
  AxisTarget,
  BombParams,
  DATA_SCHEMA_VERSION,
  DEFAULT_DECK_ID,
  DEFAULT_HACKER_ID,
  EffectParams,
  GAME_VERSION,
  HEADLESS_HOST_ID,
  HEADLESS_SYSTEM_ID,
  INITIAL_HOST_ID,
  INITIAL_SYSTEM_ID,
  INVENTORY_SIZE,
  LineSliceParams,
  MIN_UPGRADE_ROWS,
  PORTFOLIO_SIZE,
  PlanOp,
  ResolvedContent,
  ResolvedDeck,
  ResolvedFunction,
  ResolvedHacker,
  ResolvedHost,
  ResolvedPassive,
  ResolvedProgram,
  ResolvedSystem,
  ResolvedUpgrade,
  SPECIALS_DESTROY,
  SYSTEM_BUILD_SIZE,
  ShakeParams,
  TARGETING_TARGETED,
  TransformParams,
} from './content';
import { Color, Shape, Side } from '../types';

// ---- diagnostics (§10.3) ----

export type DatasetName =
  | 'hacker-programs'
  | 'system-programs'
  | 'functions'
  | 'hackers'
  | 'passives' // Alpha 0.6.0 §5 — replaces the retired Hacker-only `skills`
  | 'decks'
  | 'systems' // Alpha 0.5.0 §5 — the seventh required runtime dataset
  | 'hosts' // Alpha 0.6.0 §7 — the eighth
  | 'upgrades' // Alpha 0.6.0 §8 — the ninth
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
  // Alpha 0.6.0 §5 — the shared PASSIVE dataset. It REPLACES the Alpha 0.3-0.5
  // `SKL` dataset outright; there is no second live Skill authority and no
  // compatibility alias for the retired header (§6).
  passives: DataFile;
  decks: DataFile;
  // Alpha 0.5.0 §0.2 — the seventh REQUIRED runtime dataset. It joins the same
  // manifest and the same pipeline rather than getting a parallel loader
  // (§3 — no second loading path).
  systems: DataFile;
  // Alpha 0.6.0 §0.2 — the eighth and ninth, on the same terms.
  hosts: DataFile;
  upgrades: DataFile;
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
// Alpha 0.5.0 §21 — `axisTarget`/`axisResult` are appended for
// EFFECT_TRANSFORM. Binding is by header NAME, so authored column order stays
// irrelevant and every other Effect simply leaves them blank.
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
  'axisTarget',
  'axisResult',
];
// §4.4/§4.5 — Alpha 0.4 activates PRG_SET on both identity datasets.
// Alpha 0.6.0 §6 — the passive-reference column on BOTH identity datasets is
// `PASSIVES`. The retired `SKILL` header is NOT accepted as an alias: a stale
// export fails the header check rather than being silently reinterpreted, on
// exactly the terms BASE_LINK/BASE_ICE established in Alpha 0.5.
const HACKER_HEADER = ['HAK_ID', 'name', 'BASE_LINK', 'STRONG_COLORS', 'STRONG_SHAPES', 'PRG_SET', 'PASSIVES', 'BIO', 'GRAPHICS'];
// Alpha 0.6.0 §5.1 — the PASSIVE schema. The agent-scope column is
// `agent_scope`: the supplied runtime data names it that, and §5.1's "one
// source-of-truth field" rule means it is NOT duplicated as `applies_to`.
const PASSIVE_HEADER = [
  'PASSIVE_ID',
  'passive_effect',
  'params',
  'activation',
  'function_payload',
  'agent_scope',
  'display',
  'notes',
];
const DECK_HEADER = ['DEK_ID', 'name', 'ADD_LINK', 'PRG_SET', 'FUNCTIONS', 'DESCRIPT', 'GRAPHICS'];
// Alpha 0.5.0 §5.1 — the System schema. The durability column is BASE_ICE, NOT
// BASE_LINK (§2.3): a stale export carrying BASE_LINK fails the header check
// rather than being silently aliased.
const SYSTEM_HEADER = [
  'SYS_ID', 'name', 'in_pool', 'BASE_ICE', 'STRONG_COLORS', 'STRONG_SHAPES', 'PRG_SET', 'PASSIVES', 'BIO', 'GRAPHICS',
];
// Alpha 0.6.0 §7/§8 — HOST and UPGRADE. HOST carries `in_pool`; UPGRADE does
// not, because UPGRADE eligibility is Run state (already acquired or not, §30.2)
// rather than authored content.
const HOST_HEADER = ['HOST_ID', 'name', 'passives', 'in_pool', 'display_text', 'graphics_ref', 'notes'];
const UPGRADE_HEADER = ['UPGRADE_ID', 'name', 'passives', 'display_text', 'graphics_ref', 'notes'];

// Required Alpha record IDs (their VALUES are validated by the schema/contract
// rules; per designer ruling the dataset is the final authority on the values).
const REQUIRED_FNC_IDS = [
  'FNC_001', 'FNC_002', 'FNC_003', 'FNC_004', 'FNC_005',
  'FNC_006', 'FNC_007', 'FNC_008', 'FNC_009', 'FNC_010',
  // Alpha 0.4.0 §4.7 — DATACUT and PLINK
  'FNC_011', 'FNC_012',
  // Alpha 0.5.0 §7 — COERCE, EBUFF, SPAM
  'FNC_013', 'FNC_014', 'FNC_015',
  // Alpha 0.6.0 §9 — GREENING and SNEAK, the PASSIVE carrier payloads
  'FNC_016', 'FNC_017',
];
// Alpha 0.4.0 — NINJA and WEASEL complete the six-Program inventory.
const REQUIRED_PRG_H_IDS = ['PRG_H_001', 'PRG_H_002', 'PRG_H_003', 'PRG_H_004', 'PRG_H_005', 'PRG_H_006'];
// Alpha 0.5.0 §7.1 — MUSCLE, ENHANCE, SPAMBOT, THROWER join the System roster.
// PRG_S_004 DISABLER remains required content even though neither authored
// System currently fields it (§6.2).
const REQUIRED_PRG_S_IDS = [
  'PRG_S_001', 'PRG_S_002', 'PRG_S_003', 'PRG_S_004',
  'PRG_S_005', 'PRG_S_006', 'PRG_S_007', 'PRG_S_008',
];
const REQUIRED_HAK_IDS = ['HAK_01'];
// Alpha 0.6.0 §5/§17/§18 — the migrated Hacker Red rows keep their behavior
// under new IDs; the rest are the authored HOST/UPGRADE passives.
const REQUIRED_PSV_IDS = [
  'PSV_001', 'PSV_002', 'PSV_003', 'PSV_004', 'PSV_005',
  'PSV_006', 'PSV_007', 'PSV_008', 'PSV_009',
];
const REQUIRED_DEK_IDS = ['DEK_01'];
// Alpha 0.5.0 §6 — BOUNCER and MIDNIGHT. Alpha 0.6.0 §9 adds DOORMAN, the
// fixed Battle 1 opponent.
const REQUIRED_SYS_IDS = ['SYS_01', 'SYS_02', 'SYS_03'];
// Alpha 0.6.0 §9 — THRESHOLD plus the four authored battlefields.
const REQUIRED_HST_IDS = ['HST_01', 'HST_02', 'HST_03', 'HST_04', 'HST_05'];
const REQUIRED_UPG_IDS = ['UPG_01', 'UPG_02', 'UPG_03', 'UPG_04'];

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
  axes: Record<EffectAxisName, string>; // Alpha 0.5.0 §21 raw axis-column text
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
  passiveIds: string[];
  bio: string;
  graphics: string;
}

interface PassiveRow {
  file: string;
  row: number;
  id: string;
  effectType: PassiveEffectId;
  activation: PassiveActivation;
  agentScope: AgentScope;
  color?: Color;
  allScope?: true;
  magnitude?: number;
  functionId?: string;
  display: string;
  displayTemplate: string;
  paramTokens: string[];
}

// Alpha 0.6.0 §7/§8 — HOST and UPGRADE rows share a shape: an ID, a name, an
// ordered PASSIVE list, and presentation placeholders. They stay separate row
// models (rather than one "passive bundle" type) because their runtime roles
// are different: a HOST is unowned environment, an UPGRADE is always
// Hacker-owned Run reward state (§12/§13).
interface HostRow {
  file: string;
  row: number;
  id: string;
  name: string;
  passiveIds: string[];
  inPool: boolean;
  displayText: string;
  graphics: string;
}

interface UpgradeRow {
  file: string;
  row: number;
  id: string;
  name: string;
  passiveIds: string[];
  displayText: string;
  graphics: string;
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

// Alpha 0.5.0 §5.2 — an authored System row.
interface SystemRow {
  file: string;
  row: number;
  id: string;
  name: string;
  baseIce: number;
  strongColors: Color[];
  strongShapes: Shape[];
  programs: string[]; // ordered PRG_SET — exactly SYSTEM_BUILD_SIZE PRG_S_* refs
  passiveIds: string[];
  inPool: boolean;
  bio: string;
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

  // Alpha 0.5.0 §5.2/§40 — a System's ordered active build: exactly
  // SYSTEM_BUILD_SIZE distinct valid PRG_S_* references. The PRG_S_ prefix
  // requirement is what rejects a Hacker Program smuggled into a System build;
  // authored order is gameplay-significant (charge routing) and is preserved.
  const parseSystemBuild = (raw: string, ctx: Ctx & { field: string }): string[] | null => {
    const ids = parseRefList(raw, 'PRG_S_', ctx, false);
    if (ids === null) return null;
    if (ids.length !== SYSTEM_BUILD_SIZE) {
      err({
        ...ctx,
        value: raw.trim(),
        expected: `exactly ${SYSTEM_BUILD_SIZE} PRG_S_* references`,
        reason: `PRG_SET must contain exactly ${SYSTEM_BUILD_SIZE} distinct System Programs`,
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

  // Alpha 0.6.0 (director spec 2026-08-11) — the random-pool flag shared by SYS
  // and HST. Blank and `y` include; `n` excludes. Case-insensitive because it is
  // a hand-authored spreadsheet flag, on the same reasoning as startCharged's
  // blank-tolerant contract.
  const readInPool = (raw: string, ctx: Ctx & { field: string }): boolean | null => {
    const t = raw.trim().toLowerCase();
    if (t === '' || t === 'y') return true;
    if (t === 'n') return false;
    err({ ...ctx, value: raw.trim(), expected: 'y|n|blank', reason: 'invalid in_pool token' });
    return null;
  };

  // §6/§7 — a reference list that may legitimately be EMPTY: the `PASSIVES`
  // column of a Hacker/System with no passives, and the `passives` column of a
  // zero-PASSIVE HOST such as THRESHOLD. Nonblank values validate exactly as
  // parseRefList does; only "blank is an error" differs.
  const parseOptionalRefList = (
    raw: string,
    prefix: string,
    ctx: Ctx & { field: string },
    allowDuplicates: boolean,
  ): string[] | null => (raw.trim() === '' ? [] : parseRefList(raw, prefix, ctx, allowDuplicates));

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
        // Alpha 0.6.0 (director ruling 2026-08-11) — cost 0 is legal so a
        // PASSIVE carrier payload can state its true cost. It is NOT legal on a
        // Function a Program or Deck fields: chargeCap equals cost (§11.1), so a
        // zero-cost assigned Function would hold no pool and fire free every
        // turn. That assignment check runs in the cross-reference phase below,
        // where the Program/Deck references are known.
        const cost = readInt(r.get('cost'), { ...ctx, field: 'cost' }, 0, 9999);
        const payloadRaw = r.get('payload').trim();
        if (!payloadRaw) err({ ...ctx, field: 'payload', reason: 'payload is required' });
        const startCharged = readStartCharged(r.get('startCharged'), ctx);
        if (name === null || cost === null || !payloadRaw || startCharged === null) continue;
        const params = {} as Record<EffectParamName, string>;
        for (const p of EFFECT_PARAM_NAMES) params[p] = r.get(p);
        const axes = {} as Record<EffectAxisName, string>;
        for (const a of EFFECT_AXIS_NAMES) axes[a] = r.get(a);
        functionRows.push({
          file: files.functions.name,
          row: r.line,
          id,
          name,
          cost,
          payloadRaw,
          notes: r.get('notes').trim(),
          params,
          axes,
          tupleRaw: r.get('params').trim(),
          startCharged,
        });
      }
    }
  }

  // ---- Phase 3/4 — parse PASSIVE dataset (Alpha 0.6.0 §5) ----
  //
  // Replaces the Alpha 0.3-0.5 Skill phase. Same shape — typed tuple validated
  // by the selected coded effect, display treated as presentation only — with
  // the activation, agent-scope, and payload contracts §52 adds.

  const passiveRows: PassiveRow[] = [];
  {
    const table = readTable(files.passives, 'passives', PASSIVE_HEADER);
    if (table) {
      for (const r of table.rows) {
        const id = r.get('PASSIVE_ID').trim();
        const ctx: Ctx = { dataset: 'passives', file: files.passives.name, row: r.line, id };
        if (!id) {
          err({ ...ctx, field: 'PASSIVE_ID', reason: 'PASSIVE_ID is required' });
          continue;
        }
        if (!id.startsWith('PSV_')) {
          err({ ...ctx, field: 'PASSIVE_ID', value: id, expected: 'PSV_*', reason: 'wrong PASSIVE ID prefix' });
          continue;
        }
        const effectRaw = r.get('passive_effect').trim();
        if (!isPassiveEffectId(effectRaw)) {
          err({ ...ctx, field: 'passive_effect', value: effectRaw, expected: passiveEffectIds().join('|'), reason: 'unknown PASSIVE effect type' });
          continue;
        }
        const contract = passiveContract(effectRaw)!;

        // §5.3 — the activation enum, and the effect/activation pairing. A
        // continual modifier authored START_OF_TURN (or the reverse) is a
        // content error, not a mode the runtime silently accommodates.
        const activationRaw = r.get('activation').trim();
        let activationOk = true;
        if (!isPassiveActivation(activationRaw)) {
          err({ ...ctx, field: 'activation', value: activationRaw, expected: 'CONTINUAL|START_OF_TURN', reason: 'unknown PASSIVE activation' });
          activationOk = false;
        } else if (activationRaw !== contract.activation) {
          err({ ...ctx, field: 'activation', value: activationRaw, expected: contract.activation, reason: `${effectRaw} only supports ${contract.activation}` });
          activationOk = false;
        }

        // §5.4 — agent scope. Required and validated for every row; §13 ignores
        // it for HOST-supplied instances at RUNTIME rather than blanking it
        // here, so a log can still report what the data actually said.
        const scopeRaw = r.get('agent_scope').trim();
        let scopeOk = true;
        if (!isAgentScope(scopeRaw)) {
          err({ ...ctx, field: 'agent_scope', value: scopeRaw, expected: 'OWNER|ENEMY', reason: 'unknown PASSIVE agent scope' });
          scopeOk = false;
        }

        // §5.5/§52 — the payload contract. CARRIER requires one FNC reference;
        // every continual effect forbids it.
        const payloadRaw = r.get('function_payload').trim();
        let payloadOk = true;
        let functionId: string | undefined;
        if (contract.payload === 'required') {
          if (!payloadRaw) {
            err({ ...ctx, field: 'function_payload', expected: 'FNC_*', reason: `${effectRaw} requires a Function payload` });
            payloadOk = false;
          } else if (!payloadRaw.startsWith('FNC_')) {
            err({ ...ctx, field: 'function_payload', value: payloadRaw, expected: 'FNC_*', reason: 'wrong Function ID prefix in PASSIVE payload' });
            payloadOk = false;
          } else if (payloadRaw.includes(':')) {
            err({ ...ctx, field: 'function_payload', value: payloadRaw, expected: 'exactly one FNC_* reference', reason: 'a PASSIVE payload names exactly one Function' });
            payloadOk = false;
          } else {
            functionId = payloadRaw;
          }
        } else if (payloadRaw) {
          err({ ...ctx, field: 'function_payload', value: payloadRaw, reason: `${effectRaw} does not take a Function payload` });
          payloadOk = false;
        }

        // Typed parameter tuple, validated by the selected passive_effect. An
        // empty contract tuple means the column must be BLANK.
        const paramsRaw = r.get('params').trim();
        const tokens = contract.params.length === 0 ? [] : paramsRaw.split(':').map((t) => t.trim());
        let tupleOk = true;
        let color: Color | undefined;
        let allScope: true | undefined;
        let magnitude: number | undefined;
        if (contract.params.length === 0) {
          if (paramsRaw !== '') {
            err({ ...ctx, field: 'params', value: paramsRaw, reason: `${effectRaw} takes no parameters` });
            tupleOk = false;
          }
        } else if (paramsRaw === '' || tokens.length !== contract.params.length) {
          err({
            ...ctx,
            field: 'params',
            value: paramsRaw,
            expected: contract.params.join(':'),
            reason: `PASSIVE params must have exactly ${contract.params.length} colon-delimited values`,
          });
          tupleOk = false;
        } else {
          contract.params.forEach((kind: PassiveParamKind, i) => {
            const tok = tokens[i];
            if (tok === '') {
              err({ ...ctx, field: 'params', value: paramsRaw, reason: 'blank token in PASSIVE params' });
              tupleOk = false;
              return;
            }
            if (kind === 'color') {
              // §9.1 — the canonical three-letter enum. A stale export spelling
              // YELLOW fails here rather than acquiring a one-off alias.
              if (!(tok in COLOR_TOKENS)) {
                err({ ...ctx, field: 'params', value: tok, expected: Object.keys(COLOR_TOKENS).join('|'), reason: 'unknown color enum value in PASSIVE params' });
                tupleOk = false;
                return;
              }
              color = COLOR_TOKENS[tok];
            } else if (kind === 'scope') {
              if (tok !== ALL_SCOPE_TOKEN) {
                err({ ...ctx, field: 'params', value: tok, expected: ALL_SCOPE_TOKEN, reason: 'unknown scope value in PASSIVE params' });
                tupleOk = false;
                return;
              }
              allScope = true;
            } else {
              const p = parseIntField(tok);
              if (!p.present || p.invalid || p.value === undefined || p.value < 1 || p.value > 999999) {
                err({ ...ctx, field: 'params', value: tok, expected: 'positive integer', reason: 'invalid magnitude in PASSIVE params' });
                tupleOk = false;
                return;
              }
              magnitude = p.value;
            }
          });
        }

        // §5.7 display: presentation ONLY, never gameplay authority. %N refers
        // to the zero-based ordered parsed parameter tokens; unsupported or
        // out-of-range placeholders are startup errors. Unlike a Skill row it
        // may be BLANK: a carrier with no display renders as its payload
        // Function's player-facing name, resolved below.
        const template = r.get('display').trim();
        let displayOk = true;
        for (const m of template.matchAll(/%(\d*)/g)) {
          if (m[1] === '') {
            err({ ...ctx, field: 'display', value: m[0], reason: 'unsupported PASSIVE display placeholder (expected %N)' });
            displayOk = false;
            continue;
          }
          const n = Number(m[1]);
          if (n >= contract.params.length) {
            err({
              ...ctx,
              field: 'display',
              value: m[0],
              expected: contract.params.length ? `%0-%${contract.params.length - 1}` : 'no placeholders',
              reason: 'PASSIVE display placeholder out of range',
            });
            displayOk = false;
          }
        }
        if (!tupleOk || !displayOk || !activationOk || !scopeOk || !payloadOk) continue;
        // Current enum tokens render in normal player-facing title case
        // (RED -> Red); scope and numeric tokens render as authored.
        const shown = contract.params.map((kind, i) => (kind === 'color' ? titleCase(tokens[i]) : tokens[i]));
        const display = template.replace(/%(\d+)/g, (_all, d: string) => shown[Number(d)]);
        passiveRows.push({
          file: files.passives.name,
          row: r.line,
          id,
          effectType: effectRaw,
          activation: activationRaw as PassiveActivation,
          agentScope: scopeRaw as AgentScope,
          color,
          allScope,
          magnitude,
          functionId,
          display,
          displayTemplate: template,
          paramTokens: tokens,
        });
      }
    }
  }

  // ---- Phase 3/4 — parse HOST dataset (Alpha 0.6.0 §7) ----

  const hostRows: HostRow[] = [];
  {
    const table = readTable(files.hosts, 'hosts', HOST_HEADER);
    if (table) {
      for (const r of table.rows) {
        const id = r.get('HOST_ID').trim();
        const ctx: Ctx = { dataset: 'hosts', file: files.hosts.name, row: r.line, id };
        if (!id) {
          err({ ...ctx, field: 'HOST_ID', reason: 'HOST_ID is required' });
          continue;
        }
        if (!id.startsWith('HST_')) {
          err({ ...ctx, field: 'HOST_ID', value: id, expected: 'HST_*', reason: 'wrong HOST ID prefix' });
          continue;
        }
        const name = checkName(r.get('name'), ctx);
        // §7 — zero PASSIVEs is VALID (THRESHOLD). Duplicates permitted on the
        // same terms as every other reference list: repeats stack (§11).
        const passiveIds = parseOptionalRefList(r.get('passives'), 'PSV_', { ...ctx, field: 'passives' }, true);
        const inPool = readInPool(r.get('in_pool'), { ...ctx, field: 'in_pool' });
        if (name === null || passiveIds === null || inPool === null) continue;
        hostRows.push({
          file: files.hosts.name,
          row: r.line,
          id,
          name,
          passiveIds,
          inPool,
          displayText: r.get('display_text').trim(),
          graphics: r.get('graphics_ref').trim(),
        });
      }
    }
  }

  // ---- Phase 3/4 — parse UPGRADE dataset (Alpha 0.6.0 §8) ----

  const upgradeRows: UpgradeRow[] = [];
  {
    const table = readTable(files.upgrades, 'upgrades', UPGRADE_HEADER);
    if (table) {
      for (const r of table.rows) {
        const id = r.get('UPGRADE_ID').trim();
        const ctx: Ctx = { dataset: 'upgrades', file: files.upgrades.name, row: r.line, id };
        if (!id) {
          err({ ...ctx, field: 'UPGRADE_ID', reason: 'UPGRADE_ID is required' });
          continue;
        }
        if (!id.startsWith('UPG_')) {
          err({ ...ctx, field: 'UPGRADE_ID', value: id, expected: 'UPG_*', reason: 'wrong UPGRADE ID prefix' });
          continue;
        }
        const name = checkName(r.get('name'), ctx);
        const passiveIds = parseOptionalRefList(r.get('passives'), 'PSV_', { ...ctx, field: 'passives' }, true);
        if (name === null || passiveIds === null) continue;
        // §8 — an UPGRADE that grants nothing is a reward the player cannot
        // perceive. Current content is meaningful, so a zero-PASSIVE row warns
        // rather than silently shipping as a blank card.
        if (passiveIds.length === 0) {
          warn({ ...ctx, field: 'passives', reason: 'UPGRADE grants no PASSIVEs — it will present as an empty reward' });
        }
        upgradeRows.push({
          file: files.upgrades.name,
          row: r.line,
          id,
          name,
          passiveIds,
          displayText: r.get('display_text').trim(),
          graphics: r.get('graphics_ref').trim(),
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
        // §6 — duplicates permitted: repeated qualifying PASSIVEs stack
        // additively, and zero PASSIVEs is a valid Hacker.
        const passiveIds = parseOptionalRefList(r.get('PASSIVES'), 'PSV_', { ...ctx, field: 'PASSIVES' }, true);
        if (name === null || baseLink === null || strongColors === null || strongShapes === null || portfolio === null || passiveIds === null) continue;
        hackerRows.push({
          file: files.hackers.name,
          row: r.line,
          id,
          name,
          baseLink,
          strongColors,
          strongShapes,
          portfolio,
          passiveIds,
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

  // ---- Phase 3/4 — parse System dataset (Alpha 0.5.0 §5) ----

  const systemRows: SystemRow[] = [];
  {
    const table = readTable(files.systems, 'systems', SYSTEM_HEADER);
    if (table) {
      for (const r of table.rows) {
        const id = r.get('SYS_ID').trim();
        const ctx: Ctx = { dataset: 'systems', file: files.systems.name, row: r.line, id };
        if (!id) {
          err({ ...ctx, field: 'SYS_ID', reason: 'SYS_ID is required' });
          continue;
        }
        if (!id.startsWith('SYS_')) {
          err({ ...ctx, field: 'SYS_ID', value: id, expected: 'SYS_*', reason: 'wrong System ID prefix' });
          continue;
        }
        const name = checkName(r.get('name'), ctx);
        // §5.2 — a positive integer base maximum ICE. Run escalation is applied
        // on top of this as an additive modifier (§10.1), never baked in here.
        const baseIce = readInt(r.get('BASE_ICE'), { ...ctx, field: 'BASE_ICE' }, 1, 9999);
        const strongColors = parseTokenList(r.get('STRONG_COLORS'), COLOR_TOKENS, { ...ctx, field: 'STRONG_COLORS' });
        const strongShapes = parseTokenList(r.get('STRONG_SHAPES'), SHAPE_TOKENS, { ...ctx, field: 'STRONG_SHAPES' });
        const programs = parseSystemBuild(r.get('PRG_SET'), { ...ctx, field: 'PRG_SET' });
        // Alpha 0.6.0 §6 — System PASSIVEs are LIVE. Through Alpha 0.5 a
        // nonblank value here blocked startup because nothing consumed it; the
        // shared PASSIVE layer now does, so it parses exactly like the Hacker's.
        const passiveIds = parseOptionalRefList(r.get('PASSIVES'), 'PSV_', { ...ctx, field: 'PASSIVES' }, true);
        const inPool = readInPool(r.get('in_pool'), { ...ctx, field: 'in_pool' });
        if (
          name === null || baseIce === null || strongColors === null || strongShapes === null ||
          programs === null || passiveIds === null || inPool === null
        ) {
          continue;
        }
        systemRows.push({
          file: files.systems.name,
          row: r.line,
          id,
          name,
          baseIce,
          strongColors,
          strongShapes,
          programs,
          passiveIds,
          inPool,
          // §5.2 placeholders: retained verbatim, never interpreted or displayed
          bio: r.get('BIO').trim(),
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
  const uniquePassives = passiveRows.filter((s) => claimId(s.id, { dataset: 'passives', file: s.file, row: s.row }));
  const uniqueHackers = hackerRows.filter((h) => claimId(h.id, { dataset: 'hackers', file: h.file, row: h.row }));
  const uniqueDecks = deckRows.filter((d) => claimId(d.id, { dataset: 'decks', file: d.file, row: d.row }));
  const uniqueSystems = systemRows.filter((s) => claimId(s.id, { dataset: 'systems', file: s.file, row: s.row }));
  const uniqueHosts = hostRows.filter((h) => claimId(h.id, { dataset: 'hosts', file: h.file, row: h.row }));
  const uniqueUpgrades = upgradeRows.filter((u) => claimId(u.id, { dataset: 'upgrades', file: u.file, row: u.row }));

  {
    // §4.2 — duplicate display names are valid but produce a startup warning.
    const names = new Map<string, { dataset: DatasetName; file: string; row: number; id: string }>();
    for (const rec of [
      ...uniquePrograms.map((p) => ({ name: p.name, dataset: p.dataset, file: p.file, row: p.row, id: p.id })),
      ...uniqueFunctions.map((f) => ({ name: f.name, dataset: 'functions' as const, file: f.file, row: f.row, id: f.id })),
      ...uniqueHackers.map((h) => ({ name: h.name, dataset: 'hackers' as const, file: h.file, row: h.row, id: h.id })),
      ...uniqueDecks.map((d) => ({ name: d.name, dataset: 'decks' as const, file: d.file, row: d.row, id: d.id })),
      ...uniqueSystems.map((s) => ({ name: s.name, dataset: 'systems' as const, file: s.file, row: s.row, id: s.id })),
      ...uniqueHosts.map((h) => ({ name: h.name, dataset: 'hosts' as const, file: h.file, row: h.row, id: h.id })),
      ...uniqueUpgrades.map((u) => ({ name: u.name, dataset: 'upgrades' as const, file: u.file, row: u.row, id: u.id })),
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
  const psvById = new Map(uniquePassives.map((s) => [s.id, s] as const));

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
        // Alpha 0.5.0 §2.5 — `quantity` is "up to this many valid targets", so
        // an authored maximum may legitimately exceed the board's cell count
        // (COERCE uses 99 to mean "every eligible Packet"). The old 1-64 bound
        // was the board size; 99 is an ORDINARY number here, never a sentinel,
        // and fewer targets simply means fewer deployments.
        const range: [number, number] =
          col === 'quantity' ? [1, 999] : col === 'countdown' ? [1, 9999] : [1, 999999];
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
        } else if (p.effectId === 'EFFECT_TRANSFORM') {
          out.transform = {
            targeting: vals[0],
            specialPacketTreatment: vals[1],
          } as TransformParams;
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

    // ---- Alpha 0.5.0 §22 — the Transform AXIS columns ----
    // Required columns are parsed into typed enum values here so runtime never
    // re-reads the authored strings; columns an Effect does not declare warn
    // when populated, exactly as unused discrete parameters do.
    {
      const declared = new Set<EffectAxisName>(contract.axes ?? []);
      for (const col of EFFECT_AXIS_NAMES) {
        const raw = f.axes[col].trim();
        if (!declared.has(col)) {
          if (raw) warn({ ...ctx, field: col, value: raw, reason: `populated parameter is unused by ${p.effectId}` });
          continue;
        }
        if (!raw) {
          err({ ...ctx, field: col, reason: `missing required parameter for ${p.effectId}` });
          ok = false;
          continue;
        }
        // Alpha 0.6.0 §24 — the shared axis grammar. One or two colon-joined
        // tokens; the colon is INTERSECTION. `NEU`/`ALL` are whole-Packet
        // tokens and never combine with an axis token.
        const tokens = raw.split(':').map((t) => t.trim());
        if (tokens.some((t) => t === '')) {
          err({ ...ctx, field: col, value: raw, reason: 'blank token in axis list' });
          ok = false;
          continue;
        }
        if (tokens.length > 2) {
          err({ ...ctx, field: col, value: raw, expected: '<AXIS> or <COLOR>:<SHAPE>', reason: 'an axis list holds at most one color and one shape' });
          ok = false;
          continue;
        }
        const whole = tokens.find((t) => t === AXIS_NEUTRAL || t === AXIS_ALL);
        if (whole !== undefined) {
          if (tokens.length !== 1) {
            err({ ...ctx, field: col, value: raw, expected: whole, reason: `${whole} selects whole Packets and cannot be combined with an axis` });
            ok = false;
            continue;
          }
          if (col === 'axisTarget') {
            out.axisTarget = { token: raw, kind: whole === AXIS_NEUTRAL ? 'NEU' : 'ALL' };
          } else {
            if (whole === AXIS_ALL) {
              err({ ...ctx, field: col, value: raw, expected: `${AXIS_NEUTRAL}|<COLOR>|<SHAPE>|<COLOR>:<SHAPE>`, reason: 'ALL is not a transform RESULT' });
              ok = false;
              continue;
            }
            out.axisResult = { token: raw, neutral: true };
          }
          continue;
        }
        // Axis-specific form: at most one color and at most one shape, each
        // recognized. Two tokens of the same kind (`RED:GRE`) are rejected —
        // there is deliberately no multi-value axis and no OR targeting.
        let color: Color | undefined;
        let shape: Shape | undefined;
        let axesOk = true;
        for (const t of tokens) {
          if (t in COLOR_TOKENS) {
            if (color !== undefined) {
              err({ ...ctx, field: col, value: raw, reason: 'an axis list holds at most one color' });
              axesOk = false;
              break;
            }
            color = COLOR_TOKENS[t];
          } else if (t in SHAPE_TOKENS) {
            if (shape !== undefined) {
              err({ ...ctx, field: col, value: raw, reason: 'an axis list holds at most one shape' });
              axesOk = false;
              break;
            }
            shape = SHAPE_TOKENS[t];
          } else {
            err({
              ...ctx,
              field: col,
              value: t,
              expected: [AXIS_NEUTRAL, ...(col === 'axisTarget' ? [AXIS_ALL] : []), ...Object.keys(COLOR_TOKENS), ...Object.keys(SHAPE_TOKENS)].join('|'),
              reason: 'unknown axis token',
            });
            axesOk = false;
            break;
          }
        }
        if (!axesOk) {
          ok = false;
          continue;
        }
        if (col === 'axisTarget') out.axisTarget = { token: raw, kind: 'AXIS', color, shape } as AxisTarget;
        else out.axisResult = { token: raw, color, shape } as AxisResult;
      }

      // §24 (director ruling 2026-08-11) — a row whose target constraints are
      // exactly its result is DEAD: every Packet it could reach already matches
      // every result axis, so the exclusion rule leaves no valid target at any
      // tier. Caught statically rather than presenting as a Function that
      // silently never resolves.
      const at = out.axisTarget;
      const ar = out.axisResult;
      if (at && ar) {
        const sameNeutral = at.kind === 'NEU' && ar.neutral === true;
        const sameAxes =
          at.kind === 'AXIS' &&
          !ar.neutral &&
          at.color === ar.color &&
          at.shape === ar.shape;
        if (sameNeutral || sameAxes) {
          err({
            ...ctx,
            field: 'axisResult',
            value: ar.token,
            expected: `anything but ${at.token}`,
            reason: 'axisTarget and axisResult are identical — this Function can never have a valid target',
          });
          ok = false;
        }
        // A neutral RESULT cannot carry an overlay, so `retain all`/`retain own`
        // cannot be honored. Warn rather than block (director ruling
        // 2026-08-11): runtime destroys the overlay either way.
        if (ar.neutral && (out.transform?.specialPacketTreatment ?? SPECIALS_DESTROY) !== SPECIALS_DESTROY) {
          warn({
            ...ctx,
            field: 'params',
            value: f.tupleRaw,
            reason: 'a neutral axisResult always destroys special overlays — specialPacketTreatment retention cannot be honored',
          });
        }
      }
    }

    // §12.3 — a PLAYER-TARGETED configuration deploys exactly once. Quantity
    // above one would mean accumulating several player-chosen targets, which
    // is deferred multi-target behavior and explicitly out of scope (§22).
    // Random targeting may still deploy more than once.
    // Alpha 0.5.0 §23.1 — EFFECT_TRANSFORM joins the same rule through the
    // same check rather than getting its own targeted-quantity validation.
    const targeting = out.bomb?.targeting ?? out.line?.targeting ?? out.transform?.targeting;
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
  // Alpha 0.6.0 §6/§7/§8/§52 — PASSIVE references from every source kind
  // resolve through the SAME check. An unknown PSV_* is a startup error, never
  // an ignored reference.
  const checkPassiveRefs = (
    ids: readonly string[],
    ctx: { dataset: DatasetName; file: string; row: number; id: string },
    field: string,
  ): void => {
    for (const pid of ids) {
      if (!psvById.has(pid)) {
        err({ ...ctx, field, value: pid, reason: 'reference to unknown PASSIVE ID' });
      }
    }
  };
  for (const h of uniqueHackers) {
    checkPassiveRefs(h.passiveIds, { dataset: 'hackers', file: h.file, row: h.row, id: h.id }, 'PASSIVES');
  }
  for (const s of uniqueSystems) {
    checkPassiveRefs(s.passiveIds, { dataset: 'systems', file: s.file, row: s.row, id: s.id }, 'PASSIVES');
  }
  for (const h of uniqueHosts) {
    checkPassiveRefs(h.passiveIds, { dataset: 'hosts', file: h.file, row: h.row, id: h.id }, 'passives');
  }
  for (const u of uniqueUpgrades) {
    checkPassiveRefs(u.passiveIds, { dataset: 'upgrades', file: u.file, row: u.row, id: u.id }, 'passives');
  }
  // §5.5/§52 — a carrier's payload Function must resolve. Its EXECUTABILITY
  // under the noninteractive turn-start trigger is checked below, once payload
  // plans are known.
  for (const s of uniquePassives) {
    if (s.functionId && !fnById.has(s.functionId)) {
      err({ dataset: 'passives', file: s.file, row: s.row, id: s.id, field: 'function_payload', value: s.functionId, reason: 'reference to unknown Function ID' });
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

  // Alpha 0.5.0 §40 — a System's PRG_SET must resolve to LOADED System
  // Programs. The prefix check already rejected PRG_H_* references; this
  // catches a well-formed PRG_S_* ID that no row defines.
  const systemProgramIds = new Set(uniquePrograms.filter((p) => p.dataset === 'system-programs').map((p) => p.id));
  for (const s of uniqueSystems) {
    for (const pid of s.programs) {
      if (!systemProgramIds.has(pid)) {
        err({
          dataset: 'systems',
          file: s.file,
          row: s.row,
          id: s.id,
          field: 'PRG_SET',
          value: pid,
          expected: 'a loaded PRG_S_* Program',
          reason: 'PRG_SET references an unknown System Program ID',
        });
      }
    }
  }

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
    const targeting = params.bomb?.targeting ?? params.line?.targeting ?? params.transform?.targeting;
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
  requireIds(REQUIRED_PSV_IDS, (id) => psvById.has(id), 'passives', files.passives.name);
  requireIds(REQUIRED_DEK_IDS, (id) => dekIds.has(id), 'decks', files.decks.name);
  const sysIds = new Set(uniqueSystems.map((s) => s.id));
  requireIds(REQUIRED_SYS_IDS, (id) => sysIds.has(id), 'systems', files.systems.name);
  const hstIds = new Set(uniqueHosts.map((h) => h.id));
  const upgIds = new Set(uniqueUpgrades.map((u) => u.id));
  requireIds(REQUIRED_HST_IDS, (id) => hstIds.has(id), 'hosts', files.hosts.name);
  requireIds(REQUIRED_UPG_IDS, (id) => upgIds.has(id), 'upgrades', files.upgrades.name);

  // §11.1/§41 — random encounter selection samples the loaded catalog, so an
  // EMPTY catalog is not a playable state and must not be papered over with a
  // synthesized default System.
  if (uniqueSystems.length === 0) {
    err({ dataset: 'systems', file: files.systems.name, reason: 'at least one valid System is required' });
  }
  if (uniqueHosts.length === 0) {
    err({ dataset: 'hosts', file: files.hosts.name, reason: 'at least one valid HOST is required' });
  }
  // §8 — the four-UPGRADE / four-decision exhaustion case (§31) is deliberate
  // content, so a short pool is a blocking error rather than a Run that quietly
  // stops offering rewards.
  if (uniqueUpgrades.length < MIN_UPGRADE_ROWS) {
    err({
      dataset: 'upgrades',
      file: files.upgrades.name,
      expected: `at least ${MIN_UPGRADE_ROWS}`,
      value: String(uniqueUpgrades.length),
      reason: 'too few valid UPGRADE rows for a Run',
    });
  }
  // Director spec (2026-08-11) — random route generation draws from the
  // in_pool subsets. Excluding every row would leave a Path Choice screen with
  // nothing to offer, which is a content error, not a runtime surprise.
  if (uniqueSystems.length > 0 && !uniqueSystems.some((s) => s.inPool)) {
    err({ dataset: 'systems', file: files.systems.name, field: 'in_pool', reason: 'every System is excluded from the random pool' });
  }
  if (uniqueHosts.length > 0 && !uniqueHosts.some((h) => h.inPool)) {
    err({ dataset: 'hosts', file: files.hosts.name, field: 'in_pool', reason: 'every HOST is excluded from the random pool' });
  }
  // The headless harness pins one System and one HOST (§44); a missing pin is a
  // content error rather than a silent fall back to whatever row is first.
  if (uniqueSystems.length > 0 && !sysIds.has(HEADLESS_SYSTEM_ID)) {
    err({ dataset: 'content', file: files.systems.name, id: HEADLESS_SYSTEM_ID, reason: `HEADLESS_SYSTEM_ID ${HEADLESS_SYSTEM_ID} is not a valid loaded System` });
  }
  if (uniqueHosts.length > 0 && !hstIds.has(HEADLESS_HOST_ID)) {
    err({ dataset: 'content', file: files.hosts.name, id: HEADLESS_HOST_ID, reason: `HEADLESS_HOST_ID ${HEADLESS_HOST_ID} is not a valid loaded HOST` });
  }
  // §29 — Battle 1's fixed encounter identity. Named constants, so a content
  // change that removes DOORMAN or THRESHOLD fails at startup rather than at
  // the first Path Choice.
  if (uniqueSystems.length > 0 && !sysIds.has(INITIAL_SYSTEM_ID)) {
    err({ dataset: 'content', file: files.systems.name, id: INITIAL_SYSTEM_ID, reason: `INITIAL_SYSTEM_ID ${INITIAL_SYSTEM_ID} is not a valid loaded System` });
  }
  if (uniqueHosts.length > 0 && !hstIds.has(INITIAL_HOST_ID)) {
    err({ dataset: 'content', file: files.hosts.name, id: INITIAL_HOST_ID, reason: `INITIAL_HOST_ID ${INITIAL_HOST_ID} is not a valid loaded HOST` });
  }

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
    // Alpha 0.6.0 §23 — a PASSIVE carrier payload is a real reference: it is
    // exactly how GREENING and SNEAK reach the board.
    for (const s of uniquePassives) if (s.functionId) referencedFns.add(s.functionId);
    for (const [id, payload] of payloads) {
      if (payload.kind === 'composite' && referencedFns.has(id)) {
        for (const child of payload.children!) referencedFns.add(child);
      }
    }
    // A composite that is itself referenced propagates to its children above;
    // children of an unreferenced composite stay unreferenced with it.
    for (const f of uniqueFunctions) {
      if (!referencedFns.has(f.id)) {
        warn({ dataset: 'functions', file: f.file, row: f.row, id: f.id, reason: 'valid Function row is not referenced by any Program, Deck, composite payload, or PASSIVE' });
      }
    }
    // Alpha 0.6.0 — a PASSIVE row is referenced when ANY source kind cites it.
    const referencedPassives = new Set<string>();
    for (const h of uniqueHackers) for (const pid of h.passiveIds) referencedPassives.add(pid);
    for (const s of uniqueSystems) for (const pid of s.passiveIds) referencedPassives.add(pid);
    for (const h of uniqueHosts) for (const pid of h.passiveIds) referencedPassives.add(pid);
    for (const u of uniqueUpgrades) for (const pid of u.passiveIds) referencedPassives.add(pid);
    for (const s of uniquePassives) {
      if (!referencedPassives.has(s.id)) {
        warn({ dataset: 'passives', file: s.file, row: s.row, id: s.id, reason: 'valid PASSIVE row is not referenced by any Hacker, System, HOST, or UPGRADE' });
      }
    }
    // Alpha 0.5.0 §5.4 — SYS.PRG_SET is now the only thing that puts a System
    // Program into play, so a System Program no authored System fields is dead
    // content. It WARNS rather than failing (it is valid, just unused), which
    // is how PRG_S_004 DISABLER currently surfaces: neither BOUNCER nor
    // MIDNIGHT fields it, so the System never Drains in Alpha 0.5 (§6.2).
    const referencedSystemPrograms = new Set<string>();
    for (const s of uniqueSystems) for (const pid of s.programs) referencedSystemPrograms.add(pid);
    for (const p of uniquePrograms) {
      if (p.dataset !== 'system-programs') continue;
      if (!referencedSystemPrograms.has(p.id)) {
        warn({ dataset: p.dataset, file: p.file, row: p.row, id: p.id, reason: 'valid System Program row is not fielded by any System PRG_SET' });
      }
    }
  }

  // ---- Alpha 0.6.0 — zero-cost Functions and carrier executability ----
  //
  // Director ruling (2026-08-11): cost 0 exists so a PASSIVE carrier payload can
  // state its true cost. A Program's or Deck's charge pool capacity IS its
  // Function's cost (§11.1), so a zero-cost DIRECTLY ASSIGNED Function would
  // hold no pool and fire every turn for free. That is a blocking content
  // error. Reachability as a composite child or a PASSIVE payload is fine:
  // neither pays a cost anyway (§7.2/§16).
  {
    const directlyAssigned = new Map<string, string>(); // FNC_ID -> owning record
    for (const p of uniquePrograms) if (!directlyAssigned.has(p.functionId)) directlyAssigned.set(p.functionId, p.id);
    for (const d of uniqueDecks) if (!directlyAssigned.has(d.functionId)) directlyAssigned.set(d.functionId, d.id);
    for (const f of uniqueFunctions) {
      if (f.cost > 0) continue;
      const owner = directlyAssigned.get(f.id);
      if (owner !== undefined) {
        err({
          dataset: 'functions',
          file: f.file,
          row: f.row,
          id: f.id,
          field: 'cost',
          value: '0',
          expected: 'a positive cost for a Program- or Deck-assigned Function',
          reason: `zero-cost Function is directly assigned to ${owner} — its charge pool would have no capacity`,
        });
      }
    }
  }
  // §5.6/§52 — a START_OF_TURN payload must be executable with NO player
  // target selection: the trigger fires inside turn setup, and Alpha 0.6 does
  // not introduce an asynchronous start-of-turn targeting flow. A carrier whose
  // resolved plan needs a manual target is unsupported content, reported rather
  // than silently auto-resolved.
  for (const s of uniquePassives) {
    if (!s.functionId) continue;
    const plan = plans.get(s.functionId);
    if (!plan) continue; // unresolved payload already reported
    const manual = plan.find((op) => op.target !== null);
    if (manual) {
      err({
        dataset: 'passives',
        file: s.file,
        row: s.row,
        id: s.id,
        field: 'function_payload',
        value: s.functionId,
        reason: `${s.functionId} requires manual ${manual.target} target selection and cannot run as a START_OF_TURN payload`,
      });
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

  const passives = new Map<string, ResolvedPassive>();
  for (const s of uniquePassives) {
    passives.set(s.id, {
      id: s.id,
      effectType: s.effectType,
      activation: s.activation,
      agentScope: s.agentScope,
      color: s.color,
      allScope: s.allScope,
      magnitude: s.magnitude,
      functionId: s.functionId,
      // §5.7 — a carrier with a blank authored display identifies itself by its
      // payload Function's player-facing name. Deliberately NOT prose
      // synthesized from `notes`, which is non-normative and never player copy.
      display: s.display || (s.functionId ? functions.get(s.functionId)?.name ?? s.functionId : ''),
      displayTemplate: s.displayTemplate,
      paramTokens: s.paramTokens,
    });
  }

  const resolvePassiveRefs = (ids: readonly string[]): ResolvedPassive[] => ids.map((pid) => passives.get(pid)!);

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
      passiveIds: h.passiveIds,
      passives: resolvePassiveRefs(h.passiveIds),
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

  // Alpha 0.5.0 §5.3 — weak sets are calculated complements over the
  // recognized enum vocabularies, exactly as the Hacker's are. Each System has
  // its own independent profile; nothing here consults the Hacker (§2.4).
  const systems = new Map<string, ResolvedSystem>();
  for (const s of uniqueSystems) {
    systems.set(s.id, {
      id: s.id,
      name: s.name,
      baseIce: s.baseIce,
      strongColors: s.strongColors,
      weakColors: RECOGNIZED_COLORS.filter((c) => !s.strongColors.includes(c)),
      strongShapes: s.strongShapes,
      weakShapes: RECOGNIZED_SHAPES.filter((sh) => !s.strongShapes.includes(sh)),
      programIds: s.programs,
      passiveIds: s.passiveIds,
      passives: resolvePassiveRefs(s.passiveIds),
      inPool: s.inPool,
      bio: s.bio,
      graphics: s.graphics,
    });
  }

  const hosts = new Map<string, ResolvedHost>();
  for (const h of uniqueHosts) {
    hosts.set(h.id, {
      id: h.id,
      name: h.name,
      passiveIds: h.passiveIds,
      passives: resolvePassiveRefs(h.passiveIds),
      inPool: h.inPool,
      displayText: h.displayText,
      graphics: h.graphics,
    });
  }

  const upgrades = new Map<string, ResolvedUpgrade>();
  for (const u of uniqueUpgrades) {
    upgrades.set(u.id, {
      id: u.id,
      name: u.name,
      passiveIds: u.passiveIds,
      passives: resolvePassiveRefs(u.passiveIds),
      displayText: u.displayText,
      graphics: u.graphics,
    });
  }

  const fingerprint = computeFingerprint(hacker, system, functions, hackers, passives, decks, systems, hosts, upgrades);
  const content: ResolvedContent = {
    gameVersion: GAME_VERSION,
    schemaVersion: DATA_SCHEMA_VERSION,
    fingerprint,
    hacker,
    system,
    functions,
    programsById,
    hackers,
    passives,
    decks,
    systems,
    hosts,
    upgrades,
    hackerOrder: uniqueHackers.map((h) => h.id),
    deckOrder: uniqueDecks.map((d) => d.id),
    systemOrder: uniqueSystems.map((s) => s.id),
    hostOrder: uniqueHosts.map((h) => h.id),
    upgradeOrder: uniqueUpgrades.map((u) => u.id),
  };
  return { content, issues, errors, warnings };
}

// §4.10 / Alpha 0.6.0 §10 — normalized gameplay-content fingerprint. Includes
// gameplay-affecting values from ALL NINE required datasets: program
// IDs/side/bindings/function refs, function IDs/costs/ordered payload
// plans/validated parameters/startCharged, the named area-pattern registry and
// its progression order, Hacker LINK and strong sets and ordered PASSIVE refs,
// PASSIVE effect types/typed parameters/activation/scope/payload, Deck added
// LINK and Function references, System base ICE, authored strong sets, ordered
// PRG_SET, PASSIVE refs and pool flag, and HOST/UPGRADE PASSIVE refs and pool
// flag. EXCLUDES notes, display names, BIO, GRAPHICS, DESCRIPT, HOST/UPGRADE
// display_text and graphics_ref, presentational PASSIVE display text, derived
// weak sets, and CSV formatting — so fixing flavor copy never invalidates a
// save (§10).
function computeFingerprint(
  hacker: ResolvedProgram[],
  system: ResolvedProgram[],
  functions: Map<string, ResolvedFunction>,
  hackers: Map<string, ResolvedHacker>,
  passives: Map<string, ResolvedPassive>,
  decks: Map<string, ResolvedDeck>,
  systems: Map<string, ResolvedSystem>,
  hosts: Map<string, ResolvedHost>,
  upgrades: Map<string, ResolvedUpgrade>,
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
        // Alpha 0.5.0 §8 — the Transform tuple and its RESOLVED axes are
        // gameplay-affecting: changing the result color/shape changes what the
        // Effect does, so it must change the fingerprint.
        xf: op.params.transform ? [op.params.transform.targeting, op.params.transform.specialPacketTreatment] : null,
        at: op.params.axisTarget ?? null,
        ar: op.params.axisResult ? [op.params.axisResult.color, op.params.axisResult.shape] : null,
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
    psv: [...h.passiveIds],
    prg: [...h.portfolioProgramIds],
  }));
  // Alpha 0.6.0 §10 — PASSIVE gameplay identity: the coded effect, the typed
  // parameters, the activation, the agent scope where it is semantically used,
  // and the payload reference. Display text and notes are presentation and are
  // excluded, so fixing a typo never invalidates a save.
  const psvNorm = byId(passives).map((s) => ({
    id: s.id,
    effect: s.effectType,
    act: s.activation,
    scope: s.agentScope,
    color: s.color ?? null,
    all: s.allScope ?? null,
    mag: s.magnitude ?? null,
    fn: s.functionId ?? null,
  }));
  const dekNorm = byId(decks).map((d) => ({ id: d.id, add: d.addLink, fn: d.functionId, prg: [...d.portfolioProgramIds] }));
  // Alpha 0.5.0 §8 — System gameplay identity. Base ICE, the authored strong
  // sets, and the ORDERED Program build all change how a battle plays, so all
  // three are fingerprint input; PRG_SET order matters because it is charge-
  // routing priority. BIO and GRAPHICS are presentation-only and excluded,
  // exactly as the Hacker's placeholders are. Weak sets are derived from the
  // strong sets, so fingerprinting them too would be duplicate authority.
  const sysNorm = byId(systems).map((s) => ({
    id: s.id,
    ice: s.baseIce,
    sc: [...s.strongColors],
    ss: [...s.strongShapes],
    prg: [...s.programIds],
    psv: [...s.passiveIds],
    pool: s.inPool,
  }));
  // §10 — HOST and UPGRADE contribute their ordered PASSIVE references and,
  // for HOST, the random-pool flag: all three change how a Run plays and are
  // needed to revalidate persisted route state. `display_text`, `graphics_ref`,
  // and `notes` are presentation and excluded.
  const hstNorm = byId(hosts).map((h) => ({ id: h.id, psv: [...h.passiveIds], pool: h.inPool }));
  const upgNorm = byId(upgrades).map((u) => ({ id: u.id, psv: [...u.passiveIds] }));
  // Alpha 0.6.0 §22 — PSV_BIGGER_BOMB can advance an authored Bomb into ANY
  // larger registered pattern, so the whole ordered registry is fingerprint
  // input now, not just the patterns the FNC rows name directly.
  for (const id of AREA_PATTERN_ORDER) usedAreas.add(id);
  const areas = [...usedAreas].sort().map((id) => ({ id, cells: AREA_PATTERNS[id as keyof typeof AREA_PATTERNS] }));
  const canonical = JSON.stringify({
    schema: DATA_SCHEMA_VERSION,
    hacker: progNorm(hacker),
    system: progNorm(system),
    functions: fnNorm,
    areas,
    areaOrder: [...AREA_PATTERN_ORDER],
    hackers: hakNorm,
    passives: psvNorm,
    decks: dekNorm,
    systems: sysNorm,
    hosts: hstNorm,
    upgrades: upgNorm,
  });
  let h = 5381;
  for (let i = 0; i < canonical.length; i++) h = ((h << 5) + h + canonical.charCodeAt(i)) >>> 0;
  return `${h.toString(16).padStart(8, '0')}-${canonical.length.toString(36)}`;
}
