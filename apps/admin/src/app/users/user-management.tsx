"use client";

import { useMemo, useState, useTransition } from "react";
import {
  WorkspaceActionButton,
  WorkspaceMetric,
  WorkspaceSection,
} from "@/components/admin/knowledge-workspace";
import type { PublicAppUser } from "@/lib/user-store";

const roleLabels: Record<string, string> = {
  leader: "负责人",
  supervisor: "主管",
  specialist: "专员",
};

const statusLabels: Record<string, { text: string; cls: string }> = {
  active: { text: "正常", cls: "bg-green-50 text-green-700" },
  disabled: { text: "已停用", cls: "bg-red-50 text-red-700" },
};

type EnvRow = { phone: string; slot: "primary" | "env" };

export function UserManagement({
  initialUsers,
  envSummaries,
  canDelegate,
  primaryPhoneHint,
}: {
  initialUsers: PublicAppUser[];
  envSummaries: EnvRow[];
  canDelegate: boolean;
  primaryPhoneHint: string;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [createMode, setCreateMode] = useState<
    "supervisor" | "delegated_leader" | null
  >(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();
  const [filter, setFilter] = useState<"all" | "leader" | "supervisor" | "specialist">(
    "all",
  );

  const delegatedCount = users.filter(
    (u) => u.role === "leader" && u.leaderKind === "delegated",
  ).length;
  const supervisorCount = users.filter((u) => u.role === "supervisor").length;
  const specialistCount = users.filter((u) => u.role === "specialist").length;

  const filteredUsers = useMemo(() => {
    if (filter === "all") return users;
    if (filter === "leader") {
      return users.filter((u) => u.role === "leader");
    }
    return users.filter((u) => u.role === filter);
  }, [users, filter]);

  async function handleCreate() {
    setError("");
    if (!name.trim() || !phone.trim()) {
      setError("请填写姓名和手机号");
      return;
    }
    if (!createMode) return;

    startTransition(async () => {
      try {
        const res = await fetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            phone: phone.trim(),
            type: createMode,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || "创建失败");
          return;
        }
        setUsers((prev) => [data.user, ...prev]);
        setName("");
        setPhone("");
        setCreateMode(null);
        if (data.temporaryPassword) {
          alert(
            `${data.user.name} 已创建成功。\n初始临时密码：${data.temporaryPassword}\n请尽快通过“改密码”改成强密码。`,
          );
        }
      } catch {
        setError("网络错误，请重试");
      }
    });
  }

  const [resetTarget, setResetTarget] = useState<PublicAppUser | null>(null);
  const [newPassword, setNewPassword] = useState("");

  async function toggleStatus(user: PublicAppUser) {
    const newStatus = user.status === "active" ? "disabled" : "active";
    startTransition(async () => {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(user.openid)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: newStatus }),
        });
        const data = await res.json();
        if (res.ok && data.user) {
          setUsers((prev) =>
            prev.map((u) => (u.openid === user.openid ? data.user : u)),
          );
        } else if (data.error) {
          setError(data.error);
        }
      } catch {
        // silent
      }
    });
  }

  async function handleResetPassword() {
    if (!resetTarget || !newPassword.trim()) return;
    setError("");
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/users/${encodeURIComponent(resetTarget.openid)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: newPassword.trim() }),
          },
        );
        const data = await res.json();
        if (res.ok) {
          setResetTarget(null);
          setNewPassword("");
          setError("");
          alert(`已成功为 ${resetTarget.name} 重置密码`);
        } else {
          setError(data.error || "重置失败");
        }
      } catch {
        setError("网络错误");
      }
    });
  }

  function roleDetailLabel(user: PublicAppUser): string {
    if (user.role === "leader" && user.leaderKind === "delegated") {
      return "副负责人（主账号授权）";
    }
    if (user.role === "leader") return "负责人";
    return roleLabels[user.role] ?? user.role;
  }

  function showEnvRowInFilter(): boolean {
    return filter === "all" || filter === "leader";
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <WorkspaceSection
            title="账号操作"
            description="左侧主区域负责新增、筛选和后续账号维护。"
          >
            <div className="flex flex-wrap items-center gap-3">
              <WorkspaceActionButton
                type="button"
                onClick={() =>
                  setCreateMode(createMode === "supervisor" ? null : "supervisor")
                }
                tone="green"
              >
                {createMode === "supervisor" ? "取消" : "添加主管"}
              </WorkspaceActionButton>
              {canDelegate ? (
                <WorkspaceActionButton
                  type="button"
                  onClick={() =>
                    setCreateMode(
                      createMode === "delegated_leader" ? null : "delegated_leader",
                    )
                  }
                  tone="amber"
                  outline
                >
                  {createMode === "delegated_leader" ? "取消" : "添加副负责人"}
                </WorkspaceActionButton>
              ) : (
                <span className="text-xs text-slate-400">
                  仅主负责人可添加副负责人（请使用主账号手机号登录）
                </span>
              )}

              <div className="ml-auto flex flex-wrap gap-2">
                {(["all", "leader", "supervisor", "specialist"] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setFilter(f)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                      filter === f
                        ? "bg-green-100 text-green-800"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {f === "all" ? "全部" : f === "leader" ? "负责人" : roleLabels[f]}
                  </button>
                ))}
              </div>
            </div>
          </WorkspaceSection>

          {createMode && (
            <WorkspaceSection
              title={createMode === "delegated_leader" ? "新建副负责人" : "新建主管"}
              description="创建成功后会显示一次性临时密码，请立即告知对应人员，并要求首次使用后尽快改密。"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className="flex flex-col gap-1.5 text-sm text-gray-700">
                  <span>姓名</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={
                      createMode === "delegated_leader" ? "副负责人姓名" : "主管姓名"
                    }
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 outline-none transition focus:border-green-400"
                  />
                </label>
                <label className="flex flex-col gap-1.5 text-sm text-gray-700">
                  <span>手机号</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="11 位手机号"
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 outline-none transition focus:border-green-400"
                  />
                </label>
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <WorkspaceActionButton
                type="button"
                onClick={handleCreate}
                disabled={isPending}
                tone={createMode === "delegated_leader" ? "amber" : "green"}
              >
                {isPending ? "提交中…" : "确认创建"}
              </WorkspaceActionButton>
            </WorkspaceSection>
          )}
        </div>

        <WorkspaceSection
          title="角色与权限"
          description="右侧固定说明区，和知识库页右侧辅助说明区保持同样使用方式。"
        >
          <ul className="space-y-3 text-sm leading-6 text-slate-600">
            <li>
              <span className="font-medium text-slate-800">主负责人</span>
              ：在 Vercel 环境变量{" "}
              <code className="rounded bg-slate-100 px-1 text-xs">
                LEADER_ACCOUNTS
              </code>{" "}
              中配置（当前主账号手机号优先取{" "}
              <code className="rounded bg-slate-100 px-1 text-xs">
                PRIMARY_LEADER_PHONE
              </code>{" "}
              ，未设置则为列表第一条）。
            </li>
            <li>
              <span className="font-medium text-slate-800">副负责人</span>
              ：仅主负责人可创建，生成一次性临时密码，权限与负责人相同。
            </li>
            <li>
              <span className="font-medium text-slate-800">主管</span>
              ：由负责人创建，用于登录 PC 处理复核与知识库。
            </li>
            <li>
              <span className="font-medium text-slate-800">专员</span>
              ：仅通过小程序微信登录自动注册，无 PC 权限。
            </li>
          </ul>
          {primaryPhoneHint ? (
            <div className="mt-4 rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <p className="text-xs font-medium tracking-wide text-slate-500">
                当前主负责人手机号
              </p>
              <p className="mt-2 font-mono text-sm font-semibold text-slate-900">
                {primaryPhoneHint}
              </p>
            </div>
          ) : null}
        </WorkspaceSection>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <WorkspaceMetric label="环境内负责人" value={envSummaries.length} />
        <WorkspaceMetric label="副负责人" value={delegatedCount} tone="amber" />
        <WorkspaceMetric label="主管" value={supervisorCount} tone="blue" />
        <WorkspaceMetric label="专员" value={specialistCount} tone="violet" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <WorkspaceSection
          title="账号列表"
          description="主数据区只放账号列表和直接操作。"
        >
          <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 py-3 font-medium text-gray-500">姓名</th>
                  <th className="px-4 py-3 font-medium text-gray-500">
                    角色 / 权限说明
                  </th>
                  <th className="px-4 py-3 font-medium text-gray-500">手机号</th>
                  <th className="px-4 py-3 font-medium text-gray-500">状态</th>
                  <th className="px-4 py-3 font-medium text-gray-500">注册时间</th>
                  <th className="px-4 py-3 font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody>
                {showEnvRowInFilter() &&
                  envSummaries.map((row) => (
                    <tr
                      key={`env-${row.phone}`}
                      className="border-b border-gray-50 bg-slate-50/80"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">负责人</td>
                      <td className="px-4 py-3 text-gray-700">
                        {row.slot === "primary" ? (
                          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-medium text-emerald-800">
                            主负责人（环境配置）
                          </span>
                        ) : (
                          <span className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-800">
                            负责人（环境配置）
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-600">{row.phone}</td>
                      <td className="px-4 py-3">
                        <span className="inline-block rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                          正常
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-400">—</td>
                      <td className="px-4 py-3 text-xs text-gray-400">
                        在 Vercel 中修改
                      </td>
                    </tr>
                  ))}

                {filteredUsers.length === 0 &&
                !(showEnvRowInFilter() && envSummaries.length > 0) ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      暂无数据
                    </td>
                  </tr>
                ) : null}

                {filteredUsers.map((user) => {
                  const st = statusLabels[user.status] ?? statusLabels.active;
                  const canToggleDelegated =
                    user.role === "leader" && user.leaderKind === "delegated"
                      ? canDelegate
                      : user.role !== "leader";

                  return (
                    <tr
                      key={user.openid}
                      className="border-b border-gray-50 last:border-0"
                    >
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {user.name}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {roleDetailLabel(user)}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-600">
                        {user.phone || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${st.cls}`}
                        >
                          {st.text}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {new Date(user.createdAt).toLocaleDateString("zh-CN")}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          {canToggleDelegated && (
                            <button
                              type="button"
                              onClick={() => toggleStatus(user)}
                              disabled={isPending}
                              className={`rounded-lg px-3 py-1 text-xs font-medium transition ${
                                user.status === "active"
                                  ? "bg-red-50 text-red-700 hover:bg-red-100"
                                  : "bg-green-50 text-green-700 hover:bg-green-100"
                              }`}
                            >
                              {user.status === "active" ? "停用" : "启用"}
                            </button>
                          )}
                          {(user.role === "supervisor" ||
                            (user.role === "leader" &&
                              user.leaderKind === "delegated")) && (
                            <button
                              type="button"
                              onClick={() => {
                                setResetTarget(user);
                                setNewPassword("");
                                setError("");
                              }}
                              className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-200"
                            >
                              改密码
                            </button>
                          )}
                          {!canToggleDelegated &&
                            user.role !== "supervisor" &&
                            !(
                              user.role === "leader" && user.leaderKind === "delegated"
                            ) && <span className="text-xs text-gray-400">—</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </WorkspaceSection>

        <WorkspaceSection
          title="管理提示"
          description="右侧只放维护提示和当前筛选结果，结构上对齐知识库的辅助区。"
        >
          <div className="space-y-3">
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <p className="text-xs font-medium tracking-wide text-slate-500">
                当前筛选
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {filter === "all"
                  ? "全部账号"
                  : filter === "leader"
                    ? "负责人"
                    : roleLabels[filter]}
              </p>
            </div>
            <div className="rounded-2xl bg-blue-50 p-4 ring-1 ring-blue-200">
              <p className="text-sm font-medium text-blue-900">创建主管 / 副负责人</p>
              <p className="mt-2 text-sm leading-6 text-blue-800">
                建议先创建账号，再立即分发临时密码，避免账号创建后长期无人接管。
              </p>
            </div>
            <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-200">
              <p className="text-sm font-medium text-amber-900">环境负责人账号</p>
              <p className="mt-2 text-sm leading-6 text-amber-800">
                环境配置里的负责人账号仍需在 Vercel 环境变量中维护，页面只做展示。
              </p>
            </div>
          </div>
        </WorkspaceSection>
      </div>

      {/* 重置密码弹窗 */}
      {resetTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              重置密码 — {resetTarget.name}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              角色：{roleDetailLabel(resetTarget)}　手机号：{resetTarget.phone}
            </p>
            <label className="mt-4 flex flex-col gap-1.5 text-sm text-gray-700">
              <span>新密码</span>
              <input
                type="text"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="输入新密码（不少于 8 位）"
                className="rounded-xl border border-gray-200 px-4 py-2.5 outline-none transition focus:border-green-400"
              />
            </label>
            {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-3">
              <WorkspaceActionButton
                type="button"
                onClick={() => setResetTarget(null)}
                tone="slate"
                outline
              >
                取消
              </WorkspaceActionButton>
              <WorkspaceActionButton
                type="button"
                onClick={handleResetPassword}
                disabled={isPending || newPassword.trim().length < 8}
                tone="green"
              >
                {isPending ? "保存中…" : "确认修改"}
              </WorkspaceActionButton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
