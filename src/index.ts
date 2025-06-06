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
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth'; // Import Firebase Authentication

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ENVIRONMENT = process.env.NODE_ENV || '';
const ADMIN_ID = 6930703214;
let accessToken: string | null = null;

// Firebase configuration (from the provided HTML)
const firebaseConfig = {
  apiKey: "AIzaSyDIWtVfoGIWQoRVe36v6g6S3slTRRYUAgk",
  authDomain: "quizes-3028d.firebaseapp.com",
  databaseURL: "https://quizes-3028d-default-rtdb.firebaseio.com",
  projectId: "quizes-3028d",
  storageBucket: "quizes-3028d.appspot.com",
  messagingSenderId: "624591251031",
  appId: "1:624591251031:web:e093472f24fdeb29fc2512",
  measurementId: "G-QMZK5Y6769"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();

// Anonymous Authentication
async function initializeAnonymousAuth() {
  try {
    const userCredential = await auth.signInAnonymously();
    console.log('Anonymous authentication successful, UID:', userCredential.user?.uid);
    return userCredential.user?.uid;
  } catch (error) {
    console.error('Anonymous authentication failed:', error);
    throw new Error('Failed to authenticate anonymously with Firebase');
  }
}

// Initialize bot and authenticate
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
  awaitingChapterSelection?: boolean;
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
    const data: { chapter: string }[] = await res.json();
    const chapters = [...new Set(data.map((item) => item.chapter))];
    return chapters.sort();
  } catch (error) {
    console.error(`Error fetching chapters for ${subject}:`, error);
    return [];
  }
}

// Generate unique question ID
function generateQuestionId(): string {
  return 'id_' + Math.random().toString(36).substr(2, 9); // Match HTML's generateId
}

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
    submission.expectingImageOrPollForQuestionNumber = 1;

    await ctx.reply(
      `Selected chapter: *${submission.chapter}* for *${submission.subject}*. ` +
      `Please send an image for question 1 (optional) or send the poll directly to proceed without an image. ` +
      `You can also reply "skip" to explicitly skip the image.`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (chat.id === ADMIN_ID && pendingSubmissions[chat.id] && pendingSubmissions[chat.id].expectingImageOrPollForQuestionNumber && msg.photo) {
    const submission = pendingSubmissions[chat.id];
    const questionNumber = submission.expectingImageOrPollForQuestionNumber;
    const questionId = generateQuestionId();
    const chapterId = generateQuestionId(); // Temporary, will be updated later
    const imagePath = `chapters/${chapterId}/questions/${questionId}/question.jpg`;

    const photo = msg.photo[msg.photo.length - 1];
    const fileId = photo.file_id;

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
    } catch (error) {
      console.error('Image upload error:', error);
      await ctx.reply('❌ Error uploading image to Firebase Storage. Please try again or send the poll to proceed without an image.');
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
    const submission = pendingSubmissions[chat.id];
    const questionNumber = submission.questions.length + 1;
    const poll = msg.poll;

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
        // Ensure anonymous authentication
        const userId = await initializeAnonymousAuth();

        // Check if chapter exists or create a new one
        let chapterId;
        const chapterQuery = await db.collection('chapters')
          .where('subject', '==', submission.subject)
          .where('chapterName', '==', submission.chapter)
          .get();

        if (!chapterQuery.empty) {
          chapterId = chapterQuery.docs[0].id;
        } else {
          chapterId = generateQuestionId();
          await db.collection('chapters').doc(chapterId).set({
            subject: submission.subject,
            chapterName: submission.chapter,
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: userId,
            telegramId: ctx.from?.id.toString(), // Store Telegram ID for security
          });
        }

        // Save questions to the chapter's questions subcollection
        const questionsCollection = db.collection('chapters').doc(chapterId).collection('questions');
        for (const q of submission.questions) {
          const questionId = generateQuestionId();
          // Update image path to match chapterId
          let questionImageUrl = q.questionImage;
          if (questionImageUrl) {
            const oldPath = questionImageUrl.split('/o/')[1].split('?')[0];
            const newPath = `chapters/${chapterId}/questions/${questionId}/question.jpg`;
            // Move image to correct path in Firebase Storage
            const oldRef = storage.ref(oldPath);
            const newRef = storage.ref(newPath);
            const file = await oldRef.getDownloadURL();
            const response = await fetch(file);
            const blob = await response.blob();
            await newRef.put(blob);
            questionImageUrl = await newRef.getDownloadURL();
            await oldRef.delete().catch(() => {}); // Delete old image
          }

          const questionData = {
            question: q.question,
            questionImage: questionImageUrl || null,
            options: q.options,
            correctOption: q.correctOption,
            explanation: q.explanation || null,
            explanationImage: null, // Add support if needed
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: userId,
            telegramId: ctx.from?.id.toString(), // Store Telegram ID
          };
          await questionsCollection.doc(questionId).set(questionData);
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
