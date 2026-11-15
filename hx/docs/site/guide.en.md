---
title: Guide
kicker: HXBot Research Edition
updated: November 15, 2026
version: 1.3
description: The HXBot Research Edition guide: creating an account and signing in, installing, first-run setup, agents and conversations, publishing a server and inviting members, web and mobile, settings, data and security, and FAQ.
---

HXBot is a workspace that runs a team of AI agents on your own computer. Each agent has its own role, workspace, conversation and task queue. Agents can message each other, pass files and use a built-in browser, and the web app and mobile apps let you follow progress and keep talking from anywhere. This guide goes from creating an account to inviting colleagues; read it in order to get started.

> **Get started in five minutes**
> 1. At https://bot.hxallai.com/en/ choose Create Account, register with your email and set a password (section 2).
> 2. Sign in, then download and install the Mac or Windows desktop app (section 3).
> 3. Open the desktop app, sign in with the same email and password, and choose Set up this computer (section 4).
> 4. Choose Use free models or Use my AI subscription, then create your first agent (sections 4 and 5).
> 5. To use it on your phone or the web, or to invite colleagues, publish your server and create an invite link (sections 6 and 7).

## 1. What HXBot is made of {#overview}

| Part | What it does | Where to get it |
| --- | --- | --- |
| Desktop app (Mac, Windows) | Runs the agents. The computer with the desktop app is your “server”: agents, conversations and files are stored there | Download center, after you sign in to the portal |
| Web app | Uses the servers you have access to from a browser | https://bot.hxallai.com/app |
| Android and iOS apps | Follow progress, talk to agents and get reminders on your phone | Android: APK in the download center; iOS: the install option in the download center (TestFlight or direct install) |
| HX AI servers | Handle accounts, sign-in, the server directory, invitations, encrypted connection setup and relay | Run by HX AI; they do not store your conversations or files |

A few terms used throughout:

- **Server (host):** the computer that runs the desktop app. Once you publish it, invited people can connect from the web, their phones or their own desktop app.
- **Agent:** an AI agent with a defined role, such as a trip planner or an inbox helper.
- **Channel:** a conversation where several agents (and members) work together.
- **Provider:** where an agent's AI model comes from, such as ChatGPT, Claude, Grok, free models or an OpenAI-compatible endpoint.

## 2. Create an account and sign in {#sign-in}

Everyone uses HXBot with an account of their own: you register with your email address and choose a password, and every app signs in with **email + password**.

**Creating an account:**

1. Open https://bot.hxallai.com/en/ and choose Create Account below the sign-in form.
2. Enter your email address and mobile number, then click Next. When the page says the codes were sent, look in your inbox and on your phone (six digits, valid for 10 minutes).
3. Enter the codes, a username, a password (8 to 32 characters, with letters, numbers and symbols), your job title and your company name, then click Create Account. You are signed in when it finishes.

If the sign-in form shows buttons such as WeChat or Alipay, you can also sign in with those accounts. The first time, the page asks you to create a new account or to link an existing one with its email and password. After that, the button signs you in.

**Signing in on the portal:**

1. Open https://bot.hxallai.com/en/ .
2. Enter your email and password, then click Sign in.
3. You can now download the apps and open the web app. Use Sign out at the top right to sign out.

**Forgot your password?** Choose Forgot password? under the sign-in form, enter the email of your account and set a new password with the code we email you. Setting it signs you out on your other devices; sign in there with the new password. If the email does not arrive, write to bot@hxallai.com from the email of your account.

**Good to know:**

- You create an account and reset a password on the portal. The desktop, mobile and web apps only ask for your email and password.
- Use the same account in every app; you will see the same servers everywhere.
- One email address and one mobile number can register only one account, and a username cannot be one that someone else uses. If you are told that the mobile number already has an account, sign in with that account (choose Forgot password? if you need to).
- Your password is for you alone. Do not share it, and do not reuse a password from another site. We store only a salted hash of it, so nobody can read your password.
- If you see “Too many attempts”, wait a few minutes (at most about 15) and try again. Codes can be requested at most once a minute, and one mobile number receives at most 10 texted codes a day; after that, try again the next day. If you see “Too many incorrect passwords” or “This step timed out”, choose Start again and enter it once more.
- Codes by SMS go to mainland China mobile numbers only. If a code does not arrive, or you use a number from another country or region, email bot@hxallai.com.
- If you signed in with the shared sign-in password before: choose Create Account with the same email address and set your own password. Your servers and memberships stay as they are.

