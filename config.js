const fs = require('node:fs');
const path = require('node:path');

const CONFIG_FILE = path.join(__dirname, 'config.json');

function readConfigFile() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error('Missing config.json. Create it from the included template and add your bot/API details.');
    }
    throw new Error(`Failed to read config.json: ${error.message}`);
  }
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function cleanSecret(value) {
  const secret = cleanString(value);
  return secret && !secret.startsWith('PASTE_') ? secret : '';
}

function cleanArray(value) {
  return Array.isArray(value) ? value.map(cleanSecret).filter(Boolean) : [];
}

const rawConfig = readConfigFile();

const config = {
  discord: {
    botToken: cleanSecret(rawConfig.discord?.botToken),
    clientId: cleanSecret(rawConfig.discord?.clientId),
    guildId: cleanString(rawConfig.discord?.guildId),
  },
  bot: {
    userId: cleanString(rawConfig.bot?.userId),
  },
  groq: {
    model: cleanString(rawConfig.groq?.model) || 'llama-3.3-70b-versatile',
    apiKeys: cleanArray(rawConfig.groq?.apiKeys),
  },
};

module.exports = { config, CONFIG_FILE };
