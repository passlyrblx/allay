// BLOCK 1: Dependencies, Configuration, RCON Manager, Query Handler, Helpers, Status Cache
const { Rcon } = require('rcon-client');
const { EmbedBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const fs = require('node:fs');
const dgram = require('dgram');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ----- CONFIGURATION -----
const config = {
    host: '141.11.113.66',
    port: 25577,
    password: 'XXXX',
    queryPort: 40028  // kept for fallback
};

// ----- OWNER & AI -----
const OWNER_ID = '1464477767231078554';
const GEMINI_API_KEY = 'AQ.Ab8RN6KJRA4r8UHLSsZzOa5YGJmOd1FPav3d3_ARuDjZETLC7A';
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// ----- FILE PATHS -----
const CASES_FILE = './ai_cases.json';
const MC_STATUS_FILE = './mcstatus.json';
const STATUS_CHANNEL_ID = '1512478781128835253'; // Hardcoded status channel

// ----- RCON Manager -----
class RCONManager {
    constructor() {
        this.connection = null;
        this.isConnecting = false;
        this.lastError = null;
    }
    async connect() {
        if (this.connection && this.connection.socket && !this.connection.socket.destroyed) return this.connection;
        if (this.isConnecting) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            return this.connect();
        }
        this.isConnecting = true;
        try {
            console.log(`🔌 Attempting RCON connection to ${config.host}:${config.port}...`);
            this.connection = await Rcon.connect({
                host: config.host,
                port: config.port,
                password: config.password
            });
            console.log('✅ RCON Connected to Minecraft Server');
            this.lastError = null;
            return this.connection;
        } catch (error) {
            // Keep detailed logs for debugging, but user-facing error will be simple
            console.error('❌ RCON connection failed:', error.message);
            this.lastError = error.message;
            this.connection = null;
            throw error;
        } finally {
            this.isConnecting = false;
        }
    }
    async execute(command) {
        try {
            const connection = await this.connect();
            const response = await connection.send(command);
            return response;
        } catch (error) {
            console.error(`RCON Execute Error (${command}):`, error.message);
            throw error;
        }
    }
    async disconnect() {
        if (this.connection) {
            await this.connection.end();
            this.connection = null;
            console.log('🔌 RCON Disconnected');
        }
    }
    getStatus() {
        return {
            connected: this.connection && this.connection.socket && !this.connection.socket.destroyed,
            lastError: this.lastError
        };
    }
}
const rconManager = new RCONManager();

// ----- Query Handler (UDP fallback for status) -----
class QueryHandler {
    static async getBasicStatus(host, port) {
        return new Promise((resolve, reject) => {
            const client = dgram.createSocket('udp4');
            const timeout = setTimeout(() => {
                client.close();
                reject(new Error('Query timeout'));
            }, 3000);
            const handshake = Buffer.from([0xFE, 0xFD, 0x09, 0x01, 0x02, 0x03, 0x04]);
            client.send(handshake, 0, handshake.length, port, host, (err) => {
                if (err) {
                    clearTimeout(timeout);
                    client.close();
                    reject(new Error(`Query send error`));
                }
            });
            client.on('message', (msg) => {
                clearTimeout(timeout);
                client.close();
                if (msg.length > 5 && msg[0] === 0x09) {
                    const nullPos = msg.indexOf(0x00, 5);
                    const hostname = msg.slice(5, nullPos).toString();
                    const mapStart = nullPos + 1;
                    const mapEnd = msg.indexOf(0x00, mapStart);
                    const map = msg.slice(mapStart, mapEnd).toString();
                    const playersStart = mapEnd + 1;
                    const playersEnd = msg.indexOf(0x00, playersStart);
                    const players = parseInt(msg.slice(playersStart, playersEnd).toString());
                    const maxStart = playersEnd + 1;
                    const maxEnd = msg.indexOf(0x00, maxStart);
                    const maxPlayers = parseInt(msg.slice(maxStart, maxEnd).toString());
                    resolve({ hostname, map, players, maxPlayers, online: true });
                } else {
                    reject(new Error('Invalid query response'));
                }
            });
        });
    }
}

// ----- Helper Functions -----
function parsePlayerList(response) {
    if (!response || response.includes('There are 0 of a max')) return [];
    const match = response.match(/There are \d+ of a max of \d+ players online:(.*)/);
    if (!match) return [];
    const playersStr = match[1].trim();
    if (!playersStr) return [];
    return playersStr.split(', ').map(p => p.trim());
}
function isAdmin(interactionOrMessage) {
    if (interactionOrMessage.member) {
        return interactionOrMessage.member.permissions.has(PermissionFlagsBits.Administrator);
    }
    return false;
}

