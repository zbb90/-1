import { z, type ZodError } from "zod";

export async function readJsonBody(request: Request) {
  return request.json().catch(() => null);
}

export function formatZodError(error: ZodError) {
  const issue = error.issues[0];
  if (!issue) {
    return "请求参数不合法。";
  }
  return issue.message;
}

export function logRouteError(
  route: string,
  error: unknown,
  extra?: Record<string, unknown>,
) {
  const payload = {
    route,
    message: error instanceof Error ? error.message : String(error),
    ...(extra ? { extra } : {}),
  };
  console.error(JSON.stringify(payload));
}

const trimmedString = z.string().trim();
const optionalTrimmed = trimmedString.optional();

export const phoneSchema = trimmedString.regex(/^1\d{10}$/, "手机号格式不正确。");
export const passwordSchema = trimmedString.min(8, "密码至少需要 8 位字符。");
export const optionalNameSchema = optionalTrimmed
  .refine((value) => !value || value.length <= 30, "姓名不能超过 30 个字符。")
  .transform((value) => value || undefined);
export const optionalDescriptionSchema = optionalTrimmed
  .refine((value) => !value || value.length <= 500, "描述不能超过 500 个字符。")
  .transform((value) => value || undefined);
