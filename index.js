/**
 * Krishiran MD - Public WhatsApp Bot
 * Copyright (c) 2026
 * MIT License
 */

require('./settings');
const fs = require('fs');
const chalk = require('chalk');
const pino = require('pino');
const NodeCache = require("node-cache");
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const store = require('./lib/lightweight_store');
const settings = require('./settings');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, jidNormalizedUser, makeCacheableSignalKeyStore, DisconnectReason, delay } = require("@whiskeysockets/baileys");

// Initialize lightweight store
store.readFromFile();
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000);

// RAM & garbage collection
if (global.gc) setInterval(() => global.gc(), 60_000);
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024;
    if (used > 400) {
        console.log(chalk.red('⚠️ RAM too high, restarting bot...'));
        process.exit(1);
    }
}, 30_000);

// Start the bot
async function startKrishiranMD() {
    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState('./session');
        const msgRetryCounterCache = new NodeCache();

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: true, // QR Code ap parèt pou tout itilizatè
            browser: ["Ubuntu", "Chrome", "20.0.0"],
            auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: "fatal" }).child({ level: "fatal" })) },
            markOnlineOnConnect: true,
            generateHighQualityLinkPreview: true,
            syncFullHistory: false,
            getMessage: async (key) => (await store.loadMessage(jidNormalizedUser(key.remoteJid), key.id))?.message || "",
            msgRetryCounterCache,
            defaultQueryTimeoutMs: 60000,
            connectTimeoutMs: 60000,
            keepAliveIntervalMs: 10000
        });

        XeonBotInc.ev.on('creds.update', saveCreds);
        store.bind(XeonBotInc.ev);

        XeonBotInc.public = true; // Tout itilizatè ka voye lòd
        XeonBotInc.serializeM = (m) => m;

        // Messages
        XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek.message) return;
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, chatUpdate);
                    return;
                }
                await handleMessages(XeonBotInc, chatUpdate, true);
            } catch (err) { console.error(err); }
        });

        // Group participants
        XeonBotInc.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(XeonBotInc, update);
        });

        // Status updates
        XeonBotInc.ev.on('status.update', async (status) => {
            await handleStatus(XeonBotInc, status);
        });

        // Connection updates
        XeonBotInc.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) console.log(chalk.yellow('📱 QR Code generated. Scan with WhatsApp to start using bot.'));
            if (connection === 'connecting') console.log(chalk.yellow('🔄 Connecting...'));
            if (connection === 'open') console.log(chalk.green(`✅ Bot connected successfully!`));
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut);
                if (shouldReconnect) {
                    console.log(chalk.yellow('Reconnecting...'));
                    await delay(5000);
                    startKrishiranMD();
                }
            }
        });

        return XeonBotInc;
    } catch (err) {
        console.error('Fatal error:', err);
        await delay(5000);
        startKrishiranMD();
    }
}

// Start bot
startKrishiranMD().catch(console.error);

// Global error handlers
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));

// Hot reload
let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    delete require.cache[file];
    require(file);
});
