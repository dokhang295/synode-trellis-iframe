/**
 * Direct access to the Synode API from the embedded app.
 *
 * Used by the `token` mode, where the app owns its own credentials instead of
 * relaying every call to the host page through postMessage. The same code path
 * is what a desktop or mobile client would use:
 *
 *   embed token (long lived, one per organization)
 *     -> POST /account/auth/exchange-token
 *     -> short lived { jwt, refresh } pair
 *     -> POST /media/files/upload, /trellis/model-generations/*
 *
 * The embed token itself never leaves this module, and the exchanged pair is
 * only kept in memory so a page reload always re-exchanges.
 */

/**
 * In development every service listens on its own port, in production they all
 * sit behind a single host under `/{service}`.
 */
const DEV_SERVICE_PORTS = {
	account: 51401,
	media: 51408,
	trellis: 51415
};

const LOCAL_HOSTS = ["localhost", "127.0.0.1"];

/** Re-exchange this many seconds before the access token actually expires. */
const REFRESH_MARGIN_SEC = 60;

/** Status values mirroring the trellis service `ModelGenerationStatus` enum. */
export const GenerationStatus = {
	Pending: "pending",
	Processing: "processing",
	Completed: "completed",
	Failed: "failed"
};

/**
 * Resolves the base URL of one backend service.
 * @param {string} service Service name, e.g. `account`
 * @returns {string} Base URL without a trailing slash
 */
export function serviceBaseUrl(service)
{
	const configured = (process.env.synodeApiUrl || "").replace(/\/+$/, "");

	if (!configured)
	{
		throw new Error("synodeApiUrl is not configured");
	}

	try
	{
		const url = new URL(configured);

		if (!url.port && LOCAL_HOSTS.includes(url.hostname) && DEV_SERVICE_PORTS[service])
		{
			url.port = String(DEV_SERVICE_PORTS[service]);
			return `${url.origin}/${service}`;
		}
	}
	catch (err)
	{
		// Relative base (e.g. behind a reverse proxy) — use it as-is.
	}

	return `${configured}/${service}`;
}

/**
 * Error carrying the backend error code so the UI can map it to a translation.
 */
export class SynodeApiError extends Error
{
	constructor(message, code, status)
	{
		super(message);
		this.name = "SynodeApiError";
		this.code = code;
		this.status = status;
	}
}

export class SynodeApi
{
	/**
	 * @param {object} options
	 * @param {string} options.embedToken Opaque `emb_<id>.<secret>` token
	 * @param {string} [options.scope] Tenant scope sent with every message
	 */
	constructor({ embedToken, scope })
	{
		this._embedToken = embedToken;
		this._scope = scope || "";
		this._session = null;
		this._pending = null;
	}

	get scope()
	{
		return this._scope;
	}

	/**
	 * Exchanges the embed token for a short lived JWT pair. Concurrent callers
	 * share the same in-flight exchange.
	 * @returns {Promise<string>} The access token
	 */
	async accessToken()
	{
		if (this._session && this._session.expiresAt - REFRESH_MARGIN_SEC * 1000 > Date.now())
		{
			return this._session.jwt;
		}

		if (!this._pending)
		{
			this._pending = this._exchange().finally(() =>
			{
				this._pending = null;
			});
		}

		return this._pending;
	}

