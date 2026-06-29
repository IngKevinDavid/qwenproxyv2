import { useEffect, useState, useRef } from 'react'
import { Chrome, Loader2, Plus, AlertCircle, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

interface LoginDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

interface ManualLoginStatus {
  status: 'idle' | 'waiting' | 'success' | 'failed'
  email?: string | null
  error?: string
}

export function LoginDialog({ open, onOpenChange, onSuccess }: LoginDialogProps) {
  const [activeTab, setActiveTab] = useState<'credentials' | 'manual'>('credentials')
  
  // Credenciales form
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [credPending, setCredPending] = useState(false)
  const [credError, setCredError] = useState<string | null>(null)
  
  // Login manual
  const [manualStatus, setManualStatus] = useState<ManualLoginStatus>({ status: 'idle' })
  const pollIntervalRef = useRef<number | null>(null)

  // Reset al cerrar
  useEffect(() => {
    if (!open) {
      setEmail('')
      setPassword('')
      setCredPending(false)
      setCredError(null)
      stopPollingManualLogin()
      setManualStatus({ status: 'idle' })
    }
  }, [open])

  const stopPollingManualLogin = () => {
    if (pollIntervalRef.current) {
      window.clearInterval(pollIntervalRef.current)
      pollIntervalRef.current = null
    }
  }

  const startPollingManualLogin = () => {
    stopPollingManualLogin()
    pollIntervalRef.current = window.setInterval(async () => {
      try {
        const statusRes = await api.get<ManualLoginStatus>(`/api/admin/accounts/login-manual/status`)
        setManualStatus(statusRes)
        if (statusRes.status === 'success') {
          stopPollingManualLogin()
          onSuccess()
          onOpenChange(false)
        } else if (statusRes.status === 'failed') {
          stopPollingManualLogin()
        }
      } catch (err: any) {
        stopPollingManualLogin()
        setManualStatus({ status: 'failed', error: err.message })
      }
    }, 2000)
  }

  const handleAddCredentials = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email || !password) {
      setCredError('El correo electrónico y la contraseña son requeridos.')
      return
    }
    setCredPending(true)
    setCredError(null)
    try {
      await api.post('/api/admin/accounts/add', { email, password })
      onSuccess()
      onOpenChange(false)
    } catch (err: any) {
      setCredError(err.message || 'Fallo al agregar la cuenta.')
    } finally {
      setCredPending(false)
    }
  }

  const handleStartManualLogin = async () => {
    setManualStatus({ status: 'waiting' })
    try {
      await api.post<{ accountId: string }>('/api/admin/accounts/login-manual')
      startPollingManualLogin()
    } catch (err: any) {
      setManualStatus({ status: 'failed', error: err.message })
    }
  }

  const handleCancelManualLogin = async () => {
    stopPollingManualLogin()
    try {
      await api.post('/api/admin/accounts/login-manual/cancel')
    } catch {}
    setManualStatus({ status: 'idle' })
  }

  useEffect(() => {
    return () => stopPollingManualLogin()
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-card border-border">
        <DialogHeader>
          <DialogTitle>Agregar Cuenta Qwen</DialogTitle>
          <DialogDescription>
            Conecta tus cuentas del chat.qwen.ai al pool de QwenProxy.
          </DialogDescription>
        </DialogHeader>

        <div className="flex border-b border-border/60 mb-4">
          <button
            type="button"
            onClick={() => setActiveTab('credentials')}
            className={`flex-1 pb-2.5 text-xs font-semibold uppercase tracking-[0.1em] border-b-2 transition-colors ${
              activeTab === 'credentials'
                ? 'border-emerald-500 text-emerald-500'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Credenciales Básicas
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className={`flex-1 pb-2.5 text-xs font-semibold uppercase tracking-[0.1em] border-b-2 transition-colors ${
              activeTab === 'manual'
                ? 'border-emerald-500 text-emerald-500'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            Login Manual (Navegador)
          </button>
        </div>

        <div className="py-2">
          {activeTab === 'credentials' ? (
            <form onSubmit={handleAddCredentials} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">E-mail</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-9 bg-background border border-border/80 rounded-md px-3 text-xs outline-none focus:border-emerald-500/70 transition-colors"
                  placeholder="ejemplo@correo.com"
                  disabled={credPending}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Contraseña</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-9 bg-background border border-border/80 rounded-md px-3 text-xs outline-none focus:border-emerald-500/70 transition-colors"
                  placeholder="Tu contraseña de chat.qwen.ai"
                  disabled={credPending}
                />
              </div>

              {credError && (
                <div className="text-red-400 text-xs rounded-md border border-red-500/20 bg-red-500/5 p-2.5 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{credError}</span>
                </div>
              )}

              <Button type="submit" disabled={credPending} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white">
                {credPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Agregando...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4" /> Guardar Credenciales
                  </>
                )}
              </Button>
            </form>
          ) : (
            <div className="text-center space-y-4 py-2">
              {manualStatus.status === 'idle' && (
                <>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Este método abrirá una ventana visible del navegador (Chromium/Chrome) para que puedas iniciar sesión manualmente (útil para login mediante Google, GitHub, etc.). El proxy guardará las credenciales automáticamente una vez que detecte la sesión activa.
                  </p>
                  <Button onClick={handleStartManualLogin} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white gap-2">
                    <Chrome className="h-4 w-4" />
                    Abrir Navegador de Autenticación
                  </Button>
                </>
              )}

              {manualStatus.status === 'waiting' && (
                <div className="space-y-4">
                  <div className="flex justify-center">
                    <Loader2 className="h-10 w-10 text-emerald-500 animate-spin" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold">Navegador abierto en primer plano</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Por favor, inicia sesión en chat.qwen.ai dentro de la ventana que se acaba de abrir. El proxy cerrará la ventana y guardará los datos automáticamente una vez que el login sea exitoso.
                    </p>
                  </div>
                  <Button onClick={handleCancelManualLogin} variant="outline" size="sm" className="gap-1.5 text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" /> Cancelar Operación
                  </Button>
                </div>
              )}

              {manualStatus.status === 'failed' && (
                <div className="space-y-4">
                  <div className="text-red-400 text-xs rounded-md border border-red-500/20 bg-red-500/5 p-2.5 flex items-start gap-2 text-left">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold">Fallo en la autenticación manual</p>
                      <p className="mt-0.5 leading-normal">{manualStatus.error}</p>
                    </div>
                  </div>
                  <Button onClick={handleStartManualLogin} className="w-full bg-emerald-500 hover:bg-emerald-600 text-white gap-2">
                    <Chrome className="h-4 w-4" />
                    Intentar de Nuevo
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
