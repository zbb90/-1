"use client";

import { useMemo, useState, type KeyboardEvent } from "react";
import {
  CHIP_SEPARATOR_REGEX,
  joinChips,
  normalizeChip,
  splitChips,
} from "./chip-editor-utils";

export type ChipEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  /** 用于表单收集（隐藏 input）。 */
  name?: string;
  /** 用 \n 解释成展示文案，不影响内部存储 split。 */
  helpText?: string;
};

const SEP = CHIP_SEPARATOR_REGEX;

export function ChipEditor({
  value,
  onChange,
  placeholder,
  disabled,
  name,
  helpText,
}: ChipEditorProps) {
  const chips = useMemo(() => splitChips(value), [value]);
  const [draft, setDraft] = useState("");

  function commitDraft(raw: string) {
    const next = normalizeChip(raw);
    if (!next) {
      setDraft("");
      return;
    }
    if (chips.includes(next)) {
      setDraft("");
      return;
    }
    onChange(joinChips([...chips, next]));
    setDraft("");
  }

  function removeChip(target: string) {
    onChange(joinChips(chips.filter((c) => c !== target)));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;
    if (event.key === "Enter" || event.key === "," || event.key === "，") {
      event.preventDefault();
      commitDraft(draft);
    } else if (event.key === "Backspace" && !draft && chips.length > 0) {
      removeChip(chips[chips.length - 1]);
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    if (disabled) return;
    const text = event.clipboardData.getData("text");
    if (!text || !SEP.test(text)) return;
    event.preventDefault();
    const incoming = splitChips(text);
    const merged = Array.from(
      new Set([...chips, ...incoming.map(normalizeChip)]),
    ).filter(Boolean);
    onChange(joinChips(merged));
    setDraft("");
  }

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 rounded-2xl border border-gray-200 bg-white px-2.5 py-2 text-sm transition focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-200 ${
        disabled ? "cursor-not-allowed opacity-70" : ""
      }`}
    >
      {chips.map((chip) => (
        <span
          key={chip}
          className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200"
        >
          {chip}
          {!disabled ? (
            <button
              type="button"
              onClick={() => removeChip(chip)}
              className="text-emerald-500 hover:text-emerald-700"
              aria-label={`移除 ${chip}`}
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => draft && commitDraft(draft)}
        onPaste={handlePaste}
        placeholder={chips.length === 0 ? (placeholder ?? "回车 / 逗号添加") : ""}
        disabled={disabled}
        className="min-w-[120px] flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-gray-400"
      />
      {name ? <input type="hidden" name={name} value={value} /> : null}
      {helpText ? (
        <span className="basis-full text-xs text-slate-400">{helpText}</span>
      ) : null}
    </div>
  );
}

export default ChipEditor;
