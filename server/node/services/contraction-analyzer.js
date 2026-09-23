function analyze(contractionsArray) {
  if (!contractionsArray || contractionsArray.length === 0) {
    return {
      total_count: 0,
      avg_duration: 0,
      avg_interval: 0,
      last_hour_count: 0,
      is_511_met: false,
      recommendation: '暂无宫缩记录，请继续观察。'
    };
  }

  const now = Date.now();
  const oneHourAgo = now - 3600000;

  const totalDuration = contractionsArray.reduce((sum, c) => sum + (c.duration || 0), 0);
  const avg_duration = Math.round(totalDuration / contractionsArray.length);

  const intervals = contractionsArray
    .filter(c => c.interval_from_prev != null)
    .map(c => c.interval_from_prev);
  const avg_interval = intervals.length > 0
    ? Math.round(intervals.reduce((sum, i) => sum + i, 0) / intervals.length)
    : 0;

  const last_hour_count = contractionsArray.filter(c => {
    const startTime = typeof c.start_time === 'string' ? new Date(c.start_time).getTime() : c.start_time;
    return startTime >= oneHourAgo;
  }).length;

  const is_511_met = last_hour_count >= 12 && avg_duration >= 60 && avg_interval <= 300;

  let recommendation;
  if (is_511_met) {
    recommendation = '已满足5-1-1规则（每小时≥12次宫缩，每次持续≥60秒，间隔≤5分钟），建议立即前往医院待产。';
  } else if (last_hour_count >= 6 && avg_duration >= 40) {
    recommendation = '宫缩频率较高，建议密切观察，准备好待产包，如有加重请及时就医。';
  } else if (last_hour_count >= 3) {
    recommendation = '出现规律宫缩，请放松休息，记录宫缩情况，持续观察变化。';
  } else {
    recommendation = '宫缩不规律或频率较低，属于正常现象，继续保持观察即可。';
  }

  return {
    total_count: contractionsArray.length,
    avg_duration,
    avg_interval,
    last_hour_count,
    is_511_met,
    recommendation
  };
}

module.exports = { analyze };
