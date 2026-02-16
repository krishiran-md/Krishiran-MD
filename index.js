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
const store = require('./lib/lightweight_store');
const settings = require('./settings');
const qrcode = require('qrcode');

const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, jidNormalizedUser, makeCacheableSignalKeyStore, DisconnectReason, delay } = require("@whiskeysockets/baileys");

// Initialize store
store.readFromFile();
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000);

// Garbage collection
if (global.gc) setInterval(() => global.gc(), 60_000);

// RAM monitor
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024;
    if (used > 400) {
        console.log(chalk.red('⚠️ RAM too high, restarting bot...'));
        process.exit(1);
    }
}, 30_000);

global.botname = settings.botName || "KRISHIRAN MD";

async function startKrishiranMD() {
    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState('./session');
        const msgRetryCounterCache = new NodeCache();

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
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
        XeonBotInc.public = true;
        XeonBotInc.serializeM = (m) => m;

        // Messages handler
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

        // Connection update
        XeonBotInc.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                // Convert QR to Base64 for frontend display
                try {
                    const qrDataURL = await qrcode.toDataURL(qr);
                    console.log(chalk.yellow('📱 QR Code ready! Send this URL to frontend:'));
                    console.log(qrDataURL);
                } catch (err) {
                    console.error('QR generation error:', err);
                }
            }

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
