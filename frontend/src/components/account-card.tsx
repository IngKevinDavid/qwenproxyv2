import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { motion, Reorder, useDragControls } from 'framer-motion'
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Loader2,
  GripVertical,
  Trash2,
  UserRound,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Account, QuotaBalance } from '@/types/api'

interface AccountCardProps {
  account: Account
  isActive: boolean
  isSwitching: boolean
  isFirst: boolean
  isLast: boolean
  activatePending: boolean
  deletePending: boolean
  actionsDisabled: boolean
  onActivate: () => Promise<void>
  onDelete: () => Promise<void>
  onMoveUp: () => void
  onMoveDown: () => void
  onDragEnd: () => void
}

interface HoverHintProps {
  content: string
  children: ReactNode
}

function formatTokens(value: number | null): string {
  if (value == null) return '--'
  return new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function HoverHint({ content, children }: HoverHintProps) {
  return (
    <div className="group/tooltip relative">
      {children}
      <div
        className={cn(
          'pointer-events-none absolute bottom-full right-0 z-30 mb-2 w-72 rounded-md border border-border/70 bg-popover px-3 py-2 text-[11px] leading-relaxed text-popover-foreground shadow-xl',
          'opacity-0 translate-y-1 transition-all duration-150',
          'group-hover/tooltip:translate-y-0 group-hover/tooltip:opacity-100',
          'group-focus-within/tooltip:translate-y-0 group-focus-within/tooltip:opacity-100'
        )}
      >
        {content}
      </div>
    </div>
  )
}

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'qwen3.7-max': 'Qwen3.7-Max',
  'qwen3.7-plus': 'Qwen3.7-Plus',
}

function ModelQuota({ balance }: { balance: QuotaBalance }) {
  const displayName = MODEL_DISPLAY_NAMES[balance.model] || balance.model;
  return (
    <div className="rounded-md border border-border/50 bg-background/35 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold">{displayName}</p>
          <p className="text-[11px] text-muted-foreground">
            {formatTokens(balance.used)} usados
          </p>
        </div>
        <span className={cn(
          "text-[10px] font-semibold px-2 py-0.5 rounded-full",
          balance.available ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
        )}>
          {balance.available ? 'Disponible' : 'En Cooldown'}
        </span>
      </div>
    </div>
  )
}

