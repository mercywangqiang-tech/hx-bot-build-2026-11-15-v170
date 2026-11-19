---
title: What's new
kicker: HXBot Research Edition
updated: November 19, 2026
version: Desktop 0.67.13 · Mobile 1.5.0
description: The new features and highlights of each HXBot Research Edition version, newest first.
---

This page lists the new features and highlights of HXBot by version, newest first. Each version has all the features of the versions before it. The title of each part names the app that changed and its version number: the desktop app and the web app share one version number, and the mobile app has its own. After each highlight, the apps that have it are named. To use a new feature, update the app to that version: from desktop 0.67.13 on, HXBot downloads and installs a new version in the background also while you use it, then saves and restarts into it once the agents are idle, or after 10 minutes at most; there is nothing to click (0.67.10 to 0.67.12 install a version that they find as they open). The data in the screenshots is demo data.

## Desktop 0.67.13: updates while you work, and one HXBot in the Dock {#desktop-0-67-13}

November 19, 2026 · Desktop and web 0.67.13 · Mobile 1.5.0 (no change this time)

This version is an urgent fix of 0.67.12. It adds no other new features.

> **Highlights**
> 1. HXBot updates while you use it: it downloads and installs a new version in the background, then saves and restarts into it when the agents are idle, or after 10 minutes at most. Agents that the restart cut off continue by themselves. {on:Desktop}
> 2. One HXBot in the Dock on a Mac: a server on this computer no longer shows a second icon when it starts or restarts. {on:Desktop}
> 3. A failed update check tells why: no update files on the server, a refused sign-in, no network or a server error each have their own message. {on:Desktop}
> 4. When the server sorts the downloads or runs its check script, it compares the in-app update files and warns when they were not uploaded. {on:Server}

### Updates while you work {#desktop-0-67-13-update}

- **Before:** only a new version that HXBot found in the first 10 minutes after it opened installed by itself. A version found later waited for the next opening, so a computer that kept HXBot open could stay on an old version for a long time.
- **Now:**
  - HXBot looks for a new version every 4 minutes, also while the agents work. It downloads and installs it in the background, at a limited speed, so that you and the agents keep your network.
  - When it is installed, HXBot restarts into it once the agents are idle. While it waits, new routine runs do not start, so that the work can come to an end; the routines that come due meanwhile run after the restart.
  - It waits at most 10 minutes. When the agents still work then, HXBot saves first (the chats, the queued messages and the time the routines were held) and restarts. Each agent that the restart cut off gets a message from HXBot after the restart: check how far the work got, do not repeat a step that already changed something, and finish the rest.
  - HXBot never restarts this way while it starts (for example, while it upgrades its database) or while it downloads or installs.
  - Before the restart, the notice "HXBot is installing an update" shows as before. Choose Cancel update to skip this restart; the update then installs the next time HXBot opens.
  - When you were not using HXBot, the new version opens in the background and does not come to the front.

### A second HXBot in the Dock on a Mac {#desktop-0-67-13-dock}

- **Cause:** a server on this computer runs HXBot's own program. macOS gave it a Dock icon at the moment it started, and 0.67.11 hid the icon only after the start, so a second HXBot showed each time a server started or restarted.
- **Now:** the app information of HXBot says that it does not go into the Dock when it starts, so a server never has an icon. The main HXBot app makes itself a regular app before it finishes launching, so its Dock icon and menu bar are as before.

### A failed update check tells why {#desktop-0-67-13-check}

- **Before:** on a Mac, every failed check showed "Could not check for updates. Try again." You could not tell missing update files on the server from a refused sign-in or a dropped network. On November 19, the cause was in-app update files that were not uploaded to the server.
- **Now:**
  - No update files on the server (404): "No published update was found for this platform. HXBot tries again on its own in a few minutes."
  - A refused sign-in (401, 403): HXBot checks the sign-in once and asks again. When it is refused again: "The update server did not accept your sign-in. Sign in to HXBot again, then check for updates."
  - No network: HXBot tries once more through the network settings of the system (the proxy included). When that fails too, it asks you to check the network.
  - A server error (5xx): the update service did not answer, and HXBot tries again in a few minutes.
  - The update log keeps the status and the cause.

### Server: no more missing update files {#desktop-0-67-13-server}

- When it sorts the downloads (publish-downloads.py), the server warns in capitals when the Mac or Windows version on the download page is newer than the in-app update files, or when the update files were not uploaded, and says how to upload them.
- The check script (check.sh) has two more checks: the in-app update files of the Mac and Windows versions match the download page.
- The client folder of each delivery has a file that uploads the in-app updates of that version (a .command file). Double-click it on a Mac to upload the installers and the in-app update files together and switch them on.

## Desktop 0.67.12: several agents share the computer, and step aside while you use it {#desktop-0-67-12}

November 18, 2026 · Desktop and web 0.67.12 · Mobile 1.5.0 (no change this time)

> **Highlights**
> 1. {NEW} Several agents use the computer at the same time without getting in each other's way: one agent per app, up to three apps at once in the background, and one agent at a time types or clicks in the window in front. {on:Desktop}
> 2. Agents step aside while you use the computer: when you type or move the mouse, or the window to work on is not in front, the agent stops that step, and goes on by itself when you have stopped for 5 seconds. {on:Desktop}
> 3. Every step is checked: fields that take text directly get it directly and are read back; a wait for a button lasts at most 10 seconds; a step that cannot be read back is marked to check, and only checked steps count as done. {on:Desktop}
> 4. Fixed: with several teams in the queue, sometimes no work started. Many people on one office network can register and sign in again without hitting a limit. {on:Desktop}

