# Embedding the Trellis app

## Integration modes

The embedded app can reach the Synode backend in two ways. Both are served by
the same build; the mode is picked from the URL.

| Mode | Query | Who holds the credentials | Who calls the API |
| ---- | ----- | ------------------------- | ----------------- |
| `embed` | `?mode=embed` (default inside an iframe) | The host page (logged-in user session) | The host page |
| `token` | `?mode=token` or any `?embedToken=…` | The app, via an organization embed token | The app |

`embed` is the integration for a customer who already runs the Synode client.
`token` is the integration for a customer who does not want an iframe at all —
a desktop or mobile client uses exactly the same calls.

### `token` mode

```text
  emb_<tokenId>.<secret>            organization embed token, long lived
        |
        |  POST /account/auth/exchange-token   { token }
        v
  { jwt, refresh, expiresIn }       short lived pair, kept in memory only
        |
        +--> POST /media/files/upload                (source image)
        +--> POST /trellis/model-generations/generate
        +--> POST /trellis/model-generations/read    (poll until completed)
```

The embed token reaches the app either as `?embedToken=…` or — preferred, since
it keeps the secret out of browser history and referrers — from the host page in
answer to a `synode:request-token` message.

Configuration (`nuxt.config.js` `env`):

| Variable | Meaning |
| -------- | ------- |
| `SYNODE_API_URL` | API root. Services are reached at `/{service}`; on `localhost` each service uses its own development port instead. |
| `SYNODE_SCOPE` | Default tenant scope when the URL carries none. |
| `ALLOWED_PARENT_ORIGINS` | Comma separated origins allowed to host the app. **Empty disables the postMessage origin checks — local development only.** |

The API origin must also be listed in the backend `CORS_ORIGINS` variable,
otherwise the browser blocks every call.

---

## Messaging protocol

Used by `embed` mode, and by `token` mode for the token handshake. Messages are
plain objects on
[`window.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage):

```ts
type Message = { type: string; payload?: object };
```

Current protocol version: **2**. Version 1 had only `generate` and
`3dModelGenerated`; both sides still interoperate with a v1 counterpart, but a
v1 host cannot report progress or failures.

### iframe → parent

#### `synode:iframe-ready`

Sent once the app has mounted.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `locale` | `string` | Active locale. Also repeated at the top level for v1 hosts. |
| `payload.protocolVersion` | `number` | `2` |
| `payload.locale` | `string` | Active locale |

#### `generate`

Sent when the user presses **Generate**.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `payload.requestId` | `string` | Identifies this request. Echo it back on every answer. |
| `payload.imageUrl` | `string` | Data URL of the source image, safe across origins |
| `payload.fileName` | `string` | Original file name |
| `payload.mimeType` | `string` | Original mime type |

#### `cancel`

| Field | Type | Description |
| ----- | ---- | ----------- |
| `payload.requestId` | `string` | The request to abandon |

#### `synode:request-token`

`token` mode only. Asks the host for the organization embed token. The host
answers with `synode:embed-token`; if nothing arrives within 5 seconds the app
reports a missing token.

### parent → iframe

#### `3dModelGenerated`

| Field | Type | Description |
| ----- | ---- | ----------- |
| `payload.requestId` | `string` | The request being answered. Omit only for v1 hosts. |
| `payload.modelUrl` | `string` | URL of the generated `.glb` |
| `payload.assetId` | `string` | Optional asset library id |
| `payload.versionId` | `string` | Optional asset version id |

#### `generateProgress`

Without this the app shows an indeterminate spinner for the whole job — which
can be fifteen minutes.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `payload.requestId` | `string` | The request being reported on |
| `payload.status` | `string` | `pending` \| `processing` \| `completed` \| `failed` |
| `payload.progress` | `number` | Optional 0–100 |
| `payload.message` | `string` | Optional text, shown as-is |

#### `generateFailed`

**Required.** A host that stays silent on failure leaves the app spinning until
it times out.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `payload.requestId` | `string` | The request that failed |
| `payload.errorCode` | `string` | e.g. `MODEL_GENERATION_FAILED` |
| `payload.errorMessage` | `string` | Message shown to the user |

#### `synode:embed-token`

| Field | Type | Description |
| ----- | ---- | ----------- |
| `payload.token` | `string` | `emb_<tokenId>.<secret>` |
| `payload.scope` | `string` | Tenant scope |

#### `synode:locale`

| Field | Type | Description |
| ----- | ---- | ----------- |
| `locale` | `string` | `en` or `fr`. Also read from `payload.locale`. |

### Lifecycle — `embed` mode

```text
 [Parent / Host]                                   [Iframe]
      |  embeds <iframe src="…/embed">                 |
      |----------------------------------------------->|
      |                                                |
      |<----------------------------------------------- synode:iframe-ready
      |                                                |
      |                       user picks image, presses Generate
      |<----------------------------------------------- generate { requestId, imageUrl }
      |                                                |
      |  upload image -> queue job -> poll             |
      |  generateProgress { requestId, status } ------->|
      |  generateProgress { requestId, status } ------->|
      |                                                |
      |  3dModelGenerated { requestId, modelUrl } ----->| displays model
      |     …or generateFailed { requestId, error } --->| shows the error
```

### Security rules

Both sides enforce these; a host written against this document should too.

- **Check the sender.** The app ignores anything whose `event.source` is not
  `window.parent`; the host must check `event.source === iframe.contentWindow`.
- **Pin the origin.** Set `ALLOWED_PARENT_ORIGINS` in the app and pass the
  iframe origin as `targetOrigin` in the host. `"*"` leaks the source image —
  and, in `token` mode, the embed token — to whatever else is listening.
- **Match the `requestId`.** Answers that carry an unknown id are dropped, so a
  late reply to a superseded request cannot overwrite the preview.
- **Validate the payload.** Confirm `type` and the required fields before acting.
