// Общий клиент Supabase — подключается на КАЖДОЙ странице
// перед этим файлом должен быть загружен https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js

const SUPABASE_URL = 'https://cgvuyupiyxwvxoddsbhq.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNndnV5dXBpeXh3dnhvZGRzYmhxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ3MDMyNDAsImV4cCI6MjEwMDI3OTI0MH0.ZvKR1t4KYOQ-NuVSTUiJgu5Zh8os8zZROiDzk5mwGsY';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Регистрация Service Worker для PWA (офлайн-кэш)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}

// Тема (светлая/тёмная) — применяется сразу, до отрисовки страницы, чтобы не было мигания
(function () {
  const saved = localStorage.getItem('liferpg-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);
})();

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('liferpg-theme', next);
  document.querySelectorAll('.theme-icon').forEach(el => el.innerText = next === 'dark' ? '☀️' : '🌙');
}

document.addEventListener('DOMContentLoaded', () => {
  const theme = document.documentElement.getAttribute('data-theme') || 'light';
  document.querySelectorAll('.theme-icon').forEach(el => el.innerText = theme === 'dark' ? '☀️' : '🌙');
});

// Вызывать в начале каждой защищённой страницы (кроме auth.html)
// Возвращает user или редиректит на экран входа
async function requireAuth() {
  const { data, error } = await sb.auth.getSession();
  if (error || !data.session) {
    window.location.href = 'auth.html';
    return null;
  }
  return data.session.user;
}

async function logout() {
  await sb.auth.signOut();
  window.location.href = 'auth.html';
}

// Пороги открытия контента по атрибутам
const ATTR_THRESHOLDS = {
  endurance: [
    { value: 15, unlocks: 'новый регион экспедиций' },
    { value: 30, unlocks: 'редкий предмет в наградах походов' }
  ],
  spirituality: [
    { value: 15, unlocks: 'новую практику в Уголке Дзен' },
    { value: 30, unlocks: 'новый тип квеста' }
  ]
};

function nextThreshold(attrKey, currentValue) {
  const list = ATTR_THRESHOLDS[attrKey] || [];
  return list.find(t => t.value > currentValue) || null;
}

function xpNeededForLevel(level) {
  return level * 100;
}

// === Задания: справочники и расчёт наград ===
const QUEST_CATEGORIES = [
  { key: 'work', name: 'Работа', icon: '💻' },
  { key: 'study', name: 'Учёба', icon: '📚' },
  { key: 'sport', name: 'Спорт', icon: '💪' },
  { key: 'health', name: 'Здоровье', icon: '❤️' },
  { key: 'finance', name: 'Финансы', icon: '💰' },
  { key: 'growth', name: 'Саморазвитие', icon: '🧠' },
  { key: 'home', name: 'Дом', icon: '🏠' },
  { key: 'hobby', name: 'Хобби', icon: '🎨' },
  { key: 'custom', name: 'Своя категория', icon: '✨' },
];

const QUEST_TYPES = [
  { key: 'once', name: 'Разовое' },
  { key: 'daily', name: 'Ежедневное' },
  { key: 'weekly', name: 'Еженедельное' },
  { key: 'habit', name: 'Привычка' },
  { key: 'longterm', name: 'Долгосрочное' },
];

const QUEST_PRIORITIES = [
  { key: 'low', name: 'Низкий', color: '#7D9471' },
  { key: 'medium', name: 'Средний', color: '#C08430' },
  { key: 'high', name: 'Высокий', color: '#D97F4F' },
  { key: 'critical', name: 'Критический', color: '#D9634F' },
];

const TYPE_REWARD_MULTIPLIER = { once: 1.3, daily: 1.0, weekly: 1.6, habit: 0.85, longterm: 1.1 };
const MAX_QUEST_XP = 150; // жёсткий потолок — защита от читерства

// Автоматический расчёт награды. Ничего не вводится вручную — только сложность/время/тип.
function calcQuestReward(difficulty, estimatedMinutes, taskType) {
  const diff = Math.min(Math.max(parseInt(difficulty) || 1, 1), 5);
  const minutes = Math.min(Math.max(parseInt(estimatedMinutes) || 5, 1), 480); // потолок на ввод времени
  const typeMult = TYPE_REWARD_MULTIPLIER[taskType] || 1.0;

  const base = diff * 8;
  const timeBonus = Math.min(minutes, 180) * 0.4; // время учитывается, но с потолком в 3 часа
  let xp = Math.round((base + timeBonus) * typeMult);
  xp = Math.min(xp, MAX_QUEST_XP);
  const gold = Math.round(xp * 0.6);
  return { xp, gold };
}

