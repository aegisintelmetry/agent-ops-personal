# Gemini Login Session Review

## Reference Flows

- [Gemini CLI authentication](https://geminicli.com/docs/get-started/authentication/):
  Google browser sign-in and locally cached credentials; API-key and Vertex AI
  authentication are separate choices. CLI subscription access is not equivalent
  to this application's direct Google Cloud OAuth API connection.
- [Eigent BYOK](https://www.eigent.ai/docs/byok): Gemini provider setup uses an
  API key, endpoint and model. This is not evidence that an arbitrary Gemini
  website session can be reused for inference.
- [Google native OAuth](https://developers.google.com/identity/protocols/oauth2/native-app):
  external browser, PKCE and desktop loopback callback. An embedded login webview
  or copying another application's credentials is not the integration used here.

## Findings and Changes

The imported account was selected only in component memory until model settings
were saved. Reopening settings could hide its login controls, including during an
active browser authorization. Settings now select the pending account first, then
the saved selection or the first available account.

The main process previously awaited the OS browser launch with no separate recovery
action. It now returns the active login session immediately, bounds the browser
opening indicator, and allows reopening the same PKCE authorization session. The
URL and credentials remain in the main process. Cancellation and the overall login
timeout still close the loopback listener and reject late authorization results.

An invalid refresh grant or API 401 now marks the account as requiring sign-in,
persisted across restart. Transient refresh network failures do not revoke the
saved account. Successful authorization clears the reauthentication state.

## Verification Scope

Tests use isolated encrypted fixture profiles and simulated Google browser/token
responses. They cover remounting, reopening, cancellation, refresh revocation,
account sharing across independent agent models, and restart/removal. They do not
prove that a user's Google OAuth consent configuration, billing, API enablement or
live credentials are valid. No real provider inference is performed.
