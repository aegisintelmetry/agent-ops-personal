# AEGIS Agent Ops Desktop Preview

Windows-first desktop client over the independent `agent_ops` product core. Version 0.5.5 includes
the Agent Ops workspace layout, centered composer and independent in-memory chat
sessions. Sessions and drafts survive navigation, not app restart. The UI does
not create a persistent session archive; submitted messages and selected history
still go through the configured chat backend. At most 20 sessions are retained without silently
discarding history. Switching profiles clears chat state. Inference remains a
role of the same runner, not a separate installed product.

It retains 0.4.3's handling of
EPIPE on inherited stdout/stderr so a closed GUI launcher pipe does not open an
uncaught-exception dialog while reporting an IPC error. Other errors remain visible.
It retains 0.4.2's immediate, redacted CLI policy errors instead of silent bridge
timeouts, and distinguishes central-server input from the returned MCP endpoint.
It retains 0.4.1's central deployment reporting and bounded service verification.
It remains an
unsigned local preview; a clean-PC installation against the real central server
has not yet been validated.

## Personal Preview

The source preview now starts with a Personal / Enterprise selector. Personal
does not query the central profile registry or start the Python enterprise bridge.
Enterprise keeps the existing enrollment and runner workflow. A mode switch is a
local UI preference, not enterprise authentication or a permission grant.

Personal supports text chat through OpenAI Chat Completions, custom compatible
HTTPS endpoints, or loopback-compatible local models. Model IDs are user supplied.
Native Anthropic/Gemini protocols, tool execution, streaming, durable conversation
history, automation and multi-agent dispatch are not implemented in this phase.
Selecting a working folder only records its path; no files are read or uploaded.

The authority for personal preferences and the encrypted key is
`<Electron userData>/agent-ops-personal/personal.json`, outside the repository.
The renderer receives metadata and a key-present boolean, never the saved key.
Windows encryption uses Electron safeStorage (DPAPI); no plaintext fallback is
allowed. This is not protection against malicious software running as the same
OS user. A key belongs to the exact provider and endpoint. Changing either needs
a new key; moving to an unauthenticated local model drops the previous key.
No environment credentials or enterprise bearer tokens are reused.

Saving sends no model request. A connection test requires a native confirmation,
sends a short fixture prompt and can incur provider charges. Chat sends only the
entered conversation and selected recent history to the configured endpoint.
HTTP is restricted to loopback; redirects are not followed. Output caps are token
limits, not monetary budget guarantees. Usage is shown only when returned by the
provider. Cancelling aborts the client request but cannot promise provider billing
or computation has stopped. Sessions remain in memory and are cleared on mode,
workspace or saved model configuration changes and app exit.

Verification: `node --test tests/*.test.cjs`, `node tests/personal-smoke.cjs`,
`node tests/personal-responsive.cjs`, `node tests/workspace-smoke.cjs`.
Smoke scripts use `PLAYWRIGHT_PATH` when Playwright is installed outside this app.
Native tests use the real OS encrypted storage and a mock loopback model, not
an actual provider account. Browser layout tests use a fixture bridge.
Existing installer files do not include these changes until rebuilt and tested.

### Summary and Slack Sample

Personal now has a collapsible run summary with per-session request progress,
configured agent, skill/tool availability and empty artifact states. These are
local request observations, not central mission completion or QA decisions.

The Slack connector is a direct read-only Web API integration, not an MCP server.
Its shared allowlist/catalog is `electron/slack-tools.json`: `auth.test` and
`conversations.list` for public channels. Bot tokens are stored with OS encryption
in the existing personal preferences. A sample-view toggle shows clearly marked
fixture channels without credentials or network calls. Real calls require an
explicit click, and public channel listing requires `channels:read`.
Model-initiated Slack calls, message sending, OAuth onboarding and automatic
upload of Slack content to a model are not implemented.
See `docs/agent-ops-slack-connector.md` in the repository for boundaries and setup.

## Windows Installer

Build from `apps/desktop` after `npm ci`:

```powershell
powershell -NoProfile -File .\build-windows.ps1
```

Output: `release/AEGIS-Agent-Ops-Setup-0.5.5-preview.exe` (Windows x64, NSIS).

The language selector on the edition screen and app toolbar supports Korean and
English. The desktop main process owns `userData/ui-preferences.json`; renderer
state is derived from that preference at startup and after a successful save.
Browser-only previews use their own localStorage instead. Language changes do
not alter model profiles, credentials, conversations, or upstream source text.

