import { Context, Telegraf } from 'telegraf';
import createDebug from 'debug';
import { db, ref, set, onValue, remove } from '../utils/firebase';
import { fetchQuestions } from '../utils/questionUtils';

const debug = createDebug('bot:quiztime');

interface QuizTimeSettings {
  chatId: number;
  intervalMinutes: number;
  lastSent?: number;
}

// Store active intervals to manage timers
const activeIntervals: { [chatId: number]: NodeJS.Timeout } = {};

// Function to send a random quiz question
async function sendQuiz(ctx: Context, chatId: number) {
  try {
    const questions = await fetchQuestions();
    if (!questions.length) {
      await ctx.telegram.sendMessage(chatId, 'No questions available to send.');
      return;
    }

    const question = questions[Math.floor(Math.random() * questions.length)];
    const options = [
      question.options.A,
      question.options.B,
      question.options.C,
      question.options.D,
    ];
    const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

    if (question.image) {
      await ctx.telegram.sendPhoto(chatId, { url: question.image });
    }

    await ctx.telegram.sendPoll(
      chatId,
      question.question,
      options,
      {
        type: 'quiz',
        correct_option_id: correctOptionIndex,
        is_anonymous: false,
        explanation: question.explanation || 'No explanation provided.',
      }
    );

    debug(`Quiz sent to chat ${chatId}`);

    // Update lastSent timestamp in Firebase
    await set(ref(db, `quiztime/${chatId}/lastSent`), Date.now());
  } catch (err) {
    debug(`Error sending quiz to chat ${chatId}:`, err);
    await ctx.telegram.sendMessage(chatId, 'Failed to send quiz question.');
  }
}

// Function to start the quiz interval for a chat
function startQuizInterval(bot: Telegraf, chatId: number, intervalMinutes: number) {
  // Clear any existing interval for this chat
  if (activeIntervals[chatId]) {
    clearInterval(activeIntervals[chatId]);
    delete activeIntervals[chatId];
  }

  // Set new interval
  const intervalMs = intervalMinutes * 60 * 1000;
  activeIntervals[chatId] = setInterval(async () => {
    const ctx = { telegram: bot.telegram, chat: { id: chatId, type: 'private' } } as Context;
    await sendQuiz(ctx, chatId);
  }, intervalMs);

  debug(`Started quiz interval for chat ${chatId} every ${intervalMinutes} minutes`);
}

// Function to load and resume quiz schedules from Firebase
export function initializeQuizSchedules(bot: Telegraf) {
  const quiztimeRef = ref(db, 'quiztime');
  onValue(quiztimeRef, (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    Object.entries(data).forEach(([chatId, settings]: [string, any]) => {
      const chatIdNum = parseInt(chatId, 10);
      if (settings.intervalMinutes) {
        startQuizInterval(bot, chatIdNum, settings.intervalMinutes);
      }
    });
    debug('Loaded quiz schedules from Firebase');
  });
}

// Command to set quiz interval
export const setQuizTime = () => async (ctx: Context) => {
  debug('Triggered "setquiztime" command');

  if (!ctx.message || !('text' in ctx.message)) {
    await ctx.reply('Please provide a valid command.');
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.reply('Unable to identify chat.');
    return;
  }

  const text = ctx.message.text.trim();
  const match = text.match(/^\/setquiztime\s+(\d+)$/);
  if (!match) {
    await ctx.reply('Usage: /setquiztime <minutes>\nExample: /setquiztime 1');
    return;
  }

  const intervalMinutes = parseInt(match[1], 10);
  if (isNaN(intervalMinutes) || intervalMinutes < 1) {
    await ctx.reply('Please specify a valid interval in minutes (minimum 1).');
    return;
  }

  try {
    // Save settings to Firebase
    const settings: QuizTimeSettings = {
      chatId,
      intervalMinutes,
      lastSent: Date.now(),
    };
    await set(ref(db, `quiztime/${chatId}`), settings);

    // Start the interval
    startQuizInterval(ctx.telegram as any, chatId, intervalMinutes);

    await ctx.reply(
      `✅ Quiz schedule set! A quiz will be sent every ${intervalMinutes} minute(s). ` +
      `Use /removequiztime to stop.`
    );
  } catch (err) {
    debug(`Error setting quiz time for chat ${chatId}:`, err);
    await ctx.reply('Failed to set quiz schedule.');
  }
};

// Command to remove quiz interval
export const removeQuizTime = () => async (ctx: Context) => {
  debug('Triggered "removequiztime" command');

  const chatId = ctx.chat?.id;
  if (!chatId) {
    await ctx.reply('Unable to identify chat.');
    return;
  }

  try {
    // Remove settings from Firebase
    await remove(ref(db, `quiztime/${chatId}`));

    // Clear interval
    if (activeIntervals[chatId]) {
      clearInterval(activeIntervals[chatId]);
      delete activeIntervals[chatId];
      debug(`Cleared quiz interval for chat ${chatId}`);
    }

    await ctx.reply('✅ Quiz schedule removed.');
  } catch (err) {
    debug(`Error removing quiz time for chat ${chatId}:`, err);
    await ctx.reply('Failed to remove quiz schedule.');
  }
};
