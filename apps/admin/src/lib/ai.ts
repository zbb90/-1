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
  matchedReasons?: string[];
  consensusKeywords?: string;
  consensusApplicableScene?: string;
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
        temperature: 0,
        max_tokens: 260,
        messages: [
          {
            role: "system",
            content:
              "你是茶饮稽核助手。你只能根据用户提供的「规则命中结果」中的条款标题、条款片段、原始解释、判定结论、扣分分值、共识关键词与适用场景来组织语言，禁止编造共识文件中未出现的流程、场景、例外或结论。若用户描述与条款文字不完全一致，仍以条款与判定结论为准。输出中文，简洁、适合一线阅读。",
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

function formatMatchedReasons(reasons?: string[]) {
  if (!reasons?.length) {
    return "无";
  }
  return reasons.join("；");
}

function buildDeterministicRegularQuestionExplanation(
  answer: RegularQuestionAnswer,
) {
  const conclusion = normalizeText(answer.shouldDeduct);
  const score = normalizeText(answer.deductScore);
  return `本条命中「${normalizeText(answer.clauseTitle)}」。共识要点见条款解释：${normalizeText(answer.explanation)}。系统判定结论为「${conclusion}」，对应扣分分值为「${score}」。请严格按稽核共识与现场情况执行；如需个案判断请走人工复核。`;
}

export async function generateRegularQuestionAiExplanation(
  request: RegularQuestionRequest,
  answer: RegularQuestionAnswer,
) {
  const conclusion = normalizeText(answer.shouldDeduct);
  const rulesBlock = `
【硬性对齐，必须遵守】
- 「判定结论」字段为：${conclusion}。
- 若判定结论为「是」：全文必须体现需要按规则扣分或需记录扣分情形，禁止写「不扣分」「本次不扣分」「不予扣分」等相反结论。
- 若判定结论为「否」：必须体现不扣分或仅提醒等与不扣分一致的含义，禁止写「应扣分」「需要扣分」等相反结论。
- 若判定结论为「按场景判定」：不得擅自给出「一定不扣分」或「一定扣分」的终局结论；应说明须结合现场与共识条款核对，必要时人工复核。
- 禁止编造「水浴/平冷/转移」等流程细节，除非这些词出现在下面的「条款片段」或「原始解释」中。
- 优先复述「原始解释」中的共识逻辑；可结合用户描述点出现场，但不得与判定结论矛盾。

用户提交信息：
- 问题分类：${normalizeText(request.category)}
- 门店问题：${normalizeText(request.issueTitle)}
- 问题描述：${normalizeText(request.description)}
- 自行判断：${normalizeText(request.selfJudgment)}

规则命中结果（稽核共识与规则表）：
- 判定结论：${conclusion}
- 扣分分值：${normalizeText(answer.deductScore)}
- 条款编号：${normalizeText(answer.clauseNo)}
- 条款标题：${normalizeText(answer.clauseTitle)}
- 条款片段：${normalizeText(answer.clauseSnippet)}
- 原始解释（共识正文）：${normalizeText(answer.explanation)}
- 共识关键词：${normalizeText(answer.consensusKeywords)}
- 适用场景：${normalizeText(answer.consensusApplicableScene)}
- 引用来源：${normalizeText(answer.source)}
- 规则命中原因：${formatMatchedReasons(answer.matchedReasons)}

输出要求：
1. 用 3 句以内、共 90～180 字，先说与判定结论一致的一句话，再依据「原始解释」压缩说明理由，最后一句给可执行建议。
2. 不要使用标题、编号、Markdown。
3. 若涉及效期，区分「赏味期」与「废弃时间」，且仅当条款中出现时才写。
`;

  const llm = await requestDashScopeExplanation(rulesBlock);
  if (llm) {
    return llm;
  }

  return buildDeterministicRegularQuestionExplanation(answer);
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
