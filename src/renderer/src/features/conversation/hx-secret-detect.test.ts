// HXBot：聊天框识别密码、密钥（packages/contracts/src/hx-secret-detect.ts）。
import { findHxSecrets, hasHxSecret } from "@hxbot/contracts/hx-secret-detect";
import { describe, expect, it } from "vitest";

describe("a message with a secret", () => {
  it.each([
    ["an OpenAI key", "用这个 key：sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345"],
    ["an Anthropic key", "sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"],
    ["a GitHub token", "token ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"],
    ["a GitHub fine-grained token", "github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123"],
    ["an AWS key id", "AKIAIOSFODNN7EXAMPLE 是我的 key"],
    ["a Google key", "AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q"],
    ["a Slack token", "xoxb-1234567890-abcdefghijk"],
    ["a Stripe key", "sk_live_51HabcdefGHIJKLmnop"],
    ["a JWT", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"],
    [
      "a private key",
      "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----",
    ],
    ["a Chinese password", "我的邮箱密码是 Abc12345，帮我登录"],
    ["a password after a colon", "网站账号 hx@example.com 密码：qwer!2026"],
    ["an English password", "the password is hunter2!!"],
    ["a token after equals", "TOKEN=f00ba4baz9qux"],
    ["a random key", "key: 9fK2mQ7xR4tL8wZ1pV6nB3cH5jD0sY2gE7uA"],
  ])("finds %s", (_name, text) => {
    expect(hasHxSecret(text)).toBe(true);
  });

  it("says where the value is", () => {
    const text = "密码是 Abc12345 谢谢";
    const [match] = findHxSecrets(text);
    expect(match?.kind).toBe("password");
    expect(text.slice(match?.start, match?.end)).toBe("Abc12345");
  });
});

describe("an ordinary message", () => {
  it.each([
    ["a question about passwords", "怎么设置一个安全的密码？"],
    ["a mention of the vault", "密码在保密箱里，名称是 GitHub"],
    ["a placeholder", "password: ******"],
    ["a placeholder in brackets", "设置 password=<password> 即可"],
    ["a path after token", "token=/Users/me/.config/token"],
    ["a git commit", "请看提交 3f8a9c2d1e4b5a6f7c8d9e0a1b2c3d4e5f6a7b8c"],
    ["a UUID", "会话 550e8400-e29b-41d4-a716-446655440000 出错了"],
    ["a URL", "打开 https://bot.hxallai.com/guide/#faq"],
    ["a long identifier", "函数 useConversationComposerSubmitHandler 有问题"],
    ["code in a fence", "```\nconst hash = 'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5';\n```"],
    ["a short word", "好的"],
    ["an empty message", ""],
  ])("does not flag %s", (_name, text) => {
    expect(findHxSecrets(text)).toEqual([]);
  });

  it("still flags a known key inside a code block", () => {
    expect(hasHxSecret("```\nexport OPENAI_API_KEY=sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345\n```")).toBe(true);
  });
});
