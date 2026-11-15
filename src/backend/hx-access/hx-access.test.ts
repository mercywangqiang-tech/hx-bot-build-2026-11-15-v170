// HXBot：最大权限的判定、允许一次的授权、始终允许的规则和操作记录、确认卡片。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname as pathDirname, resolve as resolvePath } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ACCESS_QUESTION_ID,
  accessChoice,
  accessIsPayment,
  accessNote,
  accessQuestion,
  accessRuleTargets,
  parseAccessRequest,
} from "./card";
import { HxAccessGrants } from "./grants";
import {
  type AccessAction,
  type AccessContext,
  type AccessGrant,
  type AccessOperation,
  type AccessTarget,
  analyzeCommand,
  commandOperations,
  decideAccess,
  hxProtectedRoots,
} from "./policy";
import { HxAccessStore } from "./rules";

let base: string;
let workspace: string;
let outside: string;
let keys: string;

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "hx-access-"));
  workspace = join(base, "workspace");
  outside = join(base, "documents");
  keys = join(base, "home", ".ssh");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(join(workspace, "build"), { recursive: true });
  writeFileSync(join(workspace, "src", "a.ts"), "a");
  mkdirSync(outside, { recursive: true });
  mkdirSync(keys, { recursive: true });
  writeFileSync(join(outside, "report.txt"), "report");
  writeFileSync(join(keys, "id_rsa"), "key");
  symlinkSync(outside, join(workspace, "link-out"));
});

afterAll(() => rmSync(base, { recursive: true, force: true }));

function grant(targets: AccessTarget[], actions: AccessAction[], extra: Partial<AccessGrant> = {}): AccessGrant {
  return {
    id: "g",
    agentId: "a",
    threadId: "t",
    turnId: "u",
    targets,
    actions,
    reason: "r",
    purpose: "p",
    grantedAt: 0,
    once: false,
    ...extra,
  };
}

function context(grants: AccessGrant[] = []): AccessContext {
  return { roots: [workspace], grants, protectedRoots: [keys], platform: "linux" };
}

function decide(operations: AccessOperation[], grants: AccessGrant[] = []): boolean {
  return decideAccess(context(grants), operations).allowed;
}

const read = (path: string): AccessOperation => ({ kind: "path", action: "read", path });
const write = (path: string): AccessOperation => ({ kind: "path", action: "write", path });
const remove = (path: string): AccessOperation => ({ kind: "path", action: "delete", path });

describe("files", () => {
  it("works freely in the workspace: reading, writing and deleting", () => {
    expect(decide([read(join(workspace, "src/a.ts"))])).toBe(true);
    expect(decide([write(join(workspace, "src/a.ts"))])).toBe(true);
    expect(decide([write(join(workspace, "new/b.ts"))])).toBe(true);
    expect(decide([remove(join(workspace, "src/a.ts"))])).toBe(true);
  });

  it("reads anywhere, except where keys and logins are kept", () => {
    expect(decide([read(join(outside, "report.txt"))])).toBe(true);
    expect(decide([read("/etc/hosts")])).toBe(true);
    expect(decide([read(join(keys, "id_rsa"))])).toBe(false);
    expect(decide([read(join(keys, "id_rsa"))], [grant([{ type: "folder", value: keys }], ["read"])])).toBe(true);
  });

  it("creates new files anywhere, and asks before it changes one that is there", () => {
    const report = join(outside, "report.txt");
    expect(decide([write(join(outside, "new.txt"))])).toBe(true);
    expect(decide([write(join(outside, "deeper/new.txt"))])).toBe(true);
    expect(decide([write(report)])).toBe(false);
    expect(decide([write(report)], [grant([{ type: "file", value: report }], ["write"])])).toBe(true);
    expect(decide([write(report)], [grant([{ type: "file", value: report }], ["read"])])).toBe(false);
    // Where keys are kept, a new file needs the confirmation too.
    expect(decide([write(join(keys, "authorized_keys2"))])).toBe(false);
    // A test can say what exists.
    expect(decideAccess({ ...context(), exists: () => false }, [write(report)]).allowed).toBe(true);
  });

  it("asks before it deletes outside, and a folder covers what is inside", () => {
    const report = join(outside, "report.txt");
    expect(decide([remove(report)])).toBe(false);
    expect(decide([remove(report)], [grant([{ type: "folder", value: outside }], ["delete"])])).toBe(true);
    expect(decide([remove(join(outside, "x/y.txt"))], [grant([{ type: "folder", value: outside }], ["delete"])])).toBe(
      true,
    );
    expect(decide([remove(join(outside, "other.txt"))], [grant([{ type: "file", value: report }], ["delete"])])).toBe(
      false,
    );
  });

  it("does not let a link in the workspace, .. or a look-alike name lead outside", () => {
    expect(decide([remove(join(workspace, "link-out/report.txt"))])).toBe(false);
    expect(decide([write(join(workspace, "link-out/report.txt"))])).toBe(false);
    expect(decide([write(join(workspace, "../documents/report.txt"))])).toBe(false);
    expect(decide([remove(`${workspace}-other/file`)])).toBe(false);
  });

  it("lists HXBot's own data folder with the places where keys are kept", () => {
    const roots = hxProtectedRoots("/home/u", ["/home/u/.config/HXBot"], "linux");
    expect(roots).toContain("/home/u/.ssh");
    expect(roots).toContain("/home/u/.config/google-chrome");
    expect(roots).toContain("/home/u/Library/Keychains");
    expect(roots).toContain("/home/u/.config/HXBot");
  });
});