The product is licensed under Apache-2.0 with copyright held by aegisintelmetry.
Packages include `resources/LICENSE`, `resources/NOTICE`, and the existing
`resources/THIRD-PARTY-NOTICES.txt`. Public release remains pending the rights
and history review described in `docs/public-release.md` at the repository root.
The build uses an isolated `.build-venv`; it does not modify the operational
Python environment. `-Unpacked` builds only the unpacked application.
Use `-OutputDirectory release-preview` while another unpacked preview is running.
Smoke tests accept its executable path through `BTK_DESKTOP_TEST_EXE`.

- Per-user installation, no elevation or automatic launch after setup. The
  installer is unsigned; it is a local preview, not a trusted publisher release.
- Electron UI and a frozen Python core are bundled. Installed launch does not
  require Node or Python on PATH, or a development checkout to boot.
- Existing CLI profiles and workspaces are read in place. No profiles, tokens,
  runner roster, workspace data or task results are copied into the installer.
- In Enterprise mode, a fresh profile opens installation checks with registration pending. The
  desktop does not inherit the CLI's legacy default runner identity.
- Installation checks remain read-only. The separate native setup actions require
  an OS confirmation dialog. The browser and model chat cannot invoke them.
  A detected CLI is not proof of authentication; process presence is not proof
  of runner liveness.
- Core file hashes plus version/protocol/build handshake detect packaging
  mismatches. An unsigned manifest is not a publisher trust or update mechanism.
  Packaged launch never falls back to development Python if verification fails.
- The manifest is `local-preview` / `fleet_bundle: not_published`. The published
  fleet bundle pointer remains the authority for fleet code.

## Online Setup

1. In the web console, create/publish a profile for the actual PC hostname and
   provision its engine credentials. In the native app's installation screen,
   enter the central HTTPS URL, profile ID and optional one-time bootstrap code.
   This reuses `/api/harness/orchestration/control/console-auth`; it does not add
   or change a central API. No fleet profile is created by the desktop.
2. Confirm profile connection. The client checks active status, hostname, session
   binding, explicit runner/team identity and conflicting environment variables.
   Credentials go through existing CLI restricted-file storage and never return
   to the renderer. An unrelated existing profile is preserved.
   Before installing anything, the client uses the provisioned `BTK_BACKEND_TOKEN`
   with the existing `/api/hosts/{hostname}/enroll` and `/api/deploy/{id}/progress`
   APIs. The server must authorize this credential for profile writes. A missing
   credential or 401/403 stops installation; no actor-only retry, approval forging
   or reuse of the MCP bearer for a different API is performed. Host enrollment
   is idempotent and its `deploy_id` is displayed with acknowledged stage events.
3. Confirm service installation. The client resolves the authoritative
   `runs/btk-cli-latest/upload/latest.json` pointer, validates wrapper/ZIP hashes
   and sizes, rejects unsafe archive paths, and requires all service entry points.
   Both credential enrollment and executable bundle delivery require HTTPS.
4. Missing Python 3.12, Git and the selected engine are installed through fixed
   WinGet package IDs. Codex uses official npm distribution with user prefix
   after Node installation. WinGet's publisher/hash checks and Windows UAC are
   not bypassed. PyYAML 6.0.3 is installed into the runtime venv. This is an
   **online installer**, not an offline bundle of every third-party dependency.
5. The published install script runs with `-SkipConfig -SkipVerify -NoPathUpdate`
   in `%LOCALAPPDATA%/BTK/agent/workspaces/<profile>`. The client then separately
   verifies imports, required service files and the runner's hostname binding.
   No existing checkout is overwritten. Failures preserve files; a matching
   owned-attempt record permits retry without deleting the workspace.
6. Optional service start calls the existing supervisor with exactly the selected
   runner. A running legacy service, an unknown process scan, a halt or a stop
   marker blocks activation. No `-Force`, cross-profile override, broad process
   kill, git sync or independently spawned daemon is added by the desktop.
7. Optional login autostart uses one user Startup shortcut. It runs the windowless
   `btk-agent-runtime.exe --run-agent`, which rechecks ownership/host/code and
   does not download or re-enroll anything. App uninstall removes only its own
   matching shortcut. It preserves runtime workspace, credentials and already
   running services; it is not a service/data purge.
