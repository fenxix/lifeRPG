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
  const accent = localStorage.getItem('liferpg-accent');
  if (accent) document.documentElement.style.setProperty('--terracotta', accent);
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
const WEEKDAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

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
  { key: 'daily', name: 'Ежедневное', hint: 'Обычный ежедневный квест. Множитель награды ×1.0.' },
  { key: 'deadline', name: 'С дедлайном', hint: 'Задача со сроком выполнения — разовая или на будущее. Множитель ×1.2.' },
  { key: 'weekly', name: 'Еженедельное', hint: 'Выполняется раз в неделю. Повышенный множитель ×1.6 — компенсация за то, что случается реже.' },
  { key: 'habit', name: 'Привычка', hint: 'Небольшое повторяющееся действие. Базовый множитель ×0.85, но за серию подряд идут бонусы: +20% награды за каждые 7 дней без пропуска (максимум +100%).' },
];

const QUEST_PRIORITIES = [
  { key: 'low', name: 'Низкий', color: '#7D9471' },
  { key: 'medium', name: 'Средний', color: '#C08430' },
  { key: 'high', name: 'Высокий', color: '#D97F4F' },
  { key: 'critical', name: 'Критический', color: '#D9634F' },
];

const TYPE_REWARD_MULTIPLIER = { deadline: 1.2, daily: 1.0, weekly: 1.6, habit: 0.85 };
const MAX_QUEST_XP = 150; // жёсткий потолок — защита от читерства

// Бонус привычки за серию подряд: +20% за каждые полные 7 дней, максимум +100% (5 недель)
function habitStreakMultiplier(streak) {
  const weeks = Math.min(Math.floor((streak || 0) / 7), 5);
  return 1 + weeks * 0.20;
}

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
  if (quest.task_type === 'deadline') return false; // задачи с дедлайном не сбрасываются сами
  if (!quest.last_completed_date) return true;
  if (quest.task_type === 'weekly') {
    return isoWeekKey(quest.last_completed_date) !== isoWeekKey(todayStr);
  }
  return quest.last_completed_date !== todayStr; // daily и habit — по дню
}

function addDaysToDateStr(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return localDateStr(d);
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
      const dailyQuests = quests.filter(q => q.task_type === 'daily' || q.task_type === 'habit' || !q.task_type);
      const uncompletedDaily = dailyQuests.filter(q => !q.is_completed_today);
      if (dailyQuests.length > 0 && uncompletedDaily.length === 0) {
        profile.daily_streak += 1;
      } else if (uncompletedDaily.length > 0) {
        if ((profile.shield_count || 0) > 0) {
          // Щит защищает серию от одного пропущенного дня — тратится вместо сброса стрика
          profile.shield_count -= 1;
        } else {
          profile.daily_streak = 0;
        }
      }
    }
    profile.last_login_date = today;
    await saveProfileFields(user.id, { last_login_date: today, daily_streak: profile.daily_streak, shield_count: profile.shield_count || 0 });
  }

  const toReset = quests.filter(q => questNeedsReset(q, today));
  if (toReset.length > 0) {
    await sb.from('quests').update({ is_completed_today: false }).in('id', toReset.map(q => q.id));
    toReset.forEach(q => { q.is_completed_today = false; });
  }

  // Если привычку пропустили (не выполняли ни вчера, ни сегодня) — её личная серия обнуляется
  const yesterday = addDaysToDateStr(today, -1);
  const habitsToResetStreak = quests.filter(q =>
    q.task_type === 'habit' && (q.habit_streak || 0) > 0 &&
    q.last_completed_date && q.last_completed_date !== today && q.last_completed_date !== yesterday
  );
  if (habitsToResetStreak.length > 0) {
    await sb.from('quests').update({ habit_streak: 0 }).in('id', habitsToResetStreak.map(q => q.id));
    habitsToResetStreak.forEach(q => { q.habit_streak = 0; });
  }

  return { didReset, previousDate };
}

// === Квесты дня и завершение дня ===
// Общая логика "какие квесты считаются днём" — используется на Главной и в Квестах.
// Привычки считаются наравне с ежедневными; еженедельные — нет (у них свой цикл).
function getTodaysRelevantQuests(quests) {
  const today = localDateStr();
  return quests.filter(q => (q.task_type === 'daily' || q.task_type === 'habit' || !q.task_type) || (q.due_date === today));
}

