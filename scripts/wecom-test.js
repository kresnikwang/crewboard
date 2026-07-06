#!/usr/bin/env node
/**
 * wecom-test.js — 企业微信应用消息端到端诊断 / 测试脚本
 *
 * 用途：
 *   1. 按邮箱或姓名定位一个 resource（默认 kris.wang@skandstudio.com）
 *   2. 打印该 resource 所属企业的有效企业微信配置（脱敏）
 *   3. 拉取企业微信通讯录（getDepartmentUsers）
 *   4. 若 resource 尚未绑定 wecom_userid，则按 邮箱→姓名 自动匹配并写回数据库
 *   5. 发送与 booking 创建通知完全一致的「📋 排班通知」文本消息，并打印完整发送结果
 *
 * 注意：企业微信通讯录 / 应用消息接口受「可信 IP 白名单」限制，
 *       必须在已加入白名单的服务器上运行（否则会返回 errcode 60020）。
 *
 * 用法：
 *   node scripts/wecom-test.js                       # 默认 kris.wang@skandstudio.com
 *   node scripts/wecom-test.js someone@example.com   # 指定邮箱
 *   node scripts/wecom-test.js "Kris Wang"           # 指定姓名
 */

const { initDB } = require('../db/schema');
const {
  getRuntimeWeComConfig,
  validateWeComConfig,
  getDepartmentUsers,
  sendTextMessage,
  normalizeEmail
} = require('../utils/wecom');

const TARGET = (process.argv[2] || 'kris.wang@skandstudio.com').trim();

function mask(secret) {
  if (!secret) return '(empty)';
  if (secret.length <= 8) return '****';
  return secret.slice(0, 4) + '…' + secret.slice(-4);
}

// Mirror of utils/wecom.js notifyBookingCreated content (keep in sync).
function buildCreatedContent(projectName, startDate, endDate, hours, bookerName) {
  const rangeStr = startDate === endDate ? startDate : `${startDate} ~ ${endDate}`;
  const days = startDate === endDate
    ? 1
    : Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000) + 1;
  return `📋 排班通知\n请查收您的工作安排更新：\n  项目：${projectName}\n  时间：${rangeStr}（${days}天）\n  工时：${hours}h/天\n  安排人：${bookerName || '未知'}`;
}

async function main() {
  const db = initDB();
  console.log('=== [1/5] 定位 resource ===');
  console.log('目标:', TARGET);

  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(TARGET);
  let resource = null;

  if (isEmail) {
    const norm = normalizeEmail(TARGET);
    resource = db.prepare('SELECT id, name, email, enterprise_id, wecom_userid FROM resources WHERE lower(email) = ?').get(norm);
    if (!resource) {
      // Fall back to users table -> linked resource
      const user = db.prepare('SELECT id, name, email, resource_id, enterprise_id FROM users WHERE lower(email) = ?').get(norm);
      if (user && user.resource_id) {
        resource = db.prepare('SELECT id, name, email, enterprise_id, wecom_userid FROM resources WHERE id = ?').get(user.resource_id);
      }
      if (!resource && user) {
        console.log(`⚠️  找到用户 ${user.name}(${user.email})，但其未关联 resource（resource_id=${user.resource_id}）。`);
      }
    }
  } else {
    resource = db.prepare('SELECT id, name, email, enterprise_id, wecom_userid FROM resources WHERE name = ?').get(TARGET)
      || db.prepare("SELECT id, name, email, enterprise_id, wecom_userid FROM resources WHERE name LIKE ?").get('%' + TARGET + '%');
  }

  if (!resource) {
    console.error('❌ 未找到匹配的 resource。');
    const some = db.prepare('SELECT id, name, email, enterprise_id, wecom_userid FROM resources ORDER BY id LIMIT 20').all();
    console.log('现有 resources（前 20）:');
    some.forEach(r => console.log('   ', JSON.stringify(r)));
    process.exit(2);
  }
  console.log('✅ resource:', JSON.stringify(resource));

  console.log('\n=== [2/5] 有效企业微信配置（脱敏）===');
  const config = getRuntimeWeComConfig(db, resource.enterprise_id);
  console.log(JSON.stringify({ corpId: config.corpId, agentId: config.agentId, departmentId: config.departmentId, secret: mask(config.secret) }));
  const check = validateWeComConfig(config);
  if (!check.ok) {
    console.error('❌ 配置无效:', check.error);
    process.exit(3);
  }

  console.log('\n=== [3/5] 拉取企业微信通讯录 ===');
  const dept = await getDepartmentUsers(config, config.departmentId);
  if (!dept.ok) {
    console.error('❌ 通讯录拉取失败:', dept.errcode, dept.error);
    if (dept.raw) console.error('   raw:', JSON.stringify(dept.raw));
    if (dept.errcode === 60020) {
      console.error('   👉 请把本服务器出口 IP 加入企业微信「自建应用 → 开发者接口 → 企业可信IP」白名单。');
    }
    // Continue only if we already have a bound userid; otherwise abort.
    if (!resource.wecom_userid) process.exit(4);
    console.error('   ⚠️  通讯录不可用，但该 resource 已有 wecom_userid，继续尝试直接发消息。');
  } else {
    console.log(`✅ 通讯录成员数: ${dept.users.length}`);
    dept.users.forEach(u => console.log('   ', JSON.stringify({ userid: u.userid, name: u.name, email: u.email, cands: u.email_candidates })));
  }

  console.log('\n=== [4/5] 确保 wecom_userid 绑定 ===');
  if (!resource.wecom_userid && dept.ok) {
    const norm = normalizeEmail(resource.email);
    const byEmail = norm ? dept.users.find(u => Array.isArray(u.email_candidates) && u.email_candidates.includes(norm)) : null;
    const byName = dept.users.find(u => u.name === resource.name);
    const found = byEmail || byName;
    if (found) {
      db.prepare('UPDATE resources SET wecom_userid = ? WHERE id = ?').run(found.userid, resource.id);
      resource.wecom_userid = found.userid;
      console.log(`✅ 已匹配并绑定 wecom_userid=${found.userid}（by ${byEmail ? 'email' : 'name'}）`);
    } else {
      console.error('❌ 通讯录中未找到与该 resource 邮箱/姓名匹配的成员，无法绑定 wecom_userid。');
      process.exit(5);
    }
  } else if (resource.wecom_userid) {
    console.log('✅ 已绑定 wecom_userid=', resource.wecom_userid);
  } else {
    console.error('❌ 无 wecom_userid 且通讯录不可用，无法发送。');
    process.exit(5);
  }

  console.log('\n=== [5/5] 发送「📋 排班通知」测试消息 ===');
  const content = buildCreatedContent('XX品牌设计', '2026-04-16', '2026-04-18', 8, 'Kris Wang');
  console.log('内容预览:\n' + content + '\n');
  const result = await sendTextMessage(config, resource.wecom_userid, content);
  console.log('发送结果:', JSON.stringify(result));
  if (result.ok) {
    console.log(`\n🎉 成功：已发送到 ${resource.name}（wecom_userid=${resource.wecom_userid}）。请在企业微信中查收。`);
    process.exit(0);
  } else {
    console.error(`\n❌ 发送失败：errcode=${result.errcode} error=${result.error}`);
    if (result.errcode === 60020) {
      console.error('   👉 服务器出口 IP 未在企业微信可信 IP 白名单中。');
    }
    process.exit(6);
  }
}

main().catch(err => { console.error('脚本异常:', err); process.exit(1); });
