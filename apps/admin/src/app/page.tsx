import { getReviewSummary } from "@/lib/review-pool";

export default async function HomePage() {
  const reviewSummary = await getReviewSummary();
  const dashboardStats = [
    {
      label: "复核总数",
      value: String(reviewSummary.total),
      description: "已进入人工复核池的全部任务数量",
    },
    {
      label: "待复核",
      value: String(reviewSummary.pending),
      description: "系统拒答或无法判断，等待处理的问题",
    },
    {
      label: "待补充",
      value: String(reviewSummary.needMoreInfo),
      description: "已退回给提问人补充信息的任务",
    },
    {
      label: "已处理",
      value: String(reviewSummary.completed),
      description: "主管已完成结论确认的复核任务",
    },
  ];

  return (
    <main className="min-h-screen bg-[var(--background)] p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="rounded-3xl bg-[var(--card)] p-8 shadow-sm ring-1 ring-[var(--border)]">
          <p className="text-sm font-medium text-green-700">主管后台工作台</p>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">
            稽核 AI 助手 PC 端测试入口
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-600">
            这里是主管在 PC 端查看复核池、处理人工复核、导出复核结论的统一入口。专员继续通过小程序提问，主管可在此完成登录、处理和结果导出。
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href="/reviews/login"
              className="rounded-xl bg-green-700 px-5 py-3 text-sm font-medium text-white"
            >
              主管登录
            </a>
            <a
              href="/reviews"
              className="rounded-xl border border-[var(--border)] px-5 py-3 text-sm font-medium text-gray-700"
            >
              进入复核池
            </a>
            <a
              href="/api/reviews/export?format=csv"
              className="rounded-xl border border-[var(--border)] px-5 py-3 text-sm font-medium text-gray-700"
            >
              导出复核结论
            </a>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-4">
          {dashboardStats.map((item) => (
            <div
              key={item.label}
              className="rounded-2xl bg-[var(--card)] p-6 shadow-sm ring-1 ring-[var(--border)]"
            >
              <p className="text-sm text-gray-500">{item.label}</p>
              <p className="mt-3 text-3xl font-semibold text-gray-900">
                {item.value}
              </p>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                {item.description}
              </p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="rounded-2xl bg-[var(--card)] p-6 shadow-sm ring-1 ring-[var(--border)]">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">最近复核任务</h2>
                <p className="mt-1 text-sm text-gray-500">
                  主管可以从这里快速进入最新的复核记录。
                </p>
              </div>
              <a
                href="/reviews"
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm text-gray-700"
              >
                查看完整复核池
              </a>
            </div>

            <div className="mt-6 space-y-4">
              {reviewSummary.latest.length === 0 ? (
                <div className="rounded-xl border border-[var(--border)] p-4 text-sm text-gray-500">
                  目前还没有复核任务。专员在小程序端遇到无法自动判断的问题后，会自动进入这里。
                </div>
              ) : (
                reviewSummary.latest.map((review) => (
                  <a
                    key={review.id}
                    href={`/reviews/${review.id}`}
                    className="block rounded-xl border border-[var(--border)] p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">
                          {review.id}
                        </p>
                        <p className="mt-1 text-sm text-gray-500">
                          门店编码：{review.storeCode}
                        </p>
                      </div>
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
                        {review.status}
                      </span>
                    </div>
                    <p className="mt-3 text-sm font-medium text-gray-800">
                      {review.category}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-gray-600">
                      {review.description}
                    </p>
                  </a>
                ))
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-2xl bg-[var(--card)] p-6 shadow-sm ring-1 ring-[var(--border)]">
              <h2 className="text-xl font-semibold text-gray-900">PC 端测试路径</h2>
              <ol className="mt-4 space-y-3 text-sm leading-6 text-gray-600">
                <li>1. 先访问 `/reviews/login`，使用主管账号登录。</li>
                <li>2. 登录后进入 `/reviews`，查看待处理复核任务。</li>
                <li>3. 进入任意一条复核详情，填写最终结论并保存。</li>
                <li>4. 如需整理沉淀结果，可导出复核结论 CSV。</li>
              </ol>
            </div>

            <div className="rounded-2xl bg-[var(--card)] p-6 shadow-sm ring-1 ring-[var(--border)]">
              <h2 className="text-xl font-semibold text-gray-900">小程序联动说明</h2>
              <ul className="mt-4 space-y-3 text-sm leading-6 text-gray-600">
                <li>1. 专员使用小程序提交常规问题、旧品比对、外购查询。</li>
                <li>2. 系统命中规则时直接返回；无法判断时自动进入人工复核池。</li>
                <li>3. 主管在 PC 端处理完成后，专员可在“我的复核”查看更新结果。</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