// ----- Status Cache -----
let serverStatusCache = {
    isOnline: false,
    players: [],
    playerCount: 0,
    maxPlayers: 0,
    lastCheck: null,
    motd: null,
    map: null,
    error: null
};
let statusUpdateInterval = null;
let statusChannelId = null;
let statusMessageId = null;
// BLOCK 2: Status Updater Functions (with custom emojis & clean offline message)
async function updateServerStatus() {
    console.log('🔄 updateServerStatus() called');
    try {
        console.log('🔍 Attempting RCON list...');
        const result = await rconManager.execute('list');
        console.log('✅ RCON list result:', result);
        const players = parsePlayerList(result);
        serverStatusCache = {
            isOnline: true,
            players: players,
            playerCount: players.length,
            maxPlayers: '?',
            lastCheck: new Date(),
            motd: result.split('\n')[0] || 'Minecraft Server',
            map: 'Unknown',
            error: null
        };
        console.log('✅ Status cache updated (online)');
        if (statusChannelId) {
            console.log('📤 Calling updateStatusMessage()...');
            await updateStatusMessage();
        } else {
            console.warn('⚠️ statusChannelId is null, cannot send embed.');
        }
        return true;
    } catch (rconError) {
        console.error('❌ RCON list failed:', rconError.message);
        // Fallback to Query
        try {
            console.log('🔍 Falling back to Query...');
            const queryData = await QueryHandler.getBasicStatus(config.host, config.queryPort);
            console.log('✅ Query data:', queryData);
            serverStatusCache = {
                isOnline: true,
                players: [],
                playerCount: queryData.players,
                maxPlayers: queryData.maxPlayers,
                lastCheck: new Date(),
                motd: queryData.hostname || 'Minecraft Server',
                map: queryData.map,
                error: null // No error, we got data from Query
            };
            if (statusChannelId) {
                await updateStatusMessage();
            }
            return true;
        } catch (queryError) {
            console.error('❌ Query also failed:', queryError.message);
            // Both RCON and Query failed – server is offline or unreachable
            serverStatusCache = {
                isOnline: false,
                players: [],
                playerCount: 0,
                maxPlayers: 0,
                lastCheck: new Date(),
                motd: null,
                map: null,
                error: 'Server is offline'  // Clean, user-friendly message
            };
            if (statusChannelId) {
                await updateStatusMessage();
            }
            return false;
        }
    }
}

async function updateStatusMessage() {
    console.log('📤 updateStatusMessage() called');
    if (!statusChannelId) {
        console.warn('⚠️ statusChannelId is null – cannot send status message.');
        return;
    }
    console.log('📍 statusChannelId:', statusChannelId);

    try {
        console.log('🔍 Fetching channel...');
        let channel;
        try {
            channel = await global.client?.channels.fetch(statusChannelId);
        } catch (fetchError) {
            console.error('❌ Error fetching channel:', fetchError.message);
            statusChannelId = null;
            statusMessageId = null;
            saveStatusConfig();
            return;
        }

        if (!channel) {
            console.error('❌ Channel not found (null). ID:', statusChannelId);
            return;
        }

        console.log('✅ Channel found:', channel.name, '(ID:', channel.id, ')');

        const me = channel.guild.members.me;
        if (!me) {
            console.error('❌ Bot member not found in guild.');
            return;
        }
        const perms = channel.permissionsFor(me);
        console.log('🔑 Permissions:');
        console.log('  - SendMessages:', perms.has('SendMessages'));
        console.log('  - EmbedLinks:', perms.has('EmbedLinks'));
        console.log('  - ReadMessageHistory:', perms.has('ReadMessageHistory'));

        if (!perms.has('SendMessages')) {
            console.error('❌ Bot lacks "Send Messages" permission in channel.');
            return;
        }
        if (!perms.has('EmbedLinks')) {
            console.error('❌ Bot lacks "Embed Links" permission in channel.');
            return;
        }

        const embed = createStatusEmbed();
        const row = getStatusButtonRow();

        if (statusMessageId) {
            console.log('📝 Editing existing message ID:', statusMessageId);
            try {
                const existing = await channel.messages.fetch(statusMessageId);
                await existing.edit({ embeds: [embed], components: [row] });
                console.log('✅ Status message updated successfully.');
            } catch (editError) {
                console.warn('⚠️ Failed to edit existing message:', editError.message);
                console.log('📤 Sending new message instead...');
                const newMsg = await channel.send({ embeds: [embed], components: [row] });
                statusMessageId = newMsg.id;
                fs.writeFileSync(MC_STATUS_FILE, JSON.stringify({ messageId: statusMessageId }, null, 2));
                console.log('✅ New status message sent (ID:', statusMessageId, ')');
            }
        } else {
            console.log('📝 No existing message, sending new one...');
            try {
                const newMsg = await channel.send({ embeds: [embed], components: [row] });
                statusMessageId = newMsg.id;
                fs.writeFileSync(MC_STATUS_FILE, JSON.stringify({ messageId: statusMessageId }, null, 2));
                console.log('✅ Initial status message sent (ID:', statusMessageId, ')');
            } catch (sendError) {
                console.error('❌ Failed to send initial message:', sendError.message);
            }
        }
    } catch (error) {
        console.error('❌ Unexpected error in updateStatusMessage:', error);
    }
}

function getStatusButtonRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('status_show_players')
            .setLabel('👥 Show Players')
            .setStyle(ButtonStyle.Primary)
    );
}

function createStatusEmbed() {
    const isOnline = serverStatusCache.isOnline;
    // Custom animated emojis
    const dot = isOnline ? '<a:Green_Loading:1517212594450989218>' : '<a:Red_Loading:1517215269976670228>';
    const color = isOnline ? 0x00ff00 : 0xff0000;
    const playerCount = serverStatusCache.playerCount || 0;
    const maxPlayers = serverStatusCache.maxPlayers || '?';

    const embed = new EmbedBuilder()
        .setTitle(`${dot} Minecraft Server Status`)
        .setColor(color)
        .setTimestamp(serverStatusCache.lastCheck);

    if (isOnline) {
        const statusText = serverStatusCache.error ? `Online (⚠️ ${serverStatusCache.error})` : 'Online';
        embed.addFields({
            name: `Server Info\n**IP**: ${config.host}\n**Port**:40028`,
            value: `**Status:** ${statusText}\n**Players:** ${playerCount}`,
            inline: false
        });
        if (serverStatusCache.motd && !serverStatusCache.motd.includes('There are')) {
            embed.setDescription(serverStatusCache.motd);
        }
    } else {
        // Offline – simple message, no technical jargon
        embed.addFields(
            { name: '📡 Status', value: 'Offline', inline: true },
            { name: '❌ Error', value: serverStatusCache.error || 'Server is offline', inline: false }
        );
    }

    embed.setFooter({ text: `Last checked • ${new Date(serverStatusCache.lastCheck).toLocaleTimeString()}` });
    return embed;
}

