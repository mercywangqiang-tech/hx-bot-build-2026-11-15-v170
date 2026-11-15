// HXBot: the app's links use the hxbot:// scheme. A link that an earlier build made, with the
// upstream scheme, is still read, so a QR code or a pasted invitation from that build keeps working.
import { createHxBotInviteUrl, parseInviteUrl } from "@hxbot/contracts/invite-links";
import { createMobileConnectUrl, parseMobileConnectUrl } from "@hxbot/contracts/mobile-connect";
import { createHxBotPluginUrl, parsePluginUrl } from "@hxbot/contracts/plugin-links";
import { describe, expect, it } from "vitest";
import { MCP_OAUTH_REDIRECT_URL, parseDeepLink } from "./deep-link-router";

const invite = {
  apiUrl: "https://api.bot.hxallai.com",
  serverId: "0f4e6f2a-6c1d-4c57-9b1e-2f6d3a8c5e10",
  fingerprint: "A".repeat(43),
  token: "t".repeat(43),
};

function earlier(link: string): string {
  return link.replace(/^hxbot:/u, "openbot:");
}

describe("the hxbot:// link scheme", () => {
  it("writes invitations with hxbot:// and reads both schemes", () => {
    const link = createHxBotInviteUrl(invite);
    expect(link.startsWith("hxbot://join?")).toBe(true);
    expect(link).not.toContain("openbot");
    expect(parseInviteUrl(link)).toEqual(parseInviteUrl(earlier(link)));
    expect(parseInviteUrl(link).serverId).toBe(invite.serverId);
    expect(parseDeepLink(link)?.kind).toBe("invite");
    expect(parseDeepLink(earlier(link))?.kind).toBe("invite");
  });

  it("refuses other schemes", () => {
    const link = createHxBotInviteUrl(invite);
    expect(parseDeepLink(link.replace(/^hxbot:/u, "otherbot:"))).toBeNull();
    expect(() => parseInviteUrl(link.replace(/^hxbot:/u, "otherbot:"))).toThrow();
  });

  it("writes the phone sign-in code with hxbot:// and reads both schemes", () => {
    const link = createMobileConnectUrl({ apiUrl: invite.apiUrl, ticket: "k".repeat(32) });
    expect(link.startsWith("hxbot://mobile-connect?")).toBe(true);
    expect(parseMobileConnectUrl(link)?.ticket).toBe("k".repeat(32));
    expect(parseMobileConnectUrl(earlier(link))).toEqual(parseMobileConnectUrl(link));
    expect(parseMobileConnectUrl(link.replace(/^hxbot:/u, "otherbot:"))).toBeNull();
  });

  it("writes plugin links with hxbot:// and reads both schemes", () => {
    const link = createHxBotPluginUrl("notes");
    expect(link).toBe("hxbot://plugins/notes");
    expect(parsePluginUrl(link)).toBe("notes");
    expect(parsePluginUrl(earlier(link))).toBe("notes");
  });

  it("returns MCP sign-ins on hxbot://", () => {
    expect(MCP_OAUTH_REDIRECT_URL).toBe("hxbot://mcp-auth");
    expect(parseDeepLink("hxbot://mcp-auth?code=c&state=s")).toEqual({ kind: "mcp-auth", state: "s", code: "c" });
  });
});
