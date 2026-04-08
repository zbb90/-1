import { loadKnowledgeBase } from "@/lib/knowledge-loader";
import type {
  ExternalPurchaseRequest,
  ExternalPurchaseRow,
  OldItemRequest,
  OldItemRow,
} from "@/lib/types";

function normalizeText(input?: string) {
  return (input ?? "").trim().toLowerCase();
}

function splitKeywords(text: string) {
  return text
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildExternalPurchaseSearchText(item: ExternalPurchaseRow) {
  return [
    item.物品名称,
    item.别名或关键词,
    item.命中的清单或共识名称,
    item.依据来源,
    item.说明,
  ]
    .join(" ")
    .toLowerCase();
}

function buildOldItemSearchText(item: OldItemRow) {
  return [item.物品名称, item.别名或常见叫法, item.命中的清单名称, item.识别备注]
    .join(" ")
    .toLowerCase();
}

function scoreExternalPurchaseMatch(
  item: ExternalPurchaseRow,
  request: ExternalPurchaseRequest,
) {
  const name = normalizeText(request.name);
  const description = normalizeText(request.description);
  const combined = `${name} ${description}`.trim();
  const searchText = buildExternalPurchaseSearchText(item);
  const keywords = splitKeywords(item.别名或关键词).map((keyword) =>
    keyword.toLowerCase(),
  );

  let score = 0;
  const reasons: string[] = [];

  if (name && searchText.includes(name)) {
    score += 35;
    reasons.push("物品名称直接命中");
  }

  for (const keyword of keywords) {
    if (combined.includes(keyword)) {
      score += 16;
      reasons.push(`命中关键词：${keyword}`);
    }
  }

  if (description && searchText.includes(description)) {
    score += 18;
    reasons.push("描述与外购规则高度重合");
  }

  return { score, reasons };
}

function scoreOldItemMatch(item: OldItemRow, request: OldItemRequest) {
  const name = normalizeText(request.name);
  const remark = normalizeText(request.remark);
  const combined = `${name} ${remark}`.trim();
  const searchText = buildOldItemSearchText(item);
  const keywords = splitKeywords(item.别名或常见叫法).map((keyword) =>
    keyword.toLowerCase(),
  );

  let score = 0;
  const reasons: string[] = [];

  if (name && searchText.includes(name)) {
    score += 35;
    reasons.push("物品名称直接命中");
  }

  for (const keyword of keywords) {
    if (combined.includes(keyword)) {
      score += 16;
      reasons.push(`命中别名：${keyword}`);
    }
  }

  if (remark && searchText.includes(remark)) {
    score += 15;
    reasons.push("备注信息高度接近");
  }

  return { score, reasons };
}

export async function matchExternalPurchase(request: ExternalPurchaseRequest) {
  const knowledgeBase = await loadKnowledgeBase();
  const candidates = knowledgeBase.externalPurchases
    .map((item) => {
      const { score, reasons } = scoreExternalPurchaseMatch(item, request);
      return { item, score, reasons };
    })
    .filter((item) => item.score >= 16)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return {
      matched: false,
      rejectReason: "未找到明确外购依据，建议补充更具体名称或进入人工复核。",
      candidates: [],
    };
  }

  const best = candidates[0];
  return {
    matched: true,
    answer: {
      itemId: best.item.item_id,
      name: best.item.物品名称,
      canPurchase: best.item.是否允许外购,
      sourceName: best.item.命中的清单或共识名称,
      sourceFile: best.item.依据来源,
      explanation: best.item.说明,
      matchedReasons: best.reasons,
    },
    candidates: candidates.slice(0, 5).map((item) => ({
      itemId: item.item.item_id,
      name: item.item.物品名称,
      canPurchase: item.item.是否允许外购,
      score: item.score,
    })),
  };
}

export async function matchOldItem(request: OldItemRequest) {
  const knowledgeBase = await loadKnowledgeBase();
  const candidates = knowledgeBase.oldItems
    .map((item) => {
      const { score, reasons } = scoreOldItemMatch(item, request);
      return { item, score, reasons };
    })
    .filter((item) => item.score >= 16)
    .sort((left, right) => right.score - left.score);

  if (candidates.length === 0) {
    return {
      matched: false,
      rejectReason: "未在旧品清单中找到明确命中，请补充更清晰名称或图片说明。",
      candidates: [],
    };
  }

  const best = candidates[0];
  return {
    matched: true,
    answer: {
      itemId: best.item.item_id,
      name: best.item.物品名称,
      isOldItem: best.item.是否旧品,
      sourceName: best.item.命中的清单名称,
      remark: best.item.识别备注,
      imageRef: best.item.参考图片名称,
      matchedReasons: best.reasons,
    },
    candidates: candidates.slice(0, 5).map((item) => ({
      itemId: item.item.item_id,
      name: item.item.物品名称,
      isOldItem: item.item.是否旧品,
      score: item.score,
    })),
  };
}
