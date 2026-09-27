# Personal Google Sign-In Without Client JSON

Version 0.5.18 adds `Google sign-in · Gemini CLI`. It bundles the official
`@google/gemini-cli` 0.61.0 runtime and communicates over its ACP stdio protocol.
No separate Node installation, API key, client JSON, or AEGIS OAuth application
registration is required for this connection. Google account eligibility and
Gemini CLI quotas still apply. Company, school, and some licensed accounts can
require a Cloud project; this release does not add a project configuration form.

## Use

1. Select an agent and open Model connection.
2. Select `Google sign-in · Gemini CLI` and click `Sign in with Google`.
3. Finish Google's consent in the system browser and return to the app.
4. The initial model is `auto`. Save another supported Gemini model ID to override
   it for this agent. The CLI validates model availability when a request runs.
5. On a worker agent, select the same connection. The existing local account is
   shared without another login, while its model, conversations and memory remain
   separate.

One shared Gemini CLI account is supported per app profile. Signing out disconnects
every agent using this connection, after native confirmation. It does not revoke
Google-side consent or affect a standalone Gemini CLI installation. Switch accounts
by signing out first. Cancelling a pending login stops the app-owned CLI process.

`Google Cloud API · OAuth setup` preserves the previous bring-your-own OAuth
client flow. Saved API keys and imported Cloud accounts are not migrated or used
as fallbacks. Gemini CLI sign-in supports text and image analysis, not image
generation. Use a separately configured image API connection for generation.

## Implementation Boundaries

- The official CLI owns authentication, token refresh and provider calls. Its
  OAuth constants are not extracted into this application's code.
- `gemini-cli-home/.gemini/gemini-credentials.json` under this app's Personal data
  directory is the CLI credential authority. UI status reports cached credentials,
  not a live quota or account entitlement check.
- The runtime uses its own encrypted-file storage in that isolated home. This is
  the CLI's file encryption, **not** Electron safeStorage/Windows DPAPI. It must not
  be advertised as equivalent to the other API credential storage. The CLI can
  also retain local session/cache files, separate from the app's encrypted chat
  store. Do not distribute this directory or place it in a repository.
- Inherited provider credentials, project overrides, Node options and IDE session
  variables are not forwarded. CLI home and working directory are app-owned, not
  the selected user workspace. Telemetry, auto-update, hooks, skills, auto-memory
  and built-in tools are disabled. MCP servers are not registered. ACP permission,
  filesystem and terminal requests are denied.
- Credentials are shared but conversations are not: each request creates a new
  ACP session with only the selected conversation and the app's approved memory.
  The shared runtime serializes simultaneous requests. Processes stop after each
  request so worker agents do not leave idle CLI instances running.
- Existing model-message transmission checks run before CLI startup. This is not
  a claim to intercept OAuth, all CLI network traffic, or Google's telemetry
  independently of the CLI implementation.
- The CLI model `auto` chooses a model according to account availability. A model
  name shown in the app is the requested ID, not verified server-side usage.

## Verification

Node tests cover lazy startup, isolated environment, login/cancel, concurrent
session isolation, per-agent models, denied tool/file requests, cancellation,
failed turns, and image generation rejection. Electron fixtures exercise the
button-only login flow, shared worker login, chat, restart, logout, Korean/English
and desktop/narrow layouts. The actual bundled CLI initializes over ACP without
requesting authentication or a model response. Login completion and model responses
in automated UI tests are fixtures, not real Google-account validation.

Actual Google consent, account eligibility, quota and model calls need user testing.
Do not downgrade to a version that predates this connection without switching the
affected agents to a supported connection first.

## References

- [Official Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/)
- [Official Gemini CLI ACP integration](https://geminicli.com/docs/cli/acp-mode/)
- [Gemini CLI source](https://github.com/google-gemini/gemini-cli)
