# Allay Discord Bot

A small Discord bot starter built for Node.js 20 with JavaScript and `discord.js`.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your local environment file:

   ```bash
   cp .env.example .env
   ```

3. Put your Discord bot token in `.env`:

   ```env
   DISCORD_BOT_TOKEN=your_real_token_here
   ```

4. Start the bot:

   ```bash
   npm start
   ```

When the bot is connected, the console clearly prints:

```text
Logged in as allay
```

## Commands

- `!ping` replies with `Pong!`.

## Security note

Do not commit your Discord bot token. Keep it in `.env`, which is ignored by Git.
If a token was shared publicly or pasted into chat, regenerate it in the Discord Developer Portal before using it.