### Several agents on this computer {#desktop-0-67-12-lanes}

![Several agents on the computer: one lane per app; while you type, the step parks and goes on after you stop](/hx-portal/whats-new/computer-lanes.en.jpg)

- **One lane per app:** one agent writes in TextEdit while another calculates in Calculator, both at the same time. One app has one agent at a time, and up to three apps work at once in the background.
- **One at a time in front:** typing, clicking, scrolling and dragging in the window in front are done by one agent at a time. Opening and closing apps, changing settings, installing apps and running scripts take turns with them, so no window changes under the typing.
- **It says when it must wait:** a call waits at most 30 seconds. When its turn does not come, the agent learns which agent uses the app and about how long it takes, does the work that does not need that app first, and tries again later.
- **Your messages first:** the messages that you send to an agent get their turn before handoffs between team members and before routines.
- **Stop at any time:** press ⌃⌥Esc (Windows: Ctrl+Alt+Esc). Every agent's work on this computer stops before its next step, and the calls that wait stop at once.

### Agents step aside while you use the computer {#desktop-0-67-12-yield}

- **It looks first:** before a step that types or clicks in the window in front, HXBot looks whether you used the keyboard or the mouse in the last 5 seconds (60 seconds for background work such as routines), whether the window to work on is in front, and whether the screen is locked.
- **It parks the step and says so:** when one of these is not so, it waits a moment, then parks the step. A line in the chat says that it waits for you, and no key of the agent goes into what you type. The agent does the parts of the work that need no keyboard and no mouse first.
- **It goes on by itself:** when you have stopped for 5 seconds and that window is in front, HXBot sends the agent a message to continue. The agent looks at the window again and does the remaining steps; it still asks you before a send, a payment or a deletion.
- **“now” and “drop”:** reply “now” in the chat and the agent brings the window to the front and does the step at once; reply “drop” and it does not do it. After 30 minutes, HXBot reminds you once.
- **You can turn it off:** “Continue parked steps by themselves” in Settings › Computer Use is on by default. When it is off, a parked step goes on only after you reply “now”.
- **HXBot's own input is not yours:** the keys and clicks that HXBot's driver sends for an agent do not count as your input, also while two agents work at the same time.

### Every step is checked {#desktop-0-67-12-checked}

- **Text goes in directly where it can:** an empty one-line field gets its text directly and is read back; on the Mac, text goes into fields in the background, with no change of the window in front. Where a field does not take text that way (such as the body of Windows Notepad), the agent types it.
- **Wait for it:** a step can wait for a button or a text to show, for at most 10 seconds. When it does not show, the agent says so and does not count the step as done.
- **Only checked steps are done:** each step records the window, the way it was done and whether it was checked. A step that cannot be read back is marked to check; only checked steps count as done on the progress card, and after a step to check the agent stops and asks you.
- **No clicks on a changed window:** when a step names a control by its number from an earlier look and the window has changed since, the step is not done, and the agent looks again.
- **Clipboard:** when typing used the clipboard, your copy goes back at the end; a new copy that you make meanwhile stays.

### Fixed {#desktop-0-67-12-fixes}

- **No work started in the queue (from 0.67.10):** when several teams had used about the same time, the order of the queue went in a circle (A before B, B before C and C before A). Each piece of work saw another one before it, so no work started though places were free. Now HXBot makes one whole order first and then looks at the place of each piece of work.
- **Short freezes at start and in the queue after long use:** on a computer with many agents and chats, the end of a turn made the queue read each lane again and again, and the app could stop for seconds (14.9 s at most in the test); at start, the recovery of the last session stopped it for more than 1 s in one go. Now one check reads each lane once and the checks of a moment run as one; the recovery runs in small parts and lets other work go first between them. In the stress test, the longest stop of the app is below 1 s.
- **Your place was taken:** a routine that waited long and moved to the top could keep the place that HXBot holds for you, so your message could not start. Now that place is for your messages only.
- **Driver errors counted as done:** a step that the computer-control driver answered with an error no longer counts as a step that may have worked.
- **One way in:** on the Mac and Windows, the providers no longer get their own computer control as well; every action goes through HXBot's lanes, checks and records. After the update, the provider sessions of agents with Computer Use start again once; the chat stays.
- **Team folders:** to see whether a team makes progress, HXBot no longer reads folders such as node_modules and .git, so big folders no longer slow it down.
- **Signing in from an office:** the people of an office use one address on the internet. Before, the 21st person to sign in within 15 minutes had to wait. Now the limit per address is higher; the limit of each account stays the same.

## Desktop 0.67.11: one HXBot in the Dock, and other apps open and save files without freezes {#desktop-0-67-11}

November 18, 2026 · Desktop and web 0.67.11 · Mobile 1.5.0 (no change this time)

This version only fixes problems. It adds no new features.

> **Highlights**
> 1. One HXBot in the Dock and the taskbar: the servers on this computer no longer each add an icon, and the commands that HXBot runs in the background no longer open black console windows. {on:Desktop}
> 2. Other apps no longer freeze when they open or save files: the servers on this computer start one after another and run at a lower priority, and all HXBot processes share one limit of work at the same time. {on:Desktop}
> 3. When HXBot cannot write the record of a permission (for example, when the disk is full), a step that needs your permission does not go ahead, and the agent tells you why. {on:Desktop}
> 4. On a team server, only owners and admins can add an MCP server that runs a command on this computer. {on:Desktop}

### More HXBot icons in the Dock and the taskbar {#desktop-0-67-11-dock}

