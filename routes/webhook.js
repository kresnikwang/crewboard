// Webhook notification helper for DingTalk, WeCom, Feishu

async function sendWebhook(url, platform, message) {
  if (!url) return;
  let body;

  switch (platform) {
    case 'dingtalk':
      body = { msgtype: 'text', text: { content: `[神马排班] ${message}` } };
      break;
    case 'wecom':
      body = { msgtype: 'text', text: { content: `[神马排班] ${message}` } };
      break;
    case 'feishu':
      body = { msg_type: 'text', content: { text: `[神马排班] ${message}` } };
      break;
    default:
      return;
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.error(`Webhook ${platform} failed:`, response.status);
    }
  } catch (err) {
    console.error(`Webhook ${platform} error:`, err.message);
  }
}

async function notifyAll(db, enterpriseId, message) {
  if (!enterpriseId) return;
  const enterprise = db.prepare('SELECT webhook_dingtalk, webhook_wecom, webhook_feishu FROM enterprises WHERE id = ?').get(enterpriseId);
  if (!enterprise) return;

  const promises = [];
  if (enterprise.webhook_dingtalk) promises.push(sendWebhook(enterprise.webhook_dingtalk, 'dingtalk', message));
  if (enterprise.webhook_wecom) promises.push(sendWebhook(enterprise.webhook_wecom, 'wecom', message));
  if (enterprise.webhook_feishu) promises.push(sendWebhook(enterprise.webhook_feishu, 'feishu', message));

  await Promise.allSettled(promises);
}

module.exports = { sendWebhook, notifyAll };
