<template>
  <div>
    <div class="page-header">
      <h2 class="page-title">{{ t("settings.title") }}</h2>
    </div>

    <div
      style="display: flex; flex-direction: column; gap: 20px; max-width: 640px"
    >
      <!-- System defaults -->
      <div class="card">
        <div class="card-body">
          <div class="card-section-title">{{ t("settings.sysDefaults") }}</div>

          <div v-if="saveMsg" class="success-msg">{{ saveMsg }}</div>
          <div v-if="saveError" class="error-msg">{{ saveError }}</div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">{{
                t("settings.labelTimezone")
              }}</label>
              <select v-model="form.default_timezone" class="form-select">
                <option v-for="tz in timezones" :key="tz" :value="tz">
                  {{ tz }}
                </option>
              </select>
            </div>
            <div class="form-group">
              <label class="form-label">{{
                t("settings.labelMaxRetries")
              }}</label>
              <input
                v-model.number="form.default_max_retry"
                class="form-input"
                type="number"
                min="1"
                max="10"
              />
            </div>
          </div>

          <div class="form-group">
            <label class="form-check">
              <input v-model="form.check_daily_run" type="checkbox" />
              <span>{{ t("settings.labelDailyRun") }}</span>
            </label>
            <p style="font-size: 12px; color: #888; margin: 4px 0 0 24px">
              {{ t("settings.dailyRunHint") }}
            </p>
          </div>

          <button
            class="btn btn-primary"
            :disabled="saving"
            @click="saveSettings"
          >
            <i class="fa-solid fa-floppy-disk"></i> {{ saving ? t("common.saving") : t("settings.saveBtn") }}
          </button>
        </div>
      </div>

      <!-- Emby defaults -->
      <div class="card">
        <div class="card-body">
          <div class="card-section-title">{{ t("settings.embyDefaults") }}</div>

          <div v-if="embyMsg" class="success-msg">{{ embyMsg }}</div>
          <div v-if="embyError" class="error-msg">{{ embyError }}</div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">{{
                t("settings.labelPlayDuration")
              }}</label>
              <input
                v-model.number="form.default_play_duration"
                class="form-input"
                type="number"
                min="30"
              />
            </div>
            <div class="form-group">
              <label class="form-label">{{
                t("settings.labelDeviceName")
              }}</label>
              <input
                v-model.trim="form.default_device_name"
                class="form-input"
                placeholder="Mac"
              />
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">{{ t("settings.labelUserAgent") }}</label>
            <select v-model="form.default_ua" class="form-select">
              <option value="">— {{ t("jobs.uaDefault") }} —</option>
              <option v-for="p in uaPresets" :key="p.name" :value="p.value">{{ p.name }}</option>
            </select>
          </div>

          <div style="margin-bottom:16px">
            <div class="card-section-title" style="margin-bottom:10px">{{ t("settings.uaPresetsSection") }}</div>
            <div v-for="(p, i) in uaPresets" :key="i" class="ua-preset-row">
              <span class="ua-preset-name">{{ p.name }}</span>
              <span class="ua-preset-value">{{ p.value }}</span>
              <button class="btn btn-sm btn-ghost ua-preset-del" :title="t('settings.uaPresetDeleteTip')" @click="removeUaPreset(i)">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
            <div class="ua-preset-add">
              <input v-model.trim="newPresetName" class="form-input" style="flex:0 0 140px" :placeholder="t('settings.uaPresetName')" @keyup.enter="addUaPreset" />
              <input v-model.trim="newPresetValue" class="form-input" style="flex:1;min-width:0" :placeholder="t('settings.uaPresetValue')" @keyup.enter="addUaPreset" />
              <button class="btn btn-ghost btn-sm" :disabled="!newPresetName || !newPresetValue" @click="addUaPreset">
                <i class="fa-solid fa-plus"></i> {{ t("settings.addPreset") }}
              </button>
            </div>
          </div>

          <button
            class="btn btn-primary"
            :disabled="embySaving"
            @click="saveEmby"
          >
            <i class="fa-solid fa-floppy-disk"></i> {{ embySaving ? t("common.saving") : t("settings.saveBtn") }}
          </button>
        </div>
      </div>

      <!-- AI button detection -->
      <div class="card">
        <div class="card-body">
          <div class="card-section-title">{{ t("settings.aiSection") }}</div>
          <p style="font-size: 12px; color: #888; margin: 0 0 4px">
            {{ t("settings.aiHint") }}
          </p>
          <p style="font-size: 12px; color: #888; margin: 0 0 12px">
            {{ t("settings.aiProviderLabel") }}
            <a
              href="https://openrouter.ai/settings/keys"
              target="_blank"
              rel="noopener noreferrer"
              style="color: inherit; text-decoration: underline"
              >OpenRouter</a
            >
            {{ t("settings.aiProviderSuffix") }}
          </p>

          <div v-if="aiMsg" class="success-msg">{{ aiMsg }}</div>
          <div v-if="aiError" class="error-msg">{{ aiError }}</div>

          <div class="form-group">
            <label class="form-label">{{ t("settings.labelAiBaseUrl") }}</label>
            <input
              v-model.trim="form.ai_base_url"
              class="form-input"
              placeholder="https://openrouter.ai/api/v1"
            />
          </div>

          <div class="form-group">
            <label class="form-label">{{ t("settings.labelAiApiKey") }}</label>
            <input
              v-model.trim="form.ai_api_key"
              class="form-input"
              type="password"
              autocomplete="off"
              placeholder="sk-..."
            />
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">{{ t("settings.labelAiModel") }}</label>
              <input
                v-model.trim="form.ai_model"
                class="form-input"
                placeholder="nvidia/nemotron-nano-12b-v2-vl:free"
              />
            </div>
            <div class="form-group">
              <label class="form-label">{{
                t("settings.labelAiTimeout")
              }}</label>
              <input
                v-model.number="form.ai_timeout_ms"
                class="form-input"
                type="number"
                min="1000"
                step="1000"
              />
            </div>
          </div>

          <button class="btn btn-primary" :disabled="aiSaving" @click="saveAi">
            <i class="fa-solid fa-floppy-disk"></i> {{ aiSaving ? t("common.saving") : t("settings.saveBtn") }}
          </button>
        </div>
      </div>

      <!-- TG Notifications -->
      <div class="card">
        <div class="card-body">
          <div class="card-section-title">
            {{ t("settings.notifySection") }}
          </div>
          <p style="font-size: 12px; color: #888; margin: 0 0 12px">
            {{ t("settings.notifyHint") }}
          </p>

          <div v-if="notifyMsg" class="success-msg">{{ notifyMsg }}</div>
          <div v-if="notifyError" class="error-msg">{{ notifyError }}</div>

          <div class="form-group">
            <label class="form-label">{{
              t("settings.labelNotifyUsername")
            }}</label>
            <input
              v-model.trim="notifyForm.username"
              class="form-input"
              :placeholder="t('settings.notifyUsernamePlaceholder')"
            />
          </div>

          <div class="form-group">
            <label class="form-label">{{
              t("settings.labelNotifyEvents")
            }}</label>
            <div class="event-pills">
              <label
                v-for="ev in notifyEventOptions"
                :key="ev.value"
                class="event-pill"
                :class="{ active: notifyForm.events.includes(ev.value) }"
              >
                <input
                  type="checkbox"
                  :checked="notifyForm.events.includes(ev.value)"
                  @change="toggleNotifyEvent(ev.value)"
                />
                {{ ev.label }}
              </label>
            </div>
          </div>

          <button
            class="btn btn-primary"
            :disabled="notifySaving"
            @click="saveNotify"
          >
            <i class="fa-solid fa-floppy-disk"></i> {{ notifySaving ? t("common.saving") : t("settings.saveBtn") }}
          </button>
        </div>
      </div>

      <!-- Import / Export -->
      <div class="card">
        <div class="card-body">
          <div class="card-section-title">
            {{ t("settings.importExport.title") }}
          </div>

          <div v-if="importMsg" class="success-msg">{{ importMsg }}</div>
          <div v-if="importError" class="error-msg">{{ importError }}</div>

          <div class="form-group">
            <p style="font-size: 12px; color: #888; margin: 0 0 8px">
              {{ t("settings.importExport.exportHint") }}
            </p>
            <button class="btn btn-secondary" @click="doExport">
              <i class="fa-solid fa-file-export"></i> {{ t("settings.importExport.exportBtn") }}
            </button>
          </div>

          <hr class="ie-divider" />

          <div class="form-group">
            <label class="form-label">{{
              t("settings.importExport.importLabel")
            }}</label>
            <input
              ref="fileInput"
              type="file"
              accept=".json"
              class="form-input"
              @change="onFileChange"
            />
          </div>

          <div class="form-group">
            <label class="form-label">{{
              t("settings.importExport.importMode")
            }}</label>
            <div class="import-mode-row">
              <label class="import-mode-option">
                <input type="radio" v-model="importMode" value="merge" />
                <div>
                  <div class="import-mode-label">
                    {{ t("settings.importExport.modeMerge") }}
                  </div>
                  <div class="import-mode-hint">
                    {{ t("settings.importExport.modeMergeHint") }}
                  </div>
                </div>
              </label>
              <label class="import-mode-option">
                <input type="radio" v-model="importMode" value="replace" />
                <div>
                  <div class="import-mode-label">
                    {{ t("settings.importExport.modeReplace") }}
                  </div>
                  <div class="import-mode-hint">
                    {{ t("settings.importExport.modeReplaceHint") }}
                  </div>
                </div>
              </label>
            </div>
          </div>

          <button
            class="btn btn-primary"
            :disabled="importing"
            @click="doImport"
          >
            <i class="fa-solid fa-file-import"></i>
            {{
              importing
                ? t("settings.importExport.importing")
                : t("settings.importExport.importBtn")
            }}
          </button>
        </div>
      </div>

      <!-- Admin credentials -->
      <div class="card">
        <div class="card-body">
          <div class="card-section-title">{{ t("settings.adminCreds") }}</div>

          <div v-if="credMsg" class="success-msg">{{ credMsg }}</div>
          <div v-if="credError" class="error-msg">{{ credError }}</div>

          <div class="form-group">
            <label class="form-label">
              {{ t("settings.labelNewUsername") }}
              <span style="font-weight: 400; color: #aaa">
                {{ t("settings.hintKeepBlank") }}</span
              >
            </label>
            <input
              v-model.trim="cred.username"
              class="form-input"
              autocomplete="username"
            />
          </div>
          <div class="form-group">
            <label class="form-label">
              {{ t("settings.labelNewPassword") }}
              <span style="font-weight: 400; color: #aaa">
                {{ t("settings.hintKeepBlank") }}</span
              >
            </label>
            <input
              v-model="cred.newPassword"
              class="form-input"
              type="password"
              autocomplete="new-password"
            />
          </div>
          <div class="form-group">
            <label class="form-label"
              >{{ t("settings.labelCurrentPass") }}
              <span style="color: #e63946">*</span></label
            >
            <input
              v-model="cred.currentPassword"
              class="form-input"
              type="password"
              autocomplete="current-password"
            />
          </div>

          <button
            class="btn btn-primary"
            :disabled="credSaving"
            @click="saveCredentials"
          >
            <i class="fa-solid fa-shield-halved"></i> {{ credSaving ? t("common.saving") : t("settings.updateBtn") }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from "vue";
import { settingsApi, authApi, dataApi } from "../api/client";
import type { ExportPayload, UAPreset } from "../api/client";
import { t } from "../i18n";

const timezones = [
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Brisbane",
  "Australia/Perth",
  "Australia/Adelaide",
  "Australia/Darwin",
  "Asia/Shanghai",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "America/New_York",
  "America/Los_Angeles",
  "America/Chicago",
  "Europe/London",
  "Europe/Paris",
  "UTC",
];

const form = reactive({
  default_timezone: "Australia/Sydney",
  default_max_retry: 5,
  check_daily_run: true,
  default_ua: "",
  default_play_duration: 300,
  default_device_name: "Mac",
  ai_base_url: "",
  ai_api_key: "",
  ai_model: "",
  ai_timeout_ms: 25000,
});
const saving = ref(false);
const saveMsg = ref("");
const saveError = ref("");

const embySaving = ref(false);
const embyMsg = ref("");
const embyError = ref("");

const aiSaving = ref(false);
const aiMsg = ref("");
const aiError = ref("");

const notifyForm = reactive({ username: "", events: ["failed"] as string[] });
const notifySaving = ref(false);
const notifyMsg = ref("");
const notifyError = ref("");

const uaPresets = ref<UAPreset[]>([]);
const newPresetName = ref("");
const newPresetValue = ref("");

const notifyEventOptions = computed(() => [
  { value: "failed", label: t("settings.notifyEventFailed") },
  { value: "success", label: t("settings.notifyEventSuccess") },
]);

function toggleNotifyEvent(value: string) {
  const idx = notifyForm.events.indexOf(value);
  if (idx === -1) notifyForm.events.push(value);
  else notifyForm.events.splice(idx, 1);
}

const cred = reactive({ username: "", newPassword: "", currentPassword: "" });
const credSaving = ref(false);
const credMsg = ref("");
const credError = ref("");

onMounted(async () => {
  try {
    const s = await settingsApi.get();
    form.default_timezone = s.default_timezone;
    form.default_max_retry = Number(s.default_max_retry);
    form.check_daily_run = s.check_daily_run !== "false";
    form.default_ua = s.default_ua ?? "";
    try { uaPresets.value = JSON.parse(s.ua_presets ?? "[]"); } catch { uaPresets.value = []; }
    form.default_play_duration = Number(s.default_play_duration ?? 300);
    form.default_device_name = s.default_device_name ?? "Mac";
    form.ai_base_url = s.ai_base_url ?? "";
    form.ai_api_key = s.ai_api_key ?? "";
    form.ai_model = s.ai_model ?? "";
    form.ai_timeout_ms = Number(s.ai_timeout_ms ?? 25000);
    notifyForm.username = s.notify_tg_username ?? "";
    try {
      if (s.notify_tg_events)
        notifyForm.events = JSON.parse(s.notify_tg_events);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
});

async function saveSettings() {
  saveMsg.value = "";
  saveError.value = "";
  saving.value = true;
  try {
    await settingsApi.update({
      default_timezone: form.default_timezone,
      default_max_retry: String(form.default_max_retry),
      check_daily_run: String(form.check_daily_run),
    });
    saveMsg.value = t("settings.saved");
  } catch (err: any) {
    saveError.value = err.response?.data?.error ?? t("settings.saveFailed");
  } finally {
    saving.value = false;
  }
}

function addUaPreset() {
  const name = newPresetName.value.trim();
  const value = newPresetValue.value.trim();
  if (!name || !value) return;
  uaPresets.value.push({ name, value });
  newPresetName.value = "";
  newPresetValue.value = "";
}

function removeUaPreset(index: number) {
  // If the default UA matches the removed preset, clear it
  if (form.default_ua === uaPresets.value[index]?.value) form.default_ua = "";
  uaPresets.value.splice(index, 1);
}

async function saveEmby() {
  embyMsg.value = "";
  embyError.value = "";
  embySaving.value = true;
  try {
    await settingsApi.update({
      default_ua: form.default_ua,
      default_play_duration: String(form.default_play_duration),
      default_device_name: form.default_device_name,
      ua_presets: JSON.stringify(uaPresets.value),
    });
    embyMsg.value = t("settings.saved");
  } catch (err: any) {
    embyError.value = err.response?.data?.error ?? t("settings.saveFailed");
  } finally {
    embySaving.value = false;
  }
}

async function saveAi() {
  aiMsg.value = "";
  aiError.value = "";
  aiSaving.value = true;
  try {
    await settingsApi.update({
      ai_base_url: form.ai_base_url,
      ai_api_key: form.ai_api_key,
      ai_model: form.ai_model,
      ai_timeout_ms: String(form.ai_timeout_ms),
    });
    aiMsg.value = t("settings.saved");
  } catch (err: any) {
    aiError.value = err.response?.data?.error ?? t("settings.saveFailed");
  } finally {
    aiSaving.value = false;
  }
}

async function saveNotify() {
  notifyMsg.value = "";
  notifyError.value = "";
  notifySaving.value = true;
  try {
    await settingsApi.update({
      notify_tg_username: notifyForm.username,
      notify_tg_events: JSON.stringify(notifyForm.events),
    });
    notifyMsg.value = t("settings.saved");
  } catch (err: any) {
    notifyError.value = err.response?.data?.error ?? t("settings.saveFailed");
  } finally {
    notifySaving.value = false;
  }
}

// ── Import / Export ───────────────────────────────────────────────────────────

const fileInput = ref<HTMLInputElement | null>(null);
const importFile = ref<File | null>(null);
const importMode = ref<"merge" | "replace">("merge");
const importing = ref(false);
const importMsg = ref("");
const importError = ref("");

function onFileChange(e: Event) {
  importFile.value =
    (e.target as HTMLInputElement).files?.[0] ?? null;
}

async function doExport() {
  const ok = confirm(t("settings.importExport.exportWarning"));
  if (!ok) return;
  try {
    const data = await dataApi.export();
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const date = new Date().toISOString().split("T")[0];
    a.download = `bemby-backup-${date}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (err: any) {
    importError.value =
      err.response?.data?.error ?? t("settings.importExport.importFailed");
  }
}

async function doImport() {
  importMsg.value = "";
  importError.value = "";
  if (!importFile.value) {
    importError.value = t("settings.importExport.noFileSelected");
    return;
  }
  if (importMode.value === "replace") {
    const ok = confirm(t("settings.importExport.replaceWarning"));
    if (!ok) return;
  }
  importing.value = true;
  try {
    const text = await importFile.value.text();
    let parsed: ExportPayload;
    try {
      parsed = JSON.parse(text);
    } catch {
      importError.value = t("settings.importExport.invalidFile");
      return;
    }
    const result = await dataApi.import(parsed, importMode.value);
    importMsg.value = t("settings.importExport.importSuccess")
      .replace("{a}", String(result.accountsImported))
      .replace("{j}", String(result.jobsImported))
      .replace("{s}", String(result.settingsUpdated));
    if (fileInput.value) fileInput.value.value = "";
    importFile.value = null;
  } catch (err: any) {
    importError.value =
      err.response?.data?.error ?? t("settings.importExport.importFailed");
  } finally {
    importing.value = false;
  }
}

async function saveCredentials() {
  credMsg.value = "";
  credError.value = "";
  if (!cred.currentPassword) {
    credError.value = t("settings.currentPassRequired");
    return;
  }
  credSaving.value = true;
  try {
    await authApi.changeCredentials(
      cred.currentPassword,
      cred.username || undefined,
      cred.newPassword || undefined,
    );
    credMsg.value = t("settings.credSaved");
    Object.assign(cred, { username: "", newPassword: "", currentPassword: "" });
  } catch (err: any) {
    credError.value = err.response?.data?.error ?? t("settings.credFailed");
  } finally {
    credSaving.value = false;
  }
}
</script>

<style scoped>
.event-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.event-pill {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border-radius: 20px;
  border: 1.5px solid #ddd;
  cursor: pointer;
  font-size: 13px;
  color: #555;
  user-select: none;
  transition:
    border-color 0.15s,
    background 0.15s,
    color 0.15s;
}

.event-pill input[type="checkbox"] {
  display: none;
}

.event-pill.active {
  border-color: var(--color-primary, #2563eb);
  background: #eff6ff;
  color: var(--color-primary, #2563eb);
  font-weight: 500;
}

.event-pill:hover:not(.active) {
  border-color: #bbb;
  background: #fafafa;
}

.ie-divider {
  border: none;
  border-top: 1px solid #eee;
  margin: 16px 0;
}

.import-mode-row {
  display: flex;
  gap: 16px;
  margin-top: 4px;
  flex-wrap: wrap;
}

.import-mode-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  cursor: pointer;
}

.import-mode-option input[type="radio"] {
  margin-top: 3px;
  flex-shrink: 0;
}

.import-mode-label {
  font-size: 13px;
  font-weight: 500;
}

.import-mode-hint {
  font-size: 12px;
  color: #888;
}

.ua-preset-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #f0f0f0;
}

.ua-preset-name {
  flex: 0 0 140px;
  font-size: 13px;
  font-weight: 500;
  color: #1a1a2e;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ua-preset-value {
  flex: 1;
  font-size: 11px;
  font-family: monospace;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.ua-preset-del {
  flex-shrink: 0;
  color: #e63946;
  padding: 3px 7px;
}

.ua-preset-add {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 8px;
  flex-wrap: wrap;
}
</style>
