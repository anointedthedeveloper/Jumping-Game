'use strict';
(() => {

// ============================== Config ==============================
const VH = 800;
const GRAV = 2600;
const JUMP_V = 1010;
const MOVE_V = 450;
const MAX_FALL = 1500;
const COYOTE = 0.10;
const BUFFER = 0.12;
const START_LIVES = 3;
const STEP = 1 / 120;
const PLAT_WS = [64, 80, 96, 112, 128];
const MAX_PARTICLES = 150;

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const $ = id => document.getElementById(id);
const TAU = Math.PI * 2;

function mixColor(c1, c2, t) {
  return [lerp(c1[0], c2[0], t) | 0, lerp(c1[1], c2[1], t) | 0, lerp(c1[2], c2[2], t) | 0];
}
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

function sweep(arr, keep) {
  let n = 0;
  for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[n++] = arr[i];
  arr.length = n;
}

// ============================== Canvas ==============================
const canvas = $('game');
const ctx = canvas.getContext('2d');
const stage = $('stage');
let VW = 480, DPR = 1;

function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  const ww = window.innerWidth, wh = window.innerHeight;
  VW = Math.max(1, Math.round(VH * ww / wh));
  canvas.width = Math.round(VW * DPR);
  canvas.height = Math.round(VH * DPR);
  canvas.style.width = ww + 'px';
  canvas.style.height = wh + 'px';
  stage.style.width = ww + 'px';
  stage.style.height = wh + 'px';
}
window.addEventListener('resize', resize);

// ============================== Audio ==============================
const Sound = {
  ctx: null, master: null,
  muted: localStorage.getItem('sh_muted') === '1',
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  },
  setMuted(m) {
    this.muted = m;
    localStorage.setItem('sh_muted', m ? '1' : '0');
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  },
  tone(freq, dur, type, vol, slide, delay) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(vol || 0.3, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.03);
  },
  jump()     { this.tone(280, 0.16, 'square', 0.16, 340); },
  coin()     { this.tone(950, 0.07, 'sine', 0.24); this.tone(1420, 0.13, 'sine', 0.2, 0, 0.06); },
  land()     { this.tone(170, 0.09, 'triangle', 0.2, -70); },
  boing()    { this.tone(170, 0.24, 'sine', 0.3, 520); },
  hit()      { this.tone(220, 0.26, 'sawtooth', 0.28, -160); },
  fall()     { this.tone(520, 0.4, 'sine', 0.2, -400); },
  over()     { this.tone(420, 0.5, 'sawtooth', 0.22, -320); this.tone(290, 0.75, 'triangle', 0.18, -190, 0.16); },
  click()    { this.tone(650, 0.05, 'sine', 0.16); },
  levelup()  { this.tone(440, 0.1, 'sine', 0.2); this.tone(550, 0.1, 'sine', 0.2, 0, 0.1); this.tone(660, 0.25, 'sine', 0.25, 0, 0.2); },
  powerup()  { this.tone(600, 0.08, 'sine', 0.2); this.tone(800, 0.12, 'sine', 0.2, 0, 0.08); },
  checkpoint(){ this.tone(520, 0.12, 'sine', 0.22); this.tone(780, 0.18, 'sine', 0.2, 0, 0.1); }
};


// ============================== Level definitions ==============================
const LEVELS = [
  {
    num: 1, name: 'Cloud Garden', world: 'Green Hills',
    sky: { top: [110,190,255], bottom: [205,240,255] },
    height: 1800, checkpointAt: 900,
    platTypes: { normal:1, moving:0, bouncy:0, crumble:0, disappear:0, ice:0 },
    spikeChance: 0, mineChance: 0, gapMin: 90, gapMax: 110, platWMin: 96, platWMax: 128,
    powerupChance: 0.08, enemyChance: 0, windZones: []
  },
  {
    num: 2, name: 'Breezy Peaks', world: 'Green Hills',
    sky: { top: [130,200,240], bottom: [200,235,255] },
    height: 2200, checkpointAt: 1100,
    platTypes: { normal:0.6, moving:0.4, bouncy:0, crumble:0, disappear:0, ice:0 },
    spikeChance: 0, mineChance: 0, gapMin: 95, gapMax: 120, platWMin: 88, platWMax: 128,
    powerupChance: 0.09, enemyChance: 0, windZones: []
  },
  {
    num: 3, name: 'Crumble Cliffs', world: 'Green Hills',
    sky: { top: [150,180,220], bottom: [210,230,245] },
    height: 2600, checkpointAt: 1300,
    platTypes: { normal:0.45, moving:0.25, bouncy:0.1, crumble:0.2, disappear:0, ice:0 },
    spikeChance: 0.06, mineChance: 0, gapMin: 100, gapMax: 130, platWMin: 80, platWMax: 112,
    powerupChance: 0.1, enemyChance: 0, windZones: []
  },
  {
    num: 4, name: 'Spike Ridge', world: 'Cloud City',
    sky: { top: [255,156,108], bottom: [255,225,175] },
    height: 3000, checkpointAt: 1500,
    platTypes: { normal:0.4, moving:0.3, bouncy:0.1, crumble:0.15, disappear:0.05, ice:0 },
    spikeChance: 0.18, mineChance: 0.05, gapMin: 105, gapMax: 138, platWMin: 80, platWMax: 112,
    powerupChance: 0.11, enemyChance: 0.04, windZones: []
  },
  {
    num: 5, name: 'Vanishing Act', world: 'Cloud City',
    sky: { top: [240,140,90], bottom: [255,210,160] },
    height: 3400, checkpointAt: 1700,
    platTypes: { normal:0.3, moving:0.25, bouncy:0.1, crumble:0.15, disappear:0.2, ice:0 },
    spikeChance: 0.14, mineChance: 0.07, gapMin: 108, gapMax: 142, platWMin: 72, platWMax: 104,
    powerupChance: 0.12, enemyChance: 0.06, windZones: []
  },
  {
    num: 6, name: 'Ice Caverns', world: 'Crystal Caverns',
    sky: { top: [52,91,143], bottom: [138,184,199] },
    height: 3800, checkpointAt: 1900,
    platTypes: { normal:0.25, moving:0.25, bouncy:0.05, crumble:0.15, disappear:0.1, ice:0.2 },
    spikeChance: 0.16, mineChance: 0.08, gapMin: 112, gapMax: 148, platWMin: 72, platWMax: 96,
    powerupChance: 0.12, enemyChance: 0.07,
    windZones: [{ yFrac: 0.3, h: 200, windX: -80, gravMult: 1 }, { yFrac: 0.7, h: 180, windX: 80, gravMult: 1 }]
  },
  {
    num: 7, name: 'Sky Factory', world: 'Sky Factory',
    sky: { top: [80,70,110], bottom: [140,120,160] },
    height: 4200, checkpointAt: 2100,
    platTypes: { normal:0.2, moving:0.35, bouncy:0.1, crumble:0.15, disappear:0.1, ice:0.1 },
    spikeChance: 0.2, mineChance: 0.1, gapMin: 115, gapMax: 152, platWMin: 64, platWMax: 96,
    powerupChance: 0.13, enemyChance: 0.09, windZones: []
  },
  {
    num: 8, name: 'Storm Front', world: 'Sky Factory',
    sky: { top: [60,55,100], bottom: [120,100,150] },
    height: 4600, checkpointAt: 2300,
    platTypes: { normal:0.15, moving:0.35, bouncy:0.1, crumble:0.2, disappear:0.1, ice:0.1 },
    spikeChance: 0.24, mineChance: 0.12, gapMin: 118, gapMax: 158, platWMin: 64, platWMax: 88,
    powerupChance: 0.13, enemyChance: 0.11,
    windZones: [{ yFrac: 0.2, h: 300, windX: 120, gravMult: 0.7 }, { yFrac: 0.65, h: 250, windX: -120, gravMult: 0.7 }]
  },
  {
    num: 9, name: 'The Gauntlet', world: 'The Summit',
    sky: { top: [91,177,151], bottom: [204,239,197] },
    height: 5000, checkpointAt: 2500,
    platTypes: { normal:0.1, moving:0.3, bouncy:0.1, crumble:0.2, disappear:0.15, ice:0.15 },
    spikeChance: 0.28, mineChance: 0.14, gapMin: 122, gapMax: 162, platWMin: 64, platWMax: 80,
    powerupChance: 0.14, enemyChance: 0.13,
    windZones: [{ yFrac: 0.4, h: 350, windX: -150, gravMult: 0.6 }]
  },
  {
    num: 10, name: 'The Summit', world: 'The Summit',
    sky: { top: [255,220,80], bottom: [255,180,60] },
    height: 5600, checkpointAt: 2800,
    platTypes: { normal:0.1, moving:0.25, bouncy:0.1, crumble:0.2, disappear:0.2, ice:0.15 },
    spikeChance: 0.3, mineChance: 0.16, gapMin: 125, gapMax: 165, platWMin: 64, platWMax: 80,
    powerupChance: 0.15, enemyChance: 0.15,
    windZones: [{ yFrac: 0.25, h: 400, windX: 160, gravMult: 0.55 }, { yFrac: 0.7, h: 300, windX: -160, gravMult: 0.55 }]
  }
];

// ============================== Characters ==============================
const CHARACTERS = [
  { id: 'hopper',    name: 'Hopper',    price: 0,   body: '#ff5f6d', light: '#ffb26b', leaf: '#57c866', swatch: '#ff786e', trait: 'Balanced',          jumpMult: 1,    fallMult: 1,    speedMult: 1,    startShield: false },
  { id: 'robot',     name: 'Robot',     price: 20,  body: '#7eb8d4', light: '#b8e0f0', leaf: '#5bc8d4', swatch: '#7ec8e0', trait: 'Higher jump',        jumpMult: 1.12, fallMult: 1,    speedMult: 0.95, startShield: false },
  { id: 'ninja',     name: 'Ninja',     price: 30,  body: '#3a3a5c', light: '#7070a0', leaf: '#a060c0', swatch: '#5050a0', trait: 'Better air control', jumpMult: 1,    fallMult: 0.88, speedMult: 1.1,  startShield: false },
  { id: 'astro',     name: 'Astronaut', price: 40,  body: '#e8e8f0', light: '#ffffff', leaf: '#80c0ff', swatch: '#c0d0f0', trait: 'Slower falling',     jumpMult: 1,    fallMult: 0.72, speedMult: 0.95, startShield: false },
  { id: 'explorer',  name: 'Explorer',  price: 50,  body: '#c8843a', light: '#f0b870', leaf: '#78b840', swatch: '#d09040', trait: 'Starts with shield', jumpMult: 1,    fallMult: 1,    speedMult: 1,    startShield: true  },
  { id: 'shadow',    name: 'Shadow',    price: 60,  body: '#1a1a2e', light: '#4a4a7e', leaf: '#8040c0', swatch: '#2a2a5e', trait: 'Faster movement',    jumpMult: 1,    fallMult: 1,    speedMult: 1.18, startShield: false }
];