- **Cause:** each server on this computer is a separate HXBot process.
  - Mac: the server hid itself from the Dock very early in its start. At that time macOS was still starting it, and sometimes the hide did not hold, so the icon stayed. Each server added an icon, and each new or restarted server added one more.
  - Windows: each command that HXBot ran in the background (for example, to read the processes or to start a tool) opened a console window, and each one added an icon to the taskbar.
  - After a run that did not quit correctly, the servers that it left kept running, and their icons stayed.
- **Now:**
  - Mac: a server first becomes an app that is not in the Dock, then hides. For 30 seconds after it starts, it looks again from time to time and hides again when it is visible.
  - Windows: background commands open no window. Only the windows that you want to see show: links that open in the browser you chose, and the apps that an agent opens for you. The windows of a server are not on the taskbar, and a server window that shows is hidden at once.
  - When HXBot opens, it finds the server processes of an earlier run that have no main app. It asks them to quit, and ends them when they still run after 5 seconds.

### Other apps freeze when they open or save files {#desktop-0-67-11-dialogs}

- **Causes that we found:**
  - When HXBot opened, all servers on this computer started at the same time, and the computer was very busy for some seconds.
  - In 0.67.10, each HXBot process set its own limit of work at the same time. The desktop app and each server started work for the same free memory, so together they could run several times the limit. The memory filled, the computer started to swap, and the open and save windows of other apps were very slow.
  - On Windows, the console windows of background commands took the focus, so the open or save window that you used looked frozen.
- **Now:**
  - The servers start one after another, at a "below normal" priority, so the app that you use gets the processor first.
  - The desktop app and each server write how much work they run into one small shared folder. Each process can start the limit minus the work that the other processes run, and at least 1.
  - Background commands open no windows and do not take the focus.

### Other fixes {#desktop-0-67-11-fixes}

- **Record of permissions:** "Allow once" and "Always allow" take effect only after they are written to the record of permissions. When the record cannot be written (the disk is full, or the folder cannot be written), the step does not run, and your permission is not used up. The agent tells you why and asks you to free disk space or fix the folder, then try again. The stop button works as before.
- **MCP servers on a team server:** an MCP server that runs a command on this computer (stdio) is the same as a command that runs on this computer. Now only owners and admins can add, change, test and turn on such a server. Members can still add a server with a web address, and change or remove the ones they added. The server does this check.

## Desktop 0.67.10: many agents at once without freezes, teams with no limits {#desktop-0-67-10}

November 18, 2026 · Desktop and web 0.67.10 · Mobile 1.5.0 (no change this time)

> **Highlights**
> 1. Many agents, no freezes: HXBot sets how many turns this computer runs at the same time from its free memory, battery and temperature. The other work waits in a queue; it does not all start at once. {on:Desktop}
> 2. Teams have no limit on members, time or handoffs: each handoff is accepted and waits in the queue, and none is sent back because "too many are busy". When a team makes no progress, goes in a loop or nobody answers the spend reminders, it pauses and asks you. {on:Desktop}
> 3. No slowdown after long use: the channel list counts only the new messages, and the queue and the scheduler look only at work that is not done. {on:Desktop}
> 4. Updates are no longer forced: when HXBot finds a new version as it opens, it downloads and installs it and restarts into it once the assistants are idle; there is nothing to click. Later major versions work the same way. {on:Desktop}

### This computer sets how many turns run at the same time {#desktop-0-67-10-capacity}

![Many agents at once: the team line in the settings says this computer decides how many work at once, and the progress card keeps the handoffs and the time](/hx-portal/whats-new/team-open.en.jpg)

- **How it is set:** HXBot keeps 2 GB or 15% of the memory (the larger) free, and divides the rest of the free memory by the memory that one turn uses.
  - On battery: three quarters of that.
  - When the computer is hot: half; when it is very hot: 1.
  - When the processor is slowed down: three quarters; when the main process is slow: 1 less.
  - The result is at least 2 and at most 16.
- **Up and down:** HXBot looks every 5 seconds. When memory gets low, fewer turns start at once. More start only after 3 looks in a row with enough memory. When the number goes down, the turns that run finish, and new ones wait.
- **The order of the queue:**
  - Your own messages come first. When 3 or more turns can run, one place is always kept for you.
  - Next is the work on the critical path, then the work of team members. Scheduled tasks and background work come last.
  - Work that waits longer moves up: one step for each 2 minutes.
  - When several teams run, they take turns by the time each used recently, so that one large team does not fill the computer. When only one team runs, it can use all of it.
- **Idle processes close:** when a team member's process was idle for 4 minutes or more, HXBot closes the one that was idle longest, one at a time, and the memory goes back to your apps.
- **Where to see it:** in the assistant settings, below "Proposal card", one line says "Team: members as the work needs; this computer decides how many work at once (now n)".

### Teams with no limits pause and ask you when they are stuck {#desktop-0-67-10-team}

- **No handoff is sent back:** every handoff from the lead is accepted, goes on the board and waits, and starts when this computer has room. The limit "at most 20 members · 240 minutes · 80 handoffs" is gone. A handoff form must still have all six parts; a form with a part missing is still sent back.
- **Only your limits count:** say in the chat "at most 3 members this time", "spend at most ¥50" or "do not ask me this time, run to the end". It is for this one team only. A "limit" that the lead writes in a handoff form changes nothing.
- **A stuck team pauses:** in each of these cases the team pauses: no new work starts, the work that runs finishes, and then it asks you to continue, finish up or stop.
  - 30 minutes of real work with no progress (no work done, no file changed, no plan step moved); the time in the queue or waiting for your answer does not count.
  - The same work goes from member to member 3 times with no file change and no fewer open items, or one member gets almost the same work 3 times.
  - Much more work is opened than finished, or the work is split too deep: first the lead only gets a reminder to bring the work together; if it happens again, the team pauses.
  - 24 hours of real work.
  - 10 spend reminders in a row with no answer. A team that you told "do not ask me this time" does not pause for this one.