describe("websites, the screen, web search, passwords, payments and the Vault", () => {
  it("uses websites, the screen and web search without asking", () => {
    expect(decide([{ kind: "site", action: "write", url: "https://shop.example.com/cart" }])).toBe(true);
    expect(decide([{ kind: "screen" }, { kind: "search" }])).toBe(true);
  });

  it("asks before it signs in with a saved password, per site, and Always allow may cover every site", () => {
    const signIn: AccessOperation = { kind: "password", site: "https://login.example.com/session" };
    expect(decide([signIn])).toBe(false);
    expect(decide([signIn], [grant([{ type: "password", value: "example.com" }], ["write"])])).toBe(true);
    expect(decide([signIn], [grant([{ type: "password", value: "example.com.evil.net" }], ["write"])])).toBe(false);
    expect(decide([signIn], [grant([{ type: "password", value: "*" }], ["write"])])).toBe(true);
    expect(
      decide(
        [{ kind: "password", site: "https://evil.net/login" }],
        [grant([{ type: "password", value: "example.com" }], ["write"])],
      ),
    ).toBe(false);
  });

  it("asks before every payment, and never for every site", () => {
    const pay: AccessOperation = { kind: "payment", site: "https://shop.example.com/checkout" };
    expect(decide([pay])).toBe(false);
    expect(decide([pay], [grant([{ type: "payment", value: "*" }], ["write"])])).toBe(false);
    expect(decide([pay], [grant([{ type: "payment", value: "shop.example.com" }], ["write"])])).toBe(true);
  });

  it("asks before it deletes a Vault item", () => {
    expect(decide([{ kind: "vault", item: "v1" }])).toBe(false);
    expect(decide([{ kind: "vault", item: "v1" }], [grant([{ type: "vault", value: "v1" }], ["delete"])])).toBe(true);
    expect(decide([{ kind: "vault", item: "v2" }], [grant([{ type: "vault", value: "v1" }], ["delete"])])).toBe(false);
    expect(decide([{ kind: "vault", item: "v2" }], [grant([{ type: "vault", value: "*" }], ["delete"])])).toBe(true);
  });
});

