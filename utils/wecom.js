/**
 * WeChat Work (企业微信) Application Message API
 * Supports enterprise-level configuration stored in database,
 * with environment/default fallback for backward compatibility.
 */

const DEFAULT_WECOM_CORP_ID = process.env.WECOM_CORP_ID || 'wwb089e4801f755a98';
const DEFAULT_WECOM_AGENT_ID = process.env.WECOM_AGENT_ID || '1000003';
const DEFAULT_WECOM_SECRET = process.env.WECOM_SECRET || 'y2Ij4aQ2D_am20LaE48xTyaSVu7KtEPBpSnUrbz0dpE';
const DEFAULT_WECOM_DEPARTMENT_ID = Math.max(1, parseInt(process.env.WECOM_DEPARTMENT_ID, 10) || 1);

/* ---------- Access Token cache (per corp_id + secret) ---------- */
const _tokenCache = new Map();

function normalizeWeComConfig(raw) {
  const cfg = raw || {};
  return {
    corpId: (cfg.corpId || cfg.wecom_corp_id || DEFAULT_WECOM_CORP_ID || '').trim(),
    agentId: String(cfg.agentId || cfg.wecom_agent_id || DEFAULT_WECOM_AGENT_ID || '').trim(),
    secret: (cfg.secret || cfg.wecom_secret || DEFAULT_WECOM_SECRET || '').trim(),
    departmentId: Math.max(1, parseInt(cfg.departmentId || cfg.wecom_department_id, 10) || DEFAULT_WECOM_DEPARTMENT_ID)
  };
}

function getRuntimeWeComConfig(db, enterpriseId) {
  let enterpriseCfg = null;
  if (db && enterpriseId) {
    enterpriseCfg = db.prepare(`
      SELECT wecom_corp_id, wecom_agent_id, wecom_secret, wecom_department_id
      FROM enterprises WHERE id = ?
    `).get(enterpriseId);
  }
  return normalizeWeComConfig(enterpriseCfg || {});
}

function validateWeComConfig(config) {
  if (!config.corpId) return { ok: false, error: '缺少企业微信 Corp ID' };
  if (!config.agentId) return { ok: false, error: '缺少企业微信 Agent ID' };
  if (!config.secret) return { ok: false, error: '缺少企业微信 App Secret' };
  return { ok: true };
}

function buildWeComErrorMessage(data, fallback) {
  const errcode = data && typeof data.errcode !== 'undefined' ? data.errcode : null;
  const errmsg = data && data.errmsg ? data.errmsg : (fallback || '企业微信接口调用失败');
  if (errcode === 60020) {
    return '企业微信拒绝了当前服务器 IP，请把服务器出口 IP 加入该应用的可信 IP 白名单';
  }
  if (errcode === 40013) {
    return '企业微信 Corp ID 无效';
  }
  if (errcode === 40001 || errcode === 42001) {
    return '企业微信 access_token 无效或已过期';
  }
  if (errcode === 60111) {
    return '企业微信应用缺少通讯录相关权限，无法读取成员列表';
  }
  if (errcode === 48002) {
    return '企业微信接口权限不足，请检查应用可见范围或接口权限';
  }
  return errmsg;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function looksLikeEmail(value) {
  const text = String(value || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
}

function collectWeComEmailCandidates(user) {
  const candidates = [];
  [user.email, user.biz_mail, user.alias, user.userid].forEach(value => {
    const normalized = normalizeEmail(value);
    if (normalized && looksLikeEmail(normalized) && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  });
  return candidates;
}

async function getAccessToken(configInput) {
  const config = normalizeWeComConfig(configInput);
  const valid = validateWeComConfig(config);
  if (!valid.ok) {
    return { ok: false, error: valid.error, errcode: 'config_missing' };
  }

  const cacheKey = `${config.corpId}::${config.secret}`;
  const cached = _tokenCache.get(cacheKey);
  if (cached && cached.token && Date.now() < cached.expiresAt - 300000) {
    return { ok: true, token: cached.token, expiresAt: cached.expiresAt };
  }

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(config.corpId)}&corpsecret=${encodeURIComponent(config.secret)}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.errcode !== 0) {
      const error = buildWeComErrorMessage(data, '获取企业微信 access_token 失败');
      console.error('[WeCom] gettoken failed:', data.errcode, data.errmsg);
      return { ok: false, error, errcode: data.errcode, raw: data };
    }
    _tokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000
    });
    console.log('[WeCom] Access token refreshed, expires in', data.expires_in, 's');
    return { ok: true, token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  } catch (err) {
    console.error('[WeCom] gettoken error:', err.message);
    return { ok: false, error: `获取企业微信 access_token 失败：${err.message}`, errcode: 'network_error' };
  }
}

/* ---------- Send text card message to a user ---------- */
async function sendCardMessage(configInput, userId, title, description, url) {
  const tokenResult = await getAccessToken(configInput);
  if (!tokenResult.ok) return tokenResult;
  const config = normalizeWeComConfig(configInput);

  const body = {
    touser: userId,
    msgtype: 'textcard',
    agentid: parseInt(config.agentId, 10),
    textcard: {
      title: title,
      description: description,
      url: url || 'https://resource.skandstudio.com',
      btntxt: '查看详情'
    }
  };

  try {
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${tokenResult.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.errcode !== 0) {
      const error = buildWeComErrorMessage(data, '发送企业微信卡片消息失败');
      console.error('[WeCom] send message failed:', data.errcode, data.errmsg, 'userId:', userId);
      return { ok: false, error, errcode: data.errcode, raw: data };
    }
    console.log('[WeCom] Message sent to', userId);
    return { ok: true };
  } catch (err) {
    console.error('[WeCom] send message error:', err.message);
    return { ok: false, error: `发送企业微信卡片消息失败：${err.message}`, errcode: 'network_error' };
  }
}

