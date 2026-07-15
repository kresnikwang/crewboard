/**
 * wecom.js routes
 */
const express = require('express');
const { getDepartmentUsers, getRuntimeWeComConfig, validateWeComConfig, normalizeEmail, sendTextMessage, sendCardMessage } = require('../../utils/wecom');
const { logAudit } = require('../../utils/audit');

module.exports = function register(router, ctx) {
  const { db, authz, isAdmin, isManagerOrAdmin, saveAvatarHelper, sseBroadcast } = ctx;

// === WECOM SYNC ===

// Fetch WeCom department users and auto-match by name
router.post('/wecom/sync', async (req, res) => {
  if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
  if (!isAdmin(req.user)) return res.status(403).json({ error: '仅管理员可操作' });

  const config = getRuntimeWeComConfig(db, req.user.enterprise_id);
  const configCheck = validateWeComConfig(config);
  if (!configCheck.ok) {
    return res.status(400).json({ error: configCheck.error, code: 'config_missing' });
  }

  const wecomResult = await getDepartmentUsers(config, config.departmentId);
  if (!wecomResult.ok) {
    const status = wecomResult.errcode === 60020 ? 400 : 500;
    return res.status(status).json({
      error: wecomResult.error || '无法获取企业微信通讯录',
      code: wecomResult.errcode || 'wecom_sync_failed',
      details: wecomResult.raw || null,
      ip_hint: wecomResult.errcode === 60020 ? '请把当前服务器出口 IP 加入企业微信应用的可信 IP 白名单' : ''
    });
  }

  const wecomUsers = wecomResult.users || [];
  if (wecomUsers.length === 0) {
    return res.status(400).json({ error: '企业微信通讯录为空，或应用无权访问当前部门成员', code: 'empty_department_users' });
  }

  const resources = db.prepare('SELECT id, name, email FROM resources WHERE enterprise_id = ? AND is_active = 1').all(req.user.enterprise_id);
  const matched = [];
  const unmatched = [];

  const update = db.prepare('UPDATE resources SET wecom_userid = ? WHERE id = ?');
  const tx = db.transaction(() => {
    resources.forEach(r => {
      const resourceEmail = normalizeEmail(r.email);
      const foundByEmail = resourceEmail
        ? wecomUsers.find(wu => Array.isArray(wu.email_candidates) && wu.email_candidates.includes(resourceEmail))
        : null;
      const foundByName = wecomUsers.find(wu => wu.name === r.name);
      const found = foundByEmail || foundByName;
      if (found) {
        update.run(found.userid, r.id);
        matched.push({
          resource: r.name,
          wecom_userid: found.userid,
          matched_by: foundByEmail ? 'email' : 'name'
        });
      } else {
        unmatched.push({ resource: r.name, id: r.id, email: r.email || '' });
      }
    });
  });
  tx();

  res.json({
    ok: true,
    department_id: config.departmentId,
    matched,
    unmatched,
    wecom_users: wecomUsers.map(u => ({ userid: u.userid, name: u.name, email: u.email || '', email_candidates: u.email_candidates || [] }))
  });
});

router.post('/wecom/test-message', async (req, res) => {
  if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
  if (!isAdmin(req.user)) return res.status(403).json({ error: '仅管理员可操作' });

  const resourceId = parseInt(req.body.resource_id, 10);
  const messageType = String(req.body.message_type || 'schedule_created').trim();
  if (!resourceId) return res.status(400).json({ error: '请选择员工', code: 'resource_required' });

  const config = getRuntimeWeComConfig(db, req.user.enterprise_id);
  const configCheck = validateWeComConfig(config);
  if (!configCheck.ok) {
    return res.status(400).json({ error: configCheck.error, code: 'config_missing' });
  }

  const resource = db.prepare(`
    SELECT id, name, email, wecom_userid
    FROM resources
    WHERE id = ? AND enterprise_id = ? AND is_active = 1
  `).get(resourceId, req.user.enterprise_id);

  if (!resource) {
    return res.status(404).json({ error: '员工不存在', code: 'resource_not_found' });
  }
  if (!resource.wecom_userid) {
    return res.status(400).json({ error: '该员工尚未绑定企业微信 ID，请先完成通讯录同步或手动绑定', code: 'wecom_userid_missing' });
  }

  const messageFactories = {
    schedule_created: function () {
      return {
        label: '排班创建通知',
        sender: function () {
          return sendTextMessage(config, resource.wecom_userid, [
            '📋 排班通知（测试）',
            `员工：${resource.name}`,
            '项目：企业微信应用消息测试',
            '时间：2026-04-20 ~ 2026-04-22（3天）',
            '工时：8h/天',
            `操作人：${req.user.name || '系统管理员'}`
          ].join('\n'));
        }
      };
    },
    schedule_updated: function () {
      return {
        label: '排班变更通知',
        sender: function () {
          return sendTextMessage(config, resource.wecom_userid, [
            '✏️ 排班变更通知（测试）',
            `员工：${resource.name}`,
            '项目：企业微信应用消息测试',
            '日期：2026-04-21',
            '工时：6h',
            `操作人：${req.user.name || '系统管理员'}`
          ].join('\n'));
        }
      };
    },
    schedule_deleted: function () {
      return {
        label: '排班取消通知',
        sender: function () {
          return sendTextMessage(config, resource.wecom_userid, [
            '🗑️ 排班取消通知（测试）',
            `员工：${resource.name}`,
            '项目：企业微信应用消息测试',
            '日期：2026-04-22',
            `操作人：${req.user.name || '系统管理员'}`
          ].join('\n'));
        }
      };
    },
    text_card: function () {
      return {
        label: '卡片消息',
        sender: function () {
          return sendCardMessage(
            config,
            resource.wecom_userid,
            '企业微信应用消息测试',
            `员工：${resource.name}<br/>类型：卡片消息<br/>发送人：${req.user.name || '系统管理员'}<br/>这是一条用于验证应用消息链路的测试消息。`,
            'https://resource.skandstudio.com'
          );
        }
      };
    }
  };

  const factory = messageFactories[messageType];
  if (!factory) {
    return res.status(400).json({ error: '不支持的测试消息类型', code: 'message_type_invalid' });
  }

  const message = factory();
  const sendResult = await message.sender();
  if (!sendResult.ok) {
    return res.status(400).json({
      error: sendResult.error || '发送测试消息失败',
      code: sendResult.errcode || 'wecom_test_send_failed',
      details: sendResult.raw || null
    });
  }

  res.json({
    ok: true,
    resource: {
      id: resource.id,
      name: resource.name,
      email: resource.email || '',
      wecom_userid: resource.wecom_userid
    },
    message_type: messageType,
    message_label: message.label
  });
});

// Manually set wecom_userid for a resource
router.put('/resources/:id/wecom', (req, res) => {
  if (!req.user?.enterprise_id) return res.status(403).json({ error: '无权限' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: '仅管理员可操作' });

  const { wecom_userid } = req.body;
  db.prepare('UPDATE resources SET wecom_userid = ? WHERE id = ? AND enterprise_id = ?')
    .run(wecom_userid || '', req.params.id, req.user.enterprise_id);
  res.json({ ok: true });
});

};
