async function read(method, taskId) {
  const query = taskId ? `?task_id=${encodeURIComponent(taskId)}` : "";
  const response = await fetch(`/api/desktop/${method}${query}`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "로컬 연결에 실패했습니다.");
  return data;
}

export const api = window.btk || {
  native: false,
  snapshot: () => read("snapshot"),
  connection: () => read("connection"),
  readiness: () => read("readiness"),
  setupStatus: () => Promise.resolve({ status: "idle", steps: [] }),
  enroll: () => Promise.reject(new Error("설치는 데스크톱 앱에서만 가능합니다.")),
  install: () => Promise.reject(new Error("설치는 데스크톱 앱에서만 가능합니다.")),
  agentStatus: () => Promise.resolve({ status: "unavailable", heartbeat_status: "unknown" }),
  startAgent: () => Promise.reject(new Error("에이전트 시작은 데스크톱 앱에서만 가능합니다.")),
  task: (taskId) => read("task", taskId),
  chat: () =>
    Promise.reject(
      new Error("대화는 AEGIS Agent Ops 데스크톱 앱에서 사용할 수 있습니다."),
    ),
  cancel: () => Promise.resolve({ cancelled: false }),
  onChat: () => () => {},
  onDisconnect: () => () => {},
};
