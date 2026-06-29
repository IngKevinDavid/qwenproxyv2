import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'
import { exec } from 'child_process'
import { config } from '../core/config.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '../../')
const frontendDistPath = path.join(projectRoot, 'frontend/dist')
import { metrics } from '../core/metrics.js'
import { cache } from '../cache/memory-cache.js'
import { Watchdog } from '../core/watchdog.js'
import { app as modelsApp } from './models.js'
import { chatCompletions, chatCompletionsStop } from '../routes/chat.js'
import { uploadFile } from '../routes/upload.js'
import { getBaseAccountId, makeAccountLaneId } from '../core/account-lanes.js'
import { adminRouter } from '../routes/admin.js'

const app = new Hono()

let watchdog: Watchdog
let server: any

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

function randomDelay(minMs: number, maxMs: number): number {
  const min = Math.max(0, Math.min(minMs, maxMs))
  const max = Math.max(min, maxMs)
  return min + Math.floor(Math.random() * (max - min + 1))
}

async function runWithConcurrency<T>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  const limit = Math.max(1, concurrency)
  let cursor = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

app.use('*', async (c, next) => {
  metrics.increment('requests.total')
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  metrics.histogram('latency.request', duration)
  c.header('X-Response-Time', `${duration}ms`)
})

app.use('/v1/*', async (c, next) => {
  const apiKey = process.env.API_KEY || config.apiKey
  if (apiKey) {
    const auth = c.req.header('Authorization')
    if (!auth?.startsWith('Bearer ')) {
      return c.json({ error: 'Falta el encabezado Authorization o no es válido' }, 401)
    }
    const token = auth.slice(7)
    const tokenBuf = Buffer.from(token)
    const keyBuf = Buffer.from(apiKey)
    if (tokenBuf.length !== keyBuf.length || !crypto.timingSafeEqual(tokenBuf, keyBuf)) {
      return c.json({ error: 'API key no válida' }, 401)
    }
  }
  await next()
})

app.route('', modelsApp)
app.route('/api/admin', adminRouter)

// Servir frontend React
app.get('/admin', (c) => c.redirect('/admin/'))
app.use('/admin/assets/*', serveStatic({
  root: path.relative(process.cwd(), frontendDistPath),
  rewriteRequestPath: (p) => p.replace(/^\/admin\/assets/, '/assets'),
}))

app.get('/admin/*', async (c) => {
  try {
    const indexPath = path.join(frontendDistPath, 'index.html')
    const html = fs.readFileSync(indexPath, 'utf-8')
    return c.html(html)
  } catch (err: any) {
    return c.text('Frontend no compilado. Por favor, ejecuta npm run build desde la raíz.', 500)
  }
})

app.post('/v1/chat/completions', chatCompletions)
app.post('/v1/chat/completions/stop', chatCompletionsStop)
app.post('/v1/upload', uploadFile)

app.get('/health', async (c) => {
  const status = await watchdog?.getStatus()
  return c.json({
    status: status?.overall || 'unknown',
    timestamp: Date.now(),
    metrics: {
      cache: await cache?.getStats(),
    },
  })
})

app.get('/metrics', (c) => {
  return c.text(metrics.formatPrometheus(), {
    headers: { 'Content-Type': 'text/plain; version=0.0.4' },
  })
})

app.onError((err, c) => {
  metrics.increment('requests.errors')
  console.error('API Error:', err)
  return c.json({ error: err.message }, 500)
})

app.notFound((c) => c.json({ error: 'Ruta no encontrada' }, 404))

