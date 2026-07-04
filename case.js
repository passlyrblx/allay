const fs = require('node:fs');
const path = require('node:path');
const {
  EmbedBuilder,
  time,
} = require('discord.js');

const ALLOWED_INVITE_CHANNEL_ID = '1482790887967690883';
const MOD_LOG_CHANNEL_ID = '1522970204924149830';
const MESSAGE_LOG_CHANNEL_ID = '1522972269406584962';
const WARN_ROLE_ID = '1480610405083512926';
const STORE_PATH = path.join(__dirname, 'data', 'moderation-cases.json');

const DISCORD_INVITE_PATTERN = /(?:https?:\/\/)?(?:www\.)?(?:discord(?:app)?\.com\/invite|discord\.gg|discord\.me|discord\.io)\/[a-z0-9-]+/i;

function hasDiscordInvite(content = '') {
  return DISCORD_INVITE_PATTERN.test(content);
}

function extractDiscordInvite(content = '') {
  return content.match(DISCORD_INVITE_PATTERN)?.[0] || null;
}

function ensureStoreDirectory() {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
}

function defaultStore() {
  return { nextCaseId: 1, cases: [] };
}

function loadStore() {
  try {
    if (!fs.existsSync(STORE_PATH)) return defaultStore();
    const data = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
    return {
      nextCaseId: Number.isInteger(data.nextCaseId) ? data.nextCaseId : 1,
      cases: Array.isArray(data.cases) ? data.cases : [],
    };
  } catch (error) {
    console.error('[moderation] Failed to read moderation case store:', error);
    return defaultStore();
  }
}

function saveStore(store) {
  ensureStoreDirectory();
  fs.writeFileSync(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`);
}

function memberCanWarn(member) {
  return Boolean(member?.roles?.cache?.has(WARN_ROLE_ID));
}

function formatUser(userId) {
  return userId ? `<@${userId}>` : 'Unknown user';
}

async function getLogChannel(clientOrGuild, channelId = MOD_LOG_CHANNEL_ID) {
  const client = clientOrGuild.client || clientOrGuild;
  return client.channels.fetch(channelId).catch(() => null);
}

async function sendLog(clientOrGuild, embed, channelId = MOD_LOG_CHANNEL_ID) {
  const channel = await getLogChannel(clientOrGuild, channelId);
  if (!channel?.isTextBased?.()) return;
  await channel.send({ embeds: [embed] }).catch((error) => console.error('[moderation] Failed to send log:', error));
}

async function sendModLog(clientOrGuild, embed) {
  await sendLog(clientOrGuild, embed, MOD_LOG_CHANNEL_ID);
}

async function sendMessageLog(clientOrGuild, embed) {
  await sendLog(clientOrGuild, embed, MESSAGE_LOG_CHANNEL_ID);
}

function buildCaseEmbed(caseEntry, title) {
  const fields = [
    { name: 'Case', value: `#${caseEntry.id}`, inline: true },
    { name: 'Action', value: caseEntry.action, inline: true },
    { name: 'User', value: `${formatUser(caseEntry.userId)} (${caseEntry.userId})`, inline: false },
    { name: 'Moderator', value: caseEntry.moderatorId ? `${formatUser(caseEntry.moderatorId)} (${caseEntry.moderatorId})` : 'Automatic invite filter', inline: false },
    { name: 'Reason', value: caseEntry.reason || 'No reason provided.', inline: false },
  ];

  if (caseEntry.link) fields.push({ name: 'Invite link', value: caseEntry.link, inline: false });
  if (caseEntry.removedBy) fields.push({ name: 'Removed by', value: `${formatUser(caseEntry.removedBy)} (${caseEntry.removedBy})`, inline: false });
  if (caseEntry.removeReason) fields.push({ name: 'Remove reason', value: caseEntry.removeReason, inline: false });

  return new EmbedBuilder()
    .setColor(caseEntry.removedAt ? 0x95a5a6 : 0xffa500)
    .setTitle(title)
    .addFields(fields)
    .setTimestamp(new Date(caseEntry.createdAt));
}

async function createCase({ guild, client, userId, moderatorId, action = 'warn', reason, link }) {
  const store = loadStore();
  const caseEntry = {
    id: store.nextCaseId,
    guildId: guild?.id || null,
    userId,
    moderatorId: moderatorId || null,
    action,
    reason: reason || 'No reason provided.',
    link: link || null,
    createdAt: new Date().toISOString(),
  };
  store.nextCaseId += 1;
  store.cases.push(caseEntry);
  saveStore(store);

  await sendModLog(guild || client, buildCaseEmbed(caseEntry, `Moderation ${action}`));
  return caseEntry;
}