- **Two failures stop it:** when the same work fails two times for certain, the team stops, as before.
- **Spend reminders:** pay as you go: about each ¥20. A plan: when 25%, 50% and 80% of this period are used. An unknown price: each 5 million tokens that are not cached. At most one in 15 minutes.
- **The lead knows:** the team notes, the reply to each handoff and the proposal card say how many turns this computer runs at the same time, how many run and how many wait. A handoff reply says "Queued, place n: … about m min".

### No slowdown after long use {#desktop-0-67-10-faster}

- **Unread counts in the channel list:** before, each refresh of the sidebar counted all the messages of each channel that you never opened (such as team rooms) again, and a reply refreshes it while it is written, so HXBot got slower the longer you used it. Now only the new messages are counted. With 89 MB of messages, one refresh went from about 210 ms to 5 to 12 ms, with the same unread counts.
- **Queue checks:** before, each check read all the handoffs ever made. Now one read serves until a handoff changes.
- **Scheduling:** before, each pass read all the tasks of all channels, also of team rooms that were done long ago. Now it reads only the channels with work that is not done.
- **Tested:** 3 teams with 24 members in all, 3 chats and 6 scheduled tasks at full load for 30 minutes: 0 handoffs sent back (before: 58%); main process event loop p99 about 31 ms for the whole run, the longest delay 0.5 s; the window never stopped answering for more than 2 seconds; after the stop button, no new member started within 2 seconds.

### Updates install as HXBot opens, never forced {#desktop-0-67-10-update}

- **Updates as it opens:** a new version that HXBot finds after it opens is downloaded and installed in the background, and HXBot restarts into it once the assistants are idle; you do not click Update now. Before the restart, a note says HXBot is installing an update; click Cancel update if you want to wait. Work in progress finishes first.
- **A version found later:** if HXBot finds a new version while you are working, it does not interrupt you; it installs the next time HXBot opens.
- **Major versions too:** no major version blocks the window with a required update any more, and the server no longer turns clients away by version number.
- **This version is 0.67.10:** it was to be 0.68.0. Versions 0.67.2 to 0.67.9, already installed, follow their own old rule and block the window when the second part of the version number changes, so this version stays at 0.67.x. Coming from 0.67.9, you see the usual "new version" window once; Update now and Later both work. Once 0.67.10 is installed, every later version installs as HXBot opens.

## Desktop 0.67.9: HXBot leaves your other apps alone {#desktop-0-67-9}

November 15, 2026 · Desktop and web 0.67.9 · Mobile 1.5.0 (no change this time)

> **Highlights**
> 1. Other apps stay fast: the rim no longer reads every window all the time, and background work and the agent's commands leave the processor to your apps first. {on:Desktop}
> 2. No stolen focus: when you move to another app, the agent types nothing there and pulls no window back; a grant page or a remote control question comes as a notification first. {on:Desktop}
> 3. Shortcuts and copy and paste work, and the network has room: the modifier keys are let go, your clipboard keeps your copy, and updates and the remote desktop have a speed limit. {on:Desktop}

### Other apps stay fast {#desktop-0-67-9-fast}

![While the agent works on the computer: clicks in the background, types nothing when you move away, lets go of the modifier keys](/hx-portal/whats-new/computer-quiet.en.jpg)

- **The rim:** while the agent works in an app, HXBot draws a rim around its window. It asked the system for every window 30 times a second, so every app had to answer all the time: fans ran and apps were slow. Now it reads at most twice a second, and only when the agent acted in the last 15 seconds; with no action it reads nothing and draws nothing.
- **The mouse on Windows:** the Dynamic Island and the agent dock see the mouse only while it is near them, so they no longer hold on to the mouse of the whole computer; the rim takes no mouse event at all.
- **The processor:** the catalog read runs at the lowest priority; the agent's processes and the commands they run (builds, tests) run below normal, so your own apps come first. A hidden web tab that nobody used for two minutes is throttled again.
- **Big apps:** one read of a window takes at most 1500 controls and 3 seconds, so a big app such as a browser, Xcode or a long document does not stop while it answers.

### No stolen focus {#desktop-0-67-9-focus}

- **Keys go to the target app only:** before the agent types or presses a shortcut, it looks which app is in front. When you moved to another app, no key goes out and no window is pulled back: the agent stops and asks you in the chat to go back to that app.
- **A notification first:** when the agent wants a grant page of System Settings, or someone asks to control this computer, the page or the question opens at once while you work in HXBot. While you work in another app, a notification comes, and it opens on a click. One page opens at most once in a short time.
- **After an update:** when an automatic update has installed and HXBot opens again while you work in another app, HXBot opens behind it (Mac).

### Shortcuts and copy and paste work, and the network has room {#desktop-0-67-9-keys}

- **Modifier keys:** at the end of each piece of work (also when you stop it), the agent lets go of Ctrl, Shift, Alt and Win (Mac: ⌘ ⇧ ⌥ ⌃), so no shortcut of another app goes wrong because a key stayed down.
- **The stop keys:** Ctrl+Alt+Esc (Mac: ⌃⌥Esc) are held only while the agent works on the computer; at other times other apps can use them.
- **The clipboard:** after the agent types, your clipboard still has the text you copied.
- **The network:** update downloads take at most 2 MB/s and the remote desktop picture at most 10 Mbit/s, so your calls and pages keep room.
- **Your apps stay open:** on Windows, the apps with a window that an agent opened (such as Notepad) stay open when the agent stops; only its background processes stop.
- **Auto model:** a chat that goes on keeps its model and reasoning effort, so the provider keeps its context and cache; a new chat or task, a model you name, or a redo chooses again.

