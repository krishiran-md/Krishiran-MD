/**
 * Krishiran MD - Public WhatsApp Bot
 * Copyright (c) 2026 ASUNAX
 * MIT License
 */

require('./settings');
const fs = require('fs');
const chalk = require('chalk');
const pino = require('pino');
const NodeCache = require("node-cache");
const express = require('express');
const crypto = require('crypto');
const qrcode = require('qrcode');
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const { smsg, jidNormalizedUser } = require('./lib/myfunc');
const store = require('./lib/lightweight_store');
const settings = require('./settings');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, jidDecode, makeCacheableSignalKeyStore, DisconnectReason, delay } = require("@whiskeysockets/baileys");

// --------------------------- EXPRESS FRONTEND ---------------------------
const app = express();
app.use(express.static('public'));

let latestQR = '';
let referralCodes = {}; // { jid: code }

function generateReferralCode() {
    return crypto.randomBytes(3).toString('hex'); // 6 characters
}

app.get('/qr', (req, res) => res.json({ qr: latestQR }));
app.get('/referral/:jid', (req, res) => {
    const jid = req.params.jid;
    if (!referralCodes[jid]) referralCodes[jid] = generateReferralCode();
    res.json({ code: referralCodes[jid] });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(chalk.green(`Frontend server running on port ${PORT}`)));

// --------------------------- BOT ---------------------------
store.readFromFile();
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000);

// Garbage collection & RAM monitor
if (global.gc) setInterval(() => global.gc(), 60_000);
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024;
    if (used > 400) {
        console.log(chalk.red('⚠️ RAM too high, restarting bot...'));
        process.exit(1);
    }
}, 30_000);

// Start bot
async function startKrishiranMD() {
    try {
        const { version } = await fetchLatestBaileysVersion();
        const { state, saveCreds } = await useMultiFileAuthState('./session');
        const msgRetryCounterCache = new NodeCache();

        const bot = makeWASocket({
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

        bot.ev.on('creds.update', saveCreds);
        store.bind(bot.ev);
        bot.public = true;
        bot.serializeM = (m) => smsg(bot, m, store);

        // Messages
        bot.ev.on('messages.upsert', async chatUpdate => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek.message) return;
                mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage' ? mek.message.ephemeralMessage.message : mek.message;
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(bot, chatUpdate);
                    return;
                }
                try { await handleMessages(bot, chatUpdate, true); } catch (err) { console.error(err); }
            } catch (err) { console.error(err); }
        });

        // Group participants
        bot.ev.on('group-participants.update', async update => {
            await handleGroupParticipantUpdate(bot, update);
        });

        // Status updates
        bot.ev.on('status.update', async status => {
            await handleStatus(bot, status);
        });

        // Connection updates
        bot.ev.on('connection.update', async update => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                latestQR = await qrcode.toDataURL(qr);
                console.log(chalk.yellow('📱 QR Code generated. Scan with WhatsApp.'));
            }

            if (connection === 'connecting') console.log(chalk.yellow('🔄 Connecting...'));
            if (connection === 'open') console.log(chalk.green(`✅ Connected as ${bot.user?.id || 'UNKNOWN'}`));

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
                if (shouldReconnect) {
                    console.log(chalk.yellow('Reconnecting...'));
                    await delay(5000);
                    startKrishiranMD();
                }
            }
        });

        return bot;
    } catch (err) {
        console.error('Fatal error in startKrishiranMD:', err);
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