8. Requested startup is checked for up to 90 seconds. A new, workspace-bound
   supervisor report must account for required components; the owner's Windows Job
   must contain their live processes even after intermediate launchers exit;
   central heartbeat must be fresh
   and newer than this start attempt. Missing scripts, child exits, stale reports
   or failed probes produce `partial`, not a full installation success. Polling
   ends after this check; no permanent verification daemon is added. This check
   does not prove a task has been consumed and executed successfully.

Existing operational PCs are intentionally not migrated by overwriting or stopping
their services. This flow targets newly enrolled PCs in the managed workspace.
Its dependencies include WinGet, internet access, centrally provisioned credentials,
a compatible published bundle and a published runner profile bound to the hostname.
It does not silently clone an unpublished checkout when central delivery fails.

An installation receipt under `runs/desktop-install/` is derived from the published
pointer and measured local code hashes. Reinstall/verification rebuilds it; it is
not an authority for fleet version, runner liveness or task state. Changes to the
verified code require revalidation before this autostart path will execute it.
The in-window setup progress is an operation report, not a second task database.

The installed services use the transport shipped in the published bundle. The
current source uses polling; **SSE migration is not implemented by this installer**.
Desktop chat is still the separate read-only Claude adapter, not an A2A console.

## Background Lifetime And Resources

- The new GUI-subsystem runtime executable has no console window. Desktop Python
  subprocesses use a windowless launch policy, including nested CLI helpers.
  Installer UAC and required interactive authentication are not bypassed.
- The native start action starts only a verified, managed installation. The runtime
  owns the published supervisor; no manually running legacy daemon is needed.
  This reuses fleet behavior rather than implementing a competing task consumer.
- A per-user/session named mutex rejects duplicate owners. A Windows Job contains
  the owner and all descendants, so owner exit reclaims only its own process tree.
  Existing services are never adopted or killed. If the supervisor exits, the
  owner reports the exit and cleans up; it does not silently clear halts or retry.
- UI close releases Electron and its private bridge; the separately started runtime
  remains alive. Login autostart is opt-in. User logout ends this per-user runtime;
  this is not yet a machine-wide Windows Service running before user login.
- The owner waits on its supervisor's process handle, with no heartbeat/CIM polling
  loop of its own. UI process observations are coalesced for three seconds and carry
  their original timestamp. Activation guards always perform a fresh process scan.
  Runtime-view refresh pauses while hidden and has no background timer off that view.
- The UI disables hardware acceleration for its non-WebGL control surfaces. Memory
  measurements use private bytes, not summed working sets, and separate test-launcher
  overhead. No runner heartbeat, task consumer or executor is disabled to lower RAM.
- `runtime/status.json` under the managed root is derived diagnostic output. Process
  PID, creation time and the OS mutex determine local liveness. This file is not task
  state, a central runner heartbeat, or proof that all service components are healthy.
  It is rebuilt when the host starts and never authorizes execution by itself.
  Setup verification uses the read-only [Windows Job process query](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-queryinformationjobobject).

Verified locally: isolated Windows Job cleanup, package boot, GUI subsystem,
native-action cancellation, hidden-process policy and UI memory release.
Still unverified: real central enrollment-to-task execution, full published service
tree under the Job, restart/login, clean-PC install/uninstall, and production load.
The desktop links setup to the ProfileDB deployment ledger and reports measured
progress, including skipped options and incomplete startup. That ledger is distinct
from `/api/harness/orchestration/deploy/{id}`, which belongs to a server-runner task;
the desktop does not claim that task or overwrite its artifacts. The existing
server authorization still applies; local confirmation is not a central approval.

