"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { TagEditor } from "@/components/tag-editor";

type TabKey = "rules" | "consensus" | "external-purchases" | "old-items" | "operations";
type Row = Record<string, string>;
type KnowledgeLinkType =
  | "references"
  | "supports"
  | "related"
  | "supersedes"
  | "contradicts";

type LinkItem = {
  id: string;
  sourceTable: TabKey;
  sourceId: string;
  targetTable: TabKey;
  targetId: string;
  sourceLabel: string;
  targetLabel: string;
  linkType: KnowledgeLinkType;
  source: "manual" | "derived";
};

type HealthRuleItem = {
  ruleId: string;
  clauseNo: string;
  clauseTitle: string;
  hitCount: number;
  lastHitAt: string;
  hasConsensusSource: boolean;
  linkCount: number;
};

type HealthData = {
  summary: {
    totalRules: number;
    rulesWithConsensus: number;
    consensusCoveragePct: number;
    linkedRules: number;
    linkCoveragePct: number;
    orphanRules: number;
    activeRules30d: number;
    activeRules30dPct: number;
    coldRules: number;
  };
  topHitRules: HealthRuleItem[];
  orphanRules: HealthRuleItem[];
  consensusGapRules: HealthRuleItem[];
  coldRules: HealthRuleItem[];
  highTrafficWithoutConsensus: HealthRuleItem[];
};

type TagStatsItem = {
  tag: string;
  count: number;
};

type TagEntryItem = {
  table: TabKey;
  id: string;
  label: string;
};

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: "rules", label: "常规问题规则" },
  { key: "consensus", label: "共识解释" },
  { key: "external-purchases", label: "外购清单" },
  { key: "old-items", label: "旧品清单" },
  { key: "operations", label: "操作知识" },
];

const LINK_TYPE_OPTIONS: Array<{ value: KnowledgeLinkType; label: string }> = [
  { value: "references", label: "引用" },
  { value: "supports", label: "支撑" },
  { value: "related", label: "关联" },
  { value: "supersedes", label: "替代" },
  { value: "contradicts", label: "冲突" },
];

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

function defaultTargetTable(tab: TabKey): TabKey {
  return tab === "consensus" ? "rules" : "consensus";
}