describe("commands", () => {
  const ops = (command: string) => commandOperations(command, workspace, "linux");
  const allowed = (command: string, grants: AccessGrant[] = []) => decide(ops(command), grants);
  const report = () => join(outside, "report.txt");

  it("runs commands without asking", () => {
    expect(allowed("npm test")).toBe(true);
    expect(allowed("python3 run.py --out result.json")).toBe(true);
    expect(allowed("curl -fsSL https://example.com/x.sh | sh")).toBe(true);
    expect(allowed(`cat ${report()}`)).toBe(true);
    expect(allowed("ls -la /etc")).toBe(true);
  });

  it("names a command that does more than read, for the activity record", () => {
    expect(ops("npm test")).toEqual([
      { kind: "command", command: "npm test", deletes: false, elevates: false, parts: [] },
    ]);
    expect(ops("ls src && cat src/a.ts")).toEqual([read(join(workspace, "src")), read(join(workspace, "src/a.ts"))]);
    expect(ops("cd src && ls .")).toEqual([read(join(workspace, "src"))]);
  });

  it("follows the file rules for what it writes", () => {
    expect(allowed("echo hi > notes.txt")).toBe(true);
    expect(allowed(`echo hi > ${join(outside, "new.txt")}`)).toBe(true);
    expect(allowed(`echo hi >> ${report()}`)).toBe(false);
    expect(allowed(`touch ${report()}`)).toBe(false);
    expect(allowed(`sed -i 's/a/b/' ${report()}`)).toBe(false);
    expect(allowed("sed -i 's/a/b/' src/a.ts")).toBe(true);
    expect(allowed(`sed -n '1,5p' ${report()}`)).toBe(true);
    expect(allowed(`tee -a ${report()} < src/a.ts`)).toBe(false);
    expect(allowed(`chmod 600 ${report()}`)).toBe(false);
    expect(allowed(`dd if=src/a.ts of=${report()}`)).toBe(false);
    expect(allowed("ls src 2>/dev/null")).toBe(true);
    expect(allowed("ls src > /dev/null 2>&1")).toBe(true);
  });

  it("copies into a folder as new files, and asks before it copies over a file", () => {
    expect(allowed(`cp src/a.ts ${outside}`)).toBe(true);
    expect(allowed(`cp src/a.ts ${outside}/`)).toBe(true);
    expect(allowed(`cp -t ${outside} src/a.ts`)).toBe(true);
    expect(allowed(`cp src/a.ts ${report()}`)).toBe(false);
    writeFileSync(join(outside, "a.ts"), "there");
    expect(allowed(`cp src/a.ts ${outside}`)).toBe(false);
    rmSync(join(outside, "a.ts"));
    expect(allowed(`mkdir -p ${outside}`)).toBe(true);
    expect(allowed(`mkdir -p ${join(outside, "new/deeper")}`)).toBe(true);
  });

  it("takes mv as a delete of what it moves", () => {
    expect(allowed("mv src/a.ts src/b.ts")).toBe(true);
    expect(allowed(`mv ${report()} src/`)).toBe(false);
    expect(allowed(`mv ${report()} src/`, [grant([{ type: "file", value: report() }], ["delete"])])).toBe(true);
    expect(allowed(`mv src/a.ts ${report()}`)).toBe(false);
  });

  it("deletes freely in the workspace and asks outside", () => {
    expect(allowed("rm -rf build")).toBe(true);
    expect(allowed("rm -rf ./build ../workspace/src")).toBe(true);
    expect(allowed(`rm ${report()}`)).toBe(false);
    expect(allowed(`rm ${report()}`, [grant([{ type: "folder", value: outside }], ["delete"])])).toBe(true);
    expect(allowed(`rm ${report()}`, [grant([{ type: "folder", value: outside }], ["write"])])).toBe(false);
    expect(allowed("find . -name '*.tmp' -delete")).toBe(true);
    expect(allowed(`find ${outside} -name '*.txt' -delete`)).toBe(false);
    expect(allowed(`find ${outside} -name '*.txt' -exec rm {} \\;`)).toBe(false);
    expect(allowed(`find ${outside} -name '*.txt' -exec wc -l {} \\;`)).toBe(true);
    expect(allowed("git clean -fdx")).toBe(true);
    expect(allowed(`git -C ${outside} clean -fdx`)).toBe(false);
    expect(allowed(`rsync -a --delete src/ ${outside}/mirror`)).toBe(false);
  });

  it("follows cd for the parts after it", () => {
    expect(allowed("cd src && rm a.ts")).toBe(true);
    expect(allowed("cd .. && rm documents/report.txt")).toBe(false);
    expect(allowed(`cd ${outside} && echo x > report.txt`)).toBe(false);
    expect(allowed(`cd ${outside} && echo x > fresh.txt`)).toBe(true);
    // A folder that cannot be told: a delete or a change there needs the confirmation.
    expect(allowed("cd $TARGET && rm a.ts")).toBe(false);
    expect(allowed("cd $TARGET && echo x > a.ts")).toBe(false);
  });

  it("reads a shell wrapper's inner command", () => {
    expect(allowed("/bin/zsh -lc 'rm -rf build'")).toBe(true);
    expect(allowed(`bash -lc 'rm -f ${report()}'`)).toBe(false);
  });

  it("asks before sudo, and Always allow for `sudo apt` covers what starts with it", () => {
    expect(allowed("sudo apt install jq")).toBe(false);
    expect(allowed("sudo -u root ls")).toBe(false);
    expect(allowed("doas reboot")).toBe(false);
    const apt = grant([{ type: "command", value: "sudo apt" }], ["write", "delete"]);
    expect(allowed("sudo apt install jq", [apt])).toBe(true);
    expect(allowed("apt install jq && sudo rm -rf /", [apt])).toBe(false);
    expect(allowed("sudo apt-get install jq", [apt])).toBe(false);
    expect(allowed("sudo apt install jq", [grant([{ type: "command", value: "*" }], ["write"])])).toBe(true);
    expect(
      allowed("sudo apt install jq", [grant([{ type: "command", value: "sudo apt install jq" }], ["write"])]),
    ).toBe(true);
  });

  it("asks for a command it cannot read when it deletes or runs as administrator", () => {
    expect(analyzeCommand("cat $(echo /etc/hosts)")).toBeNull();
    expect(allowed("cat $(echo /etc/hosts)")).toBe(true);
    expect(allowed("x=$(ls); rm -rf $x")).toBe(false);
    expect(allowed("echo `whoami` && sudo id")).toBe(false);
    expect(allowed("rm -rf $TARGET")).toBe(false);
    expect(allowed("rm -rf $TARGET", [grant([{ type: "command", value: "rm" }], ["delete"])])).toBe(true);
    expect(ops("rm -rf $TARGET")).toEqual([
      { kind: "command", command: "rm -rf $TARGET", deletes: true, elevates: false, parts: [["rm", "-rf", "$TARGET"]] },
    ]);
  });

  it("finds a read of a key file inside an option", () => {
    expect(allowed(`grep --file=${join(keys, "id_rsa")} x src/a.ts`)).toBe(false);
    expect(allowed(`cat ${join(keys, "id_rsa")}`)).toBe(false);
  });
});

