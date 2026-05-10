# TheGuardian Discord Bot

A modular Discord.js support-server bot configured with YAML files.

## Features

- Verification panel with configurable pre/post verification roles
- Support tickets and bug reports with configurable question flows
- Discord-like HTML transcripts
- Staff embed creation, editing, and deletion
- Timed polls with reaction results
- Event-driven voice-channel statistics

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment template:

   ```bash
   cp .env.example .env
   ```

3. Fill in `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID`.

4. Edit YAML files under `config/`.

5. Register slash commands:

   ```bash
   npm run deploy
   ```

6. Start the bot:

   ```bash
   npm start
   ```

The verification panel is posted automatically on startup when `verificationChannelId` is configured and no recent verification panel from the bot exists in that channel. To disable automatic posting, set `panel.autoPost: false` in `config/modules/verification.yml`.

You can also post panels manually:

```bash
/setup verification-panel
/setup ticket-panel
```

Mention the bot in any channel it can read to receive a help embed listing all available slash commands.

Stats channels build an accurate role/bot snapshot when the bot starts, then refresh when members join or leave, when member roles change, and after verification button clicks. Run `/stats refresh` after changing a stat role ID or after assigning roles while the bot was offline. A periodic fallback is only used if `fallbackIntervalMinutes` is set above `0` in `config/modules/stats.yml`.

Ticket channels are created under the configured category with explicit channel-level overwrites: `@everyone` cannot view the channel, the opener can view/send/read/upload, and configured staff roles can view/respond/manage messages.

## Slash Command Troubleshooting

If `/setup` or the other slash commands do not appear in Discord:

- Run `npm run deploy` after filling in `.env`.
- Run `npm run commands:list` to confirm Discord has commands registered for that guild.
- Confirm `DISCORD_GUILD_ID` is the server ID where you are testing.
- Confirm `DISCORD_CLIENT_ID` belongs to the same application as `DISCORD_TOKEN`.
- Re-invite the bot with both scopes: `bot` and `applications.commands`.
- Restart or reload Discord after deploying commands.

The deploy script should print the registered command names:

```bash
Deployed 5 guild slash commands to YOUR_GUILD_ID: /setup, /ticket, /embed, /poll, /stats
```

## Required Discord Intents

Enable these in the Discord developer portal before running the bot:

1. Open the Discord Developer Portal.
2. Select your application.
3. Go to **Bot**.
4. Scroll to **Privileged Gateway Intents**.
5. Enable:

- Server Members Intent
- Message Content Intent

`Server Members Intent` is required for join verification and role-based statistics.
`Message Content Intent` is required for ticket questions and setup wizards that read staff/user replies.

The bot also needs channel, role, message, reaction, and manage-channel permissions matching the features you enable.

If startup fails with `Used disallowed intents`, one of the privileged intent switches above is still disabled for the application token in `.env`.
