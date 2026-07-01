const fs = require('node:fs/promises');
const path = require('node:path');
const { config } = require('./config');

const BOT_USER_ID = config.bot.userId;
const MEMORY_FILE = path.join(__dirname, 'chatmemory.json');
const GROQ_MODEL = config.groq.model;
const GROQ_API_KEYS = config.groq.apiKeys;

const DEFAULT_MEMORY = {
  version: 1,
  users: {},
  messages: [],
  botMessages: [],
  relationships: {
    bestFriend: null,
    previousBestFriends: [],
    anger: {},
  },
};

let memoryWriteQueue = Promise.resolve();

async function readMemory() {
  try {
    const raw = await fs.readFile(MEMORY_FILE, 'utf8');
    return normalizeMemory({ ...DEFAULT_MEMORY, ...JSON.parse(raw) });
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeMemory({ ...DEFAULT_MEMORY });
    console.error('Failed to read chat memory:', error);
    return normalizeMemory({ ...DEFAULT_MEMORY });
  }
}

function normalizeMemory(memory) {
  return {
    ...DEFAULT_MEMORY,
    ...memory,
    users: memory.users || {},
    messages: memory.messages || [],
    botMessages: memory.botMessages || [],
    relationships: {
      ...DEFAULT_MEMORY.relationships,
      ...(memory.relationships || {}),
      previousBestFriends: memory.relationships?.previousBestFriends || [],
      anger: memory.relationships?.anger || {},
    },
  };
}

function writeMemory(memory) {
  memoryWriteQueue = memoryWriteQueue
    .then(() => fs.writeFile(MEMORY_FILE, `${JSON.stringify(memory, null, 2)}\n`))
    .catch((error) => console.error('Failed to write chat memory:', error));

  return memoryWriteQueue;
}

function rememberUser(memory, message) {
  const memberName = message.member?.displayName;
  const globalName = message.author.globalName;
  const username = message.author.username;
  const displayName = memberName || globalName || username;

  memory.users[message.author.id] = {
    ...(memory.users[message.author.id] || {}),
    id: message.author.id,
    displayName,
    username,
    globalName: globalName || null,
    lastSeenAt: new Date().toISOString(),
  };

  return displayName;
}

function mentionIsOnlyAllay(message) {
  if (message.mentions.everyone) return false;
  if (!message.mentions.users.has(BOT_USER_ID)) return false;

  const mentionedIds = [...message.mentions.users.keys()];
  return mentionedIds.includes(BOT_USER_ID);
}

function isReplyToAllay(message) {
  const referenceId = message.reference?.messageId;
  if (!referenceId) return false;

  return message.channel.messages
    .fetch(referenceId)
    .then((referencedMessage) => referencedMessage.author.id === BOT_USER_ID)
    .catch(() => false);
}

function cleanPromptText(message) {
  return message.content
    .replace(new RegExp(`<@!?${BOT_USER_ID}>`, 'g'), 'Allay')
    .replace(/@everyone/g, 'everyone')
    .replace(/@here/g, 'here')
    .trim();
}

