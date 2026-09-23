export const MAX_SESSIONS = 20;
export function newSession(id) { return { id, title: "새 대화", messages: [], draft: "" }; }
export function initialSessions(id) { return { selected: id, items: [newSession(id)] }; }

export function conversationInput(messages, text) {
  return [...messages.filter(row => (row.role === 'user' && !['failed', 'pending'].includes(row.state)) || (row.role === 'assistant' && row.state === 'completed'))
    .slice(-22).map(({ role, content }) => ({ role, content })), { role: 'user', content: text }];
}

export function agentSessionsReducer(state, { agentId, action }) {
  if (action.type === "ensure") return state[agentId] ? state : { ...state, [agentId]: initialSessions(action.id) };
  return { ...state, [agentId]: sessionReducer(state[agentId], action) };
}

export function sessionReducer(state, action) {
  if (action.type === "reset") return initialSessions(action.id);
  if (action.type === "create") {
    if (state.items.length >= MAX_SESSIONS || state.items.some(item => item.id === action.id)) return state;
    return { selected: action.id, items: [newSession(action.id), ...state.items] };
  }
  if (action.type === "select") return state.items.some(item => item.id === action.id) ? { ...state, selected: action.id } : state;
  if (action.type === "remove") {
    const items = state.items.filter(item => item.id !== action.id);
    if (items.length === state.items.length) return state;
    if (!items.length) return initialSessions(action.replacementId);
    return { selected: state.selected === action.id ? items[0].id : state.selected, items };
  }
  return { ...state, items: state.items.map(item => {
    if (item.id !== action.id) return item;
    if (action.type === "run") return { ...item, latestRun: action.value };
    if (action.type === "draft") return { ...item, draft: action.value };
    if (action.type === 'recover') {
      const target = item.messages.find(row => row.id === action.messageId && row.role === 'user' && row.state === 'failed');
      if (!target || !['edit', 'remove'].includes(action.mode) || (action.mode === 'edit' && item.draft)) return item;
      const messages = item.messages.filter(row => row.id !== target.id);
      return { ...item, messages, draft: action.mode === 'edit' ? target.content : item.draft,
        title: messages.find(row => row.role === 'user')?.content.trim().slice(0, 80) || '새 대화' };
    }
    if (action.type === "messages") {
      const messages = typeof action.value === "function" ? action.value(item.messages) : action.value;
      const first = messages.find(message => message.role === "user");
      return { ...item, messages, title: first?.content.trim().slice(0, 80) || "새 대화" };
    }
    return item;
  }) };
}
