const fs = require('node:fs/promises');
const path = require('node:path');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');

const DATA_FILE = path.join(__dirname, 'data', 'giveaways.json');
const MESSAGE_ENTRY_CHANNEL_ID = '1480233618696572958';
const MESSAGE_ENTRY_COOLDOWN_MS = 3000;
const MAX_TIMEOUT_MS = 2147483647;
const timers = new Map();
const messageEntryCooldowns = new Map();
let store = { version: 1, giveaways: {} };
let writeQueue = Promise.resolve();
let clientRef;

function parseDuration(value) {
  const match = String(value || '').trim().match(/^(\d+)\s*(s|m|h|d)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  return amount * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[unit]);
}

function formatRemaining(endAt) {
  const ms = Math.max(0, new Date(endAt).getTime() - Date.now());
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${Math.max(1, minutes)}m`;
}

async function loadStore() {
  try {
    store = { ...store, ...JSON.parse(await fs.readFile(DATA_FILE, 'utf8')) };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('[giveaway] Failed to read storage:', error);
  }
}

function saveStore() {
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, `${JSON.stringify(store, null, 2)}\n`);
  }).catch((error) => console.error('[giveaway] Failed to save storage:', error));
  return writeQueue;
}

function getEntryStats(giveaway) {
  const entries = Object.values(giveaway.entries || {}).reduce((sum, n) => sum + n, 0);
  const users = Object.keys(giveaway.entries || {}).length;
  return { entries, users };
}

function weightedPool(giveaway) {
  return Object.entries(giveaway.entries || {}).flatMap(([userId, count]) => Array(Math.max(0, count)).fill(userId));
}

function pickWinners(giveaway) {
  const pool = weightedPool(giveaway);
  const winners = new Set();
  while (pool.length && winners.size < giveaway.winnerCount) {
    const [picked] = pool.splice(Math.floor(Math.random() * pool.length), 1);
    winners.add(picked);
    for (let i = pool.length - 1; i >= 0; i -= 1) if (pool[i] === picked) pool.splice(i, 1);
  }
  return [...winners];
}

function buildEmbed(giveaway) {
  const { entries: entryCount, users: uniqueCount } = getEntryStats(giveaway);
  const embed = new EmbedBuilder()
    .setColor(giveaway.ended ? 0x808080 : 0x57f287)
    .setTitle(giveaway.title || 'Giveaway')
    .setDescription(giveaway.description || 'Press the button below to enter.')
    .addFields(
      { name: 'Prize', value: giveaway.prize, inline: true },
      { name: 'Winners', value: String(giveaway.winnerCount), inline: true },
      { name: 'Ends', value: giveaway.ended ? 'Ended' : `<t:${Math.floor(new Date(giveaway.endAt).getTime() / 1000)}:R>`, inline: true },
      { name: 'Entries', value: `${entryCount} total from ${uniqueCount} user(s)`, inline: true },
      { name: 'Message entries', value: giveaway.messageEntriesEnabled ? `1 per message in <#${giveaway.messageEntryChannelId || MESSAGE_ENTRY_CHANNEL_ID}> (3s cooldown)` : 'Off', inline: true },
    )
    .setFooter({ text: `Giveaway ID: ${giveaway.id}` })
    .setTimestamp(new Date(giveaway.endAt));
  if (giveaway.imageUrl) embed.setImage(giveaway.imageUrl);
  if (giveaway.ended && giveaway.winners?.length) {
    embed.addFields({ name: 'Winner(s)', value: giveaway.winners.map((id) => `<@${id}> with ${giveaway.entries?.[id] || 0} entr${(giveaway.entries?.[id] || 0) === 1 ? 'y' : 'ies'}`).join('\n') });
  }
  return embed;
}

function buildRows(giveaway) {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`giveaway:enter:${giveaway.id}`).setLabel('Enter giveaway').setStyle(ButtonStyle.Success).setDisabled(giveaway.ended),
    new ButtonBuilder().setCustomId(`giveaway:leave:${giveaway.id}`).setLabel('Leave').setStyle(ButtonStyle.Secondary).setDisabled(giveaway.ended),
    new ButtonBuilder().setCustomId(`giveaway:edit:${giveaway.id}`).setLabel('Edit').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`giveaway:end:${giveaway.id}`).setLabel('End').setStyle(ButtonStyle.Danger).setDisabled(giveaway.ended),
    new ButtonBuilder().setCustomId(`giveaway:reroll:${giveaway.id}`).setLabel('Reroll').setStyle(ButtonStyle.Secondary),
  )];
}

async function refreshMessage(giveaway) {
  const channel = await clientRef.channels.fetch(giveaway.channelId).catch(() => null);
  const message = channel ? await channel.messages.fetch(giveaway.messageId).catch(() => null) : null;
  if (message) await message.edit({ embeds: [buildEmbed(giveaway)], components: buildRows(giveaway) });
}