## Desktop 0.67.8: app commands, and the next way when one does not work {#desktop-0-67-8}

November 14, 2026 · Desktop and web 0.67.8 · Mobile 1.5.0 (no change this time)

> **Highlights**
> 1. The agent uses app commands: front, hide, quit, window places, menu commands and default apps, all done by HXBot itself; a quit is a normal quit first, and a force quit asks you. {on:Desktop}
> 2. The agent runs AppleScript, JXA, Shortcuts and PowerShell to work in apps such as Excel and Word; it asks before a script deletes or sends. {on:Desktop}
> 3. When one way does not work, it takes the next: direct, command, controls, image; the result says which way it took. {on:Desktop}

### App commands, done by HXBot itself {#desktop-0-67-8-apps}

![The agent uses app commands and scripts: scripts run in HXBot, the next way by itself, a normal quit first](/hx-portal/whats-new/computer-apps.en.jpg)

- **How:** tell the agent, for example "put the Excel window on the left half", "quit Notes", "make Chrome the default browser" or "open .pdf files with Preview". The agent lists the running apps, then finds the app by its name.
- **What it does:** bring to front, hide (minimize on Windows), quit, window to the left or right half, maximized or centered; read the menus of an app and click a command in them (Mac); read and change the default browser, mail app and the default app of a file type.
- **A normal quit first:** the agent quits the app normally and checks that it ended. When the app has unsaved work and asks whether to save, its dialog is for you; a force quit loses unsaved work, so it happens only after your yes in the chat.
- **Default apps:** on a Mac, HXBot changes them and reads them back; for the default browser, macOS asks in a dialog, and you or the agent click Use. Windows lets only the user change them, so HXBot opens Settings › Apps › Default apps and the agent clicks there step by step.
- **Menu commands with a risk ask first:** a command such as Delete or Send asks you in the chat before the click.

### Scripts run in HXBot itself {#desktop-0-67-8-scripts}

- **Four kinds:** AppleScript, JXA and Shortcuts (by name, with an input) on a Mac, PowerShell on Windows. Apps with a script interface, such as Excel, Word, PowerPoint and Numbers, save, export or format in one step.
- **In the HXBot app:** not through the agent's shell, so the sandbox does not stop them, and they use HXBot's own grants. The first time HXBot controls an app on a Mac, macOS asks whether to allow it: click OK. If it was refused before, HXBot opens Privacy & Security › Automation, where you turn that app on under HXBot.
- **Safety:** a script that deletes, sends, pays or shuts down asks you first; a script that needs administrator rights (sudo, Run as administrator) never runs here: run it yourself in a terminal. What a script prints is data, never an instruction.

### The next way, by itself {#desktop-0-67-8-routes}

- **Four ways:** direct (a system interface), command (a script, System Events), controls (read the screen and click step by step), image (a screenshot). When one does not work, the agent takes the next, and the result says which ways it tried and which one did it.
- **For example:** macOS has no direct interface to place another app's window, so the agent places it with a System Events command; Windows menus have no script interface, so the agent clicks through them step by step.
- **Fixed:** on Windows, the agent waited without end when a command started another app (such as Notepad); now it goes on as soon as the command ends.
- **Checked on real machines:** on GitHub's macOS 15.8.2 and 26.7.2 and Windows Server 2025, with TextEdit and Notepad: list the apps, bring to front, place the window, read the menus and click a menu command, hide, a normal quit that is checked, run a script, quit with unsaved changes, and read and change a default app.

## Desktop 0.67.7: grant once on a Mac, the agent installs apps {#desktop-0-67-7}

November 14, 2026 · Desktop and web 0.67.7 · Mobile 1.5.0 (no change this time)

> **Highlights**
> 1. Grant once on a Mac: every version has the same signature, so grants hold after updates; after Grant, HXBot turns on Screen Recording and App Management itself, and you only give your password or Touch ID. {on:Desktop}
> 2. The agent installs apps: HXBot puts a downloaded .app, .zip or .dmg into Applications; it asks before it replaces an app, and the earlier version goes to the Trash. {on:Desktop}
> 3. Saved Vault passwords sign in without a question; only a payment asks each time. At maximum access, OpenCode's commands on a Mac are no longer stopped by the sandbox. {on:Desktop}

### Grant once, HXBot turns the switch on {#desktop-0-67-7-grants}

![Settings › Computer Use: Screen Recording is for screenshots; Accessibility takes one click by you](/hx-portal/whats-new/computer-grants.en.jpg)

