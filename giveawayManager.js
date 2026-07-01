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

function formatEntryCount(value) {
  const number = Number(value) || 0;
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/\.?0+$/, '');
}

function getEntryStats(giveaway) {
  const entries = Object.values(giveaway.entries || {}).reduce((sum, n) => sum + (Number(n) || 0), 0);
  const users = Object.keys(giveaway.entries || {}).length;
  return { entries, users };
}

function pickWinners(giveaway) {
  const weights = Object.entries(giveaway.entries || {})
    .map(([userId, count]) => [userId, Math.max(0, Number(count) || 0)])
    .filter(([, count]) => count > 0);
  const winners = new Set();
  while (weights.length && winners.size < giveaway.winnerCount) {
    const total = weights.reduce((sum, [, count]) => sum + count, 0);
    let roll = Math.random() * total;
    const index = weights.findIndex(([, count]) => {
      roll -= count;
      return roll <= 0;
    });
    const [picked] = weights.splice(index === -1 ? weights.length - 1 : index, 1)[0];
    winners.add(picked);
  }
  return [...winners];
}

function getMemberEntryMultiplier(member, giveaway) {
  const roleMultipliers = giveaway.roleMultipliers || {};
  const roleIds = member?.roles?.cache ? [...member.roles.cache.keys()] : [];
  return roleIds.reduce((best, roleId) => Math.max(best, Number(roleMultipliers[roleId]) || 1), 1);
}

function buildEmbed(giveaway) {
  const { entries: entryCount } = getEntryStats(giveaway);
  const embed = new EmbedBuilder()
    .setColor(giveaway.ended || giveaway.cancelled ? 0x2b2d31 : 0x5865f2)
    .setTitle(giveaway.title || 'Giveaway')
    .setDescription(giveaway.description || 'Press Join to enter.')
    .addFields({ name: 'Entries', value: `**${formatEntryCount(entryCount)}**`, inline: true })
    .setFooter({ text: `Giveaway ID: ${giveaway.id}` });
  if (giveaway.imageUrl) embed.setImage(giveaway.imageUrl);
  return embed;
}

function buildRows(giveaway) {
  if (giveaway.cancelled || giveaway.ended) return [];

  if (!giveaway.started) {
    return [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`giveaway:edit:${giveaway.id}`).setLabel('Edit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`giveaway:boost:${giveaway.id}`).setLabel('Role boost').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`giveaway:cancel:${giveaway.id}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`giveaway:start:${giveaway.id}`).setLabel('Start').setStyle(ButtonStyle.Success),
    )];
  }

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`giveaway:enter:${giveaway.id}`).setLabel('Join').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`giveaway:leave:${giveaway.id}`).setLabel('Leave').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`giveaway:edit:${giveaway.id}`).setLabel('Edit').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`giveaway:boost:${giveaway.id}`).setLabel('Role boost').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`giveaway:end:${giveaway.id}`).setLabel('End').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`giveaway:reroll:${giveaway.id}`).setLabel('Reroll').setStyle(ButtonStyle.Secondary),
    ),
  ];
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
      ? `🎉 ${reroll ? 'Rerolled' : 'Giveaway ended'} for **${giveaway.prize}**! ${users} user${users === 1 ? '' : 's'} participated with ${formatEntryCount(entries)} total entries. ${giveaway.winners.map((id) => `<@${id}> won with ${formatEntryCount(giveaway.entries?.[id] || 0)} entries`).join('; ')}.`
      : `Giveaway for **${giveaway.prize}** ended with ${users} user${users === 1 ? '' : 's'} participated and ${formatEntryCount(entries)} total entries, but no valid winner could be picked.`;
    await channel.send({ content: text, allowedMentions: { users: giveaway.winners } }).catch(console.error);
  }
  return giveaway;
}

