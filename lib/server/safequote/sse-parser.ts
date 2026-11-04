/**
 * Incremental Server-Sent Events parser (WHATWG "event stream" rules), for the Safe Quote upstream.
 *
 * Network chunks split messages at arbitrary byte boundaries: a message's `event:` line, its `data:`
 * line and the blank line that ends it can arrive in different chunks. The parser therefore keeps the
 * partial line AND the message being built across push() calls, and dispatches only on the blank line.
 * (The previous inline loop reset the message on every chunk, silently dropping split events: those
 * sales were then only stored by the next reconciliation run, minutes later.)
 */

export interface SseMessage {
  event: string;
  data: string;
  /** The message's id (or the last id seen on the stream, per the spec), "" when none. */
  id: string;
}

export class SseParser {
  private buf = "";
  private event = "";
  private data: string[] = [];
  private lastId = "";
  /** A "\r" ended the previous chunk: a "\n" starting the next one belongs to the same line break. */
  private pendingCR = false;

  /** Feeds decoded text; returns the messages completed by it (heartbeats/comments are not messages). */
  push(text: string): SseMessage[] {
    if (this.pendingCR && text.startsWith("\n")) text = text.slice(1);
    this.pendingCR = false;
    this.buf += text;
    const out: SseMessage[] = [];
    let start = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const c = this.buf[i];
      if (c !== "\n" && c !== "\r") continue;
      const line = this.buf.slice(start, i);
      if (c === "\r") {
        if (i + 1 < this.buf.length) {
          if (this.buf[i + 1] === "\n") i++;
        } else this.pendingCR = true;
      }
      start = i + 1;
      const msg = this.line(line);
      if (msg) out.push(msg);
    }
    this.buf = this.buf.slice(start);
    return out;
  }

  /** True when the last line seen was a comment (": ping") — callers use it as a heartbeat. */
  sawComment = false;

  private line(line: string): SseMessage | null {
    if (line === "") {
      // Blank line: dispatch the message (if it has data), then reset it.
      const msg = this.data.length ? { event: this.event || "message", data: this.data.join("\n"), id: this.lastId } : null;
      this.event = "";
      this.data = [];
      return msg;
    }
    if (line.startsWith(":")) {
      this.sawComment = true;
      return null;
    }
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") this.event = value;
    else if (field === "data") this.data.push(value);
    else if (field === "id" && !value.includes("\0")) this.lastId = value;
    // "retry" and unknown fields are ignored.
    return null;
  }

  /** Takes and clears the comment flag. */
  takeComment(): boolean {
    const v = this.sawComment;
    this.sawComment = false;
    return v;
  }
}
