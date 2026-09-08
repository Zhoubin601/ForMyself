<script setup>
import { toRefs } from 'vue'
const props = defineProps({ model: { type: Object, required: true } })
const { authStore, autoLockLabel, autoLockPickerOpen, changeMasterPassword, changeMasterPasswordBio, confirmNewPwdInput, enableBiometricUnlock, isChangingPwd, isChangingPwdBio, isGeneralSection, lockApp, newPwdInput, oldPwdInput, triggerBioChangePwd } = toRefs(props.model)
</script>

<template>
    <div v-if="isGeneralSection('security')" class="setting-section">
      <h3 class="caption body-muted section-title">安全管理</h3>
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
        <p class="caption body-muted" style="margin: 10px 0 0;">超过设定时间返回应用时，需要重新输入主密码或验证指纹。</p>
      </div>

      <div v-if="isChangingPwd || isChangingPwdBio" class="store-utility-card">
        <h4 class="body-strong" style="margin-top:0;">重设空间密码</h4>
        <div v-if="isChangingPwd" class="input-group"><input v-model="oldPwdInput" type="password" placeholder="原主密码" class="apple-input" /></div>
        <div class="input-group"><input v-model="newPwdInput" type="password" placeholder="新主密码" class="apple-input" /></div>
        <div class="input-group"><input v-model="confirmNewPwdInput" type="password" placeholder="确认新主密码" class="apple-input" /></div>
        <div style="display: flex; gap: 12px; margin-top: 24px;">
          <button class="button-primary" style="flex:1" @click="isChangingPwdBio ? changeMasterPasswordBio() : changeMasterPassword()">保存</button>
          <button class="button-secondary-pill" style="flex:1" @click="isChangingPwd = false; isChangingPwdBio = false">放弃</button>
        </div>
      </div>
    </div>
</template>