// День считается завершённым на 100%, если есть хотя бы 1 квест дня и все они выполнены
function isDayFullyComplete(quests) {
  const relevant = getTodaysRelevantQuests(quests);
  return relevant.length > 0 && relevant.every(q => q.is_completed_today);
}

function isChestAvailable(profile, quests) {
  const today = localDateStr();
  return isDayFullyComplete(quests) && profile.last_chest_date !== today;
}

// Текущий множитель XP от активного "Ускорителя XP" (если ещё не истёк)
function currentXpBoostMultiplier(profile) {
  if (profile.xp_boost_until && new Date(profile.xp_boost_until).getTime() > Date.now()) {
    return profile.xp_boost_mult || 1;
  }
  return 1;
}

// === Сундук дня ===
const CHEST_BUY_PRICE = 1000; // цена прямой покупки сундука в Магазине

const CHEST_RARITIES = [
  { key: 'common', name: 'Обычный', color: '#A8977E', weight: 55 },
  { key: 'rare', name: 'Редкий', color: '#4E7DFF', weight: 30 },
  { key: 'epic', name: 'Эпический', color: '#9B59B6', weight: 12 },
  { key: 'legendary', name: 'Легендарный', color: '#E3A857', weight: 3 },
];

const TITLE_POOL = ['Хранитель Рассвета', 'Несгибаемый', 'Мастер Порядка', 'Искатель Смысла', 'Тень Дисциплины', 'Страж Привычек', 'Архитектор Дня', 'Вечный Странник'];

const ACCENT_POOL = [
  { name: 'Изумруд', hex: '#4E9E6F' },
  { name: 'Аметист', hex: '#8B5FBF' },
  { name: 'Сапфир', hex: '#3E7CB1' },
  { name: 'Роза', hex: '#D9527F' },
  { name: 'Уголь', hex: '#4A4A4A' },
];

const TROPHY_ITEMS = [
  { name: 'Осколок Памяти', icon: '🔮', desc: 'Хранит отпечаток удачного дня' },
  { name: 'Печать Воли', icon: '📜', desc: 'Символ несгибаемой дисциплины' },
  { name: 'Медальон Странника', icon: '🧿', desc: 'Талисман на удачу в делах' },
  { name: 'Кристалл Фокуса', icon: '💎', desc: 'Говорят, обостряет разум' },
  { name: 'Перо Феникса', icon: '🪶', desc: 'Символ возрождения после трудного дня' },
];

// Пассивные бонусы для экипируемых оберегов (трофеи из сундуков + редкие предметы Магазина).
// Экипирован может быть только один. Бонус применяется к наградам с квестов.
const TRINKET_EFFECTS = {
  'Осколок Памяти': { xp: 0.08, label: '+8% XP' },
  'Печать Воли': { xp: 0.08, label: '+8% XP' },
  'Медальон Странника': { gold: 0.08, label: '+8% золота' },
  'Кристалл Фокуса': { xp: 0.10, label: '+10% XP' },
  'Перо Феникса': { gold: 0.10, label: '+10% золота' },
  'Аура героя': { xp: 0.15, label: '+15% XP' },
  'Клинок Рассвета': { gold: 0.15, label: '+15% золота' },
  'Плащ Тумана': { gold: 0.12, label: '+12% золота' },
  'Корона Стойкости': { xp: 0.15, label: '+15% XP' },
  'Крылья Феникса': { xp: 0.15, label: '+15% XP' },
  'Печать Времени': { xp: 0.12, label: '+12% XP' },
  'Шёпот Звёзд': { xp: 0.18, label: '+18% XP' },
};

function getTrinketEffect(itemName) {
  return TRINKET_EFFECTS[itemName] || null;
}

// Множители от текущего экипированного оберега (по умолчанию 1 — эффекта нет)
function currentTrinketMultipliers(profile) {
  return {
    xp: 1 + (profile.equipped_trinket_xp || 0),
    gold: 1 + (profile.equipped_trinket_gold || 0),
  };
}

