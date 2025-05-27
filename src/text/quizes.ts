import { Context } from 'telegraf';
import createDebug from 'debug';
import { distance } from 'fastest-levenshtein';

const debug = createDebug('bot:quizes');

let accessToken: string | null = null;

// Base URL for JSON files
const BASE_URL = 'https://raw.githubusercontent.com/itzfew/Eduhub-KMR/refs/heads/main/';

// Subject-specific JSON file paths
const JSON_FILES: Record<string, string> = {
  biology: `${BASE_URL}biology.json`,
  chemistry: `${BASE_URL}chemistry.json`,
  physics: `${BASE_URL}physics.json`,
};

// Interface for quiz session (updated to include lastGifMessageId)
interface QuizSession {
  intervalId: NodeJS.Timeout;
  questions: any[];
  currentIndex: number;
  ctx: Context;
  lastGifMessageId?: number; // Store the message ID of the last GIF sent
}

// Function to send a single question (updated)
const sendQuestion = async (ctx: Context, question: any, session: QuizSession) => {
  const options = [
    question.options.A,
    question.options.B,
    question.options.C,
    question.options.D,
  ];
  const correctOptionIndex = ['A', 'B', 'C', 'D'].indexOf(question.correct_option);

  if (question.image) {
    await ctx.replyWithPhoto({ url: question.image });
  }

  // Send the quiz question
  await ctx.sendPoll(
    question.question,
    options,
    {
      type: 'quiz',
      correct_option_id: correctOptionIndex,
      is_anonymous: false,
      explanation: question.explanation || 'No explanation provided.',
    } as any
  );

  // Send the timer GIF from src/data/giphy.gif
  try {
    const gifMessage = await ctx.replyWithAnimation({ source: 'src/data/giphy.gif' });
    // Store the message ID of the GIF
    session.lastGifMessageId = gifMessage.message_id;
  } catch (err) {
    debug('Error sending GIF:', err);
    // Don't stop the quiz if GIF fails to send; just log the error
  }
};

// Function to start a quiz session (updated)
const startQuizSession = (ctx: Context, questions: any[], count: number) => {
  const chatId = ctx.chat?.id;
  if (!chatId) {
    ctx.reply('Error: Unable to start quiz session.');
    return;
  }

  // Stop any existing session
  stopQuizSession(chatId);

  // Shuffle and limit questions
  const shuffled = questions.sort(() => 0.5 - Math.random());
  const selected = shuffled.slice(0, Math.min(count, questions.length));

  if (!selected.length) {
    ctx.reply('No questions available.');
    return;
  }

  // Initialize session
  const session: QuizSession = {
    intervalId: null as any, // Will be set below
    questions: selected,
    currentIndex: 0,
    ctx,
    lastGifMessageId: undefined, // Initialize as undefined
  };

  // Send first question immediately
  sendQuestion(ctx, session.questions[session.currentIndex], session).catch(err => {
    debug('Error sending question:', err);
    ctx.reply('Oops! Failed to send a question.');
    stopQuizSession(chatId);
  });
  session.currentIndex++;

  // Start interval for remaining questions
  session.intervalId = setInterval(async () => {
    if (session.currentIndex >= session.questions.length) {
      // Delete the last GIF before ending the quiz
      if (session.lastGifMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, session.lastGifMessageId);
        } catch (err) {
          debug('Error deleting GIF:', err);
        }
      }
      await ctx.reply('✅ Quiz completed! No more questions available.\nUse /chapter or /pyq to start another quiz.');
      stopQuizSession(chatId);
      return;
    }

    // Delete the previous GIF if it exists
    if (session.lastGifMessageId) {
      try {
        await ctx.telegram.deleteMessage(chatId, session.lastGifMessageId);
      } catch (err) {
        debug('Error deleting previous GIF:', err);
      }
    }

    try {
      await sendQuestion(ctx, session.questions[session.currentIndex], session);
      session.currentIndex++;
    } catch (err) {
      debug('Error sending question:', err);
      // Delete the last GIF if it exists
      if (session.lastGifMessageId) {
        try {
          await ctx.telegram.deleteMessage(chatId, session.lastGifMessageId);
        } catch (err) {
          debug('Error deleting GIF:', err);
        }
      }
      await ctx.reply('Oops! Failed to send a question.');
      stopQuizSession(chatId);
    }
  }, 30000); // 30 seconds

  // Store session
  quizSessions.set(chatId, session);
  ctx.reply('🚀 Quiz started! A new question will be sent every 30 seconds. Use /stop to end the quiz.');
};

