/**
 * Server-side i18n for user-facing API messages (errors / validation / hints).
 *
 * The client sends its UI language via the `Accept-Language` request header
 * (see public/js/core.js `api()`). Default is Chinese, which keeps existing
 * clients and the test-suite behaviour unchanged.
 *
 * IMPORTANT: Only *system* UI text is translated here. Enterprise names,
 * employee names, project names and any other user-entered data are never
 * translated — they are interpolated verbatim into localized templates.
 *
 * Out of scope by design (kept Chinese): email templates, webhook/WeCom push
 * notification bodies, Excel export headers — those are outbound messages,
 * not app UI text.
 */

const MESSAGES = {
  // ---------- common ----------
  'common.not_logged_in': { zh: '未登录', en: 'Not logged in' },
  'common.unauthorized': { zh: '未授权', en: 'Unauthorized' },
  'common.forbidden': { zh: '无权限', en: 'Permission denied' },
  'common.admin_only': { zh: '仅管理员可操作', en: 'Admins only' },
  'common.manager_or_above': { zh: '仅经理及以上可操作', en: 'Managers and above only' },
  'common.need_enterprise': { zh: '请先创建或加入企业', en: 'Please create or join an enterprise first' },
  'common.need_enterprise_login': { zh: '请先登录并创建或加入企业', en: 'Please sign in and create or join an enterprise first' },
  'common.missing_params': { zh: '缺少参数', en: 'Missing parameters' },
  'common.missing_date_params': { zh: '缺少日期参数', en: 'Missing date parameters' },
  'common.missing_required_params': { zh: '缺少必要参数', en: 'Missing required parameters' },
  'common.missing_enterprise_info': { zh: '缺少企业信息', en: 'Missing enterprise info' },
  'common.member_not_found': { zh: '成员不存在', en: 'Member not found' },
  'common.resource_not_found': { zh: '资源不存在或无权访问', en: 'Resource not found or access denied' },
  'common.resource_missing': { zh: '资源不存在', en: 'Resource not found' },
  'common.resource_or_project_missing': { zh: '资源或项目不存在', en: 'Resource or project not found' },
  'common.project_not_found': { zh: '项目不存在或无权访问', en: 'Project not found or access denied' },
  'common.project_missing': { zh: '项目不存在', en: 'Project not found' },
  'common.project_not_found_simple': { zh: '项目未找到', en: 'Project not found' },
  'common.client_not_found': { zh: '客户不存在', en: 'Client not found' },
  'common.client_not_found_or_denied': { zh: '客户不存在或无权访问', en: 'Client not found or access denied' },
  'common.scope_not_found': { zh: '工作范围不存在', en: 'Scope not found' },
  'common.request_not_found': { zh: '申请不存在', en: 'Request not found' },
  'common.invalid_image': { zh: '无效的图片格式', en: 'Invalid image format' },
  'common.unspecified_scope': { zh: '未指定/其他', en: 'Unspecified/Other' },
  'common.account_disabled': { zh: '账号已停用', en: 'Account disabled' },

  // ---------- rate limiting ----------
  'rate.too_many': { zh: '请求过于频繁，请稍后再试', en: 'Too many requests, please try again later' },
  'rate.login_throttled': { zh: '登录尝试过于频繁，请 15 分钟后再试', en: 'Too many login attempts, please try again in 15 minutes' },
  'rate.reset_throttled': { zh: '重置请求过于频繁，请 15 分钟后再试', en: 'Too many reset requests, please try again in 15 minutes' },
  'rate.register_throttled': { zh: '注册过于频繁，请稍后再试', en: 'Too many registrations, please try again later' },

  // ---------- auth ----------
  'auth.register_missing_fields': { zh: '请填写姓名、密码和手机号或邮箱', en: 'Please provide name, password, and phone or email' },
  'auth.phone_registered': { zh: '该手机号已注册', en: 'This phone number is already registered' },
  'auth.email_registered': { zh: '该邮箱已注册', en: 'This email is already registered' },
  'auth.login_missing': { zh: '请输入账号和密码', en: 'Please enter account and password' },
  'auth.account_not_found': { zh: '账号不存在', en: 'Account not found' },
  'auth.wrong_password': { zh: '密码错误', en: 'Incorrect password' },
  'auth.already_in_enterprise': { zh: '您已属于一个企业', en: 'You already belong to an enterprise' },
  'auth.enter_enterprise_name': { zh: '请输入企业名称', en: 'Please enter an enterprise name' },
  'auth.enterprise_code_not_found': { zh: '企业代码不存在', en: 'Enterprise code not found' },
  'auth.request_already_submitted': { zh: '您已提交过申请，请等待审核', en: 'You have already submitted a request, please wait for review' },
  'auth.invalid_role_options': { zh: '无效角色，可选：basic / manager / admin', en: 'Invalid role, options: basic / manager / admin' },
  'auth.invalid_role': { zh: '无效角色', en: 'Invalid role' },
  'auth.use_role_api_for_admin': { zh: '请使用角色接口调整管理员', en: 'Use the role API to change an admin' },
  'auth.no_logo_data': { zh: '未提供Logo数据', en: 'No logo data provided' },
  'auth.logo_too_large': { zh: 'Logo文件大小不能超过 1MB', en: 'Logo must not exceed 1MB' },
  'auth.phone_in_use': { zh: '该手机号已被其他账号使用', en: 'This phone number is used by another account' },
  'auth.email_in_use': { zh: '该邮箱已被其他账号使用', en: 'This email is used by another account' },
  'auth.no_avatar_data': { zh: '未提供头像数据', en: 'No avatar data provided' },
  'auth.avatar_too_large': { zh: '头像压缩后文件大小不能超过 500KB', en: 'Avatar must not exceed 500KB after compression' },
  'auth.pwd_both_required': { zh: '请填写旧密码和新密码', en: 'Please provide current and new password' },
  'auth.new_pwd_min': { zh: '新密码至少6位', en: 'New password must be at least 6 characters' },
  'auth.old_pwd_wrong': { zh: '旧密码不正确', en: 'Current password is incorrect' },
  'auth.no_first_pwd_change': { zh: '无需修改初始密码', en: 'No initial password change needed' },
  'auth.enter_new_pwd': { zh: '请输入新密码', en: 'Please enter a new password' },
  'auth.pwd_min': { zh: '密码至少6位', en: 'Password must be at least 6 characters' },
  'auth.members_required': { zh: '请提供成员列表', en: 'Please provide a member list' },
  'auth.initial_pwd_min': { zh: '初始密码至少6位', en: 'Initial password must be at least 6 characters' },
  'auth.bulk_name_empty': { zh: '姓名不能为空', en: 'Name is required' },
  'auth.bulk_need_contact': { zh: '邮箱或手机号至少填一项', en: 'Provide at least an email or a phone number' },
  'auth.bulk_email_exists': { zh: '邮箱 {email} 已存在', en: 'Email {email} already exists' },
  'auth.bulk_phone_exists': { zh: '手机号 {phone} 已存在', en: 'Phone {phone} already exists' },
  'auth.enter_email': { zh: '请输入邮箱地址', en: 'Please enter an email address' },
  'auth.invite_pending_exists': { zh: '该邮箱已有待处理的邀请', en: 'This email already has a pending invitation' },
  'auth.invite_already_member': { zh: '该邮箱的用户已是企业成员', en: 'This email is already a member of the enterprise' },
  'auth.invite_token_missing': { zh: '缺少邀请令牌', en: 'Missing invitation token' },
  'auth.invite_not_found': { zh: '邀请不存在或已被取消', en: 'Invitation not found or cancelled' },
  'auth.invite_email_mismatch': { zh: '邀请邮箱与当前登录账号不匹配', en: 'Invitation email does not match the signed-in account' },
  'auth.reset_sent_if_registered': { zh: '如果该邮箱已注册，重置链接已发送', en: 'If this email is registered, a reset link has been sent' },
  'auth.reset_link_invalid': { zh: '链接无效或已过期，请重新申请', en: 'Link is invalid or expired, please request a new one' },

  // ---------- bookings ----------
  'bookings.missing_resource_or_date': { zh: '缺少 resource_id 或 date', en: 'Missing resource_id or date' },
  'bookings.missing_ids': { zh: '缺少 ids', en: 'Missing ids' },
  'bookings.bad_day_delta': { zh: 'day_delta 必须为非零整数', en: 'day_delta must be a non-zero integer' },
  'bookings.not_found': { zh: '预订不存在', en: 'Booking not found' },
  'bookings.not_found_id': { zh: '预订不存在: {id}', en: 'Booking not found: {id}' },
  'bookings.only_move_own': { zh: '您只能移动自己创建的排程', en: 'You can only move schedules you created' },
  'bookings.only_delete_own': { zh: '您只能删除自己创建的排程', en: 'You can only delete schedules you created' },
  'bookings.only_edit_own': { zh: '您只能编辑自己创建的排程', en: 'You can only edit schedules you created' },
  'bookings.no_create_perm': { zh: '您没有创建排程的权限', en: 'You do not have permission to create schedules' },
  'bookings.leave_on_date': { zh: '目标日期 {date} 有休假', en: 'Target date {date} has leave' },
  'bookings.leave_conflict': { zh: '目标日期与休假冲突', en: 'Target date conflicts with leave' },
  'bookings.leave_conflict_force': { zh: '所选日期与休假冲突，请调整日期或使用 force 确认', en: 'Selected dates conflict with leave; adjust the dates or confirm with force' },
  'bookings.dup_project_schedule': { zh: '目标日期已有同项目排程: {dates}', en: 'Target date already has a schedule for the same project: {dates}' },
  'bookings.duplicate_booking': { zh: '所选日期已存在该工作范围的排程，无需重复创建', en: 'A schedule for this scope already exists on the selected dates' },

  // ---------- conflict detection (utils/conflicts.js) ----------
  'conflicts.leave_on_date': { zh: '{name} 在 {date} 已有休假（{type}）', en: '{name} has leave on {date} ({type})' },
  'conflicts.overload': { zh: '{name} 在 {date} 将排 {projected}h（产能 {capacity}h，超出 {over}h）', en: '{name} would reach {projected}h on {date} (capacity {capacity}h, over by {over}h)' },

  // ---------- clients ----------
  'clients.add_manager_only': { zh: '仅经理及以上可添加客户', en: 'Only managers and above can add clients' },
  'clients.edit_manager_only': { zh: '仅经理及以上可编辑客户', en: 'Only managers and above can edit clients' },
  'clients.edit_own_only': { zh: '经理只能编辑自己创建的客户', en: 'Managers can only edit clients they created' },
  'clients.archive_admin_only': { zh: '仅管理员可归档客户', en: 'Only admins can archive clients' },
  'clients.unarchive_admin_only': { zh: '仅管理员可取消归档客户', en: 'Only admins can unarchive clients' },
  'clients.delete_admin_only': { zh: '仅管理员可删除客户', en: 'Only admins can delete clients' },

  // ---------- projects ----------
  'projects.add_manager_only': { zh: '仅经理及以上可添加项目', en: 'Only managers and above can add projects' },
  'projects.edit_forbidden': { zh: '您没有权限编辑该项目', en: 'You do not have permission to edit this project' },
  'projects.archive_admin_only': { zh: '仅管理员可归档项目', en: 'Only admins can archive projects' },
  'projects.unarchive_admin_only': { zh: '仅管理员可取消归档项目', en: 'Only admins can unarchive projects' },
  'projects.delete_admin_only': { zh: '仅管理员可删除项目', en: 'Only admins can delete projects' },
  'projects.scope_edit_forbidden': { zh: '您没有权限修改该项目的工作范围', en: 'You do not have permission to modify this project\'s scopes' },
  'projects.scope_name_empty': { zh: '范围名称不能为空', en: 'Scope name is required' },
  'projects.scope_exists': { zh: '该工作范围已存在', en: 'This scope already exists' },

  // ---------- resources ----------
  'resources.not_found': { zh: '人员不存在', en: 'Member not found' },
  'resources.add_admin_only': { zh: '仅管理员可添加人员', en: 'Only admins can add members' },
  'resources.edit_admin_only': { zh: '仅管理员可编辑人员', en: 'Only admins can edit members' },
  'resources.delete_admin_only': { zh: '仅管理员可删除人员', en: 'Only admins can delete members' },

  // ---------- leave ----------
  'leave.register_manager_only': { zh: '仅经理及以上可登记休假', en: 'Only managers and above can register leave' },
  'leave.edit_manager_only': { zh: '仅经理及以上可编辑休假', en: 'Only managers and above can edit leave' },
  'leave.delete_manager_only': { zh: '仅经理及以上可删除休假', en: 'Only managers and above can delete leave' },
  'leave.not_found': { zh: '休假记录不存在', en: 'Leave record not found' },
  'leave.date_taken': { zh: '该日期已有休假记录，请选择其他日期', en: 'This date already has a leave record, please choose another date' },

  // ---------- reports ----------
  'reports.forbidden': { zh: '您没有查看报表的权限', en: 'You do not have permission to view reports' },
  'reports.project_forbidden': { zh: '没有权限查看该项目的报表', en: 'No permission to view this project\'s report' },

  // ---------- timesheets ----------
  'timesheets.own_only': { zh: '只能为自己填报工时', en: 'You can only log hours for yourself' },
  'timesheets.edit_own_only': { zh: '只能编辑自己的工时', en: 'You can only edit your own timesheets' },
  'timesheets.delete_own_only': { zh: '只能删除自己的工时', en: 'You can only delete your own timesheets' },
  'timesheets.sync_own_only': { zh: '只能同步自己的工时', en: 'You can only sync your own timesheets' },
  'timesheets.not_found': { zh: '工时记录不存在', en: 'Timesheet record not found' },
  'timesheets.invalid_entries': { zh: 'entries 无效', en: 'Invalid entries' },

  // ---------- audit ----------
  'audit.admin_only': { zh: '仅管理员可查看审计日志', en: 'Only admins can view audit logs' },

  // ---------- WeCom (settings page) ----------
  'wecom.select_employee': { zh: '请选择员工', en: 'Please select an employee' },
  'wecom.employee_not_found': { zh: '员工不存在', en: 'Employee not found' },
  'wecom.userid_missing': { zh: '该员工尚未绑定企业微信 ID，请先完成通讯录同步或手动绑定', en: 'This employee has no WeCom ID bound yet; run contact sync or bind it manually first' },
  'wecom.unsupported_type': { zh: '不支持的测试消息类型', en: 'Unsupported test message type' },
  'wecom.send_failed': { zh: '发送测试消息失败', en: 'Failed to send test message' },
  'wecom.sync_failed_default': { zh: '无法获取企业微信通讯录', en: 'Failed to fetch WeCom contacts' },
  'wecom.ip_hint': { zh: '请把当前服务器出口 IP 加入企业微信应用的可信 IP 白名单', en: 'Add this server\'s outbound IP to the WeCom app\'s trusted IP allowlist' },
  'wecom.empty_department': { zh: '企业微信通讯录为空，或应用无权访问当前部门成员', en: 'WeCom contacts are empty, or the app cannot access members of this department' },
  'wecom.missing_corp_id': { zh: '缺少企业微信 Corp ID', en: 'Missing WeCom Corp ID' },
  'wecom.missing_agent_id': { zh: '缺少企业微信 Agent ID', en: 'Missing WeCom Agent ID' },
  'wecom.missing_secret': { zh: '缺少企业微信 App Secret', en: 'Missing WeCom App Secret' },
  'wecom.api_failed': { zh: '企业微信接口调用失败', en: 'WeCom API call failed' },
  'wecom.ip_rejected': { zh: '企业微信拒绝了当前服务器 IP，请把服务器出口 IP 加入该应用的可信 IP 白名单', en: 'WeCom rejected this server\'s IP; add the server\'s outbound IP to the app\'s trusted IP allowlist' },
  'wecom.invalid_corp_id': { zh: '企业微信 Corp ID 无效', en: 'Invalid WeCom Corp ID' },
  'wecom.invalid_token': { zh: '企业微信 access_token 无效或已过期', en: 'WeCom access_token is invalid or expired' },
  'wecom.no_contacts_perm': { zh: '企业微信应用缺少通讯录相关权限，无法读取成员列表', en: 'WeCom app lacks contacts permission to read the member list' },
  'wecom.insufficient_perm': { zh: '企业微信接口权限不足，请检查应用可见范围或接口权限', en: 'WeCom API permission denied; check the app visibility scope or API permissions' },
  'wecom.get_token_failed': { zh: '获取企业微信 access_token 失败', en: 'Failed to get WeCom access_token' },
  'wecom.get_token_failed_detail': { zh: '获取企业微信 access_token 失败：{detail}', en: 'Failed to get WeCom access_token: {detail}' },
  'wecom.send_card_failed': { zh: '发送企业微信卡片消息失败', en: 'Failed to send WeCom card message' },
  'wecom.send_card_failed_detail': { zh: '发送企业微信卡片消息失败：{detail}', en: 'Failed to send WeCom card message: {detail}' },
  'wecom.send_text_failed': { zh: '发送企业微信文本消息失败', en: 'Failed to send WeCom text message' },
  'wecom.send_text_failed_detail': { zh: '发送企业微信文本消息失败：{detail}', en: 'Failed to send WeCom text message: {detail}' },
  'wecom.get_contacts_failed': { zh: '获取企业微信通讯录失败', en: 'Failed to fetch WeCom contacts' },
  'wecom.get_contacts_failed_detail': { zh: '获取企业微信通讯录失败：{detail}', en: 'Failed to fetch WeCom contacts: {detail}' },
  'wecom.label_schedule_created': { zh: '排班创建通知', en: 'Schedule created notification' },
  'wecom.label_schedule_updated': { zh: '排班变更通知', en: 'Schedule updated notification' },
  'wecom.label_schedule_deleted': { zh: '排班取消通知', en: 'Schedule cancelled notification' },
  'wecom.label_text_card': { zh: '卡片消息', en: 'Text card message' },
};

/**
 * Resolve the caller's UI language from the Accept-Language header.
 * Anything starting with "en" → English; otherwise Chinese (default).
 */
function reqLang(req) {
  const header =
    (req && req.headers && (req.headers['accept-language'] || req.headers['Accept-Language'])) || '';
  return String(header).trim().toLowerCase().indexOf('en') === 0 ? 'en' : 'zh';
}

/**
 * Localize a message by key for an explicit language.
 * @param {'zh'|'en'} lang
 * @param {string} key
 * @param {object} [params]  {placeholder} substitutions (user data is passed through verbatim)
 */
function msg(lang, key, params) {
  const entry = MESSAGES[key];
  let text = entry ? (entry[lang] != null ? entry[lang] : entry.zh) : key;
  if (params) {
    for (const k of Object.keys(params)) {
      text = text.split('{' + k + '}').join(String(params[k]));
    }
  }
  return text;
}

/** Localize a message by key using the request's Accept-Language header. */
function L(req, key, params) {
  return msg(reqLang(req), key, params);
}

module.exports = { MESSAGES, reqLang, msg, L };
