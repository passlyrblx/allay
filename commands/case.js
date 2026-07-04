const { EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const moderation = require('../case');

function requireWarnRole(interaction) {
  if (moderation.memberCanWarn(interaction.member)) return true;
  interaction.reply({ content: `Only members with <@&${moderation.WARN_ROLE_ID}> can use moderation commands.`, ephemeral: true });
  return false;
}

function formatCaseLine(entry) {
  const status = entry.removedAt ? 'removed' : 'active';
  const link = entry.link ? `\nLink: ${entry.link}` : '';
  const removed = entry.removedAt ? `\nRemoved by <@${entry.removedBy}>: ${entry.removeReason || 'No reason provided.'}` : '';
  return `**#${entry.id}** ${entry.action} (${status}) by ${entry.moderatorId ? `<@${entry.moderatorId}>` : 'automatic filter'}\nReason: ${entry.reason}${link}${removed}`;
}

async function warnUser(interaction) {
  const user = interaction.options.getUser('user', true);
  const reason = interaction.options.getString('reason', true);
  const caseEntry = await moderation.createCase({
    guild: interaction.guild,
    userId: user.id,
    moderatorId: interaction.user.id,
    action: 'warn',
    reason,
  });

  await user.send(`You have been warned in ${interaction.guild.name}.\nReason: ${reason}\nCase #${caseEntry.id}`).catch(() => null);
  return interaction.reply({ content: `Warned ${user} with case #${caseEntry.id}.`, ephemeral: true });
}

async function removeWarn(interaction) {
  const user = interaction.options.getUser('user', true);
  const caseId = interaction.options.getInteger('case_no', true);
  const reason = interaction.options.getString('reason', true);
  const removed = await moderation.removeCase({
    guild: interaction.guild,
    userId: user.id,
    caseId,
    moderatorId: interaction.user.id,
    reason,
  });

  if (!removed) return interaction.reply({ content: `No active case #${caseId} was found for ${user}.`, ephemeral: true });
  return interaction.reply({ content: `Removed case #${caseId} for ${user}.`, ephemeral: true });
}

async function listWarns(interaction) {
  const user = interaction.options.getUser('user', true);
  const cases = moderation.listCases(user.id, interaction.guildId).slice(0, 10);
  const embed = new EmbedBuilder()
    .setColor(0xffa500)
    .setTitle(`Moderation cases for ${user.tag}`)
    .setDescription(cases.length ? cases.map(formatCaseLine).join('\n\n') : 'No cases found.')
    .setFooter({ text: cases.length ? 'Showing newest 10 cases.' : 'No moderation history.' });
  return interaction.reply({ embeds: [embed], ephemeral: true });
}

async function banUser(interaction) {
  const user = interaction.options.getUser('user');
  const userId = interaction.options.getString('user_id') || user?.id;
  const reason = interaction.options.getString('reason', true);
  if (!userId) return interaction.reply({ content: 'Provide either a user or user_id to ban.', ephemeral: true });

  await interaction.guild.members.ban(userId, { reason: `${reason} | Banned by ${interaction.user.tag}` });
  const caseEntry = await moderation.createCase({
    guild: interaction.guild,
    userId,
    moderatorId: interaction.user.id,
    action: 'ban',
    reason,
  });
  return interaction.reply({ content: `Banned <@${userId}> with case #${caseEntry.id}.`, ephemeral: true });
}

async function unbanUser(interaction) {
  const userId = interaction.options.getString('user_id', true);
  const reason = interaction.options.getString('reason', true);
  await interaction.guild.members.unban(userId, `${reason} | Unbanned by ${interaction.user.tag}`);
  const caseEntry = await moderation.createCase({
    guild: interaction.guild,
    userId,
    moderatorId: interaction.user.id,
    action: 'unban',
    reason,
  });
  return interaction.reply({ content: `Unbanned <@${userId}> with case #${caseEntry.id}.`, ephemeral: true });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn users and manage moderation cases.')
    .setDMPermission(false)
    .addSubcommand((subcommand) => subcommand
      .setName('user')
      .setDescription('Warn a user.')
      .addUserOption((option) => option.setName('user').setDescription('User to warn.').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for the warning.').setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('remove')
      .setDescription('Remove an active moderation case from a user.')
      .addUserOption((option) => option.setName('user').setDescription('User whose case should be removed.').setRequired(true))
      .addIntegerOption((option) => option.setName('case_no').setDescription('Case number to remove.').setRequired(true).setMinValue(1))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for removing the case.').setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('list')
      .setDescription('List moderation cases for a user.')
      .addUserOption((option) => option.setName('user').setDescription('User to view cases for.').setRequired(true)))
    .addSubcommand((subcommand) => subcommand
      .setName('ban')
      .setDescription('Ban a user or user ID, even if they are not in the server.')
      .addStringOption((option) => option.setName('reason').setDescription('Reason for the ban.').setRequired(true))
      .addUserOption((option) => option.setName('user').setDescription('User to ban.').setRequired(false))
      .addStringOption((option) => option.setName('user_id').setDescription('User ID to ban.').setRequired(false)))
    .addSubcommand((subcommand) => subcommand
      .setName('unban')
      .setDescription('Unban a user by ID.')
      .addStringOption((option) => option.setName('user_id').setDescription('User ID to unban.').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for the unban.').setRequired(true))),
  async execute(interaction) {
    if (!requireWarnRole(interaction)) return;

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === 'user') return warnUser(interaction);
    if (subcommand === 'remove') return removeWarn(interaction);
    if (subcommand === 'list') return listWarns(interaction);
    if (subcommand === 'ban') return banUser(interaction);
    if (subcommand === 'unban') return unbanUser(interaction);
    return interaction.reply({ content: 'Unknown moderation subcommand.', ephemeral: true });
  },
};
