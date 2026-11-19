// HXBot（v1.7.2，MKT-04）：团队服务器上，命令型（stdio）MCP 只有所有者和管理员能加、改、试、打开。
//
// 一个 stdio 型 MCP 就是在这台电脑上运行的一条命令：普通成员通过 Team API 加一个，等于在主机上运行他写的命令。
// `mcp-member-access-v1` 让成员也能用 MCP 的接口，这里把命令型的留给所有者和管理员；网址型（http）照旧。
// 检查在主机这边做，只看请求里的配置和主机上已存的那一行，不看客户端说自己能做什么。

import type { McpTransport, TeamMemberSummary } from "@hxbot/contracts/ipc";
import { requireAdmin } from "./request-helpers";

/** Refuses a member who is not an owner or admin a server that runs a command on this computer. */
export function hxRequireAdminForCommandServer(member: TeamMemberSummary, transport: McpTransport | undefined): void {
  if (transport === "stdio") requireAdmin(member);
}
