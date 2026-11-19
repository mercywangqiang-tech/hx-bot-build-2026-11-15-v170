"""HXBot v1.7.2：修 bug（用户 2026-11-18：“本次把所有bug都修正了！”）。

用户 2026-11-18：
1. “在windows 和mac的程序坞出现多个HXBot的图表！这个一定要修正！”（一打开就多个，用着用着变多，Mac 和 Windows 都有）
2. “HXBot启动后，电脑文件打开存储都出先卡死现象！”（在别的应用里打开、保存文件时）
3. “其他bug，这次全部处理干净！”

这一步改上游文件，只做接线；HX 自己的代码在各自的 hx-*.ts 里。
"""

from __future__ import annotations

import brand_rename

INDEX = "src/main/index.ts"
LOCAL_SERVERS = "src/main/local-servers/local-servers.ts"
SERVICES = "src/main/application-services.ts"
LINKS = "src/main/external-link-opener.ts"
MCP_ROUTE = "src/main/team-api/route-mcp.ts"


def dock_of_local_servers(r) -> None:
    """Mac：本机服务器子进程（每个“这台电脑上的服务器”一个 HXBot 进程）在程序坞里不出现。

    原来只在启动最早的时候调一次 app.dock.hide()。这时应用还在启动、正在激活，macOS 会悄悄丢掉这次
    隐藏（Gitify #3100 在真机上复现过同样的竞争），图标就整场留在程序坞里：开几个服务器多几个 HXBot
    图标，新建服务器、重启服务器再多一个。改成：启动时先设成“附属应用”（accessory）再隐藏，就绪以后
    再设一次，并在之后 30 秒里每隔一会儿看一次，还在就再隐藏（src/main/hx-dock.ts）。
    """
    brand_rename.add_import(r, INDEX, 'import { hxKeepChildWindowsHidden, hxKeepOutOfDock } from "./hx-dock";')
    r.replace(INDEX,
              "// A local server has no window, so it has no Dock tile either.\n"
              "if (localServerChild && process.platform === \"darwin\") app.dock?.hide();\n",
              "// A local server has no window, so it has no Dock tile either.\n"
              "// HXBot (v1.7.2): a hide this early can be lost while macOS activates the app; hx-dock.ts repeats it\n"
              "// after `ready` until it holds. Each local server left one more HXBot icon in the Dock.\n"
              "if (localServerChild && process.platform === \"darwin\") hxKeepOutOfDock(app);\n")


def windows_of_local_servers(r) -> None:
    """本机服务器子进程不显示任何窗口：每个窗口不进任务栏，被显示了就再藏起来（src/main/hx-dock.ts）。

    子进程是服务器，没有自己的界面；它的窗口一旦被显示，就是桌面上一个空白的 HXBot 窗口、Windows 任务栏里
    多一个 HXBot 按钮。上游只让“显示主窗口”这一条路不显示，别的路（窗口自己的 show）照样能显示。
    """
    r.replace(INDEX,
              "if (serverMode || hostedServer || localServerChild) keepWindowsHidden();\n",
              "if (serverMode || hostedServer || localServerChild) keepWindowsHidden();\n"
              "// HXBot (v1.7.2): and a window of a local server child that something shows is hidden again (hx-dock.ts).\n"
              "if (localServerChild) hxKeepChildWindowsHidden(app);\n")


def local_servers_one_at_a_time(r) -> None:
    """本机服务器一个接一个地启动，以低于正常的优先级运行（src/main/hx-local-servers.ts）。"""
    brand_rename.add_import(r, LOCAL_SERVERS, 'import { hxBackgroundPriority } from "../hx-local-servers";')
    r.replace(LOCAL_SERVERS,
              "    for (const entry of this.#registry.servers) this.#background(this.#start(entry, false));\n",
              "    // HXBot (v1.7.2): one after another, each after the one before is ready or failed. All at once,\n"
              "    // each opened its database, recovered its channels and started its agents together, and the\n"
              "    // other apps of the computer stalled on the processor and the disk (hx-local-servers.ts).\n"
              "    const entries = [...this.#registry.servers];\n"
              "    this.#background(\n"
              "      Effect.forEach(\n"
              "        entries,\n"
              "        (entry) =>\n"
              "          this.#start(entry, false).pipe(\n"
              "            Effect.asVoid,\n"
              "            Effect.catch(({ cause }) =>\n"
              "              Effect.sync(() => this.#options.log.warn(\"A server on this computer did not start.\", cause)),\n"
              "            ),\n"
              "          ),\n"
              "        { discard: true },\n"
              "      ),\n"
              "    );\n")
    r.replace(LOCAL_SERVERS,
              "    const running: RunningChild = { child, stopping: false };\n",
              "    // HXBot (v1.7.2): a server works in the background; its agents inherit the priority.\n"
              "    hxBackgroundPriority(child.pid);\n"
              "    const running: RunningChild = { child, stopping: false };\n")


