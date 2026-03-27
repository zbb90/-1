import type {
  ExternalPurchaseRequest,
  OldItemRequest,
  RegularQuestionRequest,
} from "@/lib/types";

const DASHSCOPE_API_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DEFAULT_MODEL_NAME = "qwen-plus";
const REQUEST_TIMEOUT_MS = 8000;

type RegularQuestionAnswer = {
  shouldDeduct: string;
  deductScore: string;
  clauseNo: string;
  clauseTitle: string;
  clauseSnippet: string;
  explanation: string;
  source: string;
};

type ExternalPurchaseAnswer = {
  name: string;
  canPurchase: string;
  sourceName: string;
  sourceFile: string;
  explanation: string;
};

type OldItemAnswer = {
  name: string;
  isOldItem: string;
  sourceName: string;
  remark: string;
  imageRef: string;
};

function normalizeText(value?: string) {
  return value?.trim() || "未提供";
}

function getModelName() {
  return process.env.MODEL_NAME?.trim() || DEFAULT_MODEL_NAME;
}

function getApiKey() {
  return process.env.DASHSCOPE_API_KEY?.trim();
}

async function requestDashScopeExplanation(prompt: string) {
  const apiKey = getApiKey();
  if (!apiKey) {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(DASHSCOPE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: getModelName(),
        temperature: 0.2,
        max_tokens: 220,
        messages: [
          {
            role: "system",
            content:
              "你是茶饮稽核助手。你只能依据给定材料解释结论，禁止编造新规则。输出中文，简洁、明确、适合一线门店人员阅读。",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("DashScope request failed", response.status);
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
        };
      }>;
    };

    const content = data.choices?.[0]?.message?.content?.trim();
    return content || null;
  } catch (error) {
    console.error("DashScope explanation error", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateRegularQuestionAiExplanation(
  request: RegularQuestionRequest,
  answer: RegularQuestionAnswer,
) {
  return requestDashScopeExplanation(`
请把下面的稽核命中结果整理成给门店同学看的简短解释。

用户提交信息：
- 问题分类：${normalizeText(request.category)}
- 门店问题：${normalizeText(request.issueTitle)}
- 问题描述：${normalizeText(request.description)}
- 自行判断：${normalizeText(request.selfJudgment)}

规则命中结果：
- 判定结论：${normalizeText(answer.shouldDeduct)}
- 扣分分值：${normalizeText(answer.deductScore)}
- 条款编号：${normalizeText(answer.clauseNo)}
- 条款标题：${normalizeText(answer.clauseTitle)}
- 条款片段：${normalizeText(answer.clauseSnippet)}
- 原始解释：${normalizeText(answer.explanation)}
- 引用来源：${normalizeText(answer.source)}

输出要求：
1. 只依据以上信息，不补充未知规则。
2. 先说结论，再说原因，最后给一个简短整改建议。
3. 控制在 3 句话以内，80 到 150 字。
4. 不要使用标题、编号、Markdown。
5. 若涉及物料效期，用语需区分「赏味期/最佳赏味期」与「废弃时间/超废弃」，不要混用；命中条款若只对应其中一类，只围绕该类说明。
`);
}

export async function generateExternalPurchaseAiExplanation(
  request: ExternalPurchaseRequest,
  answer: ExternalPurchaseAnswer,
) {
  return requestDashScopeExplanation(`
请把下面的外购判定结果整理成给门店同学看的简短解释。

用户提交信息：
- 物品名称：${normalizeText(request.name)}
- 补充描述：${normalizeText(request.description)}

规则命中结果：
- 命中物品：${normalizeText(answer.name)}
- 是否可外购：${normalizeText(answer.canPurchase)}
- 命中来源：${normalizeText(answer.sourceName)}
- 依据文件：${normalizeText(answer.sourceFile)}
- 原始说明：${normalizeText(answer.explanation)}

输出要求：
1. 只依据以上信息，不补充未知制度。
2. 先给结论，再解释为什么可外购或不可外购。
3. 最后补一句执行建议。
4. 控制在 3 句话以内，60 到 120 字。
5. 不要使用标题、编号、Markdown。
`);
}

export async function generateOldItemAiExplanation(
  request: OldItemRequest,
  answer: OldItemAnswer,
) {
  return requestDashScopeExplanation(`
请把下面的旧品比对结果整理成给门店同学看的简短解释。

用户提交信息：
- 物品名称：${normalizeText(request.name)}
- 备注说明：${normalizeText(request.remark)}

规则命中结果：
- 命中物品：${normalizeText(answer.name)}
- 是否旧品：${normalizeText(answer.isOldItem)}
- 命中清单：${normalizeText(answer.sourceName)}
- 识别备注：${normalizeText(answer.remark)}
- 参考图片：${normalizeText(answer.imageRef)}

输出要求：
1. 只依据以上信息，不补充未知事实。
2. 先给判定，再解释识别依据。
3. 最后补一句建议门店如何处理。
4. 控制在 3 句话以内，60 到 120 字。
5. 不要使用标题、编号、Markdown。
`);
}
