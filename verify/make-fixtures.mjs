// Generates the test fixtures used by run.mjs.
// PNG logo + JPG photo are drawn on a canvas in Chromium; the MP4 comes from ffmpeg.
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'fixtures');
mkdirSync(out, { recursive: true });

// SVG logo, the way Figma/Illustrator export flat marks: paths, rect, circle, polygon.
const svgLogo = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="600" height="200" viewBox="0 0 600 200">
  <rect x="10" y="20" width="160" height="160" rx="0" fill="#E8FF1A"/>
  <circle cx="90" cy="100" r="50" fill="#000000"/>
  <path d="M200 40 H260 V140 H320 V160 H200 Z" fill="#1A1A1A"/>
  <path d="M340 160 L380 40 L420 160 Z M365 125 H395 L380 80 Z" fill="#2B2BE6" fill-rule="evenodd"/>
  <path d="M440 40 C520 40 520 100 470 100 S 440 160 520 160" fill="none" stroke="#FF2E7E" stroke-width="14"/>
  <polygon points="540,40 590,40 565,160" fill="#0FB800"/>
</svg>
`;

writeFileSync(join(out, 'logo.svg'), svgLogo);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<html><body></body></html>');

const pngB64 = await page.evaluate(() => {
  // Wide wordmark-style logo on transparent background, 1500x300.
  const c = document.createElement('canvas'); c.width = 1500; c.height = 300;
  const x = c.getContext('2d');
  x.fillStyle = '#E8FF1A'; x.fillRect(20, 20, 260, 260);
  x.fillStyle = '#000'; x.beginPath(); x.arc(150, 150, 80, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#111'; x.font = 'bold 200px Helvetica, Arial, sans-serif';
  x.textBaseline = 'middle'; x.fillText('FIXTURE', 320, 160);
  return c.toDataURL('image/png').split(',')[1];
});
writeFileSync(join(out, 'logo.png'), Buffer.from(pngB64, 'base64'));

const jpgB64 = await page.evaluate(() => {
  // Photo-like scene: sky gradient, sun, hills, a skin-tone patch, noise. 1600x1067.
  const W = 1600, H = 1067;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, H * 0.6);
  sky.addColorStop(0, '#1d4f91'); sky.addColorStop(1, '#9cc9f0');
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  const sun = x.createRadialGradient(1200, 250, 10, 1200, 250, 160);
  sun.addColorStop(0, '#fff6c8'); sun.addColorStop(1, 'rgba(255,200,80,0)');
  x.fillStyle = sun; x.fillRect(0, 0, W, H);
  x.fillStyle = '#2f6b2a';
  x.beginPath(); x.moveTo(0, 700); x.quadraticCurveTo(400, 520, 800, 690); x.quadraticCurveTo(1200, 860, 1600, 640); x.lineTo(1600, H); x.lineTo(0, H); x.fill();
  x.fillStyle = '#7a4b22'; x.fillRect(0, 900, W, 167);
  x.fillStyle = '#e0ac8a'; x.beginPath(); x.ellipse(420, 560, 70, 90, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = '#c4161c'; x.fillRect(340, 650, 160, 220);
  const id = x.getImageData(0, 0, W, H), d = id.data;
  let s = 1234567;
  for (let i = 0; i < d.length; i += 4) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const n = ((s >> 16) % 25) - 12;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  x.putImageData(id, 0, 0);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
});
writeFileSync(join(out, 'photo.jpg'), Buffer.from(jpgB64, 'base64'));
await browser.close();

// 3 s H.264/AAC MP4, 640x360 @ 30 fps, moving colour bars + tone.
execFileSync('ffmpeg', [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=30:duration=3',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline',
  '-c:a', 'aac', '-shortest', '-movflags', '+faststart',
  join(out, 'clip.mp4'),
]);

console.log('fixtures written to', out);