def orphaned_local_servers(r) -> None:
    """启动时结束上一次留下的本机服务器子进程（src/main/hx-local-servers.ts）。"""
    brand_rename.add_import(r, SERVICES, 'import { hxStopOrphanedLocalServers } from "./hx-local-servers";')
    r.replace(SERVICES,
              "  if (localServers) {\n"
              "    await Effect.runPromise(localServers.initialize());\n",
              "  if (localServers) {\n"
              "    // HXBot (v1.7.2): the servers that an earlier run left running end; each was one more HXBot in the\n"
              "    // Dock and kept its memory. In the background: the servers that start now have this process as parent.\n"
              "    void hxStopOrphanedLocalServers({\n"
              "      executable: app.getPath(\"exe\"),\n"
              "      localServersRoot: join(app.getPath(\"userData\"), \"local-servers\"),\n"
              "      log: (message, detail) => logger.info(message, detail),\n"
              "    }).catch((error) => logger.warn(\"Unable to look for servers that an earlier run left.\", toLogValue(error)));\n"
              "    await Effect.runPromise(localServers.initialize());\n")


def links_keep_their_window(r) -> None:
    """Windows：用户选的浏览器打开链接时要显示窗口，写明 windowsHide: false（hx-child-windows.ts 的默认是隐藏）。"""
    r.replace(LINKS,
              "const child = spawn(program, [...options, page], { shell: false, detached: true, stdio: \"ignore\" });\n",
              "const child = spawn(program, [...options, page], {\n"
              "              shell: false,\n"
              "              detached: true,\n"
              "              stdio: \"ignore\",\n"
              "              // HXBot (v1.7.2): a browser shows its window; HXBot hides the others (hx-child-windows.ts).\n"
              "              windowsHide: false,\n"
              "            });\n")


def flow_share(r) -> None:
    """一台电脑上的所有 HXBot 进程共用一个容量 B（src/main/hx-flow-share.ts）。

    v1.7.1 的容量闸每个进程各算各的：桌面端和每个本机服务器都按同样的空闲内存放 B 个回合，合起来是 B 的
    好几倍，内存占满、电脑换页，别的应用打开、保存文件卡住。共用文件夹在 appData/HXBot/hx-flow（桌面端和
    本机服务器的 appData 相同）。
    """
    # 那一行写在 hx/flow.py 的 application_services 里（插在 v1.7.1 那一段中间，写在这里的话，重跑改造时
    # flow.py 认不出自己那一段已经改过，会再插一遍）。这里只加 import。
    brand_rename.add_import(r, SERVICES, 'import { HxFlowShare } from "./hx-flow-share";')


def command_servers_admin_only(r) -> None:
    """团队服务器上，命令型（stdio）MCP 只有所有者和管理员能加、改、试、打开（需求 MKT-04）。

    `mcp-member-access-v1` 让普通成员也能加 MCP；加一个 stdio 型的就等于在主机上运行他写的命令。
    检查在主机上做（src/main/team-api/hx-mcp-command-servers.ts）：保存和试连看请求里的配置，打开看主机上存的那一行。
    网址型（http）照旧，成员还能加、改、删自己加的。拒绝用已有的“需要管理员”错误（error.team.adminRequired）。
    """
    brand_rename.add_import(r, MCP_ROUTE, 'import { hxRequireAdminForCommandServer } from "./hx-mcp-command-servers";')
    r.replace(MCP_ROUTE,
              "    const input = parseSaveMcpServer(body);\n",
              "    const input = parseSaveMcpServer(body);\n"
              "    // HXBot (v1.7.2, MKT-04): a stdio server runs a command on this computer; owners and admins only.\n"
              "    hxRequireAdminForCommandServer(member, input.config.transport);\n")
    r.replace(MCP_ROUTE,
              "    const parsed = parseTestMcpServer(body);\n",
              "    const parsed = parseTestMcpServer(body);\n"
              "    hxRequireAdminForCommandServer(member, parsed.config.transport);\n")
    r.replace(MCP_ROUTE,
              "  requireOwnMcpServer(access, toggled.mcpServerId);\n"
              "  if (toggled.enabled) toolRuntimes?.startToolRuntimes();\n",
              "  requireOwnMcpServer(access, toggled.mcpServerId);\n"
              "  if (toggled.enabled)\n"
              "    hxRequireAdminForCommandServer(\n"
              "      member,\n"
              "      mcpServers.listMcpServers().find((server) => server.id === toggled.mcpServerId)?.transport,\n"
              "    );\n"
              "  if (toggled.enabled) toolRuntimes?.startToolRuntimes();\n")


def apply(r) -> None:
    dock_of_local_servers(r)
    flow_share(r)
    windows_of_local_servers(r)
    local_servers_one_at_a_time(r)
    orphaned_local_servers(r)
    links_keep_their_window(r)
    command_servers_admin_only(r)
