// src/commands/countdown.ts
import { Context, Telegraf } from 'telegraf';
import { createCanvas, registerFont } from 'canvas';
import fs from 'fs';
import path from 'path';
import { db, ref, set, onValue } from '../utils/firebase';

// Admin ID
const ADMIN_ID = 6930703214;

// Font registration
const fontsDir = path.resolve(__dirname, '../assets/fonts');
const fontFamilies: string[] = [];

fs.readdirSync(fontsDir).forEach((file) => {
  const filePath = path.join(fontsDir, file);
  if (fs.statSync(filePath).isFile() && /\.(ttf|otf)$/i.test(file)) {
    const familyName = path.parse(file).name.replace(/[-_\s]/g, '');
    try {
      registerFont(filePath, { family: familyName });
      fontFamilies.push(familyName);
    } catch (e) {
      console.warn(`❌ Font registration failed for ${file}:`, e);
    }
  }
});

function getRandomFont(): string {
  return fontFamilies.length > 0
    ? fontFamilies[Math.floor(Math.random() * fontFamilies.length)]
    : 'sans-serif';
}

function getRandomColor(): { primary: string; secondary: string } {
  const colors = [
    { primary: '#f59e0b', secondary: '#fb923c' }, // Orange
    { primary: '#dc2626', secondary: '#f87171' }, // Red
    { primary: '#16a34a', secondary: '#4ade80' }, // Green
    { primary: '#2563eb', secondary: '#60a5fa' }, // Blue
    { primary: '#d946ef', secondary: '#f472b6' }, // Purple
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function getRandomQuote(): string {
  const quotes = [
    "The future belongs to those who believe in the beauty of their dreams.",
    "Every moment is a fresh beginning.",
    "Stay focused and never give up on your goals.",
    "The best is yet to come.",
    "Make today so awesome that yesterday gets jealous.",
    "Your time is now. Seize it!",
    "Dream big, work hard, stay focused.",
    "The only limit is your imagination.",
  ];
  return quotes[Math.floor(Math.random() * quotes.length)];
}

function calculateDaysUntilTarget(targetDateStr: string): string {
  const targetDate = new Date(targetDateStr + 'T00:00:00Z');
  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return 'Time is up!';
  }

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return `${diffDays}`;
}

async function generateLogo(daysText: string, targetDate: string): Promise<{ buffer: Buffer; fontUsed: string; quoteUsed: string }> {
  const width = 1200;
  const height = 900;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const fontFamily = getRandomFont();
  const { primary: color, secondary: secondaryColor } = getRandomColor();
  const quote = getRandomQuote();

  // Background gradient
  const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
  bgGradient.addColorStop(0, '#1e293b');
  bgGradient.addColorStop(1, '#475569');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  // Subtle background pattern (diagonal lines)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let i = -height; i < width + height; i += 30) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + height, height);
    ctx.stroke();
  }

  // Stopwatch circle
  const circleX = 350;
  const circleY = height / 2 - 50;
  const circleRadius = 150;
  ctx.beginPath();
  ctx.arc(circleX, circleY, circleRadius, 0, 2 * Math.PI);
  ctx.lineWidth = 20;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Glow effect around circle
  ctx.shadowColor = `${color}80`;
  ctx.shadowBlur = 25;
  ctx.beginPath();
  ctx.arc(circleX, circleY, circleRadius, 0, 2 * Math.PI);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Colored dots (clock markers)
  for (let i = 0; i < 12; i++) {
    const angle = i * 30 * (Math.PI / 180);
    const dotX = circleX + Math.cos(angle) * (circleRadius - 25);
    const dotY = circleY + Math.sin(angle) * (circleRadius - 25);
    ctx.beginPath();
    ctx.arc(dotX, dotY, 6, 0, 2 * Math.PI);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // Center text (days)
  let fontSize = 120;
  ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  while (ctx.measureText(daysText).width > circleRadius * 1.6 && fontSize > 30) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 15;
  ctx.fillText(daysText, circleX, circleY);
  ctx.shadowBlur = 0;

  // Stopwatch knobs
  ctx.fillStyle = color;
  ctx.fillRect(circleX - 35, circleY - circleRadius - 30, 70, 35);
  ctx.fillStyle = secondaryColor;
  ctx.save();
  ctx.translate(circleX - circleRadius - 20, circleY - circleRadius + 20);
  ctx.rotate(-30 * (Math.PI / 180));
  ctx.fillRect(-25, -25, 50, 25);
  ctx.restore();

  // Ribbon for "DAYS"
  const ribbonX = 650;
  const ribbonY = height / 2 - 100;
  const ribbonWidth = 280;
  const ribbonHeight = 80;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(ribbonX, ribbonY);
  ctx.lineTo(ribbonX + ribbonWidth, ribbonY);
  ctx.lineTo(ribbonX + ribbonWidth + 60, ribbonY + ribbonHeight / 2);
  ctx.lineTo(ribbonX + ribbonWidth, ribbonY + ribbonHeight);
  ctx.lineTo(ribbonX, ribbonY + ribbonHeight);
  ctx.closePath();
  ctx.fill();

  // Glow effect for ribbon
  ctx.shadowColor = `${color}66`;
  ctx.shadowBlur = 20;
  ctx.fill();
  ctx.shadowBlur = 0;

  // "DAYS" text on ribbon
  ctx.font = `bold 48px "${fontFamily}"`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('DAYS', ribbonX + ribbonWidth / 2, ribbonY + ribbonHeight / 2);

  // "LEFT" text
  ctx.font = `extrabold 90px "${fontFamily}"`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('LEFT', ribbonX + ribbonWidth / 2, ribbonY + ribbonHeight + 80);

  // Target date text (e.g., "Until May 3, 2026")
  const formattedDate = new Date(targetDate).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  ctx.font = `italic 36px "${fontFamily}"`;
  ctx.fillStyle = '#f1f5f9';
  ctx.fillText(`Until ${formattedDate}`, ribbonX + ribbonWidth / 2, ribbonY + ribbonHeight + 140);

  // Quote text
  let quoteFontSize = 32;
  ctx.font = `italic ${quoteFontSize}px "${fontFamily}"`;
  const quoteWords = quote.split(' ');
  let quoteLines: string[] = [];
  let currentLine = '';
  for (const word of quoteWords) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    ctx.font = `italic ${quoteFontSize}px "${fontFamily}"`;
    if (ctx.measureText(testLine).width > width * 0.75) {
      quoteLines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) quoteLines.push(currentLine);

  ctx.fillStyle = '#f1f5f9';
  const quoteY = height - 120;
  quoteLines.forEach((line, index) => {
    ctx.fillText(line, width / 2, quoteY + index * 40);
  });

  // Decorative border
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.strokeRect(20, 20, width - 40, height - 40);

  return { buffer: canvas.toBuffer('image/png'), fontUsed: fontFamily, quoteUsed: quote };
}

// Function to validate and convert DD-MM-YYYY to YYYY-MM-DD
function validateAndConvertDate(dateStr: string): string | null {
  const match = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (isNaN(date.getTime())) return null;
  return `${year}-${month}-${day}`;
}

// Admin command to submit countdown
async function handleSubmitCountdown(ctx: Context) {
  const message = ctx.message;
  if (!('text' in message)) return;

  const userId = ctx.from?.id;
  if (userId !== ADMIN_ID) {
    return ctx.reply('❌ Only the admin can submit countdowns.');
  }

  const text = message.text;
  const match = text.match(/^\/submitcountdown_([a-zA-Z]+)\s+(\d{2}-\d{2}-\d{4})$/i);
  if (!match) {
    return ctx.reply('❗ *Usage:* `/submitcountdown_<exam> DD-MM-YYYY` (e.g., `/submitcountdown_neet 03-05-2026`)', {
      parse_mode: 'Markdown',
    });
  }

  const [, exam, dateStr] = match;
  const formattedDate = validateAndConvertDate(dateStr);
  if (!formattedDate) {
    return ctx.reply('❌ Invalid date format. Use DD-MM-YYYY.');
  }

  try {
    await set(ref(db, `exam-countdowns/${exam.toLowerCase()}`), { targetDate: formattedDate });
    ctx.reply(`✅ Countdown for ${exam.toUpperCase()} set to ${dateStr}.`);
  } catch (err) {
    console.error('⚠️ Firebase write error:', err);
    ctx.reply('⚠️ Could not save countdown. Please try again.');
  }
}

// Function to register countdown commands dynamically
function registerCountdownCommands(bot: Telegraf<Context>) {
  onValue(ref(db, 'exam-countdowns'), (snapshot) => {
    const exams = snapshot.val() || {};
    Object.keys(exams).forEach((exam) => {
      const command = `${exam.toLowerCase()}countdown`;
      bot.command(command, async (ctx) => {
        try {
          const targetDate = exams[exam].targetDate;
          if (!targetDate) {
            return ctx.reply(`❌ No countdown set for ${exam.toUpperCase()}.`);
          }
          const countdownText = calculateDaysUntilTarget(targetDate);
          const { buffer, fontUsed, quoteUsed } = await generateLogo(countdownText, targetDate);
          await ctx.replyWithPhoto({ source: buffer }, {
            caption: `🖼️ *Days until ${exam.toUpperCase()}!*\nFont: \`${fontUsed}\`\nQuote: _"${quoteUsed}"_`,
            parse_mode: 'Markdown',
          });
        } catch (err) {
          console.error(`⚠️ ${exam.toUpperCase()} countdown error:`, err);
          await ctx.reply(`⚠️ Could not generate ${exam.toUpperCase()} countdown image. Please try again.`);
        }
      });
    });
  });
}

// Main function to setup commands
const setupCountdownCommands = (bot: Telegraf<Context>) => {
  // Register admin command
  bot.command(/submitcountdown_.+/i, handleSubmitCountdown);
