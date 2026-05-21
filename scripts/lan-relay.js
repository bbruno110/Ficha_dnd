const http = require('http');

const PORT = Number(process.env.LAN_RELAY_PORT || 43116);
const sessions = new Map();
const joined = new Map();
const events = new Map();

const server = http.createServer(async (req, res) => {
  try {
    setCors(res);
    if (req.method === 'OPTIONS') return sendJson(res, 204, {});

    const url = new URL(req.url || '/', `http://${req.headers.host || `localhost:${PORT}`}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/session') {
      const payload = await readJson(req);
      if (!payload?.session?.id) return sendJson(res, 400, { error: 'invalid session payload' });
      sessions.set(payload.session.id, payload);
      ensureList(joined, payload.session.id);
      ensureList(events, payload.session.id);
      return sendJson(res, 200, { url: makeSessionUrl(req, payload.session.id) });
    }

    const sessionMatch = url.pathname.match(/^\/session\/([^/]+)$/);
    if (sessionMatch) {
      const sessionId = decodeURIComponent(sessionMatch[1]);

      if (req.method === 'GET') {
        const payload = sessions.get(sessionId);
        if (!payload) return sendJson(res, 404, { error: 'session not found' });
        payload.events = ensureList(events, sessionId).slice(-50);
        return sendJson(res, 200, payload);
      }

      if (req.method === 'POST') {
        const payload = await readJson(req);
        if (!payload?.session?.id) return sendJson(res, 400, { error: 'invalid session payload' });
        sessions.set(sessionId, payload);
        return sendJson(res, 200, { ok: true });
      }
    }

    if (req.method === 'POST' && url.pathname === '/join') {
      const entry = await readJson(req);
      if (!entry?.sessionId) return sendJson(res, 400, { error: 'missing sessionId' });
      upsertByKey(ensureList(joined, entry.sessionId), entry, 'remoteKey');
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/joined') {
      const sessionId = url.searchParams.get('sessionId') || '';
      return sendJson(res, 200, ensureList(joined, sessionId));
    }

    if (req.method === 'POST' && url.pathname === '/event') {
      const event = await readJson(req);
      if (!event?.sessionId || !event?.id) return sendJson(res, 400, { error: 'invalid event' });
      upsertByKey(ensureList(events, event.sessionId), event, 'id');
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      const sessionId = url.searchParams.get('sessionId') || '';
      return sendJson(res, 200, ensureList(events, sessionId));
    }

    return sendJson(res, 404, { error: 'not found' });
  } catch (error) {
    return sendJson(res, 500, { error: error instanceof Error ? error.message : 'unknown error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`LAN relay ouvindo em http://0.0.0.0:${PORT}`);
  console.log('Use EXPO_PUBLIC_LAN_RELAY_URL=http://SEU_IP_NA_REDE:43116 se o app nao detectar o IP automaticamente.');
});

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  if (status === 204) return res.end();
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (!body) return resolve(null);
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function ensureList(map, key) {
  if (!map.has(key)) map.set(key, []);
  return map.get(key);
}

function upsertByKey(list, item, key) {
  const index = list.findIndex((entry) => entry?.[key] && entry[key] === item[key]);
  if (index >= 0) list[index] = item;
  else list.push(item);
}

function makeSessionUrl(req, sessionId) {
  const host = req.headers.host || `localhost:${PORT}`;
  return `http://${host}/session/${encodeURIComponent(sessionId)}`;
}
