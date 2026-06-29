import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';
import { chromium, firefox, webkit } from 'playwright';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { QwenAccount } from '../core/accounts.js';
import { config } from '../core/config.js';
import { getBaseAccountId } from '../core/account-lanes.js';
import { getStealthScript } from './stealth.js';
import { getFingerprintProfile, type FingerprintProfile } from './fingerprint.js';

export type BrowserType = 'chromium' | 'firefox' | 'webkit' | 'chrome' | 'edge';

interface BrowserEngineConfig {
  engine: typeof chromium | typeof firefox | typeof webkit;
  channel?: string;
}

export function resolveBrowserEngine(browserType: BrowserType): BrowserEngineConfig {
  switch (browserType) {
    case 'firefox': return { engine: firefox };
    case 'webkit': return { engine: webkit };
    case 'chrome': return { engine: chromium, channel: 'chrome' };
    case 'edge': return { engine: chromium, channel: 'msedge' };
    case 'chromium':
    default: return { engine: chromium };
  }
}

export interface AccountHeaderCache {
  currentHeaders: Record<string, string>;
  cachedQwenHeaders: { headers: Record<string, string>, chatSessionId: string, parentMessageId: string | null } | null;
  lastHeadersTime: number;
  refreshInProgress: boolean;
}

export const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36';
export const CHROME_CLIENT_HINTS = '"Chromium";v="137", "Google Chrome";v="137", "Not/A)Brand";v="99"';
export const BROWSER_VIEWPORT = { width: 1366, height: 768 };
export const BROWSER_LOCALE = 'pt-BR';
export const BROWSER_TIMEZONE = 'America/Sao_Paulo';

export function getBrowserIdentity(accountId?: string): { userAgent: string; secChUa: string; platform: string; profile?: FingerprintProfile } {
  const profile = accountId ? getFingerprintProfile(accountId) : undefined;
  return {
    userAgent: profile?.userAgent || CHROME_UA,
    secChUa: profile?.secChUa || CHROME_CLIENT_HINTS,
    platform: profile?.platform || 'Windows',
    profile,
  };
}

export function getClientHintsHeaders(accountId?: string): Record<string, string> {
  const identity = getBrowserIdentity(accountId);
  return {
    'sec-ch-ua': identity.secChUa,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': `"${identity.platform}"`,
  };
}

function getBrowserLaunchArgs(): string[] {
  return Array.from(new Set([
    ...config.browser.args,
    '--disable-blink-features=AutomationControlled',
    '--disable-features=IsolateOrigins,site-per-process',
    '--disable-infobars',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--enable-accelerated-2d-canvas',
  ]));
}

export function sharedContextOptions(accountId?: string): BrowserContextOptions {
  const identity = getBrowserIdentity(accountId);

  if (accountId && identity.profile) {
    const profile = identity.profile;
    return {
      userAgent: identity.userAgent,
      locale: BROWSER_LOCALE,
      timezoneId: BROWSER_TIMEZONE,
      viewport: profile.viewport,
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      colorScheme: 'light',
      ignoreHTTPSErrors: true,
      extraHTTPHeaders: {
        ...config.browser.headers,
        ...getClientHintsHeaders(accountId),
      },
    };
  }
  return {
    userAgent: identity.userAgent,
    locale: BROWSER_LOCALE,
    timezoneId: BROWSER_TIMEZONE,
    viewport: BROWSER_VIEWPORT,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    colorScheme: 'light',
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      ...config.browser.headers,
      ...getClientHintsHeaders(accountId),
    },
  };
}

export const HEADERS_TTL = config.headers.ttlMs;
export const COOKIE_CACHE_TTL = 5 * 60 * 1000;
export const REFRESH_THRESHOLD = 0.7;
export const GUEST_HEADERS_TTL = 30 * 60 * 1000;

