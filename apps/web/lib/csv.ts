// Spreadsheet applications evaluate a cell as a formula when its text starts
// with one of these, so a stored value like `=cmd|'/c calc'!A0` becomes code
// the moment someone opens the export. CSV quoting does not help: quotes are
// the file format's own string delimiter and are stripped before the cell is
// interpreted.
const FORMULA_LEAD = /^[=+\-@\t\r]/;

// A leading `-` is far more often a negative number than an attack, and
// prefixing those would turn every one of them into text in the opened sheet.
// A value that parses as a plain number cannot carry a formula, so it is left
// alone; `-2+3+cmd|'/c calc'!A0` does not parse as one and is still guarded.
const PLAIN_NUMBER = /^-?\d+(?:[.,]\d+)?$/;

export function escapeCsvCell(value: string): string {
  const guarded =
    FORMULA_LEAD.test(value) && !PLAIN_NUMBER.test(value) ? `'${value}` : value;

  return `"${guarded.replaceAll('"', '""')}"`;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}
