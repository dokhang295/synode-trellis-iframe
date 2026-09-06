<template>
  <main class="trellis-app">
	<app-header />

	<v-container fluid class="workspace pa-0">
	  <v-row no-gutters class="workspace-row">

		<v-col cols="12" lg="3" xl="3" class="control-column d-flex">
		  <control-panel
			ref="controlPanel"
			:has-image="hasImage"
			:generating="generating"
			:job-progress="jobProgress"
			:job-queue-position="jobQueuePosition"
			:resumed-from-storage="resumedFromStorage"
			:settings-applied="settingsApplied"
			:server-busy="serverBusy"
			:server-estimated-wait="serverEstimatedWait"
			:resolution="resolution"
			:seed="seed"
			:texture="texture"
			:decimation-target="decimationTarget"
			:output="output"
			:randomize-seed="randomizeSeed"
			:resolutions="resolutions"
			:texture-options="textureOptions"
			:decimation-options="decimationOptions"
			:output-options="outputOptions"
			@image-changed="onImageChanged"
			@generate="generate"
			@open-advanced="advancedOpen = true"
			@update:resolution="resolution = $event"
			@update:seed="seed = $event"
			@update:texture="texture = $event"
			@update:decimation-target="decimationTarget = $event"
			@update:output="output = $event"
			@update:randomize-seed="randomizeSeed = $event"
		  />
		</v-col>

		<v-col cols="12" lg="9" xl="9" class="preview-column d-flex">
		  <preview-panel
			:model-url="modelUrl"
			:generated="generated"
			:generating="generating"
			:job-progress="jobProgress"
			:job-queue-position="jobQueuePosition"
			@download-glb="downloadGlb"
		  />
		</v-col>

	  </v-row>
	</v-container>

	<advanced-modal
	  :open="advancedOpen"
	  :values="advanced"
	  :stages="advancedStages"
	  @close="advancedOpen = false"
	  @apply="applySettings"
	  @update="onAdvancedUpdate"
	/>

	<transition name="toast">
	  <div
		v-if="toastMessage"
		class="app-toast d-flex align-center"
		:class="{ 'app-toast--error': toastType === 'error' }"
		:role="toastType === 'error' ? 'alert' : 'status'"
	  >
		<span aria-hidden="true">{{ toastType === "error" ? "✕" : "✓" }}</span>
		{{ toastMessage }}
	  </div>
	</transition>
  </main>
</template>

<script>
import AppHeader from "~/components/AppHeader.vue";
import AdvancedModal from "~/components/AdvancedModal.vue";
import ControlPanel from "~/components/ControlPanel.vue";
import PreviewPanel from "~/components/PreviewPanel.vue";
import { Mode, resolveEmbedConfig } from "~/lib/embed-config.js";
import { HostBridge, Incoming } from "~/lib/host-bridge.js";
import { GenerationStatus, SynodeApi } from "~/lib/synode-api.js";