## 3. Download and install {#install}

After signing in to the portal, choose your device under Downloads.

| Device | Requirements | How to install |
| --- | --- | --- |
| Mac | Apple silicon (M1 or later), macOS 13 or later | Open the dmg and drag HXBot into Applications |
| Windows | Windows 10 / 11, 64-bit | Run the exe installer |
| Android | Android 7.0 or later | Open the portal in the phone's browser, sign in and download the APK |
| iPhone / iPad | iOS 16.4 or later | Open the portal on the iPhone or iPad, sign in and use the button on the iPhone / iPad card: Install with TestFlight, or Install. See the notes below |

On iPhone and iPad, follow whichever button the download center shows on the iPhone / iPad card:

- **Install with TestFlight:** install Apple's TestFlight app from the App Store first, then tap the button and choose Install in TestFlight. Any iPhone or iPad can install this way, and later versions update inside TestFlight.
- **Install:** this is a direct install and works on registered devices only. Email the device identifier (UDID) to bot@hxallai.com first. Once the device is registered, open the portal in Safari, sign in and tap Install, then wait for the icon to appear on the Home Screen. On iOS 16 or later, turn on Developer Mode under Settings → Privacy & Security and restart the device before the first launch. In-app browsers cannot install the app, so use Safari.
- **Coming soon:** the iOS app has not been released yet.

Mac and Windows research builds are not code-signed, so your system may block them the first time:

- **Mac says it cannot verify the developer, or that the app is damaged:** in Finder → Applications, right-click HXBot and choose Open. If it still does not open, run this command in Terminal and try again.

```bash
xattr -dr com.apple.quarantine "/Applications/HXBot.app"
```

- **Windows shows “Windows protected your PC”:** choose More info → Run anyway.
- **Android blocks the installation:** allow your browser to install unknown apps when asked. If you installed a version with a different signature before, uninstall it first.

**Updates:** once you are signed in, the apps look for new versions themselves. An ordinary new version can wait; a major version must be installed. Your agents and conversations are kept (backups are still a good idea).

- **Desktop:** once a new version is downloaded in the background, a window shows what is new: choose Update now to restart and install it, or Later to keep working (HXBot asks again the next time it starts). **A major version (the second number changes, such as 0.68.0) must be installed:** “Update HXBot” covers the window and cannot be closed; choose Update now, and if it is still downloading, HXBot restarts to install it when the download is done. If no one does within 10 minutes (on a computer no one is watching, say), HXBot restarts to install it when it is idle. An administrator can also make a version required; the window then cannot be closed either. Windows downloads only what changed; the Mac downloads the new version and swaps it in when it restarts. On a Mac, drag HXBot into Applications before opening it (an app opened from the dmg or the Downloads folder cannot update itself). If the update fails, choose Try again, or Open download page to download and install it by hand.
- **Phone:** “Update HXBot” covers the screen and the new version opens by itself: Android downloads the new installer, then open it and follow the prompts; on an iPhone tap Install in the window that opens. The system leaves the last tap, Install, to you.
- **Older versions:** desktop 0.67.0, phone 1.4.x and earlier cannot update themselves, show no Update now and can no longer sign in. Sign in at https://bot.hxallai.com in a browser, download the new version from the download center and install it over the old one.
- **When you upgrade to this version, every device signs in again once.**
- You can see your current version in the desktop app under Settings → About.

## 4. First run of the desktop app {#first-run}

