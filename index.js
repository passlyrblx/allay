const process = require('node:process');

const { Client, GatewayIntentBits, Events } = require('discord.js');
const { handleAiMessage } = require('./ai');

const DISCORD_BOT_TOKEN = 'PASTE_DISCORD_BOT_TOKEN_HERE';

if (!DISCORD_BOT_TOKEN || DISCORD_BOT_TOKEN === 'PASTE_DISCORD_BOT_TOKEN_HERE') {
  console.error('Missing Discord bot token. Put it in DISCORD_BOT_TOKEN inside index.js before running npm start.');
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

client.login(DISCORD_BOT_TOKEN);
