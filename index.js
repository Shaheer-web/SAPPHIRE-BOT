require('dotenv').config();

const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  ActionRowBuilder,
  ActivityType,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
} = require('discord.js');
const { Filter } = require('bad-words');
const database = require('./database');
const commands = require('./commands');
const tickets = require('./tickets');
const customResponseDirectory = path.join(
  path.dirname(path.resolve(process.env.DATABASE_PATH || './data/bot.sqlite')),
  'auto-responses',
);

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error('DISCORD_TOKEN is missing. Copy .env.example to .env and add your bot token.');

const lockFile = path.join(__dirname, '..', '.bot.lock');

async function isProcessRunning(pid) {
  try {
    const output = execFileSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return String(output).includes(`"${pid}"`);
  } catch {
    return false;
  }
}

async function acquireBotLock() {
  while (true) {
    try {
      const handle = await fs.open(lockFile, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existingPidText = await fs.readFile(lockFile, 'utf8').catch(() => '');
      const existingPid = Number.parseInt(existingPidText, 10);
      if (!Number.isInteger(existingPid) || existingPid <= 0) {
        await fs.rm(lockFile, { force: true }).catch(() => {});
        continue;
      }
      const isRunning = await isProcessRunning(existingPid);
      if (!isRunning) {
        await fs.rm(lockFile, { force: true }).catch(() => {});
        continue;
      }
      console.error(`Another Sapphire BOT instance is already running (PID ${existingPid}). Exiting to prevent duplicate messages.`);
      process.exit(1);
    }
  }
}

async function releaseBotLock() {
  const lockPid = await fs.readFile(lockFile, 'utf8').catch(() => '');
  if (lockPid === String(process.pid)) await fs.rm(lockFile, { force: true }).catch(() => {});
}

process.on('SIGINT', async () => {
  await releaseBotLock();
  process.exit(0);
});
process.on('SIGTERM', async () => {
  await releaseBotLock();
  process.exit(0);
});
process.on('exit', () => {
  try {
    if (fsSync.readFileSync(lockFile, 'utf8') === String(process.pid)) {
      fsSync.rmSync(lockFile, { force: true });
    }
  } catch {
    // Ignore cleanup errors during process exit.
  }
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const links = [
  { keyword: 'AI', url: process.env.AI_LINK },
  { keyword: 'Website', url: process.env.WEBSITE_LINK },
  { keyword: 'Launcher', url: process.env.LAUNCHER_LINK },
].filter((item) => item.url);
const badWords = (process.env.BAD_WORDS || '')
  .split(',')
  .map((word) => word.trim().toLocaleLowerCase())
  .filter(Boolean);
const englishProfanityFilter = new Filter();
let spotifyAccessToken = null;
let spotifyTokenExpiresAt = 0;

async function getSpotifyAccessToken() {
  if (spotifyAccessToken && spotifyTokenExpiresAt > Date.now()) return spotifyAccessToken;
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Spotify API credentials are not configured.');

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
  });
  if (!response.ok) throw new Error(`Spotify authentication failed (${response.status}).`);

  const result = await response.json();
  spotifyAccessToken = result.access_token;
  spotifyTokenExpiresAt = Date.now() + Math.max(0, result.expires_in - 60) * 1000;
  return spotifyAccessToken;
}

async function searchSpotifyTracks(query) {
  const accessToken = await getSpotifyAccessToken();
  const search = new URLSearchParams({ q: query, type: 'track', limit: '5' });
  const response = await fetch(`https://api.spotify.com/v1/search?${search}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Spotify search failed (${response.status}).`);
  const result = await response.json();
  return result.tracks?.items ?? [];
}

function isConfiguredStaff(member, guildId) {
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)
    || member.permissions.has(PermissionFlagsBits.ModerateMembers)) return true;
  return ['staff', 'admin', 'owner'].some((setting) => {
    const roleId = database.getSetting(guildId, `role_${setting}`);
    return roleId && member.roles.cache.has(roleId);
  });
}

