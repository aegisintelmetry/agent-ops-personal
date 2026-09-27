const MiB = 1024 * 1024;
const { FILE_LIMIT, CSV_LIMIT, IMAGE_LIMIT, EXCERPT_LIMIT, SOURCE_COUNT } = require('../workspace-limits.json');
const TEXT_EXTENSIONS = /\.(txt|md|csv|json|jsonl|yaml|yml|log|py|js|jsx|ts|tsx|html|css|xml|sql|sh|ps1|ini|toml)$/i;
const SOURCE_EXTENSIONS = /\.(txt|md|csv|json|jsonl|yaml|yml|log|py|js|jsx|ts|tsx|html|css|xml|sql|sh|ps1|ini|toml|pdf|docx|zip)$/i;
function fileLimit(name) { return /\.csv$/i.test(name) ? CSV_LIMIT : FILE_LIMIT; }
module.exports = { MiB, FILE_LIMIT, CSV_LIMIT, IMAGE_LIMIT, EXCERPT_LIMIT, SOURCE_COUNT, TEXT_EXTENSIONS, SOURCE_EXTENSIONS, fileLimit };
