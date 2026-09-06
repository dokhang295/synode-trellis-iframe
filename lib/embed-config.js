/**
 * Resolves how the embedded app talks to the backend.
 *
 * Two integration modes are supported, both driven from the URL so the same
 * build serves every organization:
 *
 *  - `embed` — the host page owns the credentials. The app relays the source
 *    image over postMessage and waits for the host to answer with the model.
 *
 *  - `token` — the app owns an organization embed token and calls the API
 *    itself. This is the path a desktop or mobile client uses, and the one that
 *    needs no host page at all.
 */

export const Mode = {
	Embed: "embed",
	Token: "token"
};

/**
 * @param {object} query Route query
 * @param {boolean} embedded Whether the app runs inside a host page
 * @returns {{ mode: string, embedToken: string, scope: string }}
 */
export function resolveEmbedConfig(query = {}, embedded = false)
{
	const embedToken = query.embedToken || query.token || "";
	const requested = String(query.mode || "").toLowerCase();

	let mode;

	if (requested === Mode.Token || requested === Mode.Embed)
	{
		mode = requested;
	}
	else if (embedToken)
	{
		mode = Mode.Token;
	}
	else if (embedded)
	{
		mode = Mode.Embed;
	}
	else
	{
		// Opened directly with no token: the API path is the only one that can
		// work, and it will report the missing token instead of hanging.
		mode = Mode.Token;
	}

	return {
		mode,
		embedToken,
		scope: query.scope || process.env.synodeScope || ""
	};
}
