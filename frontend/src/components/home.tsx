import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, Reorder } from 'framer-motion'
import { Activity, ArrowRight, Bot, Clock3, KeyRound, Loader2, Play, Plus, RefreshCw, Server, Sparkles } from 'lucide-react'
import { AccountCard } from '@/components/account-card'
import { APISettingsDialog } from '@/components/api-settings-dialog'
import { LoginDialog } from '@/components/login-dialog'
import { LogsDialog } from '@/components/logs-dialog'
import { ThemeToggle } from '@/components/theme-toggle'
import { Button } from '@/components/ui/button'
import { useAccounts } from '@/hooks/use-accounts'
import { useOverview } from '@/hooks/use-overview'
import { api } from '@/lib/api'
import type { Account } from '@/types/api'

function move(items: Account[], from: number, to: number): Account[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item) next.splice(to, 0, item)
  return next
}

function formatElapsed(from: number, now: number): string {
  const diffSeconds = Math.max(0, Math.floor((now - from) / 1000))
  if (diffSeconds < 60) return `${diffSeconds}s`
  const minutes = Math.floor(diffSeconds / 60)
  const seconds = diffSeconds % 60
  return `${minutes}m ${seconds}s`
}

type AccountAction = { id: string; type: 'activate' | 'delete' }

export function Home() {
  const { data: accountsData, loading, error: accountsError, refresh, reorder, quotaRefreshing } = useAccounts()
  const overviewState = useOverview(1000)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [optimisticActiveAccountId, setOptimisticActiveAccountId] = useState<string | null>(null)
  const [loginOpen, setLoginOpen] = useState(false)
  const [logsOpen, setLogsOpen] = useState(false)
  const [apiSettingsOpen, setAPISettingsOpen] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [autoLoginPending, setAutoLoginPending] = useState(false)
  const [accountAction, setAccountActionState] = useState<AccountAction | null>(null)
  const [switchEvent, setSwitchEvent] = useState<{ fromId: string | null; toId: string; timestamp: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const dragOrderRef = useRef<Account[]>([])
  const previousActiveIdRef = useRef<string | null>(null)
  const accountActionRef = useRef<AccountAction | null>(null)

  const setAccountAction = (action: AccountAction | null) => {
    accountActionRef.current = action
    setAccountActionState(action)
  }

  const clearAccountAction = (id: string, type: AccountAction['type']) => {
    const current: AccountAction | null = accountActionRef.current
    if (current?.id === id && current.type === type) {
      setAccountAction(null)
    }
  }

  useEffect(() => {
    if (accountsData) {
      setAccounts(accountsData.data)
      dragOrderRef.current = accountsData.data
      if (optimisticActiveAccountId && accountsData.activeAccountId === optimisticActiveAccountId) {
        setOptimisticActiveAccountId(null)
      }
    }
  }, [accountsData, optimisticActiveAccountId])

  const activeAccountId = optimisticActiveAccountId ?? accountsData?.activeAccountId ?? null
  const activeAccount = accounts.find((account) => account.id === activeAccountId) ?? null
  const settings = overviewState.overview?.settings
  
  const apiStatusText = settings?.apiEnabled
    ? settings.apiKeys && settings.apiKeys.length > 0
      ? `${settings.apiKeys.length} API key${settings.apiKeys.length === 1 ? '' : 's'} local${settings.apiKeys.length === 1 ? '' : 's'} - /v1/chat/completions activo`
      : 'Sin API key local - localhost liberado - /v1/chat/completions activo'
    : 'El panel sigue funcionando; clientes externos reciben indisponible'

  useEffect(() => {
    if (!activeAccountId) {
      previousActiveIdRef.current = activeAccountId
      return
    }
    const previousActiveId = previousActiveIdRef.current
    if (previousActiveId && previousActiveId !== activeAccountId) {
      setSwitchEvent({ fromId: previousActiveId, toId: activeAccountId, timestamp: Date.now() })
    }
    previousActiveIdRef.current = activeAccountId
  }, [activeAccountId])

  useEffect(() => {
    if (!switchEvent) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    const cleanup = window.setTimeout(() => setSwitchEvent((current) => {
      if (!current) return current
      return Date.now() - current.timestamp >= 45000 ? null : current
    }), 45000)
    return () => {
      window.clearInterval(timer)
      window.clearTimeout(cleanup)
    }
  }, [switchEvent])

  const findAccount = (id: string | null) => accounts.find((account) => account.id === id) ?? null
  const previousAccount = switchEvent ? findAccount(switchEvent.fromId) : null
  const switchedAccount = switchEvent ? findAccount(switchEvent.toId) : null

  const persistOrder = async (ordered: Account[]) => {
    setAccounts(ordered)
    dragOrderRef.current = ordered
    try {
      await reorder(ordered)
      await refresh({ cancelInFlight: true })
    } catch {
      await refresh({ cancelInFlight: true })
    }
  }

  const activate = async (id: string) => {
    if (accountActionRef.current) return
    setAccountAction({ id, type: 'activate' })
    try {
      await api.post(`/api/admin/accounts/${id}/activate`)
      setOptimisticActiveAccountId(id)
      await refresh({ cancelInFlight: true })
    } catch (err) {
      console.error(err)
    } finally {
      clearAccountAction(id, 'activate')
    }
  }

  const deleteAccount = async (id: string) => {
    if (accountActionRef.current) return
    setAccountAction({ id, type: 'delete' })
    try {
      await api.delete(`/api/admin/accounts/${id}`)
      setAccounts((current) => current.filter((account) => account.id !== id))
      await refresh({ cancelInFlight: true })
    } finally {
      clearAccountAction(id, 'delete')
    }
  }

  const refreshAccounts = async () => {
    setRefreshing(true)
    try {
      await refresh({ cancelInFlight: true })
    } finally {
      setRefreshing(false)
    }
  }

  const handleTriggerAutoLogin = async () => {
    setAutoLoginPending(true)
    try {
      await api.post('/api/admin/accounts/login-auto')
    } catch (err) {
      console.error(err)
    } finally {
      setAutoLoginPending(false)
      await refresh({ cancelInFlight: true })
    }
  }

  const moveAccount = async (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= accounts.length) return
    await persistOrder(move(accounts, index, target))
  }

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/50 px-5">
        <div className="flex items-center gap-3">
          <span className={`h-2 w-2 rounded-full ${settings?.apiEnabled ? 'bg-emerald-500 shadow-[0_0_9px_rgba(16,185,129,.8)]' : 'bg-muted-foreground/50'}`} />
          <span className="text-sm font-semibold">QwenProxy V2</span>
          {settings && <span className="text-xs text-muted-foreground">127.0.0.1:{settings.port}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setLogsOpen(true)}>
            <Activity className="h-4 w-4" /> Logs
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAPISettingsOpen(true)}>
            <KeyRound className="h-4 w-4" /> API
          </Button>
          <ThemeToggle />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
          {settings && (
            <section className={`flex items-center justify-between rounded-lg border px-4 py-3 ${settings.apiEnabled ? 'border-emerald-500/30 bg-emerald-500/[.045]' : 'border-border/70 bg-card/50'}`}>
              <div className="flex items-center gap-3">
                <div className={`flex h-9 w-9 items-center justify-center rounded-md ${settings.apiEnabled ? 'bg-emerald-500/12 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
                  <Server className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">{settings.apiEnabled ? 'API OpenAI activa' : 'API OpenAI inactiva'}</p>
                  <p className="text-xs text-muted-foreground">{apiStatusText}</p>
                </div>
              </div>
              <Button
                variant={settings.apiEnabled ? 'outline' : 'default'}
                onClick={async () => {
                  await api.post(`/api/admin/settings`, { apiEnabled: !settings.apiEnabled })
                  await refresh({ cancelInFlight: true })
                }}
              >
                {settings.apiEnabled ? 'Detener API' : 'Iniciar API'}
              </Button>
            </section>
          )}

          {overviewState.error && (
            <p className="rounded-md border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-400">
              {overviewState.error}
            </p>
          )}

          <AnimatePresence initial={false}>
            {switchEvent && switchedAccount && (
              <motion.section
                key={switchEvent.timestamp}
                initial={{ opacity: 0, y: 18, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35, ease: 'easeOut' }}
                className="relative overflow-hidden rounded-2xl border border-sky-400/30 bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_40%),linear-gradient(135deg,rgba(15,23,42,0.94),rgba(9,14,24,0.98))] p-4 text-slate-50 shadow-[0_18px_55px_rgba(14,165,233,0.16)]"
              >
                <motion.div
                  initial={{ opacity: 0.25, x: '-30%' }}
                  animate={{ opacity: [0.2, 0.5, 0.2], x: ['-30%', '15%', '85%'] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
                  className="pointer-events-none absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-transparent via-sky-300/18 to-transparent"
                />

                <div className="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-200">
                      <Sparkles className="h-3.5 w-3.5" />
                      Cuenta cambiada
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-base font-semibold md:text-lg">
                      <span className="truncate">{previousAccount?.label ?? 'Cuenta anterior'}</span>
                      <ArrowRight className="h-4 w-4 text-sky-300" />
                      <span className="truncate text-sky-200">{switchedAccount.label}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-300">
                      {switchedAccount.user.email || switchedAccount.user.name || switchedAccount.id}
                    </p>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">Momento</p>
                      <p className="mt-1 text-sm font-medium text-slate-100">
                        {new Date(switchEvent.timestamp).toLocaleTimeString('es-ES')}
                      </p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-2">
                      <p className="flex items-center gap-1 text-[11px] uppercase tracking-[0.16em] text-slate-400">
                        <Clock3 className="h-3.5 w-3.5" />
                        Tiempo desde el cambio
                      </p>
                      <p className="mt-1 text-sm font-medium text-sky-200">
                        {formatElapsed(switchEvent.timestamp, now)}
                      </p>
                    </div>
                  </div>
                </div>
              </motion.section>
            )}
          </AnimatePresence>


          <section>
            <div className="mb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold">Pool de Cuentas Qwen</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {loading
                    ? 'Consultando cuentas y sesiones...'
                    : activeAccount
                      ? `${accounts.length} cuenta${accounts.length === 1 ? '' : 's'} en el pool - preferencial: ${activeAccount.label}`
                      : `${accounts.length} cuenta${accounts.length === 1 ? '' : 's'} en el pool - arrastra el tirador para reordenar la fila`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={handleTriggerAutoLogin} disabled={autoLoginPending} title="Iniciar sesión Playwright en lote de forma automática para cuentas con contraseña">
                  {autoLoginPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                  Inicio de sesión automático en lote
                </Button>
                <Button variant="outline" size="sm" onClick={refreshAccounts} disabled={refreshing || quotaRefreshing}>
                  <RefreshCw className={refreshing || quotaRefreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                  Actualizar sesiones
                </Button>
                <Button size="sm" onClick={() => setLoginOpen(true)} className="bg-emerald-500 hover:bg-emerald-600 text-white">
                  <Plus className="h-4 w-4" /> Agregar cuenta
                </Button>
              </div>
            </div>

            {accountsError && (
              <p className="mb-3 rounded-md border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-400">{accountsError}</p>
            )}

            {accounts.length === 0 && !loading ? (
              <div className="rounded-lg border border-dashed border-border/70 bg-card/30 py-16 text-center">
                <Bot className="mx-auto h-9 w-9 text-muted-foreground/50" />
                <p className="mt-3 text-sm font-medium">Ninguna cuenta guardada</p>
                <p className="mt-1 text-xs text-muted-foreground">Agrega una cuenta Qwen con credenciales o inicio de sesión manual para iniciar el pool.</p>
              </div>
            ) : (
              <Reorder.Group
                axis="y"
                values={accounts}
                onReorder={(ordered) => {
                  setAccounts(ordered)
                  dragOrderRef.current = ordered
                }}
                className="space-y-3"
              >
                {accounts.map((account, index) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    isActive={account.id === activeAccountId}
                    isSwitching={account.id === switchEvent?.toId}
                    isFirst={index === 0}
                    isLast={index === accounts.length - 1}
                    activatePending={accountAction?.id === account.id && accountAction.type === 'activate'}
                    deletePending={accountAction?.id === account.id && accountAction.type === 'delete'}
                    actionsDisabled={accountAction !== null}
                    onActivate={() => activate(account.id)}
                    onDelete={() => deleteAccount(account.id)}
                    onMoveUp={() => moveAccount(index, -1)}
                    onMoveDown={() => moveAccount(index, 1)}
                    onDragEnd={() => persistOrder(dragOrderRef.current)}
                  />
                ))}
              </Reorder.Group>
            )}
          </section>
        </div>
      </main>

      <LoginDialog open={loginOpen} onOpenChange={setLoginOpen} onSuccess={() => { void refresh({ cancelInFlight: true }) }} />
      <LogsDialog open={logsOpen} onOpenChange={setLogsOpen} />
      {settings && (
        <APISettingsDialog
          open={apiSettingsOpen}
          onOpenChange={setAPISettingsOpen}
          settings={settings}
          onToggleAPI={async (enabled) => {
            await api.post(`/api/admin/settings`, { apiEnabled: enabled })
            await refresh({ cancelInFlight: true })
          }}
          onUpdatePort={async (port) => {
            const res = await api.patch<{ ok: boolean }>(`/api/admin/settings`, { port })
            return res.ok
          }}
          onCreateKey={async (name) => {
            const res = await api.post<{ secret: string }>(`/api/admin/settings/keys`, { name })
            return res.secret
          }}
          onDeleteKey={async (id) => {
            await api.delete(`/api/admin/settings/keys/${id}`)
          }}
        />
      )}
    </div>
  )
}