// Пулы возможных наград по редкости (у каждой — свой вес внутри пула)
const CHEST_REWARD_POOLS = {
  common: [
    { type: 'gold', min: 30, max: 60, weight: 70 },
    { type: 'xp_potion', min: 15, max: 30, weight: 30 },
  ],
  rare: [
    { type: 'gold', min: 60, max: 120, weight: 40 },
    { type: 'xp_potion', min: 30, max: 50, weight: 25 },
    { type: 'shield', weight: 15 },
    { type: 'trophy', weight: 20 },
  ],
  epic: [
    { type: 'gold', min: 150, max: 250, weight: 30 },
    { type: 'xp_boost', mult: 1.5, hours: 24, weight: 25 },
    { type: 'trophy', weight: 25 },
    { type: 'title', weight: 20 },
  ],
  legendary: [
    { type: 'gold', min: 350, max: 600, weight: 25 },
    { type: 'xp_boost', mult: 2, hours: 24, weight: 25 },
    { type: 'title', weight: 20 },
    { type: 'customization', weight: 15 },
    { type: 'trophy', weight: 15 },
  ],
};

function weightedPick(list) {
  const total = list.reduce((s, x) => s + x.weight, 0);
  let r = Math.random() * total;
  for (const item of list) {
    if (r < item.weight) return item;
    r -= item.weight;
  }
  return list[list.length - 1];
}

function rollChestRarity() {
  return weightedPick(CHEST_RARITIES).key;
}

// Собирает конкретную награду (ещё не применённую) для показа в UI
function rollChestReward(rarity, profile) {
  let pool = CHEST_REWARD_POOLS[rarity] || CHEST_REWARD_POOLS.common;
  // Если щит уже есть — не даём второй, перебрасываем в этот же пул без 'shield'
  if ((profile.shield_count || 0) > 0) pool = pool.filter(x => x.type !== 'shield');
  const picked = weightedPick(pool);

  const reward = { rarity, type: picked.type };
  if (picked.type === 'gold') {
    reward.amount = Math.floor(Math.random() * (picked.max - picked.min + 1)) + picked.min;
    reward.label = `+${reward.amount} золота`;
    reward.icon = '🪙';
  } else if (picked.type === 'xp_potion') {
    reward.amount = Math.floor(Math.random() * (picked.max - picked.min + 1)) + picked.min;
    reward.label = `Зелье XP (+${reward.amount} XP)`;
    reward.icon = '🧪';
  } else if (picked.type === 'shield') {
    reward.label = 'Щит серии';
    reward.icon = '🛡️';
  } else if (picked.type === 'xp_boost') {
    reward.mult = picked.mult;
    reward.hours = picked.hours;
    reward.label = `Ускоритель XP ×${picked.mult} на ${picked.hours}ч`;
    reward.icon = '⚡';
  } else if (picked.type === 'trophy') {
    const t = TROPHY_ITEMS[Math.floor(Math.random() * TROPHY_ITEMS.length)];
    reward.item = t;
    reward.label = t.name;
    reward.icon = t.icon;
  } else if (picked.type === 'title') {
    const pool2 = TITLE_POOL.filter(t => !(profile.unlocked_titles || []).includes(t));
    const t = (pool2.length > 0 ? pool2 : TITLE_POOL)[Math.floor(Math.random() * (pool2.length > 0 ? pool2.length : TITLE_POOL.length))];
    reward.title = t;
    reward.label = `Титул «${t}»`;
    reward.icon = '👑';
  } else if (picked.type === 'customization') {
    const pool2 = ACCENT_POOL.filter(a => !(profile.unlocked_accents || []).includes(a.hex));
    const a = (pool2.length > 0 ? pool2 : ACCENT_POOL)[Math.floor(Math.random() * (pool2.length > 0 ? pool2.length : ACCENT_POOL.length))];
    reward.accent = a;
    reward.label = `Цветовая тема «${a.name}»`;
    reward.icon = '🎨';
  }
  return reward;
}

