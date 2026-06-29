import { Hono } from 'hono'
import { listAccounts, addAccount, removeAccount, reorderAccounts, getAccountCredentials } from '../core/accounts.js'
import { launchManualLoginAccount, extractAccountInfoFromContext, initPlaywrightForAccount, closePlaywrightForAccount, saveStorageState, detectedEmailsByAccount } from '../services/playwright.js'
import { logBuffer } from '../core/logger.js'
import { config } from '../core/config.js'
import { metrics } from '../core/metrics.js'
import { cache } from '../cache/memory-cache.js'
import crypto from 'crypto'
import path from 'path'
import type { BrowserType } from '../services/playwright.js'
import { getBaseAccountId } from '../core/account-lanes.js'

const app = new Hono()

interface ManualLoginState {
  accountId: string;
  email: string | null;
  status: 'idle' | 'waiting' | 'success' | 'failed';
  error?: string;
}

let currentManualLogin: ManualLoginState | null = null;
let manualLoginBrowserContext: any = null;

// Endpoint de visión general (Overview)
app.get('/overview', async (c) => {
  const accounts = listAccounts()

  // Configuraciones públicas para el dashboard
  const publicSettings = {
    version: 2,
    port: config.server.port,
    apiEnabled: true,
    apiKeyRequired: !!(process.env.API_KEY || config.apiKey),
    globalThinking: {
      enabled: false,
      budgetTokens: 0,
      effort: 'none'
    },
    accountThinking: {},
    apiKeys: []
  }

  return c.json({
    runtime: 'node',
    port: config.server.port,
    activeAccountId: accounts[0]?.id || null,
    accountCount: accounts.length,
    settings: publicSettings,
    recentQuotaUpdate: null,
    accountCreator: null,
    accountRepair: null
  })
})

// Configuración del servidor (Settings)
app.get('/settings', (c) => {
  return c.json({
    version: 2,
    port: config.server.port,
    apiEnabled: true,
    apiKeyRequired: !!(process.env.API_KEY || config.apiKey),
    globalThinking: {
      enabled: false,
      budgetTokens: 0,
      effort: 'none'
    },
    accountThinking: {},
    apiKeys: []
  })
})

app.patch('/settings', async (c) => {
  const body = await c.req.json()
  // En qwenproxy las configs son principalmente basadas en .env.
  return c.json({ ok: true, message: 'Configuraciones recibidas. Reinicie el servidor para aplicar cambios estructurales.' })
})

// Listado de cuentas mapeado al formato esperado por el frontend
app.get('/accounts', (c) => {
  const accounts = listAccounts()
  const formatted = accounts.map((acc, index) => {
    const isCooldown = acc.cooldown_until ? acc.cooldown_until > Date.now() : false;
    const tokensUsedMax = acc.used_tokens_max || 0;
    const tokensUsedPlus = acc.used_tokens_plus || 0;

    const balances = [
      {
        id: 'qwen3.7-max',
        model: 'qwen3.7-max',
        total: 10000000,
        used: tokensUsedMax,
        remaining: Math.max(0, 10000000 - tokensUsedMax),
        available: isCooldown ? 0 : 1,
        usagePercent: Math.min(100, Math.round((tokensUsedMax / 10000000) * 100)),
        periodEnd: null
      },
      {
        id: 'qwen3.7-plus',
        model: 'qwen3.7-plus',
        total: 10000000,
        used: tokensUsedPlus,
        remaining: Math.max(0, 10000000 - tokensUsedPlus),
        available: isCooldown ? 0 : 1,
        usagePercent: Math.min(100, Math.round((tokensUsedPlus / 10000000) * 100)),
        periodEnd: null
      }
    ];

    return {
      id: acc.id,
      label: `Cuenta ${index + 1}`,
      active: index === 0,
      queuePosition: acc.queue_position || (index + 1),
      registrationOrder: index + 1,
      user: {
        id: acc.id,
        email: acc.email,
        name: acc.email.split('@')[0],
      },
      quota: {
        generatedAt: new Date().toISOString(),
        balances
      },
      quotaError: isCooldown ? { message: acc.cooldown_reason || 'Cuenta en cooldown por captcha', type: 'cooldown' } : null,
      quotaSkipped: false,
      quotaLoading: false,
      hasZcodeJwtToken: true,
      hasZaiAccessToken: false,
      tokenExpiresAt: null,
      tokenExpired: false
    }
  })

  return c.json({
    object: 'list',
    activeAccountId: accounts[0]?.id || null,
    data: formatted
  })
})