export const PROFILES_DIR = path.resolve(config.browser.userDataDir);

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const accountContexts = new Map<string, BrowserContext>();
export const accountPages = new Map<string, Page>();
export const accountHeaderCaches = new Map<string, AccountHeaderCache>();
export const cachedUserAgents = new Map<string, string>();
export const cookieCaches = new Map<string, { cookie: string, timestamp: number }>();
export const detectedEmailsByAccount = new Map<string, string>();

let browser: Browser | null = null;
let context: BrowserContext | null = null;
export let activePage: Page | null = null;
let guestContext: BrowserContext | null = null;
let guestPage: Page | null = null;
let guestHeadersCache: { headers: Record<string, string>, timestamp: number } | null = null;

export function getBrowser(): Browser | null { return browser; }
export function setBrowser(b: Browser | null) { browser = b; }
export function getContext(): BrowserContext | null { return context; }
export function setContext(c: BrowserContext | null) { context = c; }
export function getActivePage(): Page | null { return activePage; }
export function setActivePage(p: Page | null) { activePage = p; }
export function getGuestContext(): BrowserContext | null { return guestContext; }
export function setGuestContext(c: BrowserContext | null) { guestContext = c; }
export function getGuestPage(): Page | null { return guestPage; }
export function setGuestPage(p: Page | null) { guestPage = p; }
export function getGuestHeadersCache(): { headers: Record<string, string>, timestamp: number } | null { return guestHeadersCache; }
export function setGuestHeadersCache(c: { headers: Record<string, string>, timestamp: number } | null) { guestHeadersCache = c; }

export function getAccountHeaderCache(accountId: string): AccountHeaderCache {
  let cache = accountHeaderCaches.get(accountId);
  if (!cache) {
    cache = {
      currentHeaders: {},
      cachedQwenHeaders: null,
      lastHeadersTime: 0,
      refreshInProgress: false,
    };
    accountHeaderCaches.set(accountId, cache);
  }
  return cache;
}

export function storageStatePath(accountId: string): string {
  return path.join(PROFILES_DIR, `${accountId}_state.json`);
}

export function loadStorageState(accountId: string): string | undefined {
  const p = storageStatePath(accountId);
  if (!fs.existsSync(p)) return undefined;

  try {
    const raw = fs.readFileSync(p, 'utf8');
    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object') {
      console.warn(`[Playwright] Invalid storageState structure for ${accountId}, discarding.`);
      fs.rmSync(p, { force: true });
      return undefined;
    }
    if (!Array.isArray(state.cookies)) {
      console.warn(`[Playwright] StorageState for ${accountId} missing cookies array, discarding.`);
      fs.rmSync(p, { force: true });
      return undefined;
    }
    if (!Array.isArray(state.origins)) {
      state.origins = [];
    }

    const now = Date.now();
    const validCookies = state.cookies.filter((c: any) => {
      if (!c || !c.name || !c.value) return false;
      if (c.expires && c.expires > 0 && c.expires * 1000 < now) return false;
      return true;
    });

    if (validCookies.length === 0) {
      console.warn(`[Playwright] StorageState for ${accountId} has no valid cookies, discarding.`);
      fs.rmSync(p, { force: true });
      return undefined;
    }

    if (validCookies.length !== state.cookies.length) {
      console.log(`[Playwright] Pruned ${state.cookies.length - validCookies.length} expired cookies for ${accountId}.`);
      state.cookies = validCookies;
      fs.writeFileSync(p, JSON.stringify(state, null, 2));
    }

    return p;
  } catch (err: any) {
    console.warn(`[Playwright] Failed to read storageState for ${accountId}: ${err.message}. Discarding.`);
    try { fs.rmSync(p, { force: true }); } catch { /* ignore */ }
    return undefined;
  }
}

