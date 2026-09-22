# AEGIS Agent Ops Personal

[한국어](README.ko.md) | [Windows download](https://github.com/aegisintelmetry/agent-ops-public-preview/releases/tag/v0.5.10-preview) | [Security](SECURITY.md)

An open-source desktop project by **AEGIS** for working with multiple language models, coordinating text-based agent teams, and keeping explicit local memory.

**Security FDE is our primary focus.** Personal is a project we build in the open, not an enterprise security product or a replacement for our Security FDE work. We welcome individual use and feedback. Future enterprise integration will follow real user needs; it is not required to use Personal.

## What Works Today

- Choose a model connection for each agent and keep conversations separate.
- Organize a coordinator and 1–4 workers in a team tree, delegate text tasks, and combine responses. Up to two workers run concurrently.
- Continue team conversations, inspect progress, and explicitly retry incomplete work.
- Set role prompts and manually maintained memory with shared, team, or agent-specific scope.
- Switch between Korean and English.
- Try a read-only Slack sample for authentication checks and public-channel listing.

For example, one worker can analyze a proposal while another critiques its assumptions, with the coordinator combining their responses. This is model-generated assistance, not independent verification of correctness.

## Install

Download `AEGIS-Agent-Ops-Setup-0.5.10-preview.exe` from the [release page](https://github.com/aegisintelmetry/agent-ops-public-preview/releases/tag/v0.5.10-preview).

1. Install on Windows x64 and open the app.
2. Choose **Personal**. No AEGIS organization account or central server is required.
3. Configure an agent's model connection, then start a conversation or configure a team.

The installer bundles the local core; a separate Python or Node installation is not required to run it. The Codex connection requires a separately installed Codex CLI or VS Code Codex extension.

**This is an unsigned preview**, not a production-ready release.

## Model Connections

| Connection | Current support |
| --- | --- |
| OpenAI, DeepSeek, Kimi, Gemini | Your own API key |
| OpenAI-compatible / local endpoints | Explicitly configured endpoint and model |
| ChatGPT / Codex | Existing per-agent Codex sign-in integration |
| Gemini API OAuth | Shared Google connections; your own Desktop OAuth client is required |

Provider charges and limits apply. A chat subscription is not interchangeable with API access. Gemini OAuth uses the Google Cloud project's API permissions and usage, not a Gemini web subscription. See the [Google connection guide](docs/personal-google-accounts.md).

## Data and Permissions

Credentials and saved prompts/memory use the operating system's encrypted storage. Conversation history is held in memory and is not restored after quitting.

Requests send conversation text and applicable enabled memory/role prompts to the selected model provider. Team objectives and worker results are shared with the coordinator. Agent-specific memory is not directly copied to other agents, but its contents can appear in generated results.

Local storage does **not** mean cloud inference is offline. Do not send confidential information unless the selected provider and your usage are appropriate for it.

## Current Limits

- Text-only assistance: no general file access, shell execution, or autonomous tool execution.
- Memory is manual and keyword-based; no automatic learning, embeddings, or cloud synchronization.
- The Slack sample does not post messages or assign work through Slack.
- Real Google OAuth sign-in/inference and fresh-PC installation need validation beyond automated fixtures.
- No enterprise security guarantees, compliance certification, response-time SLA, or long-term support commitment.
- Organization adapters are present, but private servers and the operational fleet are not included. Personal does not require them.

Automated tests cover local behavior, isolation, UI flows, and packaging. They do not prove model accuracy or every provider/account combination.

## Development

On Windows, install Node.js 22.12+ and Python 3.12 for core development/testing:

```powershell
python -m pip install -r apps/desktop/build-requirements.txt
python -m unittest discover -s tests/desktop
cd apps/desktop
npm ci
npm test
npm run build
npm run test:desktop
npm start
```

Build an installer from the repository root:

```powershell
powershell -NoProfile -File apps/desktop/build-windows.ps1
```

See [contributing](CONTRIBUTING.md) and [Windows CI](https://github.com/aegisintelmetry/agent-ops-public-preview/actions/workflows/desktop-checks.yml).

## History and Scope

This repository preserves **selected product development history**, starting from a licensed 0.5.4 product snapshot. Earlier private operational code and its Git history are deliberately excluded. Later improvements retain their original authorship and change descriptions. See the [history policy](docs/public-history.md).

The source includes `apps/desktop`, the `agent_ops` client/core, and tests. Private Security FDE service implementations, central servers, and operational harnesses are not included. Legacy `BTK_*` identifiers remain for compatibility, not as preconfigured access to internal systems.

## Feedback and Security

Bug reports, focused pull requests, and useful real-world workflows are welcome. Include the app version, Windows version, and reproduction steps without credentials or private conversations.

Report vulnerabilities privately to **contact@aegistelemetry.com**, not in public issues. See [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE). Copyright (c) 2026 aegisintelmetry. Third-party components retain their own licenses; see [NOTICE](NOTICE) and the installer notices. Private services outside this repository are not covered by this license.