- **Grants hold after updates:** macOS keeps grants by the app's signature. Before, each version had another signature, so Screen Recording and Accessibility stopped working after an update while System Settings still showed them on. From this version on, every version has the same signature: grant once, and it holds after each update.
- **Accessibility is enough to work in apps:** clicking and typing step by step need only Accessibility; Screen Recording is for screenshots. When macOS asks again for Screen Recording, the steps go on.
- **HXBot turns the switch on:** in Settings › Computer Use, click Grant. System Settings opens at that page and HXBot presses the switch of its own row; when macOS asks, give your password or Touch ID. macOS lets only you turn on Accessibility; after that, HXBot goes on to Screen Recording. The same happens when the agent needs a grant while it works in an app.
- **Stale entries go:** when a grant does not hold for this version (the switch shows on but counts for nothing), HXBot first removes its own earlier entry, then asks you. Only HXBot's own entries change, never another app's.
- **In the right place:** when HXBot runs outside Applications (from Downloads or a disk image, for example), it asks once to move there, and opens again from Applications.
- **The first time with this version:** macOS says it cannot check the developer the first time it opens; click Open Anyway in System Settings › Privacy & Security. Then grant once as above; later updates need nothing.
- **No black screen after closing in full screen:** before, closing the window in full screen (the green button) hid HXBot but left its full screen Space, black over the whole display until you switched to another app. Now the window leaves full screen first, then hides; the Dock icon brings it back.
- **Checked on real machines:** on GitHub's macOS 15.8.2 and 26.7.2: two versions signed with the same certificate have the same signature identity; through the Computer Use driver, HXBot pressed only the switch of its own row and macOS asked for the password; without Screen Recording all steps passed; removing the stale entries needs no administrator password and removes only that app's entries.

![The steps window: HXBot turns the Screen Recording switch on; you only give your password or Touch ID](/hx-portal/whats-new/grant-steps.en.jpg)

### The agent installs apps {#desktop-0-67-7-install}

![The agent puts a downloaded Claude into Applications: signature and notarization first, a question before it replaces](/hx-portal/whats-new/computer-install.en.jpg)

- **How to use it:** tell the agent "install the Claude I downloaded". A .app, .zip or .dmg works: HXBot unpacks it, puts it into Applications and reads the version back; a .pkg goes to the macOS installer, where you give the password yourself.
- **It asks before it replaces:** when the app is already in Applications, the agent asks you in the chat first; only after your yes does it replace it, and the earlier version goes to the Trash. When the earlier version is open, quit it first.
- **Safe:** before it installs, it reads the signature (the developer) and whether Apple notarized it, and says so in the chat. The quarantine flag stays: macOS checks the app as usual the first time it opens.
- **App Management:** when macOS does not let HXBot change another developer's app, HXBot opens Privacy & Security › App Management and turns on its own switch; you only give your password or Touch ID.
- **Checked on real machines:** on GitHub's macOS 15.8.2 and 26.7.2, with a test app: a new install, the question first, the replacement (the earlier version in the Trash, no temporary files left) and an install from a disk image.

### Vault sign-in without a question, only payments ask {#desktop-0-67-7-vault}

- **Sign-in without a question:** at maximum access, signing in to a website with a password saved in the Vault (one-time codes too) and deleting a Vault item no longer show a card.
- **Payments still ask:** paying with a card on a web page asks each time, and only Allow once. Changing files outside the workspace, running a command as administrator and touching the key folders still ask first.
- **OpenCode is not stopped by the sandbox:** OpenCode, which Auto model often picks, no longer runs in the process sandbox on a Mac (HXBot still decides each action by its rules), so ps, brew, screenshots and installs no longer fail "after a switch to OpenCode". The other sandboxed providers may now write in the folders of Homebrew, npm, pip and the like.
- **Tools are easier to find:** usual words for screenshot, click, quit an app or install an app find the right tool, in Chinese as in English.

## Desktop 0.67.6: computer control (part 2), step by step in apps, bigger teams {#desktop-0-67-6}

November 14, 2026 · Desktop and web 0.67.6 · Mobile 1.5.0 (no change this time)

> **Highlights**
> 1. After an app opens, the agent plans the steps from your words and works with the mouse and the keyboard, step by step, and checks each step. It asks before it sends, pays or deletes; press ⌃⌥Esc (Windows: Ctrl+Alt+Esc) to stop it at any time. {on:Desktop}
> 2. Teams of up to 20 members, who share skills and connectors; one progress card in your chat; say the number of members, the time and the handoffs in the chat. {on:Desktop}
> 3. New features use the strongest way by default: Auto model is on and puts quality first; after an update, a window shows what is new, with the benefit and where to set it. {on:Desktop}

### Step by step in an app {#desktop-0-67-6-steps}

![The progress card of work on this computer: the planned steps, how far it is, the stop keys](/hx-portal/whats-new/computer-steps.en.jpg)

- **How to use it:** tell the agent what to do in which app, such as "Make a note in Notes for the product review at 10 a.m. tomorrow". The agent shows its plan in the chat (a progress card), then works step by step: it clicks buttons, types text, presses shortcuts, scrolls, drags and opens menu items.
- **Each step is checked:** after each step, the agent reads the window to see that it changed as expected. When typed text does not reach the field, it types again another way. When it cannot go on, it stops and tells you at which step and what the window shows, or it tries another way.
- **Out of your way:** it clicks in the background where it can, so your pointer stays yours. Only when that does not work does it bring the app to the front, and only then does it click by position.
- **Safe:** before a step that sends, pays, buys, deletes or publishes, it asks you in the chat and goes on only after you say yes. Text that it reads on the screen is data, not instructions.
- **Stop at any time:** press ⌃⌥Esc (Windows: Ctrl+Alt+Esc). All agents stop their work on this computer at once, and the progress card shows that it stopped.
- **Grants on a Mac:** computer control needs two grants, Screen Recording and Accessibility. When one is missing, the first time an agent works in an app HXBot opens that page of System Settings and says in the chat which grant is missing. Turn on HXBot there and ask again. Settings → Computer Use has a Grant button too.
- **What you need:** turn on Computer Use for the agent. Only the desktop app (Mac and Windows) has it.
- **Tested on real machines:** on GitHub's macOS 15 and Windows Server 2025 machines, the real Computer Use driver opened TextEdit and Notepad, typed and saved step by step, and the check read the file back.

