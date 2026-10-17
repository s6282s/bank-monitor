'use strict';
const WATCH_KEY = 'bank_watch_v3';
const MAX_AGE = 36 * 60 * 60 * 1000;
const $ = id => document.getElementById(id);
let catalog = [];
let validUntil = 0;
let expiryTimer;
let watchlist = [];
function organization(value) {
  return value && typeof value.id === 'string' && /^\d{1,5}$/.test(value.id) &&
    typeof value.name === 'string' && value.name.trim().length > 0;
}
try {
  const saved = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]');
  if (!Array.isArray(saved) || !saved.every(organization)) throw Error('Invalid selection');
  watchlist = [...new Map(saved.map(x => [x.id, {id:x.id, name:x.name}])).values()];
} catch {
  storageWarning('Не удалось прочитать сохранённый выбор. Выберите организации заново; проверьте доступ к хранилищу браузера.');
}
function storageWarning(message) { $('storageStatus').hidden = false; $('storageStatus').textContent = message; }
function persist() {
  try { localStorage.setItem(WATCH_KEY, JSON.stringify(watchlist)); $('storageStatus').hidden = true; }
  catch { storageWarning('Не удалось сохранить выбор. Сейчас он доступен только до закрытия страницы. Разрешите хранение данных в браузере.'); }
}
function row(item, action, label) {
  const li = document.createElement('li');
  const identity = document.createElement('div');
  const name = document.createElement('strong');
  name.textContent = item.name;
  const number = document.createElement('small');
  number.textContent = 'Регистрационный № ' + item.id;
  identity.append(name, number);
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = label;
  button.setAttribute('aria-label', label + ': ' + item.name + ', № ' + item.id);
  button.addEventListener('click', action);
  li.append(identity, button);
  return {li, button};
}
function renderWatchlist() {
  $('bankCount').textContent = watchlist.length;
  $('watchEmpty').hidden = watchlist.length > 0;
  $('manageTitle').textContent = watchlist.length ? 'Мои организации' : 'Выберите кредитные организации';
  $('watchlist').replaceChildren(...watchlist.map(item => row(item, () => {
    watchlist = watchlist.filter(x => x.id !== item.id);
    persist(); renderWatchlist(); renderCatalog();
  }, 'Удалить').li));
}
function unavailable() {
  clearTimeout(expiryTimer); catalog = []; validUntil = 0;
  $('bankSearch').disabled = true;
  $('registryStatus').textContent = 'Справочник ЦБ недоступен';
  $('catalogInfo').textContent = 'Актуальный справочник Банка России недоступен. Добавление организаций временно невозможно. Попробуйте обновить данные позже. Ваш список наблюдения сохранён; его можно просматривать и редактировать.';
  renderCatalog();
}
function renderCatalog() {
  if (catalog.length && Date.now() >= validUntil) { unavailable(); return; }
  const query = $('bankSearch').value.trim().toLocaleLowerCase('ru');
  const found = catalog.filter(x => (x.name + ' ' + x.id).toLocaleLowerCase('ru').includes(query));
  $('resultCount').textContent = catalog.length ? 'Найдено: ' + found.length + (found.length > 80 ? '. Показаны первые 80. Уточните поиск.' : '') : '';
  $('catalogResults').replaceChildren(...found.slice(0,80).map(item => {
    const added = watchlist.some(x => x.id === item.id);
    const result = row(item, () => {
      if (Date.now() >= validUntil) { unavailable(); return; }
      if (!watchlist.some(x => x.id === item.id)) {
        watchlist.push({id:item.id, name:item.name}); persist(); renderWatchlist(); renderCatalog();
      }
    }, added ? 'Добавлено' : 'Добавить');
    result.button.disabled = added;
    return result.li;
  }));
}
async function refreshRegistry() {
  $('refreshRegistry').disabled = true;
  clearTimeout(expiryTimer); catalog = []; validUntil = 0; renderCatalog();
  $('bankSearch').disabled = true;
  $('registryStatus').textContent = 'Подключение к справочнику ЦБ…';
  $('catalogInfo').textContent = 'Загружаем действующие банки и НКО…';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('./api/organizations', {cache:'no-store', headers:{Accept:'application/json'}, signal:controller.signal});
    if (!response.ok) throw Error('Registry unavailable');
    const payload = await response.json();
    const date = typeof payload.as_of === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(payload.as_of) ? Date.parse(payload.as_of) : NaN;
    const age = Date.now() - date;
    if (payload.source !== 'cbr.ru' || !Number.isFinite(date) || age < 0 || age >= MAX_AGE ||
        !Array.isArray(payload.organizations) || !payload.organizations.length ||
        !payload.organizations.every(x => organization(x) && typeof x.active === 'boolean')) throw Error('Unverified registry');
    const active = payload.organizations.filter(x => x.active);
    if (!active.length || new Set(payload.organizations.map(x => x.id)).size !== payload.organizations.length) throw Error('Invalid registry');
    catalog = active.sort((a,b) => a.name.localeCompare(b.name,'ru'));
    validUntil = date + MAX_AGE;
    expiryTimer = setTimeout(unavailable, validUntil - Date.now());
    $('bankSearch').disabled = false;
    $('registryStatus').textContent = 'Справочник ЦБ · ' + new Date(date).toLocaleString('ru-RU');
    $('catalogInfo').textContent = 'Действующих банков и НКО: ' + catalog.length + '. Данные на ' + new Date(date).toLocaleString('ru-RU') + '. Статус сохранённых организаций сверяйте с актуальным справочником.';
    renderCatalog();
  } catch { unavailable(); }
  finally { clearTimeout(timer); $('refreshRegistry').disabled = false; }
}
$('bankSearch').addEventListener('input', renderCatalog);
$('refreshRegistry').addEventListener('click', refreshRegistry);
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  const manage = button.dataset.view === 'manage';
  $('manageView').hidden = !manage; $('feedView').hidden = manage;
  document.querySelectorAll('[data-view]').forEach(x => x.setAttribute('aria-pressed', String(x === button)));
}));
renderWatchlist(); refreshRegistry();
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js', {updateViaCache:'none'}).catch(() => {}));
}
