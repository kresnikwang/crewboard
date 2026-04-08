<template>
  <div class="auth-page">
    <div class="auth-card">
      <div class="auth-logo">
        <img src="/img/logo.svg" alt="CrewBoard" class="auth-logo-img" />
        <span class="auth-logo-text">神马排班</span>
      </div>
      <slot />
    </div>
    <div class="auth-footer">
      <span>CrewBoard &copy; {{ year }}</span>
    </div>
  </div>
</template>

<script setup>
const year = new Date().getFullYear()
</script>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: var(--bg);
  padding: 20px;
}
.auth-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 36px 40px;
  width: 100%;
  max-width: 420px;
  box-shadow: 0 4px 24px rgba(0,0,0,.08);
}
.auth-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
}
.auth-logo-img { width: 36px; height: 36px; }
.auth-logo-text { font-size: 20px; font-weight: 700; color: var(--text); }
.auth-footer {
  margin-top: 20px;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
