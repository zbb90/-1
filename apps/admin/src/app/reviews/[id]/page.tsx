import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getAdminSessionFromCookies } from "@/lib/admin-session";
import { getReviewTaskById } from "@/lib/review-pool";
import { AdminNav } from "@/components/admin/admin-nav";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { AdminShell } from "@/components/admin/admin-shell";
import {
  StatusPill,
  WorkspaceActionLink,
  WorkspaceMetric,
  WorkspaceSection,
} from "@/components/admin/knowledge-workspace";
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
  const statusTone =
    task.status === "待处理"
      ? "amber"
      : task.status === "已处理" || task.status === "已加入知识库"
        ? "green"
        : task.status === "AI已自动回答"
          ? "blue"
          : "slate";

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

      <section className="grid gap-4 md:grid-cols-4">
        <WorkspaceMetric label="当前状态" value={s(task.status)} tone={statusTone} />
        <WorkspaceMetric label="任务类型" value={s(task.type)} tone="slate" />
        <WorkspaceMetric label="问题分类" value={s(task.category)} tone="blue" />
        <WorkspaceMetric label="门店编码" value={s(task.storeCode)} tone="amber" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <WorkspaceSection
            title="任务信息"
            description="统一查看当前复核任务的状态、来源与提问信息。"
            actions={
              <StatusPill tone={statusTone}>当前状态：{s(task.status)}</StatusPill>
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
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
          </WorkspaceSection>

          <WorkspaceSection
            title="专员提交内容"
            description="主工作区保留原始提问快照，方便对照 AI 初判与主管最终处理。"
            actions={
              source.autoAnswer ? (
                <StatusPill tone="blue">含 AI 初步回答</StatusPill>
              ) : null
            }
          >
            <div className="grid gap-4 md:grid-cols-2">
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
          </WorkspaceSection>

          <ReviewTaskForm task={task} />
        </div>

        <div className="space-y-5">
          <WorkspaceSection
            title="处理说明"
            description="右侧辅助区用于承接流程提示，而不是把说明散在主内容里。"
          >
            <div className="space-y-3">
              <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
                <div className="flex items-center gap-2">
                  <StatusPill tone="amber">先确认事实</StatusPill>
                </div>
                <p className="mt-2 text-sm leading-6 text-amber-800">
                  先核实门店描述、自行判断和 AI 初判是否一致，再写主管最终结论。
                </p>
              </div>
              <div className="rounded-2xl bg-blue-50 p-4 ring-1 ring-blue-200">
                <div className="flex items-center gap-2">
                  <StatusPill tone="blue">再补回复</StatusPill>
                </div>
                <p className="mt-2 text-sm leading-6 text-blue-800">
                  回复内容尽量写成专员可执行的话术，便于直接同步与后续沉淀。
                </p>
              </div>
              <div className="rounded-2xl bg-green-50 p-4 ring-1 ring-green-200">
                <div className="flex items-center gap-2">
                  <StatusPill tone="green">最后决定沉淀</StatusPill>
                </div>
                <p className="mt-2 text-sm leading-6 text-green-800">
                  高频场景或 AI 易错场景，优先“保存并加入知识库”。
                </p>
              </div>
            </div>
          </WorkspaceSection>

          <WorkspaceSection
            title="快捷动作"
            description="保持和其他后台页一致，把次级动作集中到右侧。"
          >
            <div className="flex flex-col gap-3">
              <WorkspaceActionLink href="/reviews" tone="slate" outline>
                返回复核任务列表
              </WorkspaceActionLink>
              <WorkspaceActionLink href="/conversations" tone="blue" outline>
                查看全量问答日志
              </WorkspaceActionLink>
              {isLeader ? (
                <WorkspaceActionLink href="/storage" tone="amber" outline>
                  打开存储诊断
                </WorkspaceActionLink>
              ) : null}
            </div>
          </WorkspaceSection>

          <WorkspaceSection
            title="原始技术数据"
            description="技术排查放在右侧辅助区，避免打断日常处理流。"
          >
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
          </WorkspaceSection>
        </div>
      </section>
    </AdminShell>
  );
}