// Detalles de una cuenta específica
app.get('/accounts/:id', (c) => {
  const id = c.req.param('id')
  const baseId = getBaseAccountId(id)
  const credentials = getAccountCredentials(baseId)
  if (!credentials) {
    return c.json({ error: 'Cuenta no encontrada' }, 404)
  }
  const isCooldown = credentials.cooldown_until ? credentials.cooldown_until > Date.now() : false
  const tokensUsedMax = credentials.used_tokens_max || 0
  const tokensUsedPlus = credentials.used_tokens_plus || 0

  const balances = [
    {
      id: 'qwen3.7-max',
      model: 'qwen3.7-max',
      total: 10000000,
      used: tokensUsedMax,
      remaining: Math.max(0, 10000000 - tokensUsedMax),
      available: isCooldown ? 0 : 1,
      usagePercent: Math.min(100, Math.round((tokensUsedMax / 10000000) * 100)),
      periodEnd: null
    },
    {
      id: 'qwen3.7-plus',
      model: 'qwen3.7-plus',
      total: 10000000,
      used: tokensUsedPlus,
      remaining: Math.max(0, 10000000 - tokensUsedPlus),
      available: isCooldown ? 0 : 1,
      usagePercent: Math.min(100, Math.round((tokensUsedPlus / 10000000) * 100)),
      periodEnd: null
    }
  ]

  return c.json({
    id: credentials.id,
    label: credentials.email,
    active: true,
    queuePosition: credentials.queue_position || 1,
    registrationOrder: 1,
    user: {
      id: credentials.id,
      email: credentials.email,
      name: credentials.email.split('@')[0],
    },
    quota: {
      generatedAt: new Date().toISOString(),
      balances
    },
    quotaError: isCooldown ? { message: credentials.cooldown_reason || 'Cooldown activo', type: 'cooldown' } : null,
    hasZcodeJwtToken: true,
    hasZaiAccessToken: false,
  })
})

// Eliminar cuenta
app.delete('/accounts/:id', (c) => {
  const id = c.req.param('id')
  const baseId = getBaseAccountId(id)
  const removed = removeAccount(baseId)
  return c.json({
    removed,
    accountId: id,
    activeAccount: null
  })
})

// Reordenar cuentas
app.put('/accounts/order', async (c) => {
  const body = await c.req.json()
  const accountIds = body.accountIds
  if (!Array.isArray(accountIds)) {
    return c.json({ error: 'accountIds no válido' }, 400)
  }
  reorderAccounts(accountIds)
  return c.json({ ok: true })
})

// Activar una cuenta específica en el pool
app.post('/accounts/:id/activate', (c) => {
  const id = c.req.param('id')
  const baseId = getBaseAccountId(id)
  const accounts = listAccounts()
  const idx = accounts.findIndex(acc => acc.id === baseId)
  if (idx === -1) {
    return c.json({ error: 'Cuenta no encontrada' }, 404)
  }

  // Reordenamos poniendo esta cuenta en la posición 1
  const reordered = [baseId, ...accounts.filter(acc => acc.id !== baseId).map(acc => acc.id)]
  reorderAccounts(reordered)

  return c.json({ ok: true })
})

// Activar una cuenta específica en el pool (vía ZCode path mapeado para compatibilidad)
app.post('/zcode/accounts/:id/activate', (c) => {
  const id = c.req.param('id')
  const baseId = getBaseAccountId(id)
  const accounts = listAccounts()
  const idx = accounts.findIndex(acc => acc.id === baseId)
  if (idx === -1) {
    return c.json({ error: 'Cuenta no encontrada' }, 404)
  }
  const reordered = [baseId, ...accounts.filter(acc => acc.id !== baseId).map(acc => acc.id)]
  reorderAccounts(reordered)
  return c.json({ ok: true })
})

// Añadir cuenta con credenciales (email y password)
app.post('/accounts/add', async (c) => {
  const body = await c.req.json()
  const { email, password } = body
  if (!email || !password) {
    return c.json({ error: 'Email y contraseña son requeridos' }, 400)
  }

  try {
    const account = addAccount(email, password)
    return c.json({ ok: true, account })
  } catch (err: any) {
    return c.json({ error: err.message }, 400)
  }
})

