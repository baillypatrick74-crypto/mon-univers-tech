const cookieName = '__Host-mut-owner';

export function createSupabase(env) {
  const project = URL.parse(env.SUPABASE_URL ?? '');
  const owner = env.SUPABASE_OWNER_ID?.toLowerCase();
  const publishable = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  const configured = Boolean(project?.protocol === 'https:'
    && /^[a-z0-9]+\.supabase\.co$/.test(project.hostname) && !project.port
    && project.pathname === '/' && !project.username && !project.password && !project.search && !project.hash
    && /^sb_publishable_[\w-]+$/.test(publishable ?? '') && /^sb_secret_[\w-]+$/.test(secret ?? '')
    && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(owner ?? ''));
  const tokenPattern = /^[\w-]+\.[\w-]+\.[\w-]+$/;

  function request(path, options) {
    return fetch(new URL(path, project), { ...options, redirect: 'error', signal: AbortSignal.timeout(4000) });
  }

  async function login(email, password) {
    const response = await request('/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: publishable, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (response.status === 400 || response.status === 401) return null;
    if (!response.ok) throw Error('Authentification indisponible');
    const session = await response.json();
    if (session.user?.id !== owner || !session.user.email_confirmed_at
        || !Number.isSafeInteger(session.expires_in) || session.expires_in < 1
        || typeof session.access_token !== 'string' || session.access_token.length > 3500
        || !tokenPattern.test(session.access_token) || !recent(session.access_token)) return null;
    return cookie(session.access_token, Math.min(session.expires_in, 600));
  }

  function recent(token) {
    try {
      const { iat, exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      const now = Math.floor(Date.now() / 1000);
      return Number.isSafeInteger(iat) && Number.isSafeInteger(exp) && iat <= now + 5
        && now < exp && now - iat < 600;
    } catch { return false; }
  }

  async function authenticated(header) {
    const token = (header ?? '').split(';').map(value => value.trim())
      .find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!token || token.length > 3500 || !tokenPattern.test(token) || !recent(token)) return false;
    const response = await request('/auth/v1/user', {
      headers: { apikey: publishable, Authorization: `Bearer ${token}` },
    });
    if ([401, 403].includes(response.status)) return false;
    if (!response.ok) throw Error('Authentification indisponible');
    const user = await response.json();
    return user.id === owner && Boolean(user.email_confirmed_at);
  }

  async function reserve() {
    const response = await request('/rest/v1/rpc/mut_reserve_assistant_call', {
      method: 'POST',
      headers: { apikey: secret, 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (!response.ok) throw Error('Quota indisponible');
    const result = await response.json();
    if (result?.allowed === true) return { status: 200 };
    if (result?.allowed !== false) throw Error('Réponse de quota invalide');
    const seconds = result.retry_after;
    return { status: 429, retryAfter: Number.isInteger(seconds) && seconds > 0 && seconds <= 60 ? seconds : undefined };
  }

  async function checkQuota() {
    const response = await request('/rest/v1/rpc/mut_check_assistant_quota', {
      method: 'POST',
      headers: { apikey: secret, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return response.ok && await response.json() === true;
  }

  return { configured, login, authenticated, reserve, checkQuota };
}

function cookie(token, age) {
  return `${cookieName}=${token}; Max-Age=${age}; Path=/; Secure; HttpOnly; SameSite=Strict`;
}

export const clearOwnerCookie = () => cookie('', 0);