	async _exchange()
	{
		if (!this._embedToken)
		{
			throw new SynodeApiError("Missing embed token", "MISSING_EMBED_TOKEN");
		}

		const response = await fetch(`${serviceBaseUrl("account")}/auth/exchange-token`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ token: this._embedToken })
		});

		const body = await response.json().catch(() => ({}));

		if (!response.ok)
		{
			throw new SynodeApiError(
				body.message || "Unable to exchange the embed token",
				body.message === "invalid_embedded_token" ? "INVALID_EMBED_TOKEN" : "EXCHANGE_FAILED",
				response.status
			);
		}

		const data = body.data || body;

		if (!data.jwt)
		{
			throw new SynodeApiError("Exchange did not return a token", "EXCHANGE_FAILED");
		}

		this._session = {
			jwt: data.jwt,
			refresh: data.refresh,
			// `expiresIn` is in seconds; fall back to a conservative minute.
			expiresAt: Date.now() + (Number(data.expiresIn) || 60) * 1000
		};

		if (!this._scope && data.scope)
		{
			this._scope = data.scope;
		}

		return this._session.jwt;
	}

	/**
	 * Drops the cached pair so the next call exchanges again. Called when the
	 * backend rejects a token that looked valid.
	 */
	invalidate()
	{
		this._session = null;
	}

	/**
	 * Posts a `MessageDto` shaped payload to a service endpoint.
	 * @param {string} service Service name
	 * @param {string} path Endpoint path, e.g. `model-generations/generate`
	 * @param {object} data Message data
	 * @returns {Promise<object>} The `data` property of the response
	 */
	async message(service, path, data)
	{
		const send = async () =>
		{
			const jwt = await this.accessToken();

			return fetch(`${serviceBaseUrl(service)}/${path}`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Bearer ${jwt}`
				},
				body: JSON.stringify({
					sender: "synode-trellis-iframe",
					scope: this._scope,
					sent: new Date(),
					data
				})
			});
		};

		let response = await send();

		// A revoked embed token or an expired pair both surface as a 401 — retry
		// once with a freshly exchanged token before giving up.
		if (response.status === 401)
		{
			this.invalidate();
			response = await send();
		}

		const body = await response.json().catch(() => ({}));

		if (!response.ok)
		{
			throw new SynodeApiError(
				body.message || `${service}/${path} failed`,
				body.errorCode || "API_ERROR",
				response.status
			);
		}

		return body.data;
	}

	/**
	 * Uploads the source image so the generation service receives an http(s)
	 * URL — it rejects data URLs.
	 * @param {File|Blob} file Image picked by the user
	 * @param {string} name Destination file name
	 * @param {string} [directory] Media `type` bucket
	 * @returns {Promise<string>} Public URL of the uploaded image
	 */
	async uploadImage(file, name, directory = "asset-library")
	{
		const jwt = await this.accessToken();
		const form = new FormData();

		form.append("file", file, name);
		form.append("public", "true");
		form.append("type", directory);
		form.append("name", name);

		const response = await fetch(`${serviceBaseUrl("media")}/files/upload`, {
			method: "POST",
			headers: { Authorization: `Bearer ${jwt}` },
			body: form
		});

		const body = await response.json().catch(() => ({}));

		if (!response.ok)
		{
			throw new SynodeApiError(
				body.message || "Image upload failed",
				"UPLOAD_FAILED",
				response.status
			);
		}

		const link = body.data?.[0]?.mediaLink;

		if (!link)
		{
			throw new SynodeApiError("Upload did not return a URL", "UPLOAD_FAILED");
		}

		return link;
	}

	/**
	 * Queues a generation. Returns immediately with a `pending` document.
	 * @param {string} imageUrl Public URL of the source image
	 * @param {string} [name] Asset name
	 * @param {string} [path] Asset library path
	 */
	async generate(imageUrl, name, path)
	{
		return this.message("trellis", "model-generations/generate", {
			imageUrl,
			...(name && { name }),
			...(path && { path })
		});
	}

	/**
	 * Reads one generation document, used for polling.
	 * @param {string} id Document id
	 */
	async readGeneration(id)
	{
		return this.message("trellis", "model-generations/read", {
			where: { _id: id }
		});
	}

	/**
	 * Polls a generation until it completes, fails or the caller aborts.
	 * @param {string} id Document id
	 * @param {object} options
	 * @param {(generation: object) => void} [options.onProgress] Called on every status change
	 * @param {() => boolean} [options.isAborted] Return true to stop polling
	 * @param {number} [options.intervalMs]
	 * @param {number} [options.timeoutMs]
	 * @returns {Promise<object>} The completed generation document
	 */
	async pollGeneration(id, options = {})
	{
		const intervalMs = options.intervalMs || 5000;
		const deadline = Date.now() + (options.timeoutMs || 15 * 60 * 1000);
		let lastStatus = "";

		while (Date.now() < deadline)
		{
			if (options.isAborted?.()) return null;

			await new Promise(resolve => setTimeout(resolve, intervalMs));

			if (options.isAborted?.()) return null;

			const generation = await this.readGeneration(id);

			if (generation?.status !== lastStatus)
			{
				lastStatus = generation?.status;
				options.onProgress?.(generation);
			}

			if (generation?.status === GenerationStatus.Completed)
			{
				return generation;
			}

			if (generation?.status === GenerationStatus.Failed)
			{
				throw new SynodeApiError(
					generation.errorMessage || "Model generation failed",
					generation.errorCode || "MODEL_GENERATION_FAILED"
				);
			}
		}

		throw new SynodeApiError("Model generation timed out", "MODEL_GENERATION_TIMEOUT");
	}
}
