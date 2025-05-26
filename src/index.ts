import { Telegraf, Context } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllChatIds, saveChatId, fetchChatIdsFromSheet } from './utils/chatStore';
import { db, ref, push, set } from './utils/firebase';
import { saveToSheet } from './utils/saveToSheet';
import { about, help } from './commands';
import { study } from './commands/study';
import { neet } from './commands/neet';
import { jee } from './commands/jee';
import { groups } from './commands/groups';
import { quizes } from './text';
import { greeting } from './text';
import { development, production } from './core';
import { isPrivateChat } from './utils/groupSettings';
import { me } from './commands/me';
import { quote } from './commands/quotes';
import { playquiz, handleQuizActions } from './playquiz';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const ADMIN_ID = 6930703214;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not provided!');
const bot = new Telegraf(BOT_TOKEN);

// Store pending question submissions
interface PendingQuestion {
  subject: string;
  chapter: string;
  count: number;
  questions: Array<{
    question: string;
    options: { [key: string]: string };
    correct_option: string;
    explanation: string;
    image?: string;
  }>;
}

const pendingSubmissions: { [key: number]: PendingQuestion } = {};

// --- COMMANDS ---
bot.command('about', about());
bot.command('help', help());
bot.command('study', study());
bot.command('neet', neet());
bot.command('jee', jee());
bot.command('groups', groups());
bot.command(['me', 'user', 'info'], me());
bot.command('quote', quote());
bot.command('quiz', playquiz());

// New command to show user count from Google Sheets
bot.command('users', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    return ctx.reply('You are not authorized to use this command.');
  }

  try {
    const chatIds = await fetchChatIdsFromSheet();
    const totalUsers = chatIds.length;

    await ctx.reply(`📊 Total users: ${totalUsers}`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: 'Refresh', callback_data: 'refresh_users' }]],
      },
    });
  } catch (err) {
    console.error('Failed to fetch user count:', err);
    await ctx.reply('❌ Error: Unable to fetch user count from Google Sheet.');
  }
});

// Handle refresh button for user count
bot.action('refresh_users', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    await ctx.answerCbQuery('Unauthorized');
    return;
  }

  try {
    const chatIds = await fetchChatIdsFromSheet();
    const totalUsers = chatIds.length;

    await ctx.editMessageText(`📊 Total users: ${totalUsers} (refreshed)`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: 'Refresh', callback_data: 'refresh_users' }]],
      },
    });
    await ctx.answerCbQuery('Refreshed!');
  } catch (err) {
    console.error('Failed to refresh user count:', err);
    await ctx.answerCbQuery('Refresh failed');
  }
});

// Broadcast to all saved chat IDs
bot.command('broadcast', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) return ctx.reply('You are not authorized to use this command.');

  const msg = ctx.message.text?.split(' ').slice(1).join(' ');
  if (!msg) return ctx.reply('Usage:\n/broadcast Your message here');

  let chatIds: number[] = [];

  try {
    chatIds = await fetchChatIdsFromSheet();
  } catch (err) {
    console.error('Failed to fetch chat IDs:', err);
    return ctx.reply('❌ Error: Unable to fetch chat IDs from Google Sheet.');
  }

  if (chatIds.length === 0) {
    return ctx.reply('No users to broadcast to.');
  }

  let success = 0;
  for (const id of chatIds) {
    try {
      await ctx.telegram.sendMessage(id, msg);
      success++;
    } catch (err) {
      console.log(`Failed to send to ${id}`, err);
    }
  }

  await ctx.reply(`✅ Broadcast sent to ${success} users.`);
});

// Admin reply to user via command
bot.command('reply', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) return ctx.reply('You are not authorized to use this command.');

  const parts = ctx.message.text?.split(' ');
  if (!parts || parts.length < 3) {
    return ctx.reply('Usage:\n/reply <chat_id> <message>');
  }

  const chatIdStr = parts[1].trim();
  const chatId = Number(chatIdStr);
  const message = parts.slice(2).join(' ');

  if (isNaN(chatId)) {
    return ctx.reply(`Invalid chat ID: ${chatIdStr}`);
  }

  try {
    await ctx.telegram.sendMessage(chatId, `*Admin's Reply:*\n${message}`, { parse_mode: 'Markdown' });
    await ctx.reply(`Reply sent to ${chatId}`, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Reply error:', error);
    await ctx.reply(`Failed to send reply to ${chatId}`, { parse_mode: 'Markdown' });
  }
});

