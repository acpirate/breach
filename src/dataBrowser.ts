// Alpha 0.1.0 §5.3 — BROWSER file-acquisition adapter. The CSV datasets are
// packaged as application resources via Vite `?raw` imports (bundled at build
// time, served in dev); the shared pure-TypeScript pipeline (logic/data/load)
// receives the same raw text Node reads from disk. Loaded once at startup —
// no reload or hot-swap during a session; data changes require a full
// application reload.

import fncText from '../data/breach datastructures - FNC.csv?raw';
import hackerText from '../data/breach datastructures - PRG_H.csv?raw';
import systemText from '../data/breach datastructures - PRG_S.csv?raw';
import { DataFiles } from './logic/data/load';

// The manifest: each dataset's ROLE is declared here and independently
// cross-checked by ID prefixes during validation (§6).
export function browserDataFiles(): DataFiles {
  return {
    hacker: { name: 'breach datastructures - PRG_H.csv', text: hackerText },
    system: { name: 'breach datastructures - PRG_S.csv', text: systemText },
    functions: { name: 'breach datastructures - FNC.csv', text: fncText },
  };
}
