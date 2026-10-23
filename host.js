// Presentador: única autoridad. Guarda el estado, puntúa y difunde el estado completo.
const PIN = '2002';
const STORE = 'gehoot-host';

const $ = (id) => document.getElementById(id);
let QUESTIONS = [];
let G = null;            // estado de la partida
let conn = null;
let online = new Set();  // ids de jugadores conectados (presence)

function newGame() {
  return {
    room: String(Math.floor(1000 + Math.random() * 9000)),
    phase: 'lobby',
    q: -1,
    startedAt: 0,
    players: [],   // {id, name, score}
    answers: {},   // id -> {c, ms, pts} de la pregunta actual
    reveal: null,  // {correct, counts, results: {id: {ok, pts}}}
  };
}

function save() { lsSet(STORE, G); }

function show(id) {
  for (const s of document.querySelectorAll('main > section')) s.classList.add('hidden');
  $(id).classList.remove('hidden');
}

// ---------- Estado público (lo que reciben los móviles) ----------
function publicState() {
  const q = QUESTIONS[G.q];
  return {
    t: 'state',
    room: G.room,
    phase: G.phase,
    q: G.q,
    total: QUESTIONS.length,
    limit: q ? q.segundos : 0,
    remainingMs: G.phase === 'question' ? Math.max(0, deadline() - Date.now()) : 0,
    players: G.players,
    answered: Object.keys(G.answers),
    reveal: G.phase === 'reveal' ? G.reveal : null,
  };
}

function broadcast() {
  if (conn) conn.send(publicState());
}

function deadline() {
  return G.startedAt + QUESTIONS[G.q].segundos * 1000;
}

// ---------- Mensajes de jugadores ----------
function onMessage(m) {
  if (!m || typeof m !== 'object') return;
  if (m.t === 'join') return onJoin(m);
  if (m.t === 'hello') return broadcast();
  if (m.t === 'answer') return onAnswer(m);
}

function onJoin(m) {
  const id = String(m.id || '').slice(0, 40);
  if (!id) return;
  if (!G.players.some((p) => p.id === id)) {
    let base = String(m.name || '').trim().replace(/\s+/g, ' ').slice(0, 20) || 'Jugador';
    let name = base;
    let n = 2;
    const taken = (x) => G.players.some((p) => p.name.toLowerCase() === x.toLowerCase());
    while (taken(name)) name = base + ' ' + n++;
    G.players.push({ id, name, score: 0 });
    save();
    render();
  }
  broadcast();
}

function onAnswer(m) {
  // Tiempo medido con el reloj del host, al recibir.
  const now = Date.now();
  if (G.phase !== 'question' || m.q !== G.q) return broadcast();
  if (!G.players.some((p) => p.id === m.id)) return;
  if (G.answers[m.id]) return broadcast();               // solo la primera respuesta
  const c = Number(m.c);
  if (!(c >= 0 && c <= 3)) return;
  const q = QUESTIONS[G.q];
  const ms = Math.min(now - G.startedAt, q.segundos * 1000);
  const pts = c === q.correcta ? Math.round(1000 * (1 - ms / 1000 / q.segundos / 2)) : 0;
  G.answers[m.id] = { c, ms, pts };
  save();
  renderCounter();
  broadcast();
  maybeClose();
}

function onPresence(ch, ev) {
  online = new Set(Object.keys(ch.presenceState()));
  if (ev === 'join') broadcast();   // entra o se reconecta alguien: reenviar estado
  render();
}

// ---------- Flujo de la partida ----------
function startQuestion(i) {
  G.phase = 'question';
  G.q = i;
  G.startedAt = Date.now();
  G.answers = {};
  G.reveal = null;
  save();
  render();
  broadcast();
}

function maybeClose() {
  if (G.phase !== 'question') return;
  const timeUp = Date.now() >= deadline();
  const ids = G.players.map((p) => p.id).filter((id) => online.has(id));
  const allIn = ids.length > 0 && ids.every((id) => G.answers[id]);
  if (timeUp || allIn) closeQuestion();
}

function closeQuestion() {
  const q = QUESTIONS[G.q];
  const counts = [0, 0, 0, 0];
  const results = {};
  for (const p of G.players) {
    const a = G.answers[p.id];
    if (a) counts[a.c]++;
    const pts = a ? a.pts : 0;
    p.score += pts;
    results[p.id] = { ok: !!a && a.c === q.correcta, pts, answered: !!a };
  }
  G.reveal = { correct: q.correcta, counts, results };
  G.phase = 'reveal';
  save();
  render();
  broadcast();
}

function next() {
  if (G.q + 1 < QUESTIONS.length) startQuestion(G.q + 1);
  else {
    G.phase = 'final';
    save();
    render();
    broadcast();
  }
}

// ---------- Pintado ----------
function optBox(i, text, extra) {
  const d = document.createElement('div');
  d.className = 'opt o' + i + (extra || '');
  const s = document.createElement('span');
  s.className = 'shape';
  s.textContent = SHAPES[i];
  const t = document.createElement('span');
  t.textContent = text;
  d.append(s, t);
  return d;
}

function rankList(el, list) {
  el.replaceChildren();
  list.forEach((p, i) => {
    const li = document.createElement('li');
    const a = document.createElement('span');
    a.textContent = (i + 1) + '. ' + p.name;
    const b = document.createElement('span');
    b.textContent = p.score;
    li.append(a, b);
    el.append(li);
  });
}

