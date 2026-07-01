const process = require('node:process');

const { Client, GatewayIntentBits, Events } = require('discord.js');
const { config } = require('./config');
const { handleAiMessage } = require('./ai');
const { loadCommands } = require('./commandLoader');
const {
  handleGiveawayButton,
  handleGiveawayModal,
  handleMessageEntry,
  initializeGiveaways,
} = require('./giveawayManager');

const DISCORD_BOT_TOKEN = config.discord.botToken;

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing Discord bot token. Add discord.botToken to config.json before running npm start.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.commands = loadCommands();

client.once(Events.ClientReady, async (readyClient) => {
  console.log('Logged in as allay');
  console.log(`Discord account: ${readyClient.user.tag}`);
  await initializeGiveaways(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return interaction.reply({ content: 'That command is not loaded.', ephemeral: true });
      return command.execute(interaction);
    }

    if (interaction.isButton() && interaction.customId.startsWith('giveaway:')) {
      return handleGiveawayButton(interaction);
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('giveaway:modal:')) {
      return handleGiveawayModal(interaction);
    }
  } catch (error) {
    console.error('Interaction failed:', error);
    const payload = { content: 'Something went wrong while running that interaction.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(console.error);
    else await interaction.reply(payload).catch(console.error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  await handleMessageEntry(message);

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
