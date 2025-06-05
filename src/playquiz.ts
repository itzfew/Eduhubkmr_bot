import { Context } from 'telegraf';
import axios from 'axios';

interface Paper {
  exam: string;
  examGroup: string;
  metaId: string;
  title: string;
  year: number;
  languages?: string[];
}

interface ExamCategory {
  title: string;
  papers: Paper[];
}

let examsData: ExamCategory[] = [];

const ITEMS_PER_PAGE = 6;

export function playquiz() {
  return async (ctx: Context) => {
    const message = ctx.message;
    if (message && 'text' in message && message.text.startsWith('/quiz')) {
      try {
        if (examsData.length === 0) {
          const response = await axios.get<ExamCategory[]>('https://raw.githubusercontent.com/itzfew/Eduhub-KMR/refs/heads/main/src/exams.json');
          examsData = response.data;
        }

        await showExams(ctx, 0);

      } catch (err) {
        console.error('Failed to fetch exams.json', err);
        await ctx.reply('❌ Failed to load exams. Please try again later.');
      }
    }
  };
}

async function showExams(ctx: Context, page: number) {
  const start = page * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const examsPage = examsData.slice(start, end);

  const keyboard = examsPage.map((exam) => {
    return [{ text: exam.title, callback_data: `exam_${encodeURIComponent(exam.title)}` }];
  });

  const navButtons: any[] = [];

  if (page > 0) {
    navButtons.push({ text: '⬅️ Previous', callback_data: `exams_page_${page - 1}` });
  }
  if (end < examsData.length) {
    navButtons.push({ text: '➡️ Next', callback_data: `exams_page_${page + 1}` });
  }
  if (navButtons.length > 0) {
    keyboard.push(navButtons);
  }

  await ctx.reply('📝 Choose an exam:', {
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

async function showPapers(ctx: Context, examTitle: string, page: number) {
  const exam = examsData.find(e => e.title === examTitle);
  if (!exam) {
    if (ctx.callbackQuery && 'id' in ctx.callbackQuery) {
      await ctx.answerCbQuery('Exam not found.');
    }
    return;
  }

  const start = page * ITEMS_PER_PAGE;
  const end = start + ITEMS_PER_PAGE;
  const papersPage = exam.papers.slice(start, end);

  const keyboard = papersPage.map((paper) => {
    return [{
      text: paper.title,
      callback_data: `paper_${paper.metaId}`
    }];
  });

  const navButtons: any[] = [];

  if (page > 0) {
    navButtons.push({ text: '⬅️ Previous', callback_data: `papers_${encodeURIComponent(examTitle)}_page_${page - 1}` });
  }
  if (end < exam.papers.length) {
    navButtons.push({ text: '➡️ Next', callback_data: `papers_${encodeURIComponent(examTitle)}_page_${page + 1}` });
  }

  keyboard.push([{ text: '🔙 Back to Exams', callback_data: `exams_page_0` }]);
  if (navButtons.length > 0) {
    keyboard.push(navButtons);
  }

  await ctx.editMessageText(`📚 Choose a paper for *${examTitle}*`, {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: keyboard
    }
  });
}

export function handleQuizActions() {
  return async (ctx: Context) => {
    const callbackQuery = ctx.callbackQuery;
    if (!callbackQuery || !('data' in callbackQuery)) return;

    const callbackData = callbackQuery.data;

    if (callbackData.startsWith('exams_page_')) {
      const page = parseInt(callbackData.replace('exams_page_', ''));
      await showExams(ctx, page);
      await ctx.answerCbQuery();
      return;
    }

    if (callbackData.startsWith('papers_')) {
      const [_, examTitleRaw, __, pageStr] = callbackData.split('_');
      const examTitle = decodeURIComponent(examTitleRaw);
      const page = parseInt(pageStr);
      await showPapers(ctx, examTitle, page);
      await ctx.answerCbQuery();
      return;
    }

    if (callbackData.startsWith('exam_')) {
      const examTitle = decodeURIComponent(callbackData.replace('exam_', ''));
      await showPapers(ctx, examTitle, 0);
      await ctx.answerCbQuery();
      return;
    }

    if (callbackData.startsWith('paper_')) {
      const metaId = callbackData.replace('paper_', '');

      let selectedPaper: Paper | undefined;
      for (const exam of examsData) {
        const paper = exam.papers.find(p => p.metaId === metaId);
        if (paper) {
          selectedPaper = paper;
          break;
        }
      }

      if (!selectedPaper) {
        await ctx.answerCbQuery('Paper not found.');
        return;
      }

      const playLink = `https://quizes.pages.dev/play?metaId=${selectedPaper.metaId}`;

      await ctx.sendMessage(`▶️ [Start ${selectedPaper.title}](${playLink})`, {
        parse_mode: 'MarkdownV2',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: '🔙 Back to Exams', callback_data: 'exams_page_0' }]],
        },
      });
      await ctx.answerCbQuery();
    }
  };
}
