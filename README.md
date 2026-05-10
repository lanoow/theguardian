# TheGuardian Discord Bot

A modular Discord.js support-server bot configured with YAML files.

## Features

- Verification panel with configurable pre/post verification roles
- Support tickets and bug reports with configurable question flows
- Discord-like HTML transcripts
- Staff embed creation, editing, and deletion
- Timed polls with reaction results
- Voice-channel statistics

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
