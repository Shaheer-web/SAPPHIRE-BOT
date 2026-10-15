const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('ticket-setup')
    .setDescription('Post the ticket panel and choose multiple roles allowed to close tickets')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('clear-channel')
    .setDescription('Delete every message in this channel after owner confirmation')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder()
    .setName('member-role')
    .setDescription('Choose the role automatically given to new members')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption((option) => option.setName('role').setDescription('Role to assign to new members').setRequired(true)),
  new SlashCommandBuilder()
    .setName('welcome-channel')
    .setDescription('Send both welcome and goodbye messages in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) => option.setName('channel').setDescription('Channel for join and leave messages').setRequired(true)
      .addChannelTypes(ChannelType.GuildText)),
  new SlashCommandBuilder()
    .setName('mod-log')
    .setDescription('Choose where moderation actions are logged')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) => option.setName('channel').setDescription('Moderation log channel').setRequired(true)
      .addChannelTypes(ChannelType.GuildText)),
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Issue a warning to a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option.setName('user').setDescription('Member to warn').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the warning').setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View a member’s warning history')
    .addUserOption((option) => option.setName('user').setDescription('Member to inspect').setRequired(true)),
  new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Timeout a member')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option.setName('user').setDescription('Member to timeout').setRequired(true))
    .addIntegerOption((option) => option.setName('minutes').setDescription('Timeout duration in minutes').setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the timeout').setRequired(true).setMaxLength(500)),
  new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Remove a member timeout')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option.setName('user').setDescription('Member to untimeout').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for removing the timeout').setRequired(false).setMaxLength(500)),
  new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Assign an eligible role and log the promotion')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((option) => option.setName('user').setDescription('Member to promote').setRequired(true))
    .addRoleOption((option) => option.setName('role').setDescription('Role to assign').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Optional announcement details').setRequired(false).setMaxLength(500)),
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member from this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) => option.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason for the ban').setRequired(true).setMaxLength(500))
    .addIntegerOption((option) => option.setName('delete-message-seconds').setDescription('Delete recent messages (0 to 604800 seconds)').setRequired(false).setMinValue(0).setMaxValue(604800)),
  new SlashCommandBuilder()
    .setName('mod-dashboard')
    .setDescription('View recent warning counts and active timeouts'),
  new SlashCommandBuilder()
    .setName('profile')
    .setDescription('View your Sapphire level, experience, and server activity')
    .addUserOption((option) => option.setName('user').setDescription('Member profile to view').setRequired(false)),
  new SlashCommandBuilder()
    .setName('about')
    .setDescription('Learn about Sapphire BOT and its commands'),
  new SlashCommandBuilder()
    .setName('song')
    .setDescription('Search Spotify and privately show matching tracks')
    .addStringOption((option) => option.setName('query').setDescription('Song title or artist').setRequired(true).setMinLength(1).setMaxLength(100)),
  new SlashCommandBuilder()
    .setName('say')
    .setDescription('Post custom text and an optional image or GIF in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) => option.setName('message').setDescription('Text to post; optional if you attach an image').setRequired(false).setMaxLength(1800))
    .addAttachmentOption((option) => option.setName('image').setDescription('Optional PNG, JPEG, WebP, or GIF image').setRequired(false)),
  new SlashCommandBuilder()
    .setName('autoresponse')
    .setDescription('Manage custom keyword replies')
    .addSubcommand((subcommand) => subcommand
      .setName('add')
      .setDescription('Add or replace an automatic reply')
      .addStringOption((option) => option.setName('trigger').setDescription('Word or phrase that triggers the reply').setRequired(true).setMinLength(1).setMaxLength(100))
      .addStringOption((option) => option.setName('response').setDescription('Reply text; leave empty to send only an image').setRequired(false).setMaxLength(1800))
      .addAttachmentOption((option) => option.setName('image').setDescription('Optional PNG, JPEG, GIF, or WebP image').setRequired(false)))
    .addSubcommand((subcommand) => subcommand
      .setName('remove')
      .setDescription('Remove a custom keyword reply')
      .addStringOption((option) => option.setName('trigger').setDescription('Trigger to remove').setRequired(true).setMinLength(1).setMaxLength(100)))
    .addSubcommand((subcommand) => subcommand
      .setName('list')
      .setDescription('List this server’s custom keyword replies')),
];

module.exports = commands;