// Применяет награду: мутирует profile и пишет изменения в БД. Возвращает reward (для UI).
// trackDate=false — для купленных в Магазине сундуков: не трогает last_chest_date,
// поэтому покупка не блокирует и не блокируется бесплатным сундуком за квесты.
async function applyChestReward(user, profile, reward, trackDate = true) {
  const fields = {};
  if (reward.type === 'gold') {
    profile.gold += reward.amount;
    fields.gold = profile.gold;
  } else if (reward.type === 'xp_potion') {
    await sb.from('inventory_items').insert({ user_id: user.id, name: 'Зелье опыта', rarity: CHEST_RARITIES.find(r => r.key === reward.rarity).name, description: `Восстанавливает +${reward.amount} XP`, type: 'xp', val: reward.amount, icon: '🧪' });
  } else if (reward.type === 'shield') {
    profile.shield_count = Math.min(1, (profile.shield_count || 0) + 1);
    fields.shield_count = profile.shield_count;
  } else if (reward.type === 'xp_boost') {
    profile.xp_boost_mult = reward.mult;
    profile.xp_boost_until = new Date(Date.now() + reward.hours * 3600 * 1000).toISOString();
    fields.xp_boost_mult = profile.xp_boost_mult;
    fields.xp_boost_until = profile.xp_boost_until;
  } else if (reward.type === 'trophy') {
    await sb.from('inventory_items').insert({ user_id: user.id, name: reward.item.name, rarity: CHEST_RARITIES.find(r => r.key === reward.rarity).name, description: reward.item.desc, type: 'trophy', val: 0, icon: reward.item.icon });
  } else if (reward.type === 'title') {
    profile.unlocked_titles = [...(profile.unlocked_titles || []), reward.title];
    profile.title = reward.title;
    fields.unlocked_titles = profile.unlocked_titles;
    fields.title = profile.title;
  } else if (reward.type === 'customization') {
    profile.unlocked_accents = [...(profile.unlocked_accents || []), reward.accent.hex];
    profile.accent_color = reward.accent.hex;
    fields.unlocked_accents = profile.unlocked_accents;
    fields.accent_color = profile.accent_color;
    applyAccentColor(profile.accent_color);
  }

  if (trackDate) {
    profile.last_chest_date = localDateStr();
    fields.last_chest_date = profile.last_chest_date;
  }

  if (Object.keys(fields).length > 0) await saveProfileFields(user.id, fields);
  return reward;
}

// Применяет акцентный цвет прямо сейчас (CSS-переменная) и кэширует его для мгновенной подгрузки на след. странице
function applyAccentColor(hex) {
  if (!hex) return;
  document.documentElement.style.setProperty('--terracotta', hex);
  localStorage.setItem('liferpg-accent', hex);
}

// === Редкий предмет дня (магазин) — детерминированно одинаков у всех в течение календарного дня ===
const RARE_SHOP_ITEMS = [
  { name: 'Аура героя', icon: '✨', desc: 'Мерцающая аура вокруг персонажа' },
  { name: 'Клинок Рассвета', icon: '⚔️', desc: 'Легендарное оружие первых искателей' },
  { name: 'Плащ Тумана', icon: '🌫️', desc: 'Скрывает владельца от неудач' },
  { name: 'Корона Стойкости', icon: '👑', desc: 'Носится теми, кто не сдаётся' },
  { name: 'Крылья Феникса', icon: '🦅', desc: 'Символ возрождения после падений' },
  { name: 'Печать Времени', icon: '⏳', desc: 'Хранит память о каждом завершённом дне' },
  { name: 'Шёпот Звёзд', icon: '🌟', desc: 'Редчайшая находка искателей приключений' },
];

function getDailyRareItem() {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
  const item = RARE_SHOP_ITEMS[dayOfYear % RARE_SHOP_ITEMS.length];
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  return { ...item, price: 2000, expiresAt: midnight };
}

// === Питомец ===
const PET_XP_PER_LEVEL = 40;
function petXpNeeded(level) { return level * PET_XP_PER_LEVEL; }

