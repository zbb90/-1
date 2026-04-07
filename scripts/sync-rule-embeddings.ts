import { resolve } from "node:path";
import { readTable } from "../apps/admin/src/lib/knowledge-csv";
import {
  rebuildRuleVectorIndex,
  upsertRuleVectors,
} from "../apps/admin/src/lib/vector-store";
import type { RuleRow } from "../apps/admin/src/lib/types";

async function main() {
  process.chdir(resolve(process.cwd(), "apps/admin"));
  const rebuild = process.argv.includes("--rebuild");
  const rules = (await readTable("rules")) as RuleRow[];

  if (rules.length === 0) {
    throw new Error("规则表为空，无法建立语义索引。");
  }

  const result = rebuild
    ? await rebuildRuleVectorIndex(rules)
    : await upsertRuleVectors(rules.filter((rule) => rule.状态 !== "停用"));

  if (!result.ok) {
    throw new Error(result.reason || "规则向量索引同步失败。");
  }

  console.log(
    `[semantic-index] ${rebuild ? "rebuild" : "sync"} completed, points=${result.count}`,
  );
}

main().catch((error) => {
  console.error("[semantic-index] failed", error);
  process.exit(1);
});
