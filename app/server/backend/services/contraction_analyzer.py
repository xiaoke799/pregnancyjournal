"""孕程记 - 宫缩 5-1-1 分析服务。

5-1-1 法则（ACOG Practice Bulletin No. 234, 2023）：
- 宫缩每 5 分钟一次（间隔约 5 分钟）
- 每次宫缩持续约 1 分钟（60 秒）
- 这种规律持续 1 小时以上

满足以上条件时，建议前往医院。

阈值设定说明：
- DURATION_THRESHOLD = 55秒：允许±5秒的测量误差，基于临床实践中的容差范围
- DURATION_MAX = 120秒：超过2分钟可能为异常宫缩，需医疗评估
- INTERVAL_THRESHOLD = 300秒（5分钟）：标准5-1-1法则定义

参考文献：
[1] ACOG Practice Bulletin No. 234: Prediction and Prevention of Spontaneous Preterm Birth. Obstet Gynecol. 2023;141(1):e1-e18.
[2] 中华医学会妇产科学分会产科学组. 正常分娩指南（2022版）. 中华妇产科杂志. 2022.
"""

from datetime import datetime, timedelta
from typing import Dict, List, Optional


class ContractionAnalyzer:
    """宫缩 5-1-1 分析服务。"""

    # 5-1-1 法则阈值
    INTERVAL_THRESHOLD = 300  # 5分钟 = 300秒
    DURATION_THRESHOLD = 55   # 约1分钟 = 55秒（允许误差）
    DURATION_MAX = 120        # 最长2分钟
    HOUR_IN_SECONDS = 3600    # 1小时

    def analyze(self, contractions: List[Dict]) -> Dict:
        """分析宫缩记录，判断是否满足 5-1-1 法则。

        Args:
            contractions: 宫缩记录列表，每条包含 start_time, end_time, duration, interval_from_prev。

        Returns:
            分析结果字典，包含是否触发预警、统计数据和建议。
        """
        if not contractions:
            return {
                "total_count": 0,
                "avg_duration": 0,
                "avg_interval": 0,
                "last_hour_count": 0,
                "is_511_met": False,
                "recommendation": "尚未记录宫缩，点击按钮开始计时。",
            }

        total_count = len(contractions)

        # 计算平均持续时间
        durations = [c.get("duration", 0) or 0 for c in contractions if c.get("duration")]
        avg_duration = sum(durations) / len(durations) if durations else 0

        # 计算平均间隔
        intervals = [c.get("interval_from_prev", 0) or 0 for c in contractions[1:]
                     if c.get("interval_from_prev")]
        avg_interval = sum(intervals) / len(intervals) if intervals else 0

        # 计算最近 1 小时宫缩次数
        last_hour_count = self._count_last_hour(contractions)

        # 判断 5-1-1 法则
        is_511_met = self._check_511(avg_interval, avg_duration, last_hour_count)

        # 生成建议
        recommendation = self._generate_recommendation(is_511_met, avg_interval, avg_duration)

        return {
            "total_count": total_count,
            "avg_duration": round(avg_duration, 1),
            "avg_interval": round(avg_interval, 1),
            "last_hour_count": last_hour_count,
            "is_511_met": is_511_met,
            "recommendation": recommendation,
        }

    def _count_last_hour(self, contractions: List[Dict]) -> int:
        """计算最近 1 小时内的宫缩次数。

        Args:
            contractions: 宫缩记录列表。

        Returns:
            最近1小时宫缩次数。
        """
        if not contractions:
            return 0

        now = datetime.now()
        one_hour_ago = now - timedelta(hours=1)

        count = 0
        for c in contractions:
            try:
                start = c["start_time"]
                # Handle both string (legacy) and datetime objects
                if isinstance(start, str):
                    start = datetime.fromisoformat(start)
                if start >= one_hour_ago:
                    count += 1
            except (ValueError, KeyError):
                continue

        return count

    def _check_511(self, avg_interval: float, avg_duration: float, last_hour_count: int) -> bool:
        """判断是否满足 5-1-1 法则。

        Args:
            avg_interval: 平均间隔（秒）。
            avg_duration: 平均持续时间（秒）。
            last_hour_count: 最近1小时宫缩次数。

        Returns:
            是否满足 5-1-1。
        """
        if last_hour_count < 6:  # 至少6次才可能"持续1小时"
            return False

        interval_met = avg_interval > 0 and avg_interval <= self.INTERVAL_THRESHOLD
        duration_met = self.DURATION_THRESHOLD <= avg_duration <= self.DURATION_MAX

        return interval_met and duration_met

    def _generate_recommendation(self, is_511_met: bool, avg_interval: float, avg_duration: float) -> str:
        """生成建议信息。

        Args:
            is_511_met: 是否满足5-1-1。
            avg_interval: 平均间隔（秒）。
            avg_duration: 平均持续时间（秒）。

        Returns:
            建议文字。
        """
        if is_511_met:
            return "⚠️ 已满足5-1-1法则！宫缩每5分钟一次，每次约1分钟，持续1小时以上。建议立即前往医院！"

        parts = []
        if avg_interval > 0:
            interval_min = round(avg_interval / 60, 1)
            if avg_interval <= self.INTERVAL_THRESHOLD:
                parts.append(f"宫缩间隔{interval_min}分钟，频率达标")
            else:
                parts.append(f"宫缩间隔{interval_min}分钟，尚未达到5分钟间隔")

        if avg_duration > 0:
            duration_sec = round(avg_duration, 0)
            if avg_duration >= self.DURATION_THRESHOLD:
                parts.append(f"每次持续{duration_sec}秒，时长达标")
            else:
                parts.append(f"每次持续{duration_sec}秒，尚未达到60秒")

        if not parts:
            return "继续记录宫缩，观察规律性变化。"

        parts.append("尚未满足5-1-1法则，继续观察。")
        return "；".join(parts)


contraction_analyzer = ContractionAnalyzer()