/* ---------- Send plain text message ---------- */
async function sendTextMessage(configInput, userId, content) {
  const tokenResult = await getAccessToken(configInput);
  if (!tokenResult.ok) return tokenResult;
  const config = normalizeWeComConfig(configInput);

  const body = {
    touser: userId,
    msgtype: 'text',
    agentid: parseInt(config.agentId, 10),
    text: { content: content }
  };

  try {
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${tokenResult.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.errcode !== 0) {
      const error = buildWeComErrorMessage(data, '发送企业微信文本消息失败');
      console.error('[WeCom] send text failed:', data.errcode, data.errmsg, 'userId:', userId);
      return { ok: false, error, errcode: data.errcode, raw: data };
    }
    console.log('[WeCom] Text sent to', userId);
    return { ok: true };
  } catch (err) {
    console.error('[WeCom] send text error:', err.message);
    return { ok: false, error: `发送企业微信文本消息失败：${err.message}`, errcode: 'network_error' };
  }
}

/* ---------- Fetch department user list ---------- */
async function getDepartmentUsers(configInput, deptId) {
  const config = normalizeWeComConfig(configInput);
  const tokenResult = await getAccessToken(config);
  if (!tokenResult.ok) return { ok: false, users: [], error: tokenResult.error, errcode: tokenResult.errcode };

  const targetDeptId = Math.max(1, parseInt(deptId, 10) || config.departmentId || 1);

  try {
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/user/list?access_token=${tokenResult.token}&department_id=${targetDeptId}`);
    const data = await res.json();
    if (data.errcode !== 0) {
      const error = buildWeComErrorMessage(data, '获取企业微信通讯录失败');
      console.error('[WeCom] get users failed:', data.errcode, data.errmsg);
      return { ok: false, users: [], error, errcode: data.errcode, raw: data };
    }
    return {
      ok: true,
      users: (data.userlist || []).map(u => {
        const emailCandidates = collectWeComEmailCandidates(u);
        return {
          userid: u.userid,
          name: u.name,
          email: emailCandidates[0] || normalizeEmail(u.email || ''),
          email_candidates: emailCandidates,
          mobile: u.mobile || '',
          department: u.department
        };
      })
    };
  } catch (err) {
    console.error('[WeCom] get users error:', err.message);
    return { ok: false, users: [], error: `获取企业微信通讯录失败：${err.message}`, errcode: 'network_error' };
  }
}

/* ---------- Booking notification helpers ---------- */

function notifyBookingCreated(db, resourceId, projectName, startDate, endDate, hours, bookerName) {
  const resource = db.prepare('SELECT wecom_userid, name, enterprise_id FROM resources WHERE id = ?').get(resourceId);
  if (!resource || !resource.wecom_userid) return;

  const config = getRuntimeWeComConfig(db, resource.enterprise_id);
  const rangeStr = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
  const days = startDate === endDate ? 1 : Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1;

  const content = `📋 排班通知\n请查收您的工作安排更新：\n  项目：${projectName}\n  时间：${rangeStr}（${days}天）\n  工时：${hours}h/天\n  安排人：${bookerName || '未知'}`;

  sendTextMessage(config, resource.wecom_userid, content).catch(() => {});
}

function notifyBookingUpdated(db, resourceId, projectName, date, hours, bookerName) {
  const resource = db.prepare('SELECT wecom_userid, name, enterprise_id FROM resources WHERE id = ?').get(resourceId);
  if (!resource || !resource.wecom_userid) return;

  const config = getRuntimeWeComConfig(db, resource.enterprise_id);
  const content = `✏️ 排班变更通知\n您的工作安排已更新：\n  项目：${projectName}\n  日期：${date}\n  工时：${hours}h\n  操作人：${bookerName || '未知'}`;

  sendTextMessage(config, resource.wecom_userid, content).catch(() => {});
}

function notifyBookingDeleted(db, resourceId, projectName, date, bookerName) {
  const resource = db.prepare('SELECT wecom_userid, name, enterprise_id FROM resources WHERE id = ?').get(resourceId);
  if (!resource || !resource.wecom_userid) return;

  const config = getRuntimeWeComConfig(db, resource.enterprise_id);
  const content = `🗑️ 排班取消通知\n您的以下工作安排已取消：\n  项目：${projectName}\n  日期：${date}\n  操作人：${bookerName || '未知'}`;

  sendTextMessage(config, resource.wecom_userid, content).catch(() => {});
}

module.exports = {
  normalizeWeComConfig,
  getRuntimeWeComConfig,
  validateWeComConfig,
  normalizeEmail,
  getAccessToken,
  sendCardMessage,
  sendTextMessage,
  getDepartmentUsers,
  notifyBookingCreated,
  notifyBookingUpdated,
  notifyBookingDeleted
};