// Function to stop a quiz session (updated to delete last GIF)
const stopQuizSession = (chatId: number) => {
  const session = quizSessions.get(chatId);
  if (session) {
    clearInterval(session.intervalId);
    // Delete the last GIF if it exists
    if (session.lastGifMessageId) {
      try {
        session.ctx.telegram.deleteMessage(chatId, session.lastGifMessageId);
      } catch (err) {
        debug('Error deleting GIF:', err);
      }
    }
    quizSessions.delete(chatId);
    session.ctx.reply('🛑 Quiz stopped.');
  }
};

// Main quizes handler
const quizes = () => async (ctx: Context) => {
  debug('Triggered "quizes" handler');

  if (!ctx.message || !('text' in ctx.message)) return;

  const text = ctx.message.text.trim().toLowerCase();
  const chapterMatch = text.match(/^\/chapter\s+(.+?)(?:\s+(\d+))?$/);
  const cmdMatch = text.match(/^\/(pyq(b|c|p)?|[bcp]1)(\s*\d+)?$/);
  const stopMatch = text.match(/^\/stop$/);

  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Handle /stop command
  if (stopMatch) {
    if (quizSessions.has(chatId)) {
      stopQuizSession(chatId);
    } else {
      await ctx.reply('No active quiz session to stop.');
    }
    return;
  }

  // Handle /chapter command
  if (chapterMatch) {
    const chapterQuery = chapterMatch[1].trim();
    const count = chapterMatch[2] ? parseInt(chapterMatch[2], 10) : 10; // Default to 10 questions

    try {
      const allQuestions = await fetchQuestions();
      const chapters = getUniqueChapters(allQuestions);
      
      // Find the best matching chapter using fuzzy search
      const matchedChapter = findBestMatchingChapter(chapters, chapterQuery);
      
      if (!matchedChapter) {
        const { message } = await getChaptersMessage();
        await ctx.replyWithHTML(
          `❌ No matching chapter found for "<b>${chapterQuery}</b>"\n\n${message}`
        );
        return;
      }

      const filteredByChapter = allQuestions.filter(
        (q: any) => q.chapter?.trim() === matchedChapter
      );

      if (!filteredByChapter.length) {
        const { message } = await getChaptersMessage();
        await ctx.replyWithHTML(
          `❌ No questions found for chapter "<b>${matchedChapter}</b>"\n\n${message}`
        );
        return;
      }

      // If the matched chapter isn't an exact match, confirm with user
      if (matchedChapter.toLowerCase() !== chapterQuery.toLowerCase()) {
        await ctx.replyWithHTML(
          `🔍 Did you mean "<b>${matchedChapter}</b>"?\n\n` +
          `Starting quiz with questions from this chapter...\n` +
          `(If this isn't correct, use /stop and try again with a more specific chapter name)`
        );
      }

      startQuizSession(ctx, filteredByChapter, count);
    } catch (err) {
      debug('Error fetching questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
    return;
  }

  // Handle /pyq, /b1, /c1, /p1 commands
  if (cmdMatch) {
    const cmd = cmdMatch[1]; // pyq, pyqb, pyqc, pyqp, b1, c1, p1
    const subjectCode = cmdMatch[2]; // b, c, p
    const count = cmdMatch[3] ? parseInt(cmdMatch[3].trim(), 10) : 10; // Default to 10 questions

    const subjectMap: Record<string, string> = {
      b: 'biology',
      c: 'chemistry',
      p: 'physics',
    };
    
    let subject: string | null = null;
    let isMixed = false;
    
    if (cmd === 'pyq') {
      isMixed = true;
    } else if (subjectCode) {
      subject = subjectMap[subjectCode];
    } else if (['b1', 'c1', 'p1'].includes(cmd)) {
      subject = subjectMap[cmd[0]];
    }

    try {
      const filtered = isMixed ? await fetchQuestions() : await fetchQuestions(subject!);
      
      if (!filtered.length) {
        await ctx.reply(`No questions available for ${subject || 'the selected subjects'}.`);
        return;
      }

      startQuizSession(ctx, filtered, count);
    } catch (err) {
      debug('Error fetching questions:', err);
      await ctx.reply('Oops! Failed to load questions.');
    }
  }
};

// Export stop handler for external use (e.g., in main bot file)
export const stopQuiz = () => async (ctx: Context) => {
  const chatId = ctx.chat?.id;
  if (chatId && quizSessions.has(chatId)) {
    stopQuizSession(chatId);
  } else {
    await ctx.reply('No active quiz session to stop.');
  }
};

export { quizes };
