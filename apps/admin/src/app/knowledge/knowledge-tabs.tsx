"use client";

import { useCallback, useEffect, useState } from "react";

type TabKey = "rules" | "consensus" | "external-purchases" | "old-items";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "rules", label: "常规问题规则" },
  { key: "consensus", label: "共识解释" },
  { key: "external-purchases", label: "外购清单" },
  { key: "old-items", label: "旧品清单" },
];

type Row = Record<string, string>;

export function KnowledgeTabs() {
  const [activeTab, setActiveTab] = useState<TabKey>("rules");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addFields, setAddFields] = useState<Row>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const fetchRows = useCallback(async (tab: TabKey) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/knowledge/${tab}`);
      const json = await res.json();
      if (json.ok) {
        setRows(json.data ?? []);
      } else {
        setError(json.message || "读取失败");
        setRows([]);
      }
    } catch {
      setError("网络错误，无法读取知识库数据。");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRows(activeTab);
    setShowAdd(false);
    setSaveMsg("");
  }, [activeTab, fetchRows]);

  function switchTab(tab: TabKey) {
    setActiveTab(tab);
    setShowAdd(false);
    setSaveMsg("");
    setAddFields({});
  }

  async function toggleStatus(row: Row) {
    const idField =
      activeTab === "rules"
        ? "rule_id"
        : activeTab === "consensus"
          ? "consensus_id"
          : "item_id";
    const id = row[idField];
    const newStatus = row["状态"] === "停用" ? "启用" : "停用";

    try {
      const res = await fetch(`/api/knowledge/${activeTab}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      const json = await res.json();
      if (json.ok) {
        await fetchRows(activeTab);
      } else {
        alert(`操作失败：${json.message}`);
      }
    } catch {
      alert("网络错误，请稍后重试。");
    }
  }

  async function handleAdd() {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`/api/knowledge/${activeTab}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...addFields, 状态: addFields["状态"] || "启用" }),
      });
      const json = await res.json();
      if (json.ok) {
        setSaveMsg("✓ 添加成功");
        setShowAdd(false);
        setAddFields({});
        await fetchRows(activeTab);
      } else {
        setSaveMsg(`✗ ${json.message}`);
      }
    } catch {
      setSaveMsg("✗ 网络错误");
    } finally {
      setSaving(false);
    }
  }

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-4">
      {/* Tab 切换 */}
      <div className="flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? "bg-green-700 text-white"
                : "bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 工具栏 */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">
          共 <span className="font-semibold text-gray-800">{rows.length}</span>{" "}
          条记录
        </p>
        <button
          onClick={() => {
            setShowAdd(!showAdd);
            setSaveMsg("");
          }}
          className="rounded-xl bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-800"
        >
          {showAdd ? "取消" : "+ 新增条目"}
        </button>
      </div>

      {/* 新增表单 */}
      {showAdd && (
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
          <h3 className="text-base font-semibold text-gray-800 mb-4">
            新增条目
          </h3>
          <AddForm
            tab={activeTab}
            fields={addFields}
            onChange={setAddFields}
          />
          <div className="mt-4 flex items-center gap-4">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-medium text-white disabled:bg-green-400"
            >
              {saving ? "保存中..." : "保存"}
            </button>
            {saveMsg && (
              <p
                className={`text-sm ${saveMsg.startsWith("✓") ? "text-green-600" : "text-red-600"}`}
              >
                {saveMsg}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 数据表格 */}
      {loading ? (
        <div className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
          加载中...
        </div>
      ) : error ? (
        <div className="rounded-2xl bg-red-50 p-6 text-sm text-red-700 ring-1 ring-red-200">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl bg-white p-8 text-center text-sm text-gray-500 shadow-sm ring-1 ring-gray-200">
          暂无数据。
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50">
                {headers.map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500"
                  >
                    {h}
                  </th>
                ))}
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">
                  操作
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((row, idx) => {
                const idField =
                  activeTab === "rules"
                    ? "rule_id"
                    : activeTab === "consensus"
                      ? "consensus_id"
                      : "item_id";
                const isDisabled = row["状态"] === "停用";
                return (
                  <tr
                    key={row[idField] || idx}
                    className={isDisabled ? "opacity-50" : ""}
                  >
                    {headers.map((h) => (
                      <td
                        key={h}
                        className="max-w-[200px] truncate px-4 py-3 text-gray-800"
                        title={row[h]}
                      >
                        {row[h] || "-"}
                      </td>
                    ))}
                    <td className="whitespace-nowrap px-4 py-3">
                      <button
                        onClick={() => toggleStatus(row)}
                        className={`rounded-lg px-3 py-1 text-xs font-medium ${
                          isDisabled
                            ? "bg-green-50 text-green-700 hover:bg-green-100"
                            : "bg-red-50 text-red-700 hover:bg-red-100"
                        }`}
                      >
                        {isDisabled ? "启用" : "停用"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const FIELD_DEFS: Record<TabKey, Array<{ key: string; label: string; required?: boolean; multiline?: boolean }>> = {
  rules: [
    { key: "问题分类", label: "问题分类", required: true },
    { key: "问题子类或关键词", label: "关键词" },
    { key: "场景描述", label: "场景描述", multiline: true },
    { key: "触发条件", label: "触发条件" },
    { key: "是否扣分", label: "是否扣分（是/否）" },
    { key: "扣分分值", label: "扣分分值" },
    { key: "条款编号", label: "条款编号" },
    { key: "条款标题", label: "条款标题" },
    { key: "条款关键片段", label: "条款关键片段", multiline: true },
    { key: "条款解释", label: "条款解释", multiline: true },
    { key: "共识来源", label: "共识来源" },
    { key: "示例问法", label: "示例问法" },
    { key: "备注", label: "备注" },
  ],
  consensus: [
    { key: "标题", label: "标题", required: true },
    { key: "关联条款编号", label: "关联条款编号" },
    { key: "适用场景", label: "适用场景", multiline: true },
    { key: "解释内容", label: "解释内容", multiline: true },
    { key: "判定结果", label: "判定结果" },
    { key: "扣分分值", label: "扣分分值" },
    { key: "关键词", label: "关键词" },
    { key: "示例问题", label: "示例问题" },
    { key: "来源文件", label: "来源文件" },
    { key: "备注", label: "备注" },
  ],
  "external-purchases": [
    { key: "物品名称", label: "物品名称", required: true },
    { key: "别名或关键词", label: "别名或关键词" },
    { key: "是否允许外购", label: "是否允许外购（是/否）" },
    { key: "命中的清单或共识名称", label: "命中的清单名称" },
    { key: "依据来源", label: "依据来源" },
    { key: "说明", label: "说明", multiline: true },
    { key: "备注", label: "备注" },
  ],
  "old-items": [
    { key: "物品名称", label: "物品名称", required: true },
    { key: "别名或常见叫法", label: "别名或常见叫法" },
    { key: "是否旧品", label: "是否旧品（是/否）" },
    { key: "命中的清单名称", label: "命中的清单名称" },
    { key: "识别备注", label: "识别备注", multiline: true },
    { key: "参考图片名称", label: "参考图片名称" },
    { key: "备注", label: "备注" },
  ],
};

function AddForm({
  tab,
  fields,
  onChange,
}: {
  tab: TabKey;
  fields: Row;
  onChange: (f: Row) => void;
}) {
  const defs = FIELD_DEFS[tab];

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {defs.map((def) => (
        <label
          key={def.key}
          className={`flex flex-col gap-1.5 text-sm text-gray-700 ${def.multiline ? "md:col-span-2" : ""}`}
        >
          <span>
            {def.label}
            {def.required && <span className="text-red-500 ml-0.5">*</span>}
          </span>
          {def.multiline ? (
            <textarea
              value={fields[def.key] ?? ""}
              onChange={(e) => onChange({ ...fields, [def.key]: e.target.value })}
              className="min-h-24 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none"
              placeholder={def.label}
            />
          ) : (
            <input
              value={fields[def.key] ?? ""}
              onChange={(e) => onChange({ ...fields, [def.key]: e.target.value })}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none"
              placeholder={def.label}
            />
          )}
        </label>
      ))}
    </div>
  );
}
