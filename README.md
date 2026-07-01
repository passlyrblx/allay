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

3. Register slash commands after setting `discord.botToken`, `discord.clientId`, and optionally `discord.guildId`:

   ```bash
   npm run deploy
   ```

   Put your server ID in `discord.guildId` for fast guild command updates while testing. Leave it empty only when you want global commands.

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
- `/help` shows loaded slash commands and descriptions.
- `/giveaway create` creates a persistent giveaway. Required options: `prize`, `duration`. Optional options: `winners`, `title`, `description`, `image`, `message_entries`, `entries_per_message`.
- `/giveaway end` ends a giveaway by ID.
- `/giveaway reroll` rerolls giveaway winners by ID.

If slash commands do not appear in Discord, run `npm run deploy` again and check that the console says the commands were loaded from the `commands/` directory.

## Security note

Do not commit real API keys or bot tokens. `config.json` is included as a template, so keep real production secrets private when sharing the repository. Regenerate any token that was shared publicly or pasted into chat.
