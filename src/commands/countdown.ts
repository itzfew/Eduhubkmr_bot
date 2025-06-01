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

function getCountdown(): string {
  const targetDate = new Date('2026-05-03T00:00:00Z');
  const now = new Date();
  const diffMs = targetDate.getTime() - now.getTime();

  if (diffMs <= 0) {
    return 'Countdown has ended!';
  }

  const diffSeconds = Math.floor(diffMs / 1000);
  const months = Math.floor(diffSeconds / (60 * 60 * 24 * 30));
  const days = Math.floor((diffSeconds % (60 * 60 * 24 * 30)) / (60 * 60 * 24));
  const hours = Math.floor((diffSeconds % (60 * 60 * 24)) / (60 * 60));
  const minutes = Math.floor((diffSeconds % (60 * 60)) / 60);

  return `${months} Months\n${days} Days\n${hours} Hours\n${minutes} Minutes`;
}

async function generateCountdownImage(): Promise<{ buffer: Buffer; fontUsed: string }> {
  const width = 1000;
  const height = 400;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  const fontFamily = getRandomFont();

  // Background
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, width, height);

  // Get countdown text
  const countdownText = getCountdown();
  const lines = countdownText.split('\n');

  // Auto-size font
  let fontSize = 80;
  ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  const maxWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
  while (maxWidth > width * 0.85 && fontSize > 10) {
    fontSize -= 2;
    ctx.font = `bold ${fontSize}px "${fontFamily}"`;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // Gradient or solid fill
  if (Math.random() < 0.5) {
    const gradient = ctx.createLinearGradient(0, 0, width, 0);
    gradient.addColorStop(0, getRandomTextColor());
    gradient.addColorStop(1, getRandomTextColor());
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = getRandomTextColor();
  }

  // Shadow
  ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
  ctx.shadowBlur = 25;
  ctx.shadowOffsetX = 6;
  ctx.shadowOffsetY = 6;

  // Rotation
  const angle = (Math.random() * 10 - 5) * (Math.PI / 180);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(angle);

  const lineHeight = fontSize + 20;
  lines.forEach((line, index) => {
    ctx.fillText(line.toUpperCase(), 0, (index - (lines.length - 1) / 2) * lineHeight);
  });

  ctx.restore();

  return { buffer: canvas.toBuffer('image/png'), fontUsed: fontFamily };
}

// Telegraf Command
const countdownCommand = () => async (ctx: Context) => {
  try {
    const { buffer, fontUsed } = await generateCountdownImage();

    await ctx.replyWithPhoto({ source: buffer }, {
      caption: `🕒 *Countdown to May 3, 2026!*\nFont: \`${fontUsed}\``,
      parse_mode: 'Markdown',
    });
  } catch (err) {
    console.error('⚠️ Countdown image generation error:', err);
    await ctx.reply('⚠️ Could not generate countdown image. Please try again.');
  }
};

export { countdownCommand };
