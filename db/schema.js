const Database = require('better-sqlite3');
const path = require('path');

function initDB() {
  const db = new Database(path.join(__dirname, 'resource-guru.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT DEFAULT '',
      team TEXT DEFAULT '',
      color TEXT DEFAULT '#4F46E5',
      hours_per_day REAL DEFAULT 8,
      is_active INTEGER DEFAULT 1,
      enterprise_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#6366F1',
      is_active INTEGER DEFAULT 1,
      enterprise_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      client_id INTEGER REFERENCES clients(id),
      color TEXT DEFAULT '#8B5CF6',
      start_date TEXT,
      end_date TEXT,
      budget_hours REAL DEFAULT 0,
      hourly_rate REAL DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      enterprise_id INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id INTEGER NOT NULL REFERENCES resources(id),
      project_id INTEGER NOT NULL REFERENCES projects(id),
      date TEXT NOT NULL,
      hours REAL NOT NULL DEFAULT 8,
      is_tentative INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS timesheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id INTEGER NOT NULL REFERENCES resources(id),
      project_id INTEGER NOT NULL REFERENCES projects(id),
      date TEXT NOT NULL,
      hours REAL NOT NULL,
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS leave_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      resource_id INTEGER NOT NULL REFERENCES resources(id),
      date TEXT NOT NULL,
      type TEXT DEFAULT 'vacation',
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS enterprises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      code TEXT UNIQUE NOT NULL,
      owner_id INTEGER,
      webhook_dingtalk TEXT DEFAULT '',
      webhook_wecom TEXT DEFAULT '',
      webhook_feishu TEXT DEFAULT '',
      currency TEXT DEFAULT 'CNY',
      theme_color TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT UNIQUE,
      email TEXT UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      enterprise_id INTEGER REFERENCES enterprises(id),
      resource_id INTEGER REFERENCES resources(id),
      role TEXT DEFAULT 'member',
      perm_book_others INTEGER DEFAULT 0,
      perm_manage_resources INTEGER DEFAULT 0,
      perm_view_reports INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS join_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      enterprise_id INTEGER NOT NULL REFERENCES enterprises(id),
      status TEXT DEFAULT 'pending',
      message TEXT DEFAULT '',
      reviewed_by INTEGER REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      enterprise_id INTEGER NOT NULL REFERENCES enterprises(id),
      email TEXT NOT NULL,
      name TEXT DEFAULT '',
      invited_by INTEGER REFERENCES users(id),
      token TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
    CREATE INDEX IF NOT EXISTS idx_bookings_resource ON bookings(resource_id);
    CREATE INDEX IF NOT EXISTS idx_timesheets_date ON timesheets(date);
    CREATE INDEX IF NOT EXISTS idx_timesheets_resource ON timesheets(resource_id);
    CREATE INDEX IF NOT EXISTS idx_leave_date ON leave_entries(date);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
    CREATE INDEX IF NOT EXISTS idx_users_phone ON users(phone);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_join_requests_enterprise ON join_requests(enterprise_id);
    CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(email);
    CREATE INDEX IF NOT EXISTS idx_invitations_token ON invitations(token);
    CREATE INDEX IF NOT EXISTS idx_resources_enterprise ON resources(enterprise_id);
    CREATE INDEX IF NOT EXISTS idx_projects_enterprise ON projects(enterprise_id);
    CREATE INDEX IF NOT EXISTS idx_clients_enterprise ON clients(enterprise_id);
  `);

  // Run migrations for existing databases
  migrate(db);

  return db;
}

function migrate(db) {
  // Add enterprise_id columns if missing (for existing databases)
  const tables = ['resources', 'projects', 'clients'];
  tables.forEach(table => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.find(c => c.name === 'enterprise_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN enterprise_id INTEGER`);
    }
  });

  // Add avatar column to users table
  const userCols = db.prepare('PRAGMA table_info(users)').all();
  if (!userCols.find(c => c.name === 'avatar')) {
    db.exec('ALTER TABLE users ADD COLUMN avatar TEXT DEFAULT \'\'');
  }

  // Add unique index on leave_entries(resource_id, date) for batch upsert
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_leave_resource_date ON leave_entries(resource_id, date)');
  } catch (_) { /* index may already exist */ }

  // Add project_code, billable, details columns to projects table
  const projCols = db.prepare('PRAGMA table_info(projects)').all();
  if (!projCols.find(c => c.name === 'code')) {
    db.exec("ALTER TABLE projects ADD COLUMN code TEXT DEFAULT ''");
  }
  if (!projCols.find(c => c.name === 'billable')) {
    db.exec('ALTER TABLE projects ADD COLUMN billable INTEGER DEFAULT 1');
  }
  if (!projCols.find(c => c.name === 'details')) {
    db.exec("ALTER TABLE projects ADD COLUMN details TEXT DEFAULT ''");
  }

  // Add details column to clients table
  const clientCols = db.prepare('PRAGMA table_info(clients)').all();
  if (!clientCols.find(c => c.name === 'details')) {
    db.exec("ALTER TABLE clients ADD COLUMN details TEXT DEFAULT ''");
  }

  // Add must_change_password column to users table
  const userCols2 = db.prepare('PRAGMA table_info(users)').all();
  if (!userCols2.find(c => c.name === 'must_change_password')) {
    db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0');
  }

  // Add is_archived column to projects and clients tables
  const projCols2 = db.prepare('PRAGMA table_info(projects)').all();
  if (!projCols2.find(c => c.name === 'is_archived')) {
    db.exec('ALTER TABLE projects ADD COLUMN is_archived INTEGER DEFAULT 0');
  }
  // Ensure existing NULL values become 0
  db.exec('UPDATE projects SET is_archived = 0 WHERE is_archived IS NULL');

  const clientCols2 = db.prepare('PRAGMA table_info(clients)').all();
  if (!clientCols2.find(c => c.name === 'is_archived')) {
    db.exec('ALTER TABLE clients ADD COLUMN is_archived INTEGER DEFAULT 0');
  }
  db.exec('UPDATE clients SET is_archived = 0 WHERE is_archived IS NULL');
}

