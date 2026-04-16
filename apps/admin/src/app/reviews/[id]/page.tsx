import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { getReviewTaskById } from "@/lib/review-pool";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
import { ReviewTaskForm } from "./review-task-form";

function parseSourcePayload(sourcePayload: string) {
  try {
    const payload = JSON.parse(sourcePayload) as {
      request?: Record<string, string>;
      autoAnswer?: Record<string, string>;
    } & Record<string, string>;

    return {
      request:
        payload.request && typeof payload.request === "object"
          ? payload.request
          : payload,
      autoAnswer:
        payload.autoAnswer && typeof payload.autoAnswer === "object"
          ? payload.autoAnswer
          : null,
    };
  } catch {
    return {
      request: null,
      autoAnswer: null,
    };
  }
}

export default async function ReviewDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: rawId } = await params;
  let task: Awaited<ReturnType<typeof getReviewTaskById>> = null;
  try {
    task = await getReviewTaskById(rawId);
  } catch {
    notFound();
  }
  const cookieStore = await cookies();
  const session = await getAdminSessionFromCookies(cookieStore);
  const isLeader = session?.role === "leader";

  if (!task) {
    notFound();
  }

  const s = (v: unknown) => String(v ?? "");

  const source = parseSourcePayload(s(task.sourcePayload));

  return (
    <AdminShell>
      <AdminPageHeader
        eyebrow="人工复核池"
        title="复核任务详情"
        description={`当前任务编号：${s(task.id)}`}
        actions={
          <AdminNav
            current="reviews"
            showUsersLink={isLeader}
            showStorageLink={isLeader}
          />
        }
      />

      <section className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-gray-200 md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium tracking-wide text-slate-500">
                  任务概览
                </p>
                <h2 className="mt-1 text-xl font-semibold text-gray-900">任务信息</h2>
              </div>
              <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                当前状态：{s(task.status)}
              </div>
            </div>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs text-gray-500">任务类型</p>
                <p className="mt-1 text-sm font-medium text-gray-800">{s(task.type)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs text-gray-500">问题分类</p>
                <p className="mt-1 text-sm font-medium text-gray-800">
                  {s(task.category)}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs text-gray-500">门店编码</p>
                <p className="mt-1 text-sm font-medium text-gray-800">
                  {s(task.storeCode)}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs text-gray-500">提问人</p>
                <p className="mt-1 text-sm font-medium text-gray-800">
                  {s(task.requester)}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 md:col-span-2">
                <p className="text-xs text-gray-500">自行判断</p>
                <p className="mt-1 text-sm leading-6 text-gray-800">
                  {s(task.selfJudgment) || "未填写"}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 md:col-span-2">
                <p className="text-xs text-gray-500">问题描述</p>
                <p className="mt-1 text-sm leading-6 text-gray-800">
                  {s(task.description)}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 md:col-span-2">
                <p className="text-xs text-gray-500">系统备注</p>
                <p className="mt-1 text-sm leading-6 text-gray-800">
                  {s(task.rejectReason) || "主管修正 AI 回答后，转入人工复核。"}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-gray-200 md:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-medium tracking-wide text-slate-500">
                  原始提问
                </p>
                <h2 className="mt-1 text-xl font-semibold text-gray-900">
                  专员提交内容
                </h2>
              </div>
              {source.autoAnswer ? (
                <div className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                  含 AI 初步回答
                </div>
              ) : null}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs text-gray-500">门店问题</p>
                <p className="mt-1 text-sm leading-6 text-gray-800">
                  {source.request?.issueTitle || "未填写"}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs text-gray-500">问题分类</p>
                <p className="mt-1 text-sm leading-6 text-gray-800">
                  {source.request?.category || task.category || "未填写"}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs text-gray-500">自行判断</p>
                <p className="mt-1 text-sm text-gray-800">
                  {source.request?.selfJudgment || task.selfJudgment || "未填写"}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs text-gray-500">提问账号</p>
                <p className="mt-1 text-sm leading-6 text-gray-800">
                  {source.request?.requesterName || task.requester || "未填写"}
                </p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 md:col-span-2">
                <p className="text-xs text-gray-500">专员描述</p>
                <p className="mt-1 text-sm leading-6 text-gray-800">
                  {source.request?.description || task.description || "未填写"}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
            <details>
              <summary className="cursor-pointer list-none text-sm font-medium text-slate-700">
                查看原始技术数据
              </summary>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                这部分仅用于排查和技术核对，日常处理一般不需要看。
              </p>
              <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-700">
                {task.sourcePayload}
              </pre>
            </details>
          </div>
        </div>

        <div>
          <ReviewTaskForm task={task} />
        </div>
      </section>
    </AdminShell>
  );
}
