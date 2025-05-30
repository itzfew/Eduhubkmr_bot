import { Telegraf, Context } from 'telegraf';
import { VercelRequest, VercelResponse } from '@vercel/node';
import { getAllChatIds, saveChatId, fetchChatIdsFromSheet } from './utils/chatStore';
import { db, ref, push, set, onValue, remove } from './utils/firebase';
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
    options: { [key: string]: string };
    correct_option: string;
    explanation: string;
    image?: string;
  }>;
  expectingImageFor?: string; // Track poll ID awaiting an image
  awaitingChapterSelection?: boolean; // Track if waiting for chapter number
}

const pendingSubmissions: { [key: number]: PendingQuestion } = {};

// Object to store active quiz timers
const quizTimers: { [key: number]: NodeJS.Timeout } = {};

// List of subjects to fetch questions from
const SUBJECTS = ['biology', 'physics', 'chemistry']; // Add more subjects as needed

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

// --- FETCH QUESTIONS FROM GITHUB ---
async function fetchQuestionsFromGitHub(subject: string): Promise<any[]> {
  const subjectFile = subject.toLowerCase();
  const url = `https://raw.githubusercontent.com/itzfew/Eduhub-KMR/refs/heads/main/${subjectFile}.json`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch ${subject} JSON`);
    const data = await res.json();
    return data;
  } catch (error) {
    console.error(`Error fetching questions for ${subject}:`, error);
    return [];
  }
}

// --- CACHE QUESTIONS TO FIREBASE ---
async function cacheQuestionsToFirebase(questions: any[], subject: string) {
  try {
    const questionsRef = ref(db, `questions/${subject}`);
    for (const question of questions) {
      const newQuestionRef = push(questionsRef);
      await set(newQuestionRef, {
        subject,
        chapter: question.chapter || 'Unknown',
        question: question.question,
        options: question.options || { A: '', B: '', C: '', D: '' },
        correct_option: question.correct_option || 'A',
        explanation: question.explanation || '',
        image: question.image || '',
      });
    }
    console.log(`Cached ${questions.length} questions for ${subject} to Firebase`);
  } catch (error) {
    console.error(`Failed to cache questions for ${subject} to Firebase:`, error);
  }
}

// --- FETCH RANDOM QUESTION ---
async function fetchRandomQuestion(): Promise<any> {
  try {
    // Try fetching from Firebase first
    const questionsRef = ref(db, 'questions');
    const snapshot = await new Promise((resolve) => {
      onValue(questionsRef, resolve, { onlyOnce: true });
    }) as any;
    let questions: any[] = [];
    
    if (snapshot.exists()) {
      const data = snapshot.val();
      Object.keys(data).forEach((subject) => {
        questions = questions.concat(Object.values(data[subject]));
      });
    }

    // If no questions in Firebase, fetch from GitHub
    if (questions.length === 0) {
      console.log('No questions in Firebase, fetching from GitHub...');
      for (const subject of SUBJECTS) {
        const githubQuestions = await fetchQuestionsFromGitHub(subject);
        if (githubQuestions.length > 0) {
          questions = questions.concat(githubQuestions);
          // Cache to Firebase for future use
          await cacheQuestionsToFirebase(githubQuestions, subject);
        }
      }
    }

    if (questions.length === 0) {
      throw new Error('No questions available from GitHub or Firebase.');
    }

    // Select a random question
    const randomQuestion = questions[Math.floor(Math.random() * questions.length)];
    return randomQuestion;
  } catch (error) {
    console.error('Error fetching random question:', error);
    throw error;
  }
}

// --- SEND QUESTION TO CHAT ---
async function sendQuizToChat(chatId: number) {
  try {
    const question = await fetchRandomQuestion();
    if (!question) {
      console.error('No question fetched for chat:', chatId);
      return;
    }

    const options = Object.values(question.options);
    const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

    await bot.telegram.sendPoll(chatId, question.question, options, {
      type: 'quiz',
      correct_option_id: correctOptionIndex,
      explanation: question.explanation,
      is_anonymous: false,
    });

    if (question.image) {
      await bot.telegram.sendPhoto(chatId, question.image, {
        caption: `Image for the question: ${question.question}`,
      });
    }
  } catch (error) {
    console.error(`Failed to send quiz to chat ${chatId}:`, error);
    // Notify chat about the error
    await bot.telegram.sendMessage(chatId, '⚠️ Unable to send quiz at this time. Please try again later.');
  }
}

// --- START QUIZ SCHEDULER ---
async function startQuizScheduler(chatId: number) {
  if (quizTimers[chatId]) {
    clearInterval(quizTimers[chatId]);
  }

  // Send a quiz immediately
  await sendQuizToChat(chatId);

  // Schedule quizzes every minute
  quizTimers[chatId] = setInterval(async () => {
    await sendQuizToChat(chatId);
  }, 60 * 1000); // 60 seconds
}

// --- STOP QUIZ SCHEDULER ---
function stopQuizScheduler(chatId: number) {
  if (quizTimers[chatId]) {
    clearInterval(quizTimers[chatId]);
    delete quizTimers[chatId];
  }
}

// --- LOAD QUIZ SETTINGS ON STARTUP ---
async function loadQuizSettings() {
  try {
    const settingsRef = ref(db, 'quizSettings');
    onValue(
      settingsRef,
      (snapshot) => {
        const settings = snapshot.val();
        if (settings) {
          Object.keys(settings).forEach((chatId) => {
            if (settings[chatId].enabled) {
              startQuizScheduler(Number(chatId));
            }
          });
        }
      },
      { onlyOnce: true }
    );
  } catch (error) {
    console.error('Error loading quiz settings:', error);
  }
}

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

// New /setquiz command
bot.command('setquiz', async (ctx) => {
  const chatId = ctx.chat.id;
  const args = ctx.message.text?.split(' ').slice(1);
  const interval = args && args.length > 0 ? parseInt(args[0], 10) : 1;

  if (isNaN(interval) || interval !== 1) {
    return ctx.reply('Usage: /setquiz 1\nCurrently, only 1-minute intervals are supported.');
  }

  // Check if user is admin in group or private chat
  if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
    try {
      const admins = await ctx.getChatAdministrators();
      const isAdmin = admins.some((admin) => admin.user.id === ctx.from?.id);
      if (!isAdmin) {
        return ctx.reply('Only group admins can use this command.');
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
      return ctx.reply('Error checking admin status.');
    }
  }

  try {
    // Save quiz setting to Firebase
    const settingRef = ref(db, `quizSettings/${chatId}`);
    await set(settingRef, { enabled: true, interval: 1 });

    // Start quiz scheduler
    await startQuizScheduler(chatId);

    await ctx.reply('✅ Quiz set to send a random question every minute.');
  } catch (error) {
    console.error('Error setting quiz:', error);
    await ctx.reply('❌ Error: Unable to set quiz schedule.');
  }
});

// New /unset command
bot.command('unset', async (ctx) => {
  const chatId = ctx.chat.id;

  // Check if user is admin in group or private chat
  if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
    try {
      const admins = await ctx.getChatAdministrators();
      const isAdmin = admins.some((admin) => admin.user.id === ctx.from?.id);
      if (!isAdmin) {
        return ctx.reply('Only group admins can use this command.');
      }
    } catch (error) {
      console.error('Error checking admin status:', error);
      return ctx.reply('Error checking admin status.');
    }
  }

  try {
    // Remove quiz setting from Firebase
    const settingRef = ref(db, `quizSettings/${chatId}`);
    await remove(settingRef);

    // Stop quiz scheduler
    stopQuizScheduler(chatId);

    await ctx.reply('✅ Quiz schedule unset. No more automatic quizzes will be sent.');
  } catch (error) {
    console.error('Error unsetting quiz:', error);
    await ctx.reply('❌ Error: Unable to unset quiz schedule.');
  }
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
    const correctOptionLetter = ['A', 'B', 'C', 'D'][correctOptionIndex];

    const question = {
      subject: submission.subject,
      chapter: submission.chapter,
      question: poll.question,
      options: {
        A: poll.options[0].text,
        B: poll.options[1].text,
        C: poll.options[2].text,
        D: poll.options[3].text,
      },
      correct_option: correctOptionLetter,
      explanation: poll.explanation,
      image: '',
    };

    submission.questions.push(question);
    submission.expectingImageFor = poll.id; // Track poll ID for potential image

    if (submission.questions.length < submission.count) {
      await ctx.reply(
        `Question ${submission.questions.length} saved. Please send an image URL for this question (or reply "skip" to proceed), ` +
        `then send the next question (${submission.questions.length + 1}/${submission.count}) as a quiz poll.`
      );
    } else {
      // Save all questions to Firebase
      try {
        const questionsRef = ref(db, `questions/${submission.subject}`);
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
    return;
  }

  // Handle image URL or skip for admin question submissions
  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id] && msg.text && pendingSubmissions[chat.id].expectingImageFor) {
    const submission = pendingSubmissions[chat.id];
    const lastQuestion = submission.questions[submission.questions.length - 1];

    if (msg.text.toLowerCase() === 'skip') {
      lastQuestion.image = '';
      submission.expectingImageFor = undefined;
      if (submission.questions.length < submission.count) {
        await ctx.reply(`Image skipped. Please send the next question (${submission.questions.length + 1}/${submission.count}) as a quiz poll.`);
      }
    } else if (msg.text.startsWith('http') && msg.text.match(/\.(jpg|jpeg|png|gif)$/i)) {
      lastQuestion.image = msg.text;
      submission.expectingImageFor = undefined;
      if (submission.questions.length < submission.count) {
        await ctx.reply(`Image saved. Please send the next question (${submission.questions.length + 1}/${submission.count}) as a quiz poll.`);
      }
    } else {
      await ctx.reply('Please send a valid image URL (jpg, jpeg, png, or gif) or reply "skip" to proceed without an image.');
    }
    return;
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

// Load quiz settings on bot startup
loadQuizSettings();

// --- DEPLOYMENT ---
export const startVercel = async (req: VercelRequest, res: VercelResponse) => {
  await production(req, res, bot);
};

if (ENVIRONMENT !== 'production') {
  development(bot);
}
