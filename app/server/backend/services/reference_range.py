"""孕程记 - 指标标准范围比对服务。

根据预置的标准范围数据，自动比对录入的指标值并标注状态。
"""

import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from backend.config import settings


class ReferenceRangeService:
    """指标标准范围比对服务。"""

    def __init__(self) -> None:
        """初始化服务，加载预置标准范围数据。"""
        self._data: Dict = {}
        self._load_data()

    def _load_data(self) -> None:
        """加载标准范围 JSON 文件。"""
        filepath = Path(settings.DATA_DIR) / "reference_ranges.json"
        if filepath.exists():
            with open(filepath, "r", encoding="utf-8") as f:
                self._data = json.load(f)

    def get_reference_range(self, category: str, item_name: str, gestational_week: Optional[int] = None) -> Optional[Tuple[float, float]]:
        """获取指定指标的标准范围。

        Args:
            category: 检查类别。
            item_name: 指标名称。
            gestational_week: 孕周（B超数据需要）。

        Returns:
            (下限, 上限) 元组，找不到返回 None。
        """
        if category == "ultrasound":
            return self._get_ultrasound_range(item_name, gestational_week)

        category_data = self._data.get(category, {})
        items = category_data.get("items", [])

        for item in items:
            if item["item_name"] == item_name:
                return (item["reference_min"], item["reference_max"])

        return None

    def _get_ultrasound_range(self, item_name: str, gestational_week: Optional[int]) -> Optional[Tuple[float, float]]:
        """获取B超指标的标准范围（按孕周动态对照）。

        使用线性插值算法提高非整数据点的评估精度。
        数据来源：《中国产科超声检查指南》（2022版）

        Args:
            item_name: 指标名称。
            gestational_week: 孕周。

        Returns:
            (下限, 上限) 元组，找不到返回 None。
        """
        ultrasound_data = self._data.get("ultrasound", {})
        ranges = ultrasound_data.get("ranges_by_week", [])

        if not gestational_week or not ranges:
            return None

        # 精确匹配
        for week_data in ranges:
            if week_data["week"] == gestational_week:
                for item in week_data.get("items", []):
                    if item["item_name"] == item_name:
                        return (item["reference_min"], item["reference_max"])

        # 线性插值：找到相邻的两个数据点进行插值
        sorted_ranges = sorted(ranges, key=lambda x: x["week"])
        
        # 找到小于目标孕周的最近点
        lower = None
        upper = None
        
        for i, week_data in enumerate(sorted_ranges):
            if week_data["week"] < gestational_week:
                lower = week_data
            elif week_data["week"] > gestational_week and not upper:
                upper = week_data
                break
        
        # 如果只能找到一侧的数据点，使用最近邻
        if not lower and upper:
            closest = upper
        elif not upper and lower:
            closest = lower
        elif lower and upper:
            # 执行线性插值
            lower_item = None
            upper_item = None
            
            for item in lower.get("items", []):
                if item["item_name"] == item_name:
                    lower_item = item
                    break
                    
            for item in upper.get("items", []):
                if item["item_name"] == item_name:
                    upper_item = item
                    break
            
            if lower_item and upper_item:
                # 计算插值权重
                total_range = upper["week"] - lower["week"]
                weight = (gestational_week - lower["week"]) / total_range
                
                interp_min = lower_item["reference_min"] + weight * (upper_item["reference_min"] - lower_item["reference_min"])
                interp_max = lower_item["reference_max"] + weight * (upper_item["reference_max"] - lower_item["reference_max"])
                
                return (round(interp_min, 2), round(interp_max, 2))
            
            # 如果目标项目在某一侧不存在，使用有数据的一侧
            closest = lower_item if lower_item else upper_item
            if closest:
                return (closest["reference_min"], closest["reference_max"])
            return None
        else:
            closest = lower or upper
        
        if not closest:
            return None

        for item in closest.get("items", []):
            if item["item_name"] == item_name:
                return (item["reference_min"], item["reference_max"])

        return None

    def evaluate_status(self, value: float, reference_min: Optional[float], reference_max: Optional[float]) -> str:
        """比对指标值与标准范围，返回状态标注。

        Args:
            value: 实际值。
            reference_min: 标准下限。
            reference_max: 标准上限。

        Returns:
            "low" / "normal" / "high"。
        """
        if reference_min is not None and value < reference_min:
            return "low"
        if reference_max is not None and value > reference_max:
            return "high"
        return "normal"

    def get_category_items(self, category: str) -> List[Dict]:
        """获取指定类别的所有指标列表。

        Args:
            category: 检查类别。

        Returns:
            指标列表。
        """
        category_data = self._data.get(category, {})
        return category_data.get("items", [])

    def get_all_categories(self) -> Dict:
        """获取全部标准范围数据。

        Returns:
            全部标准范围数据字典。
        """
        return self._data


reference_range_service = ReferenceRangeService()