async function endGiveaway(id, reroll = false) {
  const giveaway = store.giveaways[id];
  if (!giveaway) return null;
  if (giveaway.ended && !reroll) return giveaway;
  clearTimeout(timers.get(giveaway.id));
  timers.delete(giveaway.id);
  if (!reroll) giveaway.ended = true;
  giveaway.winners = pickWinners(giveaway);
  await saveStore();
  await refreshMessage(giveaway).catch(console.error);
  const channel = await clientRef.channels.fetch(giveaway.channelId).catch(() => null);
  if (channel) {
    const { entries, users } = getEntryStats(giveaway);
    const text = giveaway.winners.length
      ? `🎉 ${reroll ? 'Rerolled' : 'Giveaway ended'} for **${giveaway.prize}**! ${users} user${users === 1 ? '' : 's'} participated with ${entries} total entr${entries === 1 ? 'y' : 'ies'}. ${giveaway.winners.map((id) => `<@${id}> won with ${giveaway.entries?.[id] || 0} entr${(giveaway.entries?.[id] || 0) === 1 ? 'y' : 'ies'}`).join('; ')}.`
      : `Giveaway for **${giveaway.prize}** ended with ${users} user${users === 1 ? '' : 's'} participated and ${entries} total entr${entries === 1 ? 'y' : 'ies'}, but no valid winner could be picked.`;
    await channel.send({ content: text, allowedMentions: { users: giveaway.winners } }).catch(console.error);
  }
  return giveaway;
}

function schedule(giveaway) {
  clearTimeout(timers.get(giveaway.id));
  if (giveaway.ended) return;
  const delay = new Date(giveaway.endAt).getTime() - Date.now();
  if (delay <= 0) {
    timers.set(giveaway.id, setTimeout(() => endGiveaway(giveaway.id).catch(console.error), 1000));
    return;
  }
  timers.set(giveaway.id, setTimeout(() => {
    if (new Date(giveaway.endAt).getTime() > Date.now()) schedule(giveaway);
    else endGiveaway(giveaway.id).catch(console.error);
  }, Math.min(delay, MAX_TIMEOUT_MS)));
}

async function initializeGiveaways(client) {
  clientRef = client;
  await loadStore();
  for (const giveaway of Object.values(store.giveaways)) {
    if (!giveaway.ended && new Date(giveaway.endAt).getTime() <= Date.now()) endGiveaway(giveaway.id).catch(console.error);
    else schedule(giveaway);
  }
  console.log(`[giveaway] Restored ${Object.keys(store.giveaways).length} giveaway(s).`);
}

async function createGiveaway(interaction) {
  const durationMs = parseDuration(interaction.options.getString('duration', true));
  if (!durationMs) return interaction.reply({ content: 'Use a duration like 30m, 12h, or 7d.', ephemeral: true });
  const id = `${Date.now()}`;
  const giveaway = {
    id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
    messageId: null,
    hostId: interaction.user.id,
    title: interaction.options.getString('title') || '🎉 Giveaway',
    prize: interaction.options.getString('prize', true),
    description: interaction.options.getString('description') || 'Press Enter giveaway to join. More entries improve your chance, but do not guarantee a win.',
    imageUrl: interaction.options.getAttachment('image')?.url || interaction.options.getString('image_url') || null,
    winnerCount: interaction.options.getInteger('winners') || 1,
    endAt: new Date(Date.now() + durationMs).toISOString(),
    entries: {},
    messageEntriesEnabled: interaction.options.getBoolean('message_entries') || false,
    messageEntryChannelId: MESSAGE_ENTRY_CHANNEL_ID,
    messageEntryCount: 1,
    ended: false,
    winners: [],
  };
  const message = await interaction.channel.send({ embeds: [buildEmbed(giveaway)], components: buildRows(giveaway) });
  giveaway.messageId = message.id;
  store.giveaways[id] = giveaway;
  await saveStore();
  schedule(giveaway);
  return interaction.reply({ content: `Giveaway created. ID: ${id}. Ends in ${formatRemaining(giveaway.endAt)}.`, ephemeral: true });
}

async function handleGiveawayCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'create') return createGiveaway(interaction);
  const id = interaction.options.getString('id', true);
  if (!store.giveaways[id]) return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });
  if (sub === 'end') return endGiveaway(id).then(() => interaction.reply({ content: 'Giveaway ended.', ephemeral: true }));
  if (sub === 'reroll') return endGiveaway(id, true).then(() => interaction.reply({ content: 'Giveaway rerolled with user IDs in the result message.', ephemeral: true }));
}