// diet: какие типы еды питомец ест нормально (см. FOOD_TYPE_LABELS). Всё остальное — "не та еда".
// story: лор-текст для плашки "История" на странице питомца.
const PET_SPECIES = [
  // Обычное яйцо
  { key: 'firetail', name: 'Огнехвост', icon: '🦎', rarity: 'common', egg: 'common', diet: ['bug', 'meat'],
    story: 'Вылупляется из тёплой земли у самых старых кострищ — говорят, огонь оставляет в яйце частицу себя. Обожает хрустящих жуков и мясо: чем сытнее укус, тем ярче тлеет хвост по вечерам.' },
  { key: 'fluffy', name: 'Пушистик', icon: '🐹', rarity: 'common', egg: 'common', diet: ['plant', 'sweet'],
    story: 'Найден в стоге сена на окраине деревни — просто однажды прибежал и отказался уходить. Мясо на дух не переносит, зато готов на всё ради сладкого и свежей травы.' },
  { key: 'falcon', name: 'Соколёнок', icon: '🦅', rarity: 'rare', egg: 'common', diet: ['meat', 'fish'],
    story: 'Выпал из гнезда высоко в горах и был выхожен вручную — с тех пор не отходит ни на шаг. Настоящий хищник: любит мясо и свежую рыбу, а вот сладкое даже не понюхает.' },
  { key: 'mooncat', name: 'Лунный кот', icon: '🐱', rarity: 'rare', egg: 'common', diet: ['fish', 'sweet'],
    story: 'Появляется только в полнолуние — приходит на свет фонаря и садится рядом, будто был знаком всегда. Обожает рыбу и что-нибудь сладкое на десерт.' },
  { key: 'golem', name: 'Каменный голем', icon: '🗿', rarity: 'epic', egg: 'common', diet: ['plant'],
    story: 'Слепленный из речной глины и старого мха древним ремесленником, он ожил, когда мох в трещинах пророс насквозь. Питается исключительно растениями — камню нужен только мох, всё остальное он даже не замечает.' },
  // Тёмное яйцо
  { key: 'shadowwolf', name: 'Теневой волк', icon: '🐺', rarity: 'common', egg: 'dark', diet: ['meat'],
    story: 'Родился из тени, отброшенной старым дубом в безлунную ночь. Признаёт только мясо — хищник до мозга костей, остальную еду обходит стороной.' },
  { key: 'swampspirit', name: 'Болотный дух', icon: '👻', rarity: 'rare', egg: 'dark', diet: ['bug', 'plant'],
    story: 'Поднимается из тумана над трясиной, куда никто не заходит после заката. Кормится жуками и болотными травами — остальное считает "сухой едой не по духу".' },
  { key: 'stormgriffin', name: 'Штормовой грифон', icon: '🦇', rarity: 'rare', egg: 'dark', diet: ['meat', 'fish'],
    story: 'Вылупился прямо в грозу — говорят, молния попала в яйцо и не разбила, а разбудила его. Ест только мясо и рыбу, пойманные им самим "на лету".' },
  { key: 'crystalserpent', name: 'Кристальный змей', icon: '🐍', rarity: 'epic', egg: 'dark', diet: ['bug'],
    story: 'Найден свернувшимся в жиле горного хрусталя — чешуя до сих пор мерцает гранями. Крайне переборчив: ест только жуков, любую другую еду отказывается даже пробовать — и она ему вредит.' },
  { key: 'ancientdragon', name: 'Древний дракон', icon: '🐉', rarity: 'legendary', egg: 'dark', diet: ['meat', 'fish', 'sweet'],
    story: 'По легенде — последнее яйцо из кладки дракона, что тысячу лет назад уснул под горой. Ест почти всё съедобное разом — мясо, рыбу и сладкое, — но никогда траву или жуков.' },
];

const PET_EGGS = {
  common: { key: 'common', name: 'Обычное яйцо', icon: '🥚', price: 500, weights: { common: 55, rare: 35, epic: 10 } },
  dark: { key: 'dark', name: 'Тёмное яйцо', icon: '🌑', price: 1800, weights: { common: 20, rare: 40, epic: 25, legendary: 15 } },
};

// Читаемые названия и иконки типов еды
const FOOD_TYPE_LABELS = {
  meat: { label: 'Мясо', icon: '🍗' },
  bug: { label: 'Жуки', icon: '🪲' },
  fish: { label: 'Рыба', icon: '🐟' },
  plant: { label: 'Трава', icon: '🌿' },
  sweet: { label: 'Сладкое', icon: '🍬' },
  elixir: { label: 'Эликсир', icon: '🧪' },
};

function petSpeciesDef(profile) {
  return PET_SPECIES.find(s => s.key === profile.pet_species) || null;
}

