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

  // Enhanced Background Gradient
  const bgGradient = ctx.createLinearGradient(0, 0, width, height);
  bgGradient.addColorStop(0, '#1e293b');
  bgGradient.addColorStop(0.5, '#334155');
  bgGradient.addColorStop(1, '#475569');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  // Subtle Star Pattern
  ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
  for (let i = 0; i < 50; i++) {
    const x = Math.random() * width;
    const y = Math.random() * height;
    ctx.beginPath();
    ctx.arc(x, y, Math.random() * 2 + 1, 0, 2 * Math.PI);
    ctx.fill();
  }

  // Stopwatch Circle
  const circleX = 350;
  const circleY = height / 2;
  const circleRadius = 150;
  ctx.beginPath();
  ctx.arc(circleX, circleY, circleRadius, 0, 2 * Math.PI);
  ctx.lineWidth = 20;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Glow Effect for Circle
  ctx.shadowColor = `${color}80`;
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.arc(circleX, circleY, circleRadius, 0, 2 * Math.PI);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Colored Clock Markers
  for (let i = 0; i < 12; i++) {
    const angle = i * 30 * (Math.PI / 180);
    const dotX = circleX + Math.cos(angle) * (circleRadius - 25);
    const dotY = circleY + Math.sin(angle) * (circleRadius - 25);
    ctx.beginPath();
    ctx.arc(dotX, dotY, 6, 0, 2 * Math.PI);
    ctx.fillStyle = secondaryColor;
    ctx.fill();
  }

  // Center Text (Days)
  let fontSize = 120;
  ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  while (ctx.measureText(daysText).width > circleRadius * 1.6 && fontSize > 30) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
  ctx.shadowBlur = 15;
  ctx.fillText(daysText, circleX, circleY - 20); // Slight offset for balance
  ctx.shadowBlur = 0;

  // Stopwatch Knobs
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
  const ribbonY = height / 2 - 120;
  const ribbonWidth = 300;
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

  // Glow Effect for Ribbon
  ctx.shadowColor = `${color}66`;
  ctx.shadowBlur = 20;
  ctx.fill();
  ctx.shadowBlur = 0;

  // "DAYS" Text on Ribbon
  ctx.font = `bold 48px "${fontFamily}"`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('DAYS', ribbonX + ribbonWidth / 2, ribbonY + ribbonHeight / 2 + 15);

  // "For NEET" Text
  ctx.font = `extrabold 60px "${fontFamily}"`;
  ctx.fillStyle = secondaryColor;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 10;
  ctx.fillText('For NEET', ribbonX + ribbonWidth / 2, ribbonY - 60);
  ctx.shadowBlur = 0;

  // "LEFT" Text
  ctx.font = `extrabold 90px "${fontFamily}"`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('LEFT', ribbonX + ribbonWidth / 2, ribbonY + ribbonHeight + 90);

  // "Until May 3, 2026" Text
  ctx.font = `italic 36px "${fontFamily}"`;
  ctx.fillStyle = '#f1f5f9';
  ctx.fillText('Until May 3, 2026', ribbonX + ribbonWidth / 2, ribbonY + ribbonHeight + 150);

  // Quote Text
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
  const quoteY = height - 150;
  quoteLines.forEach((line, index) => {
    ctx.fillText(line, width / 2, quoteY + index * 40);
  });

  // Motivational Arrow Graphic
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(width - 150, 50);
  ctx.lineTo(width - 100, 100);
  ctx.lineTo(width - 120, 100);
  ctx.lineTo(width - 120, 150);
  ctx.lineTo(width - 80, 150);
  ctx.lineTo(width - 80, 100);
  ctx.lineTo(width - 100, 100);
  ctx.closePath();
  ctx.fill();

  // Decorative Border
  ctx.strokeStyle = color;
  ctx.lineWidth = 10;
  ctx.strokeRect(20, 20, width - 40, height - 40);

  return { buffer: canvas.toBuffer('image/png'), fontUsed: fontFamily, quoteUsed: quote };
}

// Telegraf Command
const logoCommand = () => async (ctx: Context) => {
  try {
    const message = ctx.message;
    const text = message?.text || '';
    const match = text.match(/^\/countdown\b/i);

    if (!match) {
      return ctx.reply('❗ *Usage:* `/countdown` to generate a countdown image until May 3, 2026 for NEET', { parse_mode: 'Markdown' });
    }

    const countdownText = calculateDaysUntilTarget();
    const { buffer, fontUsed, quoteUsed } = await generateLogo(countdownText);

    await ctx.replyWithPhoto(
      { source: buffer },
      {
        caption: `🖼️ *Days until May 3, 2026 for NEET!*\nFont: \`${fontUsed}\`\nQuote: _"${quoteUsed}"_`,
        parse_mode: 'Markdown',
      }
    );
  } catch (err) {
    console.error('⚠️ Logo generation error:', err);
    await ctx.reply('⚠️ Could not generate countdown image. Please try again.');
  }
};

export { logoCommand };
