const { PersonalError, boundedJson } = require("./personal.cjs");
const tools = require("./slack-tools.json");
const fail = message => { throw new PersonalError(message); };
const emptyObservation = () => ({ authenticated: false, checkedAt: null, team: "", teamId: "", channelsCheckedAt: null, channelStatus: "unchecked" });

class SlackConnector {
  constructor({ personal, fetchImpl = fetch, timeoutMs = 15000 }) {
    this.personal = personal;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.observation = emptyObservation();
  }
  state() {
    const config = this.personal.data.slack || {};
    return { id: "slack", transport: "web_api", tokenConfigured: Boolean(config.encryptedToken), enabled: config.enabled === true,
      ...this.observation, agentCallable: false, tools: tools.map(tool => ({ ...tool })) };
  }
  requirePersonal() { if (this.personal.data.mode !== "personal") fail("개인용 모드에서만 커넥터를 사용할 수 있습니다."); }
  save(token) {
    this.requirePersonal(); this.personal.idle();
    if (typeof token !== "string" || !/^xoxb-[A-Za-z0-9-]{10,4000}$/.test(token)) fail("Slack Bot 토큰 형식을 확인해 주세요.");
    if (!this.personal.encryptionAvailable()) fail("OS 보안 저장소를 사용할 수 없습니다.");
    let encryptedToken;
    try { encryptedToken = this.personal.safeStorage.encryptString(token).toString("base64"); }
    catch { fail("Slack 토큰 암호화에 실패했습니다."); }
    this.personal.write({ ...this.personal.data, slack: { encryptedToken, enabled: true } });
    this.observation = emptyObservation();
    return this.state();
  }
  enable(enabled) {
    this.requirePersonal(); this.personal.idle();
    if (typeof enabled !== "boolean") fail("사용 여부가 올바르지 않습니다.");
    const slack = this.personal.data.slack || {};
    if (enabled && !slack.encryptedToken) fail("Slack 토큰을 먼저 등록해 주세요.");
    this.personal.write({ ...this.personal.data, slack: { ...slack, enabled } });
    this.observation = emptyObservation();
    return this.state();
  }
  remove() {
    this.requirePersonal(); this.personal.idle();
    this.personal.write({ ...this.personal.data, slack: { encryptedToken: "", enabled: false } });
    this.observation = emptyObservation();
    return this.state();
  }
  cancel() { this.personal.connectorActive?.abort(); return { cancelled: Boolean(this.personal.connectorActive) }; }
  async call(method, cursor = "") {
    this.requirePersonal(); this.personal.idle();
    if (!tools.some(tool => tool.id === method)) fail("허용되지 않은 Slack 작업입니다.");
    if (typeof cursor !== "string" || cursor.length > 1000 || /[^\x21-\x7e]/.test(cursor)) fail("채널 페이지 위치가 올바르지 않습니다.");
    const config = this.personal.data.slack;
    if (!config?.enabled || !config.encryptedToken) fail("Slack 커넥터가 비활성 상태입니다.");
    if (!this.personal.encryptionAvailable()) fail("OS 보안 저장소를 사용할 수 없습니다.");
    let token;
    try { token = this.personal.safeStorage.decryptString(Buffer.from(config.encryptedToken, "base64")); }
    catch { fail("Slack 토큰을 복호화할 수 없습니다. 다시 등록해 주세요."); }
    const controller = new AbortController();
    this.personal.connectorActive = controller;
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      const form = new URLSearchParams(method === "auth.test" ? {} : { types: "public_channel", exclude_archived: "true", limit: "50", ...(cursor ? { cursor } : {}) });
      const listing = method === "conversations.list";
      const response = await this.fetch(`https://slack.com/api/${method}${listing ? "?" + form : ""}`, { method: listing ? "GET" : "POST", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/x-www-form-urlencoded" }, ...(listing ? {} : { body: form.toString() }) });
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        fail(response.status === 429 ? "Slack 요청 한도에 도달했습니다. 잠시 후 다시 조회해 주세요." : `Slack HTTP ${response.status}: 요청에 실패했습니다.`);
      }
      const data = await boundedJson(response);
      if (data.ok !== true) {
        if (["invalid_auth", "token_revoked", "token_expired", "account_inactive"].includes(data.error)) this.observation = emptyObservation();
        if (data.error === "missing_scope") fail("Slack 권한이 부족합니다. 공개 채널 조회에는 channels:read가 필요합니다.");
        if (["invalid_auth", "token_revoked", "token_expired"].includes(data.error)) fail("Slack 인증이 만료되었거나 유효하지 않습니다.");
        fail("Slack 요청을 완료하지 못했습니다. 앱 권한과 연결을 확인해 주세요.");
      }
      const clean = (value, limit) => typeof value === "string" ? value.replaceAll(token, "[REDACTED]").slice(0, limit) : "";
      if (controller.signal.aborted) fail("Slack 요청이 중단되었습니다.");
      const checkedAt = new Date().toISOString();
      if (method === "auth.test") {
        if (typeof data.team_id !== "string" || !/^T[A-Z0-9]+$/.test(data.team_id) || typeof data.team !== "string") fail("Slack 인증 응답 형식이 올바르지 않습니다.");
        this.observation = { ...this.observation, authenticated: true, team: clean(data.team, 160), teamId: data.team_id, checkedAt };
        return this.state();
      }
      if (!Array.isArray(data.channels) || data.channels.length > 50) fail("Slack 채널 응답 형식이 올바르지 않습니다.");
      const channels = data.channels.map(channel => {
        if (!channel || typeof channel.id !== "string" || !/^C[A-Z0-9]+$/.test(channel.id) || typeof channel.name !== "string") fail("Slack 채널 응답 형식이 올바르지 않습니다.");
        return { id: channel.id, name: clean(channel.name, 160), member: channel.is_member === true };
      });
      const nextCursor = data.response_metadata?.next_cursor || "";
      if (typeof nextCursor !== "string" || nextCursor.length > 1000 || /[^\x21-\x7e]/.test(nextCursor) || nextCursor.includes(token)) fail("Slack 페이지 응답 형식이 올바르지 않습니다.");
      this.observation = { ...this.observation, channelsCheckedAt: checkedAt, channelStatus: "verified" };
      return { channels, nextCursor, checkedAt, connector: this.state() };
    } catch (error) {
      if (method === "conversations.list") this.observation.channelStatus = "failed";
      else this.observation = emptyObservation();
      if (controller.signal.aborted) fail(timedOut ? "Slack 응답 시간이 초과되었습니다." : "Slack 요청을 취소했습니다.");
      if (error instanceof PersonalError) throw error;
      fail("Slack 연결에 실패했습니다. 네트워크와 인증서를 확인해 주세요.");
    } finally { clearTimeout(timer); this.personal.connectorActive = null; token = ""; }
  }
}
module.exports = { SlackConnector };
