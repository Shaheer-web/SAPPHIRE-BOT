# Sapphire BOT

**Public bot description:** Sapphire BOT is a multi-server community assistant for moderation, private tickets, member profiles and XP, welcome messages, automatic roles, and custom keyword replies. Easy slash-command setup, per-server settings, and SQLite persistence keep each community independent.

## 1. Prepare the Discord Application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and sign in.
2. Select **New Application**, name it **Sapphire BOT**, and accept the terms.
3. On **General Information**, set the description to the public bot description above. Set the application icon using the sapphire image you supplied.
4. Open **Bot** and select **Add Bot** if Discord asks. Enable **Public Bot** so other server owners can invite it. Keep **Requires OAuth2 Code Grant** disabled; this bot uses Discord's standard bot-install flow, not an OAuth callback flow.
5. Under **Privileged Gateway Intents**, enable **Server Members Intent** and **Message Content Intent**, then save.
6. Copy the **Application ID** from General Information. On the Bot page, reset and copy the bot token. Treat the token like a password: do not send it to anyone or post it in chat.

**Public Bot** lets other people install Sapphire BOT; it does not automatically place the app in Discord's App Directory. To appear in the Directory, complete the app's public profile and support/policy information, meet Discord's current verification and eligibility requirements, then request Directory access in the Developer Portal. Discord reviews directory requests, so listing is not automatic.

## 2. Start Sapphire BOT on Windows

Open this project folder in VS Code, then open **Terminal > New Terminal**. Run:

```powershell
npm install
Copy-Item .env.example .env
notepad .env
```

In Notepad, replace `DISCORD_TOKEN` with the bot token and `CLIENT_ID` with the Application ID. Put your real official URLs in `AI_LINK`, `WEBSITE_LINK`, and `LAUNCHER_LINK`. Put the unwanted words/phrases in `BAD_WORDS`, separated by commas. For `/song`, create a Spotify app in the Spotify Developer Dashboard and add its Client ID and Client Secret to `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET`. Save and close Notepad. Do not add quotes around values unless they are part of the value.

Back in the VS Code terminal, start the bot:

```powershell
npm start
```

`npm start` automatically deploys the latest slash-command definitions globally before connecting the bot. When you change commands in the project, restart with `npm start`; Discord may take a little time to refresh global commands.

Leave that terminal running. The bot goes offline when this process or the computer stops. To keep it online all day, later move the project to an always-on Node.js host/VPS, add the same environment variables there, and run `npm install` then `npm start` (or the host's persistent worker command). Never upload `.env` or share the token.

## 3. Invite the Bot to Your Server

1. In the Developer Portal, open **OAuth2 > URL Generator**.
2. Select scopes **bot** and **applications.commands**.
3. Select these bot permissions: **View Channels**, **Send Messages**, **Read Message History**, **Embed Links**, **Attach Files**, **Manage Messages**, **Manage Channels**, **Moderate Members**, **Manage Roles**, and **Ban Members**. The generated least-privilege permission value is `1099780189204`; do not grant Administrator.
4. Copy the generated URL, open it, choose your server, and select **Authorize**. You need permission to manage that server.
5. In the server's **Server Settings > Roles**, move Sapphire BOT's role above the Member and any roles it needs to assign or moderate. Do not move it above the server owner.

When Sapphire BOT is added, it sends the server owner a welcome DM listing the commands. If DMs are closed, it tries the server's system channel instead.

## 4. Configure the Server

Use these commands in Discord. Settings are independent for every server.

- `/member-role role` contains only a role selector and chooses the role every new member receives automatically; it has no image or reply-text settings.
- `/welcome-channel channel` sends both welcome and goodbye messages to one channel.
- `/mod-log channel` chooses where warnings, bans, timeouts, and promotions are logged.
- `/ticket-setup` posts a ticket panel in the current channel and opens a multi-role picker. Only the **actual server owner** can run setup and select which roles may view and close tickets. Any member can create a Staff Apply, Support, Report, or General ticket. Closing deletes the channel; no transcript or ticket history is stored. The opening embed shows the member's XP, level, and recorded mute count.
- `/say message image` posts owner-written text with an optional PNG, JPEG, WebP, or GIF (under 8 MB) in the current channel. Only the **actual server owner** can use it; the confirmation is private and the posted announcement is public. It does not trigger user or role mentions.
- `/clear-channel` deletes every message in the current channel after an explicit confirmation. Only the **actual server owner** can run and confirm it; having a role never grants access. Discord's API requires messages older than 14 days to be deleted one at a time, so a large channel may take time and can be rate-limited.
- `/autoresponse add trigger response image` creates an automatic reply; `response` and `image` are optional individually but at least one is required. Upload PNG, JPEG, GIF, or WebP images smaller than 8 MB. `/autoresponse remove trigger` deletes a reply; `/autoresponse list` shows them. Only the actual server owner can change these replies. A trigger matches as a whole word/phrase, without case sensitivity.

## 5. Commands and XP

- `/profile` shows a Sapphire profile card with level, XP, message count, join date, account age, and progress to the next level. `/profile user` can show another server member.
- `/about` lists Sapphire BOT features and commands.
- `/song query` privately shows the top Spotify track matches with clickable Spotify links. Playback opens in the requester's own Spotify account; the bot does not stream audio into Discord. Add Spotify app credentials to `.env` for search to work.
- `/warn user reason` and `/warnings user` manage warning records.
- `/mute user minutes reason` and `/unmute user` manage timeouts.
- `/ban user reason delete-message-seconds` bans a member; deleting recent messages is optional.
- `/promote user role reason` assigns a role allowed by Discord's role hierarchy.
- `/mod-dashboard` shows warning totals and active timeouts.

Members earn **10 XP** for a message of at least five characters, at most once per minute. Message totals count qualifying chat messages. XP and counts are stored per server and survive restarts. Ticket profiles show successful mute counts recorded from this feature onward; older mutes are not backfilled. Filtered profanity messages do not earn XP. The bot has a built-in English profanity dictionary; add more terms, including Urdu-script and Roman Urdu spellings, to `BAD_WORDS` in `.env` as comma-separated words or phrases. No list can cover every spelling, transliteration, or obfuscation, so test and extend the server's list. Each matched message is deleted, and the fifth and subsequent filtered messages from the same member trigger an attempted 10-minute timeout. The bot must have the required permissions and be above the member in the role list.

SQLite defaults to `./data/bot.sqlite`. Back it up to retain profiles, warning records, settings, and custom triggers. Uploaded custom reply images are stored in `./data/auto-responses/` beside that database. Keep both safe and private.