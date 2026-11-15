# HXBot computer check

This branch holds an automated check of the computer-control part of HXBot. On every push,
GitHub Actions runs `hx-computer-check.mjs` on real macOS and Windows machines: it reads the list of
installed apps, opens every page of the system settings, changes each supported setting and puts it
back, and writes a report.

- `hx-computer-check.mjs`: the check, as one file that needs only Node.
- `.github/workflows/hx-computer-check.yml`: the workflow.
- Results: the Artifacts of each run, and the branch `__BRANCH__-results`.

The check changes system settings. Do not run it on your own computer.

这个分支是 HXBot 电脑操控部分的自动检查，只在 GitHub 的用完即毁的机器上运行，不要在自己的电脑上运行。

## Real-model check

`hx-real-check.mjs` and `.github/workflows/hx-real-check.yml` run a second check: on Ubuntu, a real
model works through a team of agents with HXBot's own team code; on macOS and Windows, the pinned
Computer Use driver types and saves text in TextEdit or Notepad, first with fixed steps and then with
a real model that plans the steps itself. The models are the free models of OpenCode and GitHub
Models. Results go to the Artifacts and to `real/<run>/` on the results branch.

真实模型检查：Ubuntu 上用真实模型走一遍多智能体协作；Mac 和 Windows 上用真的电脑操控驱动一步步输入并保存。
