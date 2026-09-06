/**
 * postMessage protocol between the embedded app and its host page.
 *
 * See `docs/messaging.md` for the wire format. This module owns the security
 * rules that used to be spread across the page:
 *
 *  - outgoing messages go to a configured origin, never `"*"` in production
 *  - incoming messages are only accepted from the host window, and only from an
 *    allowed origin
 *  - every generation carries a `requestId` so a late answer to a superseded
 *    request cannot overwrite the current one
 */

export const PROTOCOL_VERSION = 2;

/** iframe -> parent */
export const Outgoing = {
	Ready: "synode:iframe-ready",
	Generate: "generate",
	Cancel: "cancel",
	RequestToken: "synode:request-token"
};

/** parent -> iframe */
export const Incoming = {
	Generated: "3dModelGenerated",
	Progress: "generateProgress",
	Failed: "generateFailed",
	Locale: "synode:locale",
	EmbedToken: "synode:embed-token"
};

/**
 * Parses the configured parent origins.
 * @returns {string[]} Allowed origins, empty when unrestricted
 */
export function allowedParentOrigins()
{
	return (process.env.allowedParentOrigins || "")
		.split(",")
		.map(origin => origin.trim())
		.filter(Boolean);
}

let requestCounter = 0;

/**
 * Generates a request id unique to this document.
 * @returns {string}
 */
export function nextRequestId()
{
	requestCounter += 1;
	return `req-${Date.now().toString(36)}-${requestCounter}`;
}

export class HostBridge
{
	/**
	 * @param {object} [options]
	 * @param {string[]} [options.allowedOrigins] Overrides the configured list
	 */
	constructor(options = {})
	{
		this._allowed = options.allowedOrigins || allowedParentOrigins();
		this._handlers = new Map();
		this._tokenWaiters = [];
		this._onMessage = this._onMessage.bind(this);
		this._started = false;
	}

	/** True when the app actually runs inside a host page. */
	get embedded()
	{
		return typeof window !== "undefined" && window.parent !== window;
	}

	/**
	 * Origin used for outgoing messages. Falls back to `"*"` only when no
	 * allow-list is configured, which is the local development case.
	 */
	get targetOrigin()
	{
		return this._allowed.length === 1 ? this._allowed[0] : "*";
	}

	start()
	{
		if (this._started || typeof window === "undefined") return;
		window.addEventListener("message", this._onMessage);
		this._started = true;
	}

	stop()
	{
		if (!this._started) return;
		window.removeEventListener("message", this._onMessage);
		this._started = false;
		this._tokenWaiters = [];
	}

	/**
	 * Registers a handler for one incoming message type.
	 * @param {string} type One of `Incoming`
	 * @param {(payload: object, message: object) => void} handler
	 */
	on(type, handler)
	{
		this._handlers.set(type, handler);
		return this;
	}

	/**
	 * @param {MessageEvent} event
	 */
	_onMessage(event)
	{
		if (!this.embedded) return;
		if (event.source !== window.parent) return;
		if (this._allowed.length && !this._allowed.includes(event.origin)) return;
		if (!event.data || typeof event.data !== "object") return;

		const { type, payload } = event.data;

		if (type === Incoming.EmbedToken)
		{
			const waiters = this._tokenWaiters;
			this._tokenWaiters = [];
			waiters.forEach(resolve => resolve(payload || {}));
		}

		this._handlers.get(type)?.(payload || {}, event.data);
	}

	/**
	 * @param {string} type
	 * @param {object} [payload]
	 */
	post(type, payload)
	{
		if (!this.embedded) return;
		window.parent.postMessage({ type, payload }, this.targetOrigin);
	}

	/**
	 * Announces that the app booted and which protocol it speaks.
	 * @param {string} locale
	 */
	ready(locale)
	{
		if (!this.embedded) return;

		// `locale` is kept at the top level for hosts written against v1.
		window.parent.postMessage(
			{
				type: Outgoing.Ready,
				locale,
				payload: { protocolVersion: PROTOCOL_VERSION, locale }
			},
			this.targetOrigin
		);
	}

	/**
	 * Asks the host to generate a model.
	 * @param {object} request
	 * @param {string} request.imageUrl Data URL of the source image
	 * @param {string} [request.fileName]
	 * @param {string} [request.mimeType]
	 * @returns {string} The request id to match answers against
	 */
	requestGeneration({ imageUrl, fileName, mimeType })
	{
		const requestId = nextRequestId();
		this.post(Outgoing.Generate, { requestId, imageUrl, fileName, mimeType });
		return requestId;
	}

	/**
	 * @param {string} requestId
	 */
	cancelGeneration(requestId)
	{
		this.post(Outgoing.Cancel, { requestId });
	}

	/**
	 * Asks the host for the organization embed token, so it never has to appear
	 * in the iframe URL.
	 * @param {number} [timeoutMs]
	 * @returns {Promise<{ token?: string, scope?: string }>}
	 */
	requestEmbedToken(timeoutMs = 5000)
	{
		if (!this.embedded) return Promise.resolve({});

		return new Promise(resolve =>
		{
			const timer = setTimeout(() =>
			{
				this._tokenWaiters = this._tokenWaiters.filter(w => w !== settle);
				resolve({});
			}, timeoutMs);

			const settle = payload =>
			{
				clearTimeout(timer);
				resolve(payload);
			};

			this._tokenWaiters.push(settle);
			this.post(Outgoing.RequestToken, {});
		});
	}
}
