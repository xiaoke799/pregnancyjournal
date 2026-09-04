// API 统一响应格式
export interface ApiResponse<T = unknown> {
  code: number
  data: T
  message: string
}

// 孕期相关
export interface Pregnancy {
  id: string
  last_period_date: string
  conception_date: string | null
  due_date: string
  is_active: number
  baby_name: string | null
  created_at: string
  updated_at: string
}

// 日常记录
export interface DailyRecord {
  id: string
  pregnancy_id: string
  record_date: string
  weight: number | null
  fetal_heart_rate: number | null
  body_temperature: number | null
  blood_glucose_fasting: number | null
  blood_glucose_1h: number | null
  blood_glucose_2h: number | null
  mood: string | null
  mood_note: string | null
  stool: string | null
  stool_record: string | null
  note: string | null
  blood_pressure_systolic: string | null
  blood_pressure_diastolic: string | null
  sleep_hours: number | null
  sleep_quality: string | null
  symptoms: string | null
  exercise_type: string | null
  exercise_duration: number | null
  diet_note: string | null
  medication: string | null
  edema_level: string | null
  vaginal_discharge: string | null
  skin_condition: string | null
  urination_frequency: string | null
  hcg_value: number | null
  hcg_weeks: number | null
  uric_acid: number | null
  uric_acid_period: string | null
  supplement_record: string | null
  intimacy_note: string | null
  plan_text: string | null
  plan_date: string | null
  is_plan_done: number
  water_intake: number | null
  habit_text: string | null
  contraction_count: number | null
  contraction_interval: number | null
  contraction_duration: number | null
  contraction_pain: string | null
  contraction_record: string | null
  fetal_movement_count: number | null
  fetal_movement_duration: number | null
  fetal_movement_record: string | null
  sleep_record: string | null
  diet_record: string | null
  exercise_record: string | null
  intimacy_record: string | null
  created_at: string
  updated_at: string
}

// 宫缩记录
export interface ContractionItem {
  startTime: string
  endTime: string
  duration: number
  interval: number
}

// 胎动计数
export interface FetalMovementSession {
  id: string
  pregnancy_id: string
  session_date: string
  start_time: string
  end_time: string | null
  total_count: number
  notes: string | null
  created_at: string
}
