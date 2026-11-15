---
title: What's new
kicker: HXBot Research Edition
updated: November 15, 2026
version: Desktop 0.67.9 · Mobile 1.5.0
description: The new features and highlights of each HXBot Research Edition version, newest first.
---

This page lists the new features and highlights of HXBot by version, newest first. Each version has all the features of the versions before it. The title of each part names the app that changed and its version number: the desktop app and the web app share one version number, and the mobile app has its own. After each highlight, the apps that have it are named. To use a new feature, update the app to that version: when a new desktop version is out, the app shows a window with what is new; click Update now. The data in the screenshots is demo data.

## Desktop 0.67.9: HXBot leaves your other apps alone {#desktop-0-67-9}

November 15, 2026 · Desktop and web 0.67.9 · Mobile 1.5.0 (no change this time)

> **Highlights**
> 1. {NEW} Other apps stay fast: the rim no longer reads every window all the time, and background work and the agent's commands leave the processor to your apps first. {on:Desktop}
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