1. **Sign in** with your email and password (no account yet? Create one at https://bot.hxallai.com/en/ first). The bottom of the screen says “By continuing, you accept the Terms of Service and acknowledge the Privacy Policy”; click the links to read them.
2. **Help make HXBot better.** The research edition collects no usage statistics or error reports; whatever you choose, the app sends none.
3. **Where will HXBot run?**
   - Choose **Set up this computer**: agents, conversations and files stay on this computer. Most researchers choose this.
   - Choose **Connect to a host** to use a server someone else runs. Paste the `https://bot.hxallai.com/join` invite link you received, click Review invitation, check it and click Connect to host.
4. **Choose your AI (“Build your AI team.”).**
   - **Use free models:** no AI subscription needed. HXBot downloads the third-party open-source tool OpenCode automatically and uses the free models it offers. Their availability, regional limits and terms are set by their providers.
   - **Use my AI subscription:** use an account you already have, such as ChatGPT, Claude or Grok. Sign in once under Connect your plan and your agents can use your plan.
5. **HXBot might control your computer.** This step explains the system permissions that Computer Use (the screen, keyboard and mouse) needs. Agents use maximum access by default: they do most things directly, and ask you first before they change a file that is already there outside their workspace, delete outside it, run a command as administrator, sign in with a saved password or pay (see section 5). Run only tasks you trust and keep backups.
6. **Create your first agent.** See section 5.

**Using other models:** right-click your server in the server bar → Server settings → Providers to connect more providers. Under Add a provider or an agent, Add a custom provider accepts any OpenAI-compatible endpoint (such as the compatible endpoints of model platforms in China), and Found on this computer lists model services running locally (such as Ollama or LM Studio). When you use a third-party model service, follow its terms and regional restrictions.

## 5. Agents and conversations {#agents}

**Creating an agent:** click New agent in the sidebar and fill in:

- **Name**;
- **What should this agent help with?** Describe its role, the output you expect and its limits, for example “Collect industry news every day, group it by topic and include links to the sources”;
- **Agent model:** choose the provider and model;
- or pick a template under Suggestions and adjust it.

Then click Create agent.

**Conversations:** type a task in the agent's conversation; you can attach files and use voice input. The agent works in its own workspace, and its progress and results appear in the conversation. To start over on a new topic, use New thread in the agent's menu.

**Several agents together:** use New channel to put several agents in one conversation and let them share the work; use New folder to organize the sidebar.

**Auto model:** under Auto model in the agent's settings (below Model and Backup models). From desktop 0.67.6 it is on by default (agents whose settings you changed keep them). For each new piece of work the agent finds what it is (chat, writing, code, data, an image, long material, planning, operating the computer) and how hard it is, and picks one of the models you are signed in to. A small line in the chat names it, such as “Auto model · writing: GLM-5.3-Flash Free takes it.”

- **Preference:** Quality first by default: each piece of work gets the best and strongest model for it; with free models only, the strongest free one. To save cost, choose Free first (a free model when it is good enough, a subscription model for hard work), or Balanced.
- **Name a model:** write “use Claude Opus 5.5 for this”, and that message uses it.
- **When work fails:** after a turn that fails or gives up, the chat asks once; reply “redo” to do it again with a stronger model.
- **Models:** under Models and recent choices you can clear models you do not want and see the latest choices.
- **How it decides:** by default rules, and a small model when they are unsure: that message (not its attachments) goes to an inexpensive model that names the kind of work. Choose Rules only to send nothing. When neither is sure, the agent keeps its model.
- Choosing a model by hand turns Auto model off. Work in a channel keeps its model in this version.
- From desktop 0.67.9, a chat that goes on keeps its model and reasoning effort (another model makes the provider start over, without the context and the cache). A new chat or task, a model you name, a redo, or a picture or long material that the current model cannot take chooses again. A greeting or a thank-you no longer asks a small model to judge.

**Connect any OpenCode service:** click “+” in the model panel (or Settings › Providers), click Add and choose All OpenCode services (the line at the bottom of the provider settings opens it too). The window lists the 200+ services that OpenCode can reach, with a search field; OpenCode Free at the top needs no sign-in and is ready to use.

- **Browser sign-in:** for services such as ChatGPT and GitHub Copilot, click “Sign in: …” and sign in on the page that opens in your browser. The window shows Connected by itself; when the page shows a code, paste it in.
- **API key:** click Paste an API key, paste the key the service gave you and click Connect.
- **Credentials on this computer:** for AWS, Google Cloud or Claude Code, use the sign-in that is already on your computer.
- After a connection, OpenCode restarts when it is idle. The service's models then show in each agent's model list (under OpenCode, by service) and in Auto model. Open a connected service to disconnect it.
- OpenCode keeps the credentials on your computer, as `opencode auth login` does; HXBot keeps no copy. This is in the desktop app only.

**Proposal card:** when work is worth sharing among agents, or needs a checker apart from the doer, the agent first shows a proposal card: how many agents, what each role does, which model each uses (and whether it is free), the steps, the apps, and the steps that wait for you. Nothing starts until you press Start; Change it tells it what to change; Use one agent makes it do all of it. Under Proposal card in the agent's settings you can choose Before each long task or Never.

**Teams:** on a proposal card with two or more roles, each role names who takes it: one of your agents, picked by skill, or a new member when none fits. Press Start and the team is made: a team room (a channel) opens, and the lead gives out the steps.

- **Handoff form:** each assignment and transfer states the goal, what is done, the files, what is open, the next step and what not to touch, so the member that takes the work does not have to ask again.
- **Task board:** who has each step, how far it is and what is stuck, with the facts and files everyone needs.
- **Follow it in your chat:** a progress card in your chat with the agent, updated in place: the handoffs, the time, who does each step and how far it is. To add words, stop the team or swap a member, just tell the agent. When it is done, the agent tells you the result and the files here.
- **Shared skills and connectors:** when a team starts, the skills in the members' workspaces become the team's skill table, which any member can use. New members get the skills of the agent that started the team. Every agent on this computer has the same connectors. The vault and saved sign-ins are not shared.
- **Limits:** a team has up to 20 members (sized by the work), 240 minutes and 80 handoffs; this computer's memory sets how many members work at once, and the others wait. To change the limits of one team, tell the agent, such as "at most 3 members and 1 hour this time" or "30 more minutes", on the web and on the phone too. Under Proposal card in the agent's settings, one line shows the team limits; turn on Change the limits to change the defaults and whether new members are hidden or kept when the team ends. At a limit, or when the same work fails twice, the team stops and the agent asks you what to do next.

**Navigation on the left:** Agents is the main conversation view; Schedule, Tasks and Workflows set up scheduled tasks and automations; Usage shows how much you use each provider; Library lets you browse and manage files; Settings is described in section 8.

**Permissions: maximum access.** Every agent uses maximum access by default (agents from earlier versions were moved to it when you upgraded, also those that had Full access). You can see and change it under Permissions in the agent's settings:

- **Without asking:** reading files anywhere; creating, changing and deleting in its workspace, the shared folder, the folders you added and the temporary folders; creating new files anywhere; running commands; opening and using websites; screen capture; web search; Computer Use (the screen, keyboard and mouse).
- **Asks you first:** changing a file that is already there outside the workspace; deleting outside the workspace; reading or writing where keys and logins are kept (such as `~/.ssh`, keychains, browser profile folders, and HXBot's own data and Vault); running a command as administrator (sudo and the like); a command whose deletes cannot be told; paying with a card on a web page.
- **Does not ask (since v1.6.8):** signing in to a website with a password saved in the Vault (one-time codes too), and deleting a Vault item.
- **The confirmation card:** the agent shows a card in the chat that says why, what it will do, and on which files, commands or websites. **Allow once** is for this time only (each item once; what is left ends with the task). **Always allow** means no agent asks again for the same (a file is remembered by its folder). **Refuse**, or Skip, means it is not done. You can also write a condition in the card (for example "only page 3"); the agent gets your words. **A payment has no Always allow: every payment needs your OK.**
- **Asked in the chat:** before sending an email or a message, publishing anything or accepting terms for you, and before typing a password or paying with Computer Use, the agent asks you in the chat (HXBot cannot see these, so this rests on the agent).
- **Rules and activity:** Settings → Access & activity lists the Always allow rules, which you can remove, and what agents did that is worth knowing (reading and changing files outside their folders, deleting, commands, screenshots, web search, sign-ins, payments and your confirmations). The record stays on this computer, keeps the last 2,000 entries and can be cleared.
- **Who can allow:** only the server owner can allow; team members can only refuse.
- **Full access:** the agent asks about nothing, not even before deleting files, running a command as administrator or paying. Choose it by hand under Permissions and confirm twice; switch back to maximum access when the task is done.
- **Computer Use:** turn it on under Settings → Computer Use. On macOS, work step by step in apps needs only Accessibility; screenshots need Screen Recording. Click Grant: System Settings opens at that page. macOS lets only you turn on the Accessibility switch, so click it once; after that, HXBot turns on the Screen Recording switch itself, and when macOS asks, you give your password or Touch ID. When a grant shows on but does not count, HXBot first removes its own earlier entry, then asks you to grant. From v1.6.8, every version has the same signature: grant once, and later updates keep the grants (after an update from an earlier version, grant once more). When a grant is missing, the first time an agent works in an app HXBot opens that page of System Settings (from v1.7.0: while you work in another app, a notification comes first and the page opens on a click) and says in the chat which grant is missing; grant it and ask again. When HXBot runs outside the Applications folder, it asks once whether to move itself there.
- **Installing apps (Mac):** tell the agent "install the Firefox I downloaded". HXBot puts the app from a .app, .zip or .dmg into the Applications folder, and first writes in the chat who signed it and whether Apple notarized it. When the app is already installed, the agent asks you first and replaces it only after a yes; the earlier version goes to the Trash (named "app name earlier version", so you can put it back). An app that is open must be quit first. A .pkg goes to the system installer, where you give the password yourself. When macOS does not let HXBot replace an app, HXBot opens the App Management page and turns on its own switch; you give your password or Touch ID.
- **App commands and scripts (from v1.6.9):** the agent brings an app to the front, hides it, quits it, puts its window on the left or right half or maximizes it, reads the menus of a Mac app and clicks a command in them, and reads and changes the default browser, mail app and the default app of a file type, such as "quit Notes" or "make Chrome the default browser". A quit is a normal quit first, and the agent checks that the app ended; when the app asks whether to save, you choose in its window, and a force quit needs your yes in the chat. The agent also runs AppleScript, JXA, Shortcuts (Mac) and PowerShell (Windows) to work in apps such as Excel and Word; it asks before a script deletes or sends, and it never runs one that needs administrator rights. All of this happens in the HXBot app, not through the agent's shell. The first time HXBot controls an app on a Mac, macOS asks whether to allow it: click OK; if it was refused, turn it on in System Settings › Privacy & Security › Automation. Windows lets only you change default apps, so HXBot opens Default apps and the agent clicks there step by step. When one way does not work, the agent takes the next (direct, command, controls, image) and says which way it took.
- **Step by step in an app:** tell the agent what to do in which app, such as "make a note in Notes for the meeting at 10 a.m. tomorrow". The agent shows its steps in the chat (a progress card), then works with the mouse and the keyboard: it clicks buttons, types text, presses shortcuts, scrolls, drags and opens menu items. After each step it checks that the window changed as expected; when it cannot go on, it stops and says where, or tries another way. It clicks in the background where it can, so your pointer stays yours. Before it sends, pays, buys, deletes or publishes, it asks you in the chat. Press ⌃⌥Esc (Windows: Ctrl+Alt+Esc) to stop its work on this computer at once (from v1.7.0 these keys are held only while the agent works on the computer; at other times other apps can use them).
- **Leaving your other apps alone (from v1.7.0):** before the agent types or presses a shortcut, it looks which app is in front. When you moved to another app, it sends no key and pulls no window back: it stops and asks you to go back first. At the end of its work it lets go of all modifier keys, and your clipboard keeps your copy. The rim reads windows at most twice a second, the agent's processes and their commands run below normal priority, and reading a big app's window has a limit, so other apps are not slowed down or stopped. Update downloads take at most 2 MB/s and the remote desktop at most 10 Mbit/s; on Windows, the apps with a window that an agent opened stay open when the agent stops.
- **Opening and changing things directly:** an agent with Computer Use on opens an app, a page of the system settings, a folder, a document or a web address by its name, and changes common settings such as dark mode, the Dock or the taskbar, without a screenshot or a click. For example: "open the Bluetooth settings", "turn on dark mode"; a Chinese name can also be said in pinyin. Pages such as Privacy & Security and Passwords are only opened; you make the changes there. The first time an agent changes the appearance or the Dock, macOS asks once whether HXBot may control System Events. On Windows, the screen brightness is changed directly only after the self-test passed for it on this computer (Settings → Computer Use → Apps and settings on this computer; it changes no setting); until then agents open their settings page. In the same place you can rebuild the catalog, for an app you just installed.
- **Limits:** HXBot can only tell from a command itself which files it changes or deletes; files that a script or program the agent wrote changes or deletes on its own cannot be told, and a place written as a variable counts as one that cannot be told. With Cursor, Kimi, DeepSeek and similar providers on a Mac, the system keeps the agent's own commands to its workspace and the other folders, so they cannot create files outside them (except the folders where Homebrew, npm, pip and similar tools install software); HXBot installs apps, takes screenshots, controls other apps and runs AppleScript for them. OpenCode asks HXBot before each step, so from v1.6.8 this limit does not apply to it. Back up important material, and keep it apart from the agent's workspace.

**Tips for working with agents:**

- Give each agent one role; the more specific the role, the steadier the results.
- Check important output and irreversible actions (deleting files, sending email, paying) before they happen.
- Web pages, emails and files can hide content that tries to trick an agent into harmful actions (prompt injection). Do not let agents handle content of unknown origin. Refuse a confirmation card when the reason is unclear, and keep Always allow for folders and commands you are sure of.
- Do not let agents handle confidential information, other people's sensitive personal information or production systems.

**Agent avatars:** each agent's avatar is one of 30 small animals (giraffe, rhino, pig, pony, elephant, fish and more), drawn in the style of the HXBot giraffe. In the agent settings, choose the pencil on the avatar to pick another animal under Shape or Eyes, change its colour, or upload your own picture.

## 6. Server: publish your server and invite members {#server}

A “server” is the computer that runs the HXBot desktop app. Once you publish it, you can use it from the web app and your phone, and invite colleagues to use its agents. The computer must be on, online and running the desktop app for anyone to connect.

### 6.1 Publish your server {#publish}

1. Open the desktop app on a Mac or Windows PC and sign in with your email and password.
2. In the server bar on the left, right-click your server (or click “…”), choose Server settings, and open Members.
3. Turn on Publish this server. When it reads “Reachable online. Only invited people can sign in.”, the server is published.

You can see the published server in the web app and on your phone right away; other people need an invitation to join.

### 6.2 Invite members {#invite}

1. Under Server settings → Members, click Invite people.
2. Choose the Invitation method:
   - **Invite link:** a one-time link that expires after 24 hours and works once;
   - **Perma link:** never expires and works many times. Anyone who has it can join, so send it only to people you trust.
3. Choose the Invitation role: Member or Admin.
4. Click Create link, then Copy link and send it through your own channels. For someone on a phone, you can also click Show invitation QR code and let them scan it.

Prefer Invite link or Perma link. Email invitations may not be available in the research edition.

Every invite link is different and looks like `https://bot.hxallai.com/join?api=…&server=…&fingerprint=…&invite=…`. It carries the server's ID, its identity fingerprint and a one-time secret, so there is no general link that could be given out in advance. Revoke invitations you no longer need under Pending invitations.

### 6.3 Roles and permissions {#roles}

| Role | What they can do |
| --- | --- |
| Owner | The person who runs the server. Can publish or unpublish the server, invite and remove members, change roles and access, and use all agents |
| Admin | Helps manage members and invitations, and can use all agents |
| Member | Uses the agents allowed by the role settings |

- Under Server settings → Roles, choose which agents members can use. A member gets the highest access of Everyone and of their roles; owners and admins can use all agents.
- In the Members list you can Make admin, Make member or Remove member. A removed member loses access to the server and its shared conversations.
- The Audit log records changes to members, roles and agent access, newest first; the host keeps the newest 500 changes.
- Members of the same server can see each other's email address, display name and avatar. Members' conversations and the files they send are stored on the owner's computer, and the owner and admins may be able to see them.

### 6.4 Join someone else's server {#join}

1. Sign in at https://bot.hxallai.com/en/ first (no account yet? Choose Create Account first).
2. Open the invitation in one of these ways:
   - Web app: open https://bot.hxallai.com/app and click Join with invitation;
   - Desktop, Android or iOS app: click Add a server in the server bar;
   - Or open the invite link in a browser: the page guides you to open it in HXBot. On a phone you can Scan the invitation code.
3. Paste the link and click Review invite. Make sure the page shows a verified invitation, check the server name, access and expiry, then click Connect.

An invitation sent to a specific email address works only for that address, so sign in with it. To leave a server, right-click it in the server bar and choose Leave server.

### 6.5 Web app {#web}

The web app at https://bot.hxallai.com/app lists the servers you have published or joined. Use a recent version of Chrome, Edge, Safari or Firefox; mobile browsers work too. The web app reaches the server's computer directly over an encrypted connection and does not keep conversation content in your browser. When the server's computer is off or the desktop app is not running, the web app cannot use that server.

## 7. Using HXBot on your phone {#mobile}

**Installing:** on Android, open https://bot.hxallai.com/en/ in the phone's browser, sign in and download the APK. On iPhone and iPad, open the same address in Safari, sign in and use the button on the iPhone / iPad card (TestFlight or direct install, see section 3).

**Signing in:** use either method.

- Sign in on the phone with your email and password; or
- Sign in with a code from the desktop app: open Settings → Mobile Connect, click Add phone and choose Yes, sign in. On the phone, open HXBot, tap Scan QR code and point the camera at the computer screen. If the app is not installed yet, choose No, get the app and scan the code to open the download page.

**Using it:** the phone lists your servers. You can follow agents' progress, keep talking, use voice input, and share text, images and files to HXBot from other apps. The mobile app keeps an encrypted cache of what it has shown on the phone and deletes it when you sign out.

**Managing phones:** see the signed-in phones under Settings → Mobile Connect → Your phones in the desktop app, and manage sign-ins under Settings → Signed-in devices in the mobile app.

## 8. Settings and your account {#settings}

Settings in the desktop app lists its sections in three groups, Settings, Features and Data & security, with About and Get help at the bottom, below a line. The search box at the top of the window finds every setting. The main sections:

| Group | Section | What it is for |
| --- | --- | --- |
| Settings | General | How HXBot behaves on this computer |
| Settings | Profile | Your display name and avatar; review and sign out devices under Account sessions |
| Features | Agents | What agents may do when you have not set it for an agent |
| Features | Notifications | How HXBot alerts you |
| Features | Voice | Dictation in the message box, with an on-device model or a third-party voice service you choose |
| Features | Computer Use | Letting agents see the screen and use the keyboard and mouse; the catalog of the apps and settings on this computer, and its self-test |
| Features | Mobile Connect | Adding and managing signed-in phones |
| Data & security | Access & activity | The Always allow rules, which you can remove, and what agents did that is worth knowing |
| At the bottom | About | Your current version and how the update is going (new versions download by themselves; choose Update now to install one); the website, the Terms of Service and the Privacy Policy |
| At the bottom | Get help | This guide; an email to bot@hxallai.com with your feedback |

**Signing out:** choose Sign out in the account menu.

**Deleting your account:** at the bottom of Settings → Profile, choose Delete account… and confirm with your password (an account without a password, such as one that only signs in with another platform, confirms with its email address instead). The account is deleted at once and cannot be restored: your registration details, linked accounts of other platforms, the sign-in on every device, the servers you joined and the servers you published are deleted, and the email address and mobile number can register again later. Your agents, conversations and files on your computer are not affected. On the phone it is under Settings → Profile → Delete account; in the web app also under Settings → Profile. You can also email bot@hxallai.com from your account's email address; after verifying it, we handle the request within 15 working days.

## 9. Help menu and feedback {#help}

The Help (?) menu in the apps:

| Item | Opens |
| --- | --- |
| Guide | This page |
| Server | Section 6 of this page: publishing your server and inviting members |
| Download the latest version | The download center on the portal |
| Send feedback | An email to bot@hxallai.com |

Settings → Get help opens this guide and a feedback email too.

When you report a problem, please include your device and system version, your HXBot version (Settings → About), the steps you took and screenshots. For problems with a provider, you can also click Copy diagnostics in the provider settings and include the result. Diagnostics can contain file paths and similar details, so check them before sending.

## 10. Data, privacy and security {#data}

| Data | Where it is stored |
| --- | --- |
| Agents, conversations, files, workspaces, browser data | On the computer that runs the desktop app (on the owner's computer when you join someone else's server) |
| The Always allow rules and the access activity | On the computer that runs the desktop app (HXBot's data folder, readable only by your user account) |
| Sign-ins and keys for model services | On the computer that runs the desktop app |
| Account (email address, username, mobile number, job title, company name, salted hash of the password), sign-in sessions, server directory, members and invitations | HX AI servers (mainland China) |
| Content sent over remote connections | End-to-end encrypted; HX AI servers cannot read it and do not store it |
| Model calls | Handled by the provider you choose, under its terms and privacy policy |

- The research edition collects no usage statistics or error reports.
- Back up your user folder regularly with your system's backup tool (such as Time Machine on Mac or File History on Windows).
- For details, see the Privacy Policy (https://bot.hxallai.com/en/privacy/) and the Terms of Service (https://bot.hxallai.com/en/terms/).

**Restrictions:** the research edition is for non-commercial research only. It must not be used for any commercial purpose, such as client projects, paid services, product demonstrations or sales support.

**Vault**: keep passwords, API keys, tokens, and logins to websites and apps in the Vault (desktop: Server settings → Vault; phone: Vault in the server settings). An agent that uses one gets only a file path, or HXBot fills the value in for it; the AI model never reads it. Please do not send passwords in the chat: when a message looks like it holds a password or a key, the message box holds it and asks first. Choose Open the Vault to save it there, or Send anyway. An agent that needs a password or a key shows a secure form for you to fill in.

## 11. FAQ {#faq}

**Sign-in says “This email is not on the research access list”.** The research edition is open only to listed email addresses. Email bot@hxallai.com to request access.

**I see “Too many attempts” or “Too many incorrect passwords”.** Sign-in is rate-limited to prevent brute-force attacks. Wait about 15 minutes and try again, and check that you typed the password correctly (mind upper and lower case and full-width characters). If you forgot the password, choose Forgot your password? under the sign-in form on the portal.

**The code by email or SMS does not arrive.** Look in your spam folder and check the email address and the mobile number. A code is valid for 10 minutes, and you can request a new one after 60 seconds. One mobile number gets at most 10 codes a day. Codes by SMS go to mainland China mobile numbers only. If it still does not arrive, email bot@hxallai.com.

**The page says “This email is already registered”, “This mobile number is already registered” or “This username is taken”.** One email address and one mobile number have one account each: sign in with that account, or choose Forgot password? if you need to. Usernames are unique, so choose another one.

**My server does not show up in the web app or on my phone.** Check that the server's computer is on and online and the desktop app is running; that the server is published (section 6.1); and that you signed in with the same account everywhere.

**It keeps saying “Connecting” or “Connection failed”.** Your network may block direct connections. HXBot switches to the relay automatically; if a company or campus network also blocks the relay, ask the network administrator to allow UDP / TCP 3478 and TCP 5349 to turn.bot.hxallai.com. You can also try another network, or restart the desktop app.

**The invite link does not open or has expired.** One-time invitations expire after 24 hours and work once, and an invitation sent to an email address works only for that address. Ask the server owner for a new link.

**A page says “Page not found”.** The link may be outdated or mistyped. Go back to https://bot.hxallai.com/en/ and start again.

**An agent cannot call its model.** Under Server settings → Providers, check the provider's sign-in, key, quota and regional limits. Free models depend on their providers; if they fail, try another provider.

**How do I update?** The apps update themselves: the desktop downloads the new version, then choose Update now in the window that opens; on the phone the new version opens and you tap Install. See “Updates” in section 3.

**“This HXBot version is too old” and I cannot sign in?** From this version on, older versions cannot sign in. Sign in at https://bot.hxallai.com in a browser, download the new version, install it, then sign in.

**Asked to sign in again after the upgrade?** Upgrading to this version ends the sign-in on every device once. Sign in again with your email and password; your agents and conversations are all there.

**On a Mac, a window asks for the keychain password for “HXBot Safe Storage”.** Older versions did this. New versions no longer use the macOS Keychain: your sign-in, API keys and other secrets stay in HXBot’s own encrypted vault in its data folder, which only your Mac account can read, so no window asks at start or after an update. After you update from an older version, sign in once more and enter your saved API keys again; from then on they stay. You can delete the old “HXBot Safe Storage” item in Keychain Access, or leave it.

**Will my data follow me to a new computer?** No. Agents, conversations and files stay on the original computer. You can keep publishing that computer as a server and connect to it from the new one with Add a server.

**Can I use it for commercial projects?** No. The research edition is for non-commercial research only.

## 12. Getting support {#support}

- Email: bot@hxallai.com. Tell us your email address, device and what happened, and we will reply as soon as we can.
- Use the same address for questions about your account or the codes, to request access, to delete your account, or to exercise your privacy rights.
- Related documents: Terms of Service (https://bot.hxallai.com/en/terms/), Privacy Policy (https://bot.hxallai.com/en/privacy/), and the license of the apps (included with every installer, and linked as License in the footer of the portal).