function formatDateLabel(value: string) {
  if (!value) return "未命中";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function buildRowOptionLabel(tab: TabKey, row: Row) {
  const id = row[idField(tab)] || "-";
  const title = row[primaryField(tab)] || "-";
  return `${id}｜${title}`;
}

function normalizeTags(raw: string) {
  return [...new Set((raw || "")
    .split(/[，,、；;\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean))];
}

function HealthList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: HealthRuleItem[];
  emptyText: string;
}) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-gray-500">{emptyText}</p>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map((item) => (
            <div
              key={`${title}-${item.ruleId}`}
              className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2"
            >
              <p className="text-sm font-medium text-gray-900">
                {item.ruleId}｜{item.clauseTitle || "-"}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                条款号 {item.clauseNo || "-"} · 命中 {item.hitCount} 次 · 关联 {item.linkCount} 条
                · 最近 {formatDateLabel(item.lastHitAt)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function KnowledgeTabs() {
  const [activeTab, setActiveTab] = useState<TabKey>("rules");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [addFields, setAddFields] = useState<Row>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<Row>({});
  const [editSaving, setEditSaving] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [search, setSearch] = useState("");
  const [health, setHealth] = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState("");
  const [tagStats, setTagStats] = useState<TagStatsItem[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [selectedTagEntries, setSelectedTagEntries] = useState<TagEntryItem[]>([]);
  const [tagLoading, setTagLoading] = useState(false);
  const [tagError, setTagError] = useState("");
  const [forwardLinks, setForwardLinks] = useState<LinkItem[]>([]);
  const [backwardLinks, setBackwardLinks] = useState<LinkItem[]>([]);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkMsg, setLinkMsg] = useState("");
  const [targetTable, setTargetTable] = useState<TabKey>(defaultTargetTable("rules"));
  const [targetId, setTargetId] = useState("");
  const [targetOptions, setTargetOptions] = useState<Row[]>([]);
  const [targetLoading, setTargetLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

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

  const fetchHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError("");
    try {
      const res = await fetch("/api/knowledge/health");
      const json = await res.json();
      if (json.ok) {
        setHealth(json.data as HealthData);
      } else {
        setHealthError(json.message || "读取健康度失败");
      }
    } catch {
      setHealthError("网络错误，无法读取知识健康度。");
    } finally {
      setHealthLoading(false);
    }
  }, []);

  const fetchTags = useCallback(async (tag?: string) => {
    setTagLoading(true);
    setTagError("");
    try {
      const url = tag ? `/api/knowledge/tags?tag=${encodeURIComponent(tag)}` : "/api/knowledge/tags";
      const res = await fetch(url);
      const json = await res.json();
      if (json.ok) {
        setTagStats((json.data?.tags ?? []) as TagStatsItem[]);
        setSelectedTagEntries((json.data?.entries ?? []) as TagEntryItem[]);
      } else {
        setTagError(json.message || "读取标签失败");
      }
    } catch {
      setTagError("网络错误，无法读取标签信息。");
    } finally {
      setTagLoading(false);
    }
  }, []);

  const fetchLinks = useCallback(async (tab: TabKey, id: string) => {
    setLinkLoading(true);
    setLinkMsg("");
    try {
      const res = await fetch(`/api/knowledge/links?table=${tab}&id=${encodeURIComponent(id)}`);
      const json = await res.json();
      if (json.ok) {
        setForwardLinks((json.data?.forward ?? []) as LinkItem[]);
        setBackwardLinks((json.data?.backward ?? []) as LinkItem[]);
      } else {
        setLinkMsg(`读取关联失败：${json.message || "未知错误"}`);
        setForwardLinks([]);
        setBackwardLinks([]);
      }
    } catch {
      setLinkMsg("网络错误，无法读取关联条目。");
      setForwardLinks([]);
      setBackwardLinks([]);
    } finally {
      setLinkLoading(false);
    }
  }, []);

  const fetchTargetOptions = useCallback(async (tab: TabKey) => {
    setTargetLoading(true);
    try {
      const res = await fetch(`/api/knowledge/${tab}`);
      const json = await res.json();
      if (json.ok) {
        setTargetOptions((json.data ?? []) as Row[]);
      } else {
        setTargetOptions([]);
      }
    } catch {
      setTargetOptions([]);
    } finally {
      setTargetLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    fetchTags();
  }, [fetchHealth, fetchTags]);

  useEffect(() => {
    if (!selectedTag) {
      setSelectedTagEntries([]);
      return;
    }
    fetchTags(selectedTag);
  }, [selectedTag, fetchTags]);

  useEffect(() => {
    fetchRows(activeTab);
    setShowAdd(false);
    setShowImport(false);
    setSaveMsg("");
    setImportMsg("");
    setEditId(null);
    setSearch("");
  }, [activeTab, fetchRows]);

  useEffect(() => {
    if (!editId) {
      setForwardLinks([]);
      setBackwardLinks([]);
      setTargetId("");
      setLinkMsg("");
      return;
    }
    fetchLinks(activeTab, editId);
  }, [activeTab, editId, fetchLinks]);

  useEffect(() => {
    if (!editId) return;
    fetchTargetOptions(targetTable);
  }, [editId, targetTable, fetchTargetOptions]);

  function switchTab(tab: TabKey) {
    setActiveTab(tab);
  }

  function closeEdit() {
    setEditId(null);
    setEditFields({});
    setTargetId("");
    setLinkMsg("");
  }

  async function refreshAfterMutation(tab: TabKey) {
    await Promise.all([fetchRows(tab), fetchHealth(), fetchTags(selectedTag || undefined)]);
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
        await refreshAfterMutation(activeTab);
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
        await refreshAfterMutation(activeTab);
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
    setTargetTable(defaultTargetTable(activeTab));
    setTargetId("");
    setLinkMsg("");
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
        await refreshAfterMutation(activeTab);
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
        await refreshAfterMutation(activeTab);
      } else {
        setImportMsg(`导入失败：${json.message}`);
      }
    } catch {
      setImportMsg("网络错误，导入失败。");
    } finally {
      setImporting(false);
    }
  }

  async function handleAddLink() {
    if (!editId) return;
    if (!targetId.trim()) {
      setLinkMsg("请输入要关联的条目编号。");
      return;
    }

    setLinkLoading(true);
    setLinkMsg("");
    try {
      const res = await fetch("/api/knowledge/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceTable: activeTab,
          sourceId: editId,
          targetTable,
          targetId,
          linkType: "related",
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setLinkMsg("关联已保存。");
        setTargetId("");
        await Promise.all([fetchLinks(activeTab, editId), fetchHealth()]);
      } else {
        setLinkMsg(`保存失败：${json.message}`);
      }
    } catch {
      setLinkMsg("网络错误，关联保存失败。");
    } finally {
      setLinkLoading(false);
    }
  }

  async function handleDeleteLink(linkId: string) {
    if (!editId) return;
    setLinkLoading(true);
    setLinkMsg("");
    try {
      const res = await fetch("/api/knowledge/links", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: linkId }),
      });
      const json = await res.json();
      if (json.ok) {
        setLinkMsg("关联已删除。");
        await Promise.all([fetchLinks(activeTab, editId), fetchHealth()]);
      } else {
        setLinkMsg(`删除失败：${json.message}`);
      }
    } catch {
      setLinkMsg("网络错误，关联删除失败。");
    } finally {
      setLinkLoading(false);
    }
  }

  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const currentPrimaryField = primaryField(activeTab);
  const currentEditTitle = editFields[currentPrimaryField] || editId || "";
  const filteredRows = rows.filter((r) => {
    const searchMatched = search.trim()
      ? Object.values(r).some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(search.toLowerCase()),
        )
      : true;
    const tagMatched = selectedTag ? normalizeTags(r.tags || "").includes(selectedTag) : true;
    return searchMatched && tagMatched;
  });
  const selectedTargetOption = targetOptions.find((row) => row[idField(targetTable)] === targetId);

  return (
    <div className="space-y-4">
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

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">知识健康概览</h3>
            <p className="mt-1 text-sm text-gray-500">
              只读分析当前规则质量，不会改动任何原始知识数据。
            </p>
          </div>
          {healthLoading ? (
            <span className="text-sm text-gray-400">统计中...</span>
          ) : healthError ? (
            <span className="text-sm text-red-600">{healthError}</span>
          ) : null}
        </div>

        {health && (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <div className="rounded-xl bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500">规则总数</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">{health.summary.totalRules}</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500">有共识支撑</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {health.summary.rulesWithConsensus}
                </p>
                <p className="text-xs text-green-700">{health.summary.consensusCoveragePct}% 覆盖</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500">已建立关联</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {health.summary.linkedRules}
                </p>
                <p className="text-xs text-blue-700">{health.summary.linkCoveragePct}% 覆盖</p>
              </div>
              <div className="rounded-xl bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500">近 30 天有命中</p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {health.summary.activeRules30d}
                </p>
                <p className="text-xs text-emerald-700">{health.summary.activeRules30dPct}% 活跃</p>
              </div>
              <div className="rounded-xl bg-red-50 px-4 py-3 ring-1 ring-red-100">
                <p className="text-xs text-red-700">需关注</p>
                <p className="mt-1 text-2xl font-semibold text-red-800">
                  {health.summary.orphanRules + health.summary.coldRules}
                </p>
                <p className="text-xs text-red-600">
                  孤立规则 {health.summary.orphanRules}，冷规则 {health.summary.coldRules}
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <HealthList
                title="高频命中规则"
                items={health.topHitRules.slice(0, 5)}
                emptyText="暂无命中记录。"
              />
              <HealthList
                title="高频但缺少共识支撑"
                items={health.highTrafficWithoutConsensus.slice(0, 5)}
                emptyText="当前没有需要优先补共识的高频规则。"
              />
              <HealthList
                title="孤立规则"
                items={health.orphanRules.slice(0, 5)}
                emptyText="当前没有孤立规则。"
              />
              <HealthList
                title="长期未命中规则"
                items={health.coldRules.slice(0, 5)}
                emptyText="当前没有冷规则。"
              />
            </div>
          </>
        )}
      </div>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-gray-900">标签视图</h3>
            <p className="mt-1 text-sm text-gray-500">
              用标签做跨表聚合，快速查看规则、共识、清单之间的同主题知识。
            </p>
          </div>
          {tagLoading ? (
            <span className="text-sm text-gray-400">加载中...</span>
          ) : tagError ? (
            <span className="text-sm text-red-600">{tagError}</span>
          ) : null}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedTag("")}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              selectedTag
                ? "bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50"
                : "bg-slate-900 text-white"
            }`}
          >
            全部标签
          </button>
          {tagStats.slice(0, 20).map((item) => (
            <button
              key={item.tag}
              onClick={() => setSelectedTag(item.tag)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                selectedTag === item.tag
                  ? "bg-green-700 text-white"
                  : "bg-green-50 text-green-700 hover:bg-green-100"
              }`}
            >
              #{item.tag} · {item.count}
            </button>
          ))}
        </div>

        {selectedTag ? (
          <div className="mt-4 rounded-xl bg-gray-50 p-4 ring-1 ring-gray-100">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-gray-900">#{selectedTag} 的跨表结果</p>
              <p className="text-xs text-gray-500">当前表格也会按该标签同步筛选</p>
            </div>
            {selectedTagEntries.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">当前没有命中的跨表条目。</p>
            ) : (
              <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {selectedTagEntries.map((entry) => (
                  <div
                    key={`${entry.table}-${entry.id}`}
                    className="rounded-xl border border-gray-100 bg-white px-3 py-2"
                  >
                    <p className="text-sm font-medium text-gray-900">{entry.label}</p>
                    <p className="mt-1 text-xs text-gray-500">来源表：{TABS.find((tab) => tab.key === entry.table)?.label}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm text-gray-500">
            共 <span className="font-semibold text-gray-800">{rows.length}</span> 条
            {search.trim() && filteredRows.length !== rows.length && (
              <span className="ml-1 text-amber-600">（筛选出 {filteredRows.length} 条）</span>
            )}
          </p>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索关键字..."
            className="w-48 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200"
          />
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/knowledge/export?table=${activeTab}&type=template`}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            下载模板
          </a>
          <a
            href={`/api/knowledge/export?table=${activeTab}&type=data`}
            className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            导出数据
          </a>
          <button
            onClick={() => {
              setShowImport(!showImport);
              setImportMsg("");
            }}
            className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100"
          >
            {showImport ? "取消导入" : "Excel 导入"}
          </button>
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

      {showImport && (
        <div className="space-y-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
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

      {showAdd && (
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
          <h3 className="mb-4 text-base font-semibold text-gray-800">新增条目</h3>
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
                    编号：{editId}。原始知识数据仍按现有表结构保存，关联信息单独存储。
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

              <div className="mt-6 rounded-2xl border border-gray-200 bg-gray-50 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">关联条目</h4>
                    <p className="mt-1 text-xs text-gray-500">
                      这里新增的是独立链接，不会覆盖现有规则、共识或清单字段。
                    </p>
                  </div>
                  {linkLoading ? <span className="text-xs text-gray-400">处理中...</span> : null}
                </div>

                <div className="mt-4 grid gap-3 md:grid-cols-[160px_minmax(0,1fr)_auto]">
                  <select
                    value={targetTable}
                    onChange={(e) => {
                      setTargetTable(e.target.value as TabKey);
                      setTargetId("");
                    }}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200"
                  >
                    {TABS.filter((tab) => tab.key !== activeTab || rows.length > 1).map((tab) => (
                      <option key={tab.key} value={tab.key}>
                        {tab.label}
                      </option>
                    ))}
                  </select>
                  <div>
                    <input
                      list="knowledge-link-targets"
                      value={targetId}
                      onChange={(e) => setTargetId(e.target.value)}
                      placeholder={targetLoading ? "正在加载可选条目..." : "输入目标条目编号"}
                      className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200"
                    />
                    <datalist id="knowledge-link-targets">
                      {targetOptions.map((row) => (
                        <option key={`${targetTable}-${row[idField(targetTable)]}`} value={row[idField(targetTable)]}>
                          {buildRowOptionLabel(targetTable, row)}
                        </option>
                      ))}
                    </datalist>
                    <p className="mt-1 text-xs text-gray-500">
                      {selectedTargetOption
                        ? `已选：${buildRowOptionLabel(targetTable, selectedTargetOption)}`
                        : "可直接输入编号，也可从下拉建议中选择。"}
                    </p>
                  </div>
                  <button
                    onClick={handleAddLink}
                    disabled={linkLoading}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:bg-slate-400"
                  >
                    添加关联
                  </button>
                </div>

                {linkMsg && (
                  <div className="mt-3 rounded-xl bg-white px-3 py-2 text-sm text-gray-700 ring-1 ring-gray-200">
                    {linkMsg}
                  </div>
                )}

                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
                    <h5 className="text-sm font-medium text-gray-900">正向关联</h5>
                    {forwardLinks.length === 0 ? (
                      <p className="mt-2 text-sm text-gray-500">当前没有正向关联。</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {forwardLinks.map((link) => (
                          <div
                            key={link.id}
                            className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2"
                          >
                            <p className="text-sm font-medium text-gray-900">{link.targetLabel}</p>
                            <p className="mt-1 text-xs text-gray-500">
                              类型：{LINK_TYPE_OPTIONS.find((item) => item.value === link.linkType)?.label || link.linkType}
                              · 来源：{link.source === "manual" ? "手动" : "派生"}
                            </p>
                            {link.source === "manual" ? (
                              <button
                                onClick={() => handleDeleteLink(link.id)}
                                className="mt-2 rounded-lg bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
                              >
                                删除
                              </button>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl bg-white p-4 ring-1 ring-gray-200">
                    <h5 className="text-sm font-medium text-gray-900">反向关联</h5>
                    {backwardLinks.length === 0 ? (
                      <p className="mt-2 text-sm text-gray-500">当前没有反向关联。</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {backwardLinks.map((link) => (
                          <div
                            key={link.id}
                            className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2"
                          >
                            <p className="text-sm font-medium text-gray-900">{link.sourceLabel}</p>
                            <p className="mt-1 text-xs text-gray-500">
                              类型：{LINK_TYPE_OPTIONS.find((item) => item.value === link.linkType)?.label || link.linkType}
                              · 来源：{link.source === "manual" ? "手动" : "派生"}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="border-t border-gray-100 bg-white px-6 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-gray-500">
                  右侧面板支持继续编辑原字段，也支持补充知识关联信息。
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
    { key: "tags", label: "标签" },
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
    { key: "tags", label: "标签" },
  ],
  "external-purchases": [
    { key: "物品名称", label: "物品名称", required: true },
    { key: "别名或关键词", label: "别名或关键词" },
    { key: "是否允许外购", label: "是否允许外购（是/否）" },
    { key: "命中的清单或共识名称", label: "命中的清单名称" },
    { key: "依据来源", label: "依据来源" },
    { key: "说明", label: "说明", multiline: true },
    { key: "备注", label: "备注" },
    { key: "tags", label: "标签" },
  ],
  "old-items": [
    { key: "物品名称", label: "物品名称", required: true },
    { key: "别名或常见叫法", label: "别名或常见叫法" },
    { key: "是否旧品", label: "是否旧品（是/否）" },
    { key: "命中的清单名称", label: "命中的清单名称" },
    { key: "识别备注", label: "识别备注", multiline: true },
    { key: "参考图片名称", label: "参考图片名称" },
    { key: "备注", label: "备注" },
    { key: "tags", label: "标签" },
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
    { key: "tags", label: "标签" },
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
          {def.key === "tags" ? (
            <TagEditor
              value={fields[def.key] ?? ""}
              onChange={(value) => onChange({ ...fields, [def.key]: value })}
            />
          ) : def.multiline ? (
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
