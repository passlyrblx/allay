const fs = require('node:fs/promises');
const path = require('node:path');

const BOT_USER_ID = '1510331920263680183';
const MEMORY_FILE = path.join(__dirname, 'chatmemory.json');
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

// Set GROQ_API_KEY in .env, or set GROQ_API_KEYS="key1,key2" for backup keys.
const GROQ_API_KEYS = [
  process.env.GROQ_API_KEY,
  ...(process.env.GROQ_API_KEYS ? process.env.GROQ_API_KEYS.split(',') : []),
].filter(Boolean).map((key) => key.trim()).filter(Boolean);

const DEFAULT_MEMORY = {
  version: 1,
  users: {},
  messages: [],
  botMessages: [],
};

let memoryWriteQueue = Promise.resolve();

async function readMemory() {
  try {
    const raw = await fs.readFile(MEMORY_FILE, 'utf8');
    return { ...DEFAULT_MEMORY, ...JSON.parse(raw) };
  } catch (error) {
    if (error.code === 'ENOENT') return { ...DEFAULT_MEMORY };
    console.error('Failed to read chat memory:', error);
    return { ...DEFAULT_MEMORY };
  }
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

function buildPeopleMemory(users) {
  return Object.values(users)
    .map((user) => `${user.displayName} (user id ${user.id}, username ${user.username})`)
    .join('\n');
}

function buildRecentMemory(memory) {
  return memory.messages
    .slice(-80)
    .map((entry) => `${entry.displayName} (${entry.userId}): ${entry.content}`)
    .join('\n');
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
  await writeMemory(memory);

  const shouldReply = mentionIsOnlyAllay(message) || (await isReplyToAllay(message));
  if (!shouldReply) return false;

  const systemPrompt = [
    'You are Allay, a friendly Discord AI made specifically for the Epicade server.',
    'Only respond because you were directly pinged or someone replied to you.',
    'Never claim that @everyone or @here called you; those pings are ignored by the bot before this prompt.',
    'Remember users by user id first and display name second, so nobody can impersonate someone by changing names.',
    'If asked about a person, answer from memory using their user id, display name, and actions/messages toward you.',
    'Be warm, playful, possessive in a human-like way, and emotionally expressive.',
    'If someone is rude, you may be rude back. You may forgive them or refuse to forgive them depending on context.',
    'Do not invent facts that are not in memory. If memory is thin, say so honestly.',
  ].join('\n');

  const userPrompt = [
    `Speaker: ${displayName} (user id ${message.author.id})`,
    `Message: ${cleanPromptText(message)}`,
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

  const sent = await message.reply(reply.slice(0, 1900));
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