export default {
  name: "ImageTo3DPage",

  components: { AppHeader, AdvancedModal, ControlPanel, PreviewPanel },

  data() {
	return {
	  hasImage: false,
	  selectedFile: null,
	  generating: false,
	  generated: false,
	  mode: Mode.Embed,
	  jobId: null,
	  jobProgress: 0,
	  jobMessage: "",
	  jobQueuePosition: null,
	  resumedFromStorage: false,
	  modelUrl: "",
	  seed: "284739",
	  texture: 1024,
	  decimationTarget: 250000,
	  output: "PBR mesh · GLB",
	  resolution: "1024",
	  randomizeSeed: false,
	  resolutions: ["512", "1024", "1536"],
	  textureOptions: [
		{ text: "1024 px", value: 1024 },
		{ text: "2048 px", value: 2048 },
		{ text: "4096 px", value: 4096 },
	  ],
	  decimationOptions: [
		{ text: this.$t("image3d.faces", { count: "250,000" }),   value: 250000 },
		{ text: this.$t("image3d.faces", { count: "500,000" }),   value: 500000 },
		{ text: this.$t("image3d.faces", { count: "1,000,000" }), value: 1000000 },
	  ],
	  outputOptions: ["PBR mesh · GLB"],
	  advancedOpen: false,
	  settingsApplied: false,
	  toastMessage: "",
	  toastType: "success",
	  toastTimer: null,
	  serverBusy: false,
	  serverQueuedCount: 0,
	  serverEstimatedWait: null,
	  advanced: {
		sparseGuidance: 7.5, sparseRescale: 0.7, sparseSteps: 12, sparseT: 5,
		shapeGuidance: 7.5, shapeRescale: 0.5, shapeSteps: 12, shapeT: 3,
		materialGuidance: 1, materialRescale: 0, materialSteps: 12, materialT: 3,
	  },
	  advancedStages: [
		{
		  name: "image3d.stages.sparse",
		  fields: [
			{ key: "sparseGuidance", label: "image3d.fields.guidance", min: 1, max: 10, step: 0.1  },
			{ key: "sparseRescale", label: "image3d.fields.guidanceRescale", min: 0, max: 1,  step: 0.01 },
			{ key: "sparseSteps", label: "image3d.fields.samplingSteps", min: 1, max: 50, step: 1    },
			{ key: "sparseT", label: "image3d.fields.rescaleT", min: 1, max: 6,  step: 0.1  },
		  ],
		},
		{
		  name: "image3d.stages.shape",
		  fields: [
			{ key: "shapeGuidance", label: "image3d.fields.guidance", min: 1, max: 10, step: 0.1 },
			{ key: "shapeRescale", label: "image3d.fields.guidanceRescale", min: 0, max: 1,  step: 0.01 },
			{ key: "shapeSteps", label: "image3d.fields.samplingSteps", min: 1, max: 50, step: 1},
			{ key: "shapeT", label: "image3d.fields.rescaleT", min: 1, max: 6,  step: 0.1 },
		  ],
		},
		{
		  name: "image3d.stages.material",
		  fields: [
			{ key: "materialGuidance", label: "image3d.fields.guidance", min: 1, max: 10, step: 0.1 },
			{ key: "materialRescale", label: "image3d.fields.guidanceRescale", min: 0, max: 1,  step: 0.01 },
			{ key: "materialSteps", label: "image3d.fields.samplingSteps", min: 1, max: 50, step: 1 },
			{ key: "materialT", label: "image3d.fields.rescaleT", min: 1, max: 6,  step: 0.1 },
		  ],
		},
	  ],
	};
  },

  created() {
	this._destroyed = false;
	this._queuePollInterval = null;
	this._requestId = null;
	this._api = null;

	this._bridge = new HostBridge();
	this._config = resolveEmbedConfig(this.$route.query, this._bridge.embedded);
	this.mode = this._config.mode;
  },

  async mounted() {
	this._bridge
	  .on(Incoming.Generated, this.onHostGenerated)
	  .on(Incoming.Progress, this.onHostProgress)
	  .on(Incoming.Failed, this.onHostFailed);
	this._bridge.start();
	this._bridge.ready(this.$i18n.locale);

	const apiUrl = (process.env.trellisApiUrl || "").replace(/\/$/, "");

	const savedPreview = localStorage.getItem("trellis_preview_image");
	if (savedPreview) {
	  try {
		const mimeMatch = savedPreview.match(/^data:([^;]+);/);
		const mimeType = mimeMatch ? mimeMatch[1] : "image/png";
		const base64Data = savedPreview.split(",")[1];
		if (base64Data) {
		  const byteChars = atob(base64Data);
		  const byteArray = new Uint8Array(byteChars.length);
		  for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i);
		  const blob = new Blob([byteArray], { type: mimeType });
		  const file = new File([blob], "restored-image.png", { type: mimeType });
		  this.selectedFile = file;
		  this.hasImage = true;
		  this.$nextTick(() => this.$refs.controlPanel?.setFile(file));
		}
	  } catch (_) {
		localStorage.removeItem("trellis_preview_image");
	  }
	}

	const savedGlbUrl = localStorage.getItem("trellis_last_glb_url");
	if (savedGlbUrl) {
	  this.modelUrl  = savedGlbUrl;
	  this.generated = true;
	}

	const savedJobId = localStorage.getItem("trellis_active_job_id");
	if (savedJobId && apiUrl) {
	  try {
		const check = await fetch(`${apiUrl}/jobs/${savedJobId}`);
		if (check.ok) {
		  const status = await check.json();
		  if (status.status === "processing" || status.status === "queued") {
			this.modelUrl = "";
			this.generated = false;
			this.jobId = savedJobId;
			this.generating = true;
			this.resumedFromStorage = true;
			this.jobProgress = status.progress || 0;
			this.jobQueuePosition = status.queue_position ?? null;
			this.jobMessage = this.$t("image3d.resumeProgress");
			await this.pollJobStatus(apiUrl);
			return;
		  } else if (status.status === "completed" && status.result?.glb_url) {
			this.modelUrl = status.result.glb_url;
			this.generated = true;
			localStorage.setItem("trellis_last_glb_url", status.result.glb_url);
			localStorage.removeItem("trellis_active_job_id");
			localStorage.removeItem("trellis_preview_image");
			this._startQueuePoll();
			return;
		  } else if (status.status === "failed") {
			const reason = status.error || "";
			const isRestart = reason.toLowerCase().includes("restart") || reason.toLowerCase().includes("interrupted");
			this.showToast(
			  isRestart ? this.$t("image3d.restartFailed") : (status.error || this.$t("image3d.generationFailed")),
			  "error",
			);
			localStorage.removeItem("trellis_active_job_id");
		  }
		}
	  } catch (_) {}
	  localStorage.removeItem("trellis_active_job_id");
	}

	if (apiUrl) {
	  await this.checkQueueStatus(apiUrl);
	  this._startQueuePoll();
	}
  },

  beforeDestroy() {
	this._destroyed = true;
	this._stopQueuePoll();
	this._bridge.stop();
	if (this.modelUrl?.startsWith("blob:")) URL.revokeObjectURL(this.modelUrl);
	window.clearTimeout(this.toastTimer);
  },

  methods: {
	onImageChanged(file) {
	  this.selectedFile = file;
	  this.hasImage = Boolean(file);

	  if (file) {
		const img = new Image();
		const objectUrl = URL.createObjectURL(file);
		img.onload = () => {
		  URL.revokeObjectURL(objectUrl);
		  const MAX_PX = 512;
		  const scale = Math.min(1, MAX_PX / Math.max(img.width, img.height));
		  const canvas = document.createElement("canvas");
		  canvas.width = Math.round(img.width * scale);
		  canvas.height = Math.round(img.height * scale);
		  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
		  const thumbnail = canvas.toDataURL("image/jpeg", 0.7);
		  try {
			localStorage.setItem("trellis_preview_image", thumbnail);
		  } catch (err) {
			console.warn("localStorage quota hit, clearing stale data:", err);
			localStorage.removeItem("trellis_preview_image");
			localStorage.removeItem("trellis_last_glb_url");
			try { localStorage.setItem("trellis_preview_image", thumbnail); } catch (_) {}
		  }
		};
		img.onerror = () => URL.revokeObjectURL(objectUrl);
		img.src     = objectUrl;
	  } else {
		localStorage.removeItem("trellis_preview_image");
		localStorage.removeItem("trellis_last_glb_url");
	  }
	},

	onAdvancedUpdate(key, value) {
	  this.advanced = { ...this.advanced, [key]: value };
	},

	applySettings() {
	  this.settingsApplied = true;
	  this.advancedOpen = false;
	  this.showToast(this.$t("image3d.settingsApplied"));
	},

	async generate() {
	  if (!this.selectedFile || this.generating) return;

	  this.generating = true;
	  this.generated = false;
	  this.modelUrl = "";
	  this.jobProgress = 0;
	  this.jobMessage = "";
	  this.serverBusy = false;
	  localStorage.removeItem("trellis_last_glb_url");
	  this._stopQueuePoll();
	  if (this.randomizeSeed) this.seed = Math.floor(Math.random() * 4294967295).toString();

	  if (this.mode === Mode.Token) {
		await this.generateViaApi();
		return;
	  }

	  if (!this._bridge.embedded) {
		this.showToast(this.$t("image3d.noHostPage"), "error");
		this._resetGeneratingState();
		return;
	  }

	  const imageUrl = await this.fileToDataUrl(this.selectedFile);
	  this._requestId = this._bridge.requestGeneration({
		imageUrl,
		fileName: this.selectedFile.name,
		mimeType: this.selectedFile.type,
	  });
	},

	/**
	 * `token` mode: upload the image, queue the job and poll it ourselves using
	 * the JWT pair exchanged from the organization embed token.
	 */
	async generateViaApi() {
	  const file = this.selectedFile;

	  try {
		const api = await this.ensureApi();
		const extension = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
		const name = `trellis-sources/${Date.now()}.${extension}`;

		this.jobMessage = this.$t("image3d.uploadingImage");
		const imageUrl = await api.uploadImage(file, name);

		this.jobMessage = this.$t("image3d.queueingJob");
		const generation = await api.generate(imageUrl, this.$t("image3d.generatedAssetName"));

		if (!generation?._id) {
		  throw new Error(this.$t("image3d.generationFailed"));
		}

		this.jobId = generation._id;
		this.jobProgress = 10;
		localStorage.setItem("trellis_active_job_id", generation._id);

		const completed = await api.pollGeneration(generation._id, {
		  isAborted: () => this._destroyed || this.jobId !== generation._id,
		  onProgress: (doc) => {
			this.jobProgress = doc?.status === GenerationStatus.Processing ? 50 : 10;
			this.jobMessage = this.$t(`image3d.status.${doc?.status || "pending"}`);
		  },
		});

		if (completed) this.applyGeneratedModel(completed.modelUrl);
	  } catch (error) {
		if (this._destroyed) return;
		this.showToast(error?.message || this.$t("image3d.generationFailed"), "error");
		this._resetGeneratingState();
	  }
	},

	/**
	 * Lazily builds the API client. The embed token comes either from the URL
	 * or, preferably, from the host page so it never lands in browser history.
	 */
	async ensureApi() {
	  if (this._api) return this._api;

	  let { embedToken, scope } = this._config;

	  if (!embedToken && this._bridge.embedded) {
		const fromHost = await this._bridge.requestEmbedToken();
		embedToken = fromHost.token || "";
		scope = fromHost.scope || scope;
	  }

	  if (!embedToken) {
		throw new Error(this.$t("image3d.missingEmbedToken"));
	  }

	  this._api = new SynodeApi({ embedToken, scope });
	  return this._api;
	},

	/**
	 * @param {string} modelUrl URL of the generated .glb
	 */
	applyGeneratedModel(modelUrl) {
	  if (!modelUrl) return;
	  if (this.modelUrl?.startsWith("blob:")) URL.revokeObjectURL(this.modelUrl);
	  this.modelUrl = modelUrl;
	  this.generated = true;
	  this.jobProgress = 100;
	  this._resetGeneratingState();
	  localStorage.setItem("trellis_last_glb_url", modelUrl);
	  localStorage.removeItem("trellis_preview_image");
	},

	/**
	 * Answers sent before the current request started, or belonging to a
	 * superseded one, must not overwrite the preview.
	 * @param {object} payload
	 */
	_matchesRequest(payload) {
	  // Hosts speaking protocol v1 do not echo a requestId.
	  if (!payload?.requestId || !this._requestId) return true;
	  return payload.requestId === this._requestId;
	},

	onHostGenerated(payload) {
	  if (!payload?.modelUrl || !this._matchesRequest(payload)) return;
	  this._requestId = null;
	  this.applyGeneratedModel(payload.modelUrl);
	},

	onHostProgress(payload) {
	  if (!this.generating || !this._matchesRequest(payload)) return;
	  if (typeof payload.progress === "number") this.jobProgress = payload.progress;
	  if (payload.status) this.jobMessage = this.$t(`image3d.status.${payload.status}`);
	  if (payload.message) this.jobMessage = payload.message;
	},

	onHostFailed(payload) {
	  if (!this._matchesRequest(payload)) return;
	  this._requestId = null;
	  this.showToast(payload.errorMessage || this.$t("image3d.generationFailed"), "error");
	  this._resetGeneratingState();
	},

	async pollJobStatus(apiUrl) {
	  const POLL_INTERVAL_MS = 2000;
	  const MAX_POLL_MS = 15 * 60 * 1000;
	  const MAX_NETWORK_RETRIES = 7;
	  const RETRY_DELAY_MS = 3000;
	  const deadline = Date.now() + MAX_POLL_MS;
	  let networkErrorCount = 0;

	  while (this.generating && !this._destroyed) {
		if (Date.now() > deadline) {
		  this.showToast(this.$t("image3d.generationTimedOut"), "error");
		  this._resetGeneratingState();
		  return;
		}

		try {
		  const response = await fetch(`${apiUrl}/jobs/${this.jobId}`);
		  if (this._destroyed) return;

		  if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			throw { isJobError: true, message: body.detail || `HTTP ${response.status}` };
		  }

		  const status = await response.json();
		  if (this._destroyed) return;

		  networkErrorCount = 0;
		  this.jobProgress = status.progress;
		  this.jobMessage = status.message;
		  this.jobQueuePosition = status.queue_position ?? null;

		  if (status.status === "completed") {
			if (this.modelUrl?.startsWith("blob:")) URL.revokeObjectURL(this.modelUrl);
			this.modelUrl = status.result.glb_url;
			this.generated = true;
			localStorage.setItem("trellis_last_glb_url", status.result.glb_url);
			this.showToast(this.$t("image3d.generatedSuccess", { seconds: status.result.generation_time }));
			this._resetGeneratingState();
			localStorage.removeItem("trellis_preview_image");
			return;
		  } else if (status.status === "failed") {
			throw { isJobError: true, message: status.error || "Generation failed" };
		  }

		  await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));

		} catch (error) {
		  if (this._destroyed) return;

		  if (error?.isJobError) {
			this.showToast(error.message || this.$t("image3d.generationFailed"), "error");
			this._resetGeneratingState();
			return;
		  }

		  networkErrorCount++;
		  if (networkErrorCount >= MAX_NETWORK_RETRIES) {
			this.showToast(this.$t("image3d.networkError"), "error");
			this._resetGeneratingState();
			return;
		  }

		  this.jobMessage = this.$t("image3d.reconnecting", { attempt: networkErrorCount, max: MAX_NETWORK_RETRIES });
		  await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
		}
	  }
	},

	_resetGeneratingState() {
	  this.generating = false;
	  this.resumedFromStorage = false;
	  this.jobQueuePosition = null;
	  localStorage.removeItem("trellis_active_job_id");
	  this._startQueuePoll();
	},

	async downloadGlb() {
	  if (!this.modelUrl) {
		this.showToast(this.$t("image3d.generateBeforeExport"), "error");
		return;
	  }
	  try {
		const res = await fetch(this.modelUrl);
		if (!res.ok) throw new Error(`HTTP ${res.status}`);
		const blob = await res.blob();
		const blobUrl = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = blobUrl;
		link.download = "trellis2-model.glb";
		link.style.display = "none";
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(blobUrl);
	  } catch (_) {
		window.open(this.modelUrl, "_blank", "noopener");
		this.showToast(this.$t("image3d.downloadFallback"), "success");
	  }
	},

	async checkQueueStatus(apiUrlOverride) {
	  const apiUrl = apiUrlOverride || (process.env.trellisApiUrl || "").replace(/\/$/, "");
	  if (!apiUrl) return;
	  try {
		const res = await fetch(`${apiUrl}/queue/status`);
		if (!res.ok) { this.serverBusy = false; this.serverEstimatedWait = null; return; }
		const data = await res.json();
		this.serverBusy = data.busy;
		this.serverQueuedCount = data.queued_count || 0;
		this.serverEstimatedWait = data.estimated_wait_seconds ?? null;
	  } catch (_) {
		this.serverBusy = false;
		this.serverEstimatedWait = null;
	  }
	},

	_stopQueuePoll() {
	  if (this._queuePollInterval !== null) {
		clearInterval(this._queuePollInterval);
		this._queuePollInterval = null;
	  }
	},

	_startQueuePoll() {
	  this._stopQueuePoll();
	  const apiUrl = (process.env.trellisApiUrl || "").replace(/\/$/, "");
	  if (!apiUrl) return;
	  this._queuePollInterval = setInterval(() => {
		if (!this._destroyed && !this.generating) this.checkQueueStatus(apiUrl);
	  }, 5000);
	},

	fileToDataUrl(file) {
	  return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(new Error(this.$t("image3d.imageReadFailed")));
		reader.readAsDataURL(file);
	  });
	},

	showToast(message, type = "success") {
	  this.toastMessage = message;
	  this.toastType = type;
	  window.clearTimeout(this.toastTimer);
	  this.toastTimer = window.setTimeout(() => { this.toastMessage = ""; }, 3200);
	},
  },
};
</script>
