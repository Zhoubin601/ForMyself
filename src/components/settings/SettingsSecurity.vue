<script setup>
import { toRefs } from 'vue'
const props = defineProps({ model: { type: Object, required: true } })
const { authStore, settingsStore, passwordChangeBusy, isUpdatingEntryVerification, updateEntryVerification, autoLockLabel, autoLockPickerOpen, changeMasterPassword, changeMasterPasswordBio, confirmNewPwdInput, enableBiometricUnlock, isChangingPwd, isChangingPwdBio, isGeneralSection, lockApp, newPwdInput, oldPwdInput, triggerBioChangePwd } = toRefs(props.model)
</script>

<template>
    <div v-if="isGeneralSection('security')" class="setting-section">
      <h3 class="caption body-muted section-title">安全管理</h3>
      <div class="store-utility-card">
        <label class="entry-verification-setting">
          <span>进入应用时需要验证</span>
          <input id="require-app-unlock" type="checkbox" role="switch" :checked="settingsStore.requireAppUnlock" :disabled="isUpdatingEntryVerification" @change="updateEntryVerification" />
        </label>
        <p class="caption body-muted">开启时统一解锁应用、密码库和聊天；关闭后直接进入首页，密码库和聊天使用时分别解密。普通页面的个人信息将可直接查看。</p>
      </div>
      <div v-if="!isChangingPwd && !isChangingPwdBio" class="ios-list">
        <button v-if="authStore.needsBiometricSetup" class="list-item text-link" style="text-align: left;" @click="enableBiometricUnlock">启用指纹快捷解锁</button>
        <button v-if="authStore.biometricCredentialReady" class="list-item text-link" style="text-align: left;" @click="triggerBioChangePwd">指纹生物识别修改密码</button>
        <button class="list-item text-link" style="text-align: left;" @click="isChangingPwd = true">传统密码验证修改</button>
        <button class="list-item text-link destructive" style="text-align: left;" @click="lockApp">安全锁定当前空间</button>
      </div>

      <div class="store-utility-card" style="margin-top: 12px;">
        <label class="caption" style="display: block; margin-bottom: 10px;">进入后台后自动锁定</label>
        <button class="backup-type-button" @click="autoLockPickerOpen = true">
          <span>{{ autoLockLabel }}</span>
          <b>›</b>
        </button>
        <p class="caption body-muted" style="margin: 10px 0 0;">{{ settingsStore.requireAppUnlock ? '超过设定时间返回应用时，需要重新输入主密码或验证指纹。' : '超过设定时间后，密码库和聊天需要重新验证，普通页面仍可直接使用。' }}</p>
      </div>

      <div v-if="isChangingPwd || isChangingPwdBio" class="store-utility-card">
        <h4 class="body-strong" style="margin-top:0;">重设空间密码</h4>
        <div v-if="isChangingPwd" class="input-group"><input v-model="oldPwdInput" type="password" placeholder="原主密码" class="apple-input" /></div>
        <div class="input-group"><input v-model="newPwdInput" type="password" placeholder="新主密码" class="apple-input" /></div>
        <div class="input-group"><input v-model="confirmNewPwdInput" type="password" placeholder="确认新主密码" class="apple-input" /></div>
        <div style="display: flex; gap: 12px; margin-top: 24px;">
          <button class="button-primary" style="flex:1" :disabled="passwordChangeBusy" @click="isChangingPwdBio ? changeMasterPasswordBio() : changeMasterPassword()">{{ passwordChangeBusy ? '正在保存…' : '保存' }}</button>
          <button class="button-secondary-pill" style="flex:1" @click="isChangingPwd = false; isChangingPwdBio = false">放弃</button>
        </div>
      </div>
    </div>
</template>

<style scoped>
.entry-verification-setting { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 44px; }
.entry-verification-setting input { width: 24px; height: 24px; flex-shrink: 0; accent-color: var(--primary); }
</style>
