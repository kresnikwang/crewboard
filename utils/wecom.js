/**
 * WeChat Work (企业微信) Application Message API
 * Sends notifications to individual employees via self-built app.
 */

const WECOM_CORP_ID = process.env.WECOM_CORP_ID || 'wwb089e4801f755a98';
const WECOM_AGENT_ID = process.env.WECOM_AGENT_ID || '1000003';
const WECOM_SECRET = process.env.WECOM_SECRET || 'y2Ij4aQ2D_am20LaE48xTyaSVu7KtEPBpSnUrbz0dpE';

/* ---------- Access Token cache ---------- */
let _tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  // Return cached token if still valid (with 5min buffer)
  if (_tokenCache.token && Date.now() < _tokenCache.expiresAt - 300000) {
    return _tokenCache.token;
  }

  const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${WECOM_CORP_ID}&corpsecret=${WECOM_SECRET}`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.errcode !== 0) {
      console.error('[WeCom] gettoken failed:', data.errmsg);
      return null;
    }
    _tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000
    };
    console.log('[WeCom] Access token refreshed, expires in', data.expires_in, 's');
    return data.access_token;
  } catch (err) {
    console.error('[WeCom] gettoken error:', err.message);
    return null;
  }
}

/* ---------- Send text card message to a user ---------- */
async function sendCardMessage(userId, title, description, url) {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'no access_token' };

  const body = {
    touser: userId,
    msgtype: 'textcard',
    agentid: parseInt(WECOM_AGENT_ID, 10),
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
async function sendTextMessage(userId, content) {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: 'no access_token' };

  const body = {
    touser: userId,
    msgtype: 'text',
    agentid: parseInt(WECOM_AGENT_ID, 10),
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
async function getDepartmentUsers(deptId) {
  const token = await getAccessToken();
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
  const resource = db.prepare('SELECT wecom_userid, name FROM resources WHERE id = ?').get(resourceId);
  if (!resource || !resource.wecom_userid) return;

  const rangeStr = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
  const days = startDate === endDate ? 1 : Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1;

  const content = `📋 排班通知\n请查收您的工作安排更新：\n  项目：${projectName}\n  时间：${rangeStr}（${days}天）\n  工时：${hours}h/天\n  安排人：${bookerName || '未知'}`;

  sendTextMessage(resource.wecom_userid, content).catch(() => {});
}

function notifyBookingUpdated(db, resourceId, projectName, date, hours, bookerName) {
  const resource = db.prepare('SELECT wecom_userid, name FROM resources WHERE id = ?').get(resourceId);
  if (!resource || !resource.wecom_userid) return;

  const content = `✏️ 排班变更通知\n您的工作安排已更新：\n  项目：${projectName}\n  日期：${date}\n  工时：${hours}h\n  操作人：${bookerName || '未知'}`;

  sendTextMessage(resource.wecom_userid, content).catch(() => {});
}

function notifyBookingDeleted(db, resourceId, projectName, date, bookerName) {
  const resource = db.prepare('SELECT wecom_userid, name FROM resources WHERE id = ?').get(resourceId);
  if (!resource || !resource.wecom_userid) return;

  const content = `🗑️ 排班取消通知\n您的以下工作安排已取消：\n  项目：${projectName}\n  日期：${date}\n  操作人：${bookerName || '未知'}`;

  sendTextMessage(resource.wecom_userid, content).catch(() => {});
}

module.exports = {
  getAccessToken,
  sendCardMessage,
  sendTextMessage,
  getDepartmentUsers,
  notifyBookingCreated,
  notifyBookingUpdated,
  notifyBookingDeleted
};
