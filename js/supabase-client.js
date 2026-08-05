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
