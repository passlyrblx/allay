const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all loaded commands and their descriptions.'),
  async execute(interaction) {
    const commands = interaction.client.commands || new Map();
    const description = [...commands.values()]
      .map((command) => {
        const json = command.data.toJSON();
        return `**/${json.name}** — ${json.description || 'No description'}`;
      })
      .join('\n') || 'No commands are loaded.';

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('Allay commands')
      .setDescription(description)
      .setFooter({ text: `${commands.size} command(s) loaded` });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
