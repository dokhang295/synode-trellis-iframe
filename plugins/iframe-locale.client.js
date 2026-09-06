import { allowedParentOrigins } from "~/lib/host-bridge.js";

const SUPPORTED_LOCALES = ["en", "fr"];

export default ({ app, route }) =>
{
	const allowed = allowedParentOrigins();

	const setLocale = (locale) =>
	{
		if (SUPPORTED_LOCALES.includes(locale)) app.i18n.setLocale(locale);
	};

	setLocale(route.query.locale || route.query.lang);

	// The ready handshake is sent by the page once it mounts, so the host knows
	// the protocol version along with the locale.
	window.addEventListener("message", (event) =>
	{
		if (event.source !== window.parent) return;
		if (allowed.length && !allowed.includes(event.origin)) return;

		const { data } = event;
		if (!data || data.type !== "synode:locale") return;

		setLocale(data.locale ?? data.payload?.locale);
	});
};
