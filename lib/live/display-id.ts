/** Anonymous id of this display tab (random, per tab session): used only to count deliveries / acks. */
export function displayId(): string {
  try {
    let v = sessionStorage.getItem("sales-arena:display-id");
    if (!v) {
      v = `d-${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
      sessionStorage.setItem("sales-arena:display-id", v);
    }
    return v;
  } catch {
    return "d-unknown-display";
  }
}
