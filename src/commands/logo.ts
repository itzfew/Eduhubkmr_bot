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
  return `${diffDays} Days`;
}

function splitText(text: string): [string, string, string] {
  const words = text.trim().split(/\s+/);
  let mainText = words.join(' ');
  return [mainText, 'Until', 'May 3, 2026'];
}

async function generateLogo(text: string): Promise<{ buffer: Buffer, fontUsed: string }> {
  const width = 1000;
  const height = 500; // Increased height for subtitle
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const fontFamily = getRandomFont();

  // Background gradient
  const bgGradient = ctx.createLinearGradient(0, 0, 0, height);
  bgGradient.addColorStop(0, '#0f172a');
  bgGradient.addColorStop(1, '#1e293b');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  // Subtle pattern (diagonal lines)
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  for (let i = -height; i < width + height; i += 20) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + height, height);
    ctx.stroke();
  }

  // Split text
  const [mainText, subtitle1, subtitle2] = splitText(text);

  // Auto-size main text
  let mainFontSize = 120;
  ctx.font = `bold ${mainFontSize}px "${fontFamily}"`;
  while (ctx.measureText(mainText).width > width * 0.8 && mainFontSize > 20) {
    mainFontSize -= 2;
    ctx.font = `bold ${mainFontSize}px "${fontFamily}"`;
  }

  // Text styling
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Gradient or solid fill for main text
  let textFill;
  if (Math.random() < 0.6) {
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, getRandomTextColor());
    gradient.addColorStop(1, getRandomTextColor());
    textFill = gradient;
  } else {
    textFill = getRandomTextColor();
  }

  // Enhanced shadow and glow effect
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 15;
  ctx.shadowOffsetX = 4;
  ctx.shadowOffsetY = 4;

  // Draw main text with glow
  ctx.save();
  ctx.translate(width / 2, height / 2 - 50);
  ctx.fillStyle = textFill;
  ctx.fillText(mainText.toUpperCase(), 0, 0);

  // Add glow by redrawing with lower opacity
  ctx.globalAlpha = 0.4;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(mainText.toUpperCase(), 0, 0);
  ctx.globalAlpha = 1.0;
  ctx.restore();

  // Subtitle text
  const subtitleFontSize = Math.min(mainFontSize * 0.4, 40);
  ctx.font = `bold ${subtitleFontSize}px "${fontFamily}"`;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.shadowBlur = 5;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 2;

  ctx.fillText(subtitle1.toUpperCase(), width / 2, height / 2 + 50);
  ctx.fillText(subtitle2.toUpperCase(), width / 2, height / 2 + 90);

  // Decorative border
  ctx.strokeStyle = textFill;
  ctx.lineWidth = 5;
  ctx.strokeRect(20, 20, width - 40, height - 40);

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
