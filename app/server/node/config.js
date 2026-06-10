const path = require('path');

const config = {
  DATABASE_PATH: process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'pregnancyjournal.db'),
  PHOTOS_DIR: process.env.PHOTOS_DIR || path.join(process.cwd(), 'data', 'photos'),
  THUMBNAILS_DIR: process.env.THUMBNAILS_DIR || path.join(process.cwd(), 'data', 'thumbnails'),
  MEDIA_DIR: process.env.MEDIA_DIR || path.join(process.cwd(), 'data', 'media'),
  BACKUPS_DIR: process.env.BACKUPS_DIR || path.join(process.cwd(), 'data', 'backups'),
  DATA_DIR: process.env.DATA_DIR || path.join(process.cwd(), 'data'),
  STATIC_DIR: process.env.STATIC_DIR || path.join(process.cwd(), 'ui'),
  PORT: parseInt(process.env.TRIM_SERVICE_PORT || process.env.PORT || '3867', 10),
  TRIM_SERVICE_PORT: process.env.TRIM_SERVICE_PORT || '3867',
  APP_MODE: process.env.APP_MODE || 'dev',
  APP_VERSION: '0.0.19',
  TRIM_APPDEST: process.env.TRIM_APPDEST || '',
  TRIM_PKGVAR: process.env.TRIM_PKGVAR || '',
  TRIM_DATA_SHARE_PATHS: process.env.TRIM_DATA_SHARE_PATHS || '',
};

module.exports = config;
