const express = require('express');
const router = express.Router();
const db = require('../db');
const config = require('../config');
const fs = require('fs');
const path = require('path');
const gestationalCalculator = require('../services/gestational-calculator');

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function loadJsonFile(filename) {
  const filePath = path.join(config.DATA_DIR, filename);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return null;
}

router.get('/dashboard/events', async (req, res) => {
  try {
    const { pregnancy_id, days = 14 } = req.query;
    if (!pregnancy_id) {
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id参数' });
    }

    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + parseInt(days));
    const todayStr = formatDate(today);
    const futureStr = formatDate(futureDate);

    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const threeDaysAgoStr = formatDate(threeDaysAgo);

    const events = [];

    const reminders = await db.queryAll(
      'SELECT * FROM reminder WHERE pregnancy_id = ? AND is_enabled = 1 AND trigger_date BETWEEN ? AND ? ORDER BY trigger_date ASC',
      [pregnancy_id, todayStr, futureStr]
    );
    reminders.forEach(r => {
      events.push({
        id: `reminder_${r.id}`,
        event_type: 'reminder',
        source_type: 'reminder',
        source_id: r.id,
        title: r.title || r.content,
        date: r.trigger_date,
        time: r.trigger_time || '',
        icon: 'bell',
        priority: r.priority || 'medium',
        action_url: `/reminders/${r.id}`,
        is_completed: !!r.is_completed
      });
    });

    const checkupScheduleEv = loadJsonFile('checkup_schedule.json');
    const scheduleItemsEv = Array.isArray(checkupScheduleEv) ? checkupScheduleEv : [];
    if (scheduleItemsEv.length > 0) {
      const preg = await db.queryOne('SELECT last_period_date FROM pregnancy WHERE id = ?', [pregnancy_id]);
      const lmpStr = preg?.last_period_date;
      scheduleItemsEv.forEach(item => {
        const weekStart = item.week_start || 0;
        let estDate = '';
        if (lmpStr) {
          const lmp = new Date(lmpStr);
          lmp.setDate(lmp.getDate() + weekStart * 7);
          estDate = formatDate(lmp);
        }
        if (!estDate || estDate < todayStr) return;
        if (estDate > futureStr) return;
        const completed = await db.queryOne(
          'SELECT id FROM prenatal_checkup WHERE pregnancy_id = ? AND gestational_week >= ? AND gestational_week <= ? AND is_completed = 1 LIMIT 1',
          [pregnancy_id, weekStart, item.week_end || weekStart]
        );
        if (completed) return;
        events.push({
          id: `checkup_${item.id}`,
          event_type: 'checkup_schedule',
          source_type: 'checkup_schedule',
          source_id: item.id,
          title: item.name || item.title,
          date: estDate,
          time: '',
          icon: 'stethoscope',
          priority: 'high',
          action_url: `/checkup-schedule`,
          is_completed: false
        });
      });
    }

    const alertRecords = await db.queryAll(
      'SELECT * FROM daily_record WHERE pregnancy_id = ? AND record_date BETWEEN ? AND ? ORDER BY record_date DESC',
      [pregnancy_id, threeDaysAgoStr, todayStr]
    );
    alertRecords.forEach(record => {
      let hasAlert = false;
      let alertTitle = '';
      if (record.blood_pressure_systolic > 140 || (record.blood_pressure_diastolic && record.blood_pressure_diastolic > 90)) {
        hasAlert = true;
        alertTitle = '血压偏高';
      }
      if (record.blood_glucose_fasting && record.blood_glucose_fasting > 5.1) {
        hasAlert = true;
        alertTitle = alertTitle ? alertTitle + '+空腹血糖偏高' : '空腹血糖偏高';
      }
      if (record.blood_glucose_2h && record.blood_glucose_2h > 6.7) {
        hasAlert = true;
        alertTitle = alertTitle ? alertTitle + '+餐后血糖偏高' : '餐后血糖偏高';
      }
      if (hasAlert) {
        events.push({
          id: `alert_${record.id}`,
          event_type: 'record_alert',
          source_type: 'daily_record',
          source_id: record.id,
          title: `${record.record_date} ${alertTitle}`,
          date: record.record_date,
          time: '',
          icon: 'warning',
          priority: 'high',
          action_url: `/records/${record.id}`,
          is_completed: false
        });
      }
    });

    events.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.priority === 'high' && b.priority !== 'high') return -1;
      if (b.priority === 'high' && a.priority !== 'high') return 1;
      return 0;
    });

    res.json({ code: 0, data: events, message: 'success' });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

