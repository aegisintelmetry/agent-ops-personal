const { test } = require("node:test");
const assert = require("node:assert/strict");
const { trustedFrame, bundledResource } = require("../electron/security.cjs");
const { Bridge } = require("../electron/bridge.cjs");

test("renderer requests are restricted to bundled assets", () => {
  const path = require("node:path");
  const { pathToFileURL } = require("node:url");
  const dist = path.resolve("fixture/dist");
  assert.equal(bundledResource(pathToFileURL(path.join(dist, "index.html")).href, dist), true);
  assert.equal(bundledResource(pathToFileURL(path.join(dist, "assets/app.js")).href, dist), true);
  assert.equal(bundledResource(pathToFileURL(path.join(dist, "../secret.txt")).href, dist), false);
  assert.equal(bundledResource(pathToFileURL(path.join(dist, "private.json")).href, dist), false);
  assert.equal(bundledResource("https://untrusted.invalid/", dist), false);
  assert.equal(bundledResource("http://127.0.0.1:8010/", dist), false);
});

test("only the exact main frame may use IPC", () => {
  const frame = { url: "file:///app/index.html" };
  const webContents = { mainFrame: frame };
  const window = { webContents };
  assert.equal(
    trustedFrame(
      { sender: webContents, senderFrame: frame },
      window,
      frame.url,
    ),
    true,
  );
  assert.equal(
    trustedFrame({ sender: {}, senderFrame: frame }, window, frame.url),
    false,
  );
  assert.equal(
    trustedFrame(
      { sender: webContents, senderFrame: { ...frame } },
      window,
      frame.url,
    ),
    false,
  );
  assert.equal(
    trustedFrame(
      { sender: webContents, senderFrame: frame },
      window,
      "https://malicious.invalid",
    ),
    false,
  );
});
test("bridge does not expose general execution or arbitrary methods", async () => {
  const bridge = new Bridge();
  await assert.rejects(bridge.call("exec", { command: "anything" }));
  await assert.rejects(bridge.call("snapshot", []));
  await assert.rejects(bridge.call("chat", { message: "x".repeat(260000) }));
  assert.equal(bridge.child, undefined);
});
