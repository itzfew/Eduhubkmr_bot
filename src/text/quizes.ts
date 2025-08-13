import { Context } from 'telegraf';
import createDebug from 'debug';
import { distance } from 'fastest-levenshtein';

const debug = createDebug('bot:autoquizes');

// Store allowed chat IDs
let chatIds: number[] = [];

// Google Sheet URL
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbzHPhcv79YQyIx6t-59fsc6Czm9WgL6Y4HOP2JgX4gJyi3KjZqbXOGY-zmpyceW32VI/exec';

// JSON files for each subject
const BASE_URL = 'https://raw.githubusercontent.com/itzfew/Eduhub-KMR/refs/heads/main/';
const JSON_FILES: Record<string, string> = {
  biology: `${BASE_URL}biology.json`,
  chemistry: `${BASE_URL}chemistry.json`,
  physics: `${BASE_URL}physics.json`,
};

// === Utility Functions ===
export const saveChatId = async (id: number) => {
  if (!chatIds.includes(id)) {
    chatIds.push(id);
    // Save to Google Sheet
    await fetch(`${SHEET_URL}?action=add&id=${id}`);
  }
};

export const removeChatId = async (id: number) => {
  chatIds = chatIds.filter(c => c !== id);
  await fetch(`${SHEET_URL}?action=remove&id=${id}`);
};

export const fetchChatIdsFromSheet = async (): Promise<number[]> => {
  try {
    const response = await fetch(SHEET_URL);
    const data = await response.json();
    const ids = data.map((entry: any) => Number(entry.id)).filter((id: number) => !isNaN(id));
    chatIds = ids;
    return ids;
  } catch (error) {
    console.error('Failed to fetch chat IDs from Google Sheet:', error);
    return [];
  }
};

const getSimilarityScore = (a: string, b: string): number => {
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) return 1.0;
  return (maxLength - distance(a, b)) / maxLength;
};

// Fetch questions (all or per subject)
const fetchQuestions = async (subject?: string): Promise<any[]> => {
  try {
    if (subject) {
      const response = await fetch(JSON_FILES[subject]);
      return await response.json();
    } else {
      const allQuestions: any[] = [];
      for (const subj of Object.keys(JSON_FILES)) {
        const res = await fetch(JSON_FILES[subj]);
        allQuestions.push(...(await res.json()));
      }
      return allQuestions;
    }
  } catch (err) {
    debug('Error fetching questions:', err);
    return [];
  }
};

// Pick a random quiz
const getRandomQuiz = async () => {
  const allQuestions = await fetchQuestions();
  if (!allQuestions.length) return null;
  const question = allQuestions[Math.floor(Math.random() * allQuestions.length)];
  return question;
};

// Send quiz to one chat
const sendQuizToChat = async (ctx: Context, chatId: number) => {
  const question = await getRandomQuiz();
  if (!question) return;

  const options = [
    question.options.A,
    question.options.B,
    question.options.C,
    question.options.D
  ];
  const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

  if (question.image) {
    await ctx.telegram.sendPhoto(chatId, { url: question.image });
  }

  await ctx.telegram.sendPoll(chatId, question.question, options, {
    type: 'quiz',
    correct_option_id: correctOptionIndex,
    is_anonymous: false,
    explanation: question.explanation || 'No explanation provided.'
  });
};

// Start auto-sending quiz every 1 minute
export const startAutoQuiz = (ctx: Context) => {
  setInterval(async () => {
    for (const chatId of chatIds) {
      await sendQuizToChat(ctx, chatId);
    }
  }, 60_000);
};

// === Command Handlers ===
export const quizCommands = () => async (ctx: Context) => {
  const text = ctx.message && 'text' in ctx.message ? ctx.message.text.trim().toLowerCase() : '';
  
  if (text === '/quiz allow') {
    await saveChatId(ctx.chat!.id);
    await ctx.reply('✅ This group is now allowed to receive automatic quizzes every minute.');
    return;
  }

  if (text === '/quiz disallow') {
    await removeChatId(ctx.chat!.id);
    await ctx.reply('❌ This group will no longer receive automatic quizzes.');
    return;
  }
};
