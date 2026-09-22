const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { CodexConnection, findCodex } = require("../electron/codex.cjs");

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "btk-codex-runtime-"));
  const service = new CodexConnection({ directory, openExternal: async () => {} });
  try {
    assert.ok(findCodex(), "installed native Codex executable");
    const state = await service.state();
    assert.equal(state.connected, false);
    assert.equal(fs.existsSync(path.join(directory, "codex-home", "auth.json")), false);
    await service.login();
    assert.equal(Boolean(service.loginId), true);
    await service.cancelLogin();
    assert.equal(service.loginId, null);
    const result = { status: "passed", checkedAt: new Date().toISOString(), initialized: true, isolatedSignedOut: true, loginStartedAndCancelled: true, plaintextAuthFile: false, inferenceRequested: false };
    fs.writeFileSync(path.join(__dirname, "../artifacts/codex-runtime-smoke.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { service.stop(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