// ============================== Achievements ==============================
const ACHIEVEMENT_DEFS = [
  { id: 'first_summit',   icon: '🏔️', name: 'First Summit',      desc: 'Complete any level' },
  { id: 'level5',         icon: '⭐', name: 'Halfway There',      desc: 'Complete level 5' },
  { id: 'level10',        icon: '👑', name: 'Sky Master',         desc: 'Complete all 10 levels' },
  { id: 'coins100',       icon: '💰', name: 'Coin Collector',     desc: 'Collect 100 total coins' },
  { id: 'coins500',       icon: '🤑', name: 'Rich Hopper',        desc: 'Collect 500 total coins' },
  { id: 'nodamage',       icon: '🛡️', name: 'Untouchable',        desc: 'Complete a level without taking damage' },
  { id: 'perfect',        icon: '💎', name: 'Perfect Run',        desc: 'Complete a level with 3 stars' },
  { id: 'powerup5',       icon: '⚡', name: 'Power Hungry',       desc: 'Collect 5 power-ups in one run' },
  { id: 'allchars',       icon: '🎭', name: 'Full Roster',        desc: 'Unlock all characters' },
  { id: 'score1000',      icon: '🎯', name: 'High Scorer',        desc: 'Reach score 1000 in one run' },
  { id: 'checkpoint',     icon: '🚩', name: 'Safety Net',         desc: 'Use a checkpoint respawn' },
  { id: 'bouncy5',        icon: '🏀', name: 'Bouncy Castle',      desc: 'Land on 5 bouncy platforms in one run' }
];


// ============================== Persistent data ==============================
let best = +(localStorage.getItem('sh_best') || 0);
let totalCoins = +(localStorage.getItem('sh_coins') || 0);

const readOwned = (key, starter) => {
  try { return new Set(JSON.parse(localStorage.getItem(key) || JSON.stringify([starter]))); }
  catch { return new Set([starter]); }
};
const readLevelData = () => {
  try { return JSON.parse(localStorage.getItem('sh_levels') || '{}'); }
  catch { return {}; }
};
const readAchievements = () => {
  try { return new Set(JSON.parse(localStorage.getItem('sh_ach') || '[]')); }
  catch { return new Set(); }
};

const ownedThemes = readOwned('sh_owned_themes', 'sky');
const ownedChars  = readOwned('sh_owned_chars', 'hopper');
let levelData     = readLevelData();   // { "1": { stars:3, best:1200 }, ... }
let achievements  = readAchievements();
let activeTheme   = localStorage.getItem('sh_theme') || 'sky';
let activeChar    = localStorage.getItem('sh_char')  || 'hopper';
let shopTab       = 'themes';
let shopReturn    = 'menu';

const SHOP_THEMES = [
  { id: 'sky',    name: 'Sky Garden',    price: 0,  top: [110,190,255], bottom: [205,240,255], swatch: '#8cc9ff' },
  { id: 'sunset', name: 'Peach Horizon', price: 15, top: [255,148,110], bottom: [255,220,166], swatch: '#ff9876' },
  { id: 'aurora', name: 'Aurora Night',  price: 30, top: [35,73,112],   bottom: [100,156,177], swatch: '#5ca6c4' },
  { id: 'mint',   name: 'Mint Summit',   price: 45, top: [64,156,139],  bottom: [190,235,194], swatch: '#65bba3' }
];

const Settings = {
  particles: localStorage.getItem('sh_parts') !== '0',
  shake:     localStorage.getItem('sh_shake') !== '0',
  save() {
    localStorage.setItem('sh_parts', this.particles ? '1' : '0');
    localStorage.setItem('sh_shake', this.shake ? '1' : '0');
  }
};

function saveLevelData() { localStorage.setItem('sh_levels', JSON.stringify(levelData)); }
function saveAchievements() { localStorage.setItem('sh_ach', JSON.stringify([...achievements])); }
function saveOwned(key, items) { localStorage.setItem(key, JSON.stringify([...items])); }

function unlockAchievement(id) {
  if (achievements.has(id)) return null;
  achievements.add(id);
  saveAchievements();
  return ACHIEVEMENT_DEFS.find(a => a.id === id);
}

// ============================== Sprite pre-rendering ==============================
function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function rr(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function star(g, cx, cy, r, points) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = i * Math.PI / points - Math.PI / 2;
    const rad = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
  g.closePath();
}

const Spr = { plat: {}, coin: [], cloud: [] };
let stars = [], clouds = [];

function buildPlatform(type, w) {
  const h = 34;
  const c = makeCanvas(w + 4, h);
  const g = c.getContext('2d');
  const x = 2, ww = w;
  const grad = g.createLinearGradient(0, 4, 0, h);
  if (type === 'moving')     { grad.addColorStop(0, '#5aa2ff'); grad.addColorStop(1, '#2f6bd8'); }
  else if (type === 'bouncy'){ grad.addColorStop(0, '#c98a5a'); grad.addColorStop(1, '#9a5f36'); }
  else if (type === 'crumble'){ grad.addColorStop(0, '#b08968'); grad.addColorStop(1, '#8a6647'); }
  else if (type === 'disappear'){ grad.addColorStop(0, '#c060d0'); grad.addColorStop(1, '#803090'); }
  else if (type === 'ice')   { grad.addColorStop(0, '#a0d8ef'); grad.addColorStop(1, '#5090c0'); }
  else                       { grad.addColorStop(0, '#a06b3f'); grad.addColorStop(1, '#7c4f2a'); }
  rr(g, x, 6, ww, h - 6, 10); g.fillStyle = grad; g.fill();
  g.fillStyle = 'rgba(0,0,0,0.12)';
  for (let i = 0; i < 5; i++) {
    g.beginPath(); g.arc(x + 6 + Math.random() * (ww - 12), 16 + Math.random() * 12, 1.6, 0, TAU); g.fill();
  }
  if (type === 'moving') {
    rr(g, x, 0, ww, 13, 7); g.fillStyle = '#8fc3ff'; g.fill();
    rr(g, x+2, 0, ww-4, 5, 3); g.fillStyle = '#d6e9ff'; g.fill();
  } else if (type === 'bouncy') {
    rr(g, x, 0, ww, 13, 7); g.fillStyle = '#ff9f1c'; g.fill();
    rr(g, x+2, 0, ww-4, 5, 3); g.fillStyle = '#ffc46b'; g.fill();
    g.strokeStyle = '#7a4a20'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x+6, 21); g.lineTo(x+ww-6, 21); g.stroke();
  } else if (type === 'crumble') {
    rr(g, x, 3, ww, 12, 6); g.fillStyle = '#9c7a54'; g.fill();
    g.strokeStyle = '#6b4f33'; g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x+ww*0.28,4); g.lineTo(x+ww*0.36,11); g.lineTo(x+ww*0.3,17);
    g.moveTo(x+ww*0.62,3); g.lineTo(x+ww*0.58,13);
    g.stroke();
  } else if (type === 'disappear') {
    rr(g, x, 0, ww, 13, 7); g.fillStyle = '#e080f0'; g.fill();
    rr(g, x+2, 0, ww-4, 5, 3); g.fillStyle = '#f0b0ff'; g.fill();
    g.fillStyle = 'rgba(255,255,255,0.5)';
    for (let i = 0; i < 4; i++) {
      g.beginPath(); g.arc(x+12+i*(ww-20)/3, 18, 2, 0, TAU); g.fill();
    }
  } else if (type === 'ice') {
    rr(g, x, 0, ww, 13, 7); g.fillStyle = '#c8eeff'; g.fill();
    rr(g, x+2, 0, ww-4, 5, 3); g.fillStyle = '#eafaff'; g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(x+8, 10); g.lineTo(x+ww-8, 10); g.stroke();
  } else {
    rr(g, x, 0, ww, 13, 7); g.fillStyle = '#6bcb77'; g.fill();
    rr(g, x+2, 0, ww-4, 5, 3); g.fillStyle = '#93e6a4'; g.fill();
  }
  return c;
}

function buildSpike() {
  const c = makeCanvas(20, 16); const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 16);
  grad.addColorStop(0, '#f2f2fa'); grad.addColorStop(1, '#9a9ab0');
  g.fillStyle = grad;
  g.beginPath(); g.moveTo(1,16); g.lineTo(10,1); g.lineTo(19,16); g.closePath(); g.fill();
  g.strokeStyle = '#6a6a80'; g.lineWidth = 1; g.stroke();
  return c;
}

function buildMine() {
  const c = makeCanvas(44, 44); const g = c.getContext('2d');
  const cx = 22, cy = 22;
  g.fillStyle = '#4a4a5e';
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU;
    g.beginPath();
    g.moveTo(cx+Math.cos(a-0.2)*12, cy+Math.sin(a-0.2)*12);
    g.lineTo(cx+Math.cos(a)*20, cy+Math.sin(a)*20);
    g.lineTo(cx+Math.cos(a+0.2)*12, cy+Math.sin(a+0.2)*12);
    g.closePath(); g.fill();
  }
  const grad = g.createRadialGradient(cx-5,cy-6,2,cx,cy,14);
  grad.addColorStop(0,'#6a6a85'); grad.addColorStop(1,'#33334a');
  g.beginPath(); g.arc(cx,cy,13,0,TAU); g.fillStyle = grad; g.fill();
  g.beginPath(); g.arc(cx,cy,4,0,TAU); g.fillStyle = '#ff4d4d'; g.fill();
  g.beginPath(); g.arc(cx-1.5,cy-1.5,1.5,0,TAU); g.fillStyle = '#ffb0b0'; g.fill();
  return c;
}

