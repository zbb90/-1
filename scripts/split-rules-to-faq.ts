/**
 * dry-run 拆分脚本：
 *   - 读取 data/templates/03_常规问题规则表.csv
 *   - 把所有备注以「自动从稽核共识抽取」开头的行（共识被误塞进 rules）迁出到 faq
 *   - 同步生成新版 03 / 07 CSV 到 data/migrations/2026-04-21/，并产出 REPORT.md
 *   - 同时读取 /Users/zhaobinbin/Desktop/稽核表/古茗门店稽核表20251101.xlsx
 *     比对 H/M/L/F/B/E/K 等真实条款编号在 rules 中的覆盖率
 *
 * 不修改原文件；写库由你二次确认后另起一个 commit-step 完成。
 */
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as XLSX from "xlsx";

const ROOT = process.cwd();
const TEMPLATES = resolve(ROOT, "data/templates");
const OUT_DIR = resolve(ROOT, "data/migrations/2026-04-21");
const RULES_CSV = resolve(TEMPLATES, "03_常规问题规则表.csv");
const FAQ_CSV = resolve(TEMPLATES, "07_常问沉积表.csv");
const CONSENSUS_CSV = resolve(TEMPLATES, "02_共识解释表.csv");
const AUDIT_XLSX =
  process.env.AUDIT_XLSX ??
  "/Users/zhaobinbin/Desktop/稽核表/古茗门店稽核表20251101.xlsx";

type Row = Record<string, string>;

