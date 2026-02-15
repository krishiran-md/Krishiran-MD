/**
 * Krishiran MD - A WhatsApp Bot
 * Copyright (c) 2026 ASUNAX
 * 
 * MIT License
 */

require('./settings')
const fs = require('fs')
const chalk = require('chalk')
const path = require('path')
const pino = require('pino')
const NodeCache = require("node-cache")
const readline = require("readline")
const { handleMessages, handleGroupParticipantUpdate, handleStatus } = require('./main')
const PhoneNumber = require('awesome-phonenumber')
const { imageToWebp, videoToWebp, writeExifImg, writeExifVid } = require('./lib/exif')
const { smsg, isUrl, generateMessageTag, getBuffer, getSizeMedia, fetch, sleep, reSize } = require('./lib/myfunc')
const store = require('./lib/lightweight_store')
const settings = require('./settings')
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, jidNormalizedUser, jidDecode, makeCacheableSignalKeyStore, DisconnectReason, delay } = require("@whiskeysockets/baileys")

// Initialize store
store.readFromFile()
setInterval(() => store.writeToFile(), settings.storeWriteInterval || 10000)

// Garbage collection
if (global.gc) setInterval(() => global.gc(), 60_000)

// RAM monitor
setInterval(() => {
    const used = process.memoryUsage().rss / 1024 / 1024
    if (used > 400) {
        console.log(chalk.red('⚠️ RAM too high, restarting bot...'))
        process.exit(1)
    }
}, 30_000)

// Global bot info
global.botname = "KRISHIRAN MD"
global.themeemoji = "•"
let phoneNumber = global.phoneNumber || settings.ownerNumber || process.env.OWNER_NUMBER || '911234567890'

// Readline fallback (interactive)
const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin, output: process.stdout }) : null
const question = (text) => rl ? new Promise(resolve => rl.question(text, resolve)) : Promise.resolve(phoneNumber)

async function startKrishiranMD() {
    try {
        let { version } = await fetchLatestBaileysVersion()
        const { state, saveCreds } = await useMultiFileAuthState('./session')
        const msgRetryCounterCache = new NodeCache()

        const XeonBotInc = makeWASocket({
            version,
            logger: pino({ level: 'silent' }),
            printQRInTerminal: true,
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
        })

        XeonBotInc.ev.on('creds.update', saveCreds)
        store.bind(XeonBotInc.ev)
        XeonBotInc.public = true
        XeonBotInc.serializeM = (m) => smsg(XeonBotInc, m, store)

        // Pairing code handling
        if (!XeonBotInc.authState.creds.registered) {
            phoneNumber = phoneNumber.toString().replace(/[^0-9]/g, '')
            const pn = new PhoneNumber('+' + phoneNumber)
            if (!pn.isValid()) {
                console.log(chalk.red(`⚠️ Warning: phone number invalid, using fallback.`))
                phoneNumber = '911234567890'
            }

            setTimeout(async () => {
                try {
                    let code = await XeonBotInc.requestPairingCode(phoneNumber)
                    code = code?.match(/.{1,4}/g)?.join("-") || code
                    console.log(chalk.bgGreen.black(`Your Pairing Code:`), chalk.white(code))
                    console.log(chalk.yellow(`Scan this code in WhatsApp > Settings > Linked Devices > Link a Device`))
                } catch (err) {
                    console.error('Failed to request pairing code:', err)
                }
            }, 3000)
        }

        // Messages
        XeonBotInc.ev.on('messages.upsert', async chatUpdate => {
            try {
                const mek = chatUpdate.messages[0]
                if (!mek.message) return
                mek.message = Object.keys(mek.message)[0] === 'ephemeralMessage' ? mek.message.ephemeralMessage.message : mek.message
                if (mek.key && mek.key.remoteJid === 'status@broadcast') {
                    await handleStatus(XeonBotInc, chatUpdate); return
                }
                if (!XeonBotInc.public && !mek.key.fromMe && chatUpdate.type === 'notify') {
                    if (!mek.key.remoteJid?.endsWith('@g.us')) return
                }
                try { await handleMessages(XeonBotInc, chatUpdate, true) } catch (err) { console.error(err) }
            } catch (err) { console.error(err) }
        })

        // Group participants
        XeonBotInc.ev.on('group-participants.update', async (update) => {
            await handleGroupParticipantUpdate(XeonBotInc, update)
        })

        // Status updates
        XeonBotInc.ev.on('status.update', async (status) => {
            await handleStatus(XeonBotInc, status)
        })

        // Connection
        XeonBotInc.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update
            if (qr) console.log(chalk.yellow('📱 QR Code generated. Scan with WhatsApp'))
            if (connection === 'connecting') console.log(chalk.yellow('🔄 Connecting...'))
            if (connection === 'open') {
                console.log(chalk.green(`✅ Connected as ${XeonBotInc.user?.id || 'UNKNOWN'}`))
            }
            if (connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut
                if (shouldReconnect) {
                    console.log(chalk.yellow('Reconnecting...'))
                    await delay(5000)
                    startKrishiranMD()
                }
            }
        })

        return XeonBotInc
    } catch (err) {
        console.error('Fatal error in startKrishiranMD:', err)
        await delay(5000)
        startKrishiranMD()
    }
}

// Start bot
startKrishiranMD().catch(console.error)

// Global error handlers
process.on('uncaughtException', (err) => console.error('Uncaught Exception:', err))
process.on('unhandledRejection', (err) => console.error('Unhandled Rejection:', err))

// Hot reload
let file = require.resolve(__filename)
fs.watchFile(file, () => {
    fs.unwatchFile(file)
    delete require.cache[file]
    require(file)
})