function saveStatusConfig() {
    fs.writeFileSync(MC_STATUS_FILE, JSON.stringify({ channelId: statusChannelId, messageId: statusMessageId }, null, 2));
}

function loadStatusConfig() {
    statusChannelId = STATUS_CHANNEL_ID;
    if (fs.existsSync(MC_STATUS_FILE)) {
        try {
            const data = JSON.parse(fs.readFileSync(MC_STATUS_FILE, 'utf8'));
            statusMessageId = data.messageId || null;
        } catch (e) {
            statusMessageId = null;
        }
    } else {
        statusMessageId = null;
    }
    console.log('📌 Status channel set to (hardcoded):', statusChannelId);
}

function startStatusUpdater() {
    if (statusUpdateInterval) clearInterval(statusUpdateInterval);
    console.log('⏳ Starting status updater (first run in 2 seconds)');
    setTimeout(async () => {
        await updateServerStatus();
    }, 2000);
    statusUpdateInterval = setInterval(async () => {
        await updateServerStatus();
    }, 5 * 60 * 1000);
}
// BLOCK 3: Paginated Player List Handler
let playersCache = [];
let playersPage = 0;
const PLAYERS_PER_PAGE = 10;

async function handleShowPlayers(interaction) {
    await interaction.deferReply({ ephemeral: true });
    try {
        const response = await rconManager.execute('list');
        const players = parsePlayerList(response);
        playersCache = players;
    } catch (error) {
        return interaction.editReply('❌ Could not fetch player list. Server may be offline.');
    }
    if (playersCache.length === 0) {
        return interaction.editReply({ content: '👥 No players currently online.', ephemeral: true });
    }
    playersPage = 0;
    await sendPlayersPage(interaction);
}

async function sendPlayersPage(interaction) {
    const totalPages = Math.ceil(playersCache.length / PLAYERS_PER_PAGE);
    const start = playersPage * PLAYERS_PER_PAGE;
    const end = Math.min(start + PLAYERS_PER_PAGE, playersCache.length);
    const pagePlayers = playersCache.slice(start, end);
    const embed = new EmbedBuilder()
        .setTitle(`👥 Online Players (${playersCache.length} total)`)
        .setDescription(pagePlayers.map((p, i) => `${start + i + 1}. ${p}`).join('\n') || 'No players')
        .setColor(0x0099ff)
        .setFooter({ text: `Page ${playersPage + 1}/${totalPages}` });

    const row = new ActionRowBuilder();
    if (totalPages > 1) {
        if (playersPage > 0) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('players_prev')
                    .setLabel('◀ Previous')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        if (playersPage < totalPages - 1) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId('players_next')
                    .setLabel('Next ▶')
                    .setStyle(ButtonStyle.Secondary)
            );
        }
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('players_close')
                .setLabel('✖ Close')
                .setStyle(ButtonStyle.Danger)
        );
    } else {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId('players_close')
                .setLabel('✖ Close')
                .setStyle(ButtonStyle.Danger)
        );
    }
    await interaction.editReply({ embeds: [embed], components: [row], ephemeral: true });
}

async function handlePlayersPagination(interaction) {
    const customId = interaction.customId;
    if (customId === 'players_next') { playersPage++; await sendPlayersPage(interaction); }
    else if (customId === 'players_prev') { playersPage--; await sendPlayersPage(interaction); }
    else if (customId === 'players_close') {
        await interaction.update({ content: '👥 Player list closed.', embeds: [], components: [], ephemeral: true });
    }
}
// BLOCK 4: Gemini AI Client, Quota Tracking, System Prompt (with command list)
let requestCount = 0;
const MAX_REQUESTS_PER_MINUTE = 60;
let lastResetTime = Date.now();

function getRemainingQuota() {
    const now = Date.now();
    if (now - lastResetTime > 60000) {
        requestCount = 0;
        lastResetTime = now;
    }
    return Math.max(0, MAX_REQUESTS_PER_MINUTE - requestCount);
}

async function callGemini(prompt, systemInstruction = '') {
    const remaining = getRemainingQuota();
    if (remaining <= 0) {
        throw new Error('Quota exceeded. Please wait a minute.');
    }
    if (prompt.length > 2000) prompt = prompt.substring(0, 2000);
    const model = genAI.getGenerativeModel({
        model: 'gemini-2.5-flash',
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    });
    const chat = model.startChat({
        systemInstruction: {
            role: 'system',
            parts: [{ text: systemInstruction || 'You are a Minecraft server admin assistant.' }]
        }
    });
    const result = await chat.sendMessage(prompt);
    const text = result.response.text();
    requestCount++;
    return { text, remaining: getRemainingQuota() };
}

