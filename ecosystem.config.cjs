module.exports = {
  apps: [{
    name: '4pro-identity',
    script: 'src/server.js',
    instances: 1,
    env_production: {
      NODE_ENV: 'production',
      IDENTITY_PORT: 4100,
    },
    max_memory_restart: '256M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }],
};
