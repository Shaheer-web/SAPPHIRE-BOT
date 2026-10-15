const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const databasePath = path.resolve(process.env.DATABASE_PATH || './data/bot.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT NOT NULL,
    setting TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (guild_id, setting)
  );
  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS warnings_by_user
    ON warnings (guild_id, user_id, created_at);
  CREATE TABLE IF NOT EXISTS member_profiles (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    experience INTEGER NOT NULL DEFAULT 0,
    message_count INTEGER NOT NULL DEFAULT 0,
    last_experience_at INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS mute_counts (
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS auto_responses (
    guild_id TEXT NOT NULL,
    trigger TEXT NOT NULL,
    response TEXT NOT NULL,
    image_path TEXT,
    PRIMARY KEY (guild_id, trigger)
  );
  CREATE TABLE IF NOT EXISTS filter_incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS filter_incidents_by_user
    ON filter_incidents (guild_id, user_id);
  CREATE TABLE IF NOT EXISTS tickets (
    channel_id TEXT PRIMARY KEY,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    category TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    closed_at TEXT
  );
  CREATE INDEX IF NOT EXISTS active_tickets_by_user
    ON tickets (guild_id, user_id, status);
  DELETE FROM tickets WHERE status = 'closed';
`);

const statements = {
  getSetting: db.prepare('SELECT value FROM guild_settings WHERE guild_id = ? AND setting = ?'),
  setSetting: db.prepare(`
    INSERT INTO guild_settings (guild_id, setting, value) VALUES (?, ?, ?)
    ON CONFLICT (guild_id, setting) DO UPDATE SET value = excluded.value
  `),
  addWarning: db.prepare(`
    INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at)
    VALUES (?, ?, ?, ?, ?)
  `),
  countWarnings: db.prepare('SELECT COUNT(*) AS count FROM warnings WHERE guild_id = ? AND user_id = ?'),
  getProfile: db.prepare('SELECT * FROM member_profiles WHERE guild_id = ? AND user_id = ?'),
  createProfile: db.prepare(`
    INSERT INTO member_profiles (guild_id, user_id, experience, message_count, last_experience_at)
    VALUES (?, ?, 10, 1, ?)
  `),
  updateProfile: db.prepare(`
    UPDATE member_profiles
    SET experience = experience + ?,
        message_count = message_count + 1,
        last_experience_at = CASE WHEN ? > 0 THEN ? ELSE last_experience_at END
    WHERE guild_id = ? AND user_id = ?
  `),
  recordMute: db.prepare(`
    INSERT INTO mute_counts (guild_id, user_id, count) VALUES (?, ?, 1)
    ON CONFLICT (guild_id, user_id) DO UPDATE SET count = count + 1
  `),
  getMuteCount: db.prepare('SELECT count FROM mute_counts WHERE guild_id = ? AND user_id = ?'),
  getAutoResponses: db.prepare('SELECT trigger, response, image_path FROM auto_responses WHERE guild_id = ?'),
  setAutoResponse: db.prepare(`
    INSERT INTO auto_responses (guild_id, trigger, response, image_path) VALUES (?, ?, ?, ?)
    ON CONFLICT (guild_id, trigger) DO UPDATE SET response = excluded.response, image_path = excluded.image_path
  `),
  getAutoResponse: db.prepare('SELECT trigger, response, image_path FROM auto_responses WHERE guild_id = ? AND trigger = ?'),
  deleteAutoResponse: db.prepare('DELETE FROM auto_responses WHERE guild_id = ? AND trigger = ?'),
  addFilterIncident: db.prepare('INSERT INTO filter_incidents (guild_id, user_id, created_at) VALUES (?, ?, ?)'),
  countFilterIncidents: db.prepare('SELECT COUNT(*) AS count FROM filter_incidents WHERE guild_id = ? AND user_id = ?'),
  listWarnings: db.prepare(`
    SELECT moderator_id, reason, created_at FROM warnings
    WHERE guild_id = ? AND user_id = ? ORDER BY id DESC LIMIT 10
  `),
  warningSummary: db.prepare(`
    SELECT user_id, COUNT(*) AS count FROM warnings
    WHERE guild_id = ? GROUP BY user_id ORDER BY count DESC LIMIT 10
  `),
  activeTicket: db.prepare(`
    SELECT channel_id FROM tickets WHERE guild_id = ? AND user_id = ? AND status = 'open' LIMIT 1
  `),
  openTickets: db.prepare(`
    SELECT channel_id FROM tickets WHERE guild_id = ? AND status = 'open'
  `),
  insertTicket: db.prepare(`
    INSERT INTO tickets (channel_id, guild_id, user_id, category, status, created_at)
    VALUES (?, ?, ?, ?, 'open', ?)
  `),
  getTicket: db.prepare('SELECT * FROM tickets WHERE channel_id = ? AND guild_id = ?'),
  closeTicket: db.prepare('DELETE FROM tickets WHERE channel_id = ? AND status = \'open\''),
};

module.exports = {
  getSetting(guildId, setting) {
    return statements.getSetting.get(guildId, setting)?.value ?? null;
  },
  setSetting(guildId, setting, value) {
    statements.setSetting.run(guildId, setting, value);
  },
  addWarning(guildId, userId, moderatorId, reason) {
    statements.addWarning.run(guildId, userId, moderatorId, reason, new Date().toISOString());
    return statements.countWarnings.get(guildId, userId).count;
  },
  getWarnings(guildId, userId) {
    return statements.listWarnings.all(guildId, userId);
  },
  getWarningCount(guildId, userId) {
    return statements.countWarnings.get(guildId, userId).count;
  },
  recordActivity(guildId, userId, now = Date.now()) {
    const profile = statements.getProfile.get(guildId, userId);
    if (!profile) {
      statements.createProfile.run(guildId, userId, now);
      return statements.getProfile.get(guildId, userId);
    }
    const earnedExperience = now - profile.last_experience_at >= 60_000 ? 10 : 0;
    statements.updateProfile.run(earnedExperience, earnedExperience, now, guildId, userId);
    return statements.getProfile.get(guildId, userId);
  },
  getProfile(guildId, userId) {
    return statements.getProfile.get(guildId, userId) ?? null;
  },
  recordMute(guildId, userId) {
    statements.recordMute.run(guildId, userId);
    return statements.getMuteCount.get(guildId, userId).count;
  },
  getMuteCount(guildId, userId) {
    return statements.getMuteCount.get(guildId, userId)?.count ?? 0;
  },
  getAutoResponses(guildId) {
    return statements.getAutoResponses.all(guildId);
  },
  getAutoResponse(guildId, trigger) {
    return statements.getAutoResponse.get(guildId, trigger.trim().toLocaleLowerCase()) ?? null;
  },
  setAutoResponse(guildId, trigger, response, imagePath) {
    statements.setAutoResponse.run(guildId, trigger.trim().toLocaleLowerCase(), response, imagePath);
  },
  deleteAutoResponse(guildId, trigger) {
    const normalizedTrigger = trigger.trim().toLocaleLowerCase();
    const existing = statements.getAutoResponse.get(guildId, normalizedTrigger);
    if (!existing) return null;
    statements.deleteAutoResponse.run(guildId, normalizedTrigger);
    return existing;
  },
  addFilterIncident(guildId, userId) {
    statements.addFilterIncident.run(guildId, userId, new Date().toISOString());
    return statements.countFilterIncidents.get(guildId, userId).count;
  },
  getWarningSummary(guildId) {
    return statements.warningSummary.all(guildId);
  },
  getActiveTicket(guildId, userId) {
    return statements.activeTicket.get(guildId, userId) ?? null;
  },
  getOpenTickets(guildId) {
    return statements.openTickets.all(guildId);
  },
  createTicket(channelId, guildId, userId, category) {
    statements.insertTicket.run(channelId, guildId, userId, category, new Date().toISOString());
  },
  getTicket(channelId, guildId) {
    return statements.getTicket.get(channelId, guildId) ?? null;
  },
  closeTicket(channelId) {
    statements.closeTicket.run(channelId);
  },
};