function schedule(giveaway) {
  clearTimeout(timers.get(giveaway.id));
  if (giveaway.ended || giveaway.cancelled || !giveaway.started) return;
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
    if (giveaway.started === undefined) giveaway.started = !giveaway.ended && !giveaway.cancelled;
    if (giveaway.cancelled === undefined) giveaway.cancelled = false;
    if (!giveaway.durationMs && giveaway.createdAt && giveaway.endAt) {
      giveaway.durationMs = Math.max(1000, new Date(giveaway.endAt).getTime() - new Date(giveaway.createdAt).getTime());
    }
    if (!giveaway.roleMultipliers) giveaway.roleMultipliers = {};
    if (!giveaway.ended && giveaway.started && new Date(giveaway.endAt).getTime() <= Date.now()) endGiveaway(giveaway.id).catch(console.error);
    else schedule(giveaway);
  }
  await saveStore();
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
    createdAt: new Date().toISOString(),
    title: interaction.options.getString('title') || '🎉 Giveaway',
    prize: interaction.options.getString('prize', true),
    description: interaction.options.getString('description') || 'Press Join to enter.',
    imageUrl: interaction.options.getAttachment('image')?.url || interaction.options.getString('image_url') || null,
    winnerCount: interaction.options.getInteger('winners') || 1,
    durationMs,
    endAt: new Date(Date.now() + durationMs).toISOString(),
    entries: {},
    messageEntriesEnabled: interaction.options.getBoolean('message_entries') || false,
    messageEntryChannelId: MESSAGE_ENTRY_CHANNEL_ID,
    messageEntryCount: 1,
    roleMultipliers: {},
    started: false,
    ended: false,
    cancelled: false,
    winners: [],
  };
  const message = await interaction.channel.send({ embeds: [buildEmbed(giveaway)], components: buildRows(giveaway) });
  giveaway.messageId = message.id;
  store.giveaways[id] = giveaway;
  await saveStore();
  return interaction.reply({ content: `Giveaway created. ID: ${id}. Use Start when you are ready to open entries.`, ephemeral: true });
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
    if (!giveaway.started || giveaway.ended || giveaway.cancelled) return interaction.reply({ content: 'This giveaway is not open for entries.', ephemeral: true });
    if (giveaway.entries[interaction.user.id]) return interaction.reply({ content: 'You are already entered in this giveaway.', ephemeral: true });
    giveaway.entries[interaction.user.id] = getMemberEntryMultiplier(interaction.member, giveaway);
    await saveStore(); await refreshMessage(giveaway);
    return interaction.reply({ content: `Entered! You have ${formatEntryCount(giveaway.entries[interaction.user.id])} entry${giveaway.entries[interaction.user.id] === 1 ? '' : 'ies'} in this giveaway.`, ephemeral: true });
  }
  if (action === 'leave') {
    if (!giveaway.started || giveaway.ended || giveaway.cancelled) return interaction.reply({ content: 'This giveaway is not open for entries.', ephemeral: true });
    delete giveaway.entries[interaction.user.id];
    await saveStore(); await refreshMessage(giveaway);
    return interaction.reply({ content: 'You left this giveaway.', ephemeral: true });
  }
  if (!canEdit(interaction, giveaway)) return interaction.reply({ content: 'Only the host or server managers can edit this giveaway.', ephemeral: true });
  if (action === 'start') {
    if (giveaway.started) return interaction.reply({ content: 'Giveaway is already started.', ephemeral: true });
    giveaway.started = true;
    giveaway.cancelled = false;
    giveaway.ended = false;
    giveaway.endAt = new Date(Date.now() + Math.max(1000, giveaway.durationMs || (new Date(giveaway.endAt).getTime() - Date.now()))).toISOString();
    await saveStore();
    schedule(giveaway);
    await refreshMessage(giveaway);
    return interaction.reply({ content: `Giveaway started. Ends in ${formatRemaining(giveaway.endAt)}.`, ephemeral: true });
  }
  if (action === 'cancel') {
    giveaway.cancelled = true;
    giveaway.ended = true;
    clearTimeout(timers.get(giveaway.id));
    timers.delete(giveaway.id);
    await saveStore(); await refreshMessage(giveaway);
    return interaction.reply({ content: 'Giveaway cancelled.', ephemeral: true });
  }
  if (action === 'end') return endGiveaway(id).then(() => interaction.reply({ content: 'Giveaway ended.', ephemeral: true }));
  if (action === 'reroll') return endGiveaway(id, true).then(() => interaction.reply({ content: 'Rerolled. Winner user IDs were posted.', ephemeral: true }));
  if (action === 'boost') {
    const modal = new ModalBuilder().setCustomId(`giveaway:boostmodal:${id}`).setTitle('Role entry boost');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('roleId').setLabel('Role ID').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('multiplier').setLabel('Multiplier (2x, 3x, 1.1x)').setStyle(TextInputStyle.Short).setRequired(true).setValue('2x')),
    );
    return interaction.showModal(modal);
  }
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
  const [, modalType, id] = interaction.customId.split(':');
  const giveaway = store.giveaways[id];
  if (!giveaway) return interaction.reply({ content: 'Giveaway not found.', ephemeral: true });
  if (!canEdit(interaction, giveaway)) return interaction.reply({ content: 'You cannot edit this giveaway.', ephemeral: true });
  if (modalType === 'boostmodal') {
    const roleId = interaction.fields.getTextInputValue('roleId').replace(/[<@&>]/g, '').trim();
    const multiplier = Number(interaction.fields.getTextInputValue('multiplier').toLowerCase().replace('x', '').trim());
    if (!/^\d{10,}$/.test(roleId) || !Number.isFinite(multiplier) || multiplier <= 0) {
      return interaction.reply({ content: 'Use a valid role ID and a multiplier like 2x, 3x, or 1.1x.', ephemeral: true });
    }
    giveaway.roleMultipliers = { ...(giveaway.roleMultipliers || {}), [roleId]: multiplier };
    await saveStore(); await refreshMessage(giveaway);
    return interaction.reply({ content: 'Role boost saved.', ephemeral: true });
  }
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

  const changedGiveaways = [];
  for (const giveaway of Object.values(store.giveaways)) {
    const entryChannelId = giveaway.messageEntryChannelId || MESSAGE_ENTRY_CHANNEL_ID;
    if (giveaway.started && !giveaway.ended && !giveaway.cancelled && giveaway.messageEntriesEnabled && entryChannelId === message.channelId && message.id !== giveaway.messageId) {
      giveaway.entries[message.author.id] = (giveaway.entries[message.author.id] || 0) + getMemberEntryMultiplier(message.member, giveaway);
      giveaway.messageEntryChannelId = MESSAGE_ENTRY_CHANNEL_ID;
      giveaway.messageEntryCount = 1;
      changedGiveaways.push(giveaway);
    }
  }
  if (changedGiveaways.length) {
    messageEntryCooldowns.set(cooldownKey, now + MESSAGE_ENTRY_COOLDOWN_MS);
    await saveStore();
    await Promise.all(changedGiveaways.map((giveaway) => refreshMessage(giveaway).catch(console.error)));
  }
}


