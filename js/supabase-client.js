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
  if (!confirm('Точно выйти из аккаунта?')) return;
  await sb.auth.signOut();
  window.location.href = 'auth.html';
}

// === Характеристики персонажа (6 штук, потолок 100) ===
const STAT_CAP = 100;
const STAT_DEFS = [
  { key: 'strength', name: 'Сила', icon: '💪', color: '#D97F4F' },
  { key: 'intelligence', name: 'Интеллект', icon: '🧠', color: '#4E7DFF' },
  { key: 'spirit', name: 'Дух', icon: '✨', color: '#E08589' },
  { key: 'focus', name: 'Фокус', icon: '🎯', color: '#C08430' },
  { key: 'social', name: 'Общительность', icon: '🗣️', color: '#7D9471' },
  { key: 'vitality', name: 'Жизненность', icon: '❤️', color: '#D9634F' },
];

// Категория квеста → какую характеристику качает
const CATEGORY_TO_STAT = {
  work: 'focus', study: 'intelligence', sport: 'strength', health: 'vitality',
  finance: 'focus', growth: 'spirit', home: 'vitality', hobby: 'spirit', social: 'social',
};

function statDef(key) {
  return STAT_DEFS.find(s => s.key === key) || STAT_DEFS[0];
}

function incrementStat(profile, key, amount = 1) {
  const current = profile[key] || 0;
  profile[key] = Math.min(STAT_CAP, current + amount);
}

// Дата в ЛОКАЛЬНОМ времени пользователя (не UTC!) — важно для сброса квестов по календарному дню
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// === Мир / экспедиции — общий справочник и завершение похода с ЛЮБОЙ страницы ===
const REGIONS = [
  { id: 'home', name: 'Уютный Очаг', desc: 'Безопасная зона для отдыха', energyCost: 10, timeSec: 15, icon: '🏠' },
  { id: 'village', name: 'Торговый Посад', desc: 'Поиски редких предметов и заданий', energyCost: 20, timeSec: 30, icon: '🏪' },
  { id: 'forest', name: 'Забытый Лес', desc: 'Опасные тропы и ценное золото', energyCost: 35, timeSec: 50, icon: '🌲' }
];

// Проверяет все походы пользователя и завершает те, что уже истекли — независимо от того,
// на какой странице приложения сейчас находится пользователь.
// Возвращает массив завершённых регионов (для показа уведомления), либо [].
async function resolveFinishedExpeditions(user, profile) {
  const { data } = await sb.from('region_state').select('*').eq('user_id', user.id).eq('exploring', true);
  const active = data || [];
  const now = Date.now();
  const finished = [];

  for (const state of active) {
    if (new Date(state.finish_time).getTime() > now) continue;
    const reg = REGIONS.find(r => r.id === state.region_id);
    if (!reg) continue;

    await sb.from('region_state').update({ exploring: false, finish_time: null }).eq('user_id', user.id).eq('region_id', reg.id);

    const goldWon = Math.floor(Math.random() * 20) + 10;
    const xpWon = Math.floor(Math.random() * 30) + 15;
    profile.gold += goldWon;
    profile.xp += xpWon;
    checkLevelUp(profile);

    if (Math.random() < 0.45) {
      const isHp = Math.random() < 0.3;
      await sb.from('inventory_items').insert(isHp
        ? { user_id: user.id, name: 'Целебный отвар', rarity: 'Обычный', description: 'Восстанавливает +30 HP', type: 'hp', val: 30, icon: '💗' }
        : { user_id: user.id, name: 'Зелье энергии', rarity: 'Редкий', description: 'Восстанавливает +50 энергии', type: 'energy', val: 50, icon: '🧪' });
    }

    await logActivity(user.id, 'expedition_done', `Экспедиция в "${reg.name}" завершена`);
    finished.push({ region: reg, gold: goldWon, xp: xpWon });
  }

  if (finished.length > 0) {
    await saveProfileFields(user.id, { gold: profile.gold, xp: profile.xp, level: profile.level, skill_points: profile.skill_points, hp: profile.hp, energy: profile.energy });
  }

  return finished;
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
  { key: 'social', name: 'Общение', icon: '🗣️' },
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
  const d = new Date(dateStr + 'T00:00:00'); // парсится как локальное время
  const day = (d.getDay() + 6) % 7; // понедельник = 0
  d.setDate(d.getDate() - day + 3);
  const firstThursday = new Date(d.getFullYear(), 0, 4);
  const week = 1 + Math.round(((d - firstThursday) / 86400000 - 3 + ((firstThursday.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${week}`;
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
  const today = localDateStr();
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
