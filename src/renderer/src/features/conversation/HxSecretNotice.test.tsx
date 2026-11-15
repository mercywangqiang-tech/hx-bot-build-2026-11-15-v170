// HXBot：聊天框拦下密码、密钥的提醒（hx-secret-guard.ts、HxSecretNotice.tsx）。
import { fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HxSecretNotice } from "./HxSecretNotice";
import { dismissHeldSecret, holdSecretMessage, registerHxVaultOpener } from "./hx-secret-guard";

const SECRET = "我的密码是 Abc12345，帮我登录";

afterEach(() => dismissHeldSecret());

describe("the password notice in the composer", () => {
  it("holds a message with a password and sends it once after Send anyway", () => {
    const [draft] = createSignal(SECRET);
    render(() => <HxSecretNotice draftText={draft()} serverId="local" />);
    const resume = vi.fn();
    expect(holdSecretMessage(SECRET, resume)).toBe(true);
    flush();
    expect(screen.getByText("This message looks like it contains a password or a key")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send anyway" }));
    flush();
    expect(resume).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("This message looks like it contains a password or a key")).toBeNull();
    // The resumed send goes through, once.
    expect(holdSecretMessage(SECRET, resume)).toBe(false);
    expect(holdSecretMessage(SECRET, resume)).toBe(true);
  });

  it("lets an ordinary message through", () => {
    expect(holdSecretMessage("请帮我总结这份报告", vi.fn())).toBe(false);
  });

  it("opens the Vault of the server", () => {
    const open = vi.fn();
    const unregister = registerHxVaultOpener(open);
    render(() => <HxSecretNotice draftText={SECRET} serverId="host-1" />);
    holdSecretMessage(SECRET, vi.fn());
    flush();
    fireEvent.click(screen.getByRole("button", { name: "Open the Vault" }));
    expect(open).toHaveBeenCalledWith("host-1", expect.any(HTMLElement));
    unregister();
  });

  it("has no Vault button where no workspace can open it", () => {
    render(() => <HxSecretNotice draftText={SECRET} serverId="local" />);
    holdSecretMessage(SECRET, vi.fn());
    flush();
    expect(screen.queryByRole("button", { name: "Open the Vault" })).toBeNull();
    expect(screen.getByRole("button", { name: "Send anyway" })).toBeTruthy();
  });

  it("hides the notice when the user changes the text", () => {
    const [draft, setDraft] = createSignal(SECRET);
    render(() => <HxSecretNotice draftText={draft()} serverId="local" />);
    holdSecretMessage(SECRET, vi.fn());
    flush();
    expect(screen.getByText("This message looks like it contains a password or a key")).toBeTruthy();
    setDraft("我把密码存进保密箱了，名称是 公司邮箱");
    flush();
    expect(screen.queryByText("This message looks like it contains a password or a key")).toBeNull();
  });
});