function buildCoins() {
  for (let f = 0; f < 6; f++) {
    const c = makeCanvas(36, 36); const g = c.getContext('2d');
    const sx = Math.abs(Math.cos(f / 6 * TAU));
    const w = 13 * (0.25 + 0.75 * sx);
    const grad = g.createLinearGradient(0, 4, 0, 32);
    grad.addColorStop(0, '#ffe066'); grad.addColorStop(1, '#f0a008');
    g.beginPath(); g.ellipse(18,18,w,13,0,0,TAU); g.fillStyle = grad; g.fill();
    g.lineWidth = 2; g.strokeStyle = '#c77e00'; g.stroke();
    if (w > 6) {
      g.beginPath(); g.ellipse(18,18,w*0.55,7,0,0,TAU);
      g.strokeStyle = '#c77e00'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#c77e00'; star(g,18,18,5,5); g.fill();
    }
    Spr.coin.push(c);
  }
}

function buildClouds() {
  for (let v = 0; v < 3; v++) {
    const c = makeCanvas(140, 70); const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.92)';
    const blobs = [[40,46,21],[65,36,25],[95,46,19],[66,50,22]];
    for (const b of blobs) { g.beginPath(); g.arc(b[0],b[1],b[2],0,TAU); g.fill(); }
    g.fillRect(28,48,84,8);
    Spr.cloud.push(c);
  }
}

function buildBody() {
  const c = makeCanvas(64, 64); const g = c.getContext('2d');
  const ch = CHARACTERS.find(item => item.id === activeChar) || CHARACTERS[0];
  const grad = g.createRadialGradient(24,20,4,32,34,26);
  grad.addColorStop(0, ch.light); grad.addColorStop(1, ch.body);
  g.beginPath(); g.ellipse(32,34,21,22,0,0,TAU); g.fillStyle = grad; g.fill();
  g.beginPath(); g.ellipse(32,42,12,12,0,0,TAU); g.fillStyle = '#ffe3c2'; g.fill();
  g.strokeStyle = ch.leaf; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(32,13); g.quadraticCurveTo(32,8,32,5); g.stroke();
  g.fillStyle = ch.leaf;
  g.beginPath(); g.ellipse(27,6,6,3.2,-0.5,0,TAU); g.fill();
  g.beginPath(); g.ellipse(37,5,6,3.2,0.5,0,TAU); g.fill();
  g.beginPath(); g.moveTo(28,30); g.lineTo(36,30); g.lineTo(32,35); g.closePath();
  g.fillStyle = '#ff9f1c'; g.fill();
  g.fillStyle = 'rgba(255,120,120,0.45)';
  g.beginPath(); g.arc(20,34,4,0,TAU); g.fill();
  g.beginPath(); g.arc(44,34,4,0,TAU); g.fill();
  Spr.body = c;
}

function buildSprites() {
  const types = ['normal','moving','bouncy','crumble','disappear','ice'];
  for (const t of types) {
    Spr.plat[t] = {};
    for (const w of PLAT_WS) Spr.plat[t][w] = buildPlatform(t, w);
  }
  Spr.spike = buildSpike();
  Spr.mine  = buildMine();
  buildCoins();
  buildClouds();
  buildBody();
  stars = [];
  for (let i = 0; i < 70; i++) stars.push({ x: Math.random(), y: Math.random(), r: rand(1,2.4), ph: rand(0,TAU) });
  clouds = [];
  for (let i = 0; i < 11; i++) clouds.push({ x: rand(0,1), y: rand(0,VH+260), sp: rand(4,14), v: (Math.random()*3)|0 });
}


// ============================== Game state ==============================
let state = 'menu'; // menu | levelselect | playing | paused | levelcomplete | gameover
let platforms = [], coins = [], mines = [], particles = [], powerups = [], enemies = [];
let player = null;
let camY = 0, nextY = 0, lastX = 0.5, startY = 0, maxY = 0;
let lives = START_LIVES, coinCount = 0, score = 0;
let genCount = 0;
let time = 0;
let shakeT = 0, shakeDur = 0.001, shakeMag = 0, flashA = 0;
let currentLevelNum = 1;
let playingFromSelect = false;
let checkpointY = null;
let checkpointReached = false;
let checkpointToastT = 0;
let respawnToastT = 0;
let levelHeightGoal = 0;
let levelComplete = false;
let runDamaged = false;
let runPowerups = 0;
let runBouncy = 0;
let activePowerup = null;
let newAchThisRun = [];
// Sky transition
let skyFrom = null, skyTo = null, skyT = 1;
// Combo
let combo = 0, comboTimer = 0, comboToastT = 0;

const POWERUP_TYPES = ['shield','doublejump','magnet','highjump','coinmult'];
const POWERUP_COLORS = { shield:'#60c0ff', doublejump:'#c060ff', magnet:'#ff9020', highjump:'#60ff90', coinmult:'#ffd93d' };
const POWERUP_LABELS = { shield:'🛡 SHIELD', doublejump:'✦ DBL JUMP', magnet:'⊕ MAGNET', highjump:'↑ HIGH JUMP', coinmult:'★ 2× COINS' };
const POWERUP_DUR = { shield:8, doublejump:10, magnet:8, highjump:10, coinmult:12 };

const isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

// ============================== World generation ==============================
function getLevelCfg() { return LEVELS[clamp(currentLevelNum-1, 0, LEVELS.length-1)]; }

function pickPlatType(cfg) {
  const t = cfg.platTypes;
  const keys = Object.keys(t);
  let r = Math.random(), acc = 0;
  for (const k of keys) { acc += t[k]; if (r < acc) return k; }
  return 'normal';
}

function makePlatform(y, xFrac, type, w) {
  const cfg = getLevelCfg();
  const speed = (type === 'moving') ? (Math.random() < 0.5 ? -1 : 1) * rand(45, 90) : 0;
  const pl = {
    xFrac, y, w, type,
    x: xFrac * VW,
    dx: speed,
    crumbleT: null, broken: false, vy: 0, anim: 0,
    spikes: false, spikeOff: 0,
    disappearT: null, disappearPhase: 'solid', reappearT: 0,
    iceSlide: type === 'ice'
  };
  platforms.push(pl);
  return pl;
}

function genPlatform(y) {
  const cfg = getLevelCfg();
  genCount++;
  const safe = genCount % 6 === 0;
  const type = safe ? 'normal' : pickPlatType(cfg);
  const wMin = cfg.platWMin, wMax = cfg.platWMax;
  const w = safe ? 128 : clamp(Math.round(rand(wMin, wMax) / 16) * 16, 64, 128);
  const maxDx = Math.min(300 / VW, 0.48);
  const xf = clamp(lastX + rand(-maxDx, maxDx), (w/2+10)/VW, 1-(w/2+10)/VW);
  lastX = xf;
  const pl = makePlatform(y, xf, type, w);

  if (!safe && (type === 'normal' || type === 'crumble' || type === 'ice') && Math.random() < cfg.spikeChance) {
    pl.spikes = true;
    pl.spikeOff = rand(-0.25, 0.25) * w;
  }

  if (Math.random() < 0.42) {
    const n = Math.random() < 0.3 ? 3 : 1;
    for (let i = 0; i < n; i++) {
      coins.push({
        xFrac: clamp(xf + (n===3 ? (i-1)*0.09 : 0), 0.05, 0.95),
        y: y - (n===3 ? (i===1 ? 62 : 50) : 54),
        taken: false, phase: Math.random()
      });
    }
  }

  if (!safe && Math.random() < cfg.mineChance) {
    mines.push({
      xFrac: clamp(xf + rand(-0.2, 0.2), 0.06, 0.94),
      baseY: y - rand(85, 150),
      t: rand(0, TAU), x: 0, y: 0
    });
  }

  if (Math.random() < cfg.powerupChance) {
    const ptype = POWERUP_TYPES[(Math.random() * POWERUP_TYPES.length) | 0];
    powerups.push({ xFrac: xf, y: y - 70, type: ptype, taken: false, phase: Math.random() });
  }

  if (!safe && Math.random() < (cfg.enemyChance || 0)) {
    const etype = Math.random() < 0.5 ? 'patrol' : 'bouncer';
    enemies.push({
      xFrac: xf, y: y - 28, w: 32, h: 28,
      type: etype,
      dx: (Math.random() < 0.5 ? -1 : 1) * rand(55, 95),
      vy: etype === 'bouncer' ? -400 : 0,
      grounded: etype === 'patrol',
      t: rand(0, TAU), phase: Math.random(),
      patrolLeft: xf - 0.18, patrolRight: xf + 0.18
    });
  }
}

function gap() {
  const cfg = getLevelCfg();
  return rand(cfg.gapMin, cfg.gapMax);
}

function ensurePlatforms() {
  while (nextY > camY - 220) {
    genPlatform(nextY);
    nextY -= gap();
  }
}

function cleanup() {
  const limit = camY + VH + 200;
  sweep(platforms, pl => pl.y < limit);
  sweep(coins, c => !c.taken && c.y < limit);
  sweep(mines, m => m.baseY < limit);
  sweep(powerups, p => !p.taken && p.y < limit);
  sweep(enemies, e => e.y < limit + 200);
}

function resetWorld(levelNum) {
  currentLevelNum = levelNum || 1;
  platforms = []; coins = []; mines = []; particles = []; powerups = []; enemies = [];
  genCount = 0;
  lives = START_LIVES; coinCount = 0; score = 0;
  checkpointY = null; checkpointReached = false;
  checkpointToastT = 0; respawnToastT = 0;
  levelComplete = false; runDamaged = false; runPowerups = 0; runBouncy = 0;
  activePowerup = null; newAchThisRun = [];
  combo = 0; comboTimer = 0; comboToastT = 0;
  // sky transition: fade from previous level sky to new one
  const cfg = getLevelCfg();
  skyTo = cfg.sky;
  skyFrom = skyFrom ? mixColorObj(skyFrom, skyTo, clamp(1 - skyT, 0, 1)) : cfg.sky;
  skyT = 0;
  startY = VH - 140;
  maxY = startY;
  camY = 0;
  lastX = 0.5;
  levelHeightGoal = startY - cfg.height;
  makePlatform(startY, 0.5, 'normal', 128);
  nextY = startY - 100;
  const ch = CHARACTERS.find(c => c.id === activeChar) || CHARACTERS[0];
  player = {
    x: VW/2, y: startY - 22, w: 40, h: 44,
    vx: 0, vy: 0, prevY: 0,
    grounded: true, ground: platforms[0],
    coyote: 0, buffer: 0, landT: 0, inv: 0, knockT: 0,
    look: 0, blink: 0, nextBlink: 2,
    doubleJumpLeft: 0,
    shield: ch.startShield,
    jumpMult: ch.jumpMult, fallMult: ch.fallMult, speedMult: ch.speedMult
  };
  ensurePlatforms();
  HUD.reset();
}

