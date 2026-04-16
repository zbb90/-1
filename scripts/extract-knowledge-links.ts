import { materializeDerivedKnowledgeLinks } from "../apps/admin/src/lib/link-store";

async function main() {
  const result = await materializeDerivedKnowledgeLinks();
  console.log(
    JSON.stringify(
      {
        ok: true,
        added: result.added,
        totalManual: result.totalManual,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        message: error instanceof Error ? error.message : "提取知识关联失败",
      },
      null,
      2,
    ),
  );
  process.exit(1);
});
