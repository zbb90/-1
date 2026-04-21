import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Redis 未配置，全走文件兜底；cwd 切到一个临时目录，避免污染仓库里的 data/ 目录。
let workDir: string;
let originalCwd: string;
let originalRedisUrl: string | undefined;
let originalRedisToken: string | undefined;

async function importFreshModule() {
  vi.resetModules();
  return import("./knowledge-link-suggestions");
}

describe("knowledge-link-suggestions", () => {
  beforeEach(async () => {
    originalCwd = process.cwd();
    workDir = await mkdtemp(resolve(tmpdir(), "link-suggestions-"));
    process.chdir(workDir);
    originalRedisUrl = process.env.REDIS_URL;
    originalRedisToken = process.env.REDIS_HOST;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await rm(workDir, { recursive: true, force: true });
    if (originalRedisUrl !== undefined) {
      process.env.REDIS_URL = originalRedisUrl;
    }
    if (originalRedisToken !== undefined) {
      process.env.REDIS_HOST = originalRedisToken;
    }
  });

  it("addSuggestions 写入并自动去重已 pending 的配对", async () => {
    const mod = await importFreshModule();
    const draft = {
      sourceTable: "rules" as const,
      sourceId: "R-0001",
      targetTable: "consensus" as const,
      targetId: "C-0002",
      linkType: "supports" as const,
      confidence: 0.9,
      reason: "case1",
      evidenceSourceSpan: "rule text",
      evidenceTargetSpan: "consensus text",
      model: "qwen3.5-flash",
    };

    const first = await mod.addSuggestions([draft]);
    expect(first.added).toBe(1);

    const second = await mod.addSuggestions([draft]);
    expect(second.added).toBe(0);
  });

  it("blocklist 存在的配对不再被写入 pending", async () => {
    const mod = await importFreshModule();
    await mod.addPairToBlocklist(
      { table: "rules", id: "R-0001" },
      { table: "consensus", id: "C-0002" },
    );

    const result = await mod.addSuggestions([
      {
        sourceTable: "rules",
        sourceId: "R-0001",
        targetTable: "consensus",
        targetId: "C-0002",
        linkType: "related",
        confidence: 0.8,
        reason: "",
        evidenceSourceSpan: "",
        evidenceTargetSpan: "",
        model: "test",
      },
    ]);
    expect(result.added).toBe(0);
  });

  it("approve/reject 状态流转且不能重复操作", async () => {
    const mod = await importFreshModule();
    const { added } = await mod.addSuggestions([
      {
        sourceTable: "rules",
        sourceId: "R-0010",
        targetTable: "rules",
        targetId: "R-0011",
        linkType: "related",
        confidence: 0.75,
        reason: "",
        evidenceSourceSpan: "",
        evidenceTargetSpan: "",
        model: "test",
      },
    ]);
    expect(added).toBe(1);

    const { items } = await mod.listSuggestions({ status: "pending" });
    expect(items).toHaveLength(1);
    const target = items[0];

    const approved = await mod.updateSuggestionStatus(target.id, {
      status: "approved",
      decidedBy: "zhang",
      appliedLinkId: "KL-123",
    });
    expect(approved?.status).toBe("approved");
    expect(approved?.decidedBy).toBe("zhang");
    expect(approved?.appliedLinkId).toBe("KL-123");

    const afterList = await mod.listSuggestions({ status: "pending" });
    expect(afterList.total).toBe(0);

    const stats = await mod.countSuggestionsByStatus();
    expect(stats.approved).toBe(1);
    expect(stats.pending).toBe(0);
  });

  it("listPendingSuggestionsForGraph 过滤低置信度条目", async () => {
    const mod = await importFreshModule();
    await mod.addSuggestions([
      {
        sourceTable: "rules",
        sourceId: "R-0001",
        targetTable: "consensus",
        targetId: "C-0001",
        linkType: "supports",
        confidence: 0.4,
        reason: "",
        evidenceSourceSpan: "",
        evidenceTargetSpan: "",
        model: "t",
      },
      {
        sourceTable: "rules",
        sourceId: "R-0002",
        targetTable: "consensus",
        targetId: "C-0002",
        linkType: "supports",
        confidence: 0.8,
        reason: "",
        evidenceSourceSpan: "",
        evidenceTargetSpan: "",
        model: "t",
      },
    ]);

    const eligible = await mod.listPendingSuggestionsForGraph(0.6);
    expect(eligible).toHaveLength(1);
    expect(eligible[0].sourceId).toBe("R-0002");
  });
});
