const { spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { EventEmitter } = require("node:events");
const { runtimeLaunch, verifyHandshake } = require("./runtime.cjs");

const METHODS = new Set(["snapshot", "connection", "readiness", "task", "chat", "cancel", "setup_status", "setup_enroll", "setup_install", "agent_status", "agent_start"]);

class Bridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.pending = new Map();
    this.sequence = 0;
    this.options = options;
  }
  start() {
    if (this.child) return this.ready;
    const launch = runtimeLaunch(this.options);
    const env = { ...process.env, PYTHONIOENCODING: "utf-8" };
    delete env.PYTHONPATH;
    delete env.PYTHONHOME;
    const child = spawn(
      launch.executable,
      launch.args,
      {
        cwd: launch.cwd,
        env,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      },
    );
    this.child = child;
    let readyResolve, readyReject;
    this.ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    const readyTimer = setTimeout(() => {
      readyReject(new Error("코어 시작 확인 시간이 초과되었습니다."));
      child.kill();
    }, 12000);
    createInterface({ input: child.stdout }).on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (message.event === "ready") {
          clearTimeout(readyTimer);
          try { verifyHandshake(message.data, launch.release); readyResolve(); }
          catch (error) { readyReject(error); child.kill(); }
          return;
        }
        if (message.event === "chat") return this.emit("chat", message.data);
        const pending = this.pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(message.id);
        message.error
          ? pending.reject(new Error(message.error))
          : pending.resolve(message.result);
      } catch {
        /* Non-protocol output must not enter the renderer. */
      }
    });
    child.stderr.resume();
    const fail = () => {
      if (this.child !== child) return;
      clearTimeout(readyTimer);
      readyReject(new Error("코어 시작에 실패했습니다. 설치 점검이 필요합니다."));
      this.child = null;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error("로컬 연결 프로세스가 종료되었습니다. 다시 연결해 주세요."),
        );
      }
      this.pending.clear();
      this.emit("disconnected");
    };
    child.on("error", fail);
    child.on("exit", fail);
    child.stdin.on("error", fail);
    return this.ready;
  }
  async call(method, params = {}) {
    if (!METHODS.has(method))
      return Promise.reject(new Error("허용되지 않은 작업입니다."));
    if (!params || typeof params !== "object" || Array.isArray(params))
      return Promise.reject(new Error("잘못된 요청입니다."));
    if (this.pending.size >= 16)
      return Promise.reject(
        new Error("요청이 많습니다. 잠시 후 다시 시도해 주세요."),
      );
    const id = ++this.sequence;
    const payload = JSON.stringify({ id, method, params });
    if (Buffer.byteLength(payload) > 250000)
      return Promise.reject(new Error("요청 크기를 초과했습니다."));
    await this.start();
    if (!this.child) throw new Error("로컬 연결이 종료되었습니다.");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("로컬 연결 응답 시간이 초과되었습니다."));
      }, method === "agent_start" ? 65000 : method === "setup_enroll" ? 30000 : 15000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(payload + "\n");
    });
  }
  stop() {
    const child = this.child;
    if (!child) return;
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 5000);
    timer.unref();
    child.once("exit", () => clearTimeout(timer));
  }
}
module.exports = { Bridge, METHODS };