function mixColorObj(a, b, t) {
  return {
    top: mixColor(a.top, b.top, t),
    bottom: mixColor(a.bottom, b.bottom, t)
  };
}

// ============================== Particles ==============================
function burst(x, y, n, colors, speed, grav) {
  if (!Settings.particles) return;
  for (let i = 0; i < n; i++) {
    if (particles.length >= MAX_PARTICLES) break;
    const a = rand(0, TAU), sp = rand(speed*0.3, speed);
    const life = rand(0.35, 0.7);
    particles.push({
      x, y,
      vx: Math.cos(a)*sp, vy: Math.sin(a)*sp - 60,
      life, max: life,
      size: rand(2,5), color: colors[(Math.random()*colors.length)|0],
      grav: grav == null ? 700 : grav
    });
  }
}

function updateParticles(dt) {
  for (const pt of particles) {
    pt.life -= dt; pt.vy += pt.grav*dt; pt.x += pt.vx*dt; pt.y += pt.vy*dt;
  }
  sweep(particles, pt => pt.life > 0);
}


// ============================== Physics ==============================
function updatePlayer(dt) {
  const p = player;
  p.prevY = p.y;

  if (p.knockT > 0) {
    p.knockT -= dt;
  } else {
    const dir = (Input.right ? 1 : 0) - (Input.left ? 1 : 0);
    p.vx = dir * MOVE_V * p.speedMult;
    if (dir !== 0) p.look = dir;
  }

  // magnet: pull nearby coins
  if (activePowerup && activePowerup.type === 'magnet') {
    for (const c of coins) {
      if (c.taken) continue;
      const cx = c.xFrac * VW;
      const dx = p.x - cx, dy = p.y - c.y;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < 160 && dist > 1) {
        c.xFrac += (dx/dist) * 220 * dt / VW;
        c.y += (dy/dist) * 220 * dt;
      }
    }
  }

  p.x += p.vx * dt;
  if (p.x < -p.w/2) p.x = VW + p.w/2;
  else if (p.x > VW + p.w/2) p.x = -p.w/2;

  if (p.grounded) p.coyote = COYOTE;
  else if (p.coyote > 0) p.coyote -= dt;
  if (p.buffer > 0) p.buffer -= dt;
  if (p.landT > 0) p.landT -= dt;
  if (p.inv > 0) p.inv -= dt;
  p.nextBlink -= dt;
  if (p.nextBlink <= 0) { p.blink = 0.12; p.nextBlink = rand(1.8, 4); }
  if (p.blink > 0) p.blink -= dt;

  const jumpV = JUMP_V * p.jumpMult * (activePowerup && activePowerup.type === 'highjump' ? 1.35 : 1);

  if (p.buffer > 0 && (p.grounded || p.coyote > 0)) {
    p.vy = -jumpV;
    p.grounded = false; p.ground = null;
    p.coyote = 0; p.buffer = 0;
    p.doubleJumpLeft = (activePowerup && activePowerup.type === 'doublejump') ? 1 : 0;
    Sound.jump();
    burst(p.x, p.y+p.h/2, 6, ['#ffffff','#dfe8ff'], 130, 300);
  } else if (p.buffer > 0 && p.doubleJumpLeft > 0) {
    p.vy = -jumpV * 0.88;
    p.doubleJumpLeft--;
    p.buffer = 0;
    Sound.jump();
    burst(p.x, p.y, 10, ['#c060ff','#ffffff'], 160, 300);
  }

  if (p.grounded && p.ground) {
    const g = p.ground;
    if (g.broken || g.disappearPhase === 'hidden') {
      p.grounded = false; p.ground = null;
    } else {
      p.y = g.y - p.h/2;
      if (g.iceSlide) {
        p.vx += (((Input.right?1:0)-(Input.left?1:0)) * MOVE_V * p.speedMult - p.vx) * dt * 2.5;
      } else {
        p.x += g.dx * dt;
      }
      p.vy = 0;
      if (Math.abs(p.x - g.x) > g.w/2 + p.w/2) { p.grounded = false; p.ground = null; }
    }
  }

  if (!p.grounded) {
    const grav = GRAV * p.fallMult;
    // wind zones
    let windX = 0, gravMult = 1;
    const cfg = getLevelCfg();
    for (const z of (cfg.windZones || [])) {
      const zWorldY = startY - cfg.height * z.yFrac;
      if (p.y > zWorldY - z.h && p.y < zWorldY + z.h) {
        const fade = 1 - Math.abs(p.y - zWorldY) / z.h;
        windX += z.windX * fade;
        gravMult *= lerp(1, z.gravMult, fade);
      }
    }
    p.vx += windX * dt;
    p.vy = Math.min(p.vy + grav * gravMult * dt, MAX_FALL);
    p.y += p.vy * dt;
    if (p.vy > 0) checkLanding();
  }
}

function checkLanding() {
  const p = player;
  const prevBottom = p.prevY + p.h/2;
  const bottom = p.y + p.h/2;
  for (const pl of platforms) {
    if (pl.broken || pl.disappearPhase === 'hidden') continue;
    if (prevBottom <= pl.y + 8 && bottom >= pl.y &&
        Math.abs(p.x - pl.x) < (p.w/2 + pl.w/2) * 0.78) {
      landOn(pl, p.vy);
      break;
    }
  }
}

function landOn(pl, impact) {
  const p = player;
  if (pl.type === 'bouncy') {
    p.vy = -1480 * p.jumpMult;
    p.grounded = false;
    pl.anim = 0.25;
    Sound.boing();
    burst(p.x, pl.y, 10, ['#ffd93d','#ff9f1c'], 220, 500);
    runBouncy++;
    return;
  }
  p.grounded = true; p.ground = pl;
  p.y = pl.y - p.h/2; p.vy = 0; p.landT = 0.12;
  if (pl.type === 'crumble' && pl.crumbleT === null) pl.crumbleT = 0.45;
  if (pl.type === 'disappear' && pl.disappearPhase === 'solid' && pl.disappearT === null) pl.disappearT = 1.2;
  if (impact > 500) { Sound.land(); burst(p.x, pl.y, 5, ['#e8dcc8','#ffffff'], 110, 350); }
}

function updatePlatforms(dt) {
  for (const pl of platforms) {
    if (pl.type === 'moving' && !pl.broken) {
      pl.xFrac += pl.dx * dt / VW;
      const minF = (pl.w/2+8)/VW, maxF = 1-(pl.w/2+8)/VW;
      if (pl.xFrac < minF) { pl.xFrac = minF; pl.dx = Math.abs(pl.dx); }
      else if (pl.xFrac > maxF) { pl.xFrac = maxF; pl.dx = -Math.abs(pl.dx); }
    }
    pl.x = pl.xFrac * VW;
    if (pl.anim > 0) pl.anim -= dt;
    if (pl.crumbleT !== null) {
      pl.crumbleT -= dt;
      if (pl.crumbleT <= 0) { pl.broken = true; pl.vy = 0; }
    }
    if (pl.broken) { pl.vy += GRAV*0.6*dt; pl.y += pl.vy*dt; }
    if (pl.disappearT !== null) {
      pl.disappearT -= dt;
      if (pl.disappearT <= 0) {
        pl.disappearPhase = 'hidden';
        pl.disappearT = null;
        pl.reappearT = 3.0;
        if (player && player.ground === pl) { player.grounded = false; player.ground = null; }
      }
    }
    if (pl.disappearPhase === 'hidden') {
      pl.reappearT -= dt;
      if (pl.reappearT <= 0) { pl.disappearPhase = 'solid'; pl.disappearT = null; }
    }
  }
}

function updateMines(dt) {
  for (const m of mines) {
    m.t += dt;
    m.x = m.xFrac * VW;
    m.y = m.baseY + Math.sin(m.t * 2.2) * 12;
  }
}

function updateEnemies(dt) {
  for (const e of enemies) {
    e.t += dt;
    if (e.type === 'patrol') {
      e.xFrac += e.dx * dt / VW;
      if (e.xFrac < e.patrolLeft)  { e.xFrac = e.patrolLeft;  e.dx = Math.abs(e.dx); }
      if (e.xFrac > e.patrolRight) { e.xFrac = e.patrolRight; e.dx = -Math.abs(e.dx); }
    } else {
      // bouncer: simple gravity + bounce off platforms
      e.vy += GRAV * 0.55 * dt;
      e.y += e.vy * dt;
      e.xFrac += e.dx * dt / VW;
      if (e.xFrac < 0.05) { e.xFrac = 0.05; e.dx = Math.abs(e.dx); }
      if (e.xFrac > 0.95) { e.xFrac = 0.95; e.dx = -Math.abs(e.dx); }
      for (const pl of platforms) {
        if (pl.broken || pl.disappearPhase === 'hidden') continue;
        const ex = e.xFrac * VW;
        if (e.vy > 0 && e.y + e.h/2 >= pl.y && e.y + e.h/2 <= pl.y + 12 &&
            Math.abs(ex - pl.x) < pl.w/2 + e.w/2 - 4) {
          e.y = pl.y - e.h/2;
          e.vy = -rand(380, 520);
        }
      }
    }
    e.x = e.xFrac * VW;
  }
  // check enemy collision with player
  if (!player || player.inv > 0) return;
  const p = player;
  for (const e of enemies) {
    if (Math.abs(p.x - e.x) < p.w/2 + e.w/2 - 6 && Math.abs(p.y - e.y) < p.h/2 + e.h/2 - 4) {
      // stomp from above kills enemy
      if (p.vy > 0 && p.y < e.y) {
        p.vy = -600;
        e.y = 9999; // remove next cleanup
        burst(e.x, e.y, 10, ['#ff9f1c','#fff','#ff5f6d'], 200, 500);
        combo++; comboTimer = 1.5; comboToastT = 1.2;
        Sound.boing();
      } else {
        damage(p.x < e.x ? -1 : 1);
      }
      break;
    }
  }
}