function readCsv(path: string): { headers: string[]; rows: Row[] } {
  const wb = XLSX.readFile(path, {
    type: "file",
    raw: true,
    cellDates: false,
    cellText: false,
    codepage: 65001,
  });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: true,
  });
  const headers = (aoa[0] as string[]).map((h) => String(h ?? "").trim());
  const rows: Row[] = [];
  for (let i = 1; i < aoa.length; i += 1) {
    const arr = aoa[i] as unknown[];
    if (!arr || arr.every((v) => String(v ?? "").trim() === "")) continue;
    const row: Row = {};
    headers.forEach((h, idx) => {
      row[h] = String(arr[idx] ?? "").trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

function escapeField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function writeCsv(headers: string[], rows: Row[]): string {
  const head = headers.map(escapeField).join(",");
  const body = rows.map((r) => headers.map((h) => escapeField(r[h] ?? "")).join(","));
  return [head, ...body].join("\n") + "\n";
}

interface AuditRule {
  id: string; // H1.1, H1.1.1, M3.4 ...
  level: "H" | "M" | "L" | "F" | "B" | "E" | "K" | "KF" | "OTHER";
  chapter: string; // H1, H2, M1 ...
  isChapter: boolean; // H1 (no dot)
  isClause: boolean; // H1.1 (one dot)
  isObservation: boolean; // H1.1.1 (two+ dots)
  category: string; // 类别
  score: string;
  text: string;
  remark: string;
}

function parseAuditXlsx(path: string): AuditRule[] {
  const wb = XLSX.readFile(path, { cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: false,
  });
  // 列顺序：[维度, 分级说明, 分值, ID, 标准条文, 备注]
  const out: AuditRule[] = [];
  for (let i = 2; i < aoa.length; i += 1) {
    const row = aoa[i] as string[];
    const id = String(row[3] ?? "").trim();
    const text = String(row[4] ?? "").trim();
    if (!id || !text) continue;
    const upper = id.toUpperCase();
    const prefix = upper.match(/^[A-Z]+/)?.[0] ?? "";
    const level: AuditRule["level"] = (
      ["H", "M", "L", "F", "B", "E", "K", "KF"] as const
    ).includes(prefix as never)
      ? (prefix as AuditRule["level"])
      : "OTHER";
    const chapter = upper.match(/^[A-Z]+\d+/)?.[0] ?? upper;
    const dotCount = (id.match(/\./g) ?? []).length;
    out.push({
      id: upper,
      level,
      chapter,
      isChapter: dotCount === 0,
      isClause: dotCount === 1,
      isObservation: dotCount >= 2,
      category: String(row[1] ?? "").trim(),
      score: String(row[2] ?? "").trim(),
      text,
      remark: String(row[5] ?? "").trim(),
    });
  }
  return out;
}

function nextFaqId(existing: Row[]): (n: number) => string {
  let max = 0;
  for (const r of existing) {
    const m = (r.faq_id ?? "").match(/FAQ-(\d+)/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return (n: number) => `FAQ-${String(max + n).padStart(4, "0")}`;
}

function nowStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const rulesCsv = readCsv(RULES_CSV);
  const faqCsv = readCsv(FAQ_CSV);
  const consensusCsv = readCsv(CONSENSUS_CSV);
  const audit = parseAuditXlsx(AUDIT_XLSX);

  const ruleRows = rulesCsv.rows;
  const faqRows = faqCsv.rows;
  const consensusRows = consensusCsv.rows;

  const consensusById = new Map<string, Row>();
  for (const c of consensusRows) {
    if (c.consensus_id) consensusById.set(c.consensus_id, c);
  }

  // 拆分
  const keepRules: Row[] = [];
  const moveToFaq: Row[] = [];
  for (const r of ruleRows) {
    const remark = (r.备注 ?? "").trim();
    if (remark.startsWith("自动从稽核共识抽取")) {
      moveToFaq.push(r);
    } else {
      keepRules.push(r);
    }
  }

  // 生成新 FAQ 行（追加在现有 faqRows 后）
  const faqHeaders = faqCsv.headers;
  const idGen = nextFaqId(faqRows);
  const newFaqRows: Row[] = [];
  const ts = nowStr();
  moveToFaq.forEach((r, i) => {
    const csId = (r.共识来源 ?? "").trim();
    const cs = csId ? consensusById.get(csId) : undefined;
    const question = (r.示例问法 ?? r.条款标题 ?? "").trim();
    // 答案优先用 条款解释（更长/详细），其次条款关键片段
    const answerCandidates = [r.条款解释, r.条款关键片段, r.场景描述].map((v) =>
      (v ?? "").trim(),
    );
    const answer =
      answerCandidates.find((v) => v.length > 0) || (r.条款标题 ?? "").trim();
    const keywords = (r.问题子类或关键词 ?? "").trim();
    const tagSet = ["consensus-link", "migrated-from-rules"];
    if (cs) tagSet.push(`category-${cs.适用场景 ?? ""}`.trim().slice(0, 64));
    const oldRuleId = r.rule_id ?? "";
    const oldClause = (r.条款编号 ?? "").trim();
    const remarkParts = [
      `迁移自规则表 ${oldRuleId}`,
      oldClause ? `原条款编号=${oldClause}` : "",
      r.问题分类 ? `分类=${r.问题分类}` : "",
    ].filter(Boolean);

    const faqRow: Row = {};
    for (const h of faqHeaders) faqRow[h] = "";
    faqRow.faq_id = idGen(i + 1);
    faqRow.问题 = question;
    faqRow.答案 = answer;
    faqRow.关联条款编号 = ""; // 旧的 311/33/37 是脏数据，留空待 Excel 反向映射
    faqRow.关联共识编号 = csId;
    faqRow.review_id = "";
    faqRow.沉积来源 = "迁移自规则表";
    faqRow.命中关键词 = keywords;
    faqRow.tags = tagSet.filter((t) => t && t !== "category-").join("|");
    faqRow.状态 = (r.状态 ?? "启用").trim() || "启用";
    faqRow.备注 = remarkParts.join("；");
    faqRow.更新时间 = ts;
    newFaqRows.push(faqRow);
  });

  const newFaq = [...faqRows, ...newFaqRows];

  // 输出新版 CSV
  const newRulesCsv = writeCsv(rulesCsv.headers, keepRules);
  const newFaqCsv = writeCsv(faqHeaders, newFaq);

  // 报告
  const auditOfficial = audit.filter((a) => a.isClause); // 一个 dot 的正式条款
  const auditObservations = audit.filter((a) => a.isObservation);
  const auditChapters = audit.filter((a) => a.isChapter);
  const ruleClauses = new Set(
    keepRules.map((r) => (r.条款编号 ?? "").trim().toUpperCase()).filter(Boolean),
  );
  const auditCovered = auditOfficial.filter((a) => ruleClauses.has(a.id));
  const auditMissing = auditOfficial.filter((a) => !ruleClauses.has(a.id));
  const auditAllIds = new Set(audit.map((a) => a.id));
  const ruleExtra = keepRules.filter((r) => {
    const c = (r.条款编号 ?? "").trim().toUpperCase();
    return c && !auditAllIds.has(c);
  });

  const sample = (rows: Row[], n: number) => rows.slice(0, n);

  const report: string[] = [];
  report.push("# 拆分 dry-run 报告  (2026-04-21)");
  report.push("");
  report.push("## 1. 输入");
  report.push(`- rules csv: ${RULES_CSV}  (rows=${ruleRows.length})`);
  report.push(`- faq csv: ${FAQ_CSV}      (rows=${faqRows.length})`);
  report.push(`- consensus csv: ${CONSENSUS_CSV} (rows=${consensusRows.length})`);
  report.push(`- audit xlsx: ${AUDIT_XLSX}`);
  report.push("");
  report.push("## 2. rules 拆分结果");
  report.push(`- 保留 (备注非\"自动从稽核共识抽取\"): **${keepRules.length}** 条`);
  report.push(`- 迁出到 faq (\"自动从稽核共识抽取\"): **${moveToFaq.length}** 条`);
  report.push(`- faq 表条目数: ${faqRows.length} → ${newFaq.length}`);
  report.push("");
  report.push("### 2.1 保留的 rules 抽样 (前 5)");
  for (const r of sample(keepRules, 5)) {
    report.push(
      `- ${r.rule_id} | ${r.条款编号} | ${r.条款标题 ?? r.示例问法 ?? ""} | 备注=${r.备注 ?? ""}`,
    );
  }
  report.push("");
  report.push("### 2.2 迁到 faq 的抽样 (前 5)");
  for (const r of sample(moveToFaq, 5)) {
    report.push(
      `- ${r.rule_id} → 共识=${r.共识来源} | 标题=${r.条款标题 ?? r.示例问法 ?? ""} | 旧条款编号=${r.条款编号 ?? ""}`,
    );
  }
  report.push("");
  report.push("## 3. 与新版稽核 Excel 比对");
  report.push(`- Excel 章节行 (X): ${auditChapters.length}`);
  report.push(`- Excel 标准条款行 (X.Y, 一个 dot): **${auditOfficial.length}**`);
  report.push(`- Excel 观察点行 (X.Y.Z, 二个 dot): ${auditObservations.length}`);
  report.push(
    `- rules 已覆盖 Excel 标准条款: **${auditCovered.length}** / ${auditOfficial.length}`,
  );
  report.push(`- Excel 缺失（rules 没有的标准条款）: **${auditMissing.length}** 条`);
  report.push(`- rules 多出（Excel 里查不到的条款编号）: ${ruleExtra.length} 条`);
  report.push("");
  report.push("### 3.1 Excel 缺失抽样 (前 30)");
  for (const a of auditMissing.slice(0, 30)) {
    report.push(`- ${a.id} (${a.category}, ${a.score}分) ${a.text}`);
  }
  if (auditMissing.length > 30) {
    report.push(`- ... 余 ${auditMissing.length - 30} 条详见附件`);
  }
  report.push("");
  report.push("### 3.2 rules 多出（脏 / 无法对齐）抽样 (前 20)");
  for (const r of ruleExtra.slice(0, 20)) {
    report.push(`- ${r.rule_id} 条款编号=${r.条款编号} 标题=${r.条款标题 ?? ""}`);
  }
  report.push("");
  report.push("## 4. 输出文件 (dry-run, 未覆盖 templates)");
  report.push(`- ${resolve(OUT_DIR, "03_常规问题规则表.new.csv")}`);
  report.push(`- ${resolve(OUT_DIR, "07_常问沉积表.new.csv")}`);
  report.push(`- ${resolve(OUT_DIR, "audit_excel_missing.csv")}`);
  report.push("");
  report.push("## 5. 下一步建议");
  report.push(
    "1. 你 review 上面的 dry-run 文件 + 报告，OK 后我把 03/07 覆盖到 templates 并 commit。",
  );
  report.push(
    "2. 02 共识表里 311/33/37 等乱码 关联条款编号 不在本次范围，建议下一轮单独处理（用 Excel 的 chapter→category 映射做反查）。",
  );
  report.push("3. 覆盖后需重建向量库 (后台 /storage 重建按钮)。");

  // 缺失的稽核条款 CSV
  const missingCsv = writeCsv(
    ["条款编号", "类别", "分值", "标准条文", "备注"],
    auditMissing.map((a) => ({
      条款编号: a.id,
      类别: a.category,
      分值: a.score,
      标准条文: a.text,
      备注: a.remark,
    })),
  );

  Promise.all([
    writeFile(resolve(OUT_DIR, "03_常规问题规则表.new.csv"), newRulesCsv, "utf-8"),
    writeFile(resolve(OUT_DIR, "07_常问沉积表.new.csv"), newFaqCsv, "utf-8"),
    writeFile(resolve(OUT_DIR, "audit_excel_missing.csv"), missingCsv, "utf-8"),
    writeFile(resolve(OUT_DIR, "REPORT.md"), report.join("\n"), "utf-8"),
  ]).then(() => {
    console.log(report.join("\n"));
    console.log("\n[done] dry-run 输出在 ", OUT_DIR);
  });
}

main();
