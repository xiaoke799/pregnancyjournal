"""孕程记 - 孕周计算引擎。

基于 Naegele 公式：预产期 = 末次月经日期 + 280 天。
孕周 = (今天 - 末次月经日期) // 7
孕天 = (今天 - 末次月经日期) % 7
"""

from datetime import date, timedelta
from typing import Optional, Tuple


def calculate_due_date_from_lmp(lmp_date: date) -> date:
    """根据末次月经日期计算预产期（Naegele 公式）。

    Args:
        lmp_date: 末次月经日期。

    Returns:
        预产期日期。
    """
    return lmp_date + timedelta(days=280)


def calculate_due_date_from_conception(conception_date: date) -> date:
    """根据受精日期计算预产期。

    受精日期比末次月经约晚14天，预产期 = 受精日期 + 266天。

    Args:
        conception_date: 受精日期。

    Returns:
        预产期日期。
    """
    return conception_date + timedelta(days=266)


def calculate_lmp_from_due_date(due_date: date) -> date:
    """根据预产期反推末次月经日期。

    Args:
        due_date: 预产期。

    Returns:
        末次月经日期。
    """
    return due_date - timedelta(days=280)


def calculate_gestational_age(lmp_date: date, reference_date: Optional[date] = None) -> Tuple[int, int, int]:
    """计算孕周、孕天和总天数。

    Args:
        lmp_date: 末次月经日期。
        reference_date: 参考日期，默认为今天。

    Returns:
        (孕周, 孕天, 总天数) 的元组。
    """
    if reference_date is None:
        reference_date = date.today()

    total_days = (reference_date - lmp_date).days
    if total_days < 0:
        return 0, 0, 0

    weeks = total_days // 7
    days = total_days % 7
    return weeks, days, total_days


def validate_lmp_date(lmp_date: date, reference_date: Optional[date] = None) -> Tuple[bool, str]:
    """验证末次月经日期的合理性。

    基于《中国孕前和孕期保健指南》（2023版）：
    - LMP不应晚于参考日期
    - LMP不应早于参考日期超过300天（约43周，超出正常妊娠范围）
    - LMP不应在未来的日期

    Args:
        lmp_date: 末次月经日期。
        reference_date: 参考日期，默认为今天。

    Returns:
        (是否有效, 错误信息) 的元组。
    """
    if reference_date is None:
        reference_date = date.today()

    if lmp_date > reference_date:
        return False, "末次月经日期不能晚于今天"

    days_diff = (reference_date - lmp_date).days
    if days_diff > 300:
        return False, f"末次月经日期距今{days_diff}天，已超出正常妊娠范围（≤280天）"

    return True, ""


def get_trimester(weeks: int) -> str:
    """根据孕周判断孕期阶段。

    Args:
        weeks: 孕周数。

    Returns:
        孕期阶段名称。
    """
    if weeks < 13:
        return "孕早期"
    elif weeks < 28:
        return "孕中期"
    else:
        return "孕晚期"


def days_until_due(due_date: date, reference_date: Optional[date] = None) -> int:
    """计算距离预产期的天数。

    Args:
        due_date: 预产期。
        reference_date: 参考日期，默认为今天。

    Returns:
        距离预产期的天数，负数表示已过预产期。
    """
    if reference_date is None:
        reference_date = date.today()
    return (due_date - reference_date).days


def calculate_gestational_week_at_date(lmp_date: date, target_date: date) -> Tuple[int, int]:
    """计算在指定日期时的孕周和孕天。

    Args:
        lmp_date: 末次月经日期。
        target_date: 目标日期。

    Returns:
        (孕周, 孕天) 的元组。
    """
    total_days = (target_date - lmp_date).days
    if total_days < 0:
        return 0, 0
    return total_days // 7, total_days % 7