// Название/цвет редкости — переиспользует таблицу редкостей сундуков
function petRarityInfo(rarity) {
  return CHEST_RARITIES.find(r => r.key === rarity) || { name: rarity, color: '#A8977E' };
}

function petStageBadge(level, mutated) {
  if (mutated) return '✨';
  if (level >= 30) return '👑';
  if (level >= 10) return '🌟';
  return '';
}

function petStageName(level, mutated) {
  if (mutated) return 'Мутант';
  if (level >= 30) return 'Взрослый';
  if (level >= 10) return 'Юный';
  return 'Детёныш';
}

function petVisual(profile) {
  const sp = petSpeciesDef(profile);
  if (!sp) return '🥚';
  return `${petStageBadge(profile.pet_level || 1, profile.pet_mutated)}${sp.icon}`;
}

// Бонус к XP игрока от питомца — раскрывается на "Юный"+ уровне (20+)
function petXpBonus(profile) {
  const sp = petSpeciesDef(profile);
  if (!sp || (profile.pet_level || 0) < 20) return 0;
  if (profile.pet_mutated) return 0.08; // мутировавший всегда даёт максимум
  return { common: 0.02, rare: 0.03, epic: 0.05, legendary: 0.08 }[sp.rarity] || 0;
}

// Бонус к урону по боссу от питомца — растёт с уровнем, потолок +20%
function petBossDamageBonus(profile) {
  if (!profile.pet_species) return 0;
  return Math.min(0.20, (profile.pet_level || 0) * 0.005);
}

// Мутирует profile (pet_level, pet_xp) пока хватает XP питомца. Возвращает true если был левел-ап
function checkPetLevelUp(profile) {
  if (!profile.pet_species) return false;
  let leveled = false;
  let needed = petXpNeeded(profile.pet_level || 1);
  while ((profile.pet_xp || 0) >= needed) {
    profile.pet_xp -= needed;
    profile.pet_level = (profile.pet_level || 1) + 1;
    needed = petXpNeeded(profile.pet_level);
    leveled = true;
  }
  return leveled;
}

// Открывает яйцо: возвращает выбранный вид питомца (ещё не применённый)
function rollEggPet(eggKey) {
  const egg = PET_EGGS[eggKey];
  const candidates = PET_SPECIES.filter(s => s.egg === eggKey).map(s => ({ ...s, weight: egg.weights[s.rarity] || 1 }));
  return weightedPick(candidates);
}

// Применяет нового питомца из яйца — заменяет текущего, если был. Мутирует profile и пишет в БД.
async function applyNewPet(user, profile, species) {
  profile.pet_species = species.key;
  profile.pet_rarity = species.rarity;
  profile.pet_name = species.name;
  profile.pet_level = 1;
  profile.pet_xp = 0;
  profile.pet_mutated = false;
  profile.pet_last_fed_date = null;
  profile.pet_health = 100;
  profile.pet_poisoned = false;
  profile.pet_bad_streak = 0;
  const discovered = new Set(profile.pet_discovered || []);
  discovered.add(species.key);
  profile.pet_discovered = Array.from(discovered);
  await saveProfileFields(user.id, {
    pet_species: profile.pet_species, pet_rarity: profile.pet_rarity, pet_name: profile.pet_name,
    pet_level: profile.pet_level, pet_xp: profile.pet_xp, pet_mutated: false, pet_last_fed_date: null,
    pet_health: 100, pet_poisoned: false, pet_bad_streak: 0, pet_discovered: profile.pet_discovered,
  });
}

// Питомец умер от долгого неправильного кормления — сбрасывает его, но сохраняет коллекцию открытых видов
async function releaseDeadPet(user, profile) {
  profile.pet_species = null;
  profile.pet_rarity = null;
  profile.pet_name = null;
  profile.pet_level = 1;
  profile.pet_xp = 0;
  profile.pet_mutated = false;
  profile.pet_last_fed_date = null;
  profile.pet_health = 100;
  profile.pet_poisoned = false;
  profile.pet_bad_streak = 0;
  await saveProfileFields(user.id, {
    pet_species: null, pet_rarity: null, pet_name: null, pet_level: 1, pet_xp: 0, pet_mutated: false,
    pet_last_fed_date: null, pet_health: 100, pet_poisoned: false, pet_bad_streak: 0,
  });
}

