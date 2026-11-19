// HXBot 电脑操控（五）（v1.7.3，需求 CONC-05）：只留一个入口。
//
// macOS 和 Windows 上，HXBot 自己的电脑工具（computer_open、computer_do……）能用：所有电脑操作都经过它们的分道、
// 前台检查、读回核对、发送付款删除先问和操作记录。原生驱动的 MCP 交给提供商的话，模型可以绕过这一切直接点、直接打字，
// 所以这两个系统上不再交出去（mcp-provider-shapes.ts 的 agentMcpServers）。原生驱动里 HXBot 原来没有的
// 截图加坐标点击，由 computer_look 的 screenshot 和 computer_do 的 at 补上。其他系统照旧。
// 这个文件只读 process.platform，让每个提供商客户端都能引用，不把电脑操控的其他部分带进去。

/** Whether an agent with Computer Use on gets the native driver's MCP server on this system. */
export function hxNativeDriverGiven(platform: NodeJS.Platform = process.platform): boolean {
  return platform !== "darwin" && platform !== "win32";
}