// Iniciar login manual con Playwright
app.post('/accounts/login-manual', async (c) => {
  if (currentManualLogin && currentManualLogin.status === 'waiting') {
    return c.json({ error: 'Otro login manual ya está en progreso.' }, 400)
  }

  const accountId = crypto.randomUUID()
  let browserType: BrowserType = (process.env.BROWSER as BrowserType) || 'chromium'

  currentManualLogin = {
    accountId,
    email: null,
    status: 'waiting',
  }

    // Ejecutar el navegador asíncronamente
    ; (async () => {
      try {
        const { context, page } = await launchManualLoginAccount(accountId, browserType)
        manualLoginBrowserContext = context

        let loggedIn = false
        const timeout = Date.now() + 5 * 60 * 1000 // 5 minutos de tiempo límite

        while (!loggedIn && Date.now() < timeout && currentManualLogin?.status === 'waiting') {
          await new Promise(resolve => setTimeout(resolve, 2500))

          // Verificar si el contexto sigue abierto
          try {
            const pages = context.pages()
            if (pages.length === 0) {
              break // El usuario cerró el navegador
            }
          } catch {
            break
          }

          const { email: initEmail, hasSession } = await extractAccountInfoFromContext(page, accountId)
          if (hasSession) {
            let email = initEmail

            // Si el email no se ha extraído y el usuario sigue en la página de login, forzar la navegación al chat
            const currentUrl = page.url()
            if (currentUrl.includes('/auth') || currentUrl.includes('/login')) {
              console.log(`[Playwright] Redirigiendo a /c/new-chat para activar la carga del perfil...`)
              await page.goto('https://chat.qwen.ai/c/new-chat', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {})
            }

            // Esperar activamente (hasta 4 segundos) a que se asiente la sesión y el interceptor de red capture el email
            console.log(`[Playwright] Esperando 4 segundos a que se consoliden las cookies y se asiente la sesión de ${accountId}...`)
            const waitTimeout = Date.now() + 4000
            while (Date.now() < waitTimeout) {
              if (!email) {
                email = detectedEmailsByAccount.get(accountId) || null
              }
              await new Promise(resolve => setTimeout(resolve, 500))
            }

            // Si por alguna razón sigue sin capturarse, hacer un chequeo final (DOM)
            if (!email) {
              const check = await extractAccountInfoFromContext(page, accountId)
              email = check.email
            }

            loggedIn = true
            currentManualLogin.email = email
            currentManualLogin.status = 'success'

            // Guardar estado de cookies de autenticación final consolidado
            await saveStorageState(context, accountId)

            // Registrar en la base de datos
            const finalEmail = email || `manual-account-${accountId.slice(0, 6)}@qwen.ai`
            addAccount(finalEmail, '', accountId)
          }
        }

        if (!loggedIn && currentManualLogin?.status === 'waiting') {
          currentManualLogin.status = 'failed'
          currentManualLogin.error = 'Tiempo límite alcanzado o navegador cerrado.'
        }

        await context.close().catch(() => { })
      } catch (err: any) {
        if (currentManualLogin) {
          currentManualLogin.status = 'failed'
          currentManualLogin.error = err.message
        }
      } finally {
        manualLoginBrowserContext = null
      }
    })()

  return c.json({
    ok: true,
    accountId,
    status: 'waiting'
  })
})

// Estado del login manual actual
app.get('/accounts/login-manual/status', (c) => {
  if (!currentManualLogin) {
    return c.json({ status: 'idle' })
  }
  return c.json(currentManualLogin)
})

// Cancelar login manual activo
app.post('/accounts/login-manual/cancel', async (c) => {
  if (currentManualLogin) {
    currentManualLogin.status = 'failed'
    currentManualLogin.error = 'Cancelado por el usuario.'
  }
  if (manualLoginBrowserContext) {
    await manualLoginBrowserContext.close().catch(() => { })
    manualLoginBrowserContext = null
  }
  currentManualLogin = null
  return c.json({ ok: true })
})

// Forzar login automático para todas las cuentas
app.post('/accounts/login-auto', async (c) => {
  const accounts = listAccounts()
  if (accounts.length === 0) {
    return c.json({ error: 'Ninguna cuenta configurada' }, 400)
  }

  let browserType: BrowserType = (process.env.BROWSER as BrowserType) || 'chromium'

    // Procesar logins en segundo plano secuencialmente
    ; (async () => {
      for (const account of accounts) {
        const creds = getAccountCredentials(account.id)
        if (!creds || creds.password === '***' || !creds.password) {
          continue
        }
        try {
          await initPlaywrightForAccount(creds, true, browserType)
          await closePlaywrightForAccount(account.id)
        } catch (err: any) {
          console.error(`[Auto-Login] Fallo en el inicio de sesión automático para ${account.email}:`, err.message)
        }
      }
    })()

  return c.json({ ok: true, message: 'Inicio de sesión automático en lote iniciado en segundo plano.' })
})

// Logs en tiempo real formateados para la UI
app.get('/logs', (c) => {
  const formatted = logBuffer.map((log, index) => ({
    id: index + 1,
    timestamp: log.timestamp,
    level: log.level === 'debug' ? 'info' : log.level,
    event: log.context || 'Consola',
    message: log.message
  }))
  return c.json({
    object: 'list',
    data: formatted
  })
})

// Cola de peticiones snapshot
app.get('/queue', (c) => {
  return c.json({
    object: 'queue',
    activeCount: 0,
    queuedCount: 0,
    snapshots: []
  })
})

export { app as adminRouter }
