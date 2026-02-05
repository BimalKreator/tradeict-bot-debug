module.exports = {
  apps: [
    {
      name: 'tradeict-bot',
      script: '.next/standalone/server.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HOSTNAME: '0.0.0.0',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
  ],
};
