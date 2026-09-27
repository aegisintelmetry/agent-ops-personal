export const MAX_SESSIONS = 20;
export function newSession(id) { return { id, title: "새 대화", messages: [], draft: "" }; }
export function initialSessions(id) { return { selected: id, items: [newSession(id)] }; }

export function conversationInput(messages, text, images = []) {
  const input = [{ role: 'user', content: text, ...(images.length ? { images } : {}) }];
  const attached = new Set(images);
  let imageCount = images.length;
  let length = JSON.stringify([{ role: 'user', content: text }]).length;
  const history = messages.filter(row => row.output !== 'image' && ((row.role === 'user' && !['failed', 'pending'].includes(row.state)) || (row.role === 'assistant' && row.state === 'completed'))).slice(-22);
  // Leave room for role preferences and retrieved memory in the native request limit.
  for (const { role, content, modelContent, images: previous = [] } of history.reverse()) {
    const message = { role, content: modelContent || content };
    length += JSON.stringify(message).length + 1;
    if (length > 80000) break;
    const selected = previous.filter(image => !attached.has(image));
    if (imageCount + selected.length > 5) break;
    if (selected.length) message.images = selected;
    imageCount += selected.length;
    for (const image of selected) attached.add(image);
    input.unshift(message);
  }
  return input;
}

export function agentSessionsReducer(state, { agentId, action }) {
  if (action.type === 'hydrate') return { ...state, ...action.groups };
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
    if (action.type === 'workspace') return { ...item,
      sources: action.value.sources ?? item.sources,
      output: action.value.output ?? item.output,
      imageModel: action.value.imageModel ?? item.imageModel };
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
