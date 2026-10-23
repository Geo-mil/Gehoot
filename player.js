// Jugador: solo envía "join" y "answer"; todo lo demás lo dicta el estado que difunde el host.
const STORE = 'gehoot-player';
const $ = (id) => document.getElementById(id);

const me = lsGet(STORE) || {};
if (!me.id) me.id = shuffleId();
let S = null;            // último estado recibido del host
let conn = null;
let subscribed = false;
let lastMsg = 0;
let deadlineLocal = 0;   // fin de la pregunta según el reloj del móvil (solo para mostrar)
let myAnswer = null;     // {q, c}
let resendTimer = null;

function save() { lsSet(STORE, me); }

function show(id) {
  for (const s of document.querySelectorAll('main > section')) s.classList.add('hidden');
  $(id).classList.remove('hidden');
}

// ---------- Entrar ----------
function initJoin() {
  const urlRoom = new URLSearchParams(location.search).get('sala');
  if (urlRoom) $('i-room').classList.add('hidden');
  $('i-room').value = urlRoom || me.room || '';
  $('i-name').value = me.name || '';

  // Recarga: mismo nombre e id en la misma sala → volver directamente.
  if (me.name && me.room && (!urlRoom || urlRoom === me.room)) return start();

  show('s-join');
  $('f-join').onsubmit = (e) => {
    e.preventDefault();
    const room = $('i-room').value.trim();
    const name = $('i-name').value.trim();
    if (!/^\d{4}$/.test(room)) return alert('Escribe el código de sala (4 números).');
    if (!name) return;
    me.room = room;
    me.name = name;
    save();
    start();
  };
}

function start() {
  show('s-wait');
  $('w-name').textContent = me.name;
  $('w-msg').textContent = 'Conectando…';
  conn = connectRoom(me.room, {
    presenceKey: me.id,
    presencePayload: () => ({ id: me.id }),
    onMessage,
    onStatus: (ok) => {
      subscribed = ok;
      if (ok) {
        conn.send({ t: 'join', id: me.id, name: me.name });
        conn.send({ t: 'hello' });
      }
      updateNet();
    },
  });
  setInterval(watchdog, 1000);
  setInterval(renderTimer, 250);
  window.addEventListener('online', () => conn.reconnect());
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - lastMsg > 6000) conn.reconnect();
  });
}

// ---------- Estado recibido ----------
function onMessage(m) {
  if (!m || m.t !== 'state' || m.room !== me.room) return;
  lastMsg = Date.now();
  const prevPhase = S && S.phase;
  const prevQ = S && S.q;
  S = m;
  updateNet();

  const inGame = S.players.find((p) => p.id === me.id);
  if (!inGame) {
    // El host aún no nos tiene (o es otra partida): pedir entrar.
    conn.send({ t: 'join', id: me.id, name: me.name });
  } else if (inGame.name !== me.name) {
    me.name = inGame.name;   // el host pudo añadir un sufijo
    save();
  }

  if (S.phase === 'question' && (prevPhase !== 'question' || prevQ !== S.q || !deadlineLocal)) {
    deadlineLocal = Date.now() + S.remainingMs;
  }
  if (S.phase !== 'question') deadlineLocal = 0;
  render();
}

function render() {
  if (!S) return;
  const p = S.players.find((x) => x.id === me.id);
  const answered = S.answered.includes(me.id) || (myAnswer && myAnswer.q === S.q);

  if (S.phase === 'lobby') {
    show('s-wait');
    $('w-name').textContent = me.name;
    $('w-msg').textContent = p ? 'Espera a que empiece…' : 'Entrando…';
  } else if (S.phase === 'question') {
    if (answered) {
      show('s-sent');
      const c = myAnswer && myAnswer.q === S.q ? myAnswer.c : null;
      $('sent-shape').textContent = c === null ? '✔' : SHAPES[c];
    } else {
      show('s-question');
      $('q-num').textContent = 'Pregunta ' + (S.q + 1) + ' / ' + S.total;
      const box = $('answers');
      if (box.dataset.q !== String(S.q)) {
        box.replaceChildren(...[0, 1, 2, 3].map((i) => {
          const b = document.createElement('button');
          b.className = 'o' + i;
          b.setAttribute('aria-label', 'Opción ' + LETTERS[i]);
          b.innerHTML = '<span>' + SHAPES[i] + '</span><small>' + LETTERS[i] + '</small>';
          b.onclick = () => answer(i);
          return b;
        }));
        box.dataset.q = S.q;
      }
      renderTimer();
    }
  } else if (S.phase === 'reveal') {
    show('s-result');
    const r = S.reveal && S.reveal.results[me.id];
    const box = $('r-box');
    if (!r || !r.answered) {
      box.className = 'result neutral';
      $('r-title').textContent = 'Sin respuesta';
      $('r-pts').textContent = '';
    } else if (r.ok) {
      box.className = 'result ok';
      $('r-title').textContent = '¡Correcto!';
      $('r-pts').textContent = '+' + r.pts + ' puntos';
    } else {
      box.className = 'result bad';
      $('r-title').textContent = 'Incorrecto';
      $('r-pts').textContent = '0 puntos';
    }
    $('r-pos').textContent = p ? 'Vas en el puesto ' + position() + ' · ' + p.score + ' pts' : '';
  } else if (S.phase === 'final') {
    show('s-final');
    $('f-pos').textContent = p ? 'Puesto ' + position() : '';
    $('f-pts').textContent = p ? p.score + ' puntos' : '';
  }
}

function position() {
  return ranking(S.players).findIndex((p) => p.id === me.id) + 1;
}

function renderTimer() {
  if (!S || S.phase !== 'question') return;
  $('q-timer').textContent = '⏱ ' + Math.ceil(Math.max(0, deadlineLocal - Date.now()) / 1000);
}

// ---------- Responder ----------
function answer(c) {
  if (!S || S.phase !== 'question') return;
  if (myAnswer && myAnswer.q === S.q) return;
  myAnswer = { q: S.q, c };
  if (navigator.vibrate) navigator.vibrate(40);
  render();
  sendAnswer();
}

function sendAnswer() {
  clearTimeout(resendTimer);
  if (!myAnswer || !S || S.phase !== 'question' || S.q !== myAnswer.q) return;
  if (S.answered.includes(me.id)) return;
  conn.send({ t: 'answer', id: me.id, q: myAnswer.q, c: myAnswer.c });
  resendTimer = setTimeout(sendAnswer, 1500);   // reintento hasta que el host lo confirme
}

// ---------- Conexión ----------
function watchdog() {
  // El host emite un latido cada 3 s; si no llega nada en 10 s, reabrir el canal.
  if (subscribed && S && Date.now() - lastMsg > 10000) {
    lastMsg = Date.now();
    conn.reconnect();
  }
  updateNet();
}

function updateNet() {
  const n = $('net');
  const stale = S && Date.now() - lastMsg > 7000;
  if (!navigator.onLine) {
    n.textContent = 'Sin conexión a Internet. Reconectando…';
    n.className = 'bad';
  } else if (!subscribed || stale) {
    n.textContent = 'Conexión perdida. Reconectando…';
    n.className = 'bad';
  } else if (!S) {
    n.textContent = 'Esperando al presentador…';
    n.className = '';
  } else {
    n.className = 'hidden';
  }
}

initJoin();
