#!/usr/bin/env node
/**
 * reminder-project-code.js
 * 定期提醒"项目创建人"补全缺失的项目编号（project code）。
 *
 * 规则：
 *   - 只提醒 is_active=1 且 is_archived=0 的项目；已存档的项目不再提醒。
 *   - 只提醒 code 为空或纯空白字符串的项目。
 *   - 按 created_by 聚合，每人一条消息，列出 TA 名下所有缺编号的项目，
 *     避免一个人收到 N 条消息。
 *   - 收件人通过 created_by -> users.resource_id -> resources.wecom_userid 解析；
 *     账号已删除、资源已停用或未绑定企业微信的项目只记录日志、不发送。
 *   - created_by 为 NULL 的历史项目（旧演示数据）没有可通知的人，跳过并计数。
 *
 * Usage: node scripts/reminder-project-code.js
 */

// Load the gitignored .env so WeCom credentials are not stored in source.
require('../utils/loadEnv')();
const { initDB } = require('../db/schema');
const { sendTextMessage } = require('../utils/wecom');

const APP_URL = process.env.APP_URL || 'https://resource.skandstudio.com';
/* 单条消息里最多列出的项目数，避免超长文本被企业微信截断。 */
const MAX_LISTED = 20;

function buildMessage(creatorName, projects) {
  const shown = projects.slice(0, MAX_LISTED);
  const lines = shown.map((p, i) => `${i + 1}. ${p.name}`).join('\n');
  const more = projects.length > MAX_LISTED ? `\n…等共 ${projects.length} 个项目` : '';
  return (
    `🔢 项目编号待补全提醒\n\n` +
    `你好，${creatorName}：\n` +
    `以下由你创建的项目还没有填写项目编号，项目编号用于对账和报表导出，请尽快补全。\n\n` +
    `${lines}${more}\n\n` +
    `补全方式：登录系统 → 客户与项目 → 点击项目行编辑 → 填写「项目编号」\n` +
    `👉 ${APP_URL}`
  );
}

async function main() {
  const db = initDB();

  const enterprises = db.prepare(`
    SELECT id, name, wecom_corp_id, wecom_agent_id, wecom_secret, wecom_department_id
    FROM enterprises
    WHERE wecom_corp_id != '' AND wecom_agent_id != '' AND wecom_secret != ''
  `).all();

  if (enterprises.length === 0) {
    console.log('[Project Code Reminder] 没有配置企业微信的企业，退出。');
    return;
  }

  for (const ent of enterprises) {
    console.log(`[Project Code Reminder] 开始处理企业: ${ent.name}`);
    const config = {
      corpId: ent.wecom_corp_id,
      agentId: ent.wecom_agent_id,
      secret: ent.wecom_secret,
      departmentId: ent.wecom_department_id
    };

    /* 只取在用且未存档的项目；已存档的不再提醒。 */
    const rows = db.prepare(`
      SELECT p.id, p.name, p.created_by,
             u.name AS creator_name,
             u.resource_id,
             r.wecom_userid,
             (r.is_active = 1 AND r.is_archived = 0) AS resource_active
      FROM projects p
      LEFT JOIN users u ON u.id = p.created_by
      LEFT JOIN resources r ON r.id = u.resource_id
      WHERE p.enterprise_id = ?
        AND p.is_active = 1
        AND p.is_archived = 0
        AND (p.code IS NULL OR TRIM(p.code) = '')
      ORDER BY p.name
    `).all(ent.id);

    if (rows.length === 0) {
      console.log(`[Project Code Reminder] 企业 ${ent.name} 没有缺编号的项目，跳过。`);
      continue;
    }

    // 按创建人聚合。
    const byCreator = new Map();
    let noCreator = 0;
    let notNotifiable = 0;
    for (const row of rows) {
      if (!row.created_by) { noCreator++; continue; }
      if (!row.creator_name) { notNotifiable++; continue; }
      if (!row.resource_id || !row.wecom_userid || !row.resource_active) {
        // 账号已删除、资源已停用或未绑定企业微信：记日志，不打扰任何人。
        notNotifiable++;
        continue;
      }
      const key = row.resource_id;
      if (!byCreator.has(key)) {
        byCreator.set(key, {
          wecomUserId: row.wecom_userid,
          creatorName: row.creator_name,
          projects: []
        });
      }
      byCreator.get(key).projects.push(row);
    }

    let sent = 0;
    for (const entry of byCreator.values()) {
      const message = buildMessage(entry.creatorName, entry.projects);
      try {
        const result = await sendTextMessage(config, entry.wecomUserId, message);
        if (result.ok) {
          sent++;
          console.log(
            `[Project Code Reminder] 已提醒 ${entry.creatorName}(${entry.wecomUserId})：` +
            `${entry.projects.length} 个项目缺编号`
          );
        } else {
          console.error(
            `[Project Code Reminder] 发送失败 ${entry.creatorName}(${entry.wecomUserId}):`,
            result.error
          );
        }
      } catch (err) {
        console.error(
          `[Project Code Reminder] 发送异常 ${entry.creatorName}(${entry.wecomUserId}):`,
          err.message
        );
      }
    }

    const skippedInfo =
      (noCreator ? `，${noCreator} 个无创建人（历史数据）` : '') +
      (notNotifiable ? `，${notNotifiable} 个收件人不可用` : '');
    console.log(
      `[Project Code Reminder] 企业 ${ent.name} 处理完毕：` +
      `缺编号 ${rows.length} 个，提醒 ${sent} 人${skippedInfo}。`
    );
  }
}

main().then(() => {
  console.log('[Project Code Reminder] 脚本执行完毕。');
  process.exit(0);
}).catch(err => {
  console.error('[Project Code Reminder] 脚本执行出错:', err);
  process.exit(1);
});