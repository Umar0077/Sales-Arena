"use client";

/**
 * One EventSource per tab that never gives up.
 *
 * The browser retries a dropped stream by itself, BUT it closes an EventSource for good (readyState
 * CLOSED, no more retries) when a reconnect is answered with a non-200 status or another content type:
 * e.g. a 502 while the app restarts during a deploy, or a proxy error page. Before this helper, Live Arena
 * displays and Admin tabs then stayed without live events until someone refreshed them.
 *
 * `bind` attaches the listeners to each new EventSource. Backoff: 1, 2, 3, 5, 10 s, then every 15 s;
 * reset as soon as a stream opens. Coming back online reconnects at once.
 */
export function openResilientStream(url: string, bind: (es: EventSource) => void, onClosed?: () => void): () => void {
  let es: EventSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let stopped = false;
  const delays = [1000, 2000, 3000, 5000, 10000, 15000];

  const connect = () => {
    if (stopped) return;
    timer = null;
    es?.close();
    const s = new EventSource(url);
    es = s;
    s.addEventListener("open", () => {
      attempt = 0;
    });
    s.addEventListener("error", () => {
      if (s !== es || s.readyState !== EventSource.CLOSED || stopped) return; // the browser is retrying by itself
      onClosed?.();
      if (!timer) timer = setTimeout(connect, delays[Math.min(attempt++, delays.length - 1)]);
    });
    bind(s);
  };
  const online = () => {
    if (es?.readyState === EventSource.CLOSED) {
      if (timer) clearTimeout(timer);
      connect();
    }
  };

  connect();
  window.addEventListener("online", online);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    window.removeEventListener("online", online);
    es?.close();
    es = null;
  };
}
