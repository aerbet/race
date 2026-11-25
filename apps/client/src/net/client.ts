import {
  DelayedChannel,
  Msg,
  decodeServer,
  encodeClient,
  parseNetConditions,
  type ClientMsg,
  type ServerMsg,
} from '@sr/shared';

export function serverUrl(): string {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_SERVER_URL;
  const q = new URLSearchParams(location.search).get('server');
  if (q) return q;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.hostname}:2567`;
}

/**
 * Соединение с сервером гонок. В dev-режиме все сообщения в обе стороны
 * проходят через симулятор сети (?lag=150&jitter=30&loss=2).
 */
export class NetClient {
  private ws: WebSocket;
  private out: DelayedChannel<Uint8Array>;
  private inc: DelayedChannel<ServerMsg>;
  rtt = 0;
  private pingTimer = 0;
  onMessage: (m: ServerMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};
  closed = false;

  constructor(url = serverUrl()) {
    const cond = parseNetConditions(new URLSearchParams(location.search));
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';
    this.out = new DelayedChannel(cond, (d) => {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(d);
    });
    this.inc = new DelayedChannel(cond, (m) => this.handle(m), undefined, undefined, 99);
    this.ws.onmessage = (e) => {
      try {
        this.inc.send(decodeServer(new Uint8Array(e.data as ArrayBuffer)));
      } catch (err) {
        console.warn('плохое сообщение сервера', err);
      }
    };
    this.ws.onclose = () => {
      this.closed = true;
      clearInterval(this.pingTimer);
      this.onClose('соединение закрыто');
    };
  }

  opened(): Promise<void> {
    return new Promise((res, rej) => {
      if (this.ws.readyState === WebSocket.OPEN) return res();
      this.ws.addEventListener('open', () => {
        this.pingTimer = window.setInterval(
          () => this.send({ type: Msg.Ping, t: performance.now() }),
          1000,
        );
        res();
      });
      this.ws.addEventListener('error', () => rej(new Error('сервер недоступен')));
    });
  }

  private handle(m: ServerMsg): void {
    if (m.type === Msg.Pong) {
      const r = performance.now() - m.t;
      this.rtt = this.rtt ? this.rtt * 0.8 + r * 0.2 : r;
    }
    this.onMessage(m);
  }

  send(m: ClientMsg): void {
    this.out.send(encodeClient(m));
  }

  close(): void {
    clearInterval(this.pingTimer);
    if (this.ws.readyState === WebSocket.OPEN) this.send({ type: Msg.Leave });
    setTimeout(() => this.ws.close(), 100);
  }
}