function pushLimited(array, entry, limit) {
  array.push(entry);
  if (array.length > limit) array.splice(0, array.length - limit);
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function chance(key, percent) {
  return (hashText(key) % 100) < percent;
}

function ensureRelationshipMemory(memory) {
  memory.relationships = {
    ...DEFAULT_MEMORY.relationships,
    ...(memory.relationships || {}),
    previousBestFriends: memory.relationships?.previousBestFriends || [],
    anger: memory.relationships?.anger || {},
  };
}

function maybeUpdateBestFriend(memory, message, displayName) {
  ensureRelationshipMemory(memory);
  if (message.author.id === BOT_USER_ID) return 'none';

  const currentBestFriend = memory.relationships.bestFriend;
  if (currentBestFriend?.userId === message.author.id) return 'none';

  const userMessages = memory.messages.filter((entry) => entry.userId === message.author.id);
  const kindSignals = /\b(thanks?|thank you|sorry|please|good bot|nice|ily|love you|friend|bestie|help)\b/i.test(message.content);
  const alreadyKnowsUser = userMessages.length >= 3;
  const strongBond = userMessages.length >= 6;
  const anger = memory.relationships.anger[message.author.id];
  const speakerIsNotAngryTarget = !anger || anger.level === 0;

  if (!currentBestFriend) {
    const shouldChoose = alreadyKnowsUser && kindSignals && chance(`${message.author.id}:${message.id}:best-friend`, 18);
    if (!shouldChoose) return 'none';

    memory.relationships.bestFriend = {
      userId: message.author.id,
      displayName,
      chosenAt: new Date().toISOString(),
      reason: 'Allay quietly felt protective after repeated kind interactions.',
    };
    return 'chosen';
  }

  const shouldSwitch = strongBond
    && kindSignals
    && speakerIsNotAngryTarget
    && chance(`${message.author.id}:${message.id}:${currentBestFriend.userId}:switch-best-friend`, 5);

  if (!shouldSwitch) return 'none';

  pushLimited(memory.relationships.previousBestFriends, {
    ...currentBestFriend,
    replacedAt: new Date().toISOString(),
    replacedByUserId: message.author.id,
  }, 10);

  memory.relationships.bestFriend = {
    userId: message.author.id,
    displayName,
    chosenAt: new Date().toISOString(),
    reason: 'Allay rarely felt a stronger bond after many kind interactions.',
  };
  return 'switched';
}

function getBestFriend(memory) {
  ensureRelationshipMemory(memory);
  const bestFriend = memory.relationships.bestFriend;
  if (!bestFriend?.userId) return null;

  const rememberedUser = memory.users[bestFriend.userId];
  return {
    ...bestFriend,
    displayName: rememberedUser?.displayName || bestFriend.displayName,
  };
}

function messageTargetsBestFriend(message, bestFriend) {
  if (!bestFriend) return false;
  const content = message.content.toLowerCase();
  const bestFriendName = (bestFriend.displayName || '').toLowerCase();
  const mentionsBestFriend = message.mentions.users.has(bestFriend.userId)
    || (bestFriendName && content.includes(bestFriendName));
  const asksForRoast = /\b(roast|insult|cook|trash|make fun of|bully)\b/i.test(message.content);
  const saysBestFriend = /\b(best\s*friend|bestie|friend)\b/i.test(message.content);

  return asksForRoast && (mentionsBestFriend || saysBestFriend);
}

function messageSoundsHostile(message) {
  return /\b(stupid|idiot|dumb|shut up|hate you|trash|useless|bad bot|annoying|ugly|worthless)\b/i.test(message.content);
}

function updateAnger(memory, message, { attackedBestFriend }) {
  ensureRelationshipMemory(memory);
  const existing = memory.relationships.anger[message.author.id] || { level: 0, forgivenCount: 0 };
  const hostile = attackedBestFriend || messageSoundsHostile(message);

  if (hostile) {
    existing.level = Math.min(5, existing.level + (attackedBestFriend ? 3 : 1));
    existing.lastAngeredAt = new Date().toISOString();
    existing.reason = attackedBestFriend ? 'They tried to roast Allay\'s best friend.' : 'They were rude to Allay.';
  } else if (existing.level > 0 && /\b(sorry|apologize|my bad|forgive me|please)\b/i.test(message.content)) {
    const forgives = chance(`${message.author.id}:${message.id}:forgive:${existing.level}`, 25);
    if (forgives) {
      existing.level = Math.max(0, existing.level - 2);
      existing.forgivenCount += 1;
      existing.lastForgivenAt = new Date().toISOString();
    }
  }

  if (existing.level > 0 || existing.forgivenCount > 0) memory.relationships.anger[message.author.id] = existing;
  return existing;
}

function buildPeopleMemory(users) {
  return Object.values(users)
    .map((user) => [
      `Internal user id: ${user.id}`,
      `Display name: ${user.displayName}`,
      `Username: ${user.username}`,
    ].join(' | '))
    .join('\n');
}

function buildRecentMemory(memory) {
  return memory.messages
    .slice(-80)
    .map((entry) => `Internal user id ${entry.userId} (${entry.displayName}): ${entry.content}`)
    .join('\n');
}

function sanitizeAiReply(reply) {
  return reply
    .replace(/\s*\((?=[^)]*(?:user\s*id|username|\d{10,}))[\s\S]*?\)/gi, '')
    .replace(/\buser\s*id\s*[:#-]?\s*\d{10,}\b/gi, 'their ID')
    .replace(/\busername\s*[:#-]?\s*[A-Za-z0-9_.-]{2,32}\b/gi, 'username')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function askGroq(messages) {
  if (GROQ_API_KEYS.length === 0) {
    return 'I need a Groq API key before I can think properly.';
  }

  let lastError;

  for (const apiKey of GROQ_API_KEYS) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages,
          temperature: 0.85,
          max_tokens: 450,
        }),
      });

      if ([401, 403, 429].includes(response.status)) {
        lastError = new Error(`Groq key failed with ${response.status}`);
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Groq request failed with ${response.status}: ${text}`);
      }

      const data = await response.json();
      return data.choices?.[0]?.message?.content?.trim() || 'I am here, but my thoughts got quiet for a second.';
    } catch (error) {
      lastError = error;
      console.error('Groq request failed, trying next key if available:', error.message);
    }
  }

  console.error('All Groq keys failed:', lastError);
  return 'My brain is having trouble connecting right now. Try pinging me again in a bit.';
}

async function handleAiMessage(message) {
  if (message.author.bot) return false;

  const memory = await readMemory();
  const displayName = rememberUser(memory, message);

  ensureRelationshipMemory(memory);

  const messageEntry = {
    id: message.id,
    userId: message.author.id,
    displayName,
    username: message.author.username,
    channelId: message.channel.id,
    guildId: message.guild?.id || null,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };

  pushLimited(memory.messages, messageEntry, 1500);
  const bestFriendUpdate = maybeUpdateBestFriend(memory, message, displayName);
  await writeMemory(memory);

  const shouldReply = mentionIsOnlyAllay(message) || (await isReplyToAllay(message));
  if (!shouldReply) return false;

  const bestFriend = getBestFriend(memory);
  const attackedBestFriend = messageTargetsBestFriend(message, bestFriend);
  const anger = updateAnger(memory, message, { attackedBestFriend });

  const systemPrompt = [
    'You are Allay, a friendly Discord AI made specifically for the Epicade server.',
    'Only respond because you were directly pinged or someone replied to you.',
    'Never claim that @everyone or @here called you; those pings are ignored by the bot before this prompt.',
    'Use internal user IDs to remember who is who and prevent impersonation, but treat those IDs as private metadata.',
    'Never reveal, quote, or mention user IDs, usernames/handles, or internal identifiers in your Discord replies unless a moderator explicitly asks for diagnostic data.',
    "Use display names sparingly and naturally; do not greet every reply with the person's name.",
    'If asked about a person, answer from memory using their display name only when needed and focus on their actions/messages toward you.',
    'Be warm, playful, possessive in a human-like way, and emotionally expressive.',
    'Allay may quietly choose one current best friend from remembered users based on her own feelings and repeated kind interactions; never announce that you are choosing, going to choose, or looking for a best friend.',
    'Allay can have only one current best friend at a time. She may switch best friends, but this is rare, based on stronger repeated kindness, and never because someone asks or merely speaks next.',
    'If anyone roasts, insults, or asks you to roast your best friend, protect your best friend and roast the requester instead. Do not roast your best friend.',
    'If someone makes you angry, stay angry and mostly refuse to forgive them; there is only a small chance you soften after a sincere apology.',
    'If a user is good to you, be good to them. If a user is bad to you, you may or may not be kind, but still answer direct questions helpfully.',
    'Do not invent facts that are not in memory. If memory is thin, say so honestly.',
  ].join('\n');

  const userPrompt = [
    `Speaker display name for context only: ${displayName}`,
    `Internal speaker user id, do not reveal: ${message.author.id}`,
    `Message: ${cleanPromptText(message)}`,
    `Best friend chosen already: ${bestFriend ? `${bestFriend.displayName} (internal id ${bestFriend.userId})` : 'No'}`,
    `Best friend update on this message, keep silent: ${bestFriendUpdate}`,
    `Current speaker anger level from Allay, 0-5: ${anger.level || 0}`,
    `Speaker tried to roast or request a roast of Allay's best friend: ${attackedBestFriend ? 'Yes' : 'No'}`,
    anger.reason ? `Why Allay is angry at this speaker: ${anger.reason}` : 'Why Allay is angry at this speaker: Not angry.',
    '',
    'Known people:',
    buildPeopleMemory(memory.users) || 'None yet.',
    '',
    'Recent chat memory:',
    buildRecentMemory(memory) || 'No messages remembered yet.',
  ].join('\n');

  const reply = await askGroq([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]);

  const safeReply = sanitizeAiReply(reply) || 'I am here, but my words got tangled for a second.';
  const sent = await message.reply(safeReply.slice(0, 1900));
  pushLimited(memory.botMessages, {
    id: sent.id,
    channelId: sent.channel.id,
    guildId: sent.guild?.id || null,
    content: sent.content,
    createdAt: sent.createdAt.toISOString(),
  }, 500);
  await writeMemory(memory);

  return true;
}

module.exports = {
  BOT_USER_ID,
  handleAiMessage,
};
