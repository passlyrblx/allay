const process = require('node:process');
const { REST, Routes } = require('discord.js');
const { config } = require('./config');
const { loadCommands } = require('./commandLoader');

const DISCORD_BOT_TOKEN = config.discord.botToken;
const DISCORD_CLIENT_ID = config.discord.clientId;
const DISCORD_GUILD_ID = config.discord.guildId;

async function deploy() {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error('Add discord.botToken to config.json before running deploy.js.');
  }
  if (!DISCORD_CLIENT_ID) {
    throw new Error('Add discord.clientId to config.json before running deploy.js.');
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
