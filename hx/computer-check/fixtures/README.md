# 应用路线样例任务的夹具（v1.7.4，CU-07）

`src/backend/hx-skills/samples.ts` 的 apps-* 任务用这些文件：老格式（.xls、.doc、.ppt、.rtf、.csv）
走“应用路线”（LibreOffice → Mac 上的 iWork、Office → Windows 上的 Office、WPS），新格式（.xlsx、.docx、
.pptx）在 Mac 上先交给 Keynote、Numbers、Pages 存成它们自己的格式，再走技能。

做法：新格式由 `src/backend/hx-files/office-fixtures.ts` 生成，老格式用 LibreOffice 7 转出
（`soffice --headless --convert-to xls|doc|rtf|ppt|csv`）。内容：

- 名单：表“名单”，姓名 / 分数；张三 90、李四 85。
- 通知：三段，“会议通知”“周五下午三点开会。”“请准时参加。”
- 汇报：两页，“封面”，“季度回顾”（正文“收入增长”）。
