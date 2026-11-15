// 把真实模型与真机检查（scripts/hx-real-check.ts）打成一个只依赖 Node 的文件。界面文字表换成
// hx/computer-check/i18n-stub.ts：它太大，里面还写着服务器的地址。
//   bun hx/scripts/real-check-build.ts 输出文件
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const out = process.argv[2];
if (!out) {
  console.error("用法：bun hx/scripts/real-check-build.ts 输出文件");
  process.exit(1);
}
const root = resolve(import.meta.dir, "../..");
const stub = join(root, "hx/computer-check/i18n-stub.ts");
const result = await Bun.build({
  entrypoints: [join(root, "scripts/hx-real-check.ts")],
  target: "node",
  format: "esm",
  plugins: [
    {
      name: "hx-i18n-stub",
      setup(build) {
        build.onResolve({ filter: /^@hxbot\/i18n(?:\/source)?$/ }, () => ({ path: stub }));
      },
    },
  ],
});
if (!result.success) {
  for (const message of result.logs) console.error(message);
  process.exit(1);
}
const [output] = result.outputs;
if (!output) process.exit(1);
await writeFile(resolve(out), await output.text(), "utf8");