function getConfiguredChannel(guild, setting) {
  const channelId = database.getSetting(guild.id, `channel_${setting}`);
  return channelId ? guild.channels.cache.get(channelId) || null : null;
}

async function sendEmbed(guild, setting, embed) {
  const channel = getConfiguredChannel(guild, setting);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed] }).catch((error) => console.error(`Could not send to ${setting}:`, error));
}

async function logModeration(guild, title, description, color = 0xd98a48) {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp();
  await sendEmbed(guild, 'moderation', embed);
}

function findBadWord(content) {
  if (englishProfanityFilter.isProfane(content)) return 'English profanity filter';
  const normalized = ` ${content.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  return badWords.find((word) => {
    const normalizedWord = word.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return normalizedWord && normalized.includes(` ${normalizedWord} `);
  });
}

async function issueWarning(guild, userId, moderatorId, reason) {
  const count = database.addWarning(guild.id, userId, moderatorId, reason);
  await logModeration(
    guild,
    'Warning issued',
    `Member: <@${userId}>\nModerator: <@${moderatorId}>\nReason: ${reason}\nWarnings: **${count}**`,
  );

  return count;
}

function canConfigure(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator)
    || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

async function showDashboard(interaction) {
  const warnings = database.getWarningSummary(interaction.guildId);
  const members = await interaction.guild.members.fetch({ limit: 1000 }).catch(() => interaction.guild.members.cache);
  const muted = [...members.values()].filter((member) => member.communicationDisabledUntilTimestamp > Date.now());
  const warningText = warnings.length
    ? warnings.map((item) => `<@${item.user_id}>: **${item.count}** warning(s)`).join('\n')
    : 'No warnings recorded.';
  const mutedText = muted.length
    ? muted.slice(0, 15).map((member) => `<@${member.id}> until <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`).join('\n')
    : 'No active timeouts found in the fetched members.';
  await interaction.reply({
    embeds: [new EmbedBuilder()
      .setColor(0x287d74)
      .setTitle('Moderation dashboard')
      .addFields(
        { name: 'Warnings by member', value: warningText.slice(0, 1024) },
        { name: 'Active timeouts', value: mutedText.slice(0, 1024) },
      )
      .setTimestamp()],
    ephemeral: true,
  });
}

function createProfileEmbed(user, member, profile, guild) {
  const experience = profile?.experience ?? 0;
  const level = Math.floor(Math.sqrt(experience / 100));
  const levelStart = level ** 2 * 100;
  const nextLevel = (level + 1) ** 2 * 100;
  const progress = experience - levelStart;
  const required = nextLevel - levelStart;
  const filled = Math.min(12, Math.floor((progress / required) * 12));
  const progressBar = `${'▰'.repeat(filled)}${'▱'.repeat(12 - filled)}`;
  const joinedAt = member?.joinedTimestamp
    ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:D>`
    : 'Not available';

  return new EmbedBuilder()
    .setColor(0x176fc1)
    .setAuthor({ name: `${user.globalName || user.username} • Sapphire Profile`, iconURL: user.displayAvatarURL() })
    .setThumbnail(user.displayAvatarURL({ size: 256 }))
    .setDescription(`A snapshot of <@${user.id}> in **${guild.name}**`)
    .addFields(
      { name: 'Level', value: `**${level}**`, inline: true },
      { name: 'Experience', value: `**${experience.toLocaleString()} XP**`, inline: true },
      { name: 'Messages', value: `**${(profile?.message_count ?? 0).toLocaleString()}**`, inline: true },
      { name: 'Next level', value: `${progressBar}\n${progress.toLocaleString()} / ${required.toLocaleString()} XP`, inline: false },
      { name: 'Member since', value: joinedAt, inline: true },
      { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:D>`, inline: true },
      { name: 'Recorded mutes', value: `**${database.getMuteCount(guild.id, user.id)}**`, inline: true },
    )
    .setFooter({ text: 'Earn 10 XP for an active message once per minute.' })
    .setTimestamp();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findAutoResponse(guildId, content) {
  return database.getAutoResponses(guildId).find(({ trigger }) => {
    const pattern = `(^|[^\\p{L}\\p{N}_])${escapeRegExp(trigger)}(?=$|[^\\p{L}\\p{N}_])`;
    return new RegExp(pattern, 'iu').test(content);
  }) || null;
}

async function saveResponseImage(attachment, guildId) {
  const extensions = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
  };
  const contentType = attachment.contentType?.split(';')[0].toLocaleLowerCase();
  const extension = extensions[contentType];
  const maxBytes = 8 * 1024 * 1024;
  if (!extension || attachment.size > maxBytes) {
    throw new Error('Upload a PNG, JPEG, GIF, or WebP image smaller than 8 MB.');
  }
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error('Discord image could not be downloaded.');
  const image = Buffer.from(await response.arrayBuffer());
  if (image.length > maxBytes) throw new Error('Image must be smaller than 8 MB.');
  await fs.mkdir(customResponseDirectory, { recursive: true });
  const imagePath = path.join(customResponseDirectory, `${guildId}-${randomUUID()}.${extension}`);
  await fs.writeFile(imagePath, image);
  return imagePath;
}

async function handleAutoResponseCommand(interaction) {
  if (interaction.user.id !== interaction.guild.ownerId) {
    await interaction.reply({ content: 'Only this server’s actual owner can manage custom replies.', ephemeral: true });
    return;
  }
  await interaction.deferReply({ ephemeral: true });
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'add') {
    const trigger = interaction.options.getString('trigger', true).trim();
    const response = interaction.options.getString('response')?.trim() || '';
    const attachment = interaction.options.getAttachment('image');
    if (!response && !attachment) {
      await interaction.editReply('Add reply text, an image, or both.');
      return;
    }
    const existing = database.getAutoResponse(interaction.guildId, trigger);
    let imagePath = null;
    try {
      if (attachment) imagePath = await saveResponseImage(attachment, interaction.guildId);
      database.setAutoResponse(interaction.guildId, trigger, response, imagePath);
      if (existing?.image_path && existing.image_path !== imagePath) {
        await fs.rm(existing.image_path, { force: true }).catch(() => {});
      }
      await interaction.editReply(`Auto-response saved for **${trigger}**.`);
    } catch (error) {
      if (imagePath) await fs.rm(imagePath, { force: true }).catch(() => {});
      throw error;
    }
  } else if (subcommand === 'remove') {
    const trigger = interaction.options.getString('trigger', true);
    const removed = database.deleteAutoResponse(interaction.guildId, trigger);
    if (removed?.image_path) await fs.rm(removed.image_path, { force: true }).catch(() => {});
    await interaction.editReply(
      removed ? `Removed auto-response for **${trigger}**.` : `No auto-response found for **${trigger}**.`,
    );
  } else {
    const responses = database.getAutoResponses(interaction.guildId);
    const description = responses.length
      ? responses.map((item) => `• **${item.trigger}** → ${item.response || '[image reply]'}`).join('\n').slice(0, 4000)
      : 'No custom replies configured.';
    await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0x176fc1).setTitle('Sapphire Auto-Responses').setDescription(description)] });
  }
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Ready as ${readyClient.user.tag}`);
  readyClient.user.setActivity('Sapphire profiles • /profile', { type: ActivityType.Watching });
});

