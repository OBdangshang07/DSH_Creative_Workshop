import { api, safeReturnTo } from '/js/account-api.js';

const form = document.getElementById('authForm');
const submit = document.getElementById('submitButton');
const message = document.getElementById('formMessage');
const password = document.getElementById('password');
const returnTo = safeReturnTo(new URLSearchParams(location.search).get('returnTo'));
let mode = new URLSearchParams(location.search).get('mode') === 'register' ? 'register' : 'login';

const fields = name => document.getElementById(name);
const setError = (name, text = '') => {
  fields(`${name}Error`).textContent = text;
  fields(name).setAttribute('aria-invalid', text ? 'true' : 'false');
};

function setMode(nextMode) {
  mode = nextMode;
  document.querySelector('.register-fields').hidden = mode !== 'register';
  document.querySelector('.login-fields').hidden = mode === 'register';
  document.querySelectorAll('[data-mode]').forEach(tab => tab.setAttribute('aria-selected', String(tab.dataset.mode === mode)));
  submit.querySelector('span').textContent = mode === 'register' ? '创建账号' : '登录';
  password.autocomplete = mode === 'register' ? 'new-password' : 'current-password';
  document.getElementById('passwordStrength').hidden = mode !== 'register';
  message.textContent = '';
  ['username', 'email', 'identity', 'password'].forEach(name => setError(name));
}

function validate() {
  let valid = true;
  const passwordValue = password.value;
  if (mode === 'register') {
    const username = fields('username').value.trim();
    const email = fields('email').value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,31}$/.test(username)) { setError('username', '请输入 3–32 位有效用户名'); valid = false; } else setError('username');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('email', '请输入有效邮箱地址'); valid = false; } else setError('email');
  } else {
    if (!fields('identity').value.trim()) { setError('identity', '请输入用户名或邮箱'); valid = false; } else setError('identity');
  }
  if (!passwordValue) { setError('password', '请输入密码'); valid = false; }
  else if (mode === 'register' && (passwordValue.length < 10 || !/[A-Za-z]/.test(passwordValue) || !/\d/.test(passwordValue))) { setError('password', '密码至少 10 位，并同时包含字母和数字'); valid = false; }
  else setError('password');
  return valid;
}

function updateStrength() {
  const value = password.value;
  let level = 0;
  if (value.length >= 10) level += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) level += 1;
  if (/\d/.test(value)) level += 1;
  if (/[^A-Za-z0-9]/.test(value) && value.length >= 14) level += 1;
  const strength = document.getElementById('passwordStrength');
  strength.dataset.level = String(level);
  strength.querySelector('em').textContent = ['', '基础强度', '中等强度', '较强', '高强度'][level] || '至少 10 位，包含字母和数字';
}

document.querySelectorAll('[data-mode]').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));
document.getElementById('passwordToggle').addEventListener('click', event => {
  const reveal = password.type === 'password';
  password.type = reveal ? 'text' : 'password';
  event.currentTarget.textContent = reveal ? '隐藏' : '显示';
  event.currentTarget.setAttribute('aria-label', reveal ? '隐藏密码' : '显示密码');
});
password.addEventListener('input', updateStrength);

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!validate()) return;
  submit.disabled = true;
  submit.classList.add('loading');
  message.className = 'form-message';
  message.textContent = mode === 'register' ? '正在创建账号…' : '正在验证账号…';
  const payload = mode === 'register'
    ? { username: fields('username').value.trim(), email: fields('email').value.trim(), password: password.value }
    : { identity: fields('identity').value.trim(), password: password.value };
  try {
    const result = await api(mode === 'register' ? '/auth/register' : '/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    message.classList.add('success');
    message.textContent = `欢迎，${result.user.username}。正在返回…`;
    location.replace(result.user.role === 'admin' && returnTo === '/' ? '/admin/' : returnTo);
  } catch (error) {
    message.textContent = error.code === 'AUTH_RATE_LIMITED' ? `${error.message}。请不要连续重复提交。` : error.message;
    submit.disabled = false;
    submit.classList.remove('loading');
  }
});

setMode(mode);
updateStrength();
api('/auth/me').then(result => {
  if (result.authenticated) location.replace(result.user.role === 'admin' && returnTo === '/' ? '/admin/' : returnTo);
}).catch(() => { message.textContent = '服务暂时不可用，请稍后重试'; });
fetch('/api/health').then(response => response.ok ? response.json() : null).then(health => {
  document.getElementById('appVersion').textContent = health?.version ? `v${health.version}` : '版本未知';
}).catch(() => { document.getElementById('appVersion').textContent = '版本未知'; });