// Настроение питомца
function petMood(profile) {
  if (!profile.pet_species) return null;
  const health = profile.pet_health ?? 100;
  if (health <= 30) return { emoji: '🤢', label: 'Плохо себя чувствует' };
  if (profile.pet_poisoned) return { emoji: '🤒', label: 'Отравлен' };
  const today = localDateStr();
  if (profile.pet_last_fed_date === today) return { emoji: '😄', label: 'Счастлив' };
  if ((profile.daily_streak || 0) === 0) return { emoji: '😢', label: 'Грустит' };
  return { emoji: '😐', label: 'Проголодался' };
}

// === Еда для питомца — покупается в Магазине, попадает в инвентарь, "используется" оттуда ===
// type определяет, каким питомцам эта еда подходит (см. diet у PET_SPECIES в FOOD_TYPE_LABELS)
const PET_FOOD_ITEMS = [
  { name: 'Мясной паёк', icon: '🍗', price: 20, type: 'meat', xpMin: 15, xpMax: 25, bonusChance: 0.08, bonusGoldMin: 5, bonusGoldMax: 15, desc: 'Простое мясо для хищных питомцев' },
  { name: 'Отборное мясо', icon: '🥩', price: 60, type: 'meat', xpMin: 25, xpMax: 35, bonusChance: 0.12, bonusGoldMin: 10, bonusGoldMax: 20, desc: 'Мясо получше — сытнее и больше XP' },
  { name: 'Хрустящие жуки', icon: '🪲', price: 15, type: 'bug', xpMin: 12, xpMax: 20, bonusChance: 0.06, bonusGoldMin: 5, bonusGoldMax: 10, desc: 'Горсть жуков — деликатес для некоторых' },
  { name: 'Свежая рыба', icon: '🐟', price: 25, type: 'fish', xpMin: 18, xpMax: 28, bonusChance: 0.08, bonusGoldMin: 5, bonusGoldMax: 15, desc: 'Улов дня, любят водные и крылатые питомцы' },
  { name: 'Сочная трава', icon: '🌿', price: 15, type: 'plant', xpMin: 12, xpMax: 20, bonusChance: 0.06, bonusGoldMin: 5, bonusGoldMax: 10, desc: 'Травы и мох для травоядных питомцев' },
  { name: 'Лакомство', icon: '🍬', price: 100, type: 'sweet', xpMin: 40, xpMax: 60, bonusChance: 0.18, bonusGoldMin: 20, bonusGoldMax: 40, desc: 'Питомец в восторге — больше XP и шанс находки' },
  { name: 'Мутагенный эликсир', icon: '🧪', price: 3000, type: 'elixir', xpMin: 80, xpMax: 120, bonusChance: 0, mutate: true, desc: 'Мутирует питомца, усиливая его. Нужен 30 уровень питомца. Едят все' },
];

function getPetFoodDef(name) {
  return PET_FOOD_ITEMS.find(f => f.name === name) || null;
}

