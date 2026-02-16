/**
 * Krishiran MD - WhatsApp Public Bot
 * Author: ASUNAX
 * License: MIT
 */

require('./settings');
const fs = require('fs');
const chalk = require('chalk');
const path = require('path');
const pino = require('pino');
const NodeCache = require("node-cache");
const express = require('express');
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main');
const { smsg } = require('./lib/myfunc');
const store = require('./lib/lightweight_store');
const settings = require('./settings');
const {
    default: makeWASocket,
    useMultiFileAuthState,
    fetchLatestBaileysVersion,
    jidNormalizedUser,
    jidDecode,
    makeCacheableSignalKeyStore,
    DisconnectReason,
    delay
} = require("@whiskeysockets/baileys");

// ---------- Initialize Store ----------
store.readFromFile();
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000);

// ---------- RAM & GC ----------
if (global.gc) setInterval(() => global.gc(), 60_000);
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024;
    if (used > 400) {
        console.log(chalk.red('⚠️ RAM too high, restarting bot...'));
        process.exit(1);
    }
}, 30_000);

// ---------- Global ----------
global.botname = "KRISHIRAN MD";
global.themeemoji = "•";
let qrCache = ""; // Store QR code base64 for frontend

// ---------- Express Frontend ----------
const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.static('public'));

// Endpoint for QR code
app.get('/qr', (req, res) => {
    if (!qrCache) return res.json({ qr: null });
    res.json({ qr: qrCache });
});

// Endpoint for parrain code (Pairing Code)
app.get('/paircode', async (req, res) => {
    if (!global.lastPairingCode) return res.json({ code: null });
    res.json({ code: global.lastPairingCode });
});

// Start server
app.listen(PORT, () => console.log(`🌐 Frontend running at http://localhost:${PORT}`));

// ---------- Start WhatsApp Bot ----------
async function startKrishiranMD() {
    try {
        let { version } = await fetchLatestBaileysVersion();
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
        XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store);

        // ---------- Messages ----------
        XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
            try {
                const mek = chatUpdate.messages[0];
                if (!mek.message) return;
                mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage' ? mek.message.ephemeralMessage.message : mek.message;
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, chatUpdate);
                    return;
                }
                await handleMessages(XeonBotInc, chatUpdate, true);
            } catch (err) {
                console.error(err);
            }
        });

        // ---------- Group Participants ----------
        XeonBotInc.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(XeonBotInc, update);
        });

        // ---------- Status Updates ----------
        XeonBotInc.ev.on('status.update', async (status) => {
            await handleStatus(XeonBotInc, status);
        });

        // ---------- Connection ----------
        XeonBotInc.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                // Save QR code for frontend
                qrCache = qr;
                global.lastPairingCode = qr; // Also available as "parrain code"
                console.log(chalk.yellow('📱 QR Code generated, scan to connect.'));
            }

            if (connection === 'connecting') console.log(chalk.yellow('🔄 Connecting...'));
            if (connection === 'open') console.log(chalk.green(`✅ Connected as ${XeonBotInc.user?.id || 'UNKNOWN'}`));

            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
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

// ---------- Start Bot ----------
startKrishiranMD().catch(console.error);

// ---------- Global Errors ----------
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err));
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err));

// ---------- Hot Reload ----------
let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    delete require.cache[file];
    require(file);
});