export async function saveStorageState(ctx: BrowserContext, accountId: string): Promise<void> {
  try {
    if (!fs.existsSync(PROFILES_DIR)) fs.mkdirSync(PROFILES_DIR, { recursive: true });
    await ctx.storageState({ path: storageStatePath(accountId) });
  } catch (err: any) {
    console.warn(`[Playwright] Failed to save storageState for ${accountId}: ${err.message}`);
  }
}

export async function clearPageRuntimeState(page: Page | null): Promise<void> {
  if (!page || page.isClosed()) return;

  try {
    await page.context().clearCookies();
  } catch (err: any) {
    console.warn(`[Playwright] Failed to clear cookies during profile reset: ${err.message}`);
  }

  try {
    await page.context().clearPermissions();
  } catch (err: any) {
    console.warn(`[Playwright] Failed to clear permissions during profile reset: ${err.message}`);
  }

  try {
    await page.evaluate(() => {
      try { window.localStorage.clear(); } catch { /* ignore */ }
      try { window.sessionStorage.clear(); } catch { /* ignore */ }
    });
  } catch (err: any) {
    console.warn(`[Playwright] Failed to clear page storage during profile reset: ${err.message}`);
  }
}

export async function getOrLaunchBrowser(browserType: BrowserType = 'chromium'): Promise<Browser> {
  if (browser?.isConnected()) return browser;
  const { engine, channel } = resolveBrowserEngine(browserType);
  console.log(`[Playwright] Launching shared ${browserType} browser...`);

  const launchArgs = getBrowserLaunchArgs();

  browser = await engine.launch({
    headless: config.browser.headless,
    channel,
    ignoreDefaultArgs: ['--enable-automation', '--enable-blink-features'],
    args: launchArgs,
  });
  browser.on('disconnected', () => { browser = null; });
  return browser;
}