router.get('/dashboard', async (req, res) => {
  try {
    const { pregnancy_id } = req.query;
    if (!pregnancy_id) {
      return res.json({ code: 1001, data: null, message: '缺少pregnancy_id参数' });
    }

    const todayStr = formatDate(new Date());
    const weekLater = new Date();
    weekLater.setDate(weekLater.getDate() + 7);
    const weekLaterStr = formatDate(weekLater);

    const pregnancy = await db.queryOne(
      'SELECT * FROM pregnancy WHERE id = ?', [pregnancy_id]
    );

    if (!pregnancy) {
      return res.json({ code: 0, data: { has_pregnancy: false }, message: 'success' });
    }

    const gestationalAge = pregnancy.last_period_date
      ? gestationalCalculator.calculateGestationalAge(pregnancy.last_period_date)
      : { weeks: 0, days: 0, totalDays: 0 };

    const trimester = gestationalCalculator.getTrimester(gestationalAge.weeks);
    const stageKey = gestationalAge.weeks < 13 ? 'early' : gestationalAge.weeks < 28 ? 'mid' : 'late';
    const daysUntilDue = pregnancy.due_date
      ? gestationalCalculator.daysUntilDue(pregnancy.due_date)
      : null;

    const todayRecord = await db.queryOne(
      'SELECT * FROM daily_record WHERE pregnancy_id = ? AND record_date = ?',
      [pregnancy_id, todayStr]
    ) || {};
    const hasTodayRecord = !!(todayRecord && todayRecord.id);

    const fmResult = await db.queryOne(
      'SELECT COALESCE(SUM(total_count), 0) as count FROM fetal_movement_session WHERE pregnancy_id = ? AND session_date = ?',
      [pregnancy_id, todayStr]
    );
    const fetalMovementCount = fmResult ? fmResult.count : 0;

    const csResult = await db.queryOne(
      'SELECT id FROM contraction_session WHERE pregnancy_id = ? AND end_time IS NULL LIMIT 1',
      [pregnancy_id]
    );
    const contractionActive = !!csResult;

    const upcomingReminders = await db.queryAll(
      'SELECT * FROM reminder WHERE pregnancy_id = ? AND is_enabled = 1 AND trigger_date BETWEEN ? AND ? AND (is_completed IS NULL OR is_completed = 0) ORDER BY trigger_date ASC LIMIT 5',
      [pregnancy_id, todayStr, weekLaterStr]
    );

    const checkupSchedule = loadJsonFile('checkup_schedule.json');
    const scheduleItems = Array.isArray(checkupSchedule) ? checkupSchedule : [];
    let upcomingCheckups = [];
    if (scheduleItems.length > 0) {
      upcomingCheckups = scheduleItems
        .filter(item => {
          const ws = item.week_start || 0;
          return ws > gestationalAge.weeks;
        })
        .slice(0, 5)
        .map(item => {
          const ws = item.week_start || 0;
          const estDate = pregnancy.last_period_date
            ? new Date(new Date(pregnancy.last_period_date).getTime() + ws * 7 * 24 * 60 * 60 * 1000)
            : null;
          return {
            id: item.id,
            name: item.name,
            week_start: ws,
            week_end: item.week_end || ws,
            items: item.items || [],
            estimated_date: estDate ? formatDate(estDate) : null,
            days_until: estDate ? Math.ceil((estDate - new Date(todayStr)) / (24 * 60 * 60 * 1000)) : null,
          };
        });
      upcomingCheckups.sort((a, b) => (a.days_until || 999) - (b.days_until || 999));
    }

    let development = null;
    if (gestationalAge.weeks > 0) {
      const fetalDev = loadJsonFile('fetal_development.json');
      const devItems = Array.isArray(fetalDev) ? fetalDev : [];
      const devRaw = devItems.find(w => w.week === gestationalAge.weeks) ||
        devItems.find(w => w.week === Math.min(gestationalAge.weeks, 40)) || null;
      if (devRaw) {
        const wg = devRaw.weight_g || 0;
        development = {
          size: devRaw.size_metaphor || '',
          weight: wg >= 1000 ? (wg / 1000).toFixed(1) + 'kg' : wg + 'g',
          description: devRaw.development || '',
          tips: devRaw.tips || '',
          week: devRaw.week,
          length_cm: devRaw.length_cm,
        };
      }
    }

    const fetalDevAll = loadJsonFile('fetal_development.json');
    const fetalDevelopmentCurve = (Array.isArray(fetalDevAll) ? fetalDevAll : []).map(item => ({
      week: item.week,
      weight_g: item.weight_g || 0,
      length_cm: item.length_cm || 0,
      size: item.size_metaphor || '',
    }));

    const weightHistoryRows = await db.queryAll(
      'SELECT record_date, weight FROM daily_record WHERE pregnancy_id = ? AND weight IS NOT NULL ORDER BY record_date ASC LIMIT 50',
      [pregnancy_id]
    );
    const weightHistory = weightHistoryRows
      .filter(r => r.weight != null)
      .map(r => ({ date: r.record_date, weight: r.weight }));

    const lastCheckup = await db.queryOne(
      'SELECT * FROM prenatal_checkup WHERE pregnancy_id = ? ORDER BY checkup_date DESC LIMIT 1',
      [pregnancy_id]
    );

    const checklists = await db.queryAll(
      'SELECT type, COUNT(*) as total, SUM(CASE WHEN is_checked = 1 THEN 1 ELSE 0 END) as checked FROM checklist WHERE pregnancy_id = ? GROUP BY type',
      [pregnancy_id]
    );
    const totalItems = checklists.reduce((sum, c) => sum + c.total, 0);
    const checkedItems = checklists.reduce((sum, c) => sum + (c.checked || 0), 0);

    const todayTodos = await db.queryAll(
      'SELECT * FROM reminder WHERE pregnancy_id = ? AND trigger_date = ? AND is_enabled = 1 AND (is_completed IS NULL OR is_completed = 0)',
      [pregnancy_id, todayStr]
    );

    let recommendedTodos = [];
    if (gestationalAge.weeks > 0 && scheduleItems.length > 0) {
      const minWeek = Math.max(0, gestationalAge.weeks - 2);
      const maxWeek = gestationalAge.weeks + 4;
      const lmpDate = pregnancy.last_period_date ? new Date(pregnancy.last_period_date) : null;
      const todayDate = new Date(todayStr);
      recommendedTodos = scheduleItems
        .filter(item => {
          const ws = item.week_start || item.gestational_week || 0;
          const we = item.week_end || ws;
          return ws >= minWeek && ws <= maxWeek && !item.is_completed;
        })
        .slice(0, 5)
        .map(item => {
          const ws = item.week_start || item.gestational_week || 0;
          const we = item.week_end || ws;
          const estDate = lmpDate ? new Date(lmpDate.getTime() + ws * 7 * 24 * 60 * 60 * 1000) : null;
          const daysUntil = estDate ? Math.ceil((estDate - todayDate) / (24 * 60 * 60 * 1000)) : null;
          return {
            id: `rec_checkup_${item.id}`,
            name: item.name || item.title,
            type: 'checkup',
            is_mandatory: item.is_mandatory !== false,
            week_range: ws === we ? String(ws) : `${ws}-${we}`,
            due_hint: ws ? `约孕${ws}周` : '',
            estimated_date: estDate ? formatDate(estDate) : null,
            days_until: daysUntil,
            schedule_items: item.items || [],
          };
        });
      recommendedTodos.sort((a, b) => (a.days_until || 999) - (b.days_until || 999));
    }

    res.json({
      code: 0,
      data: {
        has_pregnancy: true,
        has_today_record: hasTodayRecord,
        fetal_movement_count: fetalMovementCount,
        contraction_active: contractionActive,
        pregnancy: {
          id: pregnancy.id,
          due_date: pregnancy.due_date,
          baby_name: pregnancy.baby_name,
          last_period_date: pregnancy.last_period_date
        },
        gestational_age: {
          weeks: gestationalAge.weeks,
          days: gestationalAge.days,
          total_days: gestationalAge.totalDays,
          days_until_due: daysUntilDue,
          trimester,
          stage_key: stageKey
        },
        today_record: todayRecord,
        upcoming_reminders: upcomingReminders,
        upcoming_checkups: upcomingCheckups,
        development: development,
        fetal_development_curve: fetalDevelopmentCurve,
        weight_history: weightHistory,
        last_checkup: lastCheckup,
        checklist_progress: {
          total: totalItems,
          checked: checkedItems,
          percentage: totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0,
          checklists: checklists.map(c => {
            const ct = c.total || 0;
            const cc = c.checked || 0;
            return {
              id: c.type,
              name: c.type,
              type: c.type,
              total: ct,
              checked: cc,
              percentage: ct > 0 ? Math.round((cc / ct) * 100) : 0
            };
          })
        },
        today_todos: todayTodos,
        recommended_todos: recommendedTodos
      },
      message: 'success'
    });
  } catch (error) {
    res.json({ code: 1001, data: null, message: error.message });
  }
});

module.exports = router;
