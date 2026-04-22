import { describe, expect, it } from "vitest";
import {
  addChip,
  joinChips,
  normalizeChip,
  removeChip,
  splitChips,
} from "./chip-editor-utils";

describe("chip-editor-utils", () => {
  it("splitChips 同时支持 | 与 ｜ 全角分隔", () => {
    expect(splitChips("R-0001|R-0002｜R-0003")).toEqual(["R-0001", "R-0002", "R-0003"]);
    expect(splitChips("")).toEqual([]);
    expect(splitChips("  R-0001 |  ｜R-0002  ")).toEqual(["R-0001", "R-0002"]);
  });

  it("joinChips 始终使用半角 | 拼接", () => {
    expect(joinChips(["R-0001", "R-0002"])).toBe("R-0001|R-0002");
    expect(joinChips(["", "R-0001", ""])).toBe("R-0001");
  });

  it("normalizeChip 去除分隔符与首尾空白", () => {
    expect(normalizeChip(" R-0001| ")).toBe("R-0001");
    expect(normalizeChip("｜｜｜")).toBe("");
  });

  it("addChip 去重 + 追加", () => {
    expect(addChip("R-0001", "R-0002")).toBe("R-0001|R-0002");
    expect(addChip("R-0001|R-0002", "R-0001")).toBe("R-0001|R-0002");
    expect(addChip("", "R-0001")).toBe("R-0001");
  });

  it("removeChip 删除并保持顺序", () => {
    expect(removeChip("R-0001|R-0002|R-0003", "R-0002")).toBe("R-0001|R-0003");
    expect(removeChip("R-0001", "R-0002")).toBe("R-0001");
  });
});
