const DASHSCOPE_API_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DEFAULT_MODEL_NAME = "qwen3.5-flash";
const REQUEST_TIMEOUT_MS = 8000;

export function getDashScopeModelName() {
  return process.env.MODEL_NAME?.trim() || DEFAULT_MODEL_NAME;
}

export function getDashScopeApiKey() {
  return process.env.DASHSCOPE_API_KEY?.trim();
}

export function parseJsonObject<T>(raw: string | null): T | null {
  if (!raw) {
    return null;
  }
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    return null;
  }
  try {
    return JSON.parse(match[0]) as T;
  } catch {
    return null;
  }
}

export async function requestDashScopeChat(
  systemPrompt: string,
  userPrompt: string,
  options?: {
    maxTokens?: number;
    responseFormat?: "text" | "json_object";
  },
) {
  const apiKey = getDashScopeApiKey();
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
        model: getDashScopeModelName(),
        temperature: 0,
        max_tokens: options?.maxTokens ?? 260,
        ...(options?.responseFormat === "json_object"
          ? { response_format: { type: "json_object" } }
          : {}),
        messages: [
          {
            role: "system",
            content: systemPrompt,
          },
          {
            role: "user",
            content: userPrompt,
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
    console.error("DashScope request error", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