async function removeCase({ guild, caseId, userId, moderatorId, reason }) {
  const store = loadStore();
  const caseEntry = store.cases.find((entry) => entry.id === caseId && entry.userId === userId && !entry.removedAt);
  if (!caseEntry) return null;
  caseEntry.removedAt = new Date().toISOString();
  caseEntry.removedBy = moderatorId;
  caseEntry.removeReason = reason || 'No reason provided.';
  saveStore(store);
  await sendModLog(guild, buildCaseEmbed(caseEntry, 'Moderation case removed'));
  return caseEntry;
}

function listCases(userId, guildId) {
  const store = loadStore();
  return store.cases
    .filter((entry) => entry.userId === userId && (!guildId || entry.guildId === guildId))
    .sort((a, b) => b.id - a.id);
}

async function handleInviteFilter(message) {
  if (!message.guild || message.channelId === ALLOWED_INVITE_CHANNEL_ID) return false;
  const invite = extractDiscordInvite(message.content);
  if (!invite) return false;

  await message.delete().catch((error) => console.error('[moderation] Failed to delete invite message:', error));
  const caseEntry = await createCase({
    guild: message.guild,
    userId: message.author.id,
    moderatorId: message.client.user.id,
    action: 'warn',
    reason: `Discord invite posted outside <#${ALLOWED_INVITE_CHANNEL_ID}>.`,
    link: invite,
  });

  await message.author.send([
    'No Discord invite links, you have been warned.',
    'If you find this is miscalculation, contact admin.',
    `Case #${caseEntry.id}`,
  ].join('\n')).catch(() => null);

  return true;
}


function messageContent(message) {
  const content = message?.content?.trim();
  const attachments = message?.attachments?.size
    ? [...message.attachments.values()].map((attachment) => attachment.url).join('\n')
    : '';
  const parts = [];
  if (content) parts.push(content);
  if (attachments) parts.push(`Attachments:\n${attachments}`);
  return parts.join('\n\n') || 'No cached message content available.';
}

function trimForEmbed(value, maxLength = 1024) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function buildMessageLogEmbed(message, title, fields = []) {
  const author = message?.author;
  const member = message?.member;
  const channel = message?.channel;
  return new EmbedBuilder()
    .setColor(title.includes('edited') ? 0xf1c40f : 0xe74c3c)
    .setTitle(title)
    .addFields(
      { name: 'User', value: author ? `${author} (${author.id})` : 'Unknown user', inline: false },
      { name: 'Channel', value: channel ? `${channel}` : 'Unknown channel', inline: true },
      { name: 'Message ID', value: message?.id || 'Unknown', inline: true },
      { name: 'Timing', value: time(new Date(), 'F'), inline: false },
      ...fields,
    )
    .setFooter({ text: member?.displayName ? `Member: ${member.displayName}` : 'Message audit log' })
    .setTimestamp();
}

async function handleMessageDelete(message) {
  if (!message.guild || message.author?.bot) return;
  const embed = buildMessageLogEmbed(message, 'Message deleted', [
    { name: 'Deleted message', value: trimForEmbed(messageContent(message)), inline: false },
  ]);
  await sendMessageLog(message.guild, embed);
}

async function handleMessageUpdate(oldMessage, newMessage) {
  const message = newMessage.guild ? newMessage : oldMessage;
  if (!message.guild || message.author?.bot) return;

  const before = messageContent(oldMessage);
  const after = messageContent(newMessage);
  if (before === after) return;

  const embed = buildMessageLogEmbed(newMessage, 'Message edited', [
    { name: 'Before', value: trimForEmbed(before), inline: false },
    { name: 'After', value: trimForEmbed(after), inline: false },
  ]);
  await sendMessageLog(newMessage.guild, embed);
}

async function logCommandExecution(interaction) {
  if (!interaction.isChatInputCommand?.()) return;
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Command executed')
    .addFields(
      { name: 'Command', value: `/${interaction.commandName}`, inline: true },
      { name: 'User', value: `${interaction.user} (${interaction.user.id})`, inline: true },
      { name: 'Channel', value: interaction.channelId ? `<#${interaction.channelId}>` : 'Unknown', inline: true },
      { name: 'Time', value: time(new Date(), 'F'), inline: false },
    )
    .setTimestamp();
  await sendModLog(interaction.client, embed);
}

module.exports = {
  ALLOWED_INVITE_CHANNEL_ID,
  MOD_LOG_CHANNEL_ID,
  MESSAGE_LOG_CHANNEL_ID,
  WARN_ROLE_ID,
  hasDiscordInvite,
  extractDiscordInvite,
  memberCanWarn,
  createCase,
  removeCase,
  listCases,
  handleInviteFilter,
  handleMessageDelete,
  handleMessageUpdate,
  logCommandExecution,
  buildCaseEmbed,
};