describe("Allow once", () => {
  it("covers each target once", () => {
    const grants = new HxAccessGrants();
    const report = join(outside, "report.txt");
    const other = join(outside, "other.txt");
    const once = grants.add({
      agentId: "a",
      threadId: "t",
      turnId: "u",
      targets: [
        { type: "file", value: report },
        { type: "file", value: other },
      ],
      actions: ["delete"],
      reason: "r",
      purpose: "p",
      once: true,
    });
    const first = decideAccess(context(grants.forThread("a", "t")), [remove(report)]);
    expect(first).toMatchObject({ allowed: true, used: [{ grantId: once.id, target: 0 }] });
    if (first.allowed) grants.consume(first.used);
    expect(decide([remove(report)], grants.forThread("a", "t"))).toBe(false);
    const second = decideAccess(context(grants.forThread("a", "t")), [remove(other)]);
    expect(second.allowed).toBe(true);
    if (second.allowed) grants.consume(second.used);
    expect(grants.forThread("a", "t")).toEqual([]);
  });

  it("is not used up by plain work, and a rule is never used up", () => {
    const grants = new HxAccessGrants();
    grants.add({
      agentId: "a",
      threadId: "t",
      turnId: "u",
      targets: [{ type: "folder", value: outside }],
      actions: ["delete"],
      reason: "r",
      purpose: "p",
      once: true,
    });
    const plain = decideAccess(context(grants.forThread("a", "t")), [write(join(workspace, "x.ts"))]);
    expect(plain).toMatchObject({ allowed: true, used: [] });
    const rule = grant([{ type: "folder", value: outside }], ["delete"], { id: "rule-1", agentId: "*" });
    const used = decideAccess(context([rule]), [remove(join(outside, "report.txt"))]);
    expect(used).toMatchObject({ allowed: true, used: [{ grantId: "rule-1", target: 0 }] });
    grants.consume(used.allowed ? used.used : []);
    expect(grants.forThread("a", "t")).toHaveLength(1);
  });

  it("ends with its turn, by thread, by agent, or one by one", () => {
    const grants = new HxAccessGrants();
    const changes: string[] = [];
    grants.onChange((agentId) => changes.push(agentId));
    const input = { targets: [], actions: ["read" as const], reason: "", purpose: "", once: true };
    const first = grants.add({ ...input, agentId: "a", threadId: "t1", turnId: "u1" });
    grants.add({ ...input, agentId: "a", threadId: "t1", turnId: "u2" });
    grants.add({ ...input, agentId: "b", threadId: "t2", turnId: "u3" });
    expect(grants.forThread("a", "t1")).toHaveLength(2);
    expect(grants.releaseTurn("t1", "u2")).toBe(1);
    expect(grants.release(first.id)).toBe(true);
    expect(grants.release(first.id)).toBe(false);
    expect(grants.forAgent("a")).toEqual([]);
    expect(grants.releaseAgent("b")).toBe(1);
    expect(changes).toEqual(["a", "a", "b", "a", "a", "b"]);
  });
});

