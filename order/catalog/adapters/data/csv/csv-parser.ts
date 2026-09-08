import { ProductCatalogError } from '../../../core/errors.js';

export type CsvRow = Record<string, string>;

export function parseCsv(text: string, expectedHeaders: readonly string[]): CsvRow[] {
  const rows = parseRows(text);
  if (rows.length === 0) {
    throw new ProductCatalogError('CSV header is missing', 'CSV_CORRUPTED');
  }
  const headers = rows[0] ?? [];
  if (headers.length !== expectedHeaders.length || headers.some((header, index) => header !== expectedHeaders[index])) {
    throw new ProductCatalogError('CSV header does not match schema', 'CSV_CORRUPTED', {
      expectedHeaders: expectedHeaders.join(','),
      actualHeaders: headers.join(','),
    });
  }

  return rows.slice(1).filter((row) => row.some((cell) => cell !== '')).map((row) => {
    if (row.length !== headers.length) {
      throw new ProductCatalogError('CSV row column count does not match header', 'CSV_CORRUPTED');
    }
    return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? '']));
  });
}

export function serializeCsv(headers: readonly string[], rows: readonly CsvRow[]): string {
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header] ?? '')).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      if (cell.length > 0) {
        throw new ProductCatalogError('Malformed CSV quote', 'CSV_CORRUPTED');
      }
      inQuotes = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }

  if (inQuotes) {
    throw new ProductCatalogError('Unclosed CSV quote', 'CSV_CORRUPTED');
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

function escapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
