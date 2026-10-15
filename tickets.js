const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
} = require('discord.js');
const database = require('./database');

const ticketCategories = [
  { label: 'Staff Apply', value: 'staff-apply', description: 'Apply to join the server team' },
  { label: 'Support', value: 'support', description: 'Get help from the staff team' },
  { label: 'Report', value: 'report', description: 'Privately report a concern' },
  { label: 'General', value: 'general', description: 'Ask a general question' },
];

async function hasStaffAccess(interaction) {
  if (!interaction.guild || !interaction.member) return false;
  if (interaction.user.id === interaction.guild.ownerId) return true;
  const roleIds = JSON.parse(database.getSetting(interaction.guild.id, 'ticket_close_roles') || '[]');
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  return roleIds.some((roleId) => member?.roles.cache.has(roleId));
}

function createCloseRoleSelector() {
  const selector = new RoleSelectMenuBuilder()
    .setCustomId('tickets:roles')
    .setPlaceholder('Choose roles allowed to close tickets')
    .setMinValues(1)
    .setMaxValues(25);
  return new ActionRowBuilder().addComponents(selector);
}

async function updateOpenTicketRoles(guild, roleIds, botUserId) {
  const selectedRoles = new Set(roleIds);
  for (const ticket of database.getOpenTickets(guild.id)) {
    const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
    if (!channel?.isTextBased()) {
      database.closeTicket(ticket.channel_id);
      continue;
    }
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
      if (overwrite.type === 0
        && overwrite.id !== guild.id
        && overwrite.id !== botUserId
        && !selectedRoles.has(overwrite.id)) {
        await channel.permissionOverwrites.delete(overwrite.id, 'Update ticket close-role configuration');
      }
    }
    for (const roleId of roleIds) {
      await channel.permissionOverwrites.edit(roleId, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
      }, { reason: 'Update ticket close-role configuration' });
    }
  }
}

function createPanel() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('tickets:open')
    .setPlaceholder('Choose a ticket topic')
    .addOptions(ticketCategories);
  const embed = new EmbedBuilder()
    .setColor(0x287d74)
    .setTitle('Community Support')
    .setDescription('Choose a topic below to open your private support channel. A team member will follow up there.')
    .setFooter({ text: 'Private support • Staff can reply in your ticket channel' });
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(menu)] };
}

async function openTicket(interaction) {
  const guild = interaction.guild;
  const closeRoleIds = JSON.parse(database.getSetting(guild.id, 'ticket_close_roles') || '[]')
    .filter((roleId) => guild.roles.cache.has(roleId));
  if (closeRoleIds.length === 0) {
    await interaction.reply({ content: 'Ticket setup is incomplete. The server owner must run `/ticket-setup` and select at least one close-role.', ephemeral: true });
    return;
  }
  const current = database.getActiveTicket(guild.id, interaction.user.id);
  if (current) {
    const existingChannel = await guild.channels.fetch(current.channel_id).catch(() => null);
    if (existingChannel) {
      await interaction.reply({ content: `You already have an open ticket: <#${current.channel_id}>`, ephemeral: true });
      return;
    }
    database.closeTicket(current.channel_id);
  }

  const category = interaction.values[0];
  const profile = database.getProfile(guild.id, interaction.user.id);
  const experience = profile?.experience ?? 0;
  const level = Math.floor(Math.sqrt(experience / 100));
  const muteCount = database.getMuteCount(guild.id, interaction.user.id);
  const channel = await guild.channels.create({
    name: `ticket-${category}-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90),
    type: 0,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
      ...closeRoleIds.map((roleId) => ({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
      })),
      { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    ],
    reason: `Ticket opened by ${interaction.user.tag}: ${category}`,
  });
  database.createTicket(channel.id, guild.id, interaction.user.id, category);
  const closeButton = new ButtonBuilder()
    .setCustomId('tickets:close')
    .setLabel('Close ticket')
    .setStyle(ButtonStyle.Danger);
  await channel.send({
    content: `<@${interaction.user.id}> ${closeRoleIds.map((roleId) => `<@&${roleId}>`).join(' ')}`,
    embeds: [new EmbedBuilder()
      .setColor(0x287d74)
      .setTitle(`${category.replaceAll('-', ' ')} ticket`)
      .setDescription('Please describe your request. A staff member will reply in this private channel.')
      .setThumbnail(interaction.user.displayAvatarURL())
      .addFields(
        { name: 'Opened by', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Level', value: `**${level}**`, inline: true },
        { name: 'Experience', value: `**${experience.toLocaleString()} XP**`, inline: true },
        { name: 'Recorded mutes', value: `**${muteCount}**`, inline: true },
      )
      .setTimestamp()],
    components: [new ActionRowBuilder().addComponents(closeButton)],
  });
  await interaction.reply({ content: `Your private ticket is ready: ${channel}`, ephemeral: true });
}

async function closeTicket(interaction) {
  if (!await hasStaffAccess(interaction)) {
    await interaction.reply({ content: 'Only configured staff can close tickets.', ephemeral: true });
    return;
  }
  const ticket = database.getTicket(interaction.channelId, interaction.guildId);
  if (!ticket || ticket.status !== 'open') {
    await interaction.reply({ content: 'This channel is not an open ticket.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  try {
    await interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`);
    database.closeTicket(interaction.channelId);
    await interaction.editReply('Ticket closed. This chat channel has been deleted.');
  } catch (error) {
    console.error('Ticket closure failed:', error);
    await interaction.editReply('The ticket could not be deleted. Check the bot’s Manage Channels permission and try again.');
  }
}

async function handleInteraction(interaction) {
  if (interaction.isRoleSelectMenu() && interaction.customId === 'tickets:roles') {
    if (interaction.user.id !== interaction.guild?.ownerId) {
      await interaction.reply({ content: 'Only this server’s actual owner can select ticket close-roles.', ephemeral: true });
      return;
    }
    const selectedRoleIds = interaction.values.filter((roleId) => roleId !== interaction.guildId);
    await updateOpenTicketRoles(interaction.guild, selectedRoleIds, interaction.client.user.id);
    database.setSetting(interaction.guildId, 'ticket_close_roles', JSON.stringify(selectedRoleIds));
    const selectedRoles = selectedRoleIds.map((roleId) => `<@&${roleId}>`).join(', ');
    await interaction.reply({ content: `Ticket close-roles saved: ${selectedRoles}. Only these roles and the server owner can close tickets.`, ephemeral: true });
  } else if (interaction.isStringSelectMenu() && interaction.customId === 'tickets:open') {
    await openTicket(interaction);
  } else if (interaction.isButton() && interaction.customId === 'tickets:close') {
    await closeTicket(interaction);
  }
}

module.exports = { createCloseRoleSelector, createPanel, handleInteraction };