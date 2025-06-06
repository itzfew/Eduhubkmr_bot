import { Telegraf, Context } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllChatIds, saveChatId, fetchChatIdsFromSheet } from './utils/chatStore';
import { db, collection, addDoc, setDoc, doc, getDocs, query, where, storage, uploadTelegramPhoto, auth, currentUser, ensureAuth } from './utils/firebase';
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
    correctOption: number | null;
    explanation: string | null | undefined;
    questionImage?: string | null | undefined;
    from: { id: number };
  }>;
  expectingImageOrPollForQuestionNumber?: number;
  awaitingChapterConfirmation?: boolean;
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
  try {
    await ensureAuth();
    console.log(`Fetching chapters for subject: ${subject}`);
    const chaptersQuery = query(
      collection(db, 'chapters'),
      where('subject', '==', subject)
    );
    console.log('Executing Firestore query');
    const chaptersSnapshot = await getDocs(chaptersQuery);
    const chapters = [...new Set(chaptersSnapshot.docs.map(doc => doc.data().chapterName))].sort();
    console.log(`Retrieved chapters: ${chapters}`);
    return chapters;
  } catch (error: any) {
    console.error(`Error fetching chapters for ${subject}:`, {
      message: error.message,
      stack: error.stack
    });
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

// Debug authentication status
bot.command('debugauth', async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) return;
  try {
    await ensureAuth();
    await ctx.reply(`Current user: ${currentUser ? currentUser.uid : 'Not authenticated'}`);
  } catch (error: any) {
    await ctx.reply(`Authentication error: ${error.message}`);
  }
});

// Handle /addsubject00chapter0name commands
bot.command(/add[A-Za-z]+00[A-Za-z0-9_]+/, async (ctx) => {
  if (ctx.from?.id !== ADMIN_ID) {
    return ctx.reply('You are not authorized to use this command.');
  }

  try {
    await ensureAuth();
  } catch (error: any) {
    return ctx.reply(`❌ Error: Bot is not authenticated: ${error.message}`);
  }

  const command = ctx.message.text?.split(' ')[0].substring(1);
  const countStr = ctx.message.text?.split(' ')[1];
  const count = parseInt(countStr, 10);

  if (!countStr || isNaN(count) || count <= 0) {
    return ctx.reply('Please specify a valid number of questions.\nExample: /addBiology00Cell0Structure 10');
  }

  const [subjectRaw, chapterRaw] = command.split('00');
  const subject = subjectRaw.replace('add', '').replace(/0/g, ' ');
  const chapter = chapterRaw.replace(/0/g, ' ');

  // Verify if chapter exists, create if not
  let chapterId: string | null = null;
  try {
    const chapterQuery = query(
      collection(db, 'chapters'),
      where('subject', '==', subject),
      where('chapterName', '==', chapter)
    );
    const chapterSnapshot = await getDocs(chapterQuery);
    if (!chapterSnapshot.empty) {
      chapterId = chapterSnapshot.docs[0].id;
    } else {
      chapterId = generateQuestionId();
      await setDoc(doc(db, 'chapters', chapterId), {
        subject,
        chapterName: chapter,
        createdAt: new Date().toISOString(),
        createdBy: currentUser!.uid,
      });
    }
  } catch (error: any) {
    console.error('Error checking or creating chapter:', {
      message: error.message,
      stack: error.stack
    });
    return ctx.reply(`❌ Error: Unable to verify or create chapter in Firestore: ${error.message}`);
  }

  pendingSubmissions[ctx.from.id] = {
    subject,
    chapter,
    count,
    questions: [],
    expectingImageOrPollForQuestionNumber: 1,
    awaitingChapterConfirmation: false,
  };

  await ctx.reply(
    `Preparing to add ${count} question(s) for *${subject}* (Chapter: *${chapter}*). ` +
    `Please send an image for question 1 (optional) or send the poll directly to proceed without an image. ` +
    `You can also reply "skip" to explicitly skip the image.`,
    { parse_mode: 'Markdown' }
  );
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
  const msg = ctx.message as any;
  const chatType = chat.type;

  if (!chat?.id) return;

  saveChatId(chat.id);

  const alreadyNotified = await saveToSheet(chat);

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

  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id] && pendingSubmissions[chat.id].expectingImageOrPollForQuestionNumber && msg.photo) {
    try {
      await ensureAuth();
    } catch (error: any) {
      await ctx.reply(`❌ Error: Bot is not authenticated: ${error.message}`);
      return;
    }

    const submission = pendingSubmissions[chat.id];
    const questionNumber = submission.expectingImageOrPollForQuestionNumber;

    // Get chapterId
    let chapterId: string | null = null;
    try {
      const chapterQuery = query(
        collection(db, 'chapters'),
        where('subject', '==', submission.subject),
        where('chapterName', '==', submission.chapter)
      );
      const chapterSnapshot = await getDocs(chapterQuery);
      if (!chapterSnapshot.empty) {
        chapterId = chapterSnapshot.docs[0].id;
      } else {
        chapterId = generateQuestionId();
        await setDoc(doc(db, 'chapters', chapterId), {
          subject: submission.subject,
          chapterName: submission.chapter,
          createdAt: new Date().toISOString(),
          createdBy: currentUser!.uid,
        });
      }
    } catch (error: any) {
      console.error('Error checking or creating chapter for image upload:', {
        message: error.message,
        stack: error.stack
      });
      await ctx.reply(`❌ Error: Unable to verify or create chapter in Firestore: ${error.message}`);
      return;
    }

    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;
    const questionId = generateQuestionId();
    const imagePath = `chapters/${chapterId}/questions/${questionId}/question.jpg`;

    try {
      const downloadUrl = await uploadTelegramPhoto(fileId, BOT_TOKEN, imagePath);
      if (downloadUrl) {
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
    } catch (error: any) {
      console.error('Image upload error:', {
        message: error.message,
        stack: error.stack
      });
      await ctx.reply(`❌ Error uploading image to Firebase Storage: ${error.message}`);
    }
    return;
  }

  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id] && pendingSubmissions[chat.id].expectingImageOrPollForQuestionNumber && msg.text?.toLowerCase() === 'skip') {
    const submission = pendingSubmissions[chat.id];
    const questionNumber = submission.expectingImageOrPollForQuestionNumber;

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

  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id] && msg.poll) {
    try {
      await ensureAuth();
    } catch (error: any) {
      await ctx.reply(`❌ Error: Bot is not authenticated: ${error.message}`);
      return;
    }

    const submission = pendingSubmissions[chat.id];
    const questionNumber = submission.questions.length + 1;

    const poll = msg.poll;

    let chapterId: string | null = null;
    try {
      const chapterQuery = query(
        collection(db, 'chapters'),
        where('subject', '==', submission.subject),
        where('chapterName', '==', submission.chapter)
      );
      const chapterSnapshot = await getDocs(chapterQuery);
      if (!chapterSnapshot.empty) {
        chapterId = chapterSnapshot.docs[0].id;
      } else {
        chapterId = generateQuestionId();
        await setDoc(doc(db, 'chapters', chapterId), {
          subject: submission.subject,
          chapterName: submission.chapter,
          createdAt: new Date().toISOString(),
          createdBy: currentUser!.uid,
        });
      }
    } catch (error: any) {
      console.error('Error checking or creating chapter:', {
        message: error.message,
        stack: error.stack
      });
      await ctx.reply(`❌ Error: Unable to verify or create chapter in Firestore: ${error.message}`);
      return;
    }

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
      try {
        for (const q of submission.questions) {
          const questionId = generateQuestionId();
          const questionData = {
            question: q.question,
            questionImage: q.questionImage || null,
            options: q.options,
            correctOption: q.correctOption,
            explanation: q.explanation,
            createdAt: new Date().toISOString(),
            createdBy: currentUser!.uid,
            from: q.from,
          };
          await addDoc(collection(db, 'chapters', chapterId, 'questions'), questionData);
        }
        await ctx.reply(`✅ Successfully added ${submission.count} questions to *${submission.subject}* (Chapter: *${submission.chapter}*).`);
        delete pendingSubmissions[chat.id];
      } catch (error: any) {
        console.error('Failed to save questions to Firestore:', {
          message: error.message,
          stack: error.stack
        });
        await ctx.reply(`❌ Error: Unable to save questions to Firestore: ${error.message}`);
      }
    }
    return;
  }

  if (msg.poll && ctx.from?.id !== ADMIN_ID) {
    try {
      await ctx.telegram.forwardMessage(ADMIN_ID, chat.id, msg.message_id);
    } catch (error) {
      console.error('Failed to forward poll to admin:', error);
    }
    return;
  }

  await quizes()(ctx);

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