function updateCombo(dt) {
  if (comboTimer > 0) {
    comboTimer -= dt;
    if (comboTimer <= 0) combo = 0;
  }
  if (comboToastT > 0) comboToastT -= dt;
}

function updatePowerups(dt) {
  if (activePowerup) {
    activePowerup.timeLeft -= dt;
    if (activePowerup.timeLeft <= 0) {
      activePowerup = null;
      if (player) { player.doubleJumpLeft = 0; }
      HUD.powerup();
    }
  }
  const p = player;
  if (!p) return;
  for (const pu of powerups) {
    if (pu.taken) continue;
    const px = pu.xFrac * VW;
    if (Math.abs(p.x - px) < p.w/2 + 18 && Math.abs(p.y - pu.y) < p.h/2 + 18) {
      pu.taken = true;
      activePowerup = { type: pu.type, timeLeft: POWERUP_DUR[pu.type] };
      if (pu.type === 'shield') player.shield = true;
      if (pu.type === 'doublejump') player.doubleJumpLeft = 1;
      runPowerups++;
      Sound.powerup();
      burst(px, pu.y, 12, [POWERUP_COLORS[pu.type], '#ffffff'], 200, 400);
      HUD.powerup();
    }
  }
}

function checkHazards() {
  const p = player;
  if (p.inv > 0) return;
  const hw = p.w/2 - 6, hh = p.h/2 - 4;
  for (const pl of platforms) {
    if (pl.spikes && !pl.broken) {
      const sx = pl.x + pl.spikeOff, sy = pl.y - 8;
      if (Math.abs(p.x - sx) < hw+17 && Math.abs(p.y - sy) < hh+8) {
        damage(p.x < pl.x ? -1 : 1); return;
      }
    }
  }
  for (const m of mines) {
    if (Math.abs(p.x - m.x) < hw+13 && Math.abs(p.y - m.y) < hh+13) {
      damage(m.x < p.x ? -1 : 1); return;
    }
  }
}

function collectCoins() {
  const p = player;
  const mult = (activePowerup && activePowerup.type === 'coinmult') ? 2 : 1;
  for (const c of coins) {
    if (c.taken) continue;
    const cx = c.xFrac * VW;
    if (Math.abs(p.x - cx) < p.w/2+14 && Math.abs(p.y - c.y) < p.h/2+14) {
      c.taken = true;
      combo++; comboTimer = 1.5;
      const comboMult = combo >= 5 ? 4 : combo >= 3 ? 2 : 1;
      coinCount += mult * comboMult;
      if (combo >= 3) comboToastT = 1.0;
      Sound.coin();
      HUD.coins();
      burst(cx, c.y, 8, ['#ffd93d','#fff3b0'], 180, 400);
    }
  }
}

function checkCheckpoint() {
  if (checkpointReached || !checkpointY) return;
  if (player.y <= checkpointY + 60) {
    checkpointReached = true;
    checkpointToastT = 2.5;
    Sound.checkpoint();
    burst(player.x, player.y, 16, ['#6bcb77','#ffe066','#ffffff'], 200, 400);
    unlockAchievement('checkpoint');
  }
}

function checkLevelComplete() {
  if (levelComplete) return;
  if (player.y <= levelHeightGoal) {
    levelComplete = true;
    Sound.levelup();
    burst(player.x, player.y, 24, ['#ffe066','#6bcb77','#ff9f1c','#ffffff'], 280, 500);
    setTimeout(showLevelComplete, 900);
  }
}

function update(dt) {
  updatePlayer(dt);
  updatePlatforms(dt);
  updateMines(dt);
  updateEnemies(dt);
  updateCombo(dt);
  updatePowerups(dt);
  checkHazards();
  collectCoins();
  checkCheckpoint();
  checkLevelComplete();
  updateParticles(dt);
  ensurePlatforms();
  cleanup();

  const target = player.y - VH * 0.45;
  if (target < camY) camY += (target - camY) * Math.min(1, dt*9);

  if (player.y < maxY) maxY = player.y;
  const heightScore = Math.max(0, Math.floor((startY - maxY) / 50));
  const comboBonus = combo >= 3 ? combo * 5 : 0;
  const s = heightScore + coinCount * 10 + comboBonus;
  if (s !== score) { score = s; HUD.score(s); }

  if (checkpointToastT > 0) checkpointToastT -= dt;
  if (respawnToastT > 0) respawnToastT -= dt;
  if (skyT < 1) skyT = Math.min(1, skyT + dt / 1.5);

  if (player.y - camY > VH + 80) onFall();
}


// ============================== Damage / lives ==============================
function damage(dir) {
  if (player.inv > 0 || state !== 'playing') return;
  if (player.shield || (activePowerup && activePowerup.type === 'shield')) {
    player.shield = false;
    if (activePowerup && activePowerup.type === 'shield') activePowerup = null;
    player.inv = 1.2;
    if (Settings.shake) shake(0.25, 8);
    flashA = 0.2;
    burst(player.x, player.y, 8, ['#60c0ff','#ffffff'], 200, 500);
    HUD.powerup();
    return;
  }
  runDamaged = true;
  lives--;
  HUD.lives();
  if (Settings.shake) shake(0.4, 15);
  flashA = 0.4;
  Sound.hit();
  burst(player.x, player.y, 12, ['#ff5f6d','#ffb26b'], 260, 600);
  player.inv = 1.6;
  player.vy = -650;
  player.vx = dir * 260;
  player.knockT = 0.25;
  player.grounded = false;
  player.ground = null;
  if (lives <= 0) gameOver();
}

function onFall() {
  if (state !== 'playing') return;
  lives--;
  HUD.lives();
  Sound.fall();
  runDamaged = true;
  if (lives <= 0) { gameOver(); return; }
  respawn();
}

function respawn() {
  const p = player;
  respawnToastT = 2.0;

  // respawn at checkpoint if reached, else find best visible platform
  if (checkpointReached && checkpointY !== null) {
    let cpPl = null;
    for (const pl of platforms) {
      if (!pl.broken && pl.disappearPhase !== 'hidden' && Math.abs(pl.y - checkpointY) < 200) {
        if (!cpPl || Math.abs(pl.y - checkpointY) < Math.abs(cpPl.y - checkpointY)) cpPl = pl;
      }
    }
    if (cpPl) {
      p.x = cpPl.x; p.y = cpPl.y - p.h/2 - 2;
      p.vx = 0; p.vy = 0; p.grounded = true; p.ground = cpPl;
      p.inv = 1.8;
      camY = cpPl.y - VH * 0.6;
      if (Settings.shake) shake(0.3, 10);
      return;
    }
  }

  let bestPl = null;
  for (const pl of platforms) {
    if (pl.broken || pl.disappearPhase === 'hidden') continue;
    if (pl.y > camY + 30 && pl.y < camY + VH - 60) {
      if (!bestPl || pl.y > bestPl.y) bestPl = pl;
    }
  }
  if (!bestPl) bestPl = makePlatform(camY + VH*0.6, 0.5, 'normal', 112);
  p.x = bestPl.x; p.y = bestPl.y - p.h/2 - 2;
  p.vx = 0; p.vy = 0; p.grounded = true; p.ground = bestPl;
  p.inv = 1.8;
  if (Settings.shake) shake(0.3, 10);
}

function shake(dur, mag) { shakeT = dur; shakeDur = dur; shakeMag = mag; }

// ============================== Rendering ==============================
function drawBackground() {
  const cfg = getLevelCfg();
  const theme = SHOP_THEMES.find(item => item.id === activeTheme) || SHOP_THEMES[0];
  // animated sky transition between levels
  const rawSky = (skyFrom && skyTo && skyT < 1)
    ? { top: mixColor(skyFrom.top, skyTo.top, skyT), bottom: mixColor(skyFrom.bottom, skyTo.bottom, skyT) }
    : cfg.sky;
  const alt = clamp(-camY / 40000, 0, 1);
  const top = mixColor(theme.top, rawSky.top, 0.4);
  const bottom = mixColor(theme.bottom, rawSky.bottom, 0.4);
  const deepTop = mixColor(top, [38,30,80], 0.65);
  const deepBottom = mixColor(bottom, [120,80,150], 0.55);
  const g = ctx.createLinearGradient(0, 0, 0, VH);
  g.addColorStop(0, rgb(mixColor(top, deepTop, alt)));
  g.addColorStop(1, rgb(mixColor(bottom, deepBottom, alt)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, VW, VH);

  if (alt > 0.2) {
    const a = (alt - 0.2) / 0.8;
    ctx.fillStyle = '#ffffff';
    for (const s of stars) {
      ctx.globalAlpha = a * (0.4 + 0.6*(0.5+0.5*Math.sin(time*2+s.ph)));
      ctx.fillRect(s.x*VW, s.y*VH, s.r, s.r);
    }
    ctx.globalAlpha = 1;
  }
  drawCloudLayer(0.22, 0.45, 0.7, 6);
  drawCloudLayer(0.45, 0.75, 1.0, 5);
}

function drawCloudLayer(factor, alpha, scale, count) {
  ctx.globalAlpha = alpha;
  for (let i = 0; i < count; i++) {
    const c = clouds[i];
    let y = (c.y - camY*factor + time*c.sp) % (VH+260);
    if (y < 0) y += VH+260;
    y -= 130;
    const img = Spr.cloud[c.v];
    ctx.drawImage(img, c.x*VW - img.width*scale/2, y, img.width*scale, img.height*scale);
  }
  ctx.globalAlpha = 1;
}

function drawCheckpointFlag() {
  if (!checkpointY) return;
  const screenY = checkpointY - camY;
  if (screenY < -60 || screenY > VH + 60) return;
  const x = VW * 0.5;
  const alpha = checkpointReached ? 1 : 0.7;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = checkpointReached ? '#6bcb77' : '#ffe066';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x, screenY - 60); ctx.lineTo(x, screenY); ctx.stroke();
  ctx.fillStyle = checkpointReached ? '#6bcb77' : '#ffe066';
  ctx.beginPath(); ctx.moveTo(x, screenY - 60); ctx.lineTo(x+22, screenY-50); ctx.lineTo(x, screenY-40); ctx.closePath(); ctx.fill();
  if (!checkpointReached) {
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('CHECK', x+8, screenY-52);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function drawLevelGoal() {
  const screenY = levelHeightGoal - camY;
  if (screenY < -80 || screenY > VH + 80) return;
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = '#ffe066';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 6]);
  ctx.beginPath(); ctx.moveTo(0, screenY); ctx.lineTo(VW, screenY); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#ffe066';
  ctx.font = 'bold 11px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText('SUMMIT ▲', VW - 10, screenY - 6);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
}

