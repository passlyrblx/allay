const process = require('node:process');
const { config } = require('./config');
const { loadCommands, registerCommands } = require('./commandLoader');

const DISCORD_BOT_TOKEN = config.discord.botToken;
const DISCORD_CLIENT_ID = config.discord.clientId;
async function deploy() {
  if (!DISCORD_BOT_TOKEN) {
    throw new Error('Add discord.botToken to config.json before running deploy.js.');
  }
  if (!DISCORD_CLIENT_ID) {
    throw new Error('Add discord.clientId to config.json before running deploy.js.');
  }

  await registerCommands(loadCommands(), DISCORD_CLIENT_ID);
}

deploy().catch((error) => {
  console.error('[deploy] Failed:', error);
  process.exit(1);
});
