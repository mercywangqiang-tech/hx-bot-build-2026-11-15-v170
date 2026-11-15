// HXBot 电脑操控：生成内置的拼音表 src/backend/hx-computer/pinyin-table.ts。
// 只在开发时运行；HXBot 运行时不带任何拼音库，只带生成出来的那一个文件（npm 不在 HXBot 的依赖里）。
//   mkdir /tmp/pinyin-gen && cd /tmp/pinyin-gen && npm init -y && npm install pinyin-pro@3.29.5
//   node hx/scripts/make-pinyin-table.mjs /tmp/pinyin-gen > src/backend/hx-computer/pinyin-table.ts
// 数据来自开源的 pinyin-pro（MIT，版权 zh-lx）：每个字取它最常用的读音；
// 下面词表里的词，凡是整词读音和逐字读音不同的（音乐、银行、重庆……），单独记下来。
// 字的范围是 GB2312 的一级、二级汉字，共 6763 个。
import { createRequire } from "node:module";
import { join } from "node:path";

const from = process.argv[2];
if (!from) {
  process.stderr.write("用法：node hx/scripts/make-pinyin-table.mjs 装了 pinyin-pro 的文件夹\n");
  process.exit(1);
}
const require = createRequire(join(from, "package.json"));
const { pinyin } = require("pinyin-pro");
const version = require("pinyin-pro/package.json").version;

const WORDS = `
音乐 乐谱 乐器 声乐 乐队 银行 行业 行情 排行 行程 银行卡 会计 重庆 重启 重置 重装 重复 重新 重做 重命名 长城 成长 家长 校长 生长
调查 调度 调用 调试 调整 调节 空调 色调 还原 归还 还有 首都 成都 都市 西藏 宝藏 收藏 隐藏 传记 传输 上传 下载 加载 记载
效率 概率 汇率 频率 率领 数据 数字 参数 朝阳 朝代 相册 相机 照相 相关 互相 便宜 方便 便签 便利 单位 单词 地图 地址 目的 的确
得到 获得 觉得 睡觉 发现 头发 理发 分享 分钟 部分 成分 干净 干部 骨干 给予 供给 好友 爱好 和平 暖和 几乎 几个 假期 真假 请假
间隔 时间 空间 降低 投降 角色 角度 教育 教学 结果 结束 尽管 尽力 看见 看护 空白 空闲 快乐 娱乐 了解 为了 量子 测量 流量 音量
落地 没有 淹没 难题 困难 灾难 宁静 片段 图片 相片 强大 勉强 曲线 歌曲 任务 少年 多少 什么 省略 反省 似的 似乎 识别 标识 知识
熟悉 属于 数学 说明 游说 宿舍 弹出 子弹 弹窗 提示 提供 挑战 通知 同意 胡同 系统 关系 联系 系列 鲜花 新鲜 兴趣 高兴 复兴
行走 发行 省份 压缩 要求 重要 需要 应用 应该 答应 参与 语音 载入 占用 正在 正月 只有 一只 中心 命中 种类 种植 转换 旋转 转发
钻石 作业 作为 钉钉 飞书 微信 企业微信 支付宝 淘宝 天猫 京东 拼多多 美团 饿了么 滴滴 高德 百度 网盘 网易 云音乐 酷狗 酷我
喜马拉雅 哔哩哔哩 抖音 快手 小红书 知乎 微博 豆瓣 腾讯 会议 视频 爱奇艺 优酷 芒果 剪映 迅雷 搜狗 输入法 讯飞 有道 词典 翻译
印象笔记 石墨 文档 语雀 幕布 夸克 浏览器 火狐 谷歌 备忘录 提醒事项 日历 通讯录 邮件 信息 照片 预览 终端 计算器 访达
活动监视器 磁盘工具 字体册 钥匙串访问 截屏 天气 股市 家庭 快捷指令 时钟 图书 播客 库乐队 无边记 查找 控制中心 启动台
调度中心 系统设置 文本编辑 脚本编辑器 迁移助理 蓝牙文件交换 数码测色计 屏幕共享 旁白实用工具 音频 设置 记事本 画图
资源管理器 任务管理器 命令提示符 注册表编辑器 控制面板 截图工具 远程桌面连接 步骤记录器 便笺 录音机 闹钟 电影和电视
媒体播放器 人脉 手机连接 反馈中心 获取帮助 使用技巧 安全中心 应用商店 计算机管理 磁盘清理 碎片整理 事件查看器 服务
系统信息 性能监视器 放大镜 讲述人 屏幕键盘 字符映射表 写字板 传真和扫描 语音识别 深色模式 程序坞 菜单栏 勿扰模式 夜览
亮度 分辨率 壁纸 墙纸 输入法 触控板 打印机 扫描仪 储存空间 隔空投送 接力 登录项 时间机器 启动磁盘 通用 外观 辅助功能
聚焦 隐私与安全性 桌面 显示器 屏幕保护程序 电池 锁定屏幕 密码 互联网账户 钱包 键盘 鼠标 共享 传输或还原 语言与地区
日期与时间 软件更新 关于本机 无线局域网 蓝牙 网络 通知 声音 专注模式 屏幕使用时间 任务栏 剪贴板 透明效果 默认应用 开始菜单
`
  .split(/\s+/u)
  .filter((word) => word.length > 1);

