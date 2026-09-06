export default {
	ssr: false,
	target: "server",
	env: {
		// Self-hosted TRELLIS.2 server, used to resume standalone jobs.
		trellisApiUrl: "/trellis-api",
		// Synode API root. Services hang off it as `/{service}`; on localhost
		// each one is reached on its own development port instead.
		synodeApiUrl: process.env.SYNODE_API_URL || "http://localhost",
		// Tenant scope sent with every message when the URL does not carry one.
		synodeScope: process.env.SYNODE_SCOPE || "",
		// Comma separated origins allowed to host this app. Leave empty in local
		// development only — it disables the postMessage origin checks.
		allowedParentOrigins: process.env.ALLOWED_PARENT_ORIGINS || ""
	},
	head: {
		title: "Image to 3D | Synode",
		meta: [
			{ charset: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" }
		]
	},
	css: ["~/assets/scss/main.scss"],
	serverMiddleware: [
		{ path: "/trellis-api", handler: "~/server-middleware/trellis-proxy.js" }
	],
	buildModules: ["@nuxtjs/vuetify"],
	modules: ["@nuxtjs/i18n"],
	plugins: ["~/plugins/iframe-locale.client.js"],
	i18n: {
		lazy: true,
		langDir: "locales/",
		strategy: "no_prefix",
		defaultLocale: "en",
		locales: [
			{ code: "en", name: "English", file: "en.js" },
			{ code: "fr", name: "Français", file: "fr.js" }
		],
		vueI18n: { fallbackLocale: "en" }
	},
	vuetify: {
		treeShake: {
			components: ["VApp", "VBtn", "VBtnToggle", "VCheckbox", "VContainer", "VDivider", "VIcon", "VRow", "VCol", "VSelect", "VSpacer", "VTextField"],
			directives: ["Ripple"]
		},
		theme: {
			themes: { light: { primary: "#17191f" } }
		}
	}
};
