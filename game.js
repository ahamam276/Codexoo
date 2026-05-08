const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const scoreEl = document.querySelector('#score');
const bestEl = document.querySelector('#best');
const streakEl = document.querySelector('#streak');
const timeEl = document.querySelector('#time');
const dailySeedEl = document.querySelector('#dailySeed');
const startButton = document.querySelector('#startButton');
const shareButton = document.querySelector('#shareButton');
const copyButton = document.querySelector('#copyButton');
const toast = document.querySelector('#toast');

const GAME_SECONDS = 60;
const PLAYER_RADIUS = 18;
const TREND_RADIUS = 13;
const TRAP_RADIUS = 19;
const dateKey = new Date().toISOString().slice(0, 10);
const storageKey = `trend-dash-best-${dateKey}`;
let bestScore = readBestScore(storageKey);

let state = makeFreshState();
let pointerTarget = null;
const keys = new Set();
function readBestScore(key) {
  try {
    return Number(window.localStorage.getItem(key) || 0);
  } catch {
    return 0;
  }
}

function writeBestScore(key, value) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Some local file and private browsing contexts block localStorage.
    // The game should still remain visible and playable without persistence.
  }
}


function seedFromString(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  return function nextRandom() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function makeFreshState() {
  const random = mulberry32(seedFromString(dateKey));
  return {
    running: false,
    ended: false,
    score: 0,
    streak: 0,
    timeLeft: GAME_SECONDS,
    lastTick: 0,
    random,
    player: { x: canvas.width / 2, y: canvas.height / 2, speed: 330 },
    trends: Array.from({ length: 7 }, () => spawnItem(random, TREND_RADIUS)),
    traps: Array.from({ length: 5 }, () => spawnItem(random, TRAP_RADIUS)),
    sparks: [],
  };
}

function spawnItem(random, radius) {
  return {
    x: radius + random() * (canvas.width - radius * 2),
    y: radius + random() * (canvas.height - radius * 2),
    vx: (random() - 0.5) * 120,
    vy: (random() - 0.5) * 120,
    pulse: random() * Math.PI * 2,
  };
}

function startGame() {
  state = makeFreshState();
  state.running = true;
  state.lastTick = performance.now();
  pointerTarget = null;
  startButton.textContent = 'Restart run';
  requestAnimationFrame(loop);
}

function loop(now) {
  const delta = Math.min(0.032, (now - state.lastTick) / 1000);
  state.lastTick = now;
  update(delta);
  draw();
  if (state.running) requestAnimationFrame(loop);
}

function update(delta) {
  state.timeLeft = Math.max(0, state.timeLeft - delta);
  if (state.timeLeft === 0) return finishGame();

  movePlayer(delta);
  moveItems(state.trends, delta);
  moveItems(state.traps, delta);
  collectTrends();
  hitTraps();
  state.sparks = state.sparks.filter((spark) => {
    spark.life -= delta;
    spark.y -= 42 * delta;
    return spark.life > 0;
  });
  syncHud();
}

function movePlayer(delta) {
  const velocity = { x: 0, y: 0 };
  if (keys.has('arrowleft') || keys.has('a')) velocity.x -= 1;
  if (keys.has('arrowright') || keys.has('d')) velocity.x += 1;
  if (keys.has('arrowup') || keys.has('w')) velocity.y -= 1;
  if (keys.has('arrowdown') || keys.has('s')) velocity.y += 1;

  if (pointerTarget) {
    const dx = pointerTarget.x - state.player.x;
    const dy = pointerTarget.y - state.player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 4) {
      velocity.x += dx / distance;
      velocity.y += dy / distance;
    }
  }

  const magnitude = Math.hypot(velocity.x, velocity.y) || 1;
  state.player.x += (velocity.x / magnitude) * state.player.speed * delta;
  state.player.y += (velocity.y / magnitude) * state.player.speed * delta;
  state.player.x = clamp(state.player.x, PLAYER_RADIUS, canvas.width - PLAYER_RADIUS);
  state.player.y = clamp(state.player.y, PLAYER_RADIUS, canvas.height - PLAYER_RADIUS);
}

function moveItems(items, delta) {
  for (const item of items) {
    item.x += item.vx * delta;
    item.y += item.vy * delta;
    item.pulse += delta * 4;
    if (item.x < 18 || item.x > canvas.width - 18) item.vx *= -1;
    if (item.y < 18 || item.y > canvas.height - 18) item.vy *= -1;
  }
}

function collectTrends() {
  for (const trend of state.trends) {
    if (distanceToPlayer(trend) < PLAYER_RADIUS + TREND_RADIUS) {
      state.streak += 1;
      const bonus = 100 + state.streak * 15;
      state.score += bonus;
      state.sparks.push({ x: trend.x, y: trend.y, text: `+${bonus}`, life: 0.8, color: '#ffdf6e' });
      Object.assign(trend, spawnItem(state.random, TREND_RADIUS));
      if (state.streak % 5 === 0) state.timeLeft = Math.min(GAME_SECONDS, state.timeLeft + 3);
    }
  }
}