function canEdit(interaction, giveaway) {
  return interaction.user.id === giveaway.hostId || interaction.memberPermissions?.has('ManageGuild');
}

async function handleGiveawayButton(interaction) {
  const [, action, id] = interaction.customId.split(':');
  const giveaway = store.giveaways[id];
  if (!giveaway) return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });
  if (action === 'enter') {
    giveaway.entries[interaction.user.id] = (giveaway.entries[interaction.user.id] || 0) + 1;
    await saveStore(); await refreshMessage(giveaway);
    return interaction.reply({ content: `Entered! You now have ${giveaway.entries[interaction.user.id]} entr${giveaway.entries[interaction.user.id] === 1 ? 'y' : 'ies'}.`, ephemeral: true });
  }
  if (action === 'leave') {
    delete giveaway.entries[interaction.user.id];
    await saveStore(); await refreshMessage(giveaway);
    return interaction.reply({ content: 'You left this giveaway.', ephemeral: true });
  }
  if (!canEdit(interaction, giveaway)) return interaction.reply({ content: 'Only the host or server managers can edit this giveaway.', ephemeral: true });
  if (action === 'end') return endGiveaway(id).then(() => interaction.reply({ content: 'Giveaway ended.', ephemeral: true }));
  if (action === 'reroll') return endGiveaway(id, true).then(() => interaction.reply({ content: 'Rerolled. Winner user IDs were posted.', ephemeral: true }));
  if (action === 'edit') {
    const modal = new ModalBuilder().setCustomId(`giveaway:modal:${id}`).setTitle('Edit giveaway');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(false).setValue(giveaway.title.slice(0, 100))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('prize').setLabel('Prize').setStyle(TextInputStyle.Short).setRequired(false).setValue(giveaway.prize.slice(0, 100))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue((giveaway.description || '').slice(0, 1000))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('imageUrl').setLabel('Image URL (optional)').setStyle(TextInputStyle.Short).setRequired(false).setValue((giveaway.imageUrl || '').slice(0, 300))),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('settings').setLabel('Winners | msg entries on/off').setStyle(TextInputStyle.Short).setRequired(false).setValue(`${giveaway.winnerCount} | ${giveaway.messageEntriesEnabled ? 'on' : 'off'}`)),
    );
    return interaction.showModal(modal);
  }
}

async function handleGiveawayModal(interaction) {
  const [, , id] = interaction.customId.split(':');
  const giveaway = store.giveaways[id];
  if (!giveaway) return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });
  if (!canEdit(interaction, giveaway)) return interaction.reply({ content: 'You cannot edit this giveaway.', ephemeral: true });
  for (const key of ['title', 'prize', 'description', 'imageUrl']) {
    const value = interaction.fields.getTextInputValue(key)?.trim();
    if (value || key === 'imageUrl') giveaway[key === 'imageUrl' ? 'imageUrl' : key] = value || null;
  }
  const [winners, enabled] = interaction.fields.getTextInputValue('settings').split('|').map((x) => x.trim());
  giveaway.winnerCount = Math.max(1, Number(winners) || giveaway.winnerCount);
  giveaway.messageEntriesEnabled = /^on|true|yes$/i.test(enabled);
  giveaway.messageEntryChannelId = MESSAGE_ENTRY_CHANNEL_ID;
  giveaway.messageEntryCount = 1;
  await saveStore(); await refreshMessage(giveaway);
  return interaction.reply({ content: 'Giveaway updated.', ephemeral: true });
}

async function handleMessageEntry(message) {
  if (message.author.bot || !message.guildId || message.channelId !== MESSAGE_ENTRY_CHANNEL_ID) return;
  const now = Date.now();
  const cooldownKey = `${message.guildId}:${message.channelId}:${message.author.id}`;
  if ((messageEntryCooldowns.get(cooldownKey) || 0) > now) return;

  let changed = false;
  for (const giveaway of Object.values(store.giveaways)) {
    const entryChannelId = giveaway.messageEntryChannelId || MESSAGE_ENTRY_CHANNEL_ID;
    if (!giveaway.ended && giveaway.messageEntriesEnabled && entryChannelId === message.channelId && message.id !== giveaway.messageId) {
      giveaway.entries[message.author.id] = (giveaway.entries[message.author.id] || 0) + 1;
      giveaway.messageEntryChannelId = MESSAGE_ENTRY_CHANNEL_ID;
      giveaway.messageEntryCount = 1;
      changed = true;
    }
  }
  if (changed) {
    messageEntryCooldowns.set(cooldownKey, now + MESSAGE_ENTRY_COOLDOWN_MS);
    await saveStore();
  }
}

module.exports = { initializeGiveaways, handleGiveawayCommand, handleGiveawayButton, handleGiveawayModal, handleMessageEntry };
