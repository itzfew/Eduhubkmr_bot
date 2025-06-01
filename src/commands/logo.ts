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
  bgGradient.addColorStop(0, '#0f172a');
  bgGradient.addColorStop(0.3, '#1e293b');
  bgGradient.addColorStop(0.7, '#334155');
  bgGradient.addColorStop(1, '#475569');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  // Subtle Sparkle Effect
  ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
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
  const circleRadius = 140;
  ctx.beginPath();
  ctx.arc(circleX, circleY, circleRadius, 0, 2 * Math.PI);
  ctx.lineWidth = 15;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Subtle Glow for Circle
  ctx.shadowColor = `${color}66`;
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(circleX, circleY, circleRadius, 0, 2 * Math.PI);
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Clock Markers
  for (let i = 0; i < 12; i++) {
    const angle = i * 30 * (Math.PI / 180);
    const dotX = circleX + Math.cos(angle) * (circleRadius - 20);
    const dotY = circleY + Math.sin(angle) * (circleRadius - 20);
    ctx.beginPath();
    ctx.arc(dotX, dotY, 5, 0, 2 * Math.PI);
    ctx.fillStyle = secondaryColor;
    ctx.fill();
  }

  // Center Text (Days)
  let fontSize = 100;
  ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  while (ctx.measureText(daysText).width > circleRadius * 1.6 && fontSize > 30) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  }
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 10;
  ctx.fillText(daysText, circleX, circleY);
  ctx.shadowBlur = 0;

  // Stopwatch Knobs
  ctx.fillStyle = color;
  ctx.fillRect(circleX - 30, circleY - circleRadius - 25, 60, 30); // Top knob
  ctx.fillStyle = secondaryColor;
  ctx.save();
  ctx.translate(circleX - circleRadius - 15, circleY - circleRadius + 15);
  ctx.rotate(-30 * (Math.PI / 180));
  ctx.fillRect(-20, -20, 40, 20);
  ctx.restore();

  // Text Section
  const textX = 650;
  const textY = height / 2 - 100;

  // Decorative Lines Around Text Section
  ctx.strokeStyle = `${color}80`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(textX - 150, textY - 30);
  ctx.lineTo(textX + 150, textY - 30);
  ctx.moveTo(textX - 150, textY + 230);
  ctx.lineTo(textX + 150, textY + 230);
  ctx.stroke();

  // "DAYS" Text
  ctx.font = `bold 50px "${fontFamily}"`;
  ctx.fillStyle = color;
  ctx.fillText('DAYS', textX, textY);

  // "LEFT" Text
  ctx.font = `extrabold 80px "${fontFamily}"`;
  ctx.fillStyle = '#ffffff';
  ctx.fillText('LEFT', textX, textY + 80);

  // "For NEET" Text
  ctx.font = `bold 50px "${fontFamily}"`;
  ctx.fillStyle = secondaryColor;
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = 10;
  ctx.fillText('For NEET', textX, textY + 140);
  ctx.shadowBlur = 0;

  // "Until May 3, 2026" Text
  ctx.font = `italic 32px "${fontFamily}"`;
  ctx.fillStyle = '#f1f5f9';
  ctx.fillText('Until May 3, 2026', textX, textY + 190);

  // Quote Text with Background Box
  let quoteFontSize = 30;
  ctx.font = `italic ${quoteFontSize}px "${fontFamily}"`;
  const quoteWords = quote.split(' ');
  let quoteLines: string[] = [];
  let currentLine = '';
  for (const word of quoteWords) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > width * 0.7) {
      quoteLines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) quoteLines.push(currentLine);

  // Quote Background Box
  const quoteBoxWidth = width * 0.8;
  const quoteBoxHeight = quoteLines.length * 40 + 40;
  const quoteBoxX = width / 2 - quoteBoxWidth / 2;
  const quoteBoxY = height - quoteBoxHeight - 50;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.beginPath();
  ctx.roundRect(quoteBoxX, quoteBoxY, quoteBoxWidth, quoteBoxHeight, 20);
  ctx.fill();

  // Quote Text
  ctx.fillStyle = '#f1f5f9';
  ctx.textAlign = 'center';
  quoteLines.forEach((line, index) => {
    ctx.fillText(line, width / 2, quoteBoxY + 30 + index * 40);
  });

  // Decorative Arrow
  ctx.fillStyle = secondaryColor;
  ctx.beginPath();
  ctx.moveTo(width - 100, 50);
  ctx.lineTo(width - 70, 80);
  ctx.lineTo(width - 85, 80);
  ctx.lineTo(width - 85, 110);
  ctx.lineTo(width - 55, 110);
  ctx.lineTo(width - 55, 80);
  ctx.lineTo(width - 70, 80);
  ctx.closePath();
  ctx.fill();

  // Outer Border
  ctx.strokeStyle = color;
  ctx.lineWidth = 8;
  ctx.strokeRect(15, 15, width - 30, height - 30);

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
    const { buffer, quoteUsed } = await generateLogo(countdownText);

    await ctx.replyWithPhoto(
      { source: buffer },
      {
        caption: `🖼️ *Days until May 3, 2026 for NEET!*\nQuote: _"${quoteUsed}"_`,
        parse_mode: 'Markdown',
      }
    );
  } catch (err) {
    console.error('⚠️ Logo generation error:', err);
    await ctx.reply('⚠️ Could not generate countdown image. Please try again.');
  }
};

export { logoCommand };
