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

function getRandomColor(): { primary: string; secondary: string } {
  const colors = [
    { primary: '#f59e0b', secondary: '#fb923c' }, // Orange
    { primary: '#dc2626', secondary: '#f87171' }, // Red
    { primary: '#16a34a', secondary: '#4ade80' }, // Green
    { primary: '#2563eb', secondary: '#60a5fa' }, // Blue
    { primary: '#d946ef', secondary: '#f472b6' }  // Purple
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
    "The only limit is your imagination."
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
  const width = 1200;
  const height = 900; // 4:3 aspect ratio
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

  // Circular gradient background for days text
  const circleGradient = ctx.createRadialGradient(circleX, circleY, 0, circleX, circleY, circleRadius);
  circleGradient.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
  circleGradient.addColorStop(1, 'rgba(255, 255, 255, 0.05)');
  ctx.beginPath();
  ctx.arc(circleX, circleY, circleRadius, 0, 2 * Math.PI);
  ctx.fillStyle = circleGradient;
  ctx.fill();

  // Stopwatch border
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
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 15;
  ctx.fillText(daysText, circleX, circleY);
  ctx.shadowBlur = 0;

  // Stopwatch knobs
  ctx.fillStyle = color;
  ctx.fillRect(circleX - 35, circleY - circleRadius - 30, 70, 35); // Top knob
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

  // Inner shadow for ribbon
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // "DAYS" text on ribbon
  ctx.font = `bold 48px "${fontFamily}"`;
  ctx.fillStyle = color;
  ctx.fillText('DAYS', ribbonX + ribbonWidth / 2, ribbonY + ribbonHeight / 2);

  // "LEFT" text with gradient background
  const leftText = 'LEFT';
  ctx.font = `extrabold 90px "${fontFamily}"`;
  const leftWidth = ctx.measureText(leftText).width;
  const leftX = ribbonX + ribbonWidth / 2;
  const leftY = ribbonY + ribbonHeight + 80;
  const leftBgWidth = leftWidth + 40;
  const leftBgHeight = 100;
  const leftGradient = ctx.createLinearGradient(leftX - leftBgWidth / 2, leftY - leftBgHeight / 2, leftX + leftBgWidth / 2, leftY + leftBgHeight / 2);
  leftGradient.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
  leftGradient.addColorStop(1, 'rgba(255, 255, 255, 0.05)');
  ctx.fillStyle = leftGradient;
  ctx.fillRect(leftX - leftBgWidth / 2, leftY - leftBgHeight / 2, leftBgWidth, leftBgHeight);
  ctx.fillStyle = color;
  ctx.fillText(leftText, leftX, leftY);

  // "Until May 3, 2026" text with underline
  const untilText = 'Until May 3, 2026';
  ctx.font = `italic 36px "${fontFamily}"`;
  const untilWidth = ctx.measureText(untilText).width;
  const untilX = ribbonX + ribbonWidth / 2;
  const untilY = ribbonY + ribbonHeight + 140;
  ctx.fillStyle = color;
  ctx.fillText(untilText, untilX, untilY);
  ctx.beginPath();
  ctx.moveTo(untilX - untilWidth / 2, untilY + 10);
  ctx.lineTo(untilX + untilWidth / 2, untilY + 10);
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.stroke();

  // Quote text with semi-transparent background
  let quoteFontSize = 32;
  ctx.font = `italic ${quoteFontSize}px "${fontFamily}"`;
  const quoteWords = quote.split(' ');
  let quoteLines: string[] = [];
  let currentLine = '';
  let maxQuoteWidth = 0;
  for (const word of quoteWords) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    ctx.font = `italic ${quoteFontSize}px "${fontFamily}"`;
    if (ctx.measureText(testLine).width > width * 0.75) {
      quoteLines.push(currentLine);
      maxQuoteWidth = Math.max(maxQuoteWidth, ctx.measureText(currentLine).width);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) {
    quoteLines.push(currentLine);
    maxQuoteWidth = Math.max(maxQuoteWidth, ctx.measureText(currentLine).width);
  }

  const quoteY = height - 120;
  const quoteBgWidth = maxQuoteWidth + 40;
  const quoteBgHeight = quoteLines.length * 40 + 20;
  const quoteBgX = width / 2 - quoteBgWidth / 2;
  const quoteBgY = quoteY - 30;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.fillRect(quoteBgX, quoteBgY, quoteBgWidth, quoteBgHeight);

  ctx.fillStyle = color;
  quoteLines.forEach((line, index) => {
    ctx.fillText(line, width / 2, quoteY + index * 40);
  });

  // Decorative border
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.strokeRect(20, 20, width - 40, height - 40);

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
