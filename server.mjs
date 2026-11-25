// 零依赖聊天服务器：静态页面 + SSE 实时推送 + HTTP 发消息
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 3000;

const MAX_TEXT = 500;
const MAX_NAME = 16;
const HISTORY_KEEP = 300;
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 12;

/** roomId -> { seq, msgs: [], clients: Set<res> } */
const rooms = new Map();
/** ip -> [timestamps] */
const rate = new Map();

function getRoom(id) {
  let r = rooms.get(id);
  if (!r) {
    r = { seq: 0, msgs: [], clients: new Set() };
    rooms.set(id, r);
  }
  return r;
}

function clean(str, max) {
  return String(str ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}

function rateLimited(ip) {
  const now = Date.now();
  const arr = (rate.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (arr.length >= RATE_MAX) return true;
  arr.push(now);
  rate.set(ip, arr);
  return false;
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    ...extra,
  });
  res.end(body);
}

function sseWrite(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(room, event, data) {
  for (const client of room.clients) {
    try {
      sseWrite(client, event, data);
    } catch {
      room.clients.delete(client);
    }
  }
}

function presence(room) {
  broadcast(room, 'presence', { online: room.clients.size });
}

function readJson(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(res, urlPath) {
  const rel = decodeURIComponent(urlPath === '/' ? '/index.html' : urlPath);
  const file = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, 'text/plain; charset=utf-8', 'forbidden');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'text/plain; charset=utf-8', 'not found');
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=3600',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';

  if (req.method === 'OPTIONS') {
    return send(res, 204, 'text/plain', '', {
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
  }

  if (url.pathname === '/api/health') {
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, rooms: rooms.size }));
  }

  // 实时消息流
  if (url.pathname === '/api/stream' && req.method === 'GET') {
    const roomId = clean(url.searchParams.get('room') || 'main', 40) || 'main';
    const room = getRoom(roomId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 3000\n\n');

    // 先补历史消息
    for (const m of room.msgs) sseWrite(res, 'message', m);

    room.clients.add(res);
    presence(room);

    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        /* ignore */
      }
    }, 15000);

    const done = () => {
      clearInterval(ping);
      room.clients.delete(res);
      presence(room);
    };
    req.on('close', done);
    req.on('error', done);
    return;
  }

  // 发送一条消息
  if (url.pathname === '/api/send' && req.method === 'POST') {
    if (rateLimited(ip)) {
      return send(res, 429, 'application/json; charset=utf-8', JSON.stringify({ error: '发送太快了，歇一下' }));
    }
    let body;
    try {
      body = await readJson(req);
    } catch {
      return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: '请求格式不对' }));
    }
    const roomId = clean(body.room || 'main', 40) || 'main';
    const text = clean(body.text, MAX_TEXT);
    const name = clean(body.name, MAX_NAME) || '匿名';
    if (!text) return send(res, 400, 'application/json; charset=utf-8', JSON.stringify({ error: '消息不能为空' }));

    const room = getRoom(roomId);
    room.seq += 1;
    const msg = { id: room.seq, name, text, ts: Date.now() };
    room.msgs.push(msg);
    if (room.msgs.length > HISTORY_KEEP) room.msgs.splice(0, room.msgs.length - HISTORY_KEEP);
    broadcast(room, 'message', msg);
    return send(res, 200, 'application/json; charset=utf-8', JSON.stringify({ ok: true, id: msg.id }));
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'text/plain; charset=utf-8', 'method not allowed');
  }
  return serveStatic(res, url.pathname);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`chat server listening on http://0.0.0.0:${PORT}`);
});
