const fs = require('node:fs');
const path = require('node:path');

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

function loadCommands(commandsPath = path.join(__dirname, 'commands')) {
  const commands = new Map();
  const commandFiles = walkJsFiles(commandsPath);

  for (const filePath of commandFiles) {
    const relativePath = path.relative(__dirname, filePath);
    try {
      delete require.cache[require.resolve(filePath)];
      const command = require(filePath);
      if (!command?.data?.name || typeof command.execute !== 'function') {
        console.warn(`[commands] Skipped ${relativePath}: missing data.name or execute().`);
        continue;
      }

      commands.set(command.data.name, command);
      const description = command.data.description || command.data.toJSON?.().description || 'No description';
      console.log(`[commands] Loaded /${command.data.name} from ${relativePath} - ${description}`);
    } catch (error) {
      console.error(`[commands] Failed to load ${relativePath}:`, error);
    }
  }

  console.log(`[commands] ${commands.size}/${commandFiles.length} command file(s) loaded.`);
  return commands;
}

module.exports = { loadCommands, walkJsFiles };
