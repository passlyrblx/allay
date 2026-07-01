# Allay Discord Bot

A small Discord bot starter built for Node.js 20 with JavaScript and `discord.js`.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Open `config.json`, then put your real Discord and Groq details there:

   ```json
   {
     "discord": {
       "botToken": "your_real_token_here",
       "clientId": "your_discord_application_client_id_here",
       "guildId": "optional_test_server_id_here"
     },
     "bot": {
       "userId": "your_bot_user_id_here"
     },
     "groq": {
       "model": "llama-3.3-70b-versatile",
       "apiKeys": [
         "your_real_groq_key_here",
         "optional_backup_groq_key_here"
       ]
     }
   }
   ```

   Leave `discord.guildId` empty (`""`) if you want slash commands deployed globally.

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

Do not commit real API keys or bot tokens. `config.json` is included as a template, so keep real production secrets private when sharing the repository. Regenerate any token that was shared publicly or pasted into chat.
