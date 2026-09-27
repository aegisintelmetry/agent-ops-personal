# Personal Image Workspace

Implemented for 0.5.17. This document does not imply a published release or live
provider validation. Existing model credentials and per-agent session boundaries
are reused; no new account, runner or background service is created.

## Analysis

Attach PNG, JPEG or WebP and send a question in Chat or document mode. The native
confirmation identifies the destination, model and image count. Declining sends
nothing. OpenAI-compatible providers receive image_url content parts, Google
OAuth receives inlineData parts, and Codex receives image input items. The selected
model must actually support vision; provider entitlement and model errors remain
errors rather than silently falling back to text-only calls.

Successful image turns remain in the same agent's bounded conversation context.
Repeated image bytes are deduplicated in subsequent requests. Failed requests are
excluded. Images are not extracted from attached PDF/DOCX files.

## Generation

Choose Generate image, select an image model ID, enter a prompt, and approve the
native confirmation. One image is requested. The chat model setting is unchanged.

| Connection | Generation path | Default model |
| --- | --- | --- |
| OpenAI API key | /images/generations | gpt-image-1.5 |
| Gemini API key | generateContent, TEXT/IMAGE output | gemini-3.1-flash-image |
| Google OAuth | generateContent with the selected account/project | gemini-3.1-flash-image |
| Compatible/local | /images/generations, base64 PNG response required | User-selected |
| ChatGPT/Codex login | Not implemented; API credentials are not substituted | None |
| Google/Gemini CLI login (0.5.18) | Not implemented; image analysis only | None |
| Other preset providers | Not enabled | None |

OpenAI-compatible image generation must accept n=1, size=1024x1024 and
output_format=png. Gemini uses its default output size. Other compatible API
implementations may reject these options. Google OAuth still uses the Google
project's Gemini API access/billing; a consumer subscription is not treated as
API credit. Model availability is provider/account-dependent.

Generated images appear in both the conversation and Outputs panel. Download
opens a native Save As dialog; only that selected image path is written. No URL
returned by a provider is fetched. Credentials never enter renderer state.

## Persistence and Boundaries

- Sources: at most 5 images/request, 2 MiB per image, 16 million decoded pixels.
- Result: one PNG/JPEG/WebP, up to 4 MiB and 16 million decoded pixels.
- Generation response JSON is limited to 6 MiB. Existing cancellation and timeout
  behavior apply; cancellation does not guarantee the provider refunds usage.
- Workspace limit: 32 MiB serialized data, encrypted with OS storage. Images,
  per-session image-model choices, drafts and results survive restart. A full
  store reports an error rather than silently deleting conversations.
- Text secret-pattern protection remains enabled. Image contents, embedded text
  and metadata are not automatically inspected for sensitive information.
- No remote image URLs, SVG, automatic folder reads, tool execution or publishing.
- This implements image understanding and text-to-image generation, not masking,
  image-to-image editing or a dedicated OCR/document-layout pipeline.
- Before downgrading to 0.5.16, export needed images: its workspace schema does not
  understand image output messages. It preserves unreadable storage rather than
  overwriting it.

## Verification

`npm test`, `npm run test:desktop`, and `node tests/image-ui-smoke.cjs` exercise
fixture provider payloads, refusals/errors, consent/cancel, pixel rendering,
exact-byte image saving, encrypted restart and English/mobile UI. Set
BTK_DESKTOP_TEST_EXE to test the packaged executable. No real provider quota is
used by these tests. Live model access, quality and usage must be tested using
an explicitly selected authorized account.

## Official References

- [OpenAI vision](https://developers.openai.com/api/docs/guides/images-vision)
- [OpenAI image generation](https://developers.openai.com/api/docs/guides/image-generation)
- [Gemini generateContent images](https://ai.google.dev/gemini-api/docs/generate-content/image-generation)
- [Codex image input items](https://learn.chatgpt.com/docs/app-server)