function getCategoryDisplay(quest) {
  if (quest.category === 'custom' && quest.category_custom_name) {
    return { name: quest.category_custom_name, icon: quest.category_custom_icon || '✨' };
  }
  const found = QUEST_CATEGORIES.find(c => c.key === quest.category);
  return found ? { name: found.name, icon: found.icon } : { name: 'Другое', icon: '✨' };
}

function isoWeekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const day = (d.getUTCDay() + 6) % 7; // понедельник = 0
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${week}`;
}

// Нужно ли сбросить отметку "выполнено" у конкретного задания на сегодня
function questNeedsReset(quest, todayStr) {
  if (!quest.is_completed_today) return false;
  if (quest.task_type === 'once' || quest.task_type === 'longterm') return false; // разовые/долгосрочные не сбрасываются сами
  if (!quest.last_completed_date) return true;
  if (quest.task_type === 'weekly') {
    return isoWeekKey(quest.last_completed_date) !== isoWeekKey(todayStr);
  }
  return quest.last_completed_date !== todayStr; // daily и habit — по дню
}

// Общий сброс, вызывается при заходе и на Главную, и в Квесты.
// profile мутируется на месте. Возвращает { didReset, previousDate } — для показа итогов дня.
async function performDailyReset(user, profile, quests) {
  const today = new Date().toISOString().slice(0, 10);
  let didReset = false;
  let previousDate = null;

  if (profile.last_login_date !== today) {
    didReset = true;
    previousDate = profile.last_login_date;
    if (profile.last_login_date) {
      const dailyQuests = quests.filter(q => q.task_type === 'daily' || !q.task_type);
      const uncompletedDaily = dailyQuests.filter(q => !q.is_completed_today);
      if (dailyQuests.length > 0 && uncompletedDaily.length === 0) profile.daily_streak += 1;
      else if (uncompletedDaily.length > 0) profile.daily_streak = 0;
    }
    profile.last_login_date = today;
    await saveProfileFields(user.id, { last_login_date: today, daily_streak: profile.daily_streak });
  }

  const toReset = quests.filter(q => questNeedsReset(q, today));
  if (toReset.length > 0) {
    await sb.from('quests').update({ is_completed_today: false }).in('id', toReset.map(q => q.id));
    toReset.forEach(q => { q.is_completed_today = false; });
  }

  return { didReset, previousDate };
}

async function logActivity(userId, eventType, description) {
  await sb.from('activity_log').insert({ user_id: userId, event_type: eventType, description });
}

async function getProfile(userId) {
  const { data } = await sb.from('profiles').select('*').eq('id', userId).single();
  return data;
}

async function saveProfileFields(userId, fields) {
  await sb.from('profiles').update(fields).eq('id', userId);
}

// Мутирует profile (level, xp, skill_points, hp, energy) пока хватает XP. Возвращает true если был левел-ап
function checkLevelUp(profile) {
  let leveled = false;
  let needed = xpNeededForLevel(profile.level);
  while (profile.xp >= needed) {
    profile.xp -= needed;
    profile.level += 1;
    profile.skill_points += 1;
    profile.hp = profile.max_hp;
    profile.energy = profile.max_energy;
    needed = xpNeededForLevel(profile.level);
    leveled = true;
  }
  return leveled;
}

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}
function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

function showToast(text) {
  const toast = document.createElement('div');
  toast.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:#d9b46a;color:#12100d;font-weight:600;padding:10px 16px;border-radius:8px;font-size:12px;z-index:200;text-align:center;box-shadow:0 8px 20px rgba(0,0,0,.4);';
  toast.innerText = text;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2600);
}

function showFloater(text) {
  const el = document.createElement('div');
  el.style.cssText = 'position:fixed;top:40%;left:50%;transform:translateX(-50%);pointer-events:none;font-weight:700;z-index:200;color:#d9b46a;font-size:13px;animation:floatUp 1s ease-out forwards;';
  el.innerText = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1000);
}

const floatKeyframes = document.createElement('style');
floatKeyframes.innerText = '@keyframes floatUp{0%{opacity:1;transform:translate(-50%,0)}100%{opacity:0;transform:translate(-50%,-40px)}}';
document.head.appendChild(floatKeyframes);