// System prompt – no WorldEdit, Bedrock whitelist, includes command list
function getSystemPrompt(username) {
    return `Generate Minecraft commands as JSON. Use / for all commands. This is a BEDROCK server.

Available commands: /give, /tp, /time, /weather, /gamemode, /kick, /ban, /pardon, /op, /deop, /heal, /kill, /say, /list, /seed, /save-all, /reload, /stop,also use any commands you know (not from this) 

For whitelist: use /fwhitelist add <player> and /fwhitelist remove <player>. Do not use /whitelist if bedrock
for java use /whitelist and if they specifically tell ,use that command

if they tell to use specific command use exactly that command..dont use fwhitelist 

Username: ${username}.
Return: {"commands":["cmd1","cmd2"],"mission":"...","summary":"...","riskLevel":"low|medium|high|critical","undoAvailable":true/false,"undoCommand":"..."}`;
}
// BLOCK 5: AI Request Handler, Preview Display
async function generatePlan(prompt, username) {
    const systemPrompt = getSystemPrompt(username);
    try {
        const result = await callGemini(prompt, systemPrompt);
        const data = JSON.parse(result.text);
        data._remainingQuota = result.remaining;
        return data;
    } catch (error) {
        console.error('AI generation error:', error);
        return { error: `AI error: ${error.message}` };
    }
}

async function showPreview(message, planData, originalPrompt) {
    const { commands, mission, summary, executionOrder, pluginsUsed, estimatedArea, estimatedTime, riskLevel, undoAvailable, undoCommand, warnings, error, _remainingQuota } = planData;
    if (error) {
        const short = error.substring(0, 200);
        return message.reply(`❌ ${short}`);
    }
    if (!commands || commands.length === 0) return message.reply('❌ No commands generated.');

    const embed = new EmbedBuilder()
        .setTitle('📋 AI Execution Plan')
        .setColor(0x0099ff)
        .addFields(
            { name: '🎯 Mission', value: (mission || 'Not specified').substring(0, 100), inline: false },
            { name: '📝 Summary', value: (summary || 'No summary').substring(0, 200), inline: false },
            { name: '📜 Commands', value: `\`\`\`\n${commands.join('\n').substring(0, 1000)}\n\`\`\``, inline: false },
            { name: '⚠️ Risk Level', value: `**${(riskLevel || 'low').toUpperCase()}**`, inline: true },
            { name: '↩️ Undo', value: undoAvailable ? '✅ Yes' : '❌ No', inline: true },
            { name: '⏱️ Est. Time', value: estimatedTime || 'Unknown', inline: true }
        )
        .setFooter({ text: `Quota: ${_remainingQuota || '?'} req/min` });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ai_confirm_${Date.now()}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ai_retry_${Date.now()}`).setLabel('🔄 Retry').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`ai_cancel_${Date.now()}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ai_explain_${Date.now()}`).setLabel('📖 Explain').setStyle(ButtonStyle.Secondary)
    );

    const sentMsg = await message.reply({ embeds: [embed], components: [row] });
    const msgId = sentMsg.id;
    if (!global.pendingPlans) global.pendingPlans = new Map();
    global.pendingPlans.set(msgId, { planData, originalPrompt, authorId: message.author.id, commands, sentMsg });
    return sentMsg;
}
// BLOCK 6: Button Interaction Handler, Case Manager
async function handleButtonInteraction(interaction) {
    if (!interaction.isButton()) return false;
    const customId = interaction.customId;

    if (customId === 'status_show_players') {
        await handleShowPlayers(interaction);
        return true;
    }
    if (customId === 'players_next' || customId === 'players_prev' || customId === 'players_close') {
        await handlePlayersPagination(interaction);
        return true;
    }

    if (!customId.startsWith('ai_')) return false;

    await interaction.deferUpdate();

    const msgId = interaction.message.id;
    if (!global.pendingPlans || !global.pendingPlans.has(msgId)) {
        await interaction.editReply({ content: '❌ This plan has expired.', components: [], embeds: [] });
        return true;
    }
    const pending = global.pendingPlans.get(msgId);
    const { planData, originalPrompt, authorId, commands } = pending;
    if (interaction.user.id !== authorId) {
        await interaction.editReply({ content: '❌ You are not the owner of this plan.', ephemeral: true });
        return true;
    }

    if (customId.startsWith('ai_confirm_')) {
        await interaction.editReply({ content: '⏳ Executing commands...', components: [], embeds: [] });
        const results = [];
        let allSuccess = true;
        for (const cmd of commands) {
            try {
                const res = await rconManager.execute(cmd);
                results.push(`✅ ${cmd} -> ${res || 'ok'}`);
            } catch (err) {
                results.push(`❌ ${cmd} -> ${err.message}`);
                allSuccess = false;
                if (planData.riskLevel === 'critical' || planData.riskLevel === 'high') break;
            }
        }
        const caseData = {
            id: getNextCaseId(),
            prompt: originalPrompt,
            reasoning: planData.mission || '',
            commands: commands,
            results: results,
            status: allSuccess ? 'success' : 'partial',
            riskLevel: planData.riskLevel || 'low',
            undoAvailable: planData.undoAvailable || false,
            undoCommand: planData.undoCommand || '',
            pluginsUsed: planData.pluginsUsed || [],
            timestamp: new Date().toISOString(),
            executionDuration: 0,
            notes: ''
        };
        saveCase(caseData);
        const resultText = results.join('\n').substring(0, 1500);
        await interaction.editReply({
            content: `✅ **Done!** Case #${caseData.id}\n\`\`\`\n${resultText}\n\`\`\``
        });
        global.pendingPlans.delete(msgId);
        return true;
    }

    if (customId.startsWith('ai_retry_')) {
        await interaction.editReply({ content: '🔄 Regenerating plan...', components: [], embeds: [] });
        const newPlan = await generatePlan(originalPrompt, interaction.user.username);
        await interaction.message.delete();
        const embed = new EmbedBuilder()
            .setTitle('📋 AI Execution Plan')
            .setColor(0x0099ff)
            .addFields(
                { name: '🎯 Mission', value: (newPlan.mission || 'Not specified').substring(0, 100), inline: false },
                { name: '📝 Summary', value: (newPlan.summary || 'No summary').substring(0, 200), inline: false },
                { name: '📜 Commands', value: `\`\`\`\n${(newPlan.commands || []).join('\n').substring(0, 1000)}\n\`\`\``, inline: false },
                { name: '⚠️ Risk Level', value: `**${(newPlan.riskLevel || 'low').toUpperCase()}**`, inline: true },
                { name: '↩️ Undo', value: newPlan.undoAvailable ? '✅ Yes' : '❌ No', inline: true },
                { name: '⏱️ Est. Time', value: newPlan.estimatedTime || 'Unknown', inline: true }
            )
            .setFooter({ text: `Quota: ${newPlan._remainingQuota || '?'} req/min` });
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`ai_confirm_${Date.now()}`).setLabel('✅ Confirm').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`ai_retry_${Date.now()}`).setLabel('🔄 Retry').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId(`ai_cancel_${Date.now()}`).setLabel('❌ Cancel').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`ai_explain_${Date.now()}`).setLabel('📖 Explain').setStyle(ButtonStyle.Secondary)
        );
        const newMsg = await interaction.followUp({ embeds: [embed], components: [row] });
        const newMsgId = newMsg.id;
        if (!global.pendingPlans) global.pendingPlans = new Map();
        global.pendingPlans.set(newMsgId, { planData: newPlan, originalPrompt, authorId: interaction.user.id, commands: newPlan.commands, sentMsg: newMsg });
        global.pendingPlans.delete(msgId);
        return true;
    }

    if (customId.startsWith('ai_cancel_')) {
        await interaction.editReply({ content: '❌ Cancelled.', components: [], embeds: [] });
        global.pendingPlans.delete(msgId);
        return true;
    }

    if (customId.startsWith('ai_explain_')) {
        await interaction.editReply({ content: '📖 Sending explanation via DM...', ephemeral: true });
        const success = await sendExplanation(interaction.user, originalPrompt, planData);
        if (!success) {
            const fallbackMsg = buildExplanationMessage(originalPrompt, planData);
            await interaction.followUp({ content: fallbackMsg.substring(0, 2000), ephemeral: true });
        }
        return true;
    }
    return false;
}

