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
  ];

  return (
    <main className="min-h-screen bg-[var(--background)] p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="rounded-3xl bg-[var(--card)] p-8 shadow-sm ring-1 ring-[var(--border)]">
          <p className="text-sm font-medium text-green-700">稽核 AI 助手</p>
          <h1 className="mt-2 text-3xl font-bold text-gray-900">
            后台与接口骨架已创建
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-gray-600">
            当前页面用于确认项目骨架可运行。下一步会继续接入规则数据、复核池和资料发布流程。
          </p>
          <div className="mt-6 flex flex-wrap gap-3 text-sm">
            <span className="rounded-full bg-[var(--primary-soft)] px-4 py-2 text-green-800">
              Next.js 后台
            </span>
            <span className="rounded-full bg-slate-100 px-4 py-2 text-slate-700">
              微信小程序前台
            </span>
            <span className="rounded-full bg-slate-100 px-4 py-2 text-slate-700">
              结构化规则检索
            </span>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
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
                <h2 className="text-xl font-semibold text-gray-900">待处理复核</h2>
                <p className="mt-1 text-sm text-gray-500">
                  当前已接入真实复核池数据。
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
              {reviewSummary.latest.map((review) => (
                <div
                  key={review.id}
                  className="rounded-xl border border-[var(--border)] p-4"
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
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-2xl bg-[var(--card)] p-6 shadow-sm ring-1 ring-[var(--border)]">
            <h2 className="text-xl font-semibold text-gray-900">下一步</h2>
            <ul className="mt-4 space-y-3 text-sm leading-6 text-gray-600">
              <li>1. 补齐复核状态处理和结论回填</li>
              <li>2. 接入我的问题 / 我的复核页</li>
              <li>3. 增加资料发布与复核沉淀联动</li>
              <li>4. 完成白名单和角色权限</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