const read = (text) => pinyin(text, { toneType: "none", type: "array", v: true, nonZh: "removed" });
const SYLLABLE = /^[a-z]+$/u;

// GB2312: the first plane of Chinese characters is rows 0xB0 to 0xD7 (level 1), the second 0xD8 to 0xF7 (level 2).
const decoder = new TextDecoder("gb2312", { fatal: true });
const characters = [];
for (let row = 0xb0; row <= 0xf7; row += 1) {
  for (let cell = 0xa1; cell <= 0xfe; cell += 1) {
    try {
      const character = decoder.decode(Uint8Array.of(row, cell));
      if (/^\p{Script=Han}$/u.test(character)) characters.push(character);
    } catch {
      // Not a character of the set.
    }
  }
}
const bySyllable = new Map();
const reading = new Map();
let skipped = 0;
for (const character of characters) {
  const [syllable] = read(character);
  if (!syllable || !SYLLABLE.test(syllable)) {
    skipped += 1;
    continue;
  }
  reading.set(character, syllable);
  bySyllable.set(syllable, `${bySyllable.get(syllable) ?? ""}${character}`);
}
const table = [...bySyllable]
  .sort(([left], [right]) => left.localeCompare(right))
  .map(([syllable, group]) => `${syllable}${group}`)
  .join(" ");

const words = new Map();
for (const word of new Set(WORDS)) {
  const whole = read(word);
  const single = [...word].map((character) => reading.get(character) ?? "");
  if (whole.length !== single.length || whole.some((syllable) => !SYLLABLE.test(syllable))) continue;
  if (whole.join(" ") !== single.join(" ")) words.set(word, whole.join(" "));
}
const lines = [...words]
  .sort(([left], [right]) => left.localeCompare(right, "zh"))
  .map(
    ([word, said]) => `  ${/^\p{Script=Han}+$/u.test(word) ? word : JSON.stringify(word)}: ${JSON.stringify(said)},`,
  );

// The license of the data goes with it, as a legal comment that bundlers keep (/*! ... */).
const license = require("node:fs")
  .readFileSync(join(from, "node_modules", "pinyin-pro", "LICENSE"), "utf8")
  .trim()
  .replaceAll("*/", "* /");
process.stdout.write(`/*! The pinyin below is data of pinyin-pro ${version} (https://github.com/zh-lx/pinyin-pro):

${license}
*/

// HXBot 电脑操控：内置的拼音表。这个文件是生成的，不要手改：
//   node hx/scripts/make-pinyin-table.mjs 装了 pinyin-pro 的文件夹 > src/backend/hx-computer/pinyin-table.ts
// 数据来自开源的 pinyin-pro ${version}（MIT，版权 zh-lx，见 hx/docs/许可与合规.md）。
// ${reading.size} 个字（GB2312 的一级、二级汉字），每个字取最常用的读音；ü 写成 v（lv、nv）。

/** Every syllable followed by the characters that are read that way, the groups separated by a space. */
export const HX_PINYIN_TABLE =
  ${JSON.stringify(table)};

/** Words in which a character is not read the way the table has it. */
export const HX_PINYIN_WORDS: Readonly<Record<string, string>> = {
${lines.join("\n")}
};
`);
process.stderr.write(
  `${reading.size} characters, ${bySyllable.size} syllables, ${skipped} skipped, ${words.size} words\n`,
);