// Кормит питомца конкретным предметом еды. Мутирует profile. Возвращает результат для UI.
// Если еда не подходит виду (не входит в его diet) — питомец травится вместо того, чтобы получить XP.
// При долгом кормлении неправильной едой без "лечения" нормальной есть очень маленький шанс, что питомец погибнет.
function feedPet(profile, foodDef) {
  const sp = petSpeciesDef(profile);
  if (!sp) return { refused: 'Питомца нет' };

  if (foodDef.mutate) {
    if ((profile.pet_level || 0) < 30) return { refused: 'Питомец ещё не дорос — нужен 30 уровень' };
    if (profile.pet_mutated) return { refused: 'Питомец уже мутировал' };
    profile.pet_mutated = true;
  } else if (!sp.diet.includes(foodDef.type)) {
    // Неправильная еда — травит питомца
    const healthLoss = Math.floor(Math.random() * 15) + 10; // 10-24
    profile.pet_health = Math.max(0, (profile.pet_health ?? 100) - healthLoss);
    profile.pet_poisoned = true;
    profile.pet_bad_streak = (profile.pet_bad_streak || 0) + 1;
    let died = false;
    if (profile.pet_bad_streak >= 3 && profile.pet_health <= 25 && Math.random() < 0.04) {
      died = true;
    }
    return { wrongFood: true, healthLoss, died, health: profile.pet_health };
  }

  const xpGained = Math.floor(Math.random() * (foodDef.xpMax - foodDef.xpMin + 1)) + foodDef.xpMin;
  profile.pet_xp = (profile.pet_xp || 0) + xpGained;
  profile.pet_last_fed_date = localDateStr();
  const wasUnwell = !!profile.pet_poisoned || (profile.pet_health ?? 100) < 100;
  profile.pet_health = Math.min(100, (profile.pet_health ?? 100) + 15);
  profile.pet_poisoned = false;
  profile.pet_bad_streak = 0;
  const leveled = checkPetLevelUp(profile);
  let bonusGold = 0;
  if (foodDef.bonusChance && Math.random() < foodDef.bonusChance) {
    bonusGold = Math.floor(Math.random() * (foodDef.bonusGoldMax - foodDef.bonusGoldMin + 1)) + foodDef.bonusGoldMin;
    profile.gold += bonusGold;
  }
  return { xpGained, bonusGold, leveled, mutated: !!foodDef.mutate, healed: wasUnwell };
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

// Загружает файл аватара в Supabase Storage (бакет 'avatars') и возвращает публичную ссылку.
// Файл кладётся в папку с id пользователя — так политики доступа проще настраивать.
async function uploadAvatar(userId, file) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const path = `${userId}/avatar_${Date.now()}.${ext}`;

  const { error: uploadError } = await sb.storage.from('avatars').upload(path, file, {
    cacheControl: '3600',
    upsert: true,
  });
  if (uploadError) {
    console.error('Avatar upload error:', uploadError);
    return null;
  }

  const { data } = sb.storage.from('avatars').getPublicUrl(path);
  return data?.publicUrl || null;
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

// === Анимация вскрытия сундука/яйца — общая для Главной, Квестов и Магазина ===
const chestAnimStyle = document.createElement('style');
chestAnimStyle.innerText = `
@keyframes chestShake {
  0%,100% { transform: translateX(0) rotate(0); }
  10% { transform: translateX(-6px) rotate(-8deg); } 20% { transform: translateX(6px) rotate(8deg); }
  30% { transform: translateX(-6px) rotate(-6deg); } 40% { transform: translateX(6px) rotate(6deg); }
  50% { transform: translateX(-4px) rotate(-4deg); } 60% { transform: translateX(4px) rotate(4deg); }
  70% { transform: translateX(-2px) rotate(-2deg); } 80% { transform: translateX(2px) rotate(2deg); }
  90% { transform: translateX(-1px) rotate(-1deg); }
}
@keyframes chestFlash { 0% { opacity:0; transform: scale(.5); } 40% { opacity:1; transform: scale(1.7); } 100% { opacity:0; transform: scale(2.4); } }
@keyframes rewardPop { 0% { transform: scale(.3); opacity:0; } 60% { transform: scale(1.18); opacity:1; } 100% { transform: scale(1); opacity:1; } }
`;
document.head.appendChild(chestAnimStyle);

// Трясёт визуал сундука/яйца и даёт вспышку цветом редкости. Возвращает Promise, resolve — когда пора показывать награду.
function animateChestOpen(visualEl, rarityColor) {
  return new Promise(resolve => {
    const parent = visualEl.parentElement;
    if (parent && getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    visualEl.style.animation = 'chestShake .6s ease-in-out';
    const flash = document.createElement('div');
    flash.style.cssText = `position:absolute;left:50%;top:50%;width:90px;height:90px;margin:-45px 0 0 -45px;border-radius:50%;background:radial-gradient(circle, ${rarityColor}aa, transparent 70%);pointer-events:none;animation:chestFlash .55s ease-out forwards;z-index:1;`;
    if (parent) parent.appendChild(flash);
    setTimeout(() => { visualEl.style.animation = ''; flash.remove(); resolve(); }, 650);
  });
}

// Ставит иконку награды с "поп"-анимацией появления
function playRewardReveal(visualEl, iconEmoji) {
  visualEl.innerText = iconEmoji;
  visualEl.style.animation = 'rewardPop .4s ease-out';
  setTimeout(() => { visualEl.style.animation = ''; }, 400);
  if (navigator.vibrate) navigator.vibrate([30, 30, 60]);
    }
