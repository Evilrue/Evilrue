/**
 * 班级聊天室 · Cloudflare Worker 版本
 *
 * - 同一个 Worker 既提供网页，也提供 WebSocket 接口
 * - 每个房间对应一个 Durable Object 实例，负责消息广播 + 历史记录
 * - 单文件，可由 build.mjs 把 public/index.html 内联进来后直接部署
 */

const PAGE = "__PAGE__";

const MAX_TEXT = 500;
const MAX_NAME = 16;
const KEEP = 200;
const RATE_WINDOW_MS = 5000;
const RATE_MAX = 15;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'same-origin',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function cleanText(value, max) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanRoom(value) {
  const room = cleanText(value, 24).replace(/\s+/g, '-').toLowerCase();
  return room || 'main';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/ws' || path === '/api/ws/') {
      const room = cleanRoom(url.searchParams.get('room'));
      const stub = env.ROOMS.get(env.ROOMS.idFromName(room));
      return stub.fetch(request);
    }

    if (path === '/api/health') {
      return json({ ok: true, service: 'class-chat', ts: Date.now() });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('method not allowed', { status: 405 });
    }

    if (path === '/' || path === '/index.html' || path === '/chat') {
      return new Response(PAGE, { headers: HTML_HEADERS });
    }

    if (path === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    return new Response('404 not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
};

export class ChatRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.log = null;
    this.seq = 0;
    this.rate = new Map();
  }

  /* 懒加载历史记录（休眠唤醒后重新从存储里读） */
  async ensure() {
    if (this.log) return;
    const stored = await this.state.storage.get('log');
    this.log = Array.isArray(stored) ? stored.slice(-KEEP) : [];
    this.seq = this.log.length ? this.log[this.log.length - 1].id : 0;
  }

  online() {
    return this.state.getWebSockets().length;
  }

  broadcast(payload, except) {
    const data = JSON.stringify(payload);
    for (const socket of this.state.getWebSockets()) {
      if (socket === except) continue;
      try {
        socket.send(data);
      } catch {
        /* 连接已断，忽略 */
      }
    }
  }

  presence() {
    this.broadcast({ t: 'presence', online: this.online() });
  }

  async fetch(request) {
    const upgrade = (request.headers.get('Upgrade') || '').toLowerCase();
    if (upgrade !== 'websocket') {
      return new Response('expected websocket upgrade', { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);
    server.serializeAttachment({ name: '匿名' });
    await this.ensure();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket, raw) {
    let data;
    try {
      data = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (!data || typeof data !== 'object') return;

    switch (data.t) {
      case 'hello':
        return this.onHello(socket, data);
      case 'msg':
        return this.onMessage(socket, data);
      case 'typing':
        return this.onTyping(socket);
      case 'ping':
        try {
          socket.send('{"t":"pong"}');
        } catch {
          /* ignore */
        }
        return;
      default:
        return;
    }
  }

  async onHello(socket, data) {
    await this.ensure();
    const name = cleanText(data.name, MAX_NAME) || '匿名';
    socket.serializeAttachment({ name });

    try {
      socket.send(
        JSON.stringify({
          t: 'init',
          online: this.online(),
          history: this.log.slice(-80),
          me: { name },
        })
      );
    } catch {
      return;
    }

    if (this.online() > 1) {
      this.broadcast({ t: 'sys', text: `${name} 加入了聊天` }, socket);
    }
    this.presence();
  }

  async onMessage(socket, data) {
    await this.ensure();

    const attachment = socket.deserializeAttachment() || {};
    const name = cleanText(attachment.name, MAX_NAME) || '匿名';
    const text = cleanText(data.text, MAX_TEXT);
    if (!text) return;

    // 防刷屏：同一连接 5 秒最多 15 条
    const now = Date.now();
    const stamps = (this.rate.get(socket) || []).filter((t) => now - t < RATE_WINDOW_MS);
    if (stamps.length >= RATE_MAX) {
      try {
        socket.send(JSON.stringify({ t: 'err', msg: '发太快了，歇一下' }));
      } catch {
        /* ignore */
      }
      return;
    }
    stamps.push(now);
    this.rate.set(socket, stamps);

    this.seq += 1;
    const message = { id: this.seq, name, text, ts: now };
    this.log.push(message);
    if (this.log.length > KEEP) this.log.splice(0, this.log.length - KEEP);

    this.broadcast({ t: 'msg', m: message });
    try {
      await this.state.storage.put('log', this.log);
    } catch {
      /* 存储失败不影响聊天 */
    }
  }

  onTyping(socket) {
    const attachment = socket.deserializeAttachment() || {};
    const name = cleanText(attachment.name, MAX_NAME) || '匿名';
    this.broadcast({ t: 'typing', name }, socket);
  }

  async webSocketClose(socket) {
    this.rate.delete(socket);
    try {
      socket.close(1000, 'bye');
    } catch {
      /* ignore */
    }
    this.presence();
  }

  async webSocketError(socket) {
    this.rate.delete(socket);
    this.presence();
  }
}
