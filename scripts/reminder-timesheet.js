#!/usr/bin/env node
/**
 * reminder-timesheet.js
 * 发送每周五下午3点的 Timesheet 填写提醒给所有人
 *
 * Usage: node scripts/reminder-timesheet.js
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
    console.log('[Timesheet Reminder] 没有配置企业微信的企业，退出。');
    return;
  }

  for (const ent of enterprises) {
    console.log(`[Timesheet Reminder] 开始处理企业: ${ent.name}`);
    
    const config = {
      corpId: ent.wecom_corp_id,
      agentId: ent.wecom_agent_id,
      secret: ent.wecom_secret,
      departmentId: ent.wecom_department_id
    };
    
    // 查询该企业下所有绑定了企业微信的在职员工
    const resources = db.prepare(`
      SELECT id, name, wecom_userid 
      FROM resources 
      WHERE enterprise_id = ? AND is_active = 1 AND wecom_userid != ''
    `).all(ent.id);
    
    if (resources.length === 0) {
      console.log(`[Timesheet Reminder] 企业 ${ent.name} 没有绑定企业微信的员工，跳过。`);
      continue;
    }
    
    const message = `⏱️ Timesheet 填写提醒\n\n大家下午好！\n今天是周五，请记得在下班前登录系统填写本周的 Timesheet。\n\n感谢配合，祝周末愉快！\n👉 https://resource.skandstudio.com`;
    
    let successCount = 0;
    for (const res of resources) {
      try {
        const result = await sendTextMessage(config, res.wecom_userid, message);
        if (result.ok) successCount++;
      } catch (err) {
        console.error(`[Timesheet Reminder] 发送给 ${res.name}(${res.wecom_userid}) 失败:`, err.message);
      }
    }
    
    console.log(`[Timesheet Reminder] 企业 ${ent.name} 处理完毕，成功发送 ${successCount}/${resources.length} 人。`);
  }
}

main().then(() => {
  console.log('[Timesheet Reminder] 脚本执行完毕。');
  process.exit(0);
}).catch(err => {
  console.error('[Timesheet Reminder] 脚本执行出错:', err);
  process.exit(1);
});
