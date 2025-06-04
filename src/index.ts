// src/index.ts
import { Telegraf, Context } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllChatIds, saveChatId, fetchChatIdsFromSheet } from './utils/chatStore';
import { db, FieldValue, ref, push, set } from './utils/firebase'; // Import from updated firebase.ts
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
import { me, info } from './commands/me';
import { quote } from './commands/quotes';
import { playquiz, handleQuizActions } from './playquiz';
import { pin, stopCountdown, setupDailyUpdateListener, cleanupListeners } from './commands/pin';
import { logoCommand } from './commands/logo';

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const ADMIN_ID = 6930703214;
let accessToken: string | null = null;

if (!BOT_TOKEN) throw new Error('BOT_TOKEN not provided!');
const bot = new Telegraf(BOT_TOKEN);

// Store pending question submissions
interface PendingQuestion {
  subject: string;
  chapter: string;
  count: number;
  questions: Array<{
    question: string;
    options: { type: string; value: string }[];
    correctOption: number;
    explanation: string;
    questionImage?: string | null;
    explanationImage?: string | null;
  }>;
  expectingImageFor?: string; // Track poll ID awaiting an image
  awaitingChapterSelection?: boolean; // Track if waiting for chapter number
}

const pendingSubmissions: { [key: number]: PendingQuestion } = {};

// --- TELEGRAPH INTEGRATION ---
async function createTelegraphAccount() {
  try {
    const res = await fetch('https://api.telegra.ph/createAccount', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ short_name: 'EduhubBot', author_name: 'Eduhub KMR Bot' }),
    });
    const data = await res.json();
    if (data.ok) {
      accessToken = data.result.access_token;
      console.log('Telegraph account created, access token:', accessToken);
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    console.error('Failed to create Telegraph account:', error);
  }
}

async function createTelegraphPage(title: string, content: string) {
  if (!accessToken) {
    await createTelegraphAccount();
  }
  try {
    const res = await fetch('https://api.telegra.ph/createPage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        access_token: accessToken,
        title,
        content: [{ tag: 'p', children: [content] }],
        return_content: true,
      }),
    });
    const data = await res.json();
    if (data.ok) {
      return data.result.url;
    } else {
      throw new Error(data.error);
    }
  } catch (error) {
    console.error('Failed to create Telegraph page:', error);
    return null;
  }
}

// --- FETCH CHAPTERS ---
async function fetchChapters(subject: string): Promise<string[]> {
  const subjectFile = subject.toLowerCase();
  const url = `https://raw.githubusercontent.com/itzfew/Eduhub-KMR/refs/heads/main/${subjectFile}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${subject} JSON`);
    const data = await res.json();
    const chapters = [...new Set(data.map((item: any) => item.chapter))]; // Unique chapters
    return chapters.sort();
  } catch (error) {
    console.error(`Error fetching chapters for ${subject}:`, error);
    return [];
  }
}

// --- COMMANDS ---
bot.command('about', about());
bot.command('help', help());
bot.command('study', study());
bot.command('neet', neet());
bot.command('jee', jee());
bot.command('groups', groups());
bot.command('me', me());
bot.command('info', info());
bot.command('quote', quote());
bot.command('quiz', playquiz());
bot.command('neetcountdown', pin());
bot.command('stopcountdown', stopCountdown());
bot.command('countdown', logoCommand());

// ... (Other commands like /users, /broadcast, /reply remain unchanged)

