# Allay Discord Bot

A small Discord bot starter built for Node.js 20 with JavaScript and `discord.js`.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Put your API keys in `.environment`:

   ```env
   DISCORD_BOT_TOKEN=your_real_token_here
   GROQ_API_KEY=your_real_groq_key_here
   ```

3. Start the bot:

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

Do not commit real API keys or bot tokens. Keep secrets in your local `.environment` file only, and regenerate any token that was shared publicly or pasted into chat.
