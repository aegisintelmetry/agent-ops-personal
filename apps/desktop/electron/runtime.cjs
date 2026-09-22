const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function verifyRelease(resourcesPath, expectedVersion) {
  const release = JSON.parse(fs.readFileSync(path.join(resourcesPath, "desktop-release.json"), "utf8"));
  if (release.schema !== "btk.desktop.release.v1" || release.version !== expectedVersion || release.protocol_version !== 1)
    throw new Error("앱과 코어의 릴리스 버전이 일치하지 않습니다. 설치 파일을 다시 확인해 주세요.");
  if (!Array.isArray(release.core?.files) || release.core.entry !== "btk-desktop-core.exe" || release.core.runtime_entry !== "btk-agent-runtime.exe")
    throw new Error("코어 파일 목록이 올바르지 않습니다.");
  const core = fs.realpathSync(path.join(resourcesPath, "core"));
  if (path.relative(fs.realpathSync(resourcesPath), core) !== "core")
    throw new Error("코어 디렉터리가 설치 범위를 벗어났습니다.");
  const names = new Set();
  for (const row of release.core.files) {
    if (typeof row.path !== "string" || !row.path || row.path.includes("\\") || row.path.includes(":") || row.path.split("/").some(part => !part || part === "." || part === "..") || names.has(row.path))
      throw new Error("코어 파일 경로가 올바르지 않습니다.");
    const file = fs.realpathSync(path.join(core, row.path));
    const relative = path.relative(core, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("코어 파일이 설치 범위를 벗어났습니다.");
    const bytes = fs.readFileSync(file);
    if (bytes.length !== row.bytes || crypto.createHash("sha256").update(bytes).digest("hex") !== row.sha256)
      throw new Error("코어 파일 검증에 실패했습니다. 같은 릴리스로 다시 설치해 주세요.");
    names.add(row.path);
  }
  if (!names.has(release.core.entry)) throw new Error("코어 실행 파일이 누락됐습니다.");
  if (!names.has(release.core.runtime_entry)) throw new Error("백그라운드 실행 파일이 누락됐습니다.");
  function inspect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error("코어의 파일 링크는 허용하지 않습니다.");
      if (entry.isDirectory()) inspect(file);
      else if (!names.has(path.relative(core, file).replaceAll("\\", "/")))
        throw new Error("릴리스에 없는 코어 파일이 발견됐습니다.");
    }
  }
  inspect(core);
  return { executable: path.join(core, release.core.entry), args: [], cwd: core, release };
}

function runtimeLaunch({ packaged = false, resourcesPath, version } = {}) {
  if (packaged) return verifyRelease(resourcesPath, version);
  const repo = path.resolve(__dirname, "../../..");
  const venv = path.join(repo, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  return { executable: fs.existsSync(venv) ? venv : "python",
    args: ["-I", "-u", path.join(repo, "agent_ops/desktop/bridge.py")], cwd: repo,
    release: { version: version || require("../package.json").version, protocol_version: 1 } };
}

function verifyHandshake(info, release) {
  if (info.protocol_version !== release.protocol_version || info.version !== release.version ||
      (release.build_id && info.build_id !== release.build_id))
    throw new Error("실행 중인 코어와 앱 버전이 다릅니다. 다시 설치해 주세요.");
}

module.exports = { verifyRelease, runtimeLaunch, verifyHandshake };
