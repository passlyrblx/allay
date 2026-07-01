const process = require('node:process');
const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./commandLoader');

const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || 'PASTE_DISCORD_BOT_TOKEN_HERE';
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || 'PASTE_DISCORD_CLIENT_ID_HERE';
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '';

async function deploy() {
  if (!DISCORD_BOT_TOKEN || DISCORD_BOT_TOKEN.startsWith('PASTE_')) {
    throw new Error('Set DISCORD_BOT_TOKEN in your environment before running deploy.js.');
  }
  if (!DISCORD_CLIENT_ID || DISCORD_CLIENT_ID.startsWith('PASTE_')) {
    throw new Error('Set DISCORD_CLIENT_ID in your environment before running deploy.js.');
  }

  const commands = [...loadCommands().values()].map((command) => command.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
  const route = DISCORD_GUILD_ID
    ? Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID)
    : Routes.applicationCommands(DISCORD_CLIENT_ID);

  console.log(`[deploy] Registering ${commands.length} slash command(s) ${DISCORD_GUILD_ID ? `to guild ${DISCORD_GUILD_ID}` : 'globally'}...`);
  const data = await rest.put(route, { body: commands });
  console.log(`[deploy] Registered ${data.length} command(s).`);
}

deploy().catch((error) => {
  console.error('[deploy] Failed:', error);
  process.exit(1);
});