function buildExplanationMessage(prompt, planData) {
    const { commands, mission, summary, estimatedTime, riskLevel, undoAvailable, undoCommand, warnings } = planData;
    let msg = `📖 **Explanation for:** "${prompt}"\n\n`;
    msg += `**Mission:** ${mission || 'N/A'}\n`;
    msg += `**Summary:** ${summary || 'N/A'}\n\n`;
    msg += `**Commands:**\n\`\`\`\n${commands.join('\n').substring(0, 1000)}\n\`\`\`\n`;
    msg += `**Risk:** ${(riskLevel || 'low').toUpperCase()}\n`;
    msg += `**Undo:** ${undoAvailable ? 'Yes' + (undoCommand ? ' (use ' + undoCommand + ')' : '') : 'No'}`;
    if (warnings && warnings.length) msg += `\n**Warnings:** ${warnings.join(', ')}`;
    return msg;
}

async function sendExplanation(user, prompt, planData) {
    try {
        const msg = buildExplanationMessage(prompt, planData);
        await user.send(msg.substring(0, 2000));
        return true;
    } catch (e) {
        console.error('DM failed:', e.message);
        return false;
    }
}

// ----- Case Manager -----
function loadCases() {
    if (fs.existsSync(CASES_FILE)) {
        try { return JSON.parse(fs.readFileSync(CASES_FILE, 'utf8')); }
        catch (e) { return { cases: [] }; }
    }
    return { cases: [] };
}
function saveCases(data) { fs.writeFileSync(CASES_FILE, JSON.stringify(data, null, 2)); }
function getNextCaseId() {
    const data = loadCases();
    if (data.cases.length === 0) return 1;
    return Math.max(...data.cases.map(c => c.id)) + 1;
}
function saveCase(caseData) {
    const data = loadCases();
    data.cases.push(caseData);
    saveCases(data);
}
function getCase(id) {
    const data = loadCases();
    return data.cases.find(c => c.id === id);
}
function deleteCase(id) {
    const data = loadCases();
    data.cases = data.cases.filter(c => c.id !== id);
    saveCases(data);
}
function clearCases() { saveCases({ cases: [] }); }
// BLOCK 7: Case Commands, Prefix Command Router, Initialization, Exports
async function handleCaseCommand(message, args) {
    if (message.author.id !== OWNER_ID) return message.reply('❌ Not authorized.');
    if (args.length === 0) return message.reply('Usage: m.case <list|view|redo|undo|delete|clear> [id]');

    const sub = args[0].toLowerCase();
    const data = loadCases();

    switch (sub) {
        case 'list': {
            const embed = new EmbedBuilder()
                .setTitle('📂 Stored Cases')
                .setColor(0x0099ff)
                .setDescription(data.cases.length ? data.cases.map(c => `#${c.id} - ${c.prompt.substring(0, 30)}... (${c.status})`).join('\n') : 'No cases.');
            return message.reply({ embeds: [embed] });
        }
        case 'view': {
            const id = parseInt(args[1]);
            if (isNaN(id)) return message.reply('❌ Invalid ID.');
            const c = getCase(id);
            if (!c) return message.reply('❌ Not found.');
            const embed = new EmbedBuilder()
                .setTitle(`📋 Case #${c.id}`)
                .setColor(0x0099ff)
                .addFields(
                    { name: 'Prompt', value: c.prompt.substring(0, 200), inline: false },
                    { name: 'Commands', value: `\`\`\`\n${c.commands.join('\n').substring(0, 400)}\n\`\`\``, inline: false },
                    { name: 'Status', value: c.status, inline: true },
                    { name: 'Risk', value: c.riskLevel, inline: true },
                    { name: 'Timestamp', value: c.timestamp, inline: true }
                );
            return message.reply({ embeds: [embed] });
        }
        case 'redo': {
            const id = parseInt(args[1]);
            if (isNaN(id)) return message.reply('❌ Invalid ID.');
            const c = getCase(id);
            if (!c) return message.reply('❌ Not found.');
            const newPlan = await generatePlan(c.prompt, message.author.username);
            await showPreview(message, newPlan, c.prompt);
            return;
        }
        case 'undo': {
            const id = parseInt(args[1]);
            if (isNaN(id)) return message.reply('❌ Invalid ID.');
            const c = getCase(id);
            if (!c) return message.reply('❌ Not found.');
            if (!c.undoAvailable || !c.undoCommand) return message.reply('❌ No undo available.');
            try {
                await rconManager.execute(c.undoCommand);
                return message.reply(`✅ Undo executed for case #${id}: \`${c.undoCommand}\``);
            } catch (err) {
                return message.reply(`❌ Undo failed: ${err.message}`);
            }
        }
        case 'delete': {
            const id = parseInt(args[1]);
            if (isNaN(id)) return message.reply('❌ Invalid ID.');
            deleteCase(id);
            return message.reply(`✅ Case #${id} deleted.`);
        }
        case 'clear': {
            if (args.length === 2 && args[1] === 'confirm') {
                clearCases();
                return message.reply('✅ All cases cleared.');
            }
            return message.reply('⚠️ Type `m.case clear confirm` to confirm.');
        }
        default: return message.reply('Unknown subcommand.');
    }
}