function drawPlatforms() {
  for (const pl of platforms) {
    if (pl.y < camY - 60 || pl.y > camY + VH + 160) continue;
    if (pl.disappearPhase === 'hidden') continue;
    const img = Spr.plat[pl.type] && Spr.plat[pl.type][pl.w] ? Spr.plat[pl.type][pl.w] : Spr.plat['normal'][pl.w] || Spr.plat['normal'][96];
    ctx.save();
    ctx.translate(pl.x, pl.y);
    if (pl.crumbleT !== null) ctx.translate(rand(-1.6,1.6), 0);
    if (pl.broken) ctx.rotate(pl.y * 0.001);
    if (pl.anim > 0) {
      const k = Math.sin((pl.anim/0.25)*Math.PI);
      ctx.scale(1+0.15*k, 1-0.3*k);
    }
    if (pl.disappearT !== null) ctx.globalAlpha = clamp(pl.disappearT / 1.2, 0.15, 1);
    ctx.drawImage(img, -pl.w/2 - 2, 0);
    ctx.globalAlpha = 1;
    ctx.restore();

    if (pl.spikes && !pl.broken) {
      const n = Math.max(2, Math.round(pl.w/22));
      const startX = pl.x + pl.spikeOff - (n*20)/2;
      for (let i = 0; i < n; i++) ctx.drawImage(Spr.spike, startX+i*20, pl.y-15);
    }
  }
}

function drawCoins() {
  for (const c of coins) {
    if (c.taken) continue;
    if (c.y < camY-40 || c.y > camY+VH+40) continue;
    const f = Math.floor((time*9 + c.phase*6) % 6);
    const bob = Math.sin(time*3 + c.phase*9) * 3;
    ctx.drawImage(Spr.coin[f], c.xFrac*VW - 18, c.y - 18 + bob);
  }
}