client.on(Events.GuildMemberAdd, async (member) => {
  const memberRoleId = database.getSetting(member.guild.id, 'role_member');
  if (memberRoleId) {
    await member.roles.add(memberRoleId, 'Automatic member role').catch((error) => console.error('Could not assign member role:', error));
  }
  const welcome = getConfiguredChannel(member.guild, 'welcome')
    || member.guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && channel.name.toLocaleLowerCase() === 'general');
  if (welcome?.isTextBased()) {
    await welcome.send({ embeds: [new EmbedBuilder()
      .setColor(0x176fc1)
      .setAuthor({ name: 'Sapphire BOT • Community Welcome', iconURL: client.user.displayAvatarURL() })
      .setTitle(`Welcome to the team, ${member.user.globalName || member.user.username}!`)
      .setDescription(`**<@${member.id}> just joined us. The team feels complete now!**\n\nMake yourself at home and say hello to everyone.`)
      .setThumbnail(member.user.displayAvatarURL())
      .addFields({ name: 'You are member', value: `**${member.guild.memberCount}**`, inline: true })
      .setFooter({ text: `${member.guild.name} • We are glad you are here` })
      .setTimestamp()] }).catch((error) => console.error('Could not send welcome:', error));
  }
});

client.on(Events.GuildCreate, async (guild) => {
  const owner = await guild.fetchOwner().catch(() => null);
  if (!owner) return;
  const guide = new EmbedBuilder()
    .setColor(0x176fc1)
    .setTitle('Sapphire BOT is ready')
    .setDescription(`Thanks for adding Sapphire BOT to **${guild.name}**. Here are the commands to get started.`)
    .addFields(
      { name: 'Set up', value: '`/ticket-setup` (server owner only)\n`/member-role`\n`/welcome-channel`\n`/mod-log`' },
      { name: 'Tickets and safety', value: '`/ticket-setup` posts the panel; any member can create Staff Apply, Support, Report, or General tickets. The owner selects multiple roles that can close them.\n`/clear-channel` permanently clears a channel and is owner-only.' },
      { name: 'Moderation', value: '`/warn` • `/warnings` • `/mute` • `/unmute` • `/ban` • `/promote` • `/mod-dashboard`' },
      { name: 'Community', value: '`/profile` • `/about` • `/say` (owner only) • `/autoresponse` (owner only)' },
      { name: 'Music', value: '`/song query` privately shows Spotify matches with links to play in your Spotify app.' },
      { name: 'First steps', value: '1. Give Sapphire BOT the required permissions and move its role above the Member role.\n2. Set `BAD_WORDS` in the bot environment for profanity filtering.\n3. Run `/member-role`, `/welcome-channel`, and `/mod-log`.\n4. The server owner runs `/ticket-setup` in the panel channel and selects one or more ticket-closing roles.' },
    )
    .setFooter({ text: 'Sapphire BOT • Configured separately for every server' });
  await owner.send({ embeds: [guide] }).catch(async () => {
    if (guild.systemChannel?.isTextBased()) {
      await guild.systemChannel.send({ content: `<@${owner.id}>`, embeds: [guide], allowedMentions: { users: [owner.id] } }).catch(() => {});
    }
  });
});