async function handleDoCommand(message, args) {
    if (message.author.id !== OWNER_ID) return message.reply('❌ Not authorized.');
    const prompt = args.join(' ');
    if (!prompt) return message.reply('❌ Provide an instruction.');
    const plan = await generatePlan(prompt, message.author.username);
    await showPreview(message, plan, prompt);
}

// ----- Prefix Router -----
async function handlePrefixCommand(message) {
    if (!message.content.startsWith('m.')) return false;
    const args = message.content.slice(2).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const memberCommands = ['status', 'players', 'list', 'serverinfo', 'help', 'tps', 'uptime', 'seen', 'playerinfo', 'playtime'];

    if (!memberCommands.includes(command) && !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
        await message.reply('❌ Admin only.');
        return true;
    }

    if (['do', 'case', 'status', 'players', 'serverinfo', 'seen', 'playerinfo', 'playtime'].includes(command)) {
        await message.channel.sendTyping();
    }

    try {
        switch (command) {
            case 'status':
                await updateServerStatus();
                await message.reply({ embeds: [createStatusEmbed()], components: [getStatusButtonRow()] });
                break;

            case 'players': {
                try {
                    const r = await rconManager.execute('list');
                    const p = parsePlayerList(r);
                    const embed = new EmbedBuilder()
                        .setTitle('👥 Online Players')
                        .setColor(0x00ff00)
                        .addFields(
                            { name: 'Total', value: p.length.toString(), inline: true },
                            { name: 'List', value: p.join(', ') || 'None', inline: false }
                        )
                        .setTimestamp();
                    await message.reply({ embeds: [embed] });
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;
            }

            case 'list': {
                try {
                    const lr = await rconManager.execute('list');
                    await message.reply(`\`\`\`${lr}\`\`\``);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;
            }

            case 'serverinfo': {
                try {
                    const ir = await rconManager.execute('list');
                    const ip = parsePlayerList(ir);
                    const tps = await rconManager.execute('tps').catch(() => 'Unknown');
                    const mem = await rconManager.execute('memory').catch(() => 'Unknown');
                    const embed = new EmbedBuilder()
                        .setTitle('🖥️ Server Info')
                        .setColor(0x0099ff)
                        .addFields(
                            { name: 'Players', value: `${ip.length} online`, inline: true },
                            { name: 'TPS', value: tps.substring(0, 50), inline: true },
                            { name: 'Memory', value: mem.substring(0, 50), inline: true }
                        )
                        .setTimestamp();
                    await message.reply({ embeds: [embed] });
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;
            }

            case 'help': {
                const helpEmbed = new EmbedBuilder()
                    .setTitle('📋 Minecraft Bot Commands')
                    .setDescription('All commands work with `/` or `m.` prefix.')
                    .setColor(0x0099ff)
                    .addFields(
                        { name: '👥 Member', value: '`status`, `players`, `list`, `serverinfo`, `tps`, `uptime`, `seen`, `playerinfo`, `playtime`', inline: false },
                        { name: '🔧 Admin', value: '`say`, `kick`, `ban`, `pardon`, `op`, `deop`, `time`, `weather`, `execute`, `give`, `teleport`, `heal`, `kill`, `gamemode`, `save`, `reload`, `stop`', inline: false },
                        { name: '🤖 AI', value: '`do <prompt>`, `case list|view|redo|undo|delete|clear`', inline: false },
                        { name: '🛡️ Server', value: '`save`, `reload`, `stop`', inline: false }
                    )
                    .setFooter({ text: 'Admin commands require Administrator permission.' });
                await message.reply({ embeds: [helpEmbed] });
                break;
            }

            case 'tps': {
                try {
                    const tpsResult = await rconManager.execute('tps');
                    await message.reply(`📊 **TPS:**\n\`\`\`${tpsResult}\`\`\``);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;
            }

            case 'uptime': {
                try {
                    const uptimeResult = await rconManager.execute('uptime');
                    await message.reply(`⏱️ **Uptime:**\n\`\`\`${uptimeResult}\`\`\``);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;
            }

            case 'seen':
                if (!args.length) return message.reply('Usage: m.seen <player>');
                try {
                    const seenResult = await rconManager.execute(`seen ${args[0]}`);
                    await message.reply(`🕐 **${args[0]}** was last seen:\n\`\`\`${seenResult}\`\`\``);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'playerinfo':
                if (!args.length) return message.reply('Usage: m.playerinfo <player>');
                try {
                    const infoEmbed = new EmbedBuilder().setTitle(`👤 Player: ${args[0]}`).setColor(0x0099ff);
                    const pos = await rconManager.execute(`data get entity ${args[0]} Pos`);
                    const health = await rconManager.execute(`data get entity ${args[0]} Health`);
                    const hunger = await rconManager.execute(`data get entity ${args[0]} Hunger`);
                    const gamemode = await rconManager.execute(`data get entity ${args[0]} GameMode`);
                    const xp = await rconManager.execute(`data get entity ${args[0]} XpLevel`);
                    infoEmbed.addFields(
                        { name: '📍 Position', value: pos.substring(0, 100) || 'Unknown', inline: false },
                        { name: '❤️ Health', value: health.substring(0, 50) || 'Unknown', inline: true },
                        { name: '🍖 Hunger', value: hunger.substring(0, 50) || 'Unknown', inline: true },
                        { name: '🎮 Gamemode', value: gamemode.substring(0, 50) || 'Unknown', inline: true },
                        { name: '⭐ XP Level', value: xp.substring(0, 50) || 'Unknown', inline: true }
                    );
                    await message.reply({ embeds: [infoEmbed] });
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'playtime':
                if (!args.length) return message.reply('Usage: m.playtime <player>');
                try {
                    const ptResult = await rconManager.execute(`playtime ${args[0]}`);
                    await message.reply(`⏱️ **${args[0]}'s Playtime:**\n\`\`\`${ptResult}\`\`\``);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'say':
                if (!args.length) return message.reply('Usage: m.say <msg>');
                try {
                    await rconManager.execute(`say ${args.join(' ')}`);
                    await message.reply('✅ Sent');
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'kick':
                if (!args.length) return message.reply('Usage: m.kick <user> [reason]');
                try {
                    const kr = args.slice(1).join(' ') || 'No reason';
                    await rconManager.execute(`kick ${args[0]} ${kr}`);
                    await message.reply(`✅ Kicked ${args[0]}`);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'ban':
                if (!args.length) return message.reply('Usage: m.ban <user> [reason]');
                try {
                    const br = args.slice(1).join(' ') || 'No reason';
                    await rconManager.execute(`ban ${args[0]} ${br}`);
                    await message.reply(`✅ Banned ${args[0]}`);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'pardon':
                if (!args.length) return message.reply('Usage: m.pardon <user>');
                try {
                    await rconManager.execute(`pardon ${args[0]}`);
                    await message.reply(`✅ Unbanned ${args[0]}`);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'op':
                if (!args.length) return message.reply('Usage: m.op <user>');
                try {
                    await rconManager.execute(`op ${args[0]}`);
                    await message.reply(`✅ Opped ${args[0]}`);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'deop':
                if (!args.length) return message.reply('Usage: m.deop <user>');
                try {
                    await rconManager.execute(`deop ${args[0]}`);
                    await message.reply(`✅ Deopped ${args[0]}`);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'time':
                if (!args.length || !['day', 'night', 'sunset', 'midnight'].includes(args[0])) {
                    return message.reply('Usage: m.time <day/night/sunset/midnight>');
                }
                try {
                    const timeMap = { day: 1000, night: 13000, sunset: 12000, midnight: 18000 };
                    await rconManager.execute(`time set ${timeMap[args[0]]}`);
                    await message.reply(`✅ Time set to ${args[0]}`);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'weather':
                if (!args.length || !['clear', 'rain', 'thunder'].includes(args[0])) {
                    return message.reply('Usage: m.weather <clear/rain/thunder>');
                }
                try {
                    await rconManager.execute(`weather ${args[0]}`);
                    await message.reply(`✅ Weather set to ${args[0]}`);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'execute':
                if (!args.length) return message.reply('Usage: m.execute <cmd>');
                try {
                    const ex = await rconManager.execute(args.join(' '));
                    await message.reply(`\`\`\`${ex || 'Done'}\`\`\``);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'give':
                if (args.length < 2) return message.reply('Usage: m.give <user> <item> [amount]');
                try {
                    await rconManager.execute(`give ${args[0]} ${args[1]} ${args[2] || 1}`);
                    await message.reply(`✅ Gave ${args[2] || 1} ${args[1]} to ${args[0]}`);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'tp':
            case 'teleport':
                if (args.length < 2) return message.reply('Usage: m.tp <player> <target>');
                try {
                    await rconManager.execute(`tp ${args[0]} ${args[1]}`);
                    await message.reply(`✅ Teleported ${args[0]} to ${args[1]}`);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'heal':
                if (!args.length) return message.reply('Usage: m.heal <user>');
                try {
                    await rconManager.execute(`heal ${args[0]}`);
                    await message.reply(`✅ Healed ${args[0]}`);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'kill':
                if (!args.length) return message.reply('Usage: m.kill <user>');
                try {
                    await rconManager.execute(`kill ${args[0]}`);
                    await message.reply(`✅ Killed ${args[0]}`);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'gm':
            case 'gamemode':
                if (args.length < 2) return message.reply('Usage: m.gm <survival/creative/adventure/spectator> <user>');
                const modeMap = { survival: 0, creative: 1, adventure: 2, spectator: 3 };
                if (!modeMap[args[0]]) return message.reply('Invalid mode');
                try {
                    await rconManager.execute(`gamemode ${modeMap[args[0]]} ${args[1]}`);
                    await message.reply(`✅ Set ${args[1]} to ${args[0]}`);
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'save':
                try {
                    await rconManager.execute('save-all');
                    await message.reply('✅ World saved');
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'reload':
                try {
                    await rconManager.execute('reload');
                    await message.reply('✅ Server reloaded');
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'stop':
                try {
                    await rconManager.execute('stop');
                    await message.reply('🛑 Server stopping...');
                } catch (error) {
                    await message.reply(`❌ Error: ${error.message}`);
                }
                break;

            case 'do':
                await handleDoCommand(message, args);
                break;

            case 'case':
                await handleCaseCommand(message, args);
                break;

            default:
                return false;
        }
    } catch (error) {
        console.error('Command error:', error);
        await message.reply(`❌ Error: ${error.message.substring(0, 200)}`);
    }
    return true;
}

function initMinecraftSystem(client) {
    global.client = client;
    loadStatusConfig();
    startStatusUpdater();
    if (!global.pendingPlans) global.pendingPlans = new Map();
    console.log('🎮 Minecraft RCON System Initialized (no WorldEdit)');
    console.log('🤖 AI system ready. Owner ID: ' + OWNER_ID);
}

process.on('SIGINT', async () => {
    await rconManager.disconnect();
    if (statusUpdateInterval) clearInterval(statusUpdateInterval);
});

// ----- Slash Command Definitions -----
const commands = [
    { name: 'status', description: 'Check Minecraft server status' },
    { name: 'players', description: 'Show online players' },
    { name: 'list', description: 'Show Minecraft list command' },
    { name: 'serverinfo', description: 'Show detailed server info' },
    { name: 'help', description: 'Show all commands' },
    { name: 'tps', description: 'Show server TPS' },
    { name: 'uptime', description: 'Show server uptime' },
    { name: 'seen', description: 'Check when a player was last seen', options: [{ name: 'username', type: 3, required: true }] },
    { name: 'playerinfo', description: 'Get detailed player info', options: [{ name: 'username', type: 3, required: true }] },
    { name: 'playtime', description: 'Check a player\'s playtime', options: [{ name: 'username', type: 3, required: true }] },
    { name: 'say', description: 'Send a message', options: [{ name: 'message', type: 3, required: true }] },
    { name: 'kick', description: 'Kick a player', options: [{ name: 'username', type: 3, required: true }, { name: 'reason', type: 3, required: false }] },
    { name: 'ban', description: 'Ban a player', options: [{ name: 'username', type: 3, required: true }, { name: 'reason', type: 3, required: false }] },
    { name: 'pardon', description: 'Unban a player', options: [{ name: 'username', type: 3, required: true }] },
    { name: 'op', description: 'Grant operator', options: [{ name: 'username', type: 3, required: true }] },
    { name: 'deop', description: 'Revoke operator', options: [{ name: 'username', type: 3, required: true }] },
    { name: 'time', description: 'Set time', options: [{ name: 'timeofday', type: 3, required: true, choices: [{ name: 'Day', value: 'day' }, { name: 'Night', value: 'night' }, { name: 'Sunset', value: 'sunset' }, { name: 'Midnight', value: 'midnight' }] }] },
    { name: 'weather', description: 'Set weather', options: [{ name: 'type', type: 3, required: true, choices: [{ name: 'Clear', value: 'clear' }, { name: 'Rain', value: 'rain' }, { name: 'Thunder', value: 'thunder' }] }] },
    { name: 'execute', description: 'Run any command', options: [{ name: 'command', type: 3, required: true }] },
    { name: 'playerdata', description: 'View player data', options: [{ name: 'username', type: 3, required: true }, { name: 'datatype', type: 3, required: true, choices: [{ name: 'Position', value: 'position' }, { name: 'Inventory', value: 'inventory' }, { name: 'Ender Chest', value: 'enderchest' }] }] },
    { name: 'give', description: 'Give items', options: [{ name: 'username', type: 3, required: true }, { name: 'item', type: 3, required: true }, { name: 'amount', type: 4, required: false }] },
    { name: 'teleport', description: 'Teleport player', options: [{ name: 'player', type: 3, required: true }, { name: 'target', type: 3, required: true }] },
    { name: 'heal', description: 'Heal player', options: [{ name: 'username', type: 3, required: true }] },
    { name: 'kill', description: 'Kill player', options: [{ name: 'username', type: 3, required: true }] },
    { name: 'gamemode', description: 'Change gamemode', options: [{ name: 'username', type: 3, required: true }, { name: 'mode', type: 3, required: true, choices: [{ name: 'Survival', value: 'survival' }, { name: 'Creative', value: 'creative' }, { name: 'Adventure', value: 'adventure' }, { name: 'Spectator', value: 'spectator' }] }] },
    { name: 'save', description: 'Save the world' },
    { name: 'reload', description: 'Reload server configurations' },
    { name: 'stop', description: 'Stop the server (use with caution!)' }
];

async function handleSlashCommand(interaction) {
    // Placeholder – actual mapping not needed, prefix handles all.
}

// ----- Exports -----
module.exports = {
    commands,
    handleSlashCommand,
    handlePrefixCommand,
    initMinecraftSystem,
    rconManager,
    handleButtonInteraction
};