function drawMines() {
  for (const m of mines) {
    if (m.y < camY-40 || m.y > camY+VH+40) continue;
    const pulse = 0.25 + 0.2*(0.5+0.5*Math.sin(time*5+m.t));
    ctx.fillStyle = `rgba(255,60,60,${pulse*0.5})`;
    ctx.beginPath(); ctx.arc(m.x, m.y, 20, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(Math.sin(m.t*1.5)*0.2);
    ctx.drawImage(Spr.mine, -22, -22); ctx.restore();
  }
}

function drawPowerups() {
  for (const pu of powerups) {
    if (pu.taken) continue;
    const px = pu.xFrac * VW;
    if (pu.y < camY-40 || pu.y > camY+VH+40) continue;
    const bob = Math.sin(time*3 + pu.phase*9) * 4;
    const glow = 0.3 + 0.2*Math.sin(time*4 + pu.phase*6);
    ctx.fillStyle = POWERUP_COLORS[pu.type] + '55';
    ctx.beginPath(); ctx.arc(px, pu.y+bob, 18, 0, TAU); ctx.fill();
    ctx.fillStyle = POWERUP_COLORS[pu.type];
    ctx.beginPath(); ctx.arc(px, pu.y+bob, 12, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const icons = { shield:'🛡', doublejump:'✦', magnet:'⊕', highjump:'↑', coinmult:'★' };
    ctx.fillText(icons[pu.type] || '?', px, pu.y+bob);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }
}

function drawShadow() {
  const p = player;
  let bestPl = null, bestD = 220;
  for (const pl of platforms) {
    if (pl.broken || pl.disappearPhase === 'hidden') continue;
    if (Math.abs(p.x - pl.x) > pl.w/2+10) continue;
    const d = pl.y - (p.y + p.h/2);
    if (d >= -4 && d < bestD) { bestD = d; bestPl = pl; }
  }
  if (bestPl) {
    ctx.fillStyle = `rgba(20,20,40,${0.2*(1-bestD/220)})`;
    ctx.beginPath();
    ctx.ellipse(p.x, bestPl.y+5, Math.max(6, 16*(1-bestD/400)), 5, 0, 0, TAU);
    ctx.fill();
  }
}

function drawPlayer() {
  const p = player;
  drawShadow();
  let sx = 1, sy = 1;
  if (!p.grounded) {
    const st = clamp(Math.abs(p.vy)/1700, 0, 0.22);
    sx = 1 - st*0.55; sy = 1 + st;
  }
  if (p.landT > 0) { const k = p.landT/0.12; sx = 1+0.28*k; sy = 1-0.22*k; }
  if (p.inv > 0 && Math.floor(time*16) % 2 === 0) ctx.globalAlpha = 0.35;

  // shield glow
  if (p.shield || (activePowerup && activePowerup.type === 'shield')) {
    ctx.globalAlpha = 0.35 + 0.15*Math.sin(time*6);
    ctx.fillStyle = '#60c0ff';
    ctx.beginPath(); ctx.arc(p.x, p.y, 30, 0, TAU); ctx.fill();
    ctx.globalAlpha = p.inv > 0 && Math.floor(time*16)%2===0 ? 0.35 : 1;
  }

  const bob = (state === 'menu') ? Math.sin(time*2.4)*3 : 0;
  ctx.save(); ctx.translate(p.x, p.y+bob); ctx.scale(sx, sy);
  const flap = p.grounded ? 0.25 : Math.sin(time*28)*0.7 - clamp(p.vy/900,-0.5,0.5);
  ctx.fillStyle = '#e8505f';
  ctx.save(); ctx.translate(-19,2); ctx.rotate(-0.5-flap*0.4);
  ctx.beginPath(); ctx.ellipse(-6,0,8,5,0,0,TAU); ctx.fill(); ctx.restore();
  ctx.save(); ctx.translate(19,2); ctx.rotate(0.5+flap*0.4);
  ctx.beginPath(); ctx.ellipse(6,0,8,5,0,0,TAU); ctx.fill(); ctx.restore();
  ctx.drawImage(Spr.body, -32, -32);
  if (p.grounded) {
    ctx.fillStyle = '#d94f5f';
    ctx.beginPath(); ctx.ellipse(-8,21,5,3,0,0,TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(8,21,5,3,0,0,TAU); ctx.fill();
  }
  const look = p.look * 2.2;
  if (p.blink > 0) {
    ctx.strokeStyle = '#333'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-13,26); ctx.lineTo(-5,26); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(5,26); ctx.lineTo(13,26); ctx.stroke();
  } else {
    for (const ex of [-9,9]) {
      ctx.beginPath(); ctx.arc(ex,26,6.5,0,TAU); ctx.fillStyle = '#fff'; ctx.fill();
      ctx.beginPath(); ctx.arc(ex+look,27,3.2,0,TAU); ctx.fillStyle = '#2b2b3a'; ctx.fill();
      ctx.beginPath(); ctx.arc(ex+look+1,25.5,1.1,0,TAU); ctx.fillStyle = '#fff'; ctx.fill();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}

function drawParticles() {
  for (const pt of particles) {
    ctx.globalAlpha = clamp(pt.life/pt.max, 0, 1);
    ctx.fillStyle = pt.color;
    ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.size, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawWindZones() {
  const cfg = getLevelCfg();
  for (const z of (cfg.windZones || [])) {
    const zWorldY = startY - cfg.height * z.yFrac;
    const top = zWorldY - z.h - camY;
    const bot = zWorldY + z.h - camY;
    if (bot < 0 || top > VH) continue;
    const grad = ctx.createLinearGradient(0, Math.max(0,top), 0, Math.min(VH,bot));
    const col = z.windX > 0 ? '180,220,255' : '220,180,255';
    grad.addColorStop(0, `rgba(${col},0)`);
    grad.addColorStop(0.5, `rgba(${col},0.07)`);
    grad.addColorStop(1, `rgba(${col},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, Math.max(0,top), VW, Math.min(VH,bot) - Math.max(0,top));
    // wind streaks
    ctx.strokeStyle = `rgba(${col},0.18)`;
    ctx.lineWidth = 1;
    const dir = z.windX > 0 ? 1 : -1;
    for (let i = 0; i < 6; i++) {
      const sy = top + (bot - top) * (i / 5);
      const sx = ((time * 80 * dir + i * 60) % (VW + 80)) - 40;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + dir * 35, sy + 4); ctx.stroke();
    }
  }
}

function drawEnemies() {
  for (const e of enemies) {
    const ey = e.y - camY;
    if (ey < -60 || ey > VH + 60) continue;
    const ex = e.x;
    const bob = e.type === 'patrol' ? Math.sin(time * 4 + e.phase * 6) * 2 : 0;
    ctx.save();
    ctx.translate(ex, ey + bob);
    // body
    ctx.fillStyle = e.type === 'patrol' ? '#e05050' : '#d060d0';
    ctx.beginPath(); ctx.ellipse(0, 0, 14, 12, 0, 0, TAU); ctx.fill();
    // highlight
    ctx.fillStyle = e.type === 'patrol' ? '#f08080' : '#e090e0';
    ctx.beginPath(); ctx.ellipse(-3, -4, 7, 5, -0.3, 0, TAU); ctx.fill();
    // eyes
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(-5, -2, 4, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(5, -2, 4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#222';
    const lookDir = e.dx > 0 ? 1 : -1;
    ctx.beginPath(); ctx.arc(-5 + lookDir, -2, 2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.arc(5 + lookDir, -2, 2, 0, TAU); ctx.fill();
    // angry brows
    ctx.strokeStyle = '#600';
    ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-9,-6); ctx.lineTo(-3,-4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(9,-6); ctx.lineTo(3,-4); ctx.stroke();
    // legs (patrol only)
    if (e.type === 'patrol') {
      const legSwing = Math.sin(time * 8 + e.phase) * 0.3;
      ctx.strokeStyle = '#c04040'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-5, 10); ctx.lineTo(-5 - legSwing*8, 20); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(5, 10); ctx.lineTo(5 + legSwing*8, 20); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawToasts() {
  ctx.textAlign = 'center';
  if (comboToastT > 0 && combo >= 3) {
    const a = Math.min(1, comboToastT * 3);
    ctx.globalAlpha = a;
    const comboMult = combo >= 5 ? 4 : 2;
    ctx.fillStyle = 'rgba(40,20,0,0.75)';
    rr(ctx, VW/2-70, 155, 140, 32, 10); ctx.fill();
    ctx.fillStyle = '#ffd93d';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(`${combo}× COMBO! ×${comboMult}`, VW/2, 176);
    ctx.globalAlpha = 1;
  }
  if (checkpointToastT > 0) {
    const a = Math.min(1, checkpointToastT) * Math.min(1, checkpointToastT * 2);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(20,40,20,0.7)';
    rr(ctx, VW/2-90, 60, 180, 36, 10); ctx.fill();
    ctx.fillStyle = '#6bcb77';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText('✓ CHECKPOINT REACHED', VW/2, 83);
    ctx.globalAlpha = 1;
  }
  if (respawnToastT > 0) {
    const a = Math.min(1, respawnToastT) * Math.min(1, respawnToastT * 2);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(20,20,40,0.75)';
    rr(ctx, VW/2-80, 108, 160, 36, 10); ctx.fill();
    ctx.fillStyle = '#60c0ff';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(checkpointReached ? '🚩 RESPAWNED' : 'RESPAWNING...', VW/2, 131);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = 'left';
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawBackground();

  let shX = 0, shY = 0;
  if (shakeT > 0 && Settings.shake) {
    const k = shakeT / shakeDur;
    shX = rand(-1,1)*shakeMag*k; shY = rand(-1,1)*shakeMag*k;
  }

  ctx.save();
  ctx.translate(shX, -camY + shY);
  drawLevelGoal();
  drawCheckpointFlag();
  drawPlatforms();
  drawCoins();
  drawMines();
  drawPowerups();
  drawEnemies();
  drawPlayer();
  drawParticles();
  ctx.restore();

  // wind zones drawn in screen space (no camera offset)
  if (state === 'playing') drawWindZones();

  if (flashA > 0) {
    ctx.fillStyle = `rgba(255,60,60,${flashA*0.35})`;
    ctx.fillRect(0, 0, VW, VH);
  }

  if (state === 'playing') drawToasts();
}


// ============================== HUD ==============================
const HUD = {
  scoreEl: $('hud-score'), bestEl: $('hud-best'), coinsEl: $('hud-coins'),
  livesEl: $('hud-lives'), levelEl: $('hud-level'), regionEl: $('hud-region'),
  powerupEl: $('hud-powerup'),
  lastScore: -1, lastCoins: -1,
  score(s) {
    if (s === this.lastScore) return;
    this.lastScore = s;
    this.scoreEl.textContent = s;
    if (s > best) {
      best = s; this.bestEl.textContent = best;
      localStorage.setItem('sh_best', best);
    }
    this.scoreEl.parentElement.animate(
      [{ transform:'scale(1.18)' },{ transform:'scale(1)' }],
      { duration:160, easing:'ease-out' });
  },
  level() {
    const cfg = getLevelCfg();
    this.levelEl.textContent = `LEVEL ${cfg.num}`;
    this.regionEl.textContent = cfg.world;
  },
  coins() {
    if (coinCount === this.lastCoins) return;
    this.lastCoins = coinCount;
    this.coinsEl.textContent = coinCount;
  },
  lives() {
    const hearts = this.livesEl.querySelectorAll('.heart');
    for (let i = 0; i < hearts.length; i++) hearts[i].classList.toggle('lost', i >= lives);
  },
  powerup() {
    if (activePowerup) {
      this.powerupEl.textContent = POWERUP_LABELS[activePowerup.type];
      this.powerupEl.classList.remove('hidden');
    } else {
      this.powerupEl.classList.add('hidden');
    }
  },
  reset() {
    this.lastScore = -1; this.lastCoins = -1;
    this.score(0); this.level(); this.coins(); this.lives();
    this.bestEl.textContent = best;
    this.powerupEl.classList.add('hidden');
  }
};

// ============================== Flow ==============================
const overlays = ['menu','levelselect','shop','settings','pause','gameover','levelcomplete','achievements'];
function show(id) {
  for (const o of overlays) $(o).classList.toggle('hidden', o !== id);
}

function startGame(levelNum) {
  Sound.ensure(); Sound.click();
  resetWorld(levelNum || currentLevelNum);
  // place checkpoint platform at the midpoint height
  const cfg = getLevelCfg();
  checkpointY = startY - cfg.checkpointAt;
  state = 'playing';
  show(null);
  $('hud').classList.remove('hidden');
  if (isTouch) $('touch-controls').classList.remove('hidden');
}

function pauseGame() {
  if (state !== 'playing') return;
  state = 'paused'; Sound.click(); show('pause');
}

function resumeGame() {
  if (state !== 'paused') return;
  Sound.click(); state = 'playing'; show(null);
}

function gameOver() {
  state = 'gameover';
  Sound.over();
  if (Settings.shake) shake(0.5, 18);
  const isBest = score >= best && score > 0;
  if (score > best) { best = score; localStorage.setItem('sh_best', best); }
  totalCoins += coinCount;
  localStorage.setItem('sh_coins', totalCoins);
  checkRunAchievements();
  $('go-score').textContent = score;
  $('go-best').textContent = best;
  $('go-coins').textContent = coinCount;
  $('go-level').textContent = currentLevelNum;
  $('new-best').classList.toggle('hidden', !isBest);
  show('gameover');
  $('hud').classList.add('hidden');
  $('touch-controls').classList.add('hidden');
  updateMenuStats();
}

function showLevelComplete() {
  if (state !== 'playing') return;
  state = 'levelcomplete';

  // calculate stars: 1=complete, 2=no damage, 3=no damage + all coins collected
  const totalLevelCoins = coins.filter(c => true).length; // approximate
  let stars = 1;
  if (!runDamaged) stars = 2;
  if (!runDamaged && coinCount >= 5) stars = 3;

  const heightScore = Math.max(0, Math.floor((startY - maxY) / 50));
  const coinBonus = coinCount * 10;
  const checkpointBonus = checkpointReached ? 50 : 0;
  const noDamageBonus = !runDamaged ? 100 : 0;
  const total = heightScore + coinBonus + checkpointBonus + noDamageBonus;

  // save level data
  const prev = levelData[currentLevelNum] || { stars: 0, best: 0 };
  levelData[currentLevelNum] = {
    stars: Math.max(prev.stars, stars),
    best: Math.max(prev.best, total)
  };
  saveLevelData();

  totalCoins += coinCount;
  localStorage.setItem('sh_coins', totalCoins);
  if (total > best) { best = total; localStorage.setItem('sh_best', best); }

  checkRunAchievements(stars);

  // build level complete panel
  const starsEl = $('lc-stars');
  starsEl.innerHTML = '';
  for (let i = 1; i <= 3; i++) {
    const s = document.createElement('span');
    s.className = 'lc-star' + (i <= stars ? ' earned' : '');
    s.textContent = '★';
    starsEl.appendChild(s);
  }

  const statsEl = $('lc-stats');
  statsEl.innerHTML = `
    <div class="stat"><span>Height</span><b>+${heightScore}</b></div>
    <div class="stat"><span>Coins ×${coinCount}</span><b>+${coinBonus}</b></div>
    ${checkpointBonus ? `<div class="stat bonus"><span>Checkpoint</span><b>+${checkpointBonus}</b></div>` : ''}
    ${noDamageBonus ? `<div class="stat bonus"><span>No damage!</span><b>+${noDamageBonus}</b></div>` : ''}
    <div class="stat total"><span>TOTAL</span><b>${total}</b></div>
  `;

  const achEl = $('lc-achievements');
  if (newAchThisRun.length > 0) {
    achEl.classList.remove('hidden');
    achEl.innerHTML = '🏆 ' + newAchThisRun.map(a => a.icon + ' ' + a.name).join(' &nbsp;·&nbsp; ');
  } else {
    achEl.classList.add('hidden');
  }

  const nextBtn = $('btn-lc-next');
  if (currentLevelNum >= 10) {
    nextBtn.textContent = '🏆 All Done!';
    nextBtn.onclick = goHome;
  } else {
    nextBtn.innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg> Next Level';
    nextBtn.onclick = () => { Sound.click(); startGame(currentLevelNum + 1); };
  }

  show('levelcomplete');
  $('hud').classList.add('hidden');
  $('touch-controls').classList.add('hidden');
  updateMenuStats();
}

function checkRunAchievements(stars) {
  const push = id => { const a = unlockAchievement(id); if (a) newAchThisRun.push(a); };
  if (levelComplete) {
    push('first_summit');
    if (currentLevelNum >= 5) push('level5');
    if (currentLevelNum >= 10) push('level10');
    if (!runDamaged) push('nodamage');
    if (stars >= 3) push('perfect');
  }
  if (totalCoins + coinCount >= 100) push('coins100');
  if (totalCoins + coinCount >= 500) push('coins500');
  if (runPowerups >= 5) push('powerup5');
  if (score >= 1000) push('score1000');
  if (checkpointReached && !levelComplete) push('checkpoint');
  if (runBouncy >= 5) push('bouncy5');
  if ([...ownedChars].length >= CHARACTERS.length) push('allchars');
}

function goHome() {
  Sound.click();
  state = 'menu';
  resetWorld(1);
  show('menu');
  $('hud').classList.add('hidden');
  $('touch-controls').classList.add('hidden');
  updateMenuStats();
}

function updateMenuStats() {
  $('menu-best').textContent = best;
  $('menu-coins').textContent = totalCoins;
  const done = Object.keys(levelData).length;
  $('menu-levels-done').textContent = done + '/10';
}

function openShop(from) {
  shopReturn = from; renderShop(); show('shop');
}

function renderShop() {
  const isThemes = shopTab === 'themes';
  const items = isThemes ? SHOP_THEMES : CHARACTERS;
  const owned = isThemes ? ownedThemes : ownedChars;
  const active = isThemes ? activeTheme : activeChar;
  $('shop-coins').textContent = totalCoins;
  $('shop-grid').replaceChildren(...items.map(item => {
    const card = document.createElement('article');
    card.className = `shop-item${active === item.id ? ' selected' : ''}`;
    const action = document.createElement('button');
    const unlocked = owned.has(item.id);
    action.className = unlocked ? 'shop-action' : 'shop-action purchase';
    action.dataset.item = item.id;
    action.dataset.kind = shopTab;
    action.textContent = active === item.id ? 'Equipped' : unlocked ? 'Equip' : `Unlock · ${item.price} coins`;
    action.disabled = active === item.id || (!unlocked && totalCoins < item.price);
    const traitHtml = item.trait ? `<span class="shop-trait">${item.trait}</span>` : '';
    card.innerHTML = `<span class="shop-swatch" style="--swatch:${item.swatch}" aria-hidden="true"></span><span class="shop-item-copy"><b>${item.name}</b><small>${unlocked ? 'Owned' : item.price + ' coins'}</small>${traitHtml}</span>`;
    card.append(action);
    return card;
  }));
}

function useShopItem(id, kind) {
  const isThemes = kind === 'themes';
  const items = isThemes ? SHOP_THEMES : CHARACTERS;
  const owned = isThemes ? ownedThemes : ownedChars;
  const item = items.find(e => e.id === id);
  if (!item) return;
  if (!owned.has(id)) {
    if (totalCoins < item.price) return;
    totalCoins -= item.price;
    owned.add(id);
    saveOwned(isThemes ? 'sh_owned_themes' : 'sh_owned_chars', owned);
    localStorage.setItem('sh_coins', totalCoins);
  }
  if (isThemes) { activeTheme = id; localStorage.setItem('sh_theme', id); }
  else { activeChar = id; localStorage.setItem('sh_char', id); buildBody(); }
  updateMenuStats();
  renderShop();
}

function renderLevelSelect() {
  const grid = $('level-grid');
  grid.innerHTML = '';
  const maxUnlocked = Math.max(1, Object.keys(levelData).length + 1);
  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement('button');
    btn.className = 'level-btn';
    const ld = levelData[i];
    const unlocked = i <= maxUnlocked;
    if (ld) btn.classList.add('done');
    else if (i === maxUnlocked) btn.classList.add('current');
    btn.disabled = !unlocked;
    const starsStr = ld ? '★'.repeat(ld.stars) + '☆'.repeat(3-ld.stars) : '';
    const cfg = LEVELS[i-1];
    btn.innerHTML = `<span class="lbtn-num">${i}</span><span class="lbtn-stars">${starsStr}</span><span class="lbtn-name">${cfg.name}</span>${!unlocked ? '<span class="lbtn-lock">🔒</span>' : ''}`;
    btn.addEventListener('click', () => { Sound.click(); startGame(i); });
    grid.appendChild(btn);
  }
}

function renderAchievements() {
  const grid = $('ach-grid');
  grid.innerHTML = '';
  for (const def of ACHIEVEMENT_DEFS) {
    const unlocked = achievements.has(def.id);
    const item = document.createElement('div');
    item.className = 'ach-item' + (unlocked ? ' unlocked' : '');
    item.innerHTML = `<span class="ach-icon">${def.icon}</span><span class="ach-copy"><b>${def.name}</b><small>${def.desc}</small></span>`;
    grid.appendChild(item);
  }
}

// ============================== Input ==============================
const Input = { left: false, right: false };

function pressJump() {
  Sound.ensure();
  if (state === 'menu' || state === 'gameover') { startGame(); return; }
  if (state !== 'playing') return;
  player.buffer = BUFFER;
}

function releaseJump() {
  if (state !== 'playing') return;
  if (player.vy < -380) player.vy = -380;
}

const GAME_KEYS = ['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD'];

window.addEventListener('keydown', e => {
  if (GAME_KEYS.includes(e.code)) e.preventDefault();
  Sound.ensure();
  switch (e.code) {
    case 'Space': case 'ArrowUp': case 'KeyW':
      if (state === 'menu' || state === 'gameover') { if (!e.repeat) startGame(); }
      else pressJump();
      break;
    case 'ArrowLeft': case 'KeyA': Input.left = true; break;
    case 'ArrowRight': case 'KeyD': Input.right = true; break;
    case 'KeyP': case 'Escape':
      if (state === 'playing') pauseGame();
      else if (state === 'paused') resumeGame();
      break;
    case 'KeyM': toggleMute(); break;
    case 'Enter':
      if (state === 'menu' || state === 'gameover') startGame();
      else if (state === 'paused') resumeGame();
      break;
  }
});

window.addEventListener('keyup', e => {
  switch (e.code) {
    case 'Space': case 'ArrowUp': case 'KeyW': releaseJump(); break;
    case 'ArrowLeft': case 'KeyA': Input.left = false; break;
    case 'ArrowRight': case 'KeyD': Input.right = false; break;
  }
});

canvas.addEventListener('pointerdown', e => { e.preventDefault(); pressJump(); });
window.addEventListener('pointerup', releaseJump);
window.addEventListener('pointercancel', releaseJump);
canvas.addEventListener('contextmenu', e => e.preventDefault());

function bindHold(el, on, off) {
  el.addEventListener('pointerdown', e => { e.preventDefault(); Sound.ensure(); on(); });
  el.addEventListener('pointerup', e => { e.preventDefault(); off(); });
  el.addEventListener('pointerleave', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('contextmenu', e => e.preventDefault());
}
bindHold($('tc-left'), () => { Input.left = true; }, () => { Input.left = false; });
bindHold($('tc-right'), () => { Input.right = true; }, () => { Input.right = false; });
bindHold($('tc-jump'),
  () => { if (state === 'playing') player.buffer = BUFFER; else pressJump(); },
  releaseJump);

// ============================== UI wiring ==============================
function toggleMute() {
  Sound.ensure(); Sound.setMuted(!Sound.muted); updateSoundIcons();
  if (!Sound.muted) Sound.click();
}
function updateSoundIcons() {
  const on = !Sound.muted;
  for (const id of ['btn-sound-menu','btn-sound-hud','btn-sound-pause'])
    $(id).classList.toggle('muted', !on);
}

$('btn-play').addEventListener('click', () => startGame(currentLevelNum));
$('btn-levels').addEventListener('click', () => { Sound.ensure(); Sound.click(); renderLevelSelect(); show('levelselect'); });
$('btn-levels-back').addEventListener('click', () => { Sound.click(); show('menu'); });
$('btn-levels-go').addEventListener('click', () => { Sound.ensure(); Sound.click(); renderLevelSelect(); show('levelselect'); });
$('btn-shop').addEventListener('click', () => openShop('menu'));
$('btn-shop-go').addEventListener('click', () => openShop('gameover'));
$('btn-shop-back').addEventListener('click', () => show(shopReturn));
$('btn-achievements').addEventListener('click', () => { Sound.ensure(); Sound.click(); renderAchievements(); show('achievements'); });
$('btn-ach-back').addEventListener('click', () => { Sound.click(); show('menu'); });
$('shop-grid').addEventListener('click', e => {
  const button = e.target.closest('button[data-item]');
  if (button && !button.disabled) useShopItem(button.dataset.item, button.dataset.kind);
});
for (const tab of document.querySelectorAll('.shop-tab')) {
  tab.addEventListener('click', () => {
    shopTab = tab.dataset.tab;
    document.querySelectorAll('.shop-tab').forEach(t => t.classList.toggle('active', t === tab));
    renderShop();
  });
}
$('btn-pause').addEventListener('click', () => {
  Sound.ensure();
  if (state === 'playing') pauseGame();
  else if (state === 'paused') resumeGame();
});
$('btn-resume').addEventListener('click', resumeGame);
$('btn-restart-pause').addEventListener('click', () => startGame(currentLevelNum));
$('btn-restart-go').addEventListener('click', () => startGame(currentLevelNum));
$('btn-home-pause').addEventListener('click', goHome);
$('btn-home-go').addEventListener('click', goHome);
$('btn-lc-replay').addEventListener('click', () => { Sound.click(); startGame(currentLevelNum); });
$('btn-lc-home').addEventListener('click', goHome);
$('btn-settings').addEventListener('click', () => { Sound.ensure(); Sound.click(); show('settings'); });
$('btn-settings-close').addEventListener('click', () => { Sound.click(); show('menu'); });
$('btn-sound-menu').addEventListener('click', toggleMute);
$('btn-sound-hud').addEventListener('click', toggleMute);
$('btn-sound-pause').addEventListener('click', toggleMute);

function bindToggle(id, key) {
  const el = $(id);
  const render = () => el.classList.toggle('on', Settings[key]);
  el.addEventListener('click', () => {
    Sound.ensure(); Sound.click();
    Settings[key] = !Settings[key]; Settings.save(); render();
  });
  render();
}
bindToggle('tgl-particles', 'particles');
bindToggle('tgl-shake', 'shake');

$('btn-reset-best').addEventListener('click', () => {
  Sound.click(); best = 0;
  localStorage.setItem('sh_best', '0');
  HUD.bestEl.textContent = '0';
  updateMenuStats();
});
$('btn-reset-progress').addEventListener('click', () => {
  Sound.click();
  localStorage.removeItem('sh_levels');
  localStorage.removeItem('sh_ach');
  levelData = {}; achievements = new Set();
  updateMenuStats();
});

document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'playing') pauseGame(); });
window.addEventListener('blur', () => { if (state === 'playing') pauseGame(); });

// ============================== Main loop ==============================
let last = performance.now(), acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.1) dt = 0.1;
  time += dt;

  if (shakeT > 0) shakeT -= dt;
  if (flashA > 0) flashA = Math.max(0, flashA - dt*1.6);

  if (state === 'playing') {
    acc += dt;
    let n = 0;
    while (acc >= STEP && n < 8) { update(STEP); acc -= STEP; n++; }
    if (n === 8) acc = 0;
  } else if (state === 'menu') {
    updatePlatforms(dt); updateMines(dt); updateParticles(dt);
    ensurePlatforms(); cleanup();
  } else if (state === 'gameover' || state === 'levelcomplete') {
    updateParticles(dt);
  }

  render();
}

// ============================== Init ==============================
function init() {
  resize();
  buildSprites();
  resetWorld(1);
  updateSoundIcons();
  updateMenuStats();
  renderShop();
  show('menu');
  requestAnimationFrame(frame);
}
init();

})();
