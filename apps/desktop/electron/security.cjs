const path = require("node:path");
const { fileURLToPath } = require("node:url");

function bundledResource(url, dist) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:") return false;
    const relative = path.relative(dist, fileURLToPath(parsed)).replaceAll("\\", "/");
    return relative === "index.html" || /^assets\/[A-Za-z0-9_.-]+$/.test(relative);
  } catch { return false; }
}

function trustedFrame(event, window, expectedURL) {
  return Boolean(
    window &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame &&
    event.senderFrame.url === expectedURL,
  );
}
module.exports = { trustedFrame, bundledResource };
