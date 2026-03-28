import Link from "next/link";
import { adminLogoutAction } from "@/app/reviews/actions";
import { KnowledgeTabs } from "./knowledge-tabs";

export default function KnowledgePage() {
  return (
    <main className="min-h-screen bg-[var(--background)] p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* 页面头部 */}
        <section className="rounded-3xl bg-[var(--card)] p-8 shadow-sm ring-1 ring-[var(--border)]">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-green-700">知识库管理</p>
              <h1 className="mt-2 text-3xl font-bold text-gray-900">
                稽核知识库
              </h1>
              <p className="mt-3 text-sm leading-6 text-gray-600">
                管理四张知识表：常规问题规则、共识解释、外购清单、旧品清单。支持新增条目、停用/启用。
                <br />
                <span className="text-amber-600">
                  注意：Vercel 生产环境的 CSV
                  文件为只读，修改需在本地完成后重新部署。
                </span>
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link
                href="/conversations"
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                问答日志
              </Link>
              <Link
                href="/reviews"
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
              >
                复核池
              </Link>
              <form action={adminLogoutAction}>
                <button
                  type="submit"
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
                >
                  退出登录
                </button>
              </form>
            </div>
          </div>
        </section>

        {/* Tab 内容（客户端交互） */}
        <KnowledgeTabs />
      </div>
    </main>
  );
}
