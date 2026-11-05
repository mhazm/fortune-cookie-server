/**
 * PM2 Ecosystem Configuration for Nismara Tracker Server
 * Dedicated Backend Server for NismaraTracker Plugin
 */
module.exports = {
  apps: [
    {
      name: "nismara-tracker-server",
      script: "server.js",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",
      watch: false,
      max_memory_restart: "500M",
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: "10s",
      time: true,
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      merge_logs: true,
      env: {
        NODE_ENV: "development",
        PORT: 3100,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3100,
      },
    },
  ],
};
