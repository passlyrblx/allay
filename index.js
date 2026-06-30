const process = require('node:process');
const { Client, GatewayIntentBits, Events } = require('discord.js');
const { handleAiMessage } = require('./ai');
require('dotenv').config();

const token = process.env.MTUxMDMzMTkyMDI2MzY4MDE4Mw.Gz6jU0.pWE9pVx4gNkA5qCVQQOxbtk4SNN4WZc3fp91N8;

if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN. Add it to a .env file or export it before running npm start.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once(Events.ClientReady, (readyClient) => {
  console.log('Logged in as allay');
  console.log(`Discord account: ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  const aiHandled = await handleAiMessage(message);
  if (aiHandled) return;

  const content = message.content.trim().toLowerCase();

  if (content === '!ping') {
    await message.reply('Pong!');
  }
});

client.on(Events.Error, (error) => {
  console.error('Discord client error:', error);
});

process.on('SIGINT', async () => {
  console.log('Shutting down Allay bot...');
  client.destroy();
  process.exit(0);
});

client.login(token);