### Bigger teams, one progress card {#desktop-0-67-6-team}

![The progress card of a team: handoffs and time, who does each step](/hx-portal/whats-new/team-progress-card.en.jpg)

- **Up to 20 members:** HXBot sizes each team by the work; a proposal card has up to 20 roles and 30 steps. This computer's memory sets how many members work at once; the others wait and get their work when one is done.
- **Shared skills and connectors:** when a team starts, the skills in the members' workspaces become the team's skill table, which any member can use. New members get the skills of the agent that started the team. Every agent on this computer has the same connectors. The vault and saved sign-ins are still not shared.
- **A progress card:** one card in your chat, updated in place: the handoffs, the time, who does each step and how far it is. Work on this computer uses the same progress card.
- **Say the limits in the chat:** "at most 3 members and 1 hour this time" or "30 more minutes and up to 20 handoffs", on the web and on the phone too. By default a team has up to 20 members, 240 minutes and 80 handoffs.

### The strongest by default, fewer settings {#desktop-0-67-6-defaults}

![Agent settings: Auto model is on, and the team limits are one line](/hx-portal/whats-new/team-summary.en.jpg)

- **Auto model is on and puts quality first:** each piece of work gets the best and strongest model for it; with free models only, it takes the strongest free one. To save cost, set the preference to Free first under Auto model in the agent's settings. Agents whose settings you changed keep them.
- **Fewer settings:** the team limits in the agent's settings are one summary line; turn on Change the limits to see them.
- **What's new:** the first time the app opens after an update, a window shows the new features of the version, each with its benefit and where to set it. It shows once; Settings → About opens it again.
- **Privacy Policy 1.5:** it describes the step-by-step work, that its records stay on your computer, the stop keys, and how to turn off Auto model now that it is on by default.

## Desktop 0.67.5: collaboration (part 2), teams of agents {#desktop-0-67-5}

November 14, 2026 · Desktop and web 0.67.5 · Mobile 1.5.0 (no change this time)

> **Highlights**
> 1. Say what you need and get a team: press Start on a proposal card, and HXBot picks agents by skill, makes members for missing roles and opens a team room. {on:Desktop}
> 2. Members hand work over with a fixed handoff form and share one task board: who does what, and what is stuck, at a glance. {on:Desktop}
> 3. Progress and the result come back to your chat; to add words, stop the team or swap a member, just say so there. {on:Desktop}

### Say it, and get a team {#desktop-0-67-5-team}

![The proposal card names who takes each role: an agent you have, or a new member](/hx-portal/whats-new/team-card.en.jpg)

- **To start:** tell the agent what you need. When the work suits several agents, it shows a proposal card first; on a card with two or more roles, each role names who takes it. Press Start and the team is made.
- **Who is picked:** the agents you have, by name, title and description; the agent you talk to does not join and stays with you. A role that no agent fits gets a new member (on the model the card gives that role, with no more access than the agent that starts the team).
- **The team room:** a channel is made for the team. The lead (the planning role) gets the whole brief: the goal, the roles, the steps, the apps, where it waits for you, the shared folder and the limits.
- **New members:** hidden when the team ends (show them again from the hidden agents). To keep them, tell the agent, or choose Keep in the settings.

### Handoff forms and the task board {#desktop-0-67-5-board}

- **Handoff form:** each assignment and transfer states six things: the goal, what is done, the files, what is open, the next step and what not to touch, with “none” where there is nothing. A form with a missing line goes back to be completed, so the member that takes the work does not have to ask again.
- **Task board:** who has each step, how far it is and what is stuck, plus the facts and files everyone needs. The files named on a handoff form go on the board by themselves.
- **Shared abilities:** the board shows each member's model and whether it can use this computer; members keep their own skills and connectors, and work goes to the member that has the ability it needs. When several members open apps or change settings at the same time, they take turns. The vault and saved sign-ins are not shared.

### Follow it in your chat {#desktop-0-67-5-follow}

![The team in your chat: the team, the handoffs, the results, done](/hx-portal/whats-new/team-progress.en.jpg)

