import { z } from "zod";
import {
  optionalDescriptionSchema,
  optionalNameSchema,
  passwordSchema,
  phoneSchema,
} from "@/lib/api-utils";

const requesterFields = {
  requesterId: z.string().trim().max(120).optional(),
  requesterName: optionalNameSchema,
};

export const pcLoginBodySchema = z.object({
  phone: z.string().trim().min(1, "请输入手机号和密码。"),
  password: z.string().trim().min(1, "请输入手机号和密码。"),
});

export const wxLoginBodySchema = z.object({
  code: z.string().trim().min(1, "缺少微信 code 参数。"),
  name: optionalNameSchema,
  phone: phoneSchema.optional(),
});

export const regularQuestionBodySchema = z
  .object({
    ...requesterFields,
    storeCode: z.string().trim().max(64).optional(),
    category: z.string().trim().min(1, "`问题分类` 不能为空。").max(64),
    selfJudgment: z.string().trim().max(200).optional(),
    issueTitle: optionalDescriptionSchema,
    description: optionalDescriptionSchema,
  })
  .refine(
    (body) => Boolean(body.description?.trim() || body.issueTitle?.trim()),
    "至少需要提供 `问题描述` 或 `门店问题`。",
  );

export const manualReviewBodySchema = regularQuestionBodySchema.extend({
  answer: z
    .object({
      ruleId: z.string().trim().optional(),
      category: z.string().trim().optional(),
      shouldDeduct: z.string().trim().optional(),
      deductScore: z.string().trim().optional(),
      clauseNo: z.string().trim().optional(),
      clauseTitle: z.string().trim().optional(),
      clauseSnippet: z.string().trim().optional(),
      explanation: z.string().trim().optional(),
      source: z.string().trim().optional(),
      matchedReasons: z.array(z.string().trim()).optional(),
      aiExplanation: z.string().trim().optional(),
    })
    .optional(),
  candidates: z
    .array(
      z.object({
        ruleId: z.string().trim().optional(),
        category: z.string().trim().optional(),
        clauseNo: z.string().trim().optional(),
        clauseTitle: z.string().trim().optional(),
        score: z.number().optional(),
      }),
    )
    .optional(),
});

export const externalPurchaseBodySchema = z
  .object({
    ...requesterFields,
    name: optionalDescriptionSchema,
    description: optionalDescriptionSchema,
  })
  .refine(
    (body) => Boolean(body.name?.trim() || body.description?.trim()),
    "至少需要提供物品名称或补充描述。",
  );

export const oldItemBodySchema = z
  .object({
    ...requesterFields,
    name: optionalDescriptionSchema,
    remark: optionalDescriptionSchema,
  })
  .refine(
    (body) => Boolean(body.name?.trim() || body.remark?.trim()),
    "至少需要提供物品名称或备注说明。",
  );

export const knowledgeSinkBodySchema = z.object({
  taskId: z.string().trim().min(1, "缺少 taskId。"),
});

export const userCreateBodySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请填写姓名和手机号。")
    .max(30, "姓名不能超过 30 个字符。"),
  phone: phoneSchema,
  type: z.enum(["supervisor", "delegated_leader"]).default("supervisor"),
});

export const userUpdateBodySchema = z
  .object({
    status: z.enum(["active", "disabled"]).optional(),
    name: optionalNameSchema,
    password: passwordSchema.optional(),
  })
  .refine(
    (body) => Boolean(body.status || body.name || body.password),
    "缺少更新数据。",
  );
