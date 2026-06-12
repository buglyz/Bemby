<template>
  <div>
    <div class="page-header">
      <h2 class="page-title">{{ t('logs.title') }}</h2>
      <div style="display:flex;gap:10px;align-items:center">
        <select v-model="filterJobId" class="form-select" style="width:200px" @change="load">
          <option value="">{{ t('logs.allJobs') }}</option>
          <option v-for="j in jobs" :key="j.id" :value="j.id">{{ j.name }}</option>
        </select>
        <button class="btn btn-ghost" @click="load">{{ t('common.refresh') }}</button>
      </div>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ t('logs.colTime') }}</th>
              <th>{{ t('logs.colJob') }}</th>
              <th>{{ t('logs.colAccount') }}</th>
              <th>{{ t('logs.colStatus') }}</th>
              <th>{{ t('logs.colMessage') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!logs.length">
              <td colspan="5" class="empty">{{ t('logs.noLogs') }}</td>
            </tr>
            <template v-for="l in logs" :key="l.id">
              <tr
                style="cursor:pointer;user-select:none"
                :class="expandedId === l.id ? 'row-expanded' : ''"
                @click="toggleDetail(l)"
              >
                <td style="white-space:nowrap">{{ fmtDate(l.ranAt) }}</td>
                <td>
                  {{ l.jobName ?? l.jobId }}
                  <span style="margin-left:4px;font-size:11px;color:#aaa">▾</span>
                </td>
                <td>{{ l.accountName ?? '—' }}</td>
                <td><span :class="statusBadge(l.status)">{{ t(`logs.status.${l.status}`) }}</span></td>
                <td style="max-width:320px">
                  <div style="display:flex;align-items:center;gap:8px">
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">{{ l.message ?? '—' }}</span>
                    <button
                      v-if="l.status === 'running'"
                      class="btn btn-sm btn-danger"
                      style="flex-shrink:0"
                      :disabled="stopping.has(l.id)"
                      @click.stop="stopJob(l)"
                    >{{ stopping.has(l.id) ? t('common.stopping') : t('common.stop') }}</button>
                  </div>
                </td>
              </tr>

              <!-- Detail panel — checkin jobs: chat-style attempt log -->
              <tr v-if="l.jobType === 'checkin' && expandedId === l.id">
                <td colspan="5" style="padding:0;background:#f8f9fa;border-top:none">
                  <div style="padding:16px 20px">
                    <div v-if="detailLoading" style="color:#888;font-size:13px">
                      {{ t('logs.detail.loading') }}
                    </div>
                    <div v-else-if="!checkinDetail?.length" style="color:#888;font-size:13px">
                      {{ t('logs.detail.noDetail') }}
                    </div>
                    <div v-else>
                      <div
                        v-for="a in checkinDetail"
                        :key="a.attempt"
                        :style="checkinDetail.length > 1 ? 'margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid #e5e7eb' : ''"
                      >
                        <div v-if="checkinDetail.length > 1" style="font-size:11px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:0.05em;text-align:center;margin-bottom:10px">
                          {{ t('logs.detail.attempt').replace('{n}', String(a.attempt)) }}
                        </div>
                        <div class="chat-bg">
                        <div class="chat-log">
                          <div class="chat-row-sent">
                            <div class="bubble-sent">{{ a.commandSent }}</div>
                          </div>
                          <div v-if="a.commandResponseHtml || a.hasMedia" class="chat-row-recv">
                            <div>
                              <div class="tg-bubble">
                                <img v-if="a.commandResponseImage" :src="a.commandResponseImage" class="tg-bubble-img" alt="" />
                                <div v-else-if="a.hasMedia" class="tg-bubble-img-placeholder">📷</div>
                                <div v-if="a.commandResponseHtml" class="tg-bubble-text" v-html="a.commandResponseHtml" />
                              </div>
                              <div v-if="a.availableButtons?.length" class="tg-keyboard">
                                <div v-for="(row, ri) in a.availableButtons" :key="ri" class="tg-keyboard-row">
                                  <div v-for="btn in row" :key="btn" :class="btn === a.buttonClicked ? 'tg-btn tg-btn-active' : 'tg-btn'">{{ btn }}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div v-if="a.buttonClicked" class="chat-row-sent">
                            <div>
                              <div class="bubble-sent">{{ a.buttonClicked }}</div>
                              <div v-if="a.aiDurationMs != null" class="ai-badge">AI · {{ a.aiDurationMs }}ms</div>
                            </div>
                          </div>
                          <div v-if="a.buttonResponseHtml || a.buttonResponseHasMedia" class="chat-row-recv">
                            <div>
                              <div class="tg-bubble">
                                <img v-if="a.buttonResponseImage" :src="a.buttonResponseImage" class="tg-bubble-img" alt="" />
                                <div v-else-if="a.buttonResponseHasMedia" class="tg-bubble-img-placeholder">📷</div>
                                <div v-if="a.buttonResponseHtml" class="tg-bubble-text" v-html="a.buttonResponseHtml" />
                              </div>
                              <div v-if="a.buttonResponseButtons?.length" class="tg-keyboard">
                                <div v-for="(row, ri) in a.buttonResponseButtons" :key="ri" class="tg-keyboard-row">
                                  <div v-for="btn in row" :key="btn" class="tg-btn">{{ btn }}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div v-if="a.callbackAnswer" class="chat-row-recv">
                            <div class="bubble-callback">{{ a.callbackAnswer }}</div>
                          </div>
                          <div v-if="a.error" class="chat-error">{{ a.error }}</div>
                        </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>

              <!-- Detail panel — custom jobs: step-by-step timeline -->
              <tr v-if="l.jobType === 'custom' && expandedId === l.id">
                <td colspan="5" style="padding:0;background:#f8f9fa;border-top:none">
                  <div style="padding:16px 20px">
                    <div v-if="detailLoading" style="color:#888;font-size:13px">{{ t('logs.detail.loading') }}</div>
                    <div v-else-if="!customDetail?.length" style="color:#888;font-size:13px">{{ t('logs.detail.noDetail') }}</div>
                    <div v-else class="custom-steps">
                      <div v-for="s in customDetail" :key="s.step" class="custom-step" :class="s.error ? 'custom-step-error' : ''">
                        <div class="custom-step-header">
                          <span class="custom-step-num">{{ s.step }}</span>
                          <span class="custom-step-label">{{ s.label || s.actionType }}</span>
                          <span v-if="s.durationMs != null" class="custom-step-duration">{{ s.durationMs }}ms</span>
                          <span v-if="s.error" class="badge badge-red" style="font-size:10px">failed</span>
                          <span v-else-if="s.result" class="badge badge-green" style="font-size:10px">ok</span>
                        </div>
                        <!-- Pre-click context: bot message received while waiting for buttons -->
                        <div v-if="s.preClickHtml || s.preClickImage || s.preClickHasMedia || s.preClickButtons?.length" class="chat-bg" style="margin-top:6px">
                          <div class="chat-log">
                            <div class="chat-row-recv">
                              <div>
                                <div class="tg-bubble">
                                  <img v-if="s.preClickImage" :src="s.preClickImage" class="tg-bubble-img" alt="" />
                                  <div v-else-if="s.preClickHasMedia" class="tg-bubble-img-placeholder">📷</div>
                                  <div v-if="s.preClickHtml" class="tg-bubble-text" v-html="s.preClickHtml" />
                                </div>
                                <div v-if="s.preClickButtons?.length" class="tg-keyboard">
                                  <div v-for="(row, ri) in s.preClickButtons" :key="ri" class="tg-keyboard-row">
                                    <div v-for="btn in row" :key="btn" :class="btn === s.clickedButton ? 'tg-btn tg-btn-active' : 'tg-btn'">{{ btn }}</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div v-if="s.callbackAnswer" class="custom-step-callback">{{ s.callbackAnswer }}</div>
                        <!-- Response after the action -->
                        <div v-if="s.responseHtml || s.responseImage || s.responseHasMedia || s.responseButtons?.length" class="chat-bg" style="margin-top:6px">
                          <div class="chat-log">
                            <div class="chat-row-recv">
                              <div>
                                <div class="tg-bubble">
                                  <img v-if="s.responseImage" :src="s.responseImage" class="tg-bubble-img" alt="" />
                                  <div v-else-if="s.responseHasMedia" class="tg-bubble-img-placeholder">📷</div>
                                  <div v-if="s.responseHtml" class="tg-bubble-text" v-html="s.responseHtml" />
                                </div>
                                <div v-if="s.responseButtons?.length" class="tg-keyboard">
                                  <div v-for="(row, ri) in s.responseButtons" :key="ri" class="tg-keyboard-row">
                                    <div v-for="btn in row" :key="btn" class="tg-btn">{{ btn }}</div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                        <div v-if="s.error" class="chat-error" style="margin-top:4px">{{ s.error }}</div>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>

              <!-- Detail panel — embywatch jobs: playback summary -->
              <tr v-if="l.jobType === 'embywatch' && expandedId === l.id">
                <td colspan="5" style="padding:0;background:#f8f9fa;border-top:none">
                  <div style="padding:16px 20px">
                    <div v-if="detailLoading" style="color:#888;font-size:13px">{{ t('logs.detail.loading') }}</div>
                    <div v-else-if="!embywatchDetail" style="color:#888;font-size:13px">{{ t('logs.detail.noDetail') }}</div>
                    <div v-else class="emby-detail">
                      <div class="emby-title">
                        <template v-if="embywatchDetail.seriesName">{{ embywatchDetail.seriesName }} — {{ embywatchDetail.title }}</template>
                        <template v-else>{{ embywatchDetail.title }}</template>
                      </div>
                      <div v-if="embywatchDetail.seasonNumber != null" class="emby-episode-label">
                        S{{ String(embywatchDetail.seasonNumber).padStart(2, '0') }}E{{ String(embywatchDetail.episodeNumber ?? 0).padStart(2, '0') }}
                        &nbsp;·&nbsp;{{ embywatchDetail.itemType }}
                      </div>
                      <div class="emby-stats">
                        <div class="emby-stat">
                          <div class="emby-stat-label">{{ t('logs.embyDetail.runtime') }}</div>
                          <div class="emby-stat-value">{{ fmtSeconds(embywatchDetail.runtimeSeconds) }}</div>
                        </div>
                        <div class="emby-stat">
                          <div class="emby-stat-label">{{ t('logs.embyDetail.start') }}</div>
                          <div class="emby-stat-value">{{ fmtSeconds(embywatchDetail.startSeconds) }}</div>
                        </div>
                        <div class="emby-stat">
                          <div class="emby-stat-label">{{ t('logs.embyDetail.end') }}</div>
                          <div class="emby-stat-value">{{ fmtSeconds(embywatchDetail.endSeconds) }}</div>
                        </div>
                        <div class="emby-stat">
                          <div class="emby-stat-label">{{ t('logs.embyDetail.watched') }}</div>
                          <div class="emby-stat-value">{{ fmtSeconds(embywatchDetail.watchedSeconds) }}</div>
                        </div>
                        <div class="emby-stat">
                          <div class="emby-stat-label">{{ t('logs.embyDetail.markedWatched') }}</div>
                          <div class="emby-stat-value" :style="embywatchDetail.markedWatched ? 'color:#065f46' : 'color:#991b1b'">
                            {{ embywatchDetail.markedWatched ? t('logs.embyDetail.yes') : t('logs.embyDetail.no') }}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <div v-if="logs.length === 50" style="padding:12px 16px;text-align:center">
        <button class="btn btn-ghost btn-sm" @click="loadMore">{{ t('common.loadMore') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { logsApi, jobsApi, type Log, type Job, type CheckinAttemptLog, type EmbywatchLog, type CustomStepLog } from '../api/client';
import { t, locale } from '../i18n';

const logs = ref<Log[]>([]);
const jobs = ref<Job[]>([]);
const filterJobId = ref<number | ''>('');
const offset = ref(0);

const expandedId = ref<number | null>(null);
const expandedDetail = ref<CheckinAttemptLog[] | EmbywatchLog[] | null>(null);
const detailLoading = ref(false);
const stopping = ref(new Set<number>());
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let detailPollTimer: ReturnType<typeof setTimeout> | null = null;

// Typed accessors for the two detail formats
const checkinDetail = computed(() => {
  if (!expandedDetail.value?.length) return null;
  if ('attempt' in expandedDetail.value[0]) return expandedDetail.value as CheckinAttemptLog[];
  return null;
});

const embywatchDetail = computed(() => {
  if (!expandedDetail.value?.length) return null;
  if ('itemType' in expandedDetail.value[0]) return expandedDetail.value[0] as EmbywatchLog;
  return null;
});

const customDetail = computed(() => {
  if (!expandedDetail.value) return null;
  const d = expandedDetail.value as any;
  // detail is stored as an array; custom log is the first element
  const first = Array.isArray(d) ? d[0] : d;
  if (first && 'steps' in first && Array.isArray(first.steps)) return first.steps as CustomStepLog[];
  return null;
});

onMounted(async () => {
  jobs.value = await jobsApi.list();
  await load();
});

async function load() {
  offset.value = 0;
  expandedId.value = null;
  logs.value = await logsApi.list({
    jobId: filterJobId.value === '' ? undefined : Number(filterJobId.value),
    limit: 50,
    offset: 0,
  });
}

async function loadMore() {
  offset.value += 50;
  const more = await logsApi.list({
    jobId: filterJobId.value === '' ? undefined : Number(filterJobId.value),
    limit: 50,
    offset: offset.value,
  });
  logs.value.push(...more);
}

async function stopJob(log: Log) {
  stopping.value.add(log.id);
  stopping.value = new Set(stopping.value);
  try {
    await logsApi.cancel(log.id);
    const poll = async () => {
      try {
        const updated = await logsApi.getOne(log.id);
        const entry = logs.value.find(l => l.id === log.id);
        if (entry) {
          entry.status = updated.status;
          entry.message = updated.message;
        }
        if (updated.status === 'running') {
          pollTimer = setTimeout(poll, 1500);
        } else {
          stopping.value.delete(log.id);
          stopping.value = new Set(stopping.value);
        }
      } catch {
        stopping.value.delete(log.id);
        stopping.value = new Set(stopping.value);
      }
    };
    poll();
  } catch {
    stopping.value.delete(log.id);
    stopping.value = new Set(stopping.value);
  }
}

function clearDetailPoll() {
  if (detailPollTimer) { clearTimeout(detailPollTimer); detailPollTimer = null; }
}

async function fetchDetail(logId: number) {
  detailLoading.value = true;
  try {
    const full = await logsApi.getOne(logId);
    if (expandedId.value !== logId) return null;
    expandedDetail.value = full.detail ?? null;
    const entry = logs.value.find(l => l.id === logId);
    if (entry) { entry.status = full.status; entry.message = full.message; }
    return full;
  } catch {
    return null;
  } finally {
    detailLoading.value = false;
  }
}

function scheduleDetailPoll(logId: number) {
  clearDetailPoll();
  detailPollTimer = setTimeout(async () => {
    const full = await fetchDetail(logId);
    if (full?.status === 'running' && expandedId.value === logId) scheduleDetailPoll(logId);
  }, 2000);
}

async function toggleDetail(log: Log) {
  if (expandedId.value === log.id) {
    expandedId.value = null;
    expandedDetail.value = null;
    clearDetailPoll();
    return;
  }
  clearDetailPoll();
  expandedId.value = log.id;
  expandedDetail.value = null;
  const full = await fetchDetail(log.id);
  if (full?.status === 'running' && expandedId.value === log.id) scheduleDetailPoll(log.id);
}

function statusBadge(s: Log['status']) {
  const map: Record<string, string> = {
    success: 'badge badge-green',
    failed:  'badge badge-red',
    running: 'badge badge-orange',
  };
  return map[s] ?? 'badge badge-grey';
}

onUnmounted(() => {
  if (pollTimer) clearTimeout(pollTimer);
  clearDetailPoll();
});

function fmtDate(iso: string) {
  const localeMap: Record<string, string> = { en: 'en-AU', zh: 'zh-CN' };
  return new Date(iso).toLocaleString(localeMap[locale.value] ?? 'en-AU', {
    month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function fmtSeconds(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}
</script>

<style scoped>
.row-expanded td {
  background: #f0f4ff;
}

/* Emby detail panel */
.emby-detail {
  max-width: 480px;
}

.emby-title {
  font-size: 15px;
  font-weight: 600;
  color: #1a1a2e;
  margin-bottom: 2px;
}

.emby-episode-label {
  font-size: 12px;
  color: #888;
  margin-bottom: 14px;
}

.emby-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.emby-stat {
  background: #fff;
  border: 1px solid #e8e8e8;
  border-radius: 8px;
  padding: 10px 16px;
  min-width: 90px;
}

.emby-stat-label {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #888;
  margin-bottom: 4px;
}

.emby-stat-value {
  font-size: 16px;
  font-weight: 600;
  color: #1a1a2e;
  font-variant-numeric: tabular-nums;
}

/* Chat background container */
.chat-bg {
  display: inline-block;
  background: #eef1f5;
  border-radius: 10px;
  padding: 12px 14px;
  max-width: 420px;
  width: 100%;
  box-sizing: border-box;
}

/* Chat layout */
.chat-log {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.chat-row-sent {
  display: flex;
  justify-content: flex-end;
}
.chat-row-recv {
  display: flex;
  justify-content: flex-start;
}

/* Outgoing bubble (right) */
.bubble-sent {
  background: #dcf8c6;
  border-radius: 14px 14px 4px 14px;
  padding: 8px 12px;
  font-size: 13px;
  font-family: monospace;
  color: #111;
  max-width: 75%;
  word-break: break-all;
}

.ai-badge {
  font-size: 11px;
  color: #6366f1;
  text-align: right;
  margin-top: 3px;
  padding-right: 2px;
  font-weight: 500;
}

.bubble-callback {
  background: #e9e9eb;
  border-radius: 14px 14px 14px 4px;
  padding: 6px 10px;
  font-size: 12px;
  color: #333;
  max-width: 75%;
  font-style: italic;
}

.chat-error {
  font-size: 12px;
  color: #e63946;
  text-align: center;
  padding: 2px 0;
}

.tg-bubble {
  display: inline-block;
  background: #e9e9eb;
  border-radius: 14px 14px 14px 4px;
  overflow: hidden;
  max-width: 300px;
  min-width: 80px;
}
.tg-bubble-img {
  width: 100%;
  display: block;
}
.tg-bubble-img-placeholder {
  height: 80px;
  background: #d8d8da;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
}
.tg-bubble-text {
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1.55;
  color: #111;
}
.tg-bubble-text a { color: #2563eb; }
.tg-bubble-text code { background: #d4d4d6; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.tg-bubble-text pre { background: #d4d4d6; padding: 8px; border-radius: 4px; overflow-x: auto; }

.tg-keyboard {
  margin-top: 4px;
  max-width: 300px;
}
.tg-keyboard-row {
  display: flex;
  gap: 4px;
  margin-bottom: 4px;
}
.tg-btn {
  flex: 1;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1.5px solid #d0d7de;
  background: #fff;
  color: #333;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tg-btn-active {
  background: #dcf8c6;
  color: #1a7f37;
  border-color: #9ad79a;
  font-weight: 600;
}

/* Custom job step timeline */
.custom-steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 560px;
}

.custom-step {
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 10px 14px;
  background: #fff;
}

.custom-step-error {
  border-color: #fca5a5;
  background: #fff5f5;
}

.custom-step-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.custom-step-num {
  min-width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #e0e7ff;
  color: #3730a3;
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.custom-step-label {
  flex: 1;
  font-weight: 500;
  color: #1a1a2e;
}

.custom-step-duration {
  font-size: 11px;
  color: #aaa;
}

.custom-step-callback {
  margin-top: 6px;
  font-size: 12px;
  color: #555;
  background: #f0f4ff;
  border-radius: 4px;
  padding: 4px 8px;
}
</style>
