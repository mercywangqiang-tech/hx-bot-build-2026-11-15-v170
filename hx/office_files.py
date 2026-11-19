"""HXBot v1.7.4 应用技能（一）：办公与文件（需求规格说明书 V2.1 第 5.3 节：CU-07、ART-05、BAK-03）。

用户 2026-11-19：“继续V1.7.4……全面、无死角、穷举测试……所有功能都深度思考、反复斟酌、使用最前沿和最佳的算法和技术！严格执行！”

HX 自己的代码在 src/backend/hx-files/：
- xml.ts、zip.ts：只改动过的部分重写的 XML 和 zip 读写（没改的条目原字节写回），防炸弹、防路径穿越
- safe-write.ts、lock.ts、versions.ts：改文件前留版本（BAK-03），原子写入、读回核对、跨进程锁、崩溃后恢复
- formula.ts、xlsx.ts、docx.ts、pptx.ts、pdf.ts、pdf-text.ts：直接读写 Office 文件和 PDF，不打开应用
- diff-sequence.ts、diff.ts：改完给出差异（ART-05）

这里只改上游文件：PDF 取文字用 pdf.js（pdfjs-dist，Apache-2.0，手机端已经在用，版本由 catalog 统一），桌面端也把它
列为依赖，打包时只带它读文字要用的部分。
"""

from __future__ import annotations


def pdfjs_dependency(r) -> None:
    """桌面端依赖 pdfjs-dist：package.json 和 bun.lock 同时加一行（构建用 --frozen-lockfile，两边要一致）。"""
    r.replace("package.json",
              '    "p-queue": "catalog:",\n    "pino": "catalog:",\n    "protobufjs": "catalog:",\n    "qrcode": "catalog:",\n',
              '    "p-queue": "catalog:",\n    "pdfjs-dist": "catalog:",\n    "pino": "catalog:",\n'
              '    "protobufjs": "catalog:",\n    "qrcode": "catalog:",\n')
    r.replace("bun.lock",
              '        "p-queue": "catalog:",\n        "pino": "catalog:",\n        "protobufjs": "catalog:",\n'
              '        "qrcode": "catalog:",\n',
              '        "p-queue": "catalog:",\n        "pdfjs-dist": "catalog:",\n        "pino": "catalog:",\n'
              '        "protobufjs": "catalog:",\n        "qrcode": "catalog:",\n')


def pdfjs_packaging(r) -> None:
    """安装包里只带 pdf.js 的 legacy 版、字符映射表（中文 PDF 认字要用）和标准字体，不带网页版和原生画布。"""
    r.replace("electron-builder.yml",
              '  - "!node_modules/**/*.map"\nasarUnpack:\n',
              '  - "!node_modules/**/*.map"\n'
              "  # HXBot (v1.7.4): pdf.js reads the text of PDFs in the main process. Only its legacy build, the character maps\n"
              "  # and the standard fonts are used; it draws nothing, so its viewer, image decoders and native canvas stay out.\n"
              '  - "!node_modules/pdfjs-dist/build/**/*"\n'
              '  - "!node_modules/pdfjs-dist/web/**/*"\n'
              '  - "!node_modules/pdfjs-dist/image_decoders/**/*"\n'
              '  - "!node_modules/pdfjs-dist/types/**/*"\n'
              '  - "!node_modules/pdfjs-dist/legacy/web/**/*"\n'
              '  - "!node_modules/pdfjs-dist/legacy/image_decoders/**/*"\n'
              '  - "!node_modules/pdfjs-dist/legacy/build/*.min.mjs"\n'
              '  - "!node_modules/pdfjs-dist/legacy/build/pdf.sandbox*"\n'
              '  - "!node_modules/@napi-rs/canvas*/**/*"\n'
              "asarUnpack:\n")


def apply(r) -> None:
    pdfjs_dependency(r)
    pdfjs_packaging(r)
