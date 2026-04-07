/**
 * Stress-test script for the audit-ai-assistant system.
 *
 * Scenarios:
 *   A) 100 concurrent regular-question/ask requests
 *   B) Large data volume: seed 2000 tasks, then concurrent reads + writes
 *   C) External dependency QPS: DashScope embedding + Qdrant search
 *
 * Usage:
 *   npx tsx scripts/stress-test.ts [--target https://1-admin-seven.vercel.app]
 */

const DEFAULT_TARGET = "https://1-admin-seven.vercel.app";

function getTarget(): string {
  const idx = process.argv.indexOf("--target");
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return DEFAULT_TARGET;
}

interface TimingResult {
  ok: boolean;
  ms: number;
  status?: number;
  error?: string;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function report(label: string, results: TimingResult[]) {
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const successes = results.filter((r) => r.ok).length;
  const failures = results.length - successes;
  const errorRate = ((failures / results.length) * 100).toFixed(1);

  console.log(`\n=== ${label} ===`);
  console.log(`  Total requests : ${results.length}`);
  console.log(`  Success        : ${successes}`);
  console.log(`  Failures       : ${failures}  (${errorRate}%)`);
  console.log(`  P50            : ${percentile(times, 50)}ms`);
  console.log(`  P95            : ${percentile(times, 95)}ms`);
  console.log(`  P99            : ${percentile(times, 99)}ms`);
  console.log(`  Min            : ${times[0]}ms`);
  console.log(`  Max            : ${times[times.length - 1]}ms`);

  if (failures > 0) {
    const errSample = results
      .filter((r) => !r.ok)
      .slice(0, 3)
      .map((r) => `    status=${r.status} ${r.error ?? ""}`)
      .join("\n");
    console.log(`  Error samples:\n${errSample}`);
  }

  return {
    successes,
    failures,
    errorRate,
    p50: percentile(times, 50),
    p95: percentile(times, 95),
    p99: percentile(times, 99),
  };
}

async function timedFetch(url: string, init: RequestInit): Promise<TimingResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
    const ms = Date.now() - start;
    if (res.ok) return { ok: true, ms, status: res.status };
    const body = await res.text().catch(() => "");
    return { ok: false, ms, status: res.status, error: body.slice(0, 200) };
  } catch (err) {
    return {
      ok: false,
      ms: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ------------------------------------------------------------------ */
/*  Scenario A: 100 concurrent regular-question/ask                    */
/* ------------------------------------------------------------------ */

async function scenarioA(base: string) {
  console.log("\n[Scenario A] 100 concurrent POST /api/regular-question/ask");

  const promises: Promise<TimingResult>[] = [];
  for (let i = 0; i < 100; i++) {
    const body = {
      category: "储存与离地问题",
      issueTitle: `压测问题-${i}`,
      description: `仓库物料没有离地，压测第${i}次`,
      selfJudgment: "待人工确认",
      requesterId: `stress-user-${i}`,
      requesterName: `压测用户${i}`,
    };
    promises.push(
      timedFetch(`${base}/api/regular-question/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-requester-id": `stress-user-${i}`,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  const results = await Promise.all(promises);
  return report("Scenario A: 100 Concurrent Asks", results);
}

/* ------------------------------------------------------------------ */
/*  Scenario B: Large data volume read/write                           */
/* ------------------------------------------------------------------ */

async function scenarioB(base: string) {
  console.log("\n[Scenario B] Concurrent reads + writes with existing data");

  const readPromises: Promise<TimingResult>[] = [];
  const writePromises: Promise<TimingResult>[] = [];

  for (let i = 0; i < 50; i++) {
    readPromises.push(
      timedFetch(`${base}/api/reviews`, {
        method: "GET",
        headers: { "x-requester-id": `stress-user-${i}` },
      }),
    );
  }

  for (let i = 0; i < 50; i++) {
    const body = {
      category: "物料效期问题",
      issueTitle: `写入压测-${i}`,
      description: `压测写入任务第${i}条`,
      selfJudgment: "待人工确认",
      requesterId: `stress-writer-${i}`,
      requesterName: `写入用户${i}`,
    };
    writePromises.push(
      timedFetch(`${base}/api/regular-question/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-requester-id": `stress-writer-${i}`,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  const allResults = await Promise.all([...readPromises, ...writePromises]);
  const readResults = allResults.slice(0, 50);
  const writeResults = allResults.slice(50);

  const readStats = report("Scenario B: 50 Concurrent Reads", readResults);
  const writeStats = report("Scenario B: 50 Concurrent Writes", writeResults);
  return { readStats, writeStats };
}

/* ------------------------------------------------------------------ */
/*  Scenario C: External dependency QPS                                */
/* ------------------------------------------------------------------ */

async function scenarioC(base: string) {
  console.log("\n[Scenario C] External dependency QPS (sequential bursts)");

  const askResults: TimingResult[] = [];
  const batchSize = 10;
  const batches = 5;

  for (let b = 0; b < batches; b++) {
    const batchPromises: Promise<TimingResult>[] = [];
    for (let i = 0; i < batchSize; i++) {
      const seq = b * batchSize + i;
      batchPromises.push(
        timedFetch(`${base}/api/regular-question/ask`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-requester-id": `qps-tester-${seq}`,
          },
          body: JSON.stringify({
            category: "储存与离地问题",
            issueTitle: `QPS测试-${seq}`,
            description: `阁楼仓库物料直接放在地上，QPS测试第${seq}次`,
            selfJudgment: "待人工确认",
            requesterId: `qps-tester-${seq}`,
          }),
        }),
      );
    }
    const batchResults = await Promise.all(batchPromises);
    askResults.push(...batchResults);
    console.log(
      `  Batch ${b + 1}/${batches} done, avg ${Math.round(batchResults.reduce((s, r) => s + r.ms, 0) / batchResults.length)}ms`,
    );
  }

  return report(
    "Scenario C: DashScope+Qdrant QPS (50 sequential-burst asks)",
    askResults,
  );
}

/* ------------------------------------------------------------------ */
/*  Health check                                                       */
/* ------------------------------------------------------------------ */

async function healthCheck(base: string) {
  console.log(`\nTarget: ${base}`);
  console.log("Running health check...");
  const result = await timedFetch(`${base}/api/health`, { method: "GET" });
  if (!result.ok) {
    console.error(`Health check FAILED: status=${result.status} ${result.error}`);
    process.exit(1);
  }
  console.log(`Health check OK (${result.ms}ms)`);
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function main() {
  const base = getTarget();
  await healthCheck(base);

  const aStats = await scenarioA(base);
  const bStats = await scenarioB(base);
  const cStats = await scenarioC(base);

  console.log("\n========================================");
  console.log("         STRESS TEST SUMMARY");
  console.log("========================================");

  const pass = (condition: boolean, label: string) => {
    const icon = condition ? "PASS" : "FAIL";
    console.log(`  [${icon}] ${label}`);
    return condition;
  };

  let allPassed = true;
  allPassed =
    pass(aStats.p95 < 15000, `A: P95 < 15s (actual: ${aStats.p95}ms)`) && allPassed;
  allPassed =
    pass(
      Number(aStats.errorRate) < 5,
      `A: Error rate < 5% (actual: ${aStats.errorRate}%)`,
    ) && allPassed;
  allPassed =
    pass(
      bStats.readStats.p95 < 3000,
      `B-read: P95 < 3s (actual: ${bStats.readStats.p95}ms)`,
    ) && allPassed;
  allPassed =
    pass(
      Number(bStats.writeStats.errorRate) < 5,
      `B-write: Error rate < 5% (actual: ${bStats.writeStats.errorRate}%)`,
    ) && allPassed;
  allPassed =
    pass(
      Number(cStats.errorRate) < 10,
      `C: Error rate < 10% (actual: ${cStats.errorRate}%)`,
    ) && allPassed;

  console.log(
    `\nOverall: ${allPassed ? "ALL PASSED - ready for launch" : "SOME FAILED - see details above"}`,
  );
  if (!allPassed) process.exit(1);
}

main().catch((err) => {
  console.error("Stress test crashed:", err);
  process.exit(1);
});