function seedDemoData(db) {
  const resourceCount = db.prepare('SELECT COUNT(*) as c FROM resources').get().c;
  if (resourceCount > 0) return;

  const crypto = require('crypto');
  function hashPassword(pwd) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(pwd, salt, 64).toString('hex');
    return `${salt}:${hash}`;
  }

  const insertResource = db.prepare('INSERT INTO resources (name, email, role, team, color, enterprise_id) VALUES (?, ?, ?, ?, ?, ?)');
  const insertClient = db.prepare('INSERT INTO clients (name, color, enterprise_id) VALUES (?, ?, ?)');
  const insertProject = db.prepare('INSERT INTO projects (name, client_id, color, start_date, end_date, budget_hours, hourly_rate, enterprise_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const insertBooking = db.prepare('INSERT INTO bookings (resource_id, project_id, date, hours, is_tentative, notes) VALUES (?, ?, ?, ?, ?, ?)');

  const resources = [
    ['张伟', 'zhangwei@company.com', '前端开发', '开发组', '#4F46E5'],
    ['李娜', 'lina@company.com', '后端开发', '开发组', '#7C3AED'],
    ['王强', 'wangqiang@company.com', 'UI设计师', '设计组', '#EC4899'],
    ['刘洋', 'liuyang@company.com', '项目经理', '管理组', '#F59E0B'],
    ['陈静', 'chenjing@company.com', '测试工程师', '测试组', '#10B981'],
    ['赵磊', 'zhaolei@company.com', '全栈开发', '开发组', '#3B82F6'],
    ['孙丽', 'sunli@company.com', '产品经理', '管理组', '#F97316'],
    ['周杰', 'zhoujie@company.com', 'DevOps', '运维组', '#06B6D4'],
  ];

  const clients = [
    ['腾讯科技', '#4F46E5'],
    ['阿里巴巴', '#F59E0B'],
    ['字节跳动', '#EC4899'],
    ['华为技术', '#10B981'],
  ];

  const projects = [
    ['商城重构', 1, '#4F46E5', '2026-03-01', '2026-06-30', 500, 150],
    ['移动端 App', 1, '#7C3AED', '2026-03-15', '2026-07-15', 300, 120],
    ['数据平台', 2, '#F59E0B', '2026-02-01', '2026-05-31', 400, 140],
    ['官网改版', 3, '#EC4899', '2026-03-01', '2026-04-30', 200, 130],
    ['内部工具', 4, '#10B981', '2026-03-10', '2026-08-10', 600, 110],
  ];

  const transaction = db.transaction(() => {
    // enterprise_id = 1 for all demo data
    resources.forEach(r => insertResource.run(r[0], r[1], r[2], r[3], r[4], 1));
    clients.forEach(c => insertClient.run(c[0], c[1], 1));
    projects.forEach(p => insertProject.run(p[0], p[1], p[2], p[3], p[4], p[5], p[6], 1));

    // Create demo enterprise
    db.prepare(`INSERT INTO enterprises (name, code, owner_id, webhook_dingtalk, webhook_wecom, webhook_feishu)
      VALUES ('示例科技有限公司', 'DEMO2026', 1, '', '', '')`).run();

    // Create demo admin user
    const adminHash = hashPassword('admin123');
    db.prepare(`INSERT INTO users (phone, email, password_hash, name, enterprise_id, resource_id, role, perm_book_others, perm_manage_resources, perm_view_reports, status)
      VALUES ('13800000001', 'admin@company.com', ?, '管理员', 1, null, 'owner', 1, 1, 1, 'active')`).run(adminHash);

    // Create member users linked to resources
    resources.forEach((r, i) => {
      const hash = hashPassword('123456');
      const phone = '138' + String(i + 10).padStart(8, '0');
      const canBook = (i === 3 || i === 6) ? 1 : 0;
      const canViewReports = (i === 3 || i === 6) ? 1 : 0;
      db.prepare(`INSERT INTO users (phone, email, password_hash, name, enterprise_id, resource_id, role, perm_book_others, perm_manage_resources, perm_view_reports, status)
        VALUES (?, ?, ?, ?, 1, ?, 'member', ?, 0, ?, 'active')`).run(phone, r[1], hash, r[0], i + 1, canBook, canViewReports);
    });

    // Generate bookings for current week and next 2 weeks
    const today = new Date();
    const monday = new Date(today);
    monday.setDate(today.getDate() - today.getDay() + 1);

    for (let week = 0; week < 3; week++) {
      for (let day = 0; day < 5; day++) {
        const date = new Date(monday);
        date.setDate(monday.getDate() + week * 7 + day);
        const dateStr = date.toISOString().split('T')[0];

        insertBooking.run(1, 1, dateStr, 6, 0, '前端页面开发');
        insertBooking.run(1, 4, dateStr, 2, 0, '官网组件');
        insertBooking.run(2, 1, dateStr, 8, 0, 'API 开发');
        insertBooking.run(3, 4, dateStr, 4, 0, '设计稿');
        insertBooking.run(3, 2, dateStr, 4, 0, 'App UI');
        insertBooking.run(4, 3, dateStr, 4, 0, '项目管理');
        insertBooking.run(4, 1, dateStr, 4, 0, '需求评审');
        insertBooking.run(5, 1, dateStr, 6, 0, '测试用例');
        insertBooking.run(6, 3, dateStr, 8, 0, '全栈开发');
        insertBooking.run(7, 2, dateStr, 4, 1, '需求分析');
        insertBooking.run(8, 5, dateStr, 8, 0, 'CI/CD 搭建');
      }
    }
  });

  transaction();
}

module.exports = { initDB, seedDemoData };