client.on(Events.GuildMemberRemove, async (member) => {
  const goodbye = getConfiguredChannel(member.guild, 'welcome');
  if (!goodbye?.isTextBased()) return;
  await goodbye.send({ embeds: [new EmbedBuilder()
    .setColor(0x53636f)
    .setTitle('A member has left')
    .setDescription(`**${member.user.tag}** has left the community.`)
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp()] }).catch((error) => console.error('Could not send goodbye:', error));
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;
  const badWord = findBadWord(message.content);
  if (badWord) {
    try {
      await message.delete();
    } catch (error) {
      console.error('Could not delete filtered message:', error);
      return;
    }
    await message.channel.send({ content: `<@${message.author.id}> Your message was removed for violating the server language rules.` })
      .then((warning) => setTimeout(() => warning.delete().catch(() => {}), 10_000))
      .catch((error) => console.error('Could not send filter warning:', error));
    const incidentCount = database.addFilterIncident(message.guild.id, message.author.id);
    await issueWarning(message.guild, message.author.id, client.user.id, `Automatic language filter (${badWord})`);
    if (incidentCount >= 5) {
      const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
      if (member?.moderatable) {
        const muteDuration = 10 * 60 * 1000;
        const muteUntil = Date.now() + muteDuration;
        const muteApplied = await member.timeout(muteDuration, 'Five or more filtered profanity violations').then(() => true).catch((error) => {
          console.error(`Could not automatically timeout ${message.author.id}:`, error);
          return false;
        });
        if (muteApplied) {
          const muteCount = database.recordMute(message.guild.id, message.author.id);
          await logModeration(
            message.guild,
            'Automatic 10-minute mute',
            `Member: <@${message.author.id}>\nFiltered messages: **${incidentCount}**\nTotal mutes: **${muteCount}**\nUntil: <t:${Math.floor(muteUntil / 1000)}:F>`,
            0xc65353,
          );
        }
      }
    }
    return;
  }

  if (message.content.trim().length >= 5) database.recordActivity(message.guild.id, message.author.id);

  const autoResponse = findAutoResponse(message.guild.id, message.content);
  if (autoResponse) {
    const payload = { allowedMentions: { parse: [] } };
    if (autoResponse.response) payload.content = autoResponse.response;
    if (autoResponse.image_path) {
      try {
        await fs.access(autoResponse.image_path);
        payload.files = [{ attachment: autoResponse.image_path }];
      } catch {
        console.error(`Custom response image is missing: ${autoResponse.image_path}`);
      }
    }
    if (payload.content || payload.files) await message.channel.send(payload);
    return;
  }

  const content = message.content.toLocaleLowerCase();
  const match = links.find(({ keyword }) => new RegExp(`(^|[^\\p{L}\\p{N}])${keyword}([^\\p{L}\\p{N}]|$)`, 'iu').test(content));
  if (match) await message.reply({ content: `${match.keyword}: ${match.url}`, allowedMentions: { repliedUser: false } });
});