export function AccountCard({
  account,
  isActive,
  isSwitching,
  isFirst,
  isLast,
  activatePending,
  deletePending,
  actionsDisabled,
  onActivate,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDragEnd,
}: AccountCardProps) {
  const dragControls = useDragControls()
  const displayName = account.user.name || account.label
  const email = account.user.email || account.user.id || account.id
  const [deleteConfirming, setDeleteConfirming] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  
  const activateTooltip = isActive
    ? 'Esta ya es la cuenta preferencial del proxy.'
    : 'Define esta cuenta como preferencial para las nuevas llamadas del proxy.'
  const deleteTooltip = 'Remueve esta cuenta del pool de rotación de QwenProxy.'

  useEffect(() => {
    setDeleteConfirming(false)
    setDeleteError(null)
  }, [account.id])

  const activateAccount = async () => {
    if (isActive || activatePending || actionsDisabled) return
    try {
      await onActivate()
    } catch (err) {
      console.error(err)
    }
  }

  const deleteAccount = async () => {
    if (deletePending) return
    setDeleteError(null)
    try {
      await onDelete()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'No fue posible borrar la cuenta')
    }
  }

  return (
    <Reorder.Item
      value={account}
      dragListener={false}
      dragControls={dragControls}
      onDragEnd={onDragEnd}
      layout
      whileDrag={{
        scale: 1.02,
        zIndex: 30,
        boxShadow: '0 22px 60px rgba(0,0,0,.32)',
      }}
      transition={{ type: 'spring', stiffness: 360, damping: 32 }}
      className="list-none"
    >
      <motion.article
        layout
        animate={
          isSwitching
            ? {
                scale: [1, 1.018, 1],
                boxShadow: [
                  '0 8px 28px rgba(16,185,129,.08)',
                  '0 0 0 1px rgba(16,185,129,.45), 0 24px 64px rgba(16,185,129,.22)',
                  '0 8px 28px rgba(16,185,129,.08)',
                ],
              }
            : undefined
        }
        transition={{ duration: 1.2, ease: 'easeOut' }}
        className={cn(
          'group relative overflow-hidden rounded-lg border bg-card/75',
          'transition-colors duration-200',
          isActive ? 'border-emerald-500/60 shadow-[0_8px_28px_rgba(16,185,129,.08)]' : 'border-border/70',
        )}
      >
        {isSwitching && (
          <motion.div
            initial={{ opacity: 0, x: '-100%' }}
            animate={{ opacity: [0, 0.8, 0], x: ['-100%', '15%', '100%'] }}
            transition={{ duration: 1.4, ease: 'easeInOut' }}
            className="pointer-events-none absolute inset-y-0 left-0 w-40 bg-gradient-to-r from-transparent via-emerald-400/18 to-transparent"
          />
        )}
        <div className="flex items-stretch">
          <button
            type="button"
            aria-label={`Arrastrar ${account.label}`}
            title="Mantén y arrastra para reorganizar"
            onPointerDown={(event) => dragControls.start(event)}
            className="flex w-10 shrink-0 cursor-grab touch-none items-center justify-center border-r border-border/50 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>

          <div className="min-w-0 flex-1 p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-full border border-border/70 bg-muted">
                  <UserRound className="m-2.5 h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{displayName}</h3>
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                      Posición: {account.queuePosition}
                    </span>
                    {isActive && (
                      <span className="inline-flex items-center gap-1 rounded bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-500">
                        <Check className="h-3 w-3" /> Preferencial
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">{email}</p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button variant="ghost" size="icon" title="Mover hacia arriba" disabled={isFirst} onClick={onMoveUp}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" title="Mover hacia abajo" disabled={isLast} onClick={onMoveDown}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                {deleteConfirming ? (
                  <div className="inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-red-500/7 p-1">
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={deletePending}
                      onClick={() => { void deleteAccount() }}
                    >
                      {deletePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      Confirmar
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                      disabled={deletePending}
                      onClick={() => {
                        setDeleteConfirming(false)
                        setDeleteError(null)
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <HoverHint content={deleteTooltip}>
                    <span className="inline-flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
                        title="Borrar cuenta"
                        disabled={actionsDisabled}
                        onClick={() => setDeleteConfirming(true)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </span>
                  </HoverHint>
                )}
                <HoverHint content={activateTooltip}>
                  <span className="inline-flex">
                    <Button
                      variant={isActive ? 'secondary' : 'outline'}
                      size="sm"
                      disabled={isActive || activatePending || actionsDisabled}
                      onClick={() => { void activateAccount() }}
                    >
                      {activatePending ? 'Activando...' : isActive ? 'Preferencial' : 'Usar ahora'}
                    </Button>
                  </span>
                </HoverHint>
              </div>
            </div>

            {deleteError && (
              <p className="mt-3 rounded-md border border-red-500/25 bg-red-500/5 px-3 py-2 text-[11px] text-red-400">
                {deleteError}
              </p>
            )}

            {account.quota ? (
              <div className="mt-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  {account.quota.balances.map((balance) => (
                    <ModelQuota key={balance.id || balance.model} balance={balance} />
                  ))}
                </div>
              </div>
            ) : account.quotaError ? (
              <div className="mt-4 rounded-md border border-red-500/25 bg-red-500/5 px-3 py-2 text-xs text-red-400 font-semibold flex items-center gap-2">
                <CircleAlert className="h-4 w-4" /> {account.quotaError.message}
              </div>
            ) : null}
          </div>
        </div>
      </motion.article>
    </Reorder.Item>
  )
}