describe("Always allow rules and the activity record", () => {
  it("keeps the rules in the data folder, readable only by this user, for every agent", () => {
    const folder = join(base, "data-rules");
    const store = new HxAccessStore();
    store.open(folder);
    const rule = store.addRule({
      targets: [{ type: "folder", value: outside }],
      actions: ["write", "delete"],
      agentName: "小犀",
      reason: "整理文档",
    });
    expect(rule.id.startsWith("rule-")).toBe(true);
    const file = join(folder, "hx-access-rules.json");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8")).rules).toHaveLength(1);
    expect(store.ruleGrants()).toEqual([
      expect.objectContaining({ id: rule.id, agentId: "*", once: false, actions: ["write", "delete"] }),
    ]);
    const again = new HxAccessStore();
    again.open(folder);
    expect(again.rules()).toEqual([rule]);
    expect(again.removeRule(rule.id)).toBe(true);
    expect(again.removeRule(rule.id)).toBe(false);
    const third = new HxAccessStore();
    third.open(folder);
    expect(third.rules()).toEqual([]);
  });

  it("starts with no rules when the file cannot be read, and records nothing before it is opened", () => {
    const folder = join(base, "data-broken");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "hx-access-rules.json"), "{ not json");
    const store = new HxAccessStore();
    store.record({ agent: "a", kind: "screen", detail: "", outcome: "auto" });
    expect(store.log()).toEqual([]);
    store.open(folder);
    expect(store.rules()).toEqual([]);
  });

  it("records the newest first, keeps the last 2000 and can be cleared", () => {
    const folder = join(base, "data-log");
    const store = new HxAccessStore();
    let changes = 0;
    store.onChange(() => {
      changes += 1;
    });
    store.open(folder);
    store.record({ agent: "小犀", kind: "delete", detail: join(outside, "report.txt"), outcome: "held" });
    store.record({ agent: "小犀", kind: "request", detail: "file x", outcome: "allowed-once" });
    expect(store.log().map((entry) => entry.outcome)).toEqual(["allowed-once", "held"]);
    expect(statSync(join(folder, "hx-access-log.jsonl")).mode & 0o777).toBe(0o600);
    writeFileSync(
      join(folder, "hx-access-log.jsonl"),
      `${readFileSync(join(folder, "hx-access-log.jsonl"), "utf8")}not json\n`,
    );
    expect(store.log()).toHaveLength(2);
    for (let index = 0; index < 3000; index += 1)
      store.record({ agent: "a", kind: "command", detail: `n ${index}`, outcome: "auto" });
    const lines = readFileSync(join(folder, "hx-access-log.jsonl"), "utf8").split("\n").filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(3000);
    expect(lines.length).toBeGreaterThanOrEqual(2000);
    expect(store.log(1)[0]?.detail).toBe("n 2999");
    store.clearLog();
    expect(store.log()).toEqual([]);
    expect(changes).toBeGreaterThan(3000);
  });

  it("keeps a long detail short", () => {
    const store = new HxAccessStore();
    store.open(join(base, "data-long"));
    store.record({ agent: "a", kind: "command", detail: "x".repeat(2000), outcome: "auto" });
    expect(store.log()[0]?.detail).toHaveLength(500);
  });
});

