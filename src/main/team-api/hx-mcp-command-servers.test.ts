// HXBot（v1.7.2，MKT-04）：团队服务器上，命令型 MCP 只有所有者和管理员能加。
import type { TeamMemberSummary, TeamRole } from "@hxbot/contracts/ipc";
import { describe, expect, it } from "vitest";
import { HttpError } from "./http-error";
import { hxRequireAdminForCommandServer } from "./hx-mcp-command-servers";

function member(role: TeamRole): TeamMemberSummary {
  return {
    id: `m-${role}`,
    username: role,
    email: null,
    name: null,
    role,
    createdAt: "2026-11-18T00:00:00.000Z",
    disabled: false,
  };
}

describe("a server that runs a command on the host", () => {
  it("is for owners and admins only; a web address server stays open to members", () => {
    expect(() => hxRequireAdminForCommandServer(member("owner"), "stdio")).not.toThrow();
    expect(() => hxRequireAdminForCommandServer(member("admin"), "stdio")).not.toThrow();
    expect(() => hxRequireAdminForCommandServer(member("member"), "http")).not.toThrow();
    expect(() => hxRequireAdminForCommandServer(member("member"), undefined)).not.toThrow();
    const refuse = () => hxRequireAdminForCommandServer(member("member"), "stdio");
    expect(refuse).toThrow(HttpError);
    expect(refuse).toThrow(expect.objectContaining({ status: 403 }));
  });
});
