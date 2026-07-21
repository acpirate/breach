// Alpha 0.1.0 §5.3 — NODE/headless file-acquisition adapter. Reads the same
// CSV resources the browser bundles, from data/, and feeds them to the SAME
// shared parse/validate/resolve pipeline. On any validation error: print the
// complete structured report through the diagnostic path and exit nonzero
// (§10.4) — never continue with partial or hardcoded content.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setActiveContent } from '../src/logic/data/content';
import { DataFiles, LoadResult, formatIssue, loadContent } from '../src/logic/data/load';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

const FILES = {
  hacker: 'breach datastructures - PRG_H.csv',
  system: 'breach datastructures - PRG_S.csv',
  functions: 'breach datastructures - FNC.csv',
} as const;

export function nodeDataFiles(): DataFiles {
  const read = (name: string): { name: string; text: string } => ({
    name,
    text: fs.readFileSync(path.join(dataDir, name), 'utf8'),
  });
  return {
    hacker: read(FILES.hacker),
    system: read(FILES.system),
    functions: read(FILES.functions),
  };
}

export function loadNodeContent(): LoadResult {
  return loadContent(nodeDataFiles());
}

// Standard headless startup: load, validate, install — or report and exit(1).
export function initContentOrExit(): void {
  const result = loadNodeContent();
  for (const issue of result.issues) {
    (issue.severity === 'error' ? console.error : console.warn)(formatIssue(issue));
  }
  if (!result.content) {
    console.error(`DATA VALIDATION FAILED: ${result.errors} error(s), ${result.warnings} warning(s) — aborting`);
    process.exit(1);
  }
  setActiveContent(result.content);
}
