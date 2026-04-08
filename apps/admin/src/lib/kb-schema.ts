/** 与 [knowledge-csv.ts](knowledge-csv.ts) 中 KbTableName 一致。 */
export type KbTableName =
  | "rules"
  | "consensus"
  | "external-purchases"
  | "old-items"
  | "operations";

/** 各表 Excel/CSV 首行应包含的列名（与 [knowledge-store](knowledge-store.ts) 默认表头一致）。 */
export const KB_TABLE_HEADERS: Record<KbTableName, string[]> = {
  rules: [
    "rule_id",
    "问题分类",
    "问题子类或关键词",
    "场景描述",
    "触发条件",
    "是否扣分",
    "扣分分值",
    "条款编号",
    "条款标题",
    "条款关键片段",
    "条款解释",
    "共识来源",
    "示例问法",
    "备注",
    "状态",
  ],
  consensus: [
    "consensus_id",
    "标题",
    "关联条款编号",
    "适用场景",
    "解释内容",
    "判定结果",
    "扣分分值",
    "关键词",
    "示例问题",
    "来源文件",
    "备注",
    "状态",
  ],
  "external-purchases": [
    "item_id",
    "物品名称",
    "别名或关键词",
    "是否允许外购",
    "命中的清单或共识名称",
    "依据来源",
    "说明",
    "备注",
    "状态",
  ],
  "old-items": [
    "item_id",
    "物品名称",
    "别名或常见叫法",
    "是否旧品",
    "命中的清单名称",
    "识别备注",
    "参考图片名称",
    "备注",
    "状态",
  ],
  operations: [
    "op_id",
    "资料类型",
    "标题",
    "适用对象",
    "关键词",
    "操作内容",
    "检核要点",
    "解释说明",
    "来源文件",
    "备注",
    "状态",
  ],
};

const ID_FIELD: Record<KbTableName, string> = {
  rules: "rule_id",
  consensus: "consensus_id",
  "external-purchases": "item_id",
  "old-items": "item_id",
  operations: "op_id",
};

export function validateKnowledgeRowKeys(
  table: KbTableName,
  rowKeys: string[],
): { ok: true } | { ok: false; missing: string[]; extraNote?: string } {
  const expected = new Set(KB_TABLE_HEADERS[table]);
  const actual = new Set(rowKeys.map((k) => k.trim()).filter(Boolean));
  const missing = [...expected].filter((k) => !actual.has(k));
  if (missing.length > 0) {
    return { ok: false, missing };
  }
  const idField = ID_FIELD[table];
  if (!actual.has(idField)) {
    return { ok: false, missing: [idField] };
  }
  return { ok: true };
}