function renderCounter() {
  if (G.phase !== 'question') return;
  $('q-answers').textContent = Object.keys(G.answers).length + ' / ' + G.players.length;
}

function render() {
  const q = QUESTIONS[G.q];
  if (G.phase === 'lobby') {
    show('s-lobby');
    $('room').textContent = G.room;
    const url = new URL('index.html?sala=' + G.room, location.href).href;
    $('url').textContent = url;
    if ($('qr').dataset.url !== url) {
      const qr = qrcode(0, 'M');
      qr.addData(url);
      qr.make();
      $('qr').innerHTML = qr.createSvgTag({ cellSize: 8, margin: 0, scalable: true });
      $('qr').dataset.url = url;
    }
    $('pcount').textContent = G.players.length + (G.players.length === 1 ? ' jugador' : ' jugadores');
    const chips = $('chips');
    chips.replaceChildren();
    for (const p of G.players) {
      const c = document.createElement('span');
      c.className = 'chip' + (online.has(p.id) ? '' : ' off');
      c.textContent = p.name;
      chips.append(c);
    }
    $('b-start').disabled = G.players.length === 0;
  } else if (G.phase === 'question') {
    show('s-question');
    $('q-num').textContent = 'Pregunta ' + (G.q + 1) + ' de ' + QUESTIONS.length;
    $('q-text').textContent = q.texto;
    const opts = $('q-opts');
    if (opts.dataset.q !== String(G.q)) {
      opts.replaceChildren(...q.opciones.map((o, i) => optBox(i, o)));
      opts.dataset.q = G.q;
    }
    renderCounter();
    tick();
  } else if (G.phase === 'reveal') {
    show('s-reveal');
    $('r-num').textContent = 'Pregunta ' + (G.q + 1) + ' de ' + QUESTIONS.length;
    $('r-text').textContent = q.texto;
    $('r-opts').replaceChildren(...q.opciones.map((o, i) => {
      const d = optBox(i, (i === G.reveal.correct ? '✔ ' : '') + o, i === G.reveal.correct ? ' right' : ' dim');
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = G.reveal.counts[i];
      d.append(n);
      return d;
    }));
    rankList($('r-top'), ranking(G.players).slice(0, 5));
    $('b-next').textContent = G.q + 1 < QUESTIONS.length ? 'Siguiente' : 'Ver resultados';
  } else if (G.phase === 'final') {
    show('s-final');
    const r = ranking(G.players);
    const pod = $('podium');
    pod.replaceChildren();
    for (const pos of [2, 1, 3]) {
      const p = r[pos - 1];
      if (!p) continue;
      const d = document.createElement('div');
      d.className = 'p' + pos;
      const n = document.createElement('div');
      n.className = 'name';
      n.textContent = p.name;
      const s = document.createElement('div');
      s.textContent = p.score + ' pts';
      const bar = document.createElement('div');
      bar.className = 'bar';
      bar.textContent = pos;
      d.append(n, s, bar);
      pod.append(d);
    }
    rankList($('f-rank'), r);
  }
}

function tick() {
  if (G.phase !== 'question') return;
  $('q-timer').textContent = Math.ceil(Math.max(0, deadline() - Date.now()) / 1000);
  maybeClose();
}

function setNet(ok) {
  const n = $('net');
  if (ok) n.classList.add('hidden');
  else {
    n.textContent = navigator.onLine ? 'Conectando con el servidor…' : 'Sin conexión a Internet. Reconectando…';
    n.className = 'bad';
  }
}

// ---------- Arranque ----------
async function init() {
  if (new URLSearchParams(location.search).get('pin') !== PIN) return show('s-pin');
  try {
    const res = await fetch('questions.json', { cache: 'no-store' });
    QUESTIONS = await res.json();
    QUESTIONS.forEach((q, i) => {
      if (!q.texto || !Array.isArray(q.opciones) || q.opciones.length !== 4 ||
          !(q.correcta >= 0 && q.correcta <= 3) || !(q.segundos > 0)) {
        throw new Error('La pregunta ' + (i + 1) + ' de questions.json no es válida.');
      }
    });
    if (!QUESTIONS.length) throw new Error('questions.json no tiene preguntas.');
  } catch (e) {
    $('err').textContent = 'No se pudieron cargar las preguntas: ' + e.message;
    return show('s-error');
  }

  G = lsGet(STORE);
  if (!G || !G.room || G.q >= QUESTIONS.length) G = newGame();
  save();

  $('b-start').onclick = () => startQuestion(0);
  $('b-close').onclick = () => { if (G.phase === 'question') closeQuestion(); };
  $('b-next').onclick = next;
  $('b-reset').onclick = () => {
    if (!confirm('¿Empezar una partida nueva? Se borrarán los jugadores y puntos.')) return;
    G = newGame();
    save();
    location.reload();
  };

  conn = connectRoom(G.room, {
    onMessage,
    onPresence,
    onStatus: (ok) => { setNet(ok); if (ok) broadcast(); },
  });
  setNet(false);
  render();

  setInterval(tick, 200);
  setInterval(broadcast, 3000);   // latido: los móviles detectan cortes y se resincronizan
  window.addEventListener('online', () => conn.reconnect());
}

init();