function parsePrefixArgs(content) {
  const args = [];
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(content))) args.push(match[1] ?? match[2] ?? match[3]);
  return args;
}

function takeFlag(args, name, hasValue = true) {
  const index = args.findIndex((arg) => arg.toLowerCase() === name);
  if (index === -1) return hasValue ? null : false;
  args.splice(index, 1);
  if (!hasValue) return true;
  const [value] = args.splice(index, 1);
  return value || null;
}

function prefixOptions(values, subcommand) {
  return {
    getSubcommand: () => subcommand,
    getString: (name, required = false) => {
      const value = values[name] ?? null;
      if (required && !value) throw new Error(`Missing required option: ${name}`);
      return value;
    },
    getInteger: (name) => values[name] ? Number(values[name]) : null,
    getBoolean: (name) => Boolean(values[name]),
    getAttachment: () => null,
  };
}

function buildPrefixInteraction(message, subcommand, values) {
  return {
    guildId: message.guildId,
    channelId: message.channelId,
    channel: message.channel,
    user: message.author,
    memberPermissions: message.member?.permissions,
    options: prefixOptions(values, subcommand),
    async reply(payload) {
      const response = typeof payload === 'string' ? { content: payload } : payload;
      return message.reply({ ...response, ephemeral: undefined });
    },
  };
}

async function handleGiveawayPrefixCommand(message) {
  const content = message.content.trim();
  let subcommand;
  let rest;
  if (/^\.?g\.create(\s|$)/i.test(content)) { subcommand = 'create'; rest = content.replace(/^\.?g\.create/i, '').trim(); }
  else if (/^\.?g\.end(\s|$)/i.test(content)) { subcommand = 'end'; rest = content.replace(/^\.?g\.end/i, '').trim(); }
  else if (/^\.?g\.reroll(\s|$)/i.test(content)) { subcommand = 'reroll'; rest = content.replace(/^\.?g\.reroll/i, '').trim(); }
  else if (/^\.g create(\s|$)/i.test(content)) { subcommand = 'create'; rest = content.replace(/^\.g create/i, '').trim(); }
  else if (/^\.g end(\s|$)/i.test(content)) { subcommand = 'end'; rest = content.replace(/^\.g end/i, '').trim(); }
  else if (/^\.g reroll(\s|$)/i.test(content)) { subcommand = 'reroll'; rest = content.replace(/^\.g reroll/i, '').trim(); }
  else return false;

  if (!message.member?.permissions?.has('ManageGuild')) {
    await message.reply('You need the Manage Server permission to use giveaway commands.');
    return true;
  }

  const args = parsePrefixArgs(rest);
  const values = {};
  if (subcommand === 'create') {
    values.winners = takeFlag(args, '--winners') || takeFlag(args, '-w');
    values.title = takeFlag(args, '--title');
    values.description = takeFlag(args, '--description') || takeFlag(args, '--desc');
    values.image_url = takeFlag(args, '--image') || takeFlag(args, '--image-url');
    values.message_entries = takeFlag(args, '--message-entries', false) || takeFlag(args, '--messages', false);
    values.duration = args.shift();
    values.prize = args.join(' ');
    if (!values.duration || !values.prize) {
      await message.reply('Usage: `g.create <duration> <prize> [--winners 1] [--title "Title"] [--description "Description"] [--image URL] [--message-entries]`');
      return true;
    }
  } else {
    values.id = args[0];
    if (!values.id) {
      await message.reply(`Usage: \`g.${subcommand} <giveaway_id>\``);
      return true;
    }
  }

  await handleGiveawayCommand(buildPrefixInteraction(message, subcommand, values));
  return true;
}

module.exports = { initializeGiveaways, handleGiveawayCommand, handleGiveawayButton, handleGiveawayModal, handleMessageEntry, handleGiveawayPrefixCommand };
