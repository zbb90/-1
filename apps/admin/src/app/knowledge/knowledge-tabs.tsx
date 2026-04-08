"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TabKey =
  | "rules"
  | "consensus"
  | "external-purchases"
  | "old-items"
  | "operations";

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "rules", label: "常规问题规则" },
  { key: "consensus", label: "共识解释" },
  { key: "external-purchases", label: "外购清单" },
  { key: "old-items", label: "旧品清单" },
  { key: "operations", label: "操作知识" },
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

  // Inline editing
  const [editId, setEditId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Row>({});
  const [editSaving, setEditSaving] = useState(false);

  // Import
  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Search
  const [search, setSearch] = useState("");

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
    setShowImport(false);
    setSaveMsg("");
    setImportMsg("");
    setEditId(null);
    setSearch("");
  }, [activeTab, fetchRows]);

  function switchTab(tab: TabKey) {
    setActiveTab(tab);
  }

  function idField(tab: TabKey) {
    return tab === "rules"
      ? "rule_id"
      : tab === "consensus"
        ? "consensus_id"
        : tab === "operations"
          ? "op_id"
          : "item_id";
  }

  function primaryField(tab: TabKey) {
    return tab === "rules"
      ? "条款标题"
      : tab === "consensus" || tab === "operations"
        ? "标题"
        : "物品名称";
  }

  function closeEdit() {
    setEditId(null);
    setEditFields({});
  }

  async function toggleStatus(row: Row) {
    const id = row[idField(activeTab)];
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
        setSaveMsg("添加成功");
        setShowAdd(false);
        setAddFields({});
        await fetchRows(activeTab);
      } else {
        setSaveMsg(`失败：${json.message}`);
      }
    } catch {
      setSaveMsg("网络错误");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(row: Row) {
    setEditId(row[idField(activeTab)]);
    setEditFields({ ...row });
  }

  async function saveEdit() {
    if (!editId) return;
    setEditSaving(true);
    try {
      const res = await fetch(`/api/knowledge/${activeTab}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editId, data: editFields }),
      });
      const json = await res.json();
      if (json.ok) {
        closeEdit();
        await fetchRows(activeTab);
      } else {
        alert(`保存失败：${json.message}`);
      }
    } catch {
      alert("网络错误，请稍后重试。");
    } finally {
      setEditSaving(false);
    }
  }

  async function handleImport() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setImportMsg("请先选择 Excel 文件");
      return;
    }
    setImporting(true);
    setImportMsg("");
    try {
      const form = new FormData();
      form.append("table", activeTab);
      form.append("mode", importMode);
      form.append("file", file);
      const res = await fetch("/api/knowledge/import", { method: "POST", body: form });
      const json = await res.json();
      if (json.ok) {
        setImportMsg(json.message);
        setShowImport(false);
        if (fileRef.current) fileRef.current.value = "";
        await fetchRows(activeTab);
      } else {
        setImportMsg(`导入失败：${json.message}`);
      }
    } catch {
      setImportMsg("网络错误，导入失败。");
    } finally {
      setImporting(false);
    }
  }

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const currentPrimaryField = primaryField(activeTab);
  const currentEditTitle = editFields[currentPrimaryField] || editId || "";

  const filteredRows = search.trim()
    ? rows.filter((r) =>
        Object.values(r).some((v) => v.toLowerCase().includes(search.toLowerCase())),
      )
    : rows;

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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-500">
            共 <span className="font-semibold text-gray-800">{rows.length}</span> 条
            {search.trim() && filteredRows.length !== rows.length && (
              <span className="ml-1 text-amber-600">
                （筛选出 {filteredRows.length} 条）
              </span>
            )}
          </p>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索关键字..."
            className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200 w-48"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* 下载模板 */}
          <a
            href={`/api/knowledge/export?table=${activeTab}&type=template`}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            下载模板
          </a>
          {/* 导出数据 */}
          <a
            href={`/api/knowledge/export?table=${activeTab}&type=data`}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            导出数据
          </a>
          {/* 导入 */}
          <button
            onClick={() => {
              setShowImport(!showImport);
              setImportMsg("");
            }}
            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            {showImport ? "取消导入" : "Excel 导入"}
          </button>
          {/* 新增 */}
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
      </div>

      {/* 提示消息 */}
      {(saveMsg || importMsg) && (
        <div
          className={`rounded-xl px-4 py-2 text-sm ${
            (saveMsg || importMsg).includes("成功")
              ? "bg-green-50 text-green-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {saveMsg || importMsg}
        </div>
      )}

      {/* Excel 导入面板 */}
      {showImport && (
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 space-y-4">
          <h3 className="text-base font-semibold text-gray-800">Excel 文件导入</h3>
          <p className="text-sm text-gray-500">
            请先
            <a
              href={`/api/knowledge/export?table=${activeTab}&type=template`}
              className="mx-1 text-green-700 underline"
            >
              下载模板
            </a>
            ，按模板格式填写后上传 .xlsx 文件。
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-green-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-green-700 hover:file:bg-green-100"
            />
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="radio"
                name="import-mode"
                value="append"
                checked={importMode === "append"}
                onChange={() => setImportMode("append")}
              />
              追加到现有数据
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="radio"
                name="import-mode"
                value="replace"
                checked={importMode === "replace"}
                onChange={() => setImportMode("replace")}
              />
              <span className="text-red-600">替换全部数据</span>
            </label>
          </div>
          <button
            onClick={handleImport}
            disabled={importing}
            className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-blue-300"
          >
            {importing ? "导入中..." : "开始导入"}
          </button>
        </div>
      )}

      {/* 新增表单 */}
      {showAdd && (
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
          <h3 className="text-base font-semibold text-gray-800 mb-4">新增条目</h3>
          <AddForm tab={activeTab} fields={addFields} onChange={setAddFields} />
          <div className="mt-4 flex items-center gap-4">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="rounded-xl bg-green-700 px-5 py-2.5 text-sm font-medium text-white disabled:bg-green-400"
            >
              {saving ? "保存中..." : "保存"}
            </button>
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
          暂无数据。可点击「+ 新增条目」手动添加，或使用「Excel 导入」批量导入。
        </div>
      ) : (
        <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 text-xs text-gray-500">
            <p>表格支持横向滚动，右侧操作列已固定，可直接点任意行进入编辑。</p>
            <p className="hidden md:block">当前显示 {filteredRows.length} 条</p>
          </div>
          <div className="overflow-x-auto">
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
                  <th className="sticky right-0 z-20 border-l border-gray-100 bg-gray-50 px-4 py-3 text-left text-xs font-medium text-gray-500 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.25)]">
                    操作
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredRows.map((row, idx) => {
                  const rid = row[idField(activeTab)] || String(idx);
                  const isDisabled = row["状态"] === "停用";
                  const isEditing = editId === rid;
                  return (
                    <tr
                      key={rid}
                      onClick={() => startEdit(row)}
                      className={`cursor-pointer ${isDisabled ? "opacity-50" : ""} ${isEditing ? "bg-amber-50" : "hover:bg-gray-50"}`}
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
                      <td
                        className={`sticky right-0 whitespace-nowrap border-l border-gray-100 px-4 py-3 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.25)] ${
                          isEditing ? "bg-amber-50" : "bg-white"
                        }`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => startEdit(row)}
                            className="rounded-lg bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
                          >
                            编辑
                          </button>
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {editId && (
        <>
          <div
            className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[1px]"
            onClick={closeEdit}
          />
          <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-3xl flex-col border-l border-amber-200 bg-white shadow-2xl">
            <div className="border-b border-amber-100 bg-amber-50 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-amber-700">正在编辑</p>
                  <h3 className="mt-1 text-lg font-semibold text-gray-900">
                    {currentEditTitle || "未命名条目"}
                  </h3>
                  <p className="mt-1 text-sm text-gray-500">
                    编号：{editId}。在右侧直接修改，保存后会自动刷新表格。
                  </p>
                </div>
                <button
                  onClick={closeEdit}
                  className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                >
                  关闭
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-6">
              <AddForm tab={activeTab} fields={editFields} onChange={setEditFields} />
            </div>

            <div className="border-t border-gray-100 bg-white px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-500">
                  无需返回页面顶部，右侧面板可随时保存或关闭。
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={closeEdit}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    取消
                  </button>
                  <button
                    onClick={saveEdit}
                    disabled={editSaving}
                    className="rounded-xl bg-amber-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-amber-700 disabled:bg-amber-300"
                  >
                    {editSaving ? "保存中..." : "保存修改"}
                  </button>
                </div>
              </div>
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

const FIELD_DEFS: Record<
  TabKey,
  Array<{ key: string; label: string; required?: boolean; multiline?: boolean }>
> = {
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
  operations: [
    { key: "资料类型", label: "资料类型", required: true },
    { key: "标题", label: "标题", required: true },
    { key: "适用对象", label: "适用对象" },
    { key: "关键词", label: "关键词" },
    { key: "操作内容", label: "操作内容", multiline: true },
    { key: "检核要点", label: "检核要点", multiline: true },
    { key: "解释说明", label: "解释说明", multiline: true },
    { key: "来源文件", label: "来源文件" },
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
              className="min-h-24 rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200"
              placeholder={def.label}
            />
          ) : (
            <input
              value={fields[def.key] ?? ""}
              onChange={(e) => onChange({ ...fields, [def.key]: e.target.value })}
              className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200"
              placeholder={def.label}
            />
          )}
        </label>
      ))}
    </div>
  );
}
