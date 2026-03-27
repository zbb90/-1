import { readFile } from "node:fs/promises";

function parseCsvLine(content: string): string[][] {
  const rows: string[][] = [];
  let currentField = "";
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentField += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }

      currentRow.push(currentField);
      if (currentRow.some((field) => field.length > 0)) {
        rows.push(currentRow);
      }
      currentField = "";
      currentRow = [];
      continue;
    }

    currentField += char;
  }

  currentRow.push(currentField);
  if (currentRow.some((field) => field.length > 0)) {
    rows.push(currentRow);
  }

  return rows;
}

export async function readCsvAsObjects<T extends object>(
  filePath: string,
): Promise<T[]> {
  const raw = await readFile(filePath, "utf-8");
  const normalized = raw.replace(/^\uFEFF/, "");
  const rows = parseCsvLine(normalized);

  if (rows.length <= 1) {
    return [];
  }

  const headers = rows[0];
  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = row[index] ?? "";
    });
    return record as T;
  });
}
