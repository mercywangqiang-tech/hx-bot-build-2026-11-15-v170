// HXBot：按 apps/auth-api/src/routes 里现有的页面重新生成 routeTree.gen.ts，与 TanStack Start
// 构建时生成的完全相同。删掉上游官网页面后由 hx/brand_rename.py 调用。用法：node hx/scripts/gen-route-tree.mjs [账号服务目录]
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "../../apps/auth-api"),
);
const require = createRequire(path.join(root, "package.json"));
const gen = await import(require.resolve("@tanstack/router-generator"));
const footer = [
  "import type { getRouter } from './router.tsx'\nimport type { createStart } from '@tanstack/solid-start'\ndeclare module '@tanstack/solid-start' {\n  interface Register {\n    ssr: true\n    router: Awaited<ReturnType<typeof getRouter>>\n  }\n}",
];
const config = gen.getConfig(
  {
    target: "solid",
    routesDirectory: `${root}/src/routes`,
    generatedRouteTree: `${root}/src/routeTree.gen.ts`,
    routeTreeFileFooter: footer,
    disableLogging: true,
  },
  root,
);
const g = new gen.Generator({ config, root });
await g.run();
