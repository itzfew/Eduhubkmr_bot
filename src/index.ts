import { Telegraf, Context } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllChatIds, saveChatId, fetchChatIdsFromSheet } from './utils/chatStore';
import { db, collection, addDoc, storage, uploadTelegramPhoto } from './utils/firebase';
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
    options: Array<{ type: string; value: string }>;
    correctOption: number | null; // Allow null for polls without a correct answer
    explanation: string | null; // Allow null for no explanation
    questionImage?: string;
    from: { id: number };
  }>;
  expectingImageOrPollForQuestionNumber?: number; // Track which question is awaiting an image or poll
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

// Generate unique question ID
function generateQuestionId(): string {
  return 'q_' + Math.random().toString(36).substr(2, 9);
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

// Show user count from Google Sheets
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
    expectingImageOrPollForQuestionNumber: undefined,
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
  const msg = ctx.message as any; // Avoid TS for ctx.message.poll/photo
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
    submission.expectingImageOrPollForQuestionNumber = 1; // Start with first question

    await ctx.reply(
      `Selected chapter: *${submission.chapter}* for *${submission.subject}*. ` +
      `Please send an image for question 1 (optional) or send the poll directly to proceed without an image. ` +
      `You can also reply "skip" to explicitly skip the image.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Handle image for admin question submissions
  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id] && pendingSubmissions[chat.id].expectingImageOrPollForQuestionNumber && msg.photo) {
    const submission = pendingSubmissions[chat.id];
    const questionNumber = submission.expectingImageOrPollForQuestionNumber;

   

    const photo = msg.photo[msg.photo.length - 1]; // Get highest resolution
    const fileId = photo.file_id;
    const questionId = generateQuestionId();
    const imagePath = `questions/${questionId}/question.jpg`;

    try {
      const downloadUrl = await uploadTelegramPhoto(fileId, BOT_TOKEN, imagePath);
      if (downloadUrl) {
        // Store question with image URL
        submission.questions.push({
          question: '',
          options: [],
          correctOption: null,
          explanation: null,
          questionImage: downloadUrl,
          from: { id: ctx.from?.id },
        });

        await ctx.reply(
          `Image for question ${questionNumber} saved. Please send the poll for question ${questionNumber} ` +
          `with the question and options.`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await ctx.reply('❌ Failed to upload image. Please try again or send the poll to proceed without an image.');
      }
    } catch (error) {
      console.error('Image upload error:', error);
      await ctx.reply('❌ Error uploading image to Firebase Storage. Please try again or send the poll to proceed without an image.');
    }
    return;
  }

  // Handle explicit "skip" for admin question submissions
  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id] && pendingSubmissions[chat.id].expectingImageOrPollForQuestionNumber && msg.text?.toLowerCase() === 'skip') {
    const submission = pendingSubmissions[chat.id];
    const questionNumber = submission.expectingImageOrPollForQuestionNumber;

    // Store question without image
    submission.questions.push({
      question: '',
      options: [],
      correctOption: null,
      explanation: null,
      questionImage: null,
      from: { id: ctx.from?.id },
    });

    await ctx.reply(
      `No image for question ${questionNumber}. Please send the poll for question ${questionNumber} ` +
      `with the question and options.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  // Handle poll submissions from admin (all types, with or without explanation, any number of options)
  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id] && msg.poll) {
    const submission = pendingSubmissions[chat.id];
    const questionNumber = submission.questions.length + 1; // Next question number

    const poll = msg.poll;

    // If expecting an image/poll and no image was provided, create a question with no image
    if (submission.expectingImageOrPollForQuestionNumber === questionNumber) {
      submission.questions.push({
        question: poll.question,
        options: poll.options.map((opt: any) => ({ type: 'text', value: opt.text })),
        correctOption: poll.type === 'quiz' ? poll.correct_option_id : null,
        explanation: poll.explanation || null,
        questionImage: null,
        from: { id: ctx.from?.id },
      });
    } else if (submission.questions.length > 0 && submission.questions[questionNumber - 2].question === '') {
      // Update the last question with poll data (image already provided)
      const lastQuestion = submission.questions[questionNumber - 2];
      lastQuestion.question = poll.question;
      lastQuestion.options = poll.options.map((opt: any) => ({ type: 'text', value: opt.text }));
      lastQuestion.correctOption = poll.type === 'quiz' ? poll.correct_option_id : null;
      lastQuestion.explanation = poll.explanation || null;
    } else {
      await ctx.reply('Please send an image, reply "skip", or ensure the previous question is completed before sending a poll.');
      return;
    }

    if (submission.questions.length < submission.count) {
      submission.expectingImageOrPollForQuestionNumber = submission.questions.length + 1;
      await ctx.reply(
        `Question ${questionNumber} saved. Please send an image for question ${submission.questions.length + 1} (optional) ` +
        `or send the poll directly to proceed without an image. You can also reply "skip" to explicitly skip the image.`,
        { parse_mode: 'Markdown' }
      );
    } else {
      // Save all questions to Firestore
      try {
        const questionsCollection = collection(db, 'questions');
        for (const q of submission.questions) {
          const questionId = generateQuestionId();
          const questionData = {
            subject: submission.subject,
            chapter: submission.chapter,
            question: q.question,
            questionImage: q.questionImage || null,
            options: q.options,
            correctOption: q.correctOption,
            explanation: q.explanation,
            createdAt: new Date().toISOString(),
            createdBy: ctx.from?.id.toString(),
            from: q.from,
          };
          await addDoc(questionsCollection, questionData);
        }
        await ctx.reply(`✅ Successfully added ${submission.count} questions to *${submission.subject}* (Chapter: *${submission.chapter}*).`);
        delete pendingSubmissions[chat.id];
      } catch (error: any) {
        console.error('Failed to save questions to Firestore:', error);
        if (error.code === 'permission-denied') {
          await ctx.reply('❌ Error: Insufficient permissions to save questions to Firestore. Please check Firebase configuration.');
        } else {
          await ctx.reply('❌ Error: Unable to save questions to Firestore.');
        }
      }
    }
    return;
  }

  // Forward polls to admin as-is
  if (msg.poll && ctx.from?.id !== ADMIN_ID) {
    try {
      await ctx.telegram.forwardMessage(ADMIN_ID, chat.id, msg.message_id);
    } catch (error) {
      console.error('Failed to forward poll to admin:', error);
    }
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
