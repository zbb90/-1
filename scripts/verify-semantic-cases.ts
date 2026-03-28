import { resolve } from "node:path";

async function main() {
  const rootDir = process.cwd();
  process.chdir(resolve(rootDir, "apps/admin"));

  const { matchRegularQuestion } = await import(
    resolve(rootDir, "apps/admin/src/lib/knowledge-base.ts")
  );

  const cases = [
    {
      name: "离地",
      input: {
        category: "储存与离地问题",
        issueTitle: "仓库物料没有离地",
        description: "仓库里面有原物料直接放在地上，没有离地5cm",
        selfJudgment: "待人工确认",
      },
    },
    {
      name: "破损",
      input: {
        category: "储存与离地问题",
        issueTitle: "解冻品破损",
        description: "榴莲果泥解冻后袋子破损漏液，门店未提前识别",
        selfJudgment: "待人工确认",
      },
    },
    {
      name: "赏味期",
      input: {
        category: "物料效期问题",
        issueTitle: "原物料超赏味期",
        description: "开封物料超过最佳赏味期仍在使用",
        selfJudgment: "待人工确认",
      },
    },
  ];

  for (const item of cases) {
    const result = await matchRegularQuestion(item.input);
    console.log(`CASE=${item.name}`);
    console.log(
      JSON.stringify(
        {
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
  }
}

main().catch((error) => {
  console.error("[verify-semantic-cases] failed", error);
  process.exit(1);
});
