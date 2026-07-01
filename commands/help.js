const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

function commandDescription(commands) {
  const slashLines = [...commands.values()].map((command) => {
    const json = command.data.toJSON();
    const prefix = command.prefixUsage ? `\nPrefix: ${command.prefixUsage.map((usage) => `\`${usage}\``).join(', ')}` : '';
    return `**/${json.name}** — ${json.description || 'No description'}${prefix}`;
  });

  return [
    'Use `.help` or `/help` to see this menu. Slash commands and listed prefix commands both work.',
    '',
    ...slashLines,
  ].join('\n') || 'No commands are loaded.';
}

function buildHelpEmbed(commands) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Allay commands')
    .setDescription(commandDescription(commands))
    .addFields({
      name: 'Giveaway prefix examples',
      value: [
        '`g.create 1h Nitro --winners 1`',
        '`.g.create 12h "Discord Nitro" --title "Weekend Giveaway" --description "Join below!"`',
        '`g.end <giveaway_id>`',
        '`g.reroll <giveaway_id>`',
      ].join('\n'),
    })
    .setFooter({ text: `${commands.size} command(s) loaded` });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all loaded commands and their descriptions.'),
  prefixUsage: ['.help'],
  async execute(interaction) {
    const commands = interaction.client.commands || new Map();
    return interaction.reply({ embeds: [buildHelpEmbed(commands)], ephemeral: true });
  },
  async executePrefix(message, commands = new Map()) {
    return message.reply({ embeds: [buildHelpEmbed(commands)] });
  },
};