export async function startServer(): Promise<void> {
  await cache.connect()

  const { loadAccounts, addAccount } = await import('../core/accounts.js')
  let accounts = loadAccounts()

  if (accounts.length === 0 && process.env.QWEN_EMAIL && process.env.QWEN_PASSWORD) {
    console.log(`[Servidor] Base de datos vacía. Auto-registrando la cuenta inicial del .env: ${process.env.QWEN_EMAIL}`)
    try {
      addAccount(process.env.QWEN_EMAIL, process.env.QWEN_PASSWORD)
      accounts = loadAccounts()
    } catch (err: any) {
      console.error('[Servidor] Fallo al auto-registrar la cuenta inicial del .env:', err.message)
    }
  }

  const { initPlaywright, initPlaywrightForAccount } = await import('../services/playwright.js')

  if (accounts.length > 0) {
    const now = Date.now()
    let activeAccounts = accounts.filter(account => !account.cooldown_until || account.cooldown_until <= now)
    let cooldownAccounts = accounts.filter(account => account.cooldown_until && account.cooldown_until > now)

    if (config.accounts.singleAccountMode) {
      const selected = activeAccounts.find(account => {
        if (config.accounts.singleAccountId) return account.id === config.accounts.singleAccountId
        if (config.accounts.singleAccountEmail) return account.email === config.accounts.singleAccountEmail
        return true
      }) || activeAccounts[0]

      activeAccounts = selected
        ? Array.from({ length: config.accounts.lanes }, (_, index) => ({
          ...selected,
          id: makeAccountLaneId(selected.id, index + 1),
          email: `${selected.email}#lane-${index + 1}`,
        }))
        : []
      cooldownAccounts = selected ? [] : cooldownAccounts

      if (selected) {
        console.log(`[Servidor] Modo de cuenta única activo: ${selected.email} con ${config.accounts.lanes} carril(es) aislado(s).`)
      }
    }

    if (cooldownAccounts.length > 0) {
      console.log(`[Servidor] Omitiendo ${cooldownAccounts.length} cuenta(s) en cooldown durante el inicio.`)
    }

    console.log(`[Servidor] Inicializando ${activeAccounts.length}/${accounts.length} cuenta(s) configurada(s) con concurrencia ${config.accounts.initConcurrency}...`)
    const { getAccountCredentials } = await import('../core/accounts.js')
    await runWithConcurrency(activeAccounts, config.accounts.initConcurrency, async (account, i) => {
      const creds = getAccountCredentials(getBaseAccountId(account.id))
      if (!creds) return
      const stagger = i === 0 ? 0 : randomDelay(config.accounts.initStaggerMinMs, config.accounts.initStaggerMaxMs)
      if (stagger > 0) await sleep(stagger)
      try {
        await initPlaywrightForAccount({ ...creds, id: account.id, email: account.email }, config.browser.headless)
      } catch (err: any) {
        console.error(`[Servidor] Fallo al inicializar la cuenta ${account.email}:`, err.message)
      }
    })
    if (config.precapture.headersStartup) {
      console.log(`[Servidor] Precapturando encabezados de Qwen para ${activeAccounts.length} cuenta(s) activa(s) con concurrencia ${config.precapture.concurrency}...`)
      const { getQwenHeaders } = await import('../services/playwright.js')
      runWithConcurrency(activeAccounts, config.precapture.concurrency, async (account, i) => {
        const stagger = i === 0 ? 0 : randomDelay(config.precapture.staggerMinMs, config.precapture.staggerMaxMs)
        if (stagger > 0) await sleep(stagger)
        try {
          await getQwenHeaders(false, account.id)
        } catch (err: any) {
          console.warn(`[Servidor] Precaptura de encabezados falló para ${account.email}:`, err.message)
        }
      }).catch(() => {})
    }
    if (config.warmPool.startup) {
      console.log(`[Servidor] Precargando chats del pool para ${activeAccounts.length} cuenta(s) activa(s) en segundo plano...`)
      const { warmAllPools } = await import('../services/qwen.js')
      warmAllPools(activeAccounts.map(a => a.id)).catch(() => {})
    }
  } else {
    await initPlaywright(config.browser.headless)
  }

  const { startSessionKeeper } = await import('../services/session-keeper.js')
  startSessionKeeper()

  watchdog = new Watchdog()
  watchdog.start()

  metrics.startCollection()

  server = serve({
    fetch: app.fetch,
    port: config.server.port,
    hostname: config.server.host,
  }, (info) => {
    const url = `http://127.0.0.1:${info.port}/admin/`
    console.log(`Servidor escuchando en: ${url}`)
    
    // Abre el navegador predeterminado en Windows al iniciar el servidor
    try {
      exec(`start ${url}`)
    } catch (err: any) {
      console.error('Fallo al abrir el navegador automáticamente:', err.message)
    }
  })

  const shutdown = async (signal: string) => {
    console.log(`Se recibió la señal ${signal}, cerrando el servidor de forma segura...`)
    const { stopSessionKeeper } = await import('../services/session-keeper.js')
    stopSessionKeeper()
    watchdog.stop()
    metrics.stopCollection()
    await cache.close()
    const { closePlaywright } = await import('../services/playwright.js')
    await closePlaywright()
    const { closeDatabase } = await import('../core/database.js')
    closeDatabase()
    server?.close()
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

export { app }