// Handle /add<subject> or /add<Subject>__<Chapter> commands
bot.command(/add[A-Za-z]+(__[A-Za-z_]+)?/, async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    return ctx.reply('You are not authorized to use this command.');
  }

  const command = ctx.message.text?.split(' ')[0].substring(1); // Remove leading '/'
  const countStr = ctx.message.text?.split(' ')[1];
  const count = parseInt(countStr, 10);

  if (!countStr || isNaN(count) || count <= 0) {
    return ctx.reply('Please specify a valid number of questions.\nExample: /addBiology 10 or /addBiology__Plant_Kingdom 11');
  }

  let subject = '';
  let chapter = 'Random';

  if (command.includes('__')) {
    const [subj, chp] = command.split('__');
    subject = subj.replace('add', '').replace(/_/g, ' ');
    chapter = chp.replace(/_/g, ' ');
  } else {
    subject = command.replace('add', '').replace(/_/g, ' ');
  }

  // Store pending submission
  pendingSubmissions[ctx.from.id] = {
    subject,
    chapter,
    count,
    questions: [],
  };

  await ctx.reply(`Okay, please share ${count} questions for *${subject}* (Chapter: *${chapter}*). Send each question in the format:\n\n` +
    `Question: <question>\n` +
    `A: <option A>\n` +
    `B: <option B>\n` +
    `C: <option C>\n` +
    `D: <option D>\n` +
    `Correct: <A/B/C/D>\n` +
    `Explanation: <explanation>\n` +
    `Image: <optional image URL>`, { parse_mode: 'Markdown' });
});

// User greeting and message handling
bot.start(async (ctx) => {
  if (isPrivateChat(ctx.chat.type)) {
    await ctx.reply('Welcome! Use /help to explore commands.');
    await greeting()(ctx);
  }
});

// Handle button clicks (quiz)
bot.on('callback_query', handleQuizActions());

