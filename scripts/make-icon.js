// Genera build/icon.png (512x512) a partir de un SVG simple.
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#5b97ff"/><stop offset="1" stop-color="#2f5fd0"/></linearGradient></defs>
  <rect x="24" y="24" width="464" height="464" rx="96" fill="url(#g)"/>
  <rect x="96" y="128" width="320" height="256" rx="28" fill="#fff" opacity=".95"/>
  <circle cx="178" cy="204" r="30" fill="#5b97ff"/>
  <path d="M112 364 L210 268 L270 326 L326 276 L400 364 Z" fill="#2f5fd0"/>
  <path d="M256 150 C 300 210 330 240 330 282 A 74 74 0 0 1 182 282 C 182 240 212 210 256 150 Z"
        fill="#fff" opacity=".55" stroke="#fff" stroke-width="6"/>
</svg>`;

const out = path.join(__dirname, '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
sharp(Buffer.from(svg)).png().toFile(out).then(() => console.log('Icono creado:', out));
