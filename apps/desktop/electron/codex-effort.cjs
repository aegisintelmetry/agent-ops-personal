const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const validEffort = value => value === '' || EFFORTS.has(value);
function effortMetadata(model) {
  if (!Array.isArray(model.supportedReasoningEfforts)) return {};
  const reasoningEfforts = [...new Set(model.supportedReasoningEfforts.map(item => item?.reasoningEffort).filter(value => EFFORTS.has(value)))];
  return { reasoningEfforts, defaultReasoningEffort: reasoningEfforts.includes(model.defaultReasoningEffort) ? model.defaultReasoningEffort : '' };
}
function supportsEffort(model, effort) {
  return validEffort(effort) && (effort === '' || Boolean(model?.reasoningEfforts?.includes(effort)));
}
module.exports = { validEffort, effortMetadata, supportsEffort };
