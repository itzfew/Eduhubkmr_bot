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

function getRandomTextColor(): string {
  const colors = [
    '#facc15', '#34d399', '#60a5fa', '#f472b6', '#c084fc',
    '#f87171', '#fcd34d', '#38bdf8', '#4ade80', '#e879f9'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
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

async function generateLogo(daysText: string): Promise<{ buffer: Buffer, fontUsed: string }> {
  const width = 1000;
  const height = 500;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const fontFamily = getRandomFont();

  // Background
  ctx.fillStyle = '#ffffff'; // White background as in HTML
  ctx.fillRect(0, 0, width, height);

  // Stopwatch circle
  const circleX = 300; // Left side for stopwatch
  const circleY = height / 2;
  const circleRadius = 128;
  ctx.beginPath();
  ctx.arc(circleX, circleY, circleRadius, 0, 2 * Math.PI);
  ctx.lineWidth = 20; // Border thickness
  ctx.strokeStyle = '#000000';
  ctx.stroke();

  // Orange dots (clock markers)
  for (let i = 0; i < 12; i++) {
    const angle = i * 30 * (Math.PI / 180);
    const dotX = circleX + Math.cos(angle) * (circleRadius - 20);
    const dotY = circleY + Math.sin(angle) * (circleRadius - 20);
    ctx.beginPath();
    ctx.arc(dotX, dotY, 4, 0, 2 * Math.PI);
    ctx.fillStyle = '#f59e0b'; // Orange
    ctx.fill();
  }

  // Center text (days)
  let fontSize = 100;
  ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  while (ctx.measureText(daysText).width > circleRadius * 1.5 && fontSize > 20) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  }
  ctx.fillStyle = '#f59e0b'; // Orange text
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(daysText, circleX, circleY);

  // Stopwatch knobs
  ctx.fillStyle = '#f59e0b';
  ctx.fillRect(circleX - 24, circleY - circleRadius - 20, 48, 24); // Top knob
  ctx.fillStyle = '#fb923c'; // Lighter orange
  ctx.save();
  ctx.translate(circleX - circleRadius - 12, circleY - circleRadius + 12);
  ctx.rotate(-30 * (Math.PI / 180));
  ctx.fillRect(-16, -16, 32, 16);
  ctx.restore();

  // Ribbon for "DAYS"
  const ribbonX = 550;
  const ribbonY = height / 2 - 40;
  const ribbonWidth = 200;
  const ribbonHeight = 60;
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath();
  ctx.moveTo(ribbonX, ribbonY);
  ctx.lineTo(ribbonX + ribbonWidth, ribbonY);
  ctx.lineTo(ribbonX + ribbonWidth + 40, ribbonY + ribbonHeight / 2);
  ctx.lineTo(ribbonX + ribbonWidth, ribbonY + ribbonHeight);
  ctx.lineTo(ribbonX, ribbonY + ribbonHeight);
  ctx.closePath();
  ctx.fill();

  // "DAYS" text on ribbon
  ctx.font = `bold 36px "${fontFamily}"`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DAYS', ribbonX + ribbonWidth / 2, ribbonY + ribbonHeight / 2);

  // "LEFT" text
  ctx.font = `extrabold 72px "${fontFamily}"`;
  ctx.fillStyle = '#000000';
  ctx.fillText('LEFT', ribbonX + ribbonWidth / 2, ribbonY + ribbonHeight + 60);

  // Shadow for text
  ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;

  return { buffer: canvas.toBuffer('image/png'), fontUsed: fontFamily };
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
    const { buffer, fontUsed } = await generateLogo(countdownText);

    await ctx.replyWithPhoto({ source: buffer }, {
      caption: `🖼️ *Days until May 3, 2026!*\nFont: \`${fontUsed}\``,
      parse_mode: 'Markdown',
    });
  } catch (err) {
    console.error('⚠️ Logo generation error:', err);
    await ctx.reply('⚠️ Could not generate countdown image. Please try again.');
  }
};

export { logoCommand };
