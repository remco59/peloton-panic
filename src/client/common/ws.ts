import type { ClientMsg, ServerMsg } from '../../shared/protocol';

export interface Socket {
  send(msg: ClientMsg): void;
  close(): void;
}

interface Handlers {
  /** Called on every (re)connect: send your hello message here. */
  onOpen(): void;
  onMessage(msg: ServerMsg): void;
  onStatus(online: boolean): void;
}

/** A WebSocket that reconnects with backoff and tells you when it comes back. */
export function openSocket(h: Handlers): Socket {
  let ws: WebSocket | null = null;
  let closed = false;
  let delay = 400;
  let timer: number | undefined;

  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => {
      delay = 400;
      h.onStatus(true);
      h.onOpen();
    };
    ws.onmessage = (e) => {
      try {
        h.onMessage(JSON.parse(e.data));
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      h.onStatus(false);
      if (closed) return;
      timer = window.setTimeout(connect, delay);
      delay = Math.min(delay * 1.6, 4000);
    };
    ws.onerror = () => ws?.close();
  };

  connect();

  // Phones sleep: reconnect promptly when the tab becomes visible again.
  const onVisible = () => {
    if (document.visibilityState === 'visible' && (!ws || ws.readyState > 1) && !closed) {
      window.clearTimeout(timer);
      connect();
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  return {
    send(msg) {
      if (ws?.readyState === 1) ws.send(JSON.stringify(msg));
    },
    close() {
      closed = true;
      document.removeEventListener('visibilitychange', onVisible);
      ws?.close();
    },
  };
}