const clearConfirmations = new Map();

async function clearChannelMessages(channel) {
  const oldMessageCutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  let deletedCount = 0;
  let before;
  while (true) {
    const messages = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (messages.size === 0) break;
    before = messages.last().id;
    const recentMessages = messages.filter((message) => message.createdTimestamp >= oldMessageCutoff);
    const oldMessages = messages.filter((message) => message.createdTimestamp < oldMessageCutoff);
    if (recentMessages.size > 0) {
      const deleted = await channel.bulkDelete(recentMessages, true);
      deletedCount += deleted.size;
    }
    for (const message of oldMessages.values()) {
      try {
        await message.delete();
        deletedCount += 1;
      } catch (error) {
        if (error.code !== 10008) throw error;
      }
    }
    if (messages.size < 100) break;
  }
  return deletedCount;
}

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isButton() && interaction.customId.startsWith('clear-channel:')) {
      const [, action, confirmationId] = interaction.customId.split(':');
      const confirmation = clearConfirmations.get(confirmationId);
      if (interaction.user.id !== interaction.guild?.ownerId) {
        await interaction.reply({ content: 'Only this server’s actual owner can clear channel messages.', ephemeral: true });
        return;
      }
      if (!confirmation || confirmation.expiresAt < Date.now() || confirmation.channelId !== interaction.channelId) {
        clearConfirmations.delete(confirmationId);
        await interaction.update({ content: 'This confirmation expired. Run `/clear-channel` again.', components: [] });
        return;
      }
      clearConfirmations.delete(confirmationId);
      if (action === 'cancel') {
        await interaction.update({ content: 'Channel cleanup cancelled.', components: [] });
        return;
      }
      await interaction.deferUpdate();
      try {
        const deletedCount = await clearChannelMessages(interaction.channel);
        await interaction.editReply({ content: `Deleted ${deletedCount} message(s) from this channel.`, components: [] });
      } catch (error) {
        console.error('Channel cleanup failed:', error);
        await interaction.editReply({ content: 'Cleanup stopped because Discord rejected a delete request. Some messages may already have been removed; check the bot’s Manage Messages permission.', components: [] });
      }
      return;
    }
    if (interaction.isRoleSelectMenu() || interaction.isStringSelectMenu() || interaction.isButton()) {
      await tickets.handleInteraction(interaction);
      return;
    }
    if (!interaction.isChatInputCommand() || !interaction.guild) return;

    if (['ticket-setup', 'clear-channel', 'say'].includes(interaction.commandName)
      && interaction.user.id !== interaction.guild.ownerId) {
      await interaction.reply({ content: 'Only the actual server owner can run this command. Roles do not grant access.', ephemeral: true });
      return;
    }
    if (['member-role', 'welcome-channel', 'mod-log'].includes(interaction.commandName)
      && !canConfigure(interaction.member)) {
      await interaction.reply({ content: 'You need Manage Server permission to configure this feature.', ephemeral: true });
      return;
    }
    const staffOnly = ['warn', 'warnings', 'mute', 'unmute', 'mod-dashboard'];
    if (staffOnly.includes(interaction.commandName) && !isConfiguredStaff(interaction.member, interaction.guildId)) {
      await interaction.reply({ content: 'You need the configured staff role or moderation permission to use this command.', ephemeral: true });
      return;
    }
    if (interaction.commandName === 'ban'
      && !interaction.member.permissions.has(PermissionFlagsBits.BanMembers)
      && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Ban Members permission is required to use this command.', ephemeral: true });
      return;
    }
    if (interaction.commandName === 'promote'
      && !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)
      && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: 'Manage Roles permission is required to use this command.', ephemeral: true });
      return;
    }

    if (interaction.commandName === 'ticket-setup') {
      await interaction.channel.send(tickets.createPanel());
      await interaction.reply({
        content: 'Ticket panel posted. Select one or more roles that can view and close tickets. Any server member can open a ticket.',
        components: [tickets.createCloseRoleSelector()],
        ephemeral: true,
      });
    } else if (interaction.commandName === 'clear-channel') {
      const confirmationId = interaction.id;
      clearConfirmations.set(confirmationId, {
        channelId: interaction.channelId,
        expiresAt: Date.now() + 60_000,
      });
      const expiryTimer = setTimeout(() => clearConfirmations.delete(confirmationId), 60_000);
      expiryTimer.unref?.();
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`clear-channel:confirm:${confirmationId}`).setLabel('Delete all messages').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`clear-channel:cancel:${confirmationId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
      );
      await interaction.reply({ content: 'This will permanently delete every message in this channel, including messages older than 14 days. Continue?', components: [buttons], ephemeral: true });
    } else if (interaction.commandName === 'member-role') {
      const role = interaction.options.getRole('role', true);
      if (!role.editable) {
        await interaction.reply({ content: 'Move the bot role above the selected Member role first.', ephemeral: true });
        return;
      }
      database.setSetting(interaction.guildId, 'role_member', role.id);
      await interaction.reply({ content: `New members will receive ${role}.`, ephemeral: true });
    } else if (interaction.commandName === 'welcome-channel') {
      const channel = interaction.options.getChannel('channel', true);
      database.setSetting(interaction.guildId, 'channel_welcome', channel.id);
      await interaction.reply({ content: `Welcome and goodbye messages will be sent in ${channel}.`, ephemeral: true });
    } else if (interaction.commandName === 'mod-log') {
      const channel = interaction.options.getChannel('channel', true);
      database.setSetting(interaction.guildId, 'channel_moderation', channel.id);
      await interaction.reply({ content: `Moderation events will be logged in ${channel}.`, ephemeral: true });
    } else if (interaction.commandName === 'warn') {
      const target = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      const count = await issueWarning(interaction.guild, target.id, interaction.user.id, reason);
      await interaction.reply({ content: `${target} has been warned. Total warnings: ${count}.`, ephemeral: true });
    } else if (interaction.commandName === 'warnings') {
      const target = interaction.options.getUser('user', true);
      const records = database.getWarnings(interaction.guildId, target.id);
      const description = records.length
        ? records.map((warning) => `• <t:${Math.floor(Date.parse(warning.created_at) / 1000)}:d> by <@${warning.moderator_id}>: ${warning.reason}`).join('\n')
        : 'No warnings recorded.';
      await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xd98a48).setTitle(`Warnings for ${target.tag}`).setDescription(description.slice(0, 4000))], ephemeral: true });
    } else if (interaction.commandName === 'mute') {
      const target = interaction.options.getMember('user');
      const user = interaction.options.getUser('user', true);
      const minutes = interaction.options.getInteger('minutes', true);
      const reason = interaction.options.getString('reason', true);
      if (!target?.moderatable) {
        await interaction.reply({ content: 'I cannot timeout that member. Check role hierarchy and bot permissions.', ephemeral: true });
        return;
      }
      await target.timeout(minutes * 60_000, reason);
      const muteCount = database.recordMute(interaction.guildId, user.id);
      await logModeration(interaction.guild, 'Member timed out', `Member: ${user}\nModerator: ${interaction.user}\nDuration: ${minutes} minute(s)\nTotal mutes: **${muteCount}**\nReason: ${reason}`, 0xc65353);
      await interaction.reply({ content: `${user} was timed out for ${minutes} minute(s).`, ephemeral: true });
    } else if (interaction.commandName === 'unmute') {
      const target = interaction.options.getMember('user');
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') || 'Timeout removed by staff';
      if (!target?.moderatable) {
        await interaction.reply({ content: 'I cannot edit that member. Check role hierarchy and bot permissions.', ephemeral: true });
        return;
      }
      await target.timeout(null, reason);
      await logModeration(interaction.guild, 'Member timeout removed', `Member: ${user}\nModerator: ${interaction.user}\nReason: ${reason}`, 0x287d74);
      await interaction.reply({ content: `Timeout removed for ${user}.`, ephemeral: true });
    } else if (interaction.commandName === 'promote') {
      const target = interaction.options.getMember('user');
      const user = interaction.options.getUser('user', true);
      const role = interaction.options.getRole('role', true);
      const reason = interaction.options.getString('reason');
      const actorCanManageRole = interaction.member.permissions.has(PermissionFlagsBits.Administrator)
        || interaction.member.roles.highest.comparePositionTo(role) > 0;
      if (!target || !role.editable || !actorCanManageRole) {
        await interaction.reply({ content: 'I cannot assign that role. Check role hierarchy and bot permissions.', ephemeral: true });
        return;
      }
      await target.roles.add(role, `Promotion by ${interaction.user.tag}`);
      const note = reason ? `\nDetails: ${reason}` : '';
      await logModeration(interaction.guild, 'Member promoted', `${user} received ${role} from ${interaction.user}.${note}`, 0x287d74);
      await interaction.reply({ content: `Assigned ${role} to ${user}.`, ephemeral: true });
    } else if (interaction.commandName === 'ban') {
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason', true);
      const deleteMessageSeconds = interaction.options.getInteger('delete-message-seconds') || 0;
      await interaction.guild.members.ban(user.id, {
        deleteMessageSeconds,
        reason: `${reason} | Banned by ${interaction.user.tag}`,
      });
      await logModeration(interaction.guild, 'Member banned', `Member: ${user} (${user.id})\nModerator: ${interaction.user}\nReason: ${reason}`, 0xc65353);
      await interaction.reply({ content: `${user.tag} was banned.`, ephemeral: true });
    } else if (interaction.commandName === 'mod-dashboard') {
      await showDashboard(interaction);
    } else if (interaction.commandName === 'profile') {
      const target = interaction.options.getUser('user') || interaction.user;
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      const profile = database.getProfile(interaction.guildId, target.id);
      await interaction.reply({ embeds: [createProfileEmbed(target, member, profile, interaction.guild)] });
    } else if (interaction.commandName === 'about') {
      await interaction.reply({ embeds: [new EmbedBuilder()
        .setColor(0x176fc1)
        .setTitle('Sapphire BOT')
        .setDescription('A polished community companion for moderation, private tickets, member profiles, welcome messages, custom keyword replies, and private Spotify search.')
        .addFields(
          { name: 'Community', value: '`/profile` • `/say` • `/autoresponse` • automatic welcome, goodbye, and Member role' },
          { name: 'Music', value: '`/song query` privately finds Spotify tracks and opens them in your Spotify app.' },
          { name: 'Moderation', value: '`/warn` • `/mute` • `/unmute` • `/ban` • `/warnings` • `/mod-dashboard`' },
          { name: 'Setup', value: '`/ticket-setup` • `/member-role` • `/welcome-channel` • `/mod-log` • `/clear-channel`' },
        )
        .setFooter({ text: 'XP is earned from active chat, once per minute.' })] });
    } else if (interaction.commandName === 'say') {
      const text = interaction.options.getString('message')?.trim() || '';
      const image = interaction.options.getAttachment('image');
      const contentType = image?.contentType?.split(';')[0].toLocaleLowerCase();
      const extensionAllowed = image && /\.(png|jpe?g|webp|gif)$/i.test(image.name);
      if (!text && !image) {
        await interaction.reply({ content: 'Add a message, an image/GIF, or both.', ephemeral: true });
        return;
      }
      if (image && (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(contentType) && !extensionAllowed)) {
        await interaction.reply({ content: 'The attachment must be a PNG, JPEG, WebP, or GIF image.', ephemeral: true });
        return;
      }
      if (image?.size > 8 * 1024 * 1024) {
        await interaction.reply({ content: 'The image or GIF must be smaller than 8 MB.', ephemeral: true });
        return;
      }
      await interaction.deferReply({ ephemeral: true });
      const payload = { allowedMentions: { parse: [] } };
      if (text) payload.content = text;
      if (image) payload.files = [{ attachment: image.url, name: image.name }];
      await interaction.channel.send(payload);
      await interaction.editReply('Your message was posted in this channel.');
    } else if (interaction.commandName === 'song') {
      await interaction.deferReply({ ephemeral: true });
      try {
        const query = interaction.options.getString('query', true);
        const tracks = await searchSpotifyTracks(query);
        if (tracks.length === 0) {
          await interaction.editReply(`No Spotify tracks found for **${query}**.`);
          return;
        }
        const embed = new EmbedBuilder()
          .setColor(0x1db954)
          .setTitle('Spotify search results')
          .setDescription(`Matches for **${query}**. Only you can see this list; open a result to listen in Spotify.`)
          .addFields(tracks.map((track, index) => ({
            name: `${index + 1}. ${track.name}`.slice(0, 256),
            value: `**Artist:** ${track.artists.map((artist) => artist.name).join(', ')}\n**Album:** ${track.album.name}\n[Open in Spotify](${track.external_urls.spotify})`,
          })))
          .setFooter({ text: 'Playback happens in your Spotify account, not in the Discord server.' });
        const cover = tracks[0].album.images?.[0]?.url;
        if (cover) embed.setThumbnail(cover);
        await interaction.editReply({ embeds: [embed] });
      } catch (error) {
        console.error('Spotify search failed:', error.message);
        await interaction.editReply('Spotify search is not configured or is temporarily unavailable. Ask the bot owner to check Spotify API settings.');
      }
    } else if (interaction.commandName === 'autoresponse') {
      await handleAutoResponseCommand(interaction);
    }
  } catch (error) {
    console.error(`Interaction failed (${interaction.commandName || interaction.customId}):`, error);
    const response = { content: 'Something went wrong while handling that action. Check the bot logs and permissions.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(response).catch(() => {});
    else await interaction.reply(response).catch(() => {});
  }
});

acquireBotLock()
  .then(() => client.login(token))
  .catch((error) => {
    console.error('Failed to start Sapphire BOT:', error);
    process.exit(1);
  });