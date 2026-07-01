const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleGiveawayCommand } = require('../giveawayManager');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Create, end, edit with buttons, and reroll persistent giveaways.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub
      .setName('create')
      .setDescription('Create a persistent giveaway with optional image and message entries.')
      .addStringOption((option) => option.setName('prize').setDescription('Prize to give away.').setRequired(true))
      .addStringOption((option) => option.setName('duration').setDescription('Duration like 30m, 12h, or 7d.').setRequired(true))
      .addIntegerOption((option) => option.setName('winners').setDescription('Number of winners.').setMinValue(1).setMaxValue(25))
      .addStringOption((option) => option.setName('title').setDescription('Giveaway embed title.'))
      .addStringOption((option) => option.setName('description').setDescription('Giveaway embed description.'))
      .addStringOption((option) => option.setName('image').setDescription('Image URL for the giveaway embed.'))
      .addBooleanOption((option) => option.setName('message_entries').setDescription('Let messages in this channel add entries.'))
      .addIntegerOption((option) => option.setName('entries_per_message').setDescription('Entries added per message.').setMinValue(1).setMaxValue(25)))
    .addSubcommand((sub) => sub
      .setName('end')
      .setDescription('End a giveaway immediately by ID.')
      .addStringOption((option) => option.setName('id').setDescription('Giveaway ID from the embed footer.').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('reroll')
      .setDescription('Reroll giveaway winners and post winner user IDs.')
      .addStringOption((option) => option.setName('id').setDescription('Giveaway ID from the embed footer.').setRequired(true))),
  async execute(interaction) {
    return handleGiveawayCommand(interaction);
  },
};