// Handle /add<subject> or /add<Subject>__<Chapter> commands
bot.command(/add[A-Za-z]+(__[A-Za-z_]+)?/, async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    return ctx.reply('You are not authorized to use this command.');
  }

  const command = ctx.message.text?.split(' ')[0].substring(1); // Remove leading '/'
  const countStr = ctx.message.text?.split(' ')[1];
  const count = parseInt(countStr, 10);

  if (!countStr || isNaN(count) || count <= 0) {
    return ctx.reply('Please specify a valid number of questions.\nExample: /addBiology 10');
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

  // Fetch chapters for the subject
  const chapters = await fetchChapters(subject);
  if (chapters.length === 0) {
    return ctx.reply(`❌ Failed to fetch chapters for ${subject}. Please specify a chapter manually using /add${subject}__<chapter> <count>`);
  }

  // Create numbered list of chapters
  const chaptersList = chapters.map((ch, index) => `${index + 1}. ${ch}`).join('\n');
  const telegraphContent = `Chapters for ${subject}:\n${chaptersList}`;
  const telegraphUrl = await createTelegraphPage(`Chapters for ${subject}`, telegraphContent);

  // Store pending submission with flag for chapter selection
  pendingSubmissions[ctx.from.id] = {
    subject,
    chapter,
    count,
    questions: [],
    expectingImageFor: undefined,
    awaitingChapterSelection: true,
  };

  const replyText = `Please select a chapter for *${subject}* by replying with the chapter number:\n\n${chaptersList}\n\n` +
                    (telegraphUrl ? `📖 View chapters on Telegraph: ${telegraphUrl}` : '');
  await ctx.reply(replyText, { parse_mode: 'Markdown' });
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

  // Handle chapter selection for admin
  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id]?.awaitingChapterSelection && msg.text) {
    const submission = pendingSubmissions[chat.id];
    const chapterNumber = parseInt(msg.text.trim(), 10);

    const chapters = await fetchChapters(submission.subject);
    if (isNaN(chapterNumber) || chapterNumber < 1 || chapterNumber > chapters.length) {
      await ctx.reply(`Please enter a valid chapter number between 1 and ${chapters.length}.`);
      return;
    }

    submission.chapter = chapters[chapterNumber - 1];
    submission.awaitingChapterSelection = false;

    await ctx.reply(
      `Selected chapter: *${submission.chapter}* for *${submission.subject}*. ` +
      `Please share ${submission.count} questions as Telegram quiz polls. ` +
      `Each poll should have the question, 4 options, a correct answer, and an explanation. ` +
      `After sending a poll, you can optionally send an image URL for it.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Handle question submissions from admin (quiz polls)
  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id] && msg.poll) {
    const submission = pendingSubmissions[chat.id];
    const poll = msg.poll;

    if (poll.type !== 'quiz') {
      await ctx.reply('Please send a quiz poll with a correct answer and explanation.');
      return;
    }

    if (poll.options.length !== 4) {
      await ctx.reply('Quiz polls must have exactly 4 options.');
      return;
    }

    if (!poll.explanation) {
      await ctx.reply('Quiz polls must include an explanation.');
      return;
    }

    const correctOptionIndex = poll.correct_option_id;

    // Structure options to match Firestore schema
    const options = poll.options.map((opt: any) => ({
      type: 'text', // Telegram polls are text-based
      value: opt.text,
    }));

    const question = {
      subject: submission.subject,
      chapter: submission.chapter,
      question: poll.question,
      options,
      correctOption: correctOptionIndex,
      explanation: poll.explanation,
      questionImage: null,
      explanationImage: null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: ADMIN_ID.toString(),
    };

    submission.questions.push(question);
    submission.expectingImageFor = poll.id; // Track poll ID for potential image

    if (submission.questions.length < submission.count) {
      await ctx.reply(
        `Question ${submission.questions.length} saved. Please send an image URL for this question (or reply "skip" to proceed), ` +
        `then send the next question (${submission.questions.length + 1}/${submission.count}) as a quiz poll.`
      );
    } else {
      // Save all questions to Firestore
      try {
        for (const q of submission.questions) {
          const { id, ref: docRef } = push(ref('questions')); // Use Firestore-compatible push
          await set(docRef, q);
        }
        await ctx.reply(`✅ Successfully added ${submission.count} questions to *${submission.subject}* (Chapter: *${submission.chapter}*).`);
        delete pendingSubmissions[chat.id];
      } catch (error) {
        console.error('Failed to save questions to Firestore:', error);
        await ctx.reply('❌ Error: Unable to save questions to Firestore.');
      }
    }
    return;
  }

  // Handle image URL or skip for admin question submissions
  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id] && msg.text && pendingSubmissions[chat.id].expectingImageFor) {
    const submission = pendingSubmissions[chat.id];
    const lastQuestion = submission.questions[submission.questions.length - 1];

    if (msg.text.toLowerCase() === 'skip') {
      lastQuestion.questionImage = null;
      submission.expectingImageFor = undefined;
      if (submission.questions.length < submission.count) {
        await ctx.reply(`Image skipped. Please send the next question (${submission.questions.length + 1}/${submission.count}) as a quiz poll.`);
      }
    } else if (msg.text.startsWith('http') && msg.text.match(/\.(jpg|jpeg|png|gif)$/i)) {
      lastQuestion.questionImage = msg.text;
      submission.expectingImageFor = undefined;
      if (submission.questions.length < submission.count) {
        await ctx.reply(`Image saved. Please send the next question (${submission.questions.length + 1}/${submission.count}) as a quiz poll.`);
      }
    } else {
      await ctx.reply('Please send a valid image URL (jpg, jpeg, png, or gif) or reply "skip" to proceed without an image.');
    }
    return;
  }

  // Detect Telegram Poll and send JSON to admin, save to Firestore
  if (msg.poll) {
    const poll = msg.poll;
    const pollJson = JSON.stringify(poll, null, 2);

    // Save poll data to Firestore under /polls/
    try {
      const { id, ref: docRef } = push(ref('polls'));
      await set(docRef, {
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
        receivedAt: FieldValue.serverTimestamp(),
      });
    } catch (error) {
      console.error('Firestore save error:', error);
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
