// PM2 process manager configuration
module.exports = {
  apps: [
    {
      name: 'crewboard',
      script: 'server.js',
      instances: 1,           // SQLite doesn't support multi-process writes
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      max_memory_restart: '256M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/error.log',
      out_file: './logs/out.log',
      merge_logs: true,
      autorestart: true,
      watch: false
    },
    {
      name: 'crewboard-holiday-update',
      script: 'scripts/update-holidays.js',
      cron_restart: '0 9 15 12 *',   // Dec 15 at 09:00 every year
      autorestart: false,
      watch: false,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: './logs/holiday-update-error.log',
      out_file: './logs/holiday-update.log',
    }
  ]
};
