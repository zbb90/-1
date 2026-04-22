import { resolve } from "node:path";
import regressionCases from "./semantic-regression-cases.json";

async function main() {
  const rootDir = process.cwd();
  process.chdir(resolve(rootDir, "apps/admin"));

  const { matchRegularQuestion } = await import(
    resolve(rootDir, "apps/admin/src/lib/knowledge-base.ts")
  );

  let failed = false;
  let skipped = 0;

  for (const item of regressionCases as Array<{
    name: string;
    input: Parameters<typeof matchRegularQuestion>[0];
    expectedRuleId: string | null;
    expectsSemanticOnly?: boolean;
    note?: string;
  }>) {
    const result = await matchRegularQuestion(item.input);
    const actualRuleId = result.matched ? result.answer.ruleId : null;
    const retrievalMode = result.debug.retrievalMode;

    // 部分用例期望命中 FAQ 直答（向量模式专属）。fallback 关键词扫描跑不到 FAQ 表，
    // 此时跳过即可，由 staging/线上的真实向量库回归覆盖。
    if (item.expectsSemanticOnly && retrievalMode === "fallback") {
      skipped += 1;
      console.log(`CASE=${item.name} [SKIPPED: 仅在向量模式下校验]`);
      console.log(
        JSON.stringify(
          {
            skipped: true,
            reason: "retrievalMode=fallback，跳过仅向量模式可覆盖的 FAQ 直答用例",
            expectedRuleId: item.expectedRuleId,
            actualRuleId,
            retrievalMode,
            note: item.note ?? null,
          },
          null,
          2,
        ),
      );
      continue;
    }

    const passed = actualRuleId === item.expectedRuleId;

    console.log(`CASE=${item.name}`);
    console.log(
      JSON.stringify(
        {
          passed,
          expectedRuleId: item.expectedRuleId,
          actualRuleId,
          matched: result.matched,
          retrievalMode,
          fallbackReason: result.debug.fallbackReason,
          topCandidate: result.candidates[0] ?? null,
          answer: result.matched
            ? {
                ruleId: result.answer.ruleId,
                clauseTitle: result.answer.clauseTitle,
                shouldDeduct: result.answer.shouldDeduct,
              }
            : null,
        },
        null,
        2,
      ),
    );

    if (!passed) {
      failed = true;
    }
  }

  if (skipped > 0) {
    console.log(
      `[verify-semantic-cases] 已跳过 ${skipped} 条仅向量模式可校验的 FAQ 直答用例`,
    );
  }

  if (failed) {
    throw new Error("存在未通过的语义回归用例。");
  }
}

main().catch((error) => {
  console.error("[verify-semantic-cases] failed", error);
  process.exit(1);
});
