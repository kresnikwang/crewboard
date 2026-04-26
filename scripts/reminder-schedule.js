#!/usr/bin/env node
/**
 * reminder-schedule.js
 * 发送每周一早上9点的排程操作提醒给客户部员工
 *
 * Usage: node scripts/reminder-schedule.js
 */

const { initDB } = require('../db/schema');
const { getDepartmentUsers, sendTextMessage } = require('../utils/wecom');

async function main() {
  const db = initDB();
  
  // 获取配置了企业微信的企业
  const enterprises = db.prepare(`
    SELECT id, name, wecom_corp_id, wecom_agent_id, wecom_secret, wecom_department_id 
    FROM enterprises 
    WHERE wecom_corp_id != '' AND wecom_agent_id != '' AND wecom_secret != ''
  `).all();
  
  if (enterprises.length === 0) {
    console.log('[Schedule Reminder] 没有配置企业微信的企业，退出。');
    return;
  }

  for (const ent of enterprises) {
    console.log(`[Schedule Reminder] 开始处理企业: ${ent.name}`);
    
    const config = {
      corpId: ent.wecom_corp_id,
      agentId: ent.wecom_agent_id,
      secret: ent.wecom_secret,
      departmentId: ent.wecom_department_id
    };
    
    // 查询该企业下所有绑定了企业微信、且属于“客户部”的在职员工
    // 注意：团队名称假设为包含“客户”字样，或者精确匹配“客户部”。这里使用 LIKE '%客户%'
    const resources = db.prepare(`
      SELECT id, name, wecom_userid, team 
      FROM resources 
      WHERE enterprise_id = ? AND is_active = 1 AND wecom_userid != '' AND team LIKE '%客户%'
    `).all(ent.id);
    
    if (resources.length === 0) {
      console.log(`[Schedule Reminder] 企业 ${ent.name} 没有符合条件的客户部员工，跳过。`);
      continue;
    }
    
    const message = `📅 排程操作提醒\n\n早上好！\n新的一周开始了，请客户部同事记得登录系统，检查并调整本周的项目资源排程，确保各项工作顺利推进。\n\n👉 https://resource.skandstudio.com`;
    
    let successCount = 0;
    for (const res of resources) {
      try {
        const result = await sendTextMessage(config, res.wecom_userid, message);
        if (result.ok) successCount++;
      } catch (err) {
        console.error(`[Schedule Reminder] 发送给 ${res.name}(${res.wecom_userid}) 失败:`, err.message);
      }
    }
    
    console.log(`[Schedule Reminder] 企业 ${ent.name} 处理完毕，成功发送 ${successCount}/${resources.length} 人。`);
  }
}

main().then(() => {
  console.log('[Schedule Reminder] 脚本执行完毕。');
  process.exit(0);
}).catch(err => {
  console.error('[Schedule Reminder] 脚本执行出错:', err);
  process.exit(1);
});
