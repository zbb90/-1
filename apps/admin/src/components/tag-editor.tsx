"use client";

import { useEffect, useMemo, useState } from "react";

type TagStatsItem = {
  tag: string;
  count: number;
};

type TagEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

function normalizeTags(raw: string) {
  return [...new Set(raw
    .split(/[，,、；;\n]/)
    .map((tag) => tag.trim())
    .filter(Boolean))];
}

function stringifyTags(tags: string[]) {
  return normalizeTags(tags.join(",")).join(",");
}

export function TagEditor({ value, onChange, placeholder = "输入标签后回车，如：效期,仓储" }: TagEditorProps) {
  const [draft, setDraft] = useState("");
  const [suggestions, setSuggestions] = useState<TagStatsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const tags = useMemo(() => normalizeTags(value), [value]);

  useEffect(() => {
    let cancelled = false;
    async function loadSuggestions() {
      setLoading(true);
      try {
        const res = await fetch("/api/knowledge/tags");
        const json = await res.json();
        if (!cancelled && json.ok) {
          setSuggestions((json.data?.tags ?? []) as TagStatsItem[]);
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadSuggestions();
    return () => {
      cancelled = true;
    };
  }, []);

  function commitTags(nextTags: string[]) {
    onChange(stringifyTags(nextTags));
  }

  function addTag(raw: string) {
    const tag = raw.trim();
    if (!tag) return;
    if (tags.includes(tag)) {
      setDraft("");
      return;
    }
    commitTags([...tags, tag]);
    setDraft("");
  }

  function removeTag(tag: string) {
    commitTags(tags.filter((item) => item !== tag));
  }

  return (
    <div className="space-y-2">
      <input
        list="knowledge-tag-suggestions"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addTag(draft);
          }
        }}
        onBlur={() => addTag(draft)}
        className="rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-green-400 focus:ring-1 focus:ring-green-200"
        placeholder={placeholder}
      />
      <datalist id="knowledge-tag-suggestions">
        {suggestions.map((item) => (
          <option key={item.tag} value={item.tag}>
            {item.tag}（{item.count}）
          </option>
        ))}
      </datalist>

      {tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => removeTag(tag)}
              className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700 hover:bg-green-100"
            >
              #{tag} ×
            </button>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500">
          {loading ? "正在加载标签建议..." : "暂无标签，输入后回车即可添加。"}
        </p>
      )}
    </div>
  );
}
