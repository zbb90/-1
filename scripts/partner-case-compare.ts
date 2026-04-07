/**
 * 读取「案例」文件夹中伙伴提问 Excel，用本地知识库跑常规问题匹配，对照「主管答疑」。
 * 可在仓库根目录或 apps/admin 目录执行，脚本会自动切换到正确 cwd。
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import type { RegularQuestionRequest } from "../apps/admin/src/lib/types";
import { matchRegularQuestion } from "../apps/admin/src/lib/knowledge-base";

const DEFAULT_XLSX = resolve(
  "/Users/zhaobinbin/Desktop/2026年3月/案例/稽核三组伙伴日常答疑汇总_徐伟伟_20260310.xlsx",
);

function resolveAdminCwd() {
  const current = process.cwd();
  const candidates = [current, resolve(current, "apps/admin")];
  return (
    candidates.find((dir) => existsSync(resolve(dir, "../../data/templates"))) ?? current
  );
}

function mapCategory(raw: string): string {
  const t = String(raw ?? "").trim();
  if (!t) return "物料效期问题";
  if (t.includes("离地") || t.includes("货物离地")) return "储存与离地问题";
  if (t.includes("消杀")) return "虫害与消杀问题";
  if (t.includes("冰箱")) return "储存与离地问题";
  if (t.includes("净水器")) return "设备器具清洁/霉变/积垢";
  if (t.includes("效期") || t.includes("半成品")) return "物料效期问题";
  return "物料效期问题";
}

function norm(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

/** 粗粒度：主管说「可提醒」类 vs 系统是否扣分 */
function supervisorTone(supervisor: string): "remind" | "deduct" | "verify" | "other" {
  const s = String(supervisor ?? "");
  if (/可提醒|提醒|报备提醒|先报备/.test(s)) return "remind";
  if (/正常记录|未整改|需扣|扣分|处理掉|废弃/.test(s)) return "deduct";
  if (/核实|监控/.test(s)) return "verify";
  return "other";
}

function systemTone(shouldDeduct: string): "remind" | "deduct" | "unknown" {
  const x = String(shouldDeduct ?? "").trim();
  if (/否|不扣|0/.test(x)) return "remind";
  if (/是|扣/.test(x)) return "deduct";
  return "unknown";
}

async function main() {
  process.chdir(resolveAdminCwd());
  const file = process.argv[2] || DEFAULT_XLSX;
  if (!existsSync(file)) {
    console.error("文件不存在:", file);
    process.exit(1);
  }

  const wb = XLSX.read(readFileSync(file), { type: "buffer" });
  const ws = wb.Sheets["问题原因记录 (2)"];
  if (!ws) {
    console.error("未找到工作表：问题原因记录 (2)");
    process.exit(1);
  }

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: "",
  });
  const dataRows = rows.slice(1);

  console.log(
    JSON.stringify(
      {
        file,
        rowCount: dataRows.length,
        note: "在 apps/admin 目录下执行以加载 data/templates；对照为语义级，非逐字相等。",
      },
      null,
      2,
    ),
  );

  let idx = 0;
  for (const r of dataRows) {
    idx += 1;
    const issueType = String(r.__EMPTY_2 ?? "");
    const question = String(r.__EMPTY_3 ?? "").trim();
    const selfView = String(r.__EMPTY_4 ?? "").trim();
    const reason = String(r.__EMPTY_5 ?? "").trim();
    const supervisor = String(r.__EMPTY_7 ?? "").trim();

    if (!question && !reason) continue;

    const category = mapCategory(issueType);
    const description = [reason, selfView ? `个人想法：${selfView}` : ""]
      .filter(Boolean)
      .join("\n");

    const payload: RegularQuestionRequest = {
      storeCode: String(r.__EMPTY_1 ?? "CASE"),
      category,
      selfJudgment: selfView || "待系统参考",
      issueTitle: question || reason.slice(0, 40),
      description: description || question,
      requesterId: "partner-case-batch",
      requesterName: String(r.__EMPTY ?? "伙伴"),
    };

    const result = await matchRegularQuestion(payload);
    const supT = supervisorTone(supervisor);
    let align: string;
    if (!result.matched) {
      align =
        supT === "verify" || supT === "remind"
          ? "需人工（系统未命中规则，主管多为个案口径）"
          : "需人工（系统未命中）";
    } else {
      const ans = result.answer!;
      const sysT = systemTone(ans.shouldDeduct);
      if (supT === "remind" && sysT === "remind") align = "一致倾向（可提醒/不扣）";
      else if (supT === "deduct" && sysT === "deduct")
        align = "一致倾向（应记录/扣分）";
      else if (supT === "verify")
        align = "主管要求核实（系统给出规则结论，需人工复核）";
      else if (supT === "other" || supervisor === "")
        align = "主管口径未标注或需人工读原文对照";
      else align = `可能不一致：主管=${supT} 系统扣分字段=${ans.shouldDeduct}`;
    }

    const out = {
      caseNo: idx,
      门店编码: payload.storeCode,
      原始类型: issueType,
      映射分类: category,
      问题摘要: (question || reason).slice(0, 60),
      主管答疑: supervisor.slice(0, 200),
      系统命中: result.matched,
      系统规则: result.matched ? result.answer!.ruleId : null,
      系统是否扣分字段: result.matched ? result.answer!.shouldDeduct : null,
      系统条款标题: result.matched ? result.answer!.clauseTitle?.slice(0, 80) : null,
      对照结论: align,
    };

    console.log("\n" + "=".repeat(72));
    console.log(JSON.stringify(out, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
