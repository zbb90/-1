export const questionCategories = [
  "物料效期问题",
  "储存与离地问题",
  "交叉污染问题",
  "外购与非认可物料/器具",
  "化学品问题",
  "设备器具清洁/霉变/积垢",
  "虫害与消杀问题",
  "证照/记录/人员规范",
] as const;

export type QuestionCategory = (typeof questionCategories)[number];
