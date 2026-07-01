const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_COMMANDS_PATH = path.join(__dirname, 'commands');

function walkJsFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkJsFiles(fullPath));
    if (entry.isFile() && entry.name.endsWith('.js')) files.push(fullPath);
  }
  return files;
}

function getCommandJson(command) {
  if (typeof command?.data?.toJSON !== 'function') return null;
  try {
    return command.data.toJSON();
  } catch (error) {
    console.error('[commands] Failed to read command JSON:', error);
    return null;
  }
}

function loadCommands(commandsPath = DEFAULT_COMMANDS_PATH) {
  const commands = new Map();
  const resolvedCommandsPath = path.resolve(commandsPath);
  const commandFiles = walkJsFiles(resolvedCommandsPath);

  if (!fs.existsSync(resolvedCommandsPath)) {
    console.warn(`[commands] Commands directory does not exist: ${resolvedCommandsPath}`);
  } else if (!commandFiles.length) {
    console.warn(`[commands] No .js command files found in: ${resolvedCommandsPath}`);
  }

  for (const filePath of commandFiles) {
    const relativePath = path.relative(__dirname, filePath);
    try {
      delete require.cache[require.resolve(filePath)];
      const command = require(filePath);
      const commandJson = getCommandJson(command);
      const commandName = command?.data?.name || commandJson?.name;
      const commandDescription = command?.data?.description || commandJson?.description || 'No description';

      if (!commandName || typeof command.execute !== 'function') {
        console.warn(`[commands] Skipped ${relativePath}: missing command name or execute().`);
        continue;
      }

      commands.set(commandName, command);
      console.log(`[commands] Loaded /${commandName} from ${relativePath} - ${commandDescription}`);
    } catch (error) {
      console.error(`[commands] Failed to load ${relativePath}:`, error);
    }
  }

  console.log(`[commands] ${commands.size}/${commandFiles.length} command file(s) loaded from ${resolvedCommandsPath}.`);
  return commands;
}

module.exports = { DEFAULT_COMMANDS_PATH, loadCommands, walkJsFiles };
