import base from "./playwright.ui.config";
export default { ...base, webServer: { ...(base.webServer as object), command: "npx next dev --webpack -p 3100 -H 127.0.0.1" } };
