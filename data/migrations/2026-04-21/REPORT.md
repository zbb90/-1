# 拆分 dry-run 报告  (2026-04-21)

## 1. 输入
- rules csv: /Users/zhaobinbin/Desktop/2026年3月/audit-ai-assistant/data/templates/03_常规问题规则表.csv  (rows=135)
- faq csv: /Users/zhaobinbin/Desktop/2026年3月/audit-ai-assistant/data/templates/07_常问沉积表.csv      (rows=1)
- consensus csv: /Users/zhaobinbin/Desktop/2026年3月/audit-ai-assistant/data/templates/02_共识解释表.csv (rows=87)
- audit xlsx: /Users/zhaobinbin/Desktop/稽核表/古茗门店稽核表20251101.xlsx

## 2. rules 拆分结果
- 保留 (备注非"自动从稽核共识抽取"): **49** 条
- 迁出到 faq ("自动从稽核共识抽取"): **86** 条
- faq 表条目数: 1 → 87

### 2.1 保留的 rules 抽样 (前 5)
- R-0000 | H3.3 | 严禁门店使用超过废弃时间的原物料或存在故意篡改风味贴的行为 | 备注=根据你提供的真实场景补入
- R-0001 | H1.1 | 员工持有有效的健康证明 | 备注=自动从稽核表抽取
- R-0002 | H1.2 | 员工健康证管理 | 备注=自动从稽核表抽取
- R-0003 | H1.3 | 定期完成虫害防治检查 | 备注=自动从稽核表抽取
- R-0004 | H1.4 | 食品经营许可证及当地工商部门要求办理的其他证照在有效期内，并执行当地政府要求的索证要求 | 备注=自动从稽核表抽取

### 2.2 迁到 faq 的抽样 (前 5)
- R-0048 → 共识=CS-0047 | 标题=化学品相关外购管理共识 | 旧条款编号=311
- R-0049 → 共识=CS-0053 | 标题=器具类相关外购管理共识 | 旧条款编号=311
- R-0050 → 共识=CS-0064 | 标题=门店出现发霉腐败等相关共识 | 旧条款编号=33
- R-0051 → 共识=CS-0070 | 标题=交叉污染相关稽核共识 | 旧条款编号=34
- R-0052 → 共识=CS-0076 | 标题=门店阁楼的物料未离地储存 | 旧条款编号=37

## 3. 与新版稽核 Excel 比对
- Excel 章节行 (X): 24
- Excel 标准条款行 (X.Y, 一个 dot): **47**
- Excel 观察点行 (X.Y.Z, 二个 dot): 72
- rules 已覆盖 Excel 标准条款: **46** / 47
- Excel 缺失（rules 没有的标准条款）: **1** 条
- rules 多出（Excel 里查不到的条款编号）: 1 条

### 3.1 Excel 缺失抽样 (前 30)
- F321.2 (观察点, 分) 使用非食品操作的工器具、清洁工具及营运相关物料，如钢丝类、玻璃材质器具

### 3.2 rules 多出（脏 / 无法对齐）抽样 (前 20)
- R-0134 条款编号=55 标题=灭蝇灯与消杀设备配件维护共识

## 4. 输出文件 (dry-run, 未覆盖 templates)
- /Users/zhaobinbin/Desktop/2026年3月/audit-ai-assistant/data/migrations/2026-04-21/03_常规问题规则表.new.csv
- /Users/zhaobinbin/Desktop/2026年3月/audit-ai-assistant/data/migrations/2026-04-21/07_常问沉积表.new.csv
- /Users/zhaobinbin/Desktop/2026年3月/audit-ai-assistant/data/migrations/2026-04-21/audit_excel_missing.csv

## 5. 下一步建议
1. 你 review 上面的 dry-run 文件 + 报告，OK 后我把 03/07 覆盖到 templates 并 commit。
2. 02 共识表里 311/33/37 等乱码 关联条款编号 不在本次范围，建议下一轮单独处理（用 Excel 的 chapter→category 映射做反查）。
3. 覆盖后需重建向量库 (后台 /storage 重建按钮)。