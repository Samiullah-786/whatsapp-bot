import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import fs from 'fs';
import path from 'path';

// ⚠️ BOT OWNER NUMBER (Jahan DM mein Help alert jayega)
const BOT_OWNER_NUMBER = '923404908660@s.whatsapp.net';

const userStickerTracker = new Map();
const stickerMutedUsers = new Map();
const userWarnings = new Map();
const activeSongMenus = new Map();

// -------------------------------------------------------------
// 📌 BAD WORDS LIST (Yahan mazeed words add kar sakte hain)
// -------------------------------------------------------------
const BAD_WORDS_LIST = [
    'bc',
    'madarchod',
    'mc',
    'bhosdike',
    'bhosdi',
    'bhosdiwala',
    'bhosdike',
    'BSDK',
    'BKL',
    'randi',
    'chutiya',
    'bitch',
    'fuck',
    'harami',
    'kutta',
    'kamina',
    'chutia',
    'fuck off',
    'fuck you',
    'bhenchod',
    'bhen ki chut',
    'bhen ki choot',
    'BKL',
    'bhen ke lode',
    'lund',
    'loda',
    'lodu',
    'loduwa',
    'loduwaala',
    'lund ka bacha',
    'choot',
    'choot ka bacha',
    'chut',
    'chut ka bacha',
    'mummy',
    'pussy',
    'sex',
];

const messageQueue = [];
let isProcessingQueue = false;

async function processDeleteQueue(sock) {
    if (isProcessingQueue || messageQueue.length === 0) return;
    isProcessingQueue = true;

    while (messageQueue.length > 0) {
        const item = messageQueue.shift();
        try {
            await sock.sendMessage(item.chatId, {
                delete: {
                    remoteJid: item.chatId,
                    fromMe: false,
                    id: item.msgId,
                    participant: item.sender
                }
            });
            await new Promise(resolve => setTimeout(resolve, 400));
        } catch (err) {
            console.log('⚠️ Delete failed:', err.message || err);
        }
    }

    isProcessingQueue = false;
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'silent' }),
        browser: ['SimpleGuardBot', 'Chrome', '1.0.0']
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('\n📱 Scan this QR code with your WhatsApp:\n');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect?.error)?.output?.statusCode;
            const isLoggedOut = statusCode === DisconnectReason.loggedOut;

            if (isLoggedOut) {
                if (fs.existsSync('auth_info_baileys')) {
                    fs.rmSync('auth_info_baileys', { recursive: true, force: true });
                }
                startBot();
            } else {
                setTimeout(() => startBot(), 3000);
            }
        } else if (connection === 'open') {
            console.log('✅ Final Guard Bot is LIVE!');
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        try {
            const msg = m.messages[0];
            if (!msg || !msg.message || msg.key.fromMe) return;

            const chatId = msg.key.remoteJid;
            const isGroup = chatId.endsWith('@g.us');

            if (!isGroup) return;

            const sender = msg.key.participant || msg.participant;
            const messageType = Object.keys(msg.message)[0];

            const messageText =
                msg.message.conversation ||
                msg.message.extendedTextMessage?.text ||
                msg.message.imageMessage?.caption ||
                msg.message.videoMessage?.caption ||
                '';

            const lowerText = messageText.trim().toLowerCase();

            // Direct Live Metadata Fetch for Admin Status
            let groupMetadata = null;
            let groupAdminsList = [];
            let isAdmin = false;

            try {
                groupMetadata = await sock.groupMetadata(chatId);
                const participants = groupMetadata?.participants || [];

                groupAdminsList = participants
                    .filter(p => p.admin === 'admin' || p.admin === 'superadmin')
                    .map(p => p.id);

                isAdmin = groupAdminsList.includes(sender);
            } catch (err) {
                console.log('Metadata error:', err.message);
            }

            // -------------------------------------------------------------
            // 📌 1. ADMIN COMMANDS (ADD & KICK/REMOVE)
            // -------------------------------------------------------------

            // ADD MEMBER (!add 923001234567)
            if (lowerText.startsWith('!add')) {
                if (!isAdmin) {
                    await sock.sendMessage(chatId, { text: '❌ Sirf Group Admins member add kar sakte hain!' });
                    return;
                }

                const args = messageText.trim().split(' ');
                if (args.length < 2) {
                    await sock.sendMessage(chatId, { text: '⚠️ *Usage:* `!add 923001234567`' });
                    return;
                }

                let targetNum = args[1].replace(/[^0-9]/g, '');
                if (targetNum && targetNum.length >= 10) {
                    targetNum += '@s.whatsapp.net';
                    try {
                        await sock.groupParticipantsUpdate(chatId, [targetNum], 'add');
                        await sock.sendMessage(chatId, { text: `✅ User @${targetNum.split('@')[0]} ko add kar diya gaya!`, mentions: [targetNum] });
                    } catch (err) {
                        await sock.sendMessage(chatId, { text: '❌ Add request fail ho gayi.' });
                    }
                } else {
                    await sock.sendMessage(chatId, { text: '⚠️ Sahi phone number likhein (e.g. 923001234567).' });
                }
                return;
            }

            // REMOVE / KICK MEMBER
            if (lowerText.startsWith('!remove') || lowerText.startsWith('kick') || lowerText.startsWith('!kick')) {
                if (!isAdmin) {
                    await sock.sendMessage(chatId, { text: '❌ Sirf Group Admins kisi ko remove kar sakte hain!' });
                    return;
                }

                let targetUser = null;

                const args = messageText.trim().split(' ');
                if (args.length >= 2) {
                    let num = args[1].replace(/[^0-9]/g, '');
                    if (num && num.length >= 10) targetUser = num + '@s.whatsapp.net';
                }

                if (!targetUser) {
                    const mentions = msg.message.extendedTextMessage?.contextInfo?.mentionedJid;
                    if (mentions && mentions.length > 0) targetUser = mentions[0];
                }

                if (!targetUser) {
                    const quoted = msg.message.extendedTextMessage?.contextInfo?.participant;
                    if (quoted) targetUser = quoted;
                }

                if (!targetUser) {
                    await sock.sendMessage(chatId, { text: '⚠️ *Usage:* `kick 923001234567`, ya `kick @user`, ya message par reply karke `kick` likhein.' });
                    return;
                }

                try {
                    await sock.groupParticipantsUpdate(chatId, [targetUser], 'remove');
                    await sock.sendMessage(chatId, { text: `🚫 User @${targetUser.split('@')[0]} ko group se remove kar diya gaya!`, mentions: [targetUser] });
                } catch (err) {
                    await sock.sendMessage(chatId, { text: '❌ Kick fail ho gaya. WhatsApp settings mein bot ko Admin status check karein.' });
                }
                return;
            }

            // -------------------------------------------------------------
            // 📌 2. HI / HELLO / BOT (TAG GROUP ADMINS)
            // -------------------------------------------------------------
            if (lowerText === 'hi' || lowerText === 'hello' || lowerText === 'bot') {
                if (groupAdminsList.length > 0) {
                    let adminTagsText = `👋 Hello @${sender.split('@')[0]}!\n\n📌 Group Admins Attention:\n`;
                    groupAdminsList.forEach(adminJid => {
                        adminTagsText += `• @${adminJid.split('@')[0]}\n`;
                    });

                    await sock.sendMessage(chatId, {
                        text: adminTagsText,
                        mentions: [sender, ...groupAdminsList]
                    }, { quoted: msg });
                }
                return;
            }

            // -------------------------------------------------------------
            // 📌 3. HELP COMMAND (FIXED REAL NUMBER DM ALERT)
            // -------------------------------------------------------------
            if (lowerText === 'help' || lowerText === '!help') {
                let senderJid = sender;
                if (msg.key.participant) {
                    senderJid = msg.key.participant;
                }
                const senderNum = senderJid.replace(/[^0-9]/g, '');
                const groupName = groupMetadata ? groupMetadata.subject : 'Group';

                await sock.sendMessage(chatId, {
                    text: `📩 @${sender.split('@')[0]} Aapki help request Admin ko bhej di gayi hai. Admin aap se jaldi rabta karega!`,
                    mentions: [sender]
                });

                const alertMessage = `🚨 *HELP REQUEST ALERT!*\n\n👤 *User Number:* +${senderNum}\n👥 *Group:* ${groupName}\n💬 *Detail:* Is user ne group mein help mangi hai.`;

                try {
                    await sock.sendMessage(BOT_OWNER_NUMBER, { text: alertMessage });
                } catch (err) {
                    console.log('⚠️ Alert DM Send Failed:', err.message);
                }
                return;
            }

            // -------------------------------------------------------------
            // 📌 4. SONGS SYSTEM (!song / !play)
            // -------------------------------------------------------------
            if (lowerText.startsWith('!song') || lowerText.startsWith('!play') || lowerText === 'song') {
                const songsFolder = './songs';

                if (!fs.existsSync(songsFolder)) {
                    fs.mkdirSync(songsFolder, { recursive: true });
                }

                const files = fs.readdirSync(songsFolder).filter(file => file.endsWith('.mp3') || file.endsWith('.m4a'));

                if (files.length === 0) {
                    await sock.sendMessage(chatId, {
                        text: '🎵 Server par filhal koi song nahi hai. Project ke `./songs` folder mein `.mp3` files add karein.'
                    });
                    return;
                }

                activeSongMenus.set(chatId, files);

                let menuText = `🎵 *AVAILABLE SONGS LIST* 🎵\n\nAap konsa song sunna chahte hain? Song ka *NUMBER* ya *NAAM* reply karein:\n\n`;
                files.forEach((file, idx) => {
                    menuText += `*${idx + 1}.* ${file.replace(/\.(mp3|m4a)$/i, '')}\n`;
                });

                menuText += `\n👉 Example: Group mein sirf \`1\` ya song ka naam likhein.`;

                await sock.sendMessage(chatId, { text: menuText });
                return;
            }

            if (activeSongMenus.has(chatId)) {
                const songList = activeSongMenus.get(chatId);
                let selectedSong = null;

                const numChoice = parseInt(messageText.trim());
                if (!isNaN(numChoice) && numChoice >= 1 && numChoice <= songList.length) {
                    selectedSong = songList[numChoice - 1];
                } else {
                    selectedSong = songList.find(f => f.toLowerCase().includes(lowerText));
                }

                if (selectedSong) {
                    const songPath = path.join('./songs', selectedSong);
                    await sock.sendMessage(chatId, { text: `🎶 Playing: *${selectedSong}*...` });

                    try {
                        const audioBuffer = fs.readFileSync(songPath);
                        await sock.sendMessage(chatId, {
                            audio: audioBuffer,
                            mimetype: 'audio/mpeg',
                            ptt: false
                        }, { quoted: msg });

                        activeSongMenus.delete(chatId);
                    } catch (err) {
                        console.log('Song Play Error:', err);
                    }
                    return;
                }
            }

            // -------------------------------------------------------------
            // 📌 5. MODERATION: LINKS, STICKERS & BAD WORDS (NON-ADMINS)
            // -------------------------------------------------------------
            if (!isAdmin) {
                const now = Date.now();

                // 🛑 A. BAD WORDS FILTER (Only Delete + Warning, No Kick)
                const containsBadWord = BAD_WORDS_LIST.some(word => lowerText.includes(word.toLowerCase()));
                if (containsBadWord) {
                    messageQueue.push({ chatId, msgId: msg.key.id, sender });
                    processDeleteQueue(sock);

                    await sock.sendMessage(chatId, {
                        text: `⚠️ @${sender.split('@')[0]} Is tarah ki bad wording / galiyan group mein allowed nahi hain!`,
                        mentions: [sender]
                    });
                    return;
                }

                // 🛑 B. ANTI-LINK SYSTEM (5 Warnings then Kick)
                const linkRegex = /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(chat\.whatsapp\.com\/[^\s]+)|(t\.me\/[^\s]+)/gi;
                if (linkRegex.test(messageText)) {
                    messageQueue.push({ chatId, msgId: msg.key.id, sender });
                    processDeleteQueue(sock);

                    let currentWarnings = (userWarnings.get(sender) || 0) + 1;
                    userWarnings.set(sender, currentWarnings);

                    if (currentWarnings < 5) {
                        await sock.sendMessage(chatId, {
                            text: `⚠️ *Warning ${currentWarnings}/5:* @${sender.split('@')[0]} Group mein link bhejna mana hai!`,
                            mentions: [sender]
                        });
                    } else {
                        userWarnings.delete(sender);
                        try {
                            await sock.groupParticipantsUpdate(chatId, [sender], 'remove');
                            await sock.sendMessage(chatId, { text: `🚫 @${sender.split('@')[0]} ko 5 warnings ke baad KICK kar diya gaya!`, mentions: [sender] });
                        } catch (err) {
                            console.log('Kick error:', err);
                        }
                    }
                    return;
                }

                // 🛑 C. ANTI-STICKER SPAM (Strictly only deletes stickers and mutes sticker usage for 5 mins)
                if (messageType === 'stickerMessage') {
                    const muteTime = stickerMutedUsers.get(sender) || 0;

                    if (now < muteTime) {
                        messageQueue.push({ chatId, msgId: msg.key.id, sender });
                        processDeleteQueue(sock);
                        return;
                    }

                    const timestamps = userStickerTracker.get(sender) || [];
                    const validStickers = timestamps.filter(t => now - t < 2 * 60 * 1000);
                    validStickers.push(now);
                    userStickerTracker.set(sender, validStickers);

                    if (validStickers.length >= 10) {
                        stickerMutedUsers.set(sender, now + 5 * 60 * 1000);
                        userStickerTracker.delete(sender);

                        messageQueue.push({ chatId, msgId: msg.key.id, sender });
                        processDeleteQueue(sock);

                        await sock.sendMessage(chatId, {
                            text: `🚫 @${sender.split('@')[0]} 10 stickers limit cross hone par agle 5 min ke liye aapke stickers block kar diye gaye hain (Aap baqi text messages kar sakte hain).`,
                            mentions: [sender]
                        });
                    }
                }
            }

        } catch (err) {
            console.log('⚠️ Error:', err.message || err);
        }
    });
}

process.on('uncaughtException', (err) => console.log('⚠️ Uncaught Exception:', err.message || err));
process.on('unhandledRejection', (reason) => console.log('⚠️ Unhandled Rejection:', reason?.message || reason));

startBot();