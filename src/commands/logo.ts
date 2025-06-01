import { Context } from 'telegraf';
import { createCanvas, registerFont } from 'canvas';
import fs from 'fs';
import path from 'path';

const fontsDir = path.resolve(__dirname, '../assets/fonts');
const fontFamilies: string[] = [];

// Register fonts
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

function getRandomQuote(): string {
  const quotes = [
    "The future belongs to those who believe in the beauty of their dreams.",
    "Every moment is a fresh beginning.",
    "Stay focused and never give up on your goals.",
    "The best is yet to come.",
    "Make today so awesome that yesterday gets jealous.",
    "Your time is now. Seize it!"
  ];
  return quotes[Math.floor(Math.random() * quotes.length)];
}

function calculateDaysUntilTarget(): string {
  const targetDate = new Date('2026-05-03T00:00:00Z');
  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return 'Time is up!';
  }

  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  return `${diffDays}`;
}

async function generateLogo(daysText: string): Promise<{ buffer: Buffer, fontUsed: string, quoteUsed: string }> {
  const width = 1200; // Increased for more space
  const height = 600; // Increased for quote and target date
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const fontFamily = getRandomFont();
  const quote = getRandomQuote();

  // Background gradient
  const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
  bgGradient.addColorStop(0, '#f1f5f9'); // Light gray
  bgGradient.addColorStop(1, '#e2e8f0'); // Slightly darker gray
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  // Stopwatch circle
  const circleX = 350; // Left side
  const circleY = height / 2 - 50;
  const circleRadius = 140;
  ctx.beginPath();
  ctx.arc(circleX, circleY, circleRadius, 0, 2 * Math.PI);
  ctx.lineWidth = 20;
  ctx.strokeStyle = '#000000';
  ctx.stroke();

  // Glow effect around circle
  ctx.shadowColor = 'rgba(245, 158, 11, 0.5)'; // Orange glow
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(circleX, circleY, circleRadius, 0, 2 * Math.PI);
  ctx.strokeStyle = '#f59e0b';
  ctx.stroke();
  ctx.shadowBlur = 0; // Reset shadow

  // Orange dots (clock markers)
  for (let i = 0; i < 12; i++) {
    const angle = i * 30 * (Math.PI / 180);
    const dotX = circleX + Math.cos(angle) * (circleRadius - 20);
    const dotY = circleY + Math.sin(angle) * (circleRadius - 20);
    ctx.beginPath();
    ctx.arc(dotX, dotY, 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#f59e0b';
    ctx.fill();
  }

  // Center text (days)
  let fontSize = 110;
  ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  while (ctx.measureText(daysText).width > circleRadius * 1.6 && fontSize > 20) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  }
  ctx.fillStyle = '#f59e0b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = 10;
  ctx.fillText(daysText, circleX, circleY);
  ctx.shadowBlur = 0;

  // Stopwatch knobs
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(circleX - 30, circleY - circleRadius - 25, 60, 30); // Top knob
  ctx.fillStyle = '#fb923c';
  ctx.save();
  ctx.translate(circleX - circleRadius - 15, circleY - circleRadius + 15);
  ctx.rotate(-30 * (Math.PI / 180));
  ctx.fillRect(-20, -20, 40, 20);
  ctx.restore();

  // Ribbon for "DAYS"
  const ribbonX = 600;
  const ribbonY = height / 2 - 80;
  const ribbonWidth = 250;
  const ribbonHeight = 70;
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.moveTo(ribbonX, ribbonY);
  ctx.lineTo(ribbonX + ribbonWidth, ribbonY);
  ctx.lineTo(ribbonX + ribbonWidth + 50, ribbonY + ribbonHeight / 2);
  ctx.lineTo(ribbonX + ribbonWidth, ribbonY + ribbonHeight);
  ctx.lineTo(ribbonX, ribbonY + ribbonHeight);
  ctx.closePath();
  ctx.fill();

  // Glow effect for ribbon
  ctx.shadowColor = 'rgba(245, 158, 11, 0.4)';
  ctx.shadowBlur  = 15;
  ctx.fill();
  ctx.shadowBlur = 0;

  // "DAYS" text on ribbon
  ctx.font = `bold 40px "${fontFamily}"`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('DAYS', ribbonX + ribbonWidth / 2, ribbonY + ribbonHeight / 2);

  // "LEFT" text
  ctx.font = `extrabold 80px "${fontFamily}"`;
  ctx.fillStyle = '#000000';
  ctx.fillText('LEFT', ribbonX + ribbonWidth / 2, ribbonY + ribbonHeight + 70);

  // "Until May 3, 2026" text
  ctx.font = `italic 30px "${fontFamily}"`;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillText('Until May 3, 2026', ribbonX + ribbonWidth / 2, ribbonY + ribbonHeight + 120);

  // Quote text
  let quoteFontSize = 28;
  ctx.font = `italic ${quoteFontSize}px "${fontFamily}"`;
  const quoteWords = quote.split(' ');
  let quoteLines: string[] = [];
  let currentLine = '';
  for (const word of quoteWords) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    ctx.font = `italic ${quoteFontSize}px "${fontFamily}"`;
    if (ctx.measureText(testLine).width > width * 0.8) {
      quoteLines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) quoteLines.push(currentLine);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
  const quoteY = height - 100;
  quoteLines.forEach((line, index) => {
    ctx.fillText(line, width / 2, quoteY + index * 35);
  });

  return { buffer: canvas.toBuffer('image/png'), fontUsed: fontFamily, quoteUsed: quote };
}

// Telegraf Command
const logoCommand = () => async (ctx: Context) => {
  try {
    const message = ctx.message;
    const text = message?.text || '';
    const match = text.match(/^\/gen\b/i);

    if (!match) {
      return ctx.reply('❗ *Usage:* `/gen` to generate a countdown image until May 3, 2026', { parse_mode: 'Markdown' });
    }

    const countdownText = calculateDaysUntilTarget();
    const { buffer, fontUsed, quoteUsed } = await generateLogo(countdownText);

    await ctx.replyWithPhoto({ source: buffer }, {
      caption: `🖼️ *Days until May 3, 2026!*\nFont: \`${fontUsed}\`\nQuote: _"${quoteUsed}"_`,
      parse_mode: 'Markdown',
    });
  } catch (err) {
    console.error('⚠️ Logo generation error:', err);
    await ctx.reply('⚠️ Could not generate countdown image. Please try again.');
  }
};

export { logoCommand };
