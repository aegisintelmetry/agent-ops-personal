# Agent Ops Source

- Operator-facing explanations and reports are Korean.
- Never commit secrets, tokens, personal profiles, conversations, logs, or build outputs.
- Personal and Enterprise share product modules; Aegis is Enterprise-only and separate.
- One execution coordinator per local app; agent configurations do not install separate PC runners.
- Do not enable file/command execution or external writes without explicit permission boundaries.
- Preserve unrelated user changes. Do not commit or push without user authorization.
- Production fleet and privileged runner deployment remain owned by btk-agent-harness.
- Product Python code belongs in agent_ops/. Never import or vendor the operational harness package.
- Preserve external enrollment/bundle wire contracts; do not add task dispatch or fleet mutation authority to the read client.
- Verify desktop changes with Node tests, Vite build and native Electron smoke tests.
- Real provider calls consume user quota; use local fixtures unless explicitly requested.
