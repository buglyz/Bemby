<template>
  <div>
    <div class="page-header">
      <h2 class="page-title">{{ t('accounts.title') }}</h2>
      <button class="btn btn-primary" @click="openAdd">{{ t('accounts.addBtn') }}</button>
    </div>

    <div class="card">
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>{{ t('common.name') }}</th>
              <th>{{ t('accounts.colPhone') }}</th>
              <th>{{ t('accounts.colStatus') }}</th>
              <th>{{ t('accounts.colAdded') }}</th>
              <th>{{ t('common.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!accounts.length">
              <td colspan="5" class="empty">{{ t('accounts.noAccounts') }}</td>
            </tr>
            <tr v-for="a in accounts" :key="a.id">
              <td>{{ a.name }}</td>
              <td>{{ a.phoneNumber }}</td>
              <td><span :class="statusBadge(a.authStatus)">{{ t(`accounts.status.${a.authStatus}`) }}</span></td>
              <td>{{ fmtDate(a.createdAt) }}</td>
              <td>
                <div class="actions">
                  <button
                    v-if="a.authStatus !== 'authenticated'"
                    class="btn btn-sm btn-primary"
                    @click="openAuth(a)"
                  >{{ t('accounts.authenticate') }}</button>
                  <button class="btn btn-sm btn-ghost" @click="openEdit(a)">{{ t('common.edit') }}</button>
                  <button class="btn btn-sm btn-danger" @click="remove(a.id)">{{ t('common.delete') }}</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Add / Edit modal -->
    <div v-if="showForm" class="modal-backdrop">
      <div class="modal">
        <h3 class="modal-title">{{ t(editTarget ? 'accounts.editTitle' : 'accounts.addTitle') }}</h3>
        <div v-if="formError" class="error-msg">{{ formError }}</div>
        <div class="form-group">
          <label class="form-label">{{ t('accounts.labelName') }}</label>
          <input v-model.trim="form.name" class="form-input" placeholder="e.g. My Account" />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('accounts.labelPhone') }}</label>
          <input v-model.trim="form.phoneNumber" class="form-input" placeholder="+61412345678" />
        </div>
        <div class="form-group" style="max-width:140px">
          <label class="form-label">{{ t('accounts.labelApiId') }}</label>
          <input v-model.trim="form.apiId" class="form-input" type="number" />
        </div>
        <div class="form-group">
          <label class="form-label">{{ t('accounts.labelApiHash') }}</label>
          <input v-model.trim="form.apiHash" class="form-input" placeholder="32-char hex" style="font-family:monospace" />
        </div>
        <p style="font-size:12px;color:#888;margin-top:-8px;margin-bottom:14px">
          {{ t('accounts.apiHint') }} <a href="https://my.telegram.org/apps" target="_blank">my.telegram.org/apps</a>
        </p>
        <div class="modal-footer">
          <button class="btn btn-ghost" @click="showForm = false">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :disabled="saving" @click="saveAccount">
            {{ saving ? t('common.saving') : t('common.save') }}
          </button>
        </div>
      </div>
    </div>

    <!-- Auth modal -->
    <div v-if="showAuth" class="modal-backdrop">
      <div class="modal">
        <h3 class="modal-title">{{ t('accounts.authTitle') }} — {{ authTarget?.name }}</h3>
        <div v-if="authError" class="error-msg">{{ authError }}</div>

        <!-- Step: request code -->
        <div v-if="authStep === 'idle'">
          <p style="color:#666;margin-bottom:16px;font-size:13px">
            {{ t('accounts.authHint') }} <strong>{{ authTarget?.phoneNumber }}</strong>.
          </p>
          <button class="btn btn-primary" :disabled="authBusy" @click="sendCode">
            {{ authBusy ? t('accounts.sending') : t('accounts.sendCode') }}
          </button>
        </div>

        <!-- Step: enter OTP -->
        <div v-else-if="authStep === 'code'">
          <div class="form-group">
            <label class="form-label">{{ t('accounts.labelCode') }}</label>
            <input v-model.trim="authCode" class="form-input" placeholder="12345" autofocus />
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="closeAuth">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary" :disabled="authBusy" @click="verifyCode">
              {{ authBusy ? t('accounts.verifying') : t('accounts.verify') }}
            </button>
          </div>
        </div>

        <!-- Step: 2FA password -->
        <div v-else-if="authStep === '2fa'">
          <div class="form-group">
            <label class="form-label">{{ t('accounts.labelTwoFa') }}</label>
            <input v-model="authPassword" class="form-input" type="password" autofocus />
          </div>
          <div class="modal-footer">
            <button class="btn btn-ghost" @click="closeAuth">{{ t('common.cancel') }}</button>
            <button class="btn btn-primary" :disabled="authBusy" @click="verify2fa">
              {{ authBusy ? t('accounts.verifying') : t('accounts.submit') }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import { accountsApi, type Account } from '../api/client';
import { t, locale } from '../i18n';

const accounts = ref<Account[]>([]);

// ── Form state ────────────────────────────────────────────────────────────────
const showForm = ref(false);
const editTarget = ref<Account | null>(null);
const form = reactive({ name: '', phoneNumber: '', apiId: '', apiHash: '' });
const formError = ref('');
const saving = ref(false);

// ── Auth state ────────────────────────────────────────────────────────────────
const showAuth = ref(false);
const authTarget = ref<Account | null>(null);
const authStep = ref<'idle' | 'code' | '2fa'>('idle');
const authCode = ref('');
const authPassword = ref('');
const authError = ref('');
const authBusy = ref(false);

// ── Lifecycle ──────────────────────────────────────────────────────────────────
onMounted(load);

async function load() {
  accounts.value = await accountsApi.list();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusBadge(s: Account['authStatus']) {
  const map: Record<string, string> = {
    authenticated: 'badge badge-green',
    pending_code: 'badge badge-orange',
    pending_2fa: 'badge badge-orange',
    unauthenticated: 'badge badge-grey',
  };
  return map[s] ?? 'badge badge-grey';
}

function fmtDate(iso: string) {
  const localeMap: Record<string, string> = { en: 'en-AU', zh: 'zh-CN' };
  return new Date(iso).toLocaleDateString(localeMap[locale.value] ?? 'en-AU', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Add / Edit ─────────────────────────────────────────────────────────────────
function openAdd() {
  editTarget.value = null;
  Object.assign(form, { name: '', phoneNumber: '', apiId: '', apiHash: '' });
  formError.value = '';
  showForm.value = true;
}

function openEdit(a: Account) {
  editTarget.value = a;
  Object.assign(form, { name: a.name, phoneNumber: a.phoneNumber, apiId: String(a.apiId), apiHash: '' });
  formError.value = '';
  showForm.value = true;
}

async function saveAccount() {
  formError.value = '';
  saving.value = true;
  try {
    if (editTarget.value) {
      await accountsApi.update(editTarget.value.id, {
        name: form.name,
        phoneNumber: form.phoneNumber,
        apiId: Number(form.apiId),
        ...(form.apiHash ? { apiHash: form.apiHash } : {}),
      });
    } else {
      await accountsApi.create({
        name: form.name,
        phoneNumber: form.phoneNumber,
        apiId: Number(form.apiId),
        apiHash: form.apiHash,
      });
    }
    showForm.value = false;
    await load();
  } catch (err: any) {
    formError.value = err.response?.data?.error ?? t('common.saveFailed');
  } finally {
    saving.value = false;
  }
}

async function remove(id: number) {
  if (!confirm(t('accounts.confirmDelete'))) return;
  await accountsApi.delete(id);
  await load();
}

// ── Auth flow ─────────────────────────────────────────────────────────────────
function openAuth(a: Account) {
  authTarget.value = a;
  authStep.value = 'idle';
  authCode.value = '';
  authPassword.value = '';
  authError.value = '';
  showAuth.value = true;
}

function closeAuth() {
  showAuth.value = false;
}

async function sendCode() {
  if (!authTarget.value) return;
  authError.value = '';
  authBusy.value = true;
  try {
    await accountsApi.requestCode(authTarget.value.id);
    authStep.value = 'code';
  } catch (err: any) {
    authError.value = err.response?.data?.error ?? t('accounts.errors.sendFailed');
  } finally {
    authBusy.value = false;
  }
}

async function verifyCode() {
  if (!authTarget.value) return;
  authError.value = '';
  authBusy.value = true;
  try {
    const res = await accountsApi.verify(authTarget.value.id, { code: authCode.value });
    if (res.step === '2fa') {
      authStep.value = '2fa';
    } else {
      showAuth.value = false;
      await load();
    }
  } catch (err: any) {
    authError.value = err.response?.data?.error ?? t('accounts.errors.verifyFailed');
  } finally {
    authBusy.value = false;
  }
}

async function verify2fa() {
  if (!authTarget.value) return;
  authError.value = '';
  authBusy.value = true;
  try {
    await accountsApi.verify(authTarget.value.id, { password: authPassword.value });
    showAuth.value = false;
    await load();
  } catch (err: any) {
    authError.value = err.response?.data?.error ?? t('accounts.errors.twoFaFailed');
  } finally {
    authBusy.value = false;
  }
}
</script>