Installer sources: [WinGet installation options](https://learn.microsoft.com/en-us/windows/package-manager/winget/install),
[Claude Code installation](https://code.claude.com/docs/en/setup),
[Codex CLI](https://developers.openai.com/codex/cli), and the
[Node LTS WinGet manifest](https://github.com/microsoft/winget-pkgs/blob/master/manifests/o/OpenJS/NodeJS/LTS/24.19.0/OpenJS.NodeJS.LTS.installer.yaml).

## Run

Personal prerequisites: Node.js 22.12+ and npm. No fleet checkout or central
profile is required. Enterprise development and Windows packaging additionally
require Python 3.12 and the dependencies in `build-requirements.txt`.

```powershell
cd apps/desktop
npm ci
npm run build
npm start
```

Browser inspection, **read-only**, bound only to loopback:

```powershell
powershell -NoProfile -File .\start.ps1 -Preview
```

The default preview URL is `http://127.0.0.1:4380`; Vite chooses another port if
occupied. Native chat is intentionally unavailable over this HTTP preview.
Restart the dev server after Python core or CommonJS bridge changes.

Native Windows regression tests use this repository's pinned Playwright dependency:

```powershell
npm test
npm run test:desktop
```

These tests launch Electron with disposable profiles and local fixtures, not paid
provider requests. They do not require a separate repository or browser download.

## Boundaries

- Electron's sandboxed renderer has no Node, shell, filesystem or credential API.
- The main process validates the exact sender frame and owns a private Python
  stdio bridge. Read methods, chat/cancel and three narrow setup methods are
  accepted. Setup enrollment/install additionally require native confirmation.
- No second supervisor, runner, responder, task consumer or task database is
  created alongside existing services. A newly enrolled PC may activate its one
  supervisor only after explicit setup. Closing the window stops only the app
  bridge and its own chat turn; closing during installation is prevented.
- Profiles and chat defaults come from `harness.cli.config`. Model settings are
  displayed, not copied into a second settings store. There is no engine fallback.
- Chat reuses `ClaudeCodeChatBackend` with no tools, safe mode, no hooks/plugins,
  strict empty MCP configuration, no session persistence and a neutral cwd.
  Only the read-only context supplied by the app is available. CLI authentication
  stays local. Auth failures are surfaced, not interpreted as successful replies.
- Other engines, including Codex, fail closed until their desktop permission
  adapters are implemented and tested. This preview does not change the master
  runner's model. It is not a remote MASTER conversation.
- Completed responses are redacted before publication; generation status is live.
  Chat stays in window memory, with no new persistent session authority.
- Browser preview cannot send messages or cancel native turns. Cross-origin and
  unexpected Host requests are rejected. No remote content or external navigation.

## State Authority

| Displayed fact                  | Authority                                      | Rebuild                                   |
| ------------------------------- | ---------------------------------------------- | ----------------------------------------- |
| Local task status/reason        | `runs/<task>/status.json`                      | Refresh reads the latest 60 local records |
| Result/test/change detail       | Allowlisted files in the same run directory    | Reopen detail                             |
| Runner status and heartbeat age | `runner.heartbeat.list`                        | Connection refresh                        |
| Identity/model selection        | Existing CLI configuration and runner registry | Refresh                                   |

Snapshots carry `observed_at` and `authority`. There is no persistent task cache.
Missing evidence is `unknown`, not an inferred online/completed state. A local
history is not the complete fleet history. Tasks are not dispatched from this UI.

## Verification

```powershell
python -B -m unittest discover -s tests/desktop -v # from repo root
npm test                                      # from apps/desktop
npm run build
```

Playwright smoke tests use a locally installed Playwright module, or an absolute
module path in `PLAYWRIGHT_PATH`. Run from `apps/desktop`:

```powershell
node tests/smoke.cjs                      # running loopback preview at port 4380
node tests/smoke.cjs --native             # source Electron app after build
node tests/package-smoke.cjs              # unpacked EXE after dist:win
node tests/stdio-smoke.cjs                # BTK_DESKTOP_TEST_EXE required; closed log pipes
node tests/smoke.cjs --packaged --live-chat # real bundled core + local Claude
```

Package smoke launches fresh and existing profiles outside the checkout with
Node/Python removed from PATH, verifies the bundled core and renderer isolation,
and captures screenshots under ignored `artifacts/`. It does not run the NSIS
installer or claim install/uninstall validation on a clean Windows machine.
`--live-chat` on the native smoke test additionally makes a real model request
using existing local authentication and tests cancellation.

Electron security follows the [official security checklist](https://www.electronjs.org/docs/latest/tutorial/security).
The shared-core product direction references [Hermes Desktop](https://hermes-agent.nousresearch.com/docs/user-guide/desktop).

## Next Release Gates

Real central enrollment + clean Windows install/uninstall validation, signed
installer/update delivery, existing-PC migration, shared durable chat sessions,
additional desktop chat adapters, governed action/approval UI and SSE/A2A console
integration remain release gates. Building/testing this preview does not deploy
to the fleet or register startup on the developer's PC. Central API/schema and
production prompts remain unchanged.
