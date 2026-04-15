/**
 * Email utility module - SMTP email sending for CrewBoard
 */
const nodemailer = require('nodemailer');

/* ---------- SMTP Configuration ---------- */
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.exmail.qq.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_SECURE = process.env.SMTP_SECURE !== 'false'; // default true for port 465
const SMTP_USER = process.env.SMTP_USER || 'resource@skandstudio.com';
const SMTP_PASS = process.env.SMTP_PASS || 'ABab123.';
const SMTP_FROM = process.env.SMTP_FROM || '"神马排班 CrewBoard" <resource@skandstudio.com>';
const APP_URL = process.env.APP_URL || 'https://resource.skandstudio.com';

let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_SECURE,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      tls: { rejectUnauthorized: false }
    });
  }
  return transporter;
}

/* ---------- Send email helper ---------- */
async function sendMail(to, subject, html) {
  try {
    const info = await getTransporter().sendMail({
      from: SMTP_FROM,
      to,
      subject,
      html
    });
    console.log('[Email] Sent to', to, '- messageId:', info.messageId);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Email] Failed to send to', to, '-', err.message);
    return { ok: false, error: err.message };
  }
}

/* ---------- Email templates ---------- */

function passwordResetEmail(userName, resetLink) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#6366F1;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">神马排班 CrewBoard</h1>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 16px;font-size:15px;color:#374151;">你好${userName ? ' ' + userName : ''}，</p>
      <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
        我们收到了你的密码重置请求。请点击下方按钮设置新密码：
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${resetLink}" style="display:inline-block;background:#6366F1;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;">
          重置密码
        </a>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#9CA3AF;line-height:1.5;">
        如果按钮无法点击，请复制以下链接到浏览器：
      </p>
      <p style="margin:0 0 24px;font-size:12px;color:#6366F1;word-break:break-all;">${resetLink}</p>
      <p style="margin:0;font-size:13px;color:#9CA3AF;line-height:1.5;">
        此链接30分钟内有效。如果你没有请求重置密码，请忽略此邮件。
      </p>
    </div>
    <div style="padding:16px 32px;background:#F9FAFB;border-top:1px solid #E5E7EB;">
      <p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;">© 神马排班 CrewBoard · skandstudio.com</p>
    </div>
  </div>
</body>
</html>`;
}

function invitationEmail(inviterName, enterpriseName, inviteLink) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:40px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
    <div style="background:#6366F1;padding:28px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:600;">神马排班 CrewBoard</h1>
    </div>
    <div style="padding:32px;">
      <p style="margin:0 0 16px;font-size:15px;color:#374151;">你好，</p>
      <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
        <strong>${inviterName || '管理员'}</strong> 邀请你加入团队
        <strong>「${enterpriseName}」</strong>，使用神马排班进行项目资源管理。
      </p>
      <div style="text-align:center;margin:0 0 24px;">
        <a href="${inviteLink}" style="display:inline-block;background:#6366F1;color:#fff;text-decoration:none;padding:12px 32px;border-radius:8px;font-size:15px;font-weight:600;">
          接受邀请
        </a>
      </div>
      <p style="margin:0 0 8px;font-size:13px;color:#9CA3AF;line-height:1.5;">
        如果按钮无法点击，请复制以下链接到浏览器：
      </p>
      <p style="margin:0 0 24px;font-size:12px;color:#6366F1;word-break:break-all;">${inviteLink}</p>
      <p style="margin:0;font-size:13px;color:#9CA3AF;line-height:1.5;">
        注册后将自动加入团队。如果你不认识邀请人，请忽略此邮件。
      </p>
    </div>
    <div style="padding:16px 32px;background:#F9FAFB;border-top:1px solid #E5E7EB;">
      <p style="margin:0;font-size:12px;color:#9CA3AF;text-align:center;">© 神马排班 CrewBoard · skandstudio.com</p>
    </div>
  </div>
</body>
</html>`;
}

module.exports = {
  sendMail,
  passwordResetEmail,
  invitationEmail,
  APP_URL
};
