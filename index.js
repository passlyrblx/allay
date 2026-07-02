const process = require('node:process');
const fs = require('node:fs');
const path = require('node:path');

const { Client, GatewayIntentBits, Events } = require('discord.js');
const { config } = require('./config');
const { handleAiMessage } = require('./ai');
const { loadCommands, registerCommands } = require('./commandLoader');
const { handleLeaveMember, handleWelcomeMember } = require('./welcome');
const {
  handleGiveawayButton,
  handleGiveawayModal,
  handleMessageEntry,
  handleGiveawayPrefixCommand,
  initializeGiveaways,
} = require('./giveawayManager');

const DISCORD_BOT_TOKEN = config.discord.botToken;

function loadMinecraftSystem() {
  const preferredPath = path.join(__dirname, 'mc.js');
  const fallbackPath = path.join(__dirname, 'mc (1).js');

  if (fs.existsSync(preferredPath)) {
    return require(preferredPath);
  }

  if (fs.existsSync(fallbackPath)) {
    console.warn('[minecraft] Loaded temporary mc (1).js. Rename it to mc.js before deployment.');
    return require(fallbackPath);
  }

  console.warn('[minecraft] mc.js not found; Minecraft features are disabled.');
  return null;
}

const minecraftSystem = loadMinecraftSystem();

if (!DISCORD_BOT_TOKEN) {
  console.error('Missing Discord bot token. Add discord.botToken to config.json before running npm start.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = loadCommands();

client.once(Events.ClientReady, async (readyClient) => {
  console.log('Logged in as allay');
  console.log(`Discord account: ${readyClient.user.tag}`);
  await registerCommands(client.commands, readyClient.application.id).catch((error) => console.error('[deploy] Startup slash command registration failed:', error));
  await initializeGiveaways(readyClient);
  minecraftSystem?.initMinecraftSystem?.(readyClient);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (await minecraftSystem?.handleButtonInteraction?.(interaction)) {
      return;
    }

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return interaction.reply({ content: 'That command is not loaded.', ephemeral: true });
      return command.execute(interaction);
    }

    if (interaction.isButton() && interaction.customId.startsWith('giveaway:')) {
      return handleGiveawayButton(interaction);
    }

    if (interaction.isModalSubmit() && (interaction.customId.startsWith('giveaway:modal:') || interaction.customId.startsWith('giveaway:boostmodal:'))) {
      return handleGiveawayModal(interaction);
    }
  } catch (error) {
    console.error('Interaction failed:', error);
    const payload = { content: 'Something went wrong while running that interaction.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(console.error);
    else await interaction.reply(payload).catch(console.error);
  }
});


async function handlePrefixMessage(message) {
  const content = message.content.trim();
  if (content.toLowerCase() === '.help') {
    const command = client.commands.get('help');
    if (!command?.executePrefix) return false;
    await command.executePrefix(message, client.commands);
    return true;
  }

  return handleGiveawayPrefixCommand(message);
}

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await handleWelcomeMember(member);
  } catch (error) {
    console.error('Failed to send welcome message:', error);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    await handleLeaveMember(member);
  } catch (error) {
    console.error('Failed to send leave message:', error);
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  await handleMessageEntry(message);

  const minecraftHandled = await minecraftSystem?.handlePrefixCommand?.(message);
  if (minecraftHandled) return;

  const prefixHandled = await handlePrefixMessage(message);
  if (prefixHandled) return;

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
  await minecraftSystem?.rconManager?.disconnect?.();
  client.destroy();
  process.exit(0);
});

client.login(DISCORD_BOT_TOKEN);