describe("the card", () => {
  const resolve = (path: string) => resolvePath(workspace, path);

  it("checks the request and makes paths absolute", () => {
    expect(parseAccessRequest({ reason: "", purpose: "p", targets: [], actions: ["read"] }, resolve)).toBe(
      "Say why you need it in reason.",
    );
    expect(
      parseAccessRequest({ reason: "r", purpose: "p", targets: [{ type: "file", value: "a" }] }, resolve),
    ).toContain("actions");
    const request = parseAccessRequest(
      {
        reason: "需要改报告",
        purpose: "更新数据",
        targets: [
          { type: "file", value: "../documents/report.txt" },
          { type: "command", value: "sudo   apt" },
          { type: "password", value: "https://www.Example.com/login" },
          { type: "screen" },
        ],
        actions: ["write", "fly"],
      },
      resolve,
    );
    expect(request).toEqual({
      reason: "需要改报告",
      purpose: "更新数据",
      targets: [
        { type: "file", value: join(base, "documents/report.txt") },
        { type: "command", value: "sudo apt" },
        { type: "password", value: "example.com" },
        { type: "screen", value: "" },
      ],
      actions: ["write"],
    });
    expect(
      parseAccessRequest({ reason: "r", purpose: "p", targets: [{ type: "vault", value: "v1" }] }, resolve),
    ).toMatchObject({ actions: ["write", "delete"] });
    expect(
      parseAccessRequest({ reason: "r", purpose: "p", targets: [{ type: "payment", value: "not a site!" }] }, resolve),
    ).toContain("not a website");
  });

  it("asks once, with Allow once, Always allow and Refuse", () => {
    const request = parseAccessRequest(
      {
        reason: "改报告",
        purpose: "更新",
        targets: [{ type: "file", value: join(outside, "report.txt") }],
        actions: ["write"],
      },
      resolve,
    );
    if (typeof request === "string") throw new Error(request);
    const question = accessQuestion(request, "研究助手", "zh");
    expect(question.id).toBe(ACCESS_QUESTION_ID);
    expect(question.header).toBe("需要你确认");
    expect(question.multiSelect).toBe(false);
    expect(question.question).toContain("**研究助手** 要做下面的事");
    expect(question.question).toContain("改报告");
    expect(question.question).toContain("修改");
    expect(question.question).toContain(`文件 \`${join(outside, "report.txt")}\``);
    expect(question.question).toContain("始终允许这个文件夹");
    expect(question.options?.map((option) => option.label)).toEqual(["允许一次", "始终允许", "拒绝"]);
    expect(question.options?.[1]?.description).toContain("文件夹");
    expect(accessQuestion(request, "Agent", "en").options?.map((option) => option.label)).toEqual([
      "Allow once",
      "Always allow",
      "Refuse",
    ]);
  });

  it("offers no Always allow for a payment", () => {
    const request = parseAccessRequest(
      {
        reason: "下单",
        purpose: "付 ¥99 给 shop.example.com",
        targets: [{ type: "payment", value: "shop.example.com" }],
      },
      resolve,
    );
    if (typeof request === "string") throw new Error(request);
    expect(accessIsPayment(request)).toBe(true);
    const question = accessQuestion(request, "小犀", "zh");
    expect(question.options?.map((option) => option.label)).toEqual(["允许一次", "拒绝"]);
    expect(question.question).toContain("付款每次都要确认");
  });

  it("reads the choice, and a note written beside it", () => {
    expect(accessChoice({ [ACCESS_QUESTION_ID]: ["始终允许"] })).toBe("always");
    expect(accessChoice({ [ACCESS_QUESTION_ID]: ["Allow once"] })).toBe("once");
    expect(accessChoice({ [ACCESS_QUESTION_ID]: ["拒绝"] })).toBe("refuse");
    expect(accessChoice({ [ACCESS_QUESTION_ID]: ["随便写的"] })).toBe("refuse");
    expect(accessChoice({})).toBe("refuse");
    expect(accessNote({ [ACCESS_QUESTION_ID]: ["允许一次", "只改第 3 页"] })).toBe("只改第 3 页");
  });

  it("turns a file into its folder for Always allow", () => {
    const file = join(outside, "report.txt");
    expect(
      accessRuleTargets(
        [
          { type: "file", value: file },
          { type: "file", value: join(outside, "other.txt") },
          { type: "folder", value: keys },
          { type: "command", value: "sudo apt" },
        ],
        pathDirname,
      ),
    ).toEqual([
      { type: "folder", value: outside },
      { type: "folder", value: keys },
      { type: "command", value: "sudo apt" },
    ]);
  });
});
