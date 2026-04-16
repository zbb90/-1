import * as XLSX from "xlsx";
import type {
  AuditClause,
  ConsensusEntry,
  ParsedAuditWorkbook,
  ParsedConsensusWorkbook,
} from "@/lib/audit-match-types";

function normalizeCell(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\r/g, "").trim();
}

function joinText(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => part?.trim() || "")
    .filter(Boolean)
    .join(" ");
}

function stripHtml(value: string) {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isStructureRow(level: string) {
  return /^(类别|章节)$/i.test(level.trim());
}

function toWorkbook(buffer: ArrayBuffer) {
  return XLSX.read(buffer, {
    type: "array",
    cellDates: false,
    dense: true,
  });
}

function rowsToObjects(headers: string[], rows: unknown[][]) {
  return rows.map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = normalizeCell(cells[index]);
    });
    return row;
  });
}

export function parseAuditWorkbook(buffer: ArrayBuffer): ParsedAuditWorkbook {
  const workbook = toWorkbook(buffer);
  const warnings: string[] = [];
  const sheetNames = workbook.SheetNames;
  const sheetName = sheetNames[0];
  if (!sheetName) {
    return { sheetNames: [], clauses: [], warnings: ["未找到稽核表 Sheet。"] };
  }

  const sheet = workbook.Sheets[sheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  const headerRow = matrix[1]?.map(normalizeCell) ?? [];
  if (!headerRow.length) {
    return {
      sheetNames,
      clauses: [],
      warnings: ["稽核表表头读取失败，预期第 2 行为真实表头。"],
    };
  }

  const rawRows = rowsToObjects(headerRow, matrix.slice(2));
  const clauses: AuditClause[] = rawRows
    .map((row, index) => {
      const auditId = normalizeCell(row.ID);
      const clauseTitle = normalizeCell(row.标准条文);
      const level = normalizeCell(row.分级说明);
      if (!auditId || !clauseTitle || isStructureRow(level)) {
        return null;
      }

      return {
        key: `audit:${auditId}:${index + 3}`,
        rowIndex: index + 3,
        auditId,
        dimension: normalizeCell(row.维度),
        level,
        score: parseNumber(normalizeCell(row.分值)),
        clauseTitle,
        clauseDetail: clauseTitle,
        searchText: joinText([
          normalizeCell(row.维度),
          level,
          auditId,
          clauseTitle,
          normalizeCell(row.分级说明),
        ]),
        rawRow: row,
      } satisfies AuditClause;
    })
    .filter((item): item is AuditClause => item !== null);

  if (clauses.length === 0) {
    warnings.push("稽核表中未解析到可匹配条款，请确认真实数据从第 3 行开始。");
  }

  return { sheetNames, clauses, warnings };
}

export function parseConsensusWorkbook(buffer: ArrayBuffer): ParsedConsensusWorkbook {
  const workbook = toWorkbook(buffer);
  const warnings: string[] = [];
  const sheetNames = workbook.SheetNames;
  const sheetName = sheetNames[0];
  if (!sheetName) {
    return { sheetNames: [], entries: [], warnings: ["未找到共识表 Sheet。"] };
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });

  const entries: ConsensusEntry[] = rows
    .map((raw, index) => {
      const row = Object.fromEntries(
        Object.entries(raw).map(([key, value]) => [key, normalizeCell(value)]),
      );
      const consensusId = normalizeCell(row.id);
      const title = normalizeCell(row.title);
      if (!consensusId || !title || normalizeCell(row.deleted) === "1") {
        return null;
      }
      const contentText =
        normalizeCell(row.consensus_desc_txt) ||
        stripHtml(normalizeCell(row.consensus_desc));
      return {
        key: `consensus:${consensusId}:${index + 2}`,
        rowIndex: index + 2,
        consensusId,
        title,
        type: normalizeCell(row.type),
        clauseId: normalizeCell(row.clause_id),
        contentText,
        visibleRoles: normalizeCell(row.visible_roles),
        searchText: joinText([title, contentText, normalizeCell(row.type)]),
        rawRow: row,
      } satisfies ConsensusEntry;
    })
    .filter((item): item is ConsensusEntry => item !== null);

  if (entries.length === 0) {
    warnings.push("共识表中未解析到有效共识数据。");
  }

  return { sheetNames, entries, warnings };
}
