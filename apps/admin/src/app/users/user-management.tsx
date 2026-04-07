"use client";

import { useMemo, useState, useTransition } from "react";
import type { AppUser } from "@/lib/user-store";

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
  initialUsers: AppUser[];
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
      } catch {
        setError("网络错误，请重试");
      }
    });
  }

  const [resetTarget, setResetTarget] = useState<AppUser | null>(null);
  const [newPassword, setNewPassword] = useState("");

  async function toggleStatus(user: AppUser) {
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

  function roleDetailLabel(user: AppUser): string {
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
      {/* 权限说明 */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-6 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">角色与权限</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-600">
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
            ，未设置则为列表第一条）。可管理副负责人、主管与全员账号。
          </li>
          <li>
            <span className="font-medium text-slate-800">副负责人</span>
            ：仅主负责人在本页「添加副负责人」创建，初始密码为手机号，权限与负责人相同（除「授权副负责人」仅主账号可用）。
          </li>
          <li>
            <span className="font-medium text-slate-800">主管</span>
            ：由负责人在此创建，登录 PC 处理复核与知识库。
          </li>
          <li>
            <span className="font-medium text-slate-800">专员</span>
            ：仅通过小程序微信登录自动注册，无 PC 权限。
          </li>
        </ul>
        {primaryPhoneHint ? (
          <p className="mt-3 text-xs text-slate-500">
            当前识别的主负责人手机号为：{" "}
            <span className="font-mono font-medium text-slate-700">
              {primaryPhoneHint}
            </span>
          </p>
        ) : null}
      </div>

      {/* 操作区 */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() =>
            setCreateMode(createMode === "supervisor" ? null : "supervisor")
          }
          className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-green-800"
        >
          {createMode === "supervisor" ? "取消" : "添加主管"}
        </button>
        {canDelegate ? (
          <button
            type="button"
            onClick={() =>
              setCreateMode(
                createMode === "delegated_leader" ? null : "delegated_leader",
              )
            }
            className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-2.5 text-sm font-medium text-amber-900 transition hover:bg-amber-100"
          >
            {createMode === "delegated_leader" ? "取消" : "添加副负责人"}
          </button>
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

      {createMode && (
        <div
          className={`rounded-2xl border p-6 space-y-4 ${
            createMode === "delegated_leader"
              ? "border-amber-200 bg-amber-50/50"
              : "border-green-100 bg-green-50/50"
          }`}
        >
          <h3 className="text-sm font-semibold text-gray-900">
            {createMode === "delegated_leader" ? "新建副负责人" : "新建主管"}
          </h3>
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
                placeholder="11 位手机号（初始密码同手机号）"
                className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 outline-none transition focus:border-green-400"
              />
            </label>
          </div>
          <p className="text-xs text-gray-500">
            初始密码为手机号本身，登录后请及时修改为强密码（后续版本可支持强制改密）。
          </p>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="button"
            onClick={handleCreate}
            disabled={isPending}
            className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-green-800 disabled:bg-green-400"
          >
            {isPending ? "提交中…" : "确认创建"}
          </button>
        </div>
      )}

      {/* 统计 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs text-gray-500">环境内负责人</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{envSummaries.length}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs text-gray-500">副负责人</p>
          <p className="mt-1 text-2xl font-bold text-amber-700">{delegatedCount}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs text-gray-500">主管</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{supervisorCount}</p>
        </div>
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-gray-200">
          <p className="text-xs text-gray-500">专员</p>
          <p className="mt-1 text-2xl font-bold text-gray-900">{specialistCount}</p>
        </div>
      </div>

      {/* 表格 */}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="px-4 py-3 font-medium text-gray-500">姓名</th>
              <th className="px-4 py-3 font-medium text-gray-500">角色 / 权限说明</th>
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
                  <td className="px-4 py-3 text-xs text-gray-400">在 Vercel 中修改</td>
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
                <tr key={user.openid} className="border-b border-gray-50 last:border-0">
                  <td className="px-4 py-3 font-medium text-gray-900">{user.name}</td>
                  <td className="px-4 py-3 text-gray-700">{roleDetailLabel(user)}</td>
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
                placeholder="输入新密码（不少于 6 位）"
                className="rounded-xl border border-gray-200 px-4 py-2.5 outline-none transition focus:border-green-400"
              />
            </label>
            {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setResetTarget(null)}
                className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleResetPassword}
                disabled={isPending || newPassword.trim().length < 6}
                className="rounded-xl bg-green-700 px-5 py-2 text-sm font-medium text-white transition hover:bg-green-800 disabled:bg-green-400"
              >
                {isPending ? "保存中…" : "确认修改"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
