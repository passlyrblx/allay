const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const WELCOME_CHANNEL_ID = '1480950317871796326';
const RULES_CHANNEL_ID = '1480230068054659233';
const SELF_ROLES_CHANNEL_ID = '1503707149837013093';

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

function createWelcomeButtons(guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Rules')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guildId}/${RULES_CHANNEL_ID}`),
    new ButtonBuilder()
      .setLabel('Self Roles')
      .setEmoji('✨')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://discord.com/channels/${guildId}/${SELF_ROLES_CHANNEL_ID}`),
  );
}

function createWelcomeContent(member, joinNumber, hasRejoined) {
  const mention = `<@${member.id}>`;
  const lines = [
    `Welcome ${mention}! You are our #${joinNumber} member — we are happy to have you here.`,
  ];

  if (hasRejoined) {
    lines.push('Thanks for rejoining!');
  }

  return lines.join('\n');
}

async function handleWelcomeMember(member) {
  const channel = await member.client.channels.fetch(WELCOME_CHANNEL_ID).catch((error) => {
    console.error('Failed to fetch welcome channel:', error);
    return null;
  });

  if (!channel || !channel.isTextBased?.()) {
    console.error(`Welcome channel ${WELCOME_CHANNEL_ID} is not text-based or could not be found.`);
    return;
  }

  const seenMembers = readSeenMembers();
  const hasRejoined = seenMembers.has(member.id);
  const gifName = hasRejoined ? REJOIN_GIF : pickWelcomeGif(member.id);
  const attachment = createGifAttachment(gifName);

  if (!hasRejoined) {
    seenMembers.add(member.id);
    saveSeenMembers(seenMembers);
  }

  const payload = {
    content: createWelcomeContent(member, member.guild.memberCount, hasRejoined),
    components: [createWelcomeButtons(member.guild.id)],
  };

  if (attachment) {
    payload.files = [attachment];
  } else {
    console.warn(`Welcome GIF ${gifName} was not found. Sending welcome message without a GIF.`);
  }

  await channel.send(payload);
}

module.exports = { handleWelcomeMember };
