// Conexión compartida con Supabase Realtime (broadcast + presence). Sin base de datos.
const SUPABASE_URL = 'https://fqhmtthjimrdiqnucufg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_QN_8ZC6gshjPD2SwqFeibA_YM84A7TR';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  realtime: { params: { eventsPerSecond: 20 } },
});

// Abre (y reabre si falla) el canal de una sala.
// opts: { presenceKey, presencePayload(), onMessage(msg), onPresence(channel, event, key), onStatus(ok) }
function connectRoom(room, opts) {
  let ch = null;
  let ok = false;
  let retryTimer = null;

  function open() {
    const me = sb.channel('gehoot-' + room, {
      config: {
        broadcast: { self: false },
        presence: { key: opts.presenceKey || '' },
      },
    });
    ch = me;
    me.on('broadcast', { event: 'msg' }, ({ payload }) => {
      if (me === ch) opts.onMessage(payload);
    });
    for (const ev of ['sync', 'join', 'leave']) {
      me.on('presence', { event: ev }, (info) => {
        if (me === ch && opts.onPresence) opts.onPresence(me, ev, info);
      });
    }
    me.subscribe(async (status) => {
      if (me !== ch) return;
      if (status === 'SUBSCRIBED') {
        ok = true;
        opts.onStatus(true);
        if (opts.presencePayload) {
          try { await me.track(opts.presencePayload()); } catch (e) { /* se reintenta al reconectar */ }
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        ok = false;
        opts.onStatus(false);
        clearTimeout(retryTimer);
        retryTimer = setTimeout(reconnect, 2000);
      }
    });
  }

  function reconnect() {
    clearTimeout(retryTimer);
    const old = ch;
    ch = null;
    ok = false;
    if (old) sb.removeChannel(old);
    open();
  }

  open();

  return {
    send(payload) {
      if (!ch) return;
      ch.send({ type: 'broadcast', event: 'msg', payload }).catch(() => {});
    },
    reconnect,
    isOk: () => ok,
  };
}

// Buzón jugador → host: canal que solo escucha el host. El jugador no se suscribe
// (supabase-js lo envía por HTTP), así las respuestas no se reparten a todos los móviles.
function inboxTopic(room) { return room + '-in'; }

function makeInboxSender(room, fallback) {
  const ch = sb.channel('gehoot-' + inboxTopic(room));
  return async (payload) => {
    let r = 'error';
    try { r = await ch.send({ type: 'broadcast', event: 'msg', payload }); } catch (e) { /* usa el canal normal */ }
    if (r !== 'ok') fallback(payload);
  };
}

function shuffleId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function lsGet(key) {
  try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* sin almacenamiento */ }
}

// Orden de ranking compartido por host y jugador.
function ranking(players) {
  return [...players].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

const SHAPES = ['▲', '◆', '●', '■'];
const LETTERS = ['A', 'B', 'C', 'D'];
