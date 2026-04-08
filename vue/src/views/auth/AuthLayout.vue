<template>
  <div class="auth-page">
    <!-- Left branding panel -->
    <div class="auth-brand">
      <div class="auth-brand-inner">
        <div class="auth-brand-logo">
          <svg width="36" height="36" viewBox="0 0 28 28" fill="none">
            <rect width="28" height="28" rx="6" fill="rgba(255,255,255,.15)"/>
            <path d="M8 22L8 18C8 16 8.5 14 9.5 12.5L11 10C10.5 9.5 10 8.5 10 7.5C10 6 11 5 12.5 5C13 5 13.5 5.3 14 5.8L15.5 4L16.5 5L15 7C15.5 7.5 16 8.5 16 9.5C16 10.5 15.5 11 15 11.5L13 14C12 15.5 11.5 17 11.5 18L11.5 22Z" fill="#fff"/>
            <circle cx="12.5" cy="7.8" r="1" fill="rgba(255,255,255,.15)"/>
            <rect x="17" y="13.5" width="5.5" height="2" rx="1" fill="#fff" opacity=".8"/>
            <rect x="17" y="17.5" width="4" height="2" rx="1" fill="#fff" opacity=".5"/>
            <rect x="17" y="21.5" width="5" height="2" rx="1" fill="#fff" opacity=".3"/>
          </svg>
          <span>神马排班CrewBoard</span>
        </div>
        <h2 class="auth-brand-title">高效团队资源<br>排程与管理</h2>
        <p class="auth-brand-desc">统一管理团队排程、工时追踪和项目资源，让协作更高效。</p>
        <div class="auth-features">
          <div class="auth-feature">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="3" width="16" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M2 7h16M6 1v4M14 1v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <div>
              <div class="auth-feature-title">可视化排程</div>
              <div class="auth-feature-desc">拖拽式日历视图，一目了然掌握团队动态</div>
            </div>
          </div>
          <div class="auth-feature">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="8" stroke="currentColor" stroke-width="1.5"/>
              <path d="M10 6v4l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <div>
              <div class="auth-feature-title">工时追踪</div>
              <div class="auth-feature-desc">精确记录每日工时，自动生成利用率报表</div>
            </div>
          </div>
          <div class="auth-feature">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 17V9h3v8H3zM8.5 17V5h3v12h-3zM14 17V2h3v15h-3z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <div>
              <div class="auth-feature-title">数据报表</div>
              <div class="auth-feature-desc">多维度分析，支持 Excel 导出与人民币核算</div>
            </div>
          </div>
          <div class="auth-feature">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="4" width="16" height="13" rx="2" stroke="currentColor" stroke-width="1.5"/>
              <path d="M7 4V2h6v2M10 9v4M8 11h4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <div>
              <div class="auth-feature-title">企业协作</div>
              <div class="auth-feature-desc">多角色权限管理，钉钉/企微/飞书消息通知</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Right form panel -->
    <div class="auth-form-panel">
      <div class="auth-card">
        <slot />
        <div class="auth-footer">
          <span>本地部署版本</span>
          <span class="auth-footer-dot"></span>
          <span>数据安全存储在您的服务器</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
</script>
