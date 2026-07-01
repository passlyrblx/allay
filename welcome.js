const fs = require('node:fs');
const path = require('node:path');
const {
  AttachmentBuilder,
  EmbedBuilder,
} = require('discord.js');

const WELCOME_CHANNEL_ID = '1480950317871796326';
const RULES_CHANNEL_ID = '1480230068054659233';
const SELF_ROLES_CHANNEL_ID = '1503707149837013093';
const LEAVE_CHANNEL_ID = '1497091621290901590';
const JOIN_ROLE_ID = '1480944751439253615';

const DATA_DIR = path.join(__dirname, 'data');
const SEEN_MEMBERS_FILE = path.join(DATA_DIR, 'welcomeSeenMembers.json');
const WELCOME_GIFS = ['welcome1.gif', 'welcome2.gif', 'welcome3.gif', 'welcome4.gif'];
const REJOIN_GIF = 'back.gif';

function readSeenMembers() {
  try {
    const parsed = JSON.parse(fs.readFileSync(SEEN_MEMBERS_FILE, 'utf8'));
    return Array.isArray(parsed.memberIds) ? new Set(parsed.memberIds) : new Set();
  } catch (error) {
    if (error.code === 'ENOENT') return new Set();
    console.error('Failed to read welcome seen members file:', error);
    return new Set();
  }
}

function saveSeenMembers(seenMembers) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(
      SEEN_MEMBERS_FILE,
      `${JSON.stringify({ memberIds: [...seenMembers] }, null, 2)}\n`,
      'utf8',
    );
  } catch (error) {
    console.error('Failed to save welcome seen members file:', error);
  }
}

function pickWelcomeGif(memberId) {
  const index = [...memberId].reduce((total, char) => total + char.charCodeAt(0), 0) % WELCOME_GIFS.length;
  return WELCOME_GIFS[index];
}

function createGifAttachment(fileName) {
  const filePath = path.join(__dirname, fileName);
  if (!fs.existsSync(filePath)) return null;
  return new AttachmentBuilder(filePath, { name: fileName });
}

function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return 'less than 1 minute';

  const units = [
    ['year', 365 * 24 * 60 * 60 * 1000],
    ['month', 30 * 24 * 60 * 60 * 1000],
    ['day', 24 * 60 * 60 * 1000],
    ['hour', 60 * 60 * 1000],
    ['minute', 60 * 1000],
  ];
  const parts = [];
  let remaining = milliseconds;

  for (const [unit, unitMilliseconds] of units) {
    const value = Math.floor(remaining / unitMilliseconds);
    if (value > 0) {
      parts.push(`${value} ${unit}${value === 1 ? '' : 's'}`);
      remaining -= value * unitMilliseconds;
    }

    if (parts.length === 2) break;
  }

  return parts.length ? parts.join(' ') : 'less than 1 minute';
}

function getMemberRoleMentions(member) {
  const roles = member.roles.cache
    .filter((role) => role.id !== member.guild.id)
    .sort((first, second) => second.position - first.position)
    .map((role) => `<@&${role.id}>`);

  return roles.length ? roles.join(', ') : 'No roles';
}

async function fetchTextChannel(client, channelId, label) {
  const channel = await client.channels.fetch(channelId).catch((error) => {
    console.error(`Failed to fetch ${label} channel:`, error);
    return null;
  });

  if (!channel || !channel.isTextBased?.()) {
    console.error(`${label} channel ${channelId} is not text-based or could not be found.`);
    return null;
  }

  return channel;
}

async function assignJoinRole(member) {
  await member.roles.add(JOIN_ROLE_ID).catch((error) => {
    console.error(`Failed to assign join role ${JOIN_ROLE_ID} to ${member.user.tag}:`, error);
  });
}

function createWelcomeEmbed(member, joinNumber, hasRejoined, gifName, hasAttachment) {
  const mention = `<@${member.id}>`;
  const title = hasRejoined ? 'Welcome back to Allay!' : 'Welcome to Allay!';
  const description = [
    `${mention}, we are happy to have you here.`,
    `You are member **#${joinNumber}**.`,
    '',
    `Please read the rules in <#${RULES_CHANNEL_ID}> and pick your self roles in <#${SELF_ROLES_CHANNEL_ID}>.`,
  ];

  if (hasRejoined) {
    description.splice(2, 0, 'Thanks for rejoining — glad to see you again!');
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description.join('\n'))
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: member.guild.name })
    .setTimestamp();

  if (hasAttachment) embed.setImage(`attachment://${gifName}`);

  return embed;
}


async function handleWelcomeMember(member) {
  await assignJoinRole(member);

  const channel = await fetchTextChannel(member.client, WELCOME_CHANNEL_ID, 'Welcome');
  if (!channel) return;

  const seenMembers = readSeenMembers();
  const hasRejoined = seenMembers.has(member.id);
  const gifName = hasRejoined ? REJOIN_GIF : pickWelcomeGif(member.id);
  const attachment = createGifAttachment(gifName);

  if (!hasRejoined) {
    seenMembers.add(member.id);
    saveSeenMembers(seenMembers);
  }

  const payload = {
    embeds: [createWelcomeEmbed(member, member.guild.memberCount, hasRejoined, gifName, Boolean(attachment))],
  };

  if (attachment) {
    payload.files = [attachment];
  } else {
    console.warn(`Welcome GIF ${gifName} was not found. Sending welcome message without a GIF.`);
  }

  await channel.send(payload);
}

function createLeaveEmbed(member) {
  const joinedTimestamp = member.joinedTimestamp;
  const duration = joinedTimestamp ? formatDuration(Date.now() - joinedTimestamp) : 'Unknown duration';

  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('Member left Allay')
    .setDescription([
      `<@${member.id}> left the server.`,
      `**Roles:** ${getMemberRoleMentions(member)}`,
      `**Time in server:** ${duration}`,
    ].join('\n'))
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setFooter({ text: member.guild.name })
    .setTimestamp();
}

async function handleLeaveMember(member) {
  const channel = await fetchTextChannel(member.client, LEAVE_CHANNEL_ID, 'Leave');
  if (!channel) return;

  await channel.send({
    content: `<@${member.id}> left the server.`,
    embeds: [createLeaveEmbed(member)],
  });
}

module.exports = { handleLeaveMember, handleWelcomeMember };
