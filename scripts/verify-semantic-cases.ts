import { resolve } from "node:path";
import regressionCases from "./semantic-regression-cases.json";

async function main() {
  const rootDir = process.cwd();
  process.chdir(resolve(rootDir, "apps/admin"));

  const { matchRegularQuestion } = await import(
    resolve(rootDir, "apps/admin/src/lib/knowledge-base.ts")
  );

  let failed = false;

  for (const item of regressionCases) {
    const result = await matchRegularQuestion(item.input);
    const actualRuleId = result.matched ? result.answer.ruleId : null;
    const passed = actualRuleId === item.expectedRuleId;

    console.log(`CASE=${item.name}`);
    console.log(
      JSON.stringify(
        {
          passed,
          expectedRuleId: item.expectedRuleId,
          actualRuleId,
          matched: result.matched,
          retrievalMode: result.debug.retrievalMode,
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

  if (failed) {
    throw new Error("存在未通过的语义回归用例。");
  }
}

main().catch((error) => {
  console.error("[verify-semantic-cases] failed", error);
  process.exit(1);
});