- **Progress:** who gave what to whom, how many steps are done and what is stuck show as small lines in your chat; open the team room for the details.
- **Add words, stop, swap:** just tell the agent (“make the posters blue”, “stop the team”, “give the Writer's part to Sam”). It passes your words on, stops the team, or swaps the member; the open work of the old member goes to the new one.
- **The result:** the lead checks the work and sends the final result back; the agent tells you the result and the files in your chat.

### The limits of a team {#desktop-0-67-5-limits}

![The team limits in the agent's settings](/hx-portal/whats-new/team-settings.en.jpg)

- Under the proposal card in the agent's settings: how many members (5 by default), how long (120 minutes by default), how many handoffs (20 by default), and whether new members are hidden or kept when the team ends.
- At the time or handoff limit, or when the same work fails twice, the team stops; the agent tells you what is done and what is left, and asks what to do next.

## Desktop 0.67.4: any OpenCode service, collaboration (part 1) {#desktop-0-67-4}

November 14, 2026 · Desktop and web 0.67.4 · Mobile 1.5.0 (no change this time)

> **Highlights**
> 1. Connect any of OpenCode's 200+ services under Add provider, free models included: sign in in the browser or paste a key. {on:Desktop}
> 2. Agents choose the model by the work: writing, code, images and planning each get a fitting model, free first by default. {on:Desktop}
> 3. Before bigger work, a proposal card: how many agents, who does what and which models. Nothing starts until you press Start. {on:Desktop}

### Connect any OpenCode service {#desktop-0-67-4-opencode}

![The All OpenCode services window: free models, connected services, browser sign-in or a key](/hx-portal/whats-new/opencode-services.en.jpg)

- **Where:** click “+” in the model panel (or Settings › Providers), click Add and choose All OpenCode services. Connect services at the bottom of the provider settings opens it too.
- **Which:** the 200+ services that OpenCode can reach, such as OpenAI, Anthropic, DeepSeek, Kimi, Zhipu, Qwen, GitHub Copilot and OpenRouter, with a search field. OpenCode Free at the top needs no sign-in and is ready to use.
- **Three ways in:** sign in in the browser (as with ChatGPT; the window shows Connected by itself), paste an API key, or use the credentials already on your computer (AWS, Google Cloud, Claude Code and more).
- **After that:** the service's models show in each agent's model list (under OpenCode, by service) and in Auto model. Disconnect at any time.
- **Safety:** OpenCode keeps the credentials on your computer (as opencode auth login does); HXBot keeps no copy. This is in the desktop app only.

### Auto model: the model fits the work {#desktop-0-67-4-auto-model}

![Auto model in the agent's settings](/hx-portal/whats-new/auto-model.en.jpg)

![The chat names the model of each piece of work](/hx-portal/whats-new/auto-model-lines.en.jpg)

- **Turn it on:** in the agent's settings, turn on Auto model (below Model and Backup models).
- **How it chooses:** for each new piece of work, the agent finds what it is (chat, writing, a small code change, code across files, data, an image, long material, planning, operating the computer) and how hard it is, and picks one of the models you are signed in to. A small line in the chat names the model, such as “Auto model · writing: GLM-5.3-Flash Free takes it.”
- **Preference:** Free first by default (a free model when it is good enough); or Balanced, or Quality first.
- **You decide:** name a model in your message (“use Claude Opus 5.5 for this”) and that message uses it. Under Models and recent choices, clear the models you do not want and see the recent choices.
- **When work fails:** the chat asks once; reply “redo” and a stronger model does it again.
- **When unsure:** a low-cost small model decides (or choose Rules only); when neither is sure, the agent keeps its model.

### A proposal card before the work {#desktop-0-67-4-proposal}

![The proposal card: roles and models, steps, and Start](/hx-portal/whats-new/proposal-card.en.jpg)

- When work is worth sharing among agents, or needs a checker apart from the doer, the agent first shows a proposal card: how many agents, what each role does, which models (and whether free), the steps, the apps to use, and which steps need your OK.
- Start begins the work; Change it says what to change; Use one agent lets one agent do it all; Cancel stops it.
- In the agent's settings under Proposal card, choose When the work calls for it (default), Before each long task, or Never.

## Desktop 0.67.3: computer control (part 1), Settings regrouped {#desktop-0-67-3}

November 13, 2026 · Desktop and web 0.67.3 · Mobile 1.5.0 (no change this time)

> **Highlights**
> 1. {HOT} Agents open apps and system settings pages by name, with no screenshots and no clicks; Chinese names can be typed in pinyin. {on:Desktop}
> 2. Agents change 32 common settings directly, such as dark mode, the Dock, the taskbar and when the screen turns off. {on:Desktop}
> 3. Settings is regrouped, so you find what you need at a glance. {on:Desktop}

### Agents operate this computer directly {#desktop-0-67-3-computer}

![One sentence in the chat opens an app or changes a setting](/hx-portal/whats-new/computer-open.en.jpg)

![Settings › Computer Use: the catalog of this computer and the self-test](/hx-portal/whats-new/computer-catalog.en.jpg)

- **Open by name:** apps, system settings pages, folders, documents and web addresses, such as “open NetEase Cloud Music” or “open Bluetooth settings”. Chinese names also work in full pinyin or by initials (“wangyiyun” and “wyyyy” both find NetEase Cloud Music).
- **Change settings directly:** 16 on macOS (dark mode, volume, mute, Dock auto-hide and size, menu bar auto-hide and more) and 16 on Windows (dark mode, transparency, taskbar alignment, seconds on the clock, notifications, Game Mode, screen and sleep timeouts and more). After a change the agent reads the setting again to make sure it is right; if not, it puts the old value back.
- **A catalog of this computer:** HXBot keeps a catalog of the installed apps and the system settings pages (40 on macOS, 57 on Windows), so agents do not wait when they look something up. After you install a new app, click Rebuild the catalog under Settings › Computer Use.
- **Self-test:** under Settings › Computer Use, one click checks whether each setting can be read and changed. The self-test changes no setting. On Windows, agents change the screen brightness directly only after one self-test passes.
- **Safety:** pages about privacy, passwords and login items only open; the agent leaves those settings to you. Files that run directly (such as .exe and .sh) do not open. What agents opened and changed is in Settings › Access & activity.
- **To use it:** turn on Computer Use for the agent. The mobile app and the web app do not have this feature.
- **Well tested:** five rounds of automatic tests on five real machines (macOS 15, macOS 26, Windows Server 2025, Windows Server 2022, Windows 11 ARM). Each setting was really changed and changed back; the last round had 0 failures.

### Settings is easier to find your way in {#desktop-0-67-3-settings}

![The three groups on the left of Settings, About and Get help](/hx-portal/whats-new/settings-groups.en.jpg)

- **Three groups:** on the left, Settings (General, Profile, Billing), Features (Agents, Notifications, Voice, Computer Use, Mobile Connect and more) and Data & security (Access & activity).
- **About:** Updates is now About. Next to the version and Check for updates, it opens the website, the Terms of Service and the Privacy Policy.
- **Get help:** new. It opens the Guide, and lets you write to us with feedback.
- The search at the top of Settings also finds each item in About and Get help.
