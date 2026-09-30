/**
 * 文件路径锚定守卫
 *
 * 根因（2026-09-30 上线前检查 阻塞1/阻塞2）：凡是从数据库 / 备份里回读的
 * 文件路径（checkup_report.file_path、pregnancy_photo.file_path 等），都曾被
 * 无条件信任 —— 攻击者可用 import-json 投毒一条指向任意路径的记录，再调
 * 「下载报告 / 删除照片」读出或删除该文件（含应用自身的数据库、推送密钥）。
 *
 * 收口原则：读取侧拒绝（403）、删除侧跳过并告警、导入/恢复写入侧直接置空，
 * 且三处共用同一份「允许目录」清单，只允许应用自己的数据目录。
 */
const path = require('path');
const config = require('../config');

let _allowedDirs = null;

/** 用户文件允许存在的根目录（小写、已 resolve） */
function allowedDirs() {
  if (!_allowedDirs) {
    _allowedDirs = [config.PHOTOS_DIR, config.THUMBNAILS_DIR, config.MEDIA_DIR, config.BACKUPS_DIR]
      .map((d) => path.resolve(d).toLowerCase());
  }
  return _allowedDirs;
}

/** 路径是否落在允许目录内（目录本身不算，必须是其下的文件） */
function isAllowed(p) {
  if (!p || typeof p !== 'string') return false;
  const resolved = path.resolve(p).toLowerCase();
  return allowedDirs().some((dir) => resolved.startsWith(dir + path.sep));
}

/** 各业务表里存放文件路径的列（导入/恢复写入侧按此识别越界路径行并整行丢弃） */
const PATH_COLUMNS = {
  checkup_photo: ['file_path', 'thumbnail_path'],
  checkup_report: ['file_path'],
  pregnancy_photo: ['file_path', 'thumbnail_path'],
};

module.exports = { allowedDirs, isAllowed, PATH_COLUMNS };
