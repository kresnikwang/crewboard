/**
 * WeChat Work (企业微信) Application Message API
 * Sends notifications to individual employees via self-built app.
 * Config is read from enterprise DB settings, with env var fallback.
 */

/* ---------- Config helper ---------- */
function getWecomConfig(db, enterpriseId) {
  if (db && enterpriseId) {
    try {
      const ent = db.prepare('SELECT wecom_corp_id, wecom_agent_id, wecom_secret FROM enterprises WHERE id = ?').get(enterpriseId);
      if (ent && ent.wecom_corp_id) {
        return {
          corpId: ent.wecom_corp_id,
          agentId: ent.wecom_agent_id || '',
          secret: ent.wecom_secret || ''
        };
      }
    } catch (_) {}
  }
  // Fallback to env vars
  return {
    corpId: process.env.WECOM_CORP_ID || '',
    agentId: process.env.WECOM_AGENT_ID || '',
    secret: process.env.WECOM_SECRET || ''
  };
}

/* ---------- Access Token cache (keyed by corpId) ---------- */
const _tokenCache = {};

async function getAccessToken(config) {
  if (!config || !config.corpId || !config.secret) return null;

  const key = config.corpId;
  if (!_tokenCache[key]) _tokenCache[key] = { token: null, expiresAt: 0 };
  const cache = _tokenCache[key];

  if (cache.token && Date.now() < cache.expiresAt - 300000) {
    return cache.token;
  }

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${config.corpId}&corpsecret=${config.secret}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.errcode !== 0) {
      console.error('[WeCom] gettoken failed:', data.errmsg);
      return null;
    }
    cache.token = data.access_token;
    cache.expiresAt = Date.now() + data.expires_in * 1000;
    console.log('[WeCom] Access token refreshed, expires in', data.expires_in, 's');
    return data.access_token;
  } catch (err) {
    console.error('[WeCom] gettoken error:', err.message);
    return null;
  }
}

/* ---------- Send text card message to a user ---------- */
async function sendCardMessage(config, userId, title, description, url) {
  const token = await getAccessToken(config);
  if (!token) return { ok: false, error: 'no access_token' };

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
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.errcode !== 0) {
      console.error('[WeCom] send message failed:', data.errmsg, 'userId:', userId);
      return { ok: false, error: data.errmsg };
    }
    console.log('[WeCom] Message sent to', userId);
    return { ok: true };
  } catch (err) {
    console.error('[WeCom] send message error:', err.message);
    return { ok: false, error: err.message };
  }
}

/* ---------- Send plain text message ---------- */
async function sendTextMessage(config, userId, content) {
  const token = await getAccessToken(config);
  if (!token) return { ok: false, error: 'no access_token' };

  const body = {
    touser: userId,
    msgtype: 'text',
    agentid: parseInt(config.agentId, 10),
    text: { content: content }
  };

  try {
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.errcode !== 0) {
      console.error('[WeCom] send text failed:', data.errmsg, 'userId:', userId);
      return { ok: false, error: data.errmsg };
    }
    console.log('[WeCom] Text sent to', userId);
    return { ok: true };
  } catch (err) {
    console.error('[WeCom] send text error:', err.message);
    return { ok: false, error: err.message };
  }
}

/* ---------- Fetch department user list ---------- */
async function getDepartmentUsers(config, deptId) {
  const token = await getAccessToken(config);
  if (!token) return [];

  try {
    const res = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/user/list?access_token=${token}&department_id=${deptId || 1}`);
    const data = await res.json();
    if (data.errcode !== 0) {
      console.error('[WeCom] get users failed:', data.errmsg);
      return [];
    }
    return (data.userlist || []).map(u => ({
      userid: u.userid,
      name: u.name,
      email: u.email || '',
      mobile: u.mobile || '',
      department: u.department
    }));
  } catch (err) {
    console.error('[WeCom] get users error:', err.message);
    return [];
  }
}

/* ---------- Booking notification helpers ---------- */

function notifyBookingCreated(db, resourceId, projectName, startDate, endDate, hours, bookerName) {
  const resource = db.prepare('SELECT wecom_userid, name, enterprise_id FROM resources WHERE id = ?').get(resourceId);
  if (!resource || !resource.wecom_userid) return;

  const config = getWecomConfig(db, resource.enterprise_id);
  if (!config.corpId) return;

  const rangeStr = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
  const days = startDate === endDate ? 1 : Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1;

  const content = `📋 排班通知\n请查收您的工作安排更新：\n  项目：${projectName}\n  时间：${rangeStr}（${days}天）\n  工时：${hours}h/天\n  安排人：${bookerName || '未知'}`;

  sendTextMessage(config, resource.wecom_userid, content).catch(() => {});
}

function notifyBookingUpdated(db, resourceId, projectName, date, hours, bookerName) {
  const resource = db.prepare('SELECT wecom_userid, name, enterprise_id FROM resources WHERE id = ?').get(resourceId);
  if (!resource || !resource.wecom_userid) return;

  const config = getWecomConfig(db, resource.enterprise_id);
  if (!config.corpId) return;

  const content = `✏️ 排班变更通知\n您的工作安排已更新：\n  项目：${projectName}\n  日期：${date}\n  工时：${hours}h\n  操作人：${bookerName || '未知'}`;

  sendTextMessage(config, resource.wecom_userid, content).catch(() => {});
}

function notifyBookingDeleted(db, resourceId, projectName, date, bookerName) {
  const resource = db.prepare('SELECT wecom_userid, name, enterprise_id FROM resources WHERE id = ?').get(resourceId);
  if (!resource || !resource.wecom_userid) return;

  const config = getWecomConfig(db, resource.enterprise_id);
  if (!config.corpId) return;

  const content = `🗑️ 排班取消通知\n您的以下工作安排已取消：\n  项目：${projectName}\n  日期：${date}\n  操作人：${bookerName || '未知'}`;

  sendTextMessage(config, resource.wecom_userid, content).catch(() => {});
}

module.exports = {
  getWecomConfig,
  getAccessToken,
  sendCardMessage,
  sendTextMessage,
  getDepartmentUsers,
  notifyBookingCreated,
  notifyBookingUpdated,
  notifyBookingDeleted
};
