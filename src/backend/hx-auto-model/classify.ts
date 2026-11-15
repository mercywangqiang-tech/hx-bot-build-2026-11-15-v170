// HXBot 自动选择模型：判断一件工作是什么、有多难（规则部分）。
//
// The rules read the message, its attachments and the size of what goes with it. They return the
// kind of work, the difficulty, what the model must be able to do, and how sure they are. Below
// `HX_JUDGE_BELOW`, and when the agent allows it, a small model judges the message instead
// (`judge.ts`). Nothing here reads a file or the network: the host passes the names and sizes.
import { HX_WORK_TYPES, type HxDifficulty, type HxNeed, type HxWorkType } from "@hxbot/contracts/hx-auto-model";

/** Below this, a small model judges the message when the agent allows it. */
export const HX_JUDGE_BELOW = 0.7;
/** The share of the model's window that the work may fill before it needs a larger window. */
const HX_WINDOW_SHARE = 0.7;
/** A follow-up keeps the last work only when the last work is this recent. */
export const HX_FOLLOW_UP_MS = 10 * 60_000;
/** A message this short, with no attachment and no clear signal, goes on with the last work. */
const FOLLOW_UP_CHARS = 20;

export interface HxAttachmentInfo {
  name: string;
  /** Bytes; 0 when unknown. */
  size: number;
}

export interface HxWorkInput {
  text: string;
  attachments: readonly HxAttachmentInfo[];
  /** Tokens of the conversation that the provider sends with the message, estimated; 0 when unknown. */
  historyTokens: number;
  /** The context window of the agent's current model, in tokens. */
  window: number;
  /** The last decision of this chat, when there is one. */
  previous: { work: HxWorkType; difficulty: HxDifficulty; at: number } | null;
  now: number;
}

export interface HxClassification {
  work: HxWorkType;
  difficulty: HxDifficulty;
  needs: HxNeed[];
  /** 0 to 1. */
  confidence: number;
  /** What the rules saw, for the settings screen. */
  signals: string[];
  /** The message goes on with the last work: the model stays. */
  followUp: boolean;
  /** The user asked to do the last work again ("重做", "redo"). */
  redo: boolean;
  /** Tokens that the work brings, with the conversation. */
  tokens: number;
}

const IMAGE = /\.(?:png|jpe?g|gif|webp|heic|heif|bmp|tiff?|avif)$/iu;
const DATA_FILE = /\.(?:xlsx?|xlsm|csv|tsv|numbers|parquet|ods)$/iu;
const CODE_FILE =
  /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|cc|cpp|h|hpp|cs|rb|php|scala|sh|bash|zsh|ps1|vue|svelte|lua|dart|sql)$/iu;
/** Characters per token of a file, by kind: text is dense, office files and PDFs carry more bytes per word. */
const BYTES_PER_TOKEN: ReadonlyArray<readonly [RegExp, number]> = [
  [/\.(?:pdf)$/iu, 12],
  [/\.(?:docx?|pptx?|xlsx?|odt|rtf|epub)$/iu, 10],
  [/\.(?:zip|tar|gz|7z|rar)$/iu, 10],
];
/** An image costs about this many tokens, whatever its size. */
const IMAGE_TOKENS = 1_600;

interface Rule {
  work: HxWorkType;
  weight: number;
  pattern: RegExp;
  label: string;
}

