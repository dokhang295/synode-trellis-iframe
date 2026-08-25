# Messaging Protocol

The iframe communicates with its parent (host) window using the
[`window.postMessage`](https://developer.mozilla.org/en-US/docs/Web/API/Window/postMessage)
API. All messages are plain objects with the following shape:

```ts
type Message =
  | { type: "generate"; payload: { imageUrl: string } }          // iframe → parent
  | { type: "3dModelGenerated"; payload: { modelUrl: string } }; // parent → iframe
```

## Messages

### 1. `generate` — iframe → parent

Sent when the user clicks **Generate** inside the iframe. The `imageUrl` is a
data URL (base64-encoded) of the selected image, so it is safe to use across
origins.

| Field               | Type     | Description                                            |
| ------------------- | -------- | ------------------------------------------------------ |
| `type`              | `string` | Always `"generate"`.                                   |
| `payload.imageUrl`  | `string` | Data URL of the image the user wants to convert to 3D. |

**Example**

```js
{
  type: "generate",
  payload: {
    imageUrl: "data:image/png;base64,iVBORw0KGgo..."
  }
}
```

### 2. `3dModelGenerated` — parent → iframe

Sent by the parent window once the 3D model has been generated. The iframe
will load and display the model in its preview panel.

| Field               | Type     | Description                                    |
| ------------------- | -------- | ---------------------------------------------- |
| `type`              | `string` | Always `"3dModelGenerated"`.                   |
| `payload.modelUrl`  | `string` | URL of the generated `.glb` model to display. |

**Example**

```js
{
  type: "3dModelGenerated",
  payload: {
    modelUrl: "https://cdn.example.com/models/abc123.glb"
  }
}
```

## Lifecycle

```
 [Parent / Host]                              [Iframe]
      |                                            |
      |  embeds <iframe src="...">                |
      |------------------------------------------->|
      |                                            |
      |  user picks image, clicks "Generate"      |
      |<-------------------------------------------|
      |  postMessage({ type: "generate",           |
      |    payload: { imageUrl } })                |
      |                                            |
      |  parent generates 3D model...             |
      |                                            |
      |  postMessage({ type: "3dModelGenerated",  |
      |    payload: { modelUrl } })                |
      |------------------------------------------->|
      |                                            |
      |                                  displays model
```

## Parent integration example

```html
<iframe
  id="trellis"
  src="https://YOUR-DOMAIN/embed"
  style="width: 100%; height: 100vh; border: 0"
></iframe>

<script>
  const iframe = document.getElementById("trellis");

  // 1. Listen for messages coming FROM the iframe.
  window.addEventListener("message", (event) => {
    if (event.source !== iframe.contentWindow) return; // ignore other senders

    const { type, payload } = event.data ?? {};

    if (type === "generate" && payload?.imageUrl) {
      console.log("Image to convert:", payload.imageUrl);
      generateModel(payload.imageUrl); // your backend call
    }
  });

  // 2. Send the generated model back to the iframe.
  function sendModelToIframe(modelUrl) {
    iframe.contentWindow.postMessage(
      { type: "3dModelGenerated", payload: { modelUrl } },
      "*" // or your specific targetOrigin for better security
    );
  }

  // Example: after your generation completes
  // sendModelToIframe("https://cdn.example.com/models/abc123.glb");
</script>
```

## Security notes

- **Verify the sender.** Always check `event.source === iframe.contentWindow` so
  your handler only reacts to messages from the embedded iframe.
- **Restrict `targetOrigin`.** In production, replace `"*"` with the iframe's
  origin (e.g. `"https://YOUR-DOMAIN"`) to prevent leaking data URLs to other
  origins.
- **Validate the payload.** Confirm `type` and required fields before acting on
  a message.
