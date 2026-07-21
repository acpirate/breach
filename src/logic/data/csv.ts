// Minimal, correct CSV parser for the Alpha 0.1.0 datasets. Handles quoted
// fields (embedded commas/newlines), doubled-quote escapes, CRLF/LF, a UTF-8
// BOM, and trailing blank lines. No dependency — three small files do not
// justify a framework (per the Alpha 0.1.0 inspection guidance).

export interface CsvRow {
  line: number; // 1-based source line the row STARTS on
  fields: string[];
}

export interface CsvParseResult {
  rows: CsvRow[]; // includes the header row (rows[0]) when present
  error?: string; // structural failure (unterminated quote)
}

export function parseCsv(text: string): CsvParseResult {
  let src = text;
  if (src.charCodeAt(0) === 0xfeff) src = src.slice(1); // BOM

  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowStartLine = 1;
  let anything = false; // current row has any content (chars or delimiters)

  const endField = (): void => {
    fields.push(field);
    field = '';
  };
  const endRow = (): void => {
    endField();
    // Skip rows that are entirely empty (a lone newline / trailing EOL).
    if (fields.length > 1 || fields[0] !== '') rows.push({ line: rowStartLine, fields });
    fields = [];
    anything = false;
  };

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      anything = true;
    } else if (c === ',') {
      endField();
      anything = true;
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      if (anything || field !== '' || fields.length) endRow();
      line++;
      rowStartLine = line;
    } else {
      field += c;
      anything = true;
    }
  }
  if (inQuotes) return { rows, error: `unterminated quoted field starting near line ${rowStartLine}` };
  if (anything || field !== '' || fields.length) endRow();
  return { rows };
}
