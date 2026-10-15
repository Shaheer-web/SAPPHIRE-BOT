require('dotenv').config();

const { REST, Routes } = require('discord.js');
const commands = require('./commands');

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID) {
  throw new Error('DISCORD_TOKEN and CLIENT_ID are required. Copy .env.example to .env and fill in both values.');
}

const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
const route = GUILD_ID
  ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID)
  : Routes.applicationCommands(CLIENT_ID);

rest.put(route, { body: commands.map((command) => command.toJSON()) })
  .then(() => {
    const scope = GUILD_ID ? `guild ${GUILD_ID}` : 'global';
    console.log(`Deployed ${commands.length} slash commands to ${scope}.`);
  })
  .catch((error) => {
    console.error('Command deployment failed:', error);
    process.exitCode = 1;
  });