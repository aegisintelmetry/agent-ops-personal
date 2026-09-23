const POLICY_VERSION = 'personal-transmission-v1';
const BLOCKED_MESSAGE = '보안 정책으로 전송을 차단했습니다. 인증 정보로 의심되는 내용을 제거한 뒤 다시 요청해 주세요.';
const INVALID_MESSAGE = '대화 입력이 제한을 초과했거나 올바르지 않습니다.';
const patterns = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/i,
];

// Inspect a detached snapshot, not caller-owned objects that can change during auth.
function prepareMessages(messages, { secrets = [], ErrorType = Error } = {}) {
  const reject = (message, code) => {
    const error = new ErrorType(message);
    error.code = code;
    error.policyVersion = POLICY_VERSION;
    throw error;
  };
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 24) reject(INVALID_MESSAGE, 'invalid_input');
  const snapshot = messages.map(row => {
    if (!row || !['user', 'assistant'].includes(row.role) || typeof row.content !== 'string' || !row.content.trim()) reject(INVALID_MESSAGE, 'invalid_input');
    return Object.freeze({ role: row.role, content: row.content });
  });
  if (JSON.stringify(snapshot).length > 100000) reject(INVALID_MESSAGE, 'invalid_input');
  for (const { content } of snapshot) {
    if (patterns.some(pattern => pattern.test(content)) || secrets.some(secret => typeof secret === 'string' && secret.length >= 8 && content.includes(secret))) {
      reject(BLOCKED_MESSAGE, 'transmission_blocked');
    }
  }
  return Object.freeze(snapshot);
}

module.exports = { prepareMessages, POLICY_VERSION, BLOCKED_MESSAGE };