// --- MESSAGE HANDLER ---
bot.on('message', async (ctx) => {
  const chat = ctx.chat;
  const msg = ctx.message as any; // Avoid TS for ctx.message.poll
  const chatType = chat.type;

  if (!chat?.id) return;

  // Save chat ID locally
  saveChatId(chat.id);

  // Save to Google Sheet and check if user is new
  const alreadyNotified = await saveToSheet(chat);

  // Notify admin once only for new users (private chat)
  if (chat.id !== ADMIN_ID && !alreadyNotified) {
    if (chat.type === 'private' && 'first_name' in chat) {
      const usernameText = 'username' in chat && typeof chat.username === 'string' ? `@${chat.username}` : 'N/A';
      await ctx.telegram.sendMessage(
        ADMIN_ID,
        `*New user started the bot!*\n\n*Name:* ${chat.first_name}\n*Username:* ${usernameText}\nChat ID: ${chat.id}`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // Handle /contact messages
  if (msg.text?.startsWith('/contact')) {
    const userMessage = msg.text.replace('/contact', '').trim() || msg.reply_to_message?.text;
    if (userMessage) {
      const firstName = 'first_name' in chat ? chat.first_name : 'Unknown';
      const username = 'username' in chat && typeof chat.username === 'string' ? `@${chat.username}` : 'N/A';

      await ctx.telegram.sendMessage(
        ADMIN_ID,
        `*Contact Message from ${firstName} (${username})*\nChat ID: ${chat.id}\n\nMessage:\n${userMessage}`,
        { parse_mode: 'Markdown' }
      );
      await ctx.reply('Your message has been sent to the admin!');
    } else {
      await ctx.reply('Please provide a message or reply to a message using /contact.');
    }
    return;
  }

  // Admin replies via swipe reply
  if (chat.id === ADMIN_ID && msg.reply_to_message?.text) {
    const match = msg.reply_to_message.text.match(/Chat ID: (\d+)/);
    if (match) {
      const targetId = parseInt(match[1], 10);
      try {
        await ctx.telegram.sendMessage(targetId, `*Admin's Reply:*\n${msg.text}`, { parse_mode: 'Markdown' });
      } catch (err) {
        console.error('Failed to send swipe reply:', err);
      }
    }
    return;
  }

  // Handle question submissions from admin
  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id]) {
    const submission = pendingSubmissions[chat.id];
    const text = msg.text;

    if (text) {
      // Parse question format
      const questionMatch = text.match(/Question:([\s\S]*?)(?=(?:A:|$))/i);
      const optionsMatchA = text.match(/A:([\s\S]*?)(?=(?:B:|$))/i);
      const optionsMatchB = text.match(/B:([\s\S]*?)(?=(?:C:|$))/i);
      const optionsMatchC = text.match(/C:([\s\S]*?)(?=(?:D:|$))/i);
      const optionsMatchD = text.match(/D:([\s\S]*?)(?=(?:Correct:|$))/i);
      const correctMatch = text.match(/Correct:([A-D])(?=(?:Explanation:|$))/i);
      const explanationMatch = text.match(/Explanation:([\s\S]*?)(?=(?:Image:|$))/i);
      const imageMatch = text.match(/Image:([\s\S]*?)$/i);

      if (questionMatch && optionsMatchA && optionsMatchB && optionsMatchC && optionsMatchD && correctMatch && explanationMatch) {
        const question = {
          subject: submission.subject,
          chapter: submission.chapter,
          question: questionMatch[1].trim(),
          options: {
            A: optionsMatchA[1].trim(),
            B: optionsMatchB[1].trim(),
            C: optionsMatchC[1].trim(),
            D: optionsMatchD[1].trim(),
          },
          correct_option: correctMatch[1].trim(),
          explanation: explanationMatch[1].trim(),
          image: imageMatch ? imageMatch[1].trim() : '',
        };

        submission.questions.push(question);

        if (submission.questions.length < submission.count) {
          await ctx.reply(
            `Question ${submission.questions.length} saved. Please send the next question (${submission.questions.length + 1}/${submission.count}).`
          );
        } else {
          // Save all questions to Firebase
          try {
            const questionsRef = ref(db, 'questions');
            for (const q of submission.questions) {
              const newQuestionRef = push(questionsRef);
              await set(newQuestionRef, q);
            }
            await ctx.reply(`✅ Successfully added ${submission.count} questions to *${submission.subject}* (Chapter: *${submission.chapter}*).`);
            delete pendingSubmissions[chat.id];
          } catch (error) {
            console.error('Failed to save questions to Firebase:', error);
            await ctx.reply('❌ Error: Unable to save questions to Firebase.');
          }
        }
      } else {
        await ctx.reply(
          'Invalid question format. Please use:\n\n' +
          'Question: <question>\n' +
          'A: <option A>\n' +
          'B: <option B>\n' +
          'C: <option C>\n' +
          'D: <option D>\n' +
          'Correct: <A/B/C/D>\n' +
          'Explanation: <explanation>\n' +
          'Image: <optional image URL>'
        );
      }
      return;
    }
  }

  // Detect Telegram Poll and send JSON to admin
  if (msg.poll) {
    const poll = msg.poll;
    const pollJson = JSON.stringify(poll, null, 2);

    // Save poll data to Firebase Realtime Database under /polls/
    try {
      const pollsRef = ref(db, 'polls');
      const newPollRef = push(pollsRef);
      await set(newPollRef, {
        poll,
        from: {
          id: ctx.from?.id,
          username: ctx.from?.username || null,
          first_name: ctx.from?.first_name || null,
          last_name: ctx.from?.last_name || null,
        },
        chat: {
          id: ctx.chat.id,
          type: ctx.chat.type,
        },
        receivedAt: Date.now(),
      });
    } catch (error) {
      console.error('Firebase save error:', error);
    }
    await ctx.reply('Thanks for sending a poll! Your poll data has been sent to the admin.');

    await ctx.telegram.sendMessage(
      ADMIN_ID,
      `📊 *New Telegram Poll received from @${ctx.from?.username || 'unknown'}:*\n\`\`\`json\n${pollJson}\n\`\`\``,
      { parse_mode: 'Markdown' }
    );

    return;
  }

  // Run quiz for all chats
  await quizes()(ctx);

  // Greet in private chats
  if (isPrivateChat(chatType)) {
    await greeting()(ctx);
  }
});

// --- DEPLOYMENT ---
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

if (ENVIRONMENT !== 'production') {
  development(bot);
}