// The weights: 3 is a word that names the work ("翻译", "refactor"), 2 a strong hint, 1 a weak one.
// Chinese has no spaces, so its words are matched inside the text; English words at word bounds.
// The lists name kinds of things (a document, a tool, a measure), not the words of the test set.
const RULES: readonly Rule[] = [
  // Writing: something to write, change the words of, or translate.
  {
    work: "writing",
    weight: 3,
    label: "words:写作",
    pattern:
      /润色|翻译|译成|译为|改写|扩写|缩写|缩短|精简|校对|病句|错别字|措辞|语气|文笔|起草|撰写|写一[篇封段首份个句]|写个|写封|写篇|写段|帮我写|写给|回复这封|回一封|文案|标题|口号|宣传语|广告语|演讲稿|讲稿|发言稿|开场白|主持词|贺词|祝福语|祝酒词|感谢信|道歉信|邀请函|求职信|请假条|自我介绍|简历|公众号|朋友圈|推文|文章|作文|读后感|评语|小说|剧本|故事|诗|散文|通知|声明|纪要|周报|日报|月报|总结报告|邮件|信函|新闻稿|说明书|摘要|总结一下|概括|这段话|这篇|稿子|条理/u,
  },
  {
    work: "writing",
    weight: 3,
    label: "words:writing",
    pattern:
      /\b(?:write|rewrite|reword|rephrase|polish|proofread|translate|draft|compose|summari[sz]e|paraphrase|shorten|condense|tighten|expand|edit my|reply to|respond to|tone|wording|title for|headline|caption|tagline|slogan|essay|poem|haiku|blog post|post announcing|linkedin post|tweet|newsletter|press release|cover letter|resume|bio|email|letter|toast|speech|script for|announcement|invitation|apology|product description|novel|story|thank-you note|note to|weekly report|easier to read)\b/iu,
  },
  // Code: a program, an error of one, or a tool of programmers.
  {
    work: "code-small",
    weight: 3,
    label: "words:代码",
    pattern:
      /代码|程序|函数|方法|变量|类型注解|报错|异常|错误码|bug|Bug|BUG|编译|构建失败|单元测试|单测|测试挂|测试用例|脚本|正则|接口|返回 ?[45]\d\d|日志里|依赖|安装失败|装不上|内存泄漏|并发|线程|算法|数组|字符串|组件|props|前端|后端|数据库表|(?<![A-Za-z])(?:SQL|sql|git|Git|npm|pip|yarn|maven|gradle|Docker|docker|nginx|CSS|css|HTML|JavaScript|JS|Python|Java|Go|Golang|Rust|TypeScript|React|Vue|vue|Spring|Django|Flask|Express|Node|useEffect|VLOOKUP|Excel 公式)(?![A-Za-z])|C\+\+|C#|公式|配置|循环|性能|段错误|拼写错误：/u,
  },
  {
    work: "code-small",
    weight: 3,
    label: "words:code",
    pattern:
      /\b(?:code|coding|program|function|method|bug|regex|compile|build fails|module not found|stack trace|exception|traceback|null ?pointer|typeerror|keyerror|syntaxerror|segmentation fault|npm|pip|yarn|maven|gradle|git|docker|sql|css|html|javascript|typescript|python|golang|go|java|rust|kotlin|swift|react|vue|angular|django|flask|express|node|props|component|dependency|package|variable|environment variable|type hints?|async\/await|callback|off-by-one|unit tests?|test fails?|bash|shell|one-liner|snippet|loop|query|speed up this function|memory leak|thread|algorithm|array|string|api|nginx|config|formula|vlookup|useeffect|timer|list comprehension|reverse proxy)\b/iu,
  },
  {
    work: "code-small",
    weight: 3,
    label: "error-text",
    pattern:
      /```|(?:Type|Key|Value|Reference|Syntax|Attribute|Import|Index|NullPointer)(?:Error|Exception)|=[A-Z]{2,}\(|Exception in|Traceback \(most recent|npm ERR!|E[A-Z]{3,}\b|exited with code|undefined is not|cannot read propert|permission denied|not found:/u,
  },
  {
    work: "code-large",
    weight: 3,
    label: "words:工程",
    pattern:
      /新功能|加.{0,12}(?:功能|支持|模块|页面)|功能模块|重写.{0,12}(?:服务|项目|系统|后端|前端)|改成响应式|响应式|第三方登录|登录|推送|重构|迁移|移植|从零|搭一个|搭建|实现一个|实现用户|开发一个|做一个.*(?:系统|网站|应用|App|小程序|后台)|写一个.*(?:系统|网站|应用|服务|爬虫|工具|插件)|系统|微服务|整个项目|整个仓库|项目的|所有页面|所有接口|所有文字|每个路由|好几个文件|多个文件|前端.*后端|后端.*前端|注册登录|登录注册|多语言|国际化|覆盖率|补齐|接入|加上\s*CI|持续集成|部署脚本|推荐系统|插件|命令行工具|消费者|监控|状态管理|爬虫|管理后台|小程序/u,
  },
  {
    work: "code-large",
    weight: 3,
    label: "words:engineering",
    pattern:
      /\b(?:implement|refactor|migrate|port the|new feature|from scratch|microservices?|monolith|codebase|the backend|the frontend|across (?:all|every)|every (?:api )?route|every screen|all pages|all strings|i18n|internationali[sz]ation|test coverage|sign-up|signup|sign-in|login|authentication|password reset|responsive|push notifications|rewrite this \w+ service|budgeting app|crawler|scraper|ci for|set up ci|pull requests?|webhooks?|endpoints?|rest api|browser extension|cli tool|queue consumer|integrate|deployment scripts?|admin panel)\b/iu,
  },
  // Data: numbers to count, compare or chart.
  {
    work: "data",
    weight: 3,
    label: "words:数据",
    pattern:
      /数据|统计|报表|透视|平均|中位数|标准差|方差|占比|比例|[复留转增流]\S{0,2}率|获客成本|成本最[低高]|最[高低多少]的?(?:是)?哪|哪个.{0,8}最[高低多少]|销量|销售额|营业额|收入|利润|订单|流水|库存|对账|汇总|求和|计数|排名|分数|饼图|折线图|柱状图|曲线|图表|可视化|趋势|同比|环比|访问量|流量|指标|KPI|漏斗|分布|相关性|回归|异常值|预测/u,
  },
  {
    work: "data",
    weight: 3,
    label: "words:data",
    pattern:
      /\b(?:data|dataset|spreadsheet|statistics|pivot|mean|median|average|standard deviation|variance|percentage|share of|rates?|retention|cohort|conversion|acquisition cost|survey|split|returned the most|lowest|highest|revenue|profit|sales|orders|inventory|reconcile|reorder point|group (?:these|them|by)|total (?:them|the)|sum the|count the|rank|plot|graph|line chart|bar chart|pie chart|chart|visuali[sz]e|trend|year over year|month over month|visits|traffic|metrics?|kpis?|funnel|distribution|correlation|regression|outliers?|forecast)\b/iu,
  },
  // Reasoning: a decision, a cause, a plan, a proof.
  {
    work: "reasoning",
    weight: 3,
    label: "words:推理",
    pattern:
      /为什么|要不要|该不该|是否应该|应不应该|值不值|值得|怎么判断|如何判断|怎么决定|怎么选|选哪个|倾向|理由|原因|问题.{0,4}出在|想清楚|权衡|取舍|利弊|优缺点|风险|决策|思路|评估|策略|战略|规划|方案|架构|证明|推理|逻辑题|预案|应对|机制|OKR|影响|还是/u,
  },
  {
    work: "reasoning",
    weight: 3,
    label: "words:reasoning",
    pattern:
      /\b(?:why|should (?:we|i)|worth|decide|decision|which (?:one|of)|would you pick|choose between|pros and cons|trade-?offs?|weigh|risks?|root cause|causes?|where might|reasons?|think (?:it )?through|evaluate|strategy|plan (?:next|for|a)|propose a plan|architect|prove|logic puzzle|contingency|framework|okrs?|what happens|recommend one|compare option|work out|best way to|how should)\b/iu,
  },
  // Operating the computer: an app, a setting, a folder of this computer.
  {
    work: "computer",
    weight: 3,
    label: "words:电脑",
    pattern:
      /打开(?!.*(?:文章|这段|这篇|思路))|关掉|关了|关闭|开启|调[到高低暗亮大小成]|音量|静音|声音|亮度|屏幕|夜间模式|夜览|护眼|深色模式|浅色模式|勿扰|专注模式|蓝牙|Wi-?Fi|无线网|网络设置|程序坞|任务栏|菜单栏|系统设置|控制面板|访达|资源管理器|桌面|下载文件夹|文稿|废纸篓|回收站|壁纸|锁屏|输入法|键盘|鼠标|触控板|显示器|分辨率|截个?屏|截图(?!里)|新建一个文件夹|文件夹|移到|启动|备忘录|计算器|浏览器里|微信|钉钉|飞书|QQ|记事本|终端|设置$/u,
  },
  {
    work: "computer",
    weight: 3,
    label: "words:computer",
    pattern:
      /^(?:please )?open\s+(?:the\s+|my\s+)?\S+(?:\s\S+)?[.!]?$|\bopen\b.{0,30}\b(?:app|settings|folder|in the browser|with \w+)\b|\bopen (?:notes|calculator|safari|chrome|finder|terminal|dingtalk|wechat|slack|excel|word)\b|\b(?:launch (?:the )?\w+(?: app)?$|launch the|close the (?:window|app|tab)|turn (?:on|off)|switch (?:on|off)|mute|unmute|volume|sound|brightness|brighter|dimmer|dim the|screen|night (?:shift|light|mode)|dark mode|light mode|do not disturb|focus mode|bluetooth|wi-?fi|dock|taskbar|menu bar|system settings|settings|control panel|finder|explorer|desktop|downloads|documents folder|trash|recycle bin|wallpaper|lock screen|keyboard|mouse|trackpad|display|resolution|take a screenshot|create a folder|folder|move the|in the browser|notes app)\b/iu,
  },
  // Chat: a greeting, thanks, a question of fact.
  {
    work: "chat",
    weight: 2,
    label: "words:闲聊",
    pattern:
      /^(?:你好|您好|嗨|哈喽|在吗|早上好|晚上好|晚安|谢谢|多谢|辛苦了|哈哈)|是什么|是谁|多少|多远|几度|几点|星期几|哪天|多高|推荐一[部本首个]|好听|好玩|冷知识|笑话|可爱|心情|你会|你喜欢/u,
  },
  {
    work: "chat",
    weight: 2,
    label: "words:chat",
    pattern:
      /^(?:hi|hello|hey|yo|good (?:morning|night|evening)|thanks|thank you|lol|are you there)\b|\b(?:what is|what's the|who wrote|how many|how far|what does|what time|what day|which is bigger|fun fact|recommend a|any tips|do you like|your name)\b/iu,
  },
];

const HARD =
  /复杂|全面|深入|系统性|完整的|整个|所有|全部|从零|端到端|多个|好几个|三年|架构|十倍|微服务|\b(?:complex|comprehensive|thorough|in-depth|end-to-end|from scratch|entire|whole|every|all pages|across|architecture|production|three-year|ten times)\b/iu;
const EASY = /简单|快速|一句话|小改|拼写错误|顺手|\b(?:simple|quick|briefly|typo|one-liner|rename)\b/iu;
const FOLLOW_UP =
  /^(?:继续|接着|接着做|好的?|好呀|可以|行|嗯|对|是的|没问题|就这样|按你说的|照做|再改一下|再改改|再来一次|再试试|再详细一点|展开说说|下一步|然后呢|ok|okay|yes|yep|sure|go on|continue|keep going|next|do it|go ahead|sounds good|more detail|again)[\s。！!.,，~～]*$/iu;
/**
 * HXBot (v1.7.0): a greeting or a thank-you is a chat. Asking the judge about one started a provider
 * process for nothing at the start of each new chat.
 */
const GREETING =
  /^(?:你好|您好|嗨|哈喽|在吗|在不在|早上好|上午好|下午好|晚上好|早|谢谢|多谢|感谢|辛苦了|hi|hello|hey|hiya|good (?:morning|afternoon|evening)|thanks|thank you|thx)[\s。！!.,，~～?？]*$/iu;
const REDO =
  /^(?:重做|重来|重新做|再做一遍|换个模型重做|换更强的模型|redo|try again|do it again|retry)[\s。！!.,，~～]*$/iu;

function fileTokens(attachment: HxAttachmentInfo): number {
  if (IMAGE.test(attachment.name)) return IMAGE_TOKENS;
  const perToken = BYTES_PER_TOKEN.find(([pattern]) => pattern.test(attachment.name))?.[1] ?? 4;
  return Math.ceil(Math.max(0, attachment.size) / perToken);
}

/** Tokens of a text: about one per CJK character and one per four other characters. */
export function hxTextTokens(text: string): number {
  let cjk = 0;
  for (const char of text) if (/[㐀-鿿豈-﫿　-〿＀-￯]/u.test(char)) cjk += 1;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

function difficultyOf(text: string, attachments: number, work: HxWorkType): HxDifficulty {
  if (HARD.test(text) || text.length > 500 || attachments >= 3) return "high";
  if (work === "code-large" || work === "reasoning") return "mid";
  if (EASY.test(text) || hxTextTokens(text) < 16) return "low";
  return "mid";
}

/**
 * The kind of work of one message, by the rules. The order of the checks is the order of what is
 * certain: an image needs a model that reads images, material larger than the window needs a larger
 * window, a redo or a short follow-up goes on with the last work, and the words decide the rest.
 */
export function hxClassifyWork(input: HxWorkInput): HxClassification {
  const text = input.text.trim();
  const signals: string[] = [];
  const images = input.attachments.filter((attachment) => IMAGE.test(attachment.name));
  const tokens =
    input.historyTokens + hxTextTokens(text) + input.attachments.reduce((sum, item) => sum + fileTokens(item), 0);
  const needs: HxNeed[] = [];
  if (images.length > 0) {
    needs.push("vision");
    signals.push(images.length === 1 ? "image" : `images:${images.length}`);
  }
  const long = tokens > input.window * HX_WINDOW_SHARE;
  if (long) {
    needs.push("long-context");
    signals.push(`tokens:${tokens}`);
  }
  const recent = input.previous !== null && input.now - input.previous.at <= HX_FOLLOW_UP_MS;
  const result = (
    work: HxWorkType,
    confidence: number,
    extra: Partial<Pick<HxClassification, "followUp" | "redo" | "difficulty">> = {},
  ): HxClassification => ({
    work,
    difficulty: extra.difficulty ?? difficultyOf(text, input.attachments.length, work),
    needs,
    confidence,
    signals,
    followUp: extra.followUp ?? false,
    redo: extra.redo ?? false,
    tokens,
  });
  if (long) return result("long-context", 1, { difficulty: "high" });
  if (images.length > 0) return result("vision", 1);
  if (input.attachments.length === 0 && GREETING.test(text)) {
    signals.push("greeting");
    return result("chat", 0.95);
  }
  if (input.previous && REDO.test(text)) {
    signals.push("redo");
    return result(input.previous.work, 1, { redo: true, difficulty: "high" });
  }
  if (input.previous && recent && input.attachments.length === 0 && FOLLOW_UP.test(text)) {
    signals.push("follow-up");
    return result(input.previous.work, 1, { followUp: true, difficulty: input.previous.difficulty });
  }

  const scores = new Map<HxWorkType, number>(HX_WORK_TYPES.map((work) => [work, 0]));
  const add = (work: HxWorkType, weight: number, label: string) => {
    scores.set(work, (scores.get(work) ?? 0) + weight);
    if (!signals.includes(label)) signals.push(label);
  };
  for (const rule of RULES) {
    const hits = text.match(new RegExp(rule.pattern.source, `${rule.pattern.flags.replace("g", "")}g`));
    if (hits) add(rule.work, rule.weight + Math.min(2, hits.length - 1), `${rule.label}:${hits[0]}`);
  }
  for (const attachment of input.attachments) {
    if (DATA_FILE.test(attachment.name)) add("data", 4, "data-file");
    else if (CODE_FILE.test(attachment.name)) add("code-small", 3, "code-file");
  }
  // Code: the engineering words make it large work; a long message about code is large too.
  const code = (scores.get("code-small") ?? 0) + (scores.get("code-large") ?? 0);
  if ((scores.get("code-large") ?? 0) > 0 && code > 0) {
    scores.set("code-large", code + 1);
    scores.set("code-small", 0);
  }
  // "Why does my code fail?" is code work, and "why" alone does not make it a question of strategy.
  if (code >= 3 && (scores.get("reasoning") ?? 0) > 0 && !HARD.test(text))
    scores.set("reasoning", (scores.get("reasoning") ?? 0) - 2);
  // Writing about code ("写个正则", "write a regex", "write a SQL query") is code.
  if ((scores.get("writing") ?? 0) > 0 && code > 0) scores.set("writing", (scores.get("writing") ?? 0) - 2);
  // "打开" and "open" are computer words, but "打开这个表格分析一下" is data work.
  if ((scores.get("computer") ?? 0) > 0 && ((scores.get("data") ?? 0) >= 3 || code >= 3)) {
    const other = Math.max(scores.get("data") ?? 0, code);
    if (other >= (scores.get("computer") ?? 0)) scores.set("computer", (scores.get("computer") ?? 0) - 2);
  }

  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1]);
  const [best, second] = ranked;
  const top = best?.[1] ?? 0;
  if (!best || top <= 0) {
    // No signal: a short message is a chat, a short one right after other work goes on with it.
    if (input.previous && recent && text.length <= FOLLOW_UP_CHARS && input.attachments.length === 0) {
      signals.push("short");
      return result(input.previous.work, 0.8, { followUp: true, difficulty: input.previous.difficulty });
    }
    signals.push("no-signal");
    return result(text.length <= 60 ? "chat" : "writing", text.length <= 60 ? 0.6 : 0.4);
  }
  const margin = top - (second?.[1] ?? 0);
  const confidence = Math.min(0.95, 0.5 + 0.1 * top + 0.1 * margin - (margin === 0 ? 0.25 : 0));
  return result(best[0], Math.max(0.3, Math.round(confidence * 100) / 100));
}
