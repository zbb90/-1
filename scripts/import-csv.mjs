import { existsSync } from "node:fs";
import { resolve } from "node:path";

const sourceDir = resolve(process.cwd(), "../问答机器人/数据模板");

if (!existsSync(sourceDir)) {
  console.log("未找到数据模板目录：", sourceDir);
  process.exit(0);
}

console.log("后续将在这里实现 CSV 导入逻辑。");
console.log("当前数据目录：", sourceDir);
