"""孕程记 - 数据备份与恢复服务。

备份格式：SQLite 数据库文件拷贝 + photos 目录打包为 .tar.gz。
"""

import logging
import os
import shutil
import sqlite3
import tarfile
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from backend.config import settings

logger = logging.getLogger(__name__)


class BackupService:
    """数据备份与恢复服务。"""

    def __init__(self) -> None:
        """初始化备份服务。"""
        self.backups_dir = Path(settings.BACKUPS_DIR)
        self.backups_dir.mkdir(parents=True, exist_ok=True)
        self.db_path = Path(settings.DATABASE_PATH)
        self.photos_dir = Path(settings.PHOTOS_DIR)

    def create_backup(self) -> dict:
        """创建数据备份。

        将数据库文件和照片目录打包为 .tar.gz。

        Returns:
            备份信息字典，包含备份 ID、路径、大小等。
        """
        backup_id = str(uuid.uuid4())[:8]
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_filename = f"pregnancy_backup_{timestamp}_{backup_id}.tar.gz"
        backup_path = self.backups_dir / backup_filename

        # WAL checkpoint before backup to flush WAL to main DB file
        try:
            conn = sqlite3.connect(str(self.db_path))
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
            conn.close()
        except Exception:
            pass

        with tarfile.open(str(backup_path), "w:gz") as tar:
            # 备份数据库文件
            if self.db_path.exists():
                tar.add(str(self.db_path), arcname="pregnancy-journal.db")

            # 备份照片目录
            if self.photos_dir.exists():
                tar.add(str(self.photos_dir), arcname="photos")

        backup_size = backup_path.stat().st_size

        return {
            "backup_id": backup_id,
            "filename": backup_filename,
            "path": str(backup_path),
            "size": backup_size,
            "created_at": datetime.now().isoformat(),
        }

    @staticmethod
    def _is_safe_path(base_dir: str, member_name: str) -> bool:
        """Check tar member path does not escape base directory.

        Prevents Tar Slip / Zip Slip vulnerability (CVE-2007-4559).

        Args:
            base_dir: The safe base directory.
            member_name: The tar member's name/path.

        Returns:
            True if the resolved path is within base_dir.
        """
        real_base = os.path.realpath(base_dir)
        target = os.path.realpath(os.path.join(base_dir, member_name))
        return target.startswith(real_base + os.sep) or target == real_base

    def restore_backup(self, backup_path: str) -> dict:
        """从备份恢复数据。

        Args:
            backup_path: 备份文件路径。

        Returns:
            恢复结果信息。
        """
        if not os.path.exists(backup_path):
            return {"success": False, "message": "备份文件不存在"}

        # 恢复前先创建当前数据的备份
        try:
            pre_restore_backup = self.create_backup()
        except Exception:
            pre_restore_backup = None

        try:
            with tarfile.open(backup_path, "r:gz") as tar:
                # 恢复数据库和照片，带路径遍历检查
                for member in tar.getmembers():
                    if member.name == "pregnancy-journal.db":
                        if not self._is_safe_path(str(self.db_path.parent), member.name):
                            raise ValueError(f"Unsafe path in backup: {member.name}")
                        if self.db_path.exists():
                            self.db_path.unlink()
                        tar.extract(member, path=str(self.db_path.parent))
                    elif member.name.startswith("photos/"):
                        if not self._is_safe_path(str(self.photos_dir.parent), member.name):
                            raise ValueError(f"Unsafe path in backup: {member.name}")
                        tar.extract(member, path=str(self.photos_dir.parent))

            return {
                "success": True,
                "message": "数据恢复成功",
                "pre_restore_backup": pre_restore_backup,
            }
        except Exception as e:
            logger.error(f"Backup restore failed: {str(e)}", exc_info=True)
            return {
                "success": False,
                "message": "数据恢复失败，请检查备份文件是否损坏或联系管理员",
                "pre_restore_backup": pre_restore_backup,
            }

    def list_backups(self) -> list:
        """列出所有备份文件。

        Returns:
            备份文件列表。
        """
        backups = []
        for f in sorted(self.backups_dir.glob("pregnancy_backup_*.tar.gz"), reverse=True):
            stat = f.stat()
            backups.append({
                "filename": f.name,
                "path": str(f),
                "size": stat.st_size,
                "created_at": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            })
        return backups

    def delete_backup(self, backup_path: str) -> bool:
        """删除备份文件。

        Args:
            backup_path: 备份文件路径。

        Returns:
            是否删除成功。
        """
        if os.path.exists(backup_path):
            os.remove(backup_path)
            return True
        return False


backup_service = BackupService()