export class Mutex {
  private queue: (() => void)[] = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true;
      return () => this.release();
    }
    return new Promise<() => void>(resolve => {
      this.queue.push(() => {
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
    }
  }
}

const uiMutexes = new Map<string, Mutex>();
export function getUiMutex(accountId: string): Mutex {
  let m = uiMutexes.get(accountId);
  if (!m) {
    m = new Mutex();
    uiMutexes.set(accountId, m);
  }
  return m;
}

export async function hasValidAuthCookie(page: Page | null): Promise<boolean> {
  if (!page) return false;
  try {
    const cookies = await page.context().cookies();
    return cookies.some(c => c.name.toLowerCase().includes('token') || c.name.toLowerCase().includes('session'));
  } catch {
    return false;
  }
}

async function checkValidSession(): Promise<boolean> {
  if (!activePage) return false;
  try {
    const hasAuth = await hasValidAuthCookie(activePage);
    if (!hasAuth) return false;
    await activePage.goto('https://chat.qwen.ai/', { waitUntil: 'domcontentloaded', timeout: config.timeouts.navigation });
    await sleep(1500);
    const hasWelcomeModal = await activePage.locator('button:has-text("Fazer login"), button:has-text("Log in"), button:has-text("Iniciar sesión"), button:has-text("Sign in")').first().isVisible().catch(() => false);
    const isLogged = !activePage.url().includes('auth') && !activePage.url().includes('login') && !hasWelcomeModal;
    return isLogged;
  } catch {
    return false;
  }
}

async function loginToQwenWithContext(acctContext: BrowserContext, acctPage: Page, email: string, password: string): Promise<boolean> {
  await acctPage.goto('https://chat.qwen.ai/auth', { waitUntil: 'domcontentloaded' });

  const hashedPassword = crypto.createHash('sha256').update(password).digest('hex');

  const result = await acctPage.evaluate(async ({ email, password }) => {
    try {
      const response = await fetch("https://chat.qwen.ai/api/v2/auths/signin", {
        method: "POST",
        headers: {
          "accept": "application/json, text/plain, */*",
          "content-type": "application/json",
          "source": "web",
          "timezone": new Date().toString().split(' (')[0],
          "x-request-id": crypto.randomUUID()
        },
        body: JSON.stringify({ email, password, login_type: "email" })
      });
      const data = await response.json();
      return { ok: response.ok, data };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }, { email, password: hashedPassword });

  if (result.ok) {
    await acctPage.goto('https://chat.qwen.ai/', { waitUntil: 'domcontentloaded' });
    const isLogged = !(acctPage.url().includes('auth') || acctPage.url().includes('login'));
    if (isLogged) {
      console.log(`[Playwright] Inicio de sesión confirmado para ${email}.`);
      return true;
    }
  }

  console.error(`[Playwright] Inicio de sesión falló para ${email}:`, result.data || result.error);
  return false;
}

export async function loginToQwen(email: string, password: string): Promise<boolean> {
  if (!activePage) throw new Error('Playwright no inicializado');
  console.log(`[Playwright] Intentando inicio de sesión por API para ${email}...`);
  return loginToQwenWithContext(activePage.context(), activePage, email, password);
}

export async function loginToQwenUIWithPage(page: Page, email: string, password: string): Promise<boolean> {
  console.log(`[Playwright] Intentando inicio de sesión por interfaz de usuario para ${email}...`);
  await page.goto('https://chat.qwen.ai/auth', { waitUntil: 'domcontentloaded' });
  await sleep(2000);

  const url = page.url();
  if (!url.includes('/auth') && !url.includes('/login')) {
    console.log(`[Playwright] Ya ha iniciado sesión para ${email}`);
    return true;
  }

  try {
    const inputSelector = 'input[type="email"], input[placeholder*="Email"], input[name="email"]';
    await page.waitForSelector(inputSelector, { timeout: config.timeouts.page });
    console.log(`[Playwright] Interfaz: Escribiendo correo electrónico para ${email}...`);
    await page.fill(inputSelector, email);
    await page.keyboard.press('Enter');
    await sleep(1500);

    const passwordSelector = 'input[type="password"], input[name="password"]';
    await page.waitForSelector(passwordSelector, { timeout: config.timeouts.page });
    console.log(`[Playwright] Interfaz: Escribiendo contraseña para ${email}...`);
    await page.fill(passwordSelector, password);
    await page.keyboard.press('Enter');

    await sleep(3000);

    const currentUrl = page.url();
    const isLogged = !currentUrl.includes('auth') && !currentUrl.includes('login');
    if (isLogged) {
      console.log(`[Playwright] Inicio de sesión por interfaz exitoso para ${email}`);
      return true;
    }
  } catch (err: any) {
    console.error(`[Playwright] Error en inicio de sesión por interfaz para ${email}:`, err.message);
  }

  console.log(`[Playwright] Inicio de sesión por interfaz falló para ${email}`);
  return false;
}

async function loginToQwenUI(email: string, password: string): Promise<boolean> {
  if (!activePage) throw new Error('Playwright no inicializado');
  return loginToQwenUIWithPage(activePage, email, password);
}

async function attemptAutoLogin(): Promise<void> {
  const email = process.env.QWEN_EMAIL;
  const password = process.env.QWEN_PASSWORD;
  if (!email || !password) return;
  console.log('[Playwright] Intentando inicio de sesión automático con credenciales de .env...');
  try {
    const success = await loginToQwen(email, password);
    if (success) {
      console.log('[Playwright] Inicio de sesión automático exitoso.');
      return;
    }
    console.warn('[Playwright] Inicio de sesión por API falló, intentando por interfaz de usuario como alternativa...');
    const uiSuccess = await loginToQwenUI(email, password);
    if (uiSuccess) {
      console.log('[Playwright] Inicio de sesión por interfaz exitoso.');
    } else {
      console.warn('[Playwright] Ambos métodos de inicio de sesión fallaron. Se requiere inicio de sesión manual.');
    }
  } catch (err: any) {
    console.error('[Playwright] Error en inicio de sesión automático:', err.message);
  }
}

export async function resetBrowserProfile(cacheKey: string, accountId?: string): Promise<void> {
  const profileId = accountId === 'guest' ? '_guest' : (accountId || '_default');
  const profilePath = path.join(PROFILES_DIR, profileId);

  try {
    if (accountId === 'guest') {
      await clearPageRuntimeState(guestPage);
      if (guestContext) {
        await guestContext.close();
        guestContext = null;
      }
      guestPage = null;
    } else if (accountId) {
      const acctPage = accountPages.get(accountId) ?? null;
      await clearPageRuntimeState(acctPage);
      const acctContext = accountContexts.get(accountId);
      if (acctContext) {
        await acctContext.close();
        accountContexts.delete(accountId);
      }
      accountPages.delete(accountId);
    } else {
      await clearPageRuntimeState(activePage);
      if (context) {
        await context.close();
        context = null;
      }
      activePage = null;
    }

    if (browser?.isConnected()) {
      await browser.close();
      browser = null;
    }

    accountHeaderCaches.delete(cacheKey);
    cookieCaches.delete(cacheKey);
    cachedUserAgents.delete(cacheKey);
    accountContexts.clear();
    accountPages.clear();
    context = null;
    activePage = null;
    guestContext = null;
    guestPage = null;
    guestHeadersCache = null;
    fs.rmSync(profilePath, { recursive: true, force: true });
    fs.rmSync(storageStatePath(profileId), { force: true });

    console.warn(`[Playwright] Cleared browser profile for ${cacheKey}: ${profilePath}`);
  } catch (err: any) {
    console.warn(`[Playwright] Failed to clear browser profile for ${cacheKey}: ${err.message}`);
  }
}

export async function initPlaywright(_headless = true, browserType: BrowserType = 'chromium') {
  if (process.env.TEST_MOCK_PLAYWRIGHT) return;
  if (context) {
    return;
  }

  const sharedBrowser = await getOrLaunchBrowser(browserType);
  console.log(`[Playwright] Creando contexto predeterminado en el navegador compartido...`);

  const storageState = loadStorageState('_default');
  const defaultProfile = getFingerprintProfile('_default');
  context = await sharedBrowser.newContext({
    ...sharedContextOptions('_default'),
    ...(storageState ? { storageState } : {}),
  });

  await context.addInitScript(getStealthScript(defaultProfile));

  activePage = await context.newPage();

  const hasCredentials = !!(process.env.QWEN_EMAIL && process.env.QWEN_PASSWORD);
  const hasValidSession = await checkValidSession();

  if (!hasValidSession && !hasCredentials) {
    console.warn('[Playwright] Sin sesión válida Y sin credenciales en .env. Se requerirá inicio de sesión manual.');
  }

  if (!hasValidSession) {
    await attemptAutoLogin();
  }

  if (await hasValidAuthCookie(activePage)) {
    await saveStorageState(context, '_default');
  }
}

export async function closePlaywright() {
  if (process.env.TEST_MOCK_PLAYWRIGHT) return;
  for (const cache of accountHeaderCaches.values()) {
    cache.refreshInProgress = false;
  }
  if (context) {
    if (await hasValidAuthCookie(activePage)) {
      await saveStorageState(context, '_default');
    }
    await context.close();
    context = null;
    activePage = null;
  }
  if (guestContext) {
    if (await hasValidAuthCookie(guestPage)) {
      await saveStorageState(guestContext, '_guest');
    }
    await guestContext.close();
    guestContext = null;
    guestPage = null;
  }
  for (const acctId of accountContexts.keys()) {
    await closePlaywrightForAccount(acctId);
  }
  if (browser?.isConnected()) {
    await browser.close().catch(() => {});
    browser = null;
  }
}

export async function initPlaywrightForAccount(account: QwenAccount, _headless = true, browserType: BrowserType = 'chromium') {
  const sharedBrowser = await getOrLaunchBrowser(browserType);
  const baseAccountId = getBaseAccountId(account.id);

  console.log(`[Playwright] Creando contexto para la cuenta ${account.email} en el navegador compartido...`);

  const storageState = loadStorageState(baseAccountId);
  const acctProfile = getFingerprintProfile(account.id);
  const acctContext = await sharedBrowser.newContext({
    ...sharedContextOptions(account.id),
    ...(storageState ? { storageState } : {}),
  });

  await acctContext.addInitScript(getStealthScript(acctProfile));

  const acctPage = await acctContext.newPage();
  accountContexts.set(account.id, acctContext);
  accountPages.set(account.id, acctPage);

  let hasAuth = await hasValidAuthCookie(acctPage);

  if (hasAuth) {
    try {
      console.log(`[Playwright] Cookies found for ${account.email}, verifying validity...`);
      await acctPage.goto('https://chat.qwen.ai/c/new-chat', { waitUntil: 'domcontentloaded', timeout: config.timeouts.navigation });
      await sleep(1500);

      const url = acctPage.url();
      const hasWelcomeModal = await acctPage.locator('button:has-text("Fazer login"), button:has-text("Log in"), button:has-text("Iniciar sesión"), button:has-text("Sign in")').first().isVisible().catch(() => false);

      if (url.includes('auth') || url.includes('login') || hasWelcomeModal) {
        console.log(`[Playwright] Session expired or welcome modal visible for ${account.email}. Invalidating session.`);
        hasAuth = false;
      }
    } catch (err: any) {
      console.warn(`[Playwright] Failed to verify initial cookies for ${account.email}: ${err.message}`);
      hasAuth = false;
    }
  }

  if (!hasAuth) {
    let password = account.password;
    if (!password || password === '***') {
      if (process.env.QWEN_EMAIL && account.email.toLowerCase() === process.env.QWEN_EMAIL.toLowerCase()) {
        password = process.env.QWEN_PASSWORD || '';
      }
    }

    if (!password) {
      throw new Error(`Session expired or cookies missing for account ${account.email}, and no password is configured for auto-login. Please run 'npm run login' and authenticate manually.`);
    }

    console.log(`[Playwright] Attempting API login for ${account.email}...`);
    let success = await loginToQwenWithContext(acctContext, acctPage, account.email, password);
    if (!success) {
      console.log(`[Playwright] API login failed for ${account.email}. Trying UI login fallback...`);
      success = await loginToQwenUIWithPage(acctPage, account.email, password);
    }
    
    if (success) {
      try {
        await acctPage.goto('https://chat.qwen.ai/c/new-chat', { waitUntil: 'domcontentloaded', timeout: config.timeouts.navigation });
      } catch (err: any) {
        console.warn(`[Playwright] Navigation failed after login for ${account.email}: ${err.message}`);
      }
    }
  }

  try {
    await sleep(2500); // Dar más tiempo para que cargue la SPA y muestre el modal de bienvenida si la sesión es inválida
    const url = acctPage.url();
    const hasWelcomeModal = await acctPage.locator('button:has-text("Fazer login"), button:has-text("Log in"), button:has-text("Iniciar sesión"), button:has-text("Sign in")').first().isVisible().catch(() => false);

    if (url.includes('auth') || url.includes('login') || hasWelcomeModal || url === 'about:blank') {
      let password = account.password;
      if (!password || password === '***') {
        if (process.env.QWEN_EMAIL && account.email.toLowerCase() === process.env.QWEN_EMAIL.toLowerCase()) {
          password = process.env.QWEN_PASSWORD || '';
        }
      }
      if (password) {
        console.log(`[Playwright] Session still invalid for ${account.email}, forcing re-login...`);
        let success = await loginToQwenWithContext(acctContext, acctPage, account.email, password);
        if (!success) {
          success = await loginToQwenUIWithPage(acctPage, account.email, password);
        }
        await acctPage.goto('https://chat.qwen.ai/c/new-chat', { waitUntil: 'domcontentloaded', timeout: config.timeouts.navigation });
      } else {
        throw new Error(`Session expired or welcome modal visible for ${account.email}, and no password is configured for auto-recovery. Please run 'npm run login' and authenticate manually.`);
      }
    } else {
      console.log(`[Playwright] Session validated for ${account.email}.`);
    }
  } catch (err: any) {
    console.error(`[Playwright] Failed to validate session for ${account.email}: ${err.message}`);
    throw err; // Propagar el error para evitar dar la sesión por válida
  }

  if (await hasValidAuthCookie(acctPage)) {
    await saveStorageState(acctContext, baseAccountId);
  }
}

export async function launchManualLoginAccount(accountId: string, browserType: BrowserType = 'chromium'): Promise<{ context: BrowserContext, page: Page }> {
  const { engine, channel } = resolveBrowserEngine(browserType);

  const manualBrowser = await engine.launch({
    headless: false,
    channel,
    ignoreDefaultArgs: ['--enable-automation'],
    args: getBrowserLaunchArgs(),
  });

  const storageState = loadStorageState(accountId);
  const manualProfile = getFingerprintProfile(accountId);
  const acctContext = await manualBrowser.newContext({
    ...sharedContextOptions(accountId),
    ...(storageState ? { storageState } : {}),
  });

  await acctContext.addInitScript(getStealthScript(manualProfile));

  detectedEmailsByAccount.set(accountId, '');

  const acctPage = await acctContext.newPage();

  // Interceptar pasivamente las respuestas del API de Qwen para capturar el email
  acctPage.on('response', async (response) => {
    try {
      const url = response.url();
      if (url.includes('/api/') && response.status() === 200) {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json')) {
          const text = await response.text();
          const json = JSON.parse(text);
          const email = json?.data?.email || json?.email;
          if (email && typeof email === 'string' && email.includes('@')) {
            console.log(`[Playwright] Email real detectado pasivamente en respuesta de red: ${email}`);
            detectedEmailsByAccount.set(accountId, email);
          }
        }
      }
    } catch {
      // Ignorar errores al acceder al cuerpo
    }
  });

  await acctPage.goto('https://chat.qwen.ai/auth', { waitUntil: 'domcontentloaded' });

  return { context: acctContext, page: acctPage };
}

export async function extractAccountInfoFromContext(page: Page, accountId?: string): Promise<{ email: string | null, hasSession: boolean }> {
  const cookies = await page.context().cookies();
  const hasSession = cookies.some(c => c.name.toLowerCase().includes('token') || c.name.toLowerCase().includes('session'));

  let email: string | null = null;
  if (hasSession) {
    if (accountId) {
      email = detectedEmailsByAccount.get(accountId) || null;
    }
    if (!email) {
      try {
        email = await page.evaluate(() => {
          const el = document.querySelector('[data-testid="user-email"], .user-email, [class*="email"]');
          return el?.textContent?.trim() || null;
        });
        if (email && accountId) {
          detectedEmailsByAccount.set(accountId, email);
        }
      } catch { /* ignore */ }
    }
  }

  return { email, hasSession };
}

export async function closePlaywrightForAccount(accountId: string) {
  const acctContext = accountContexts.get(accountId);
  const acctPage = accountPages.get(accountId);
  if (acctContext) {
    try {
      if (await hasValidAuthCookie(acctPage || null)) {
        await saveStorageState(acctContext, accountId);
      }
    } catch { /* ignore */ }
    try {
      await acctContext.close();
    } catch { /* ignore */ }
    accountContexts.delete(accountId);
    accountPages.delete(accountId);
    detectedEmailsByAccount.delete(accountId);
  }
}

export function getPageForAccount(accountId?: string): Page | null {
  if (accountId === 'guest') return guestPage;
  if (accountId) return accountPages.get(accountId) || null;
  return activePage;
}