function hitTraps() {
  for (const trap of state.traps) {
    if (distanceToPlayer(trap) < PLAYER_RADIUS + TRAP_RADIUS) {
      state.streak = 0;
      state.score = Math.max(0, state.score - 180);
      state.timeLeft = Math.max(0, state.timeLeft - 2.5);
      state.sparks.push({ x: trap.x, y: trap.y, text: 'doomscroll!', life: 0.9, color: '#ff5c7c' });
      Object.assign(trap, spawnItem(state.random, TRAP_RADIUS));
    }
  }
}

function finishGame() {
  state.running = false;
  state.ended = true;
  bestScore = Math.max(bestScore, state.score);
  writeBestScore(storageKey, bestScore);
  syncHud();
  showToast(`Run complete! Score ${state.score}. Share it and challenge a friend.`);
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  for (const trend of state.trends) drawTrend(trend);
  for (const trap of state.traps) drawTrap(trap);
  drawPlayer();
  drawSparks();
  if (!state.running) drawOverlay();
}

function drawGrid() {
  ctx.fillStyle = '#08020f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(255,255,255,0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x < canvas.width; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < canvas.height; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}

function drawTrend(trend) {
  const radius = TREND_RADIUS + Math.sin(trend.pulse) * 3;
  ctx.shadowColor = '#ffdf6e';
  ctx.shadowBlur = 22;
  ctx.fillStyle = '#ffdf6e';
  ctx.beginPath();
  ctx.arc(trend.x, trend.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#14042f';
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('★', trend.x, trend.y + 1);
}

function drawTrap(trap) {
  const radius = TRAP_RADIUS + Math.sin(trap.pulse) * 2;
  ctx.shadowColor = '#ff5c7c';
  ctx.shadowBlur = 18;
  ctx.fillStyle = '#351024';
  ctx.beginPath();
  ctx.arc(trap.x, trap.y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ff5c7c';
  ctx.font = '20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('☠', trap.x, trap.y + 1);
}

function drawPlayer() {
  const gradient = ctx.createRadialGradient(state.player.x - 7, state.player.y - 7, 4, state.player.x, state.player.y, 28);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.45, '#5df3ff');
  gradient.addColorStop(1, '#ff4fd8');
  ctx.shadowColor = '#5df3ff';
  ctx.shadowBlur = 28;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(state.player.x, state.player.y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawSparks() {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 22px sans-serif';
  for (const spark of state.sparks) {
    ctx.globalAlpha = Math.max(0, spark.life);
    ctx.fillStyle = spark.color;
    ctx.fillText(spark.text, spark.x, spark.y);
  }
  ctx.globalAlpha = 1;
}

function drawOverlay() {
  ctx.fillStyle = 'rgba(8, 2, 15, 0.72)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff9ff';
  ctx.textAlign = 'center';
  ctx.font = '800 46px sans-serif';
  ctx.fillText(state.ended ? 'Run complete!' : 'Trend Dash', canvas.width / 2, canvas.height / 2 - 36);
  ctx.fillStyle = '#cabde6';
  ctx.font = '22px sans-serif';
  ctx.fillText(
    state.ended ? `Score ${state.score}. Can your friends beat it?` : 'Press Start and chase the trends.',
    canvas.width / 2,
    canvas.height / 2 + 10,
  );
}

async function shareScore() {
  const text = `I scored ${state.score} in Trend Dash (${dateKey}). Can you beat me?`;
  const url = window.location.href;
  if (navigator.share) {
    await navigator.share({ title: 'Trend Dash challenge', text, url });
  } else {
    await navigator.clipboard.writeText(`${text} ${url}`);
    showToast('Score challenge copied to your clipboard.');
  }
}

async function copyChallengeLink() {
  await navigator.clipboard.writeText(window.location.href);
  showToast('Challenge link copied. Send it to your group chat!');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function distanceToPlayer(item) {
  return Math.hypot(item.x - state.player.x, item.y - state.player.y);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function syncHud() {
  scoreEl.textContent = Math.round(state.score).toLocaleString();
  bestEl.textContent = Math.round(bestScore).toLocaleString();
  streakEl.textContent = `${state.streak}x`;
  timeEl.textContent = Math.ceil(state.timeLeft).toString();
}

function setPointerTarget(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  pointerTarget = {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

startButton.addEventListener('click', startGame);
shareButton.addEventListener('click', () => shareScore().catch(() => showToast('Sharing was cancelled.')));
copyButton.addEventListener('click', () => copyChallengeLink().catch(() => showToast('Clipboard access was blocked.')));
window.addEventListener('keydown', (event) => keys.add(event.key.toLowerCase()));
window.addEventListener('keyup', (event) => keys.delete(event.key.toLowerCase()));
canvas.addEventListener('pointerdown', setPointerTarget);
canvas.addEventListener('pointermove', (event) => {
  if (event.buttons) setPointerTarget(event);
});
canvas.addEventListener('pointerup', () => (pointerTarget = null));

dailySeedEl.textContent = dateKey.replaceAll('-', '·');
syncHud();
draw();
