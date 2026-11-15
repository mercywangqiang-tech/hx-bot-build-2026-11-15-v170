# 在 Windows 10/11（64 位）上构建 HXBot 桌面端安装包：dist\HXBot-<版本>-x64.exe
#
# 准备（只需一次，在 PowerShell 中）：
#   1. 安装 Git for Windows、Python 3（安装时勾选 Add to PATH）
#   2. 安装 Node.js 24：https://nodejs.org
#   3. 安装 Bun 1.4.2：iex "& {$(irm https://bun.com/install.ps1)} -Version 1.4.2"
#   4. 能访问 GitHub
#
# 用法：在源码根目录运行  powershell -ExecutionPolicy Bypass -File hx\scripts\build-windows.ps1
# 产物未做代码签名，首次运行时 SmartScreen 会提示，点“更多信息 → 仍要运行”。
$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path "$PSScriptRoot\..\..")

$nodeMajor = [int](node -p "process.versions.node.split('.')[0]")
if ($nodeMajor -lt 24) { throw "需要 Node.js 24 或更新。" }

Write-Host "1/4 应用 HXBot 改造……"
python hx\rebrand.py
if ($LASTEXITCODE -ne 0) { throw "改造失败" }

Write-Host "2/4 安装依赖……"
bun install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw "安装依赖失败" }

Write-Host "3/4 构建并打包（约 10～20 分钟）……"
bun run dist:win
if ($LASTEXITCODE -ne 0) { throw "打包失败" }

$version = node -p "require('./package.json').version"
$file = "dist\HXBot-$version-x64.exe"
Write-Host "4/4 产物：$file"
Get-FileHash $file -Algorithm SHA256 | Format-List
Write-Host "应用内更新用的文件：dist\latest.yml、$file.blockmap"
Write-Host "上传到服务器（在 Git Bash 里，或把 dist 里这三个文件拷到 Mac/Linux 上运行）："
Write-Host "  bash hx/scripts/upload-downloads.sh root@服务器IP dist/HXBot-$version-x64.exe"
Write-Host "  （同一目录里的 latest.yml 和 .blockmap 会一并上传，已安装的 Windows 版在应用里就能增量更新到 $version）"
