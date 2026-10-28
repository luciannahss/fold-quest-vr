// Tiny i18n: dictionaries live in src/lang/{en,es,pt}.js (English is the fallback).
// t('key', { n: 3 }) fills {n}; a dictionary value may also be a function (params) => string, or an array.
import en from './lang/en.js';
import es from './lang/es.js';
import pt from './lang/pt.js';

export const LANGS = [
  { code: 'en', name: 'English', html: 'en' },
  { code: 'es', name: 'Español', html: 'es' },
  { code: 'pt', name: 'Português', html: 'pt-BR' },
];
const DICT = { en, es, pt };

const pick = (s) => { const c = String(s || '').toLowerCase().slice(0, 2); return DICT[c] ? c : null; };
function initial() {
  const q = pick(new URLSearchParams(location.search).get('lang'));
  if (q) return q;
  try { const s = pick(localStorage.getItem('lang')); if (s) return s; } catch { /* ignore */ }
  for (const l of navigator.languages || [navigator.language]) { const c = pick(l); if (c) return c; }
  return 'en';
}

let lang = initial();
const listeners = [];

export const getLang = () => lang;
export function onLangChange(fn) { listeners.push(fn); }
export function setLang(code) {
  if (!DICT[code] || code === lang) return;
  lang = code;
  try { localStorage.setItem('lang', code); } catch { /* ignore */ }
  applyDom();
  listeners.forEach((fn) => fn(code));
}

export function t(key, params = {}) {
  let v = DICT[lang][key];
  if (v === undefined) v = en[key];
  if (v === undefined) return key;
  if (typeof v === 'function') return v(params);
  if (typeof v !== 'string') return v;
  return v.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? params[k] : `{${k}}`));
}

/** translate the static HTML: data-i18n (text), data-i18n-html (markup), data-i18n-title (title attribute) */
export function applyDom() {
  document.documentElement.lang = LANGS.find((l) => l.code === lang).html;
  document.title = t('app.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('html.desc'));
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-html]')) el.innerHTML = t(el.dataset.i18nHtml);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const b of document.querySelectorAll('[data-lang]')) b.classList.toggle('on', b.dataset.lang === lang);
}
