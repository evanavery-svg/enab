import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icon'
import { MonthNav } from '../components/MonthNav'
import { MenuButton, Popover } from '../components/Menu'
import { ConfirmDialog } from '../components/Modal'
import { MoveMoneyModal } from '../components/MoveMoneyModal'
import { AmountInput } from '../components/Fields'
import { Modal } from '../components/Modal'
import { AccountFormModal } from '../components/AccountForm'
import { AppFooter } from '../components/AppFooter'
import { useData } from '../hooks/useData'
import { toast, useUi } from '../state/ui'
import {
  createCategory,
  createCategoryGroup,
  deleteCategoryGroup,
  setAssigned,
  setAssignedBulk,
  updateCategoryGroup,
} from '../db/actions'
import {
  QUICK_BUDGET_LABELS,
  quickBudgetPlan,
  type QuickBudgetAction,
} from '../budget/quickBudget'
import { monthLabel } from '../lib/dates'
import type { Category, CategoryGroup, CategoryMonthState, Cents, Id } from '../types'

const QUICK_ACTIONS: QuickBudgetAction[] = [
  'underfunded',
  'assignedLastMonth',
  'spentLastMonth',
  'averageAssigned',
  'averageSpent',
  'resetAssigned',
]

export default function BudgetPage() {
  const data = useData()
  const { groups, categories, budget, money, accounts } = data
  const month = useUi((s) => s.month)
  const openDetail = useUi((s) => s.openCategoryDetail)
  const openTxnModal = useUi((s) => s.openTxnModal)
  const navigate = useNavigate()

  const [showHidden, setShowHidden] = useState(false)
  const [addingGroup, setAddingGroup] = useState(false)
  const [addingCategoryTo, setAddingCategoryTo] = useState<Id | null>(null)
  const [moving, setMoving] = useState<{ from?: Id | null; to?: Id | null; amount?: Cents } | null>(null)
  const [addingAccount, setAddingAccount] = useState(false)

  const states = budget.categoryStates.get(month)
  const summary = budget.summaries.get(month)

  const tree = useMemo(() => {
    return groups
      .filter((g) => !g.isInternal && (showHidden || !g.hidden))
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((group) => ({
        group,
        items: categories
          .filter((c) => c.groupId === group.id && (showHidden || !c.hidden))
          .sort((a, b) => a.sortOrder - b.sortOrder),
      }))
      .filter((entry) => entry.items.length > 0 || !entry.group.isSystem)
  }, [groups, categories, showHidden])

  const allCategoryIds = useMemo(
    () => tree.flatMap((t) => t.items.map((c) => c.id)),
    [tree],
  )

  async function runQuickBudget(action: QuickBudgetAction) {
    const plan = quickBudgetPlan(action, budget, month, allCategoryIds)
    if (plan.length === 0) {
      toast('Nothing to change for that option')
      return
    }
    await setAssignedBulk(month, plan)
    toast(`${QUICK_BUDGET_LABELS[action]} applied to ${plan.length} categor${plan.length === 1 ? 'y' : 'ies'}`)
  }

  if (accounts.length === 0) {
    return (
      <>
        <header className="topbar">
          <h1>Budget</h1>
        </header>
        <div className="content">
          <div className="onboarding card">
            <div className="mark">E</div>
            <h2>Welcome to ENAB</h2>
            <p className="dim" style={{ marginTop: 8 }}>
              Add the account your money actually sits in. Its balance becomes the money you have to
              assign — then you give every dollar a job.
            </p>
            <button className="btn btn-primary btn-lg" style={{ marginTop: 12 }} onClick={() => setAddingAccount(true)}>
              <Icon name="plus" size={17} /> Add your first account
            </button>
          </div>
        </div>
        {addingAccount && <AccountFormModal onClose={() => setAddingAccount(false)} />}
      </>
    )
  }

  return (
    <>
      <header className="topbar">
        <MonthNav />
        <span className="spacer" />
        <button
          className="icon-btn add-txn"
          onClick={() => openTxnModal()}
          title="Add transaction"
          aria-label="Add transaction"
        >
          <Icon name="plus" size={20} strokeWidth={2.2} />
        </button>
        <MenuButton
          label={
            <>
              <Icon name="target" size={15} /> Auto-Assign
            </>
          }
          align="end"
        >
          {(close) => (
            <>
              <button onClick={() => navigate('/plan')}>
                <Icon name="target" size={15} /> Plan from my history…
              </button>
              <div className="menu-sep" />
              <div className="menu-label">Assign to every category</div>
              {QUICK_ACTIONS.map((action) => (
                <button
                  key={action}
                  onClick={() => {
                    runQuickBudget(action)
                    close()
                  }}
                >
                  {QUICK_BUDGET_LABELS[action]}
                </button>
              ))}
            </>
          )}
        </MenuButton>
        <MenuButton label={<Icon name="more" size={18} />} className="icon-btn" align="end" title="Budget options">
          {(close) => (
            <>
              <button
                onClick={() => {
                  setAddingGroup(true)
                  close()
                }}
              >
                <Icon name="folderPlus" size={16} /> New category group
              </button>
              <button
                onClick={() => {
                  setMoving({})
                  close()
                }}
              >
                <Icon name="transfer" size={16} /> Move money
              </button>
              <div className="menu-sep" />
              <button
                onClick={() => {
                  setShowHidden((v) => !v)
                  close()
                }}
              >
                <Icon name={showHidden ? 'eyeOff' : 'eye'} size={16} />
                {showHidden ? 'Hide hidden categories' : 'Show hidden categories'}
              </button>
              <button
                onClick={() => {
                  const anyOpen = tree.some((t) => !t.group.collapsed)
                  tree.forEach((t) => updateCategoryGroup(t.group.id, { collapsed: anyOpen }))
                  close()
                }}
              >
                <Icon name="chevronUp" size={16} /> Collapse / expand all
              </button>
            </>
          )}
        </MenuButton>
      </header>

      <div className="content">
        <ReadyToAssignCard onMove={(opts) => setMoving(opts)} onAutoAssign={() => runQuickBudget('underfunded')} />

        <div className="budget-table">
          <div className="budget-head">
            <span>Category</span>
            <span>Assigned</span>
            <span className="col-activity">Activity</span>
            <span>Available</span>
          </div>

          {tree.map(({ group, items }) => (
            <GroupCard
              key={group.id}
              group={group}
              items={items}
              states={states}
              onOpenCategory={openDetail}
              onAddCategory={() => setAddingCategoryTo(group.id)}
              onMoveFrom={(id, amount) => setMoving({ from: id, amount })}
            />
          ))}

          <button className="btn btn-block" style={{ marginTop: 4 }} onClick={() => setAddingGroup(true)}>
            <Icon name="plus" size={16} /> Add category group
          </button>

          {summary && (
            <div className="card card-pad" style={{ marginTop: 14, fontSize: 13.5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                <span className="dim">Assigned in {monthLabel(month, { withYear: false })}</span>
                <span className="num">{money(summary.assigned)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                <span className="dim">Activity</span>
                <span className="num">{money(summary.activity)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                <span className="dim">Total available</span>
                <span className="num">{money(summary.totalAvailable)}</span>
              </div>
            </div>
          )}

          <AppFooter />
        </div>
      </div>

      {addingGroup && (
        <NamePrompt
          title="New category group"
          placeholder="e.g. Subscriptions"
          onSubmit={async (name) => {
            await createCategoryGroup(name)
            setAddingGroup(false)
            toast('Group added')
          }}
          onClose={() => setAddingGroup(false)}
        />
      )}
      {addingCategoryTo && (
        <NamePrompt
          title="New category"
          placeholder="e.g. Streaming"
          onSubmit={async (name) => {
            await createCategory(addingCategoryTo, name)
            setAddingCategoryTo(null)
            toast('Category added')
          }}
          onClose={() => setAddingCategoryTo(null)}
        />
      )}
      {moving && (
        <MoveMoneyModal
          fromCategoryId={moving.from}
          toCategoryId={moving.to}
          suggestedAmount={moving.amount ?? 0}
          onClose={() => setMoving(null)}
        />
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

function ReadyToAssignCard({
  onMove,
  onAutoAssign,
}: {
  onMove: (opts: { from?: Id | null; to?: Id | null }) => void
  onAutoAssign: () => void
}) {
  const { budget, money } = useData()
  const month = useUi((s) => s.month)
  const [expanded, setExpanded] = useState(false)
  const summary = budget.summaries.get(month)
  if (!summary) return null

  const rta = summary.readyToAssign
  const tone = rta > 0 ? '' : rta === 0 ? ' zero' : ' over'
  const assignedAfter = budget.assignedAfter.get(month) ?? 0

  return (
    <>
      <div className={`rta-wrap${expanded ? ' open' : ''}`}>
        <button className={`rta${tone}`} onClick={() => setExpanded((v) => !v)}>
          <div>
            <div className="rta-amount">{money(rta)}</div>
            <div className="rta-label">
              {rta > 0 ? 'Ready to Assign' : rta === 0 ? 'All money assigned' : 'You assigned more than you have'}
            </div>
          </div>
          <span className="rta-chev">
            <Icon name={expanded ? 'chevronUp' : 'chevronDown'} />
          </span>
        </button>
      </div>

      {expanded && (
        <div className="rta-detail">
          <div className="line">
            <span className="dim">Left over from last month</span>
            <span className="num">{money(summary.leftOverFromLastMonth)}</span>
          </div>
          <div className="line">
            <span className="dim">Income this month</span>
            <span className="num">{money(summary.income)}</span>
          </div>
          {summary.cashOverspendingLastMonth > 0 && (
            <div className="line">
              <span className="dim">Overspending last month</span>
              <span className="num neg">{money(-summary.cashOverspendingLastMonth)}</span>
            </div>
          )}
          <div className="line">
            <span className="dim">Assigned this month</span>
            <span className="num">{money(-summary.assigned)}</span>
          </div>
          <div className="line total">
            <span>Ready to Assign</span>
            <span className={`num ${rta < 0 ? 'neg' : ''}`}>{money(rta)}</span>
          </div>
          {assignedAfter > 0 && (
            <div className="line">
              <span className="faint">Also assigned to future months</span>
              <span className="num faint">{money(assignedAfter)}</span>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button className="btn btn-sm btn-primary" onClick={onAutoAssign}>
              <Icon name="target" size={14} /> Assign underfunded
            </button>
            <button className="btn btn-sm" onClick={() => onMove({ from: null })}>
              Move money out
            </button>
            {rta < 0 && (
              <button className="btn btn-sm" onClick={() => onMove({ to: null })}>
                Pull money back
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */

function GroupCard({
  group,
  items,
  states,
  onOpenCategory,
  onAddCategory,
  onMoveFrom,
}: {
  group: CategoryGroup
  items: Category[]
  states: Map<Id, CategoryMonthState> | undefined
  onOpenCategory: (id: Id) => void
  onAddCategory: () => void
  onMoveFrom: (id: Id, amount: Cents) => void
}) {
  const { money } = useData()
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const totals = items.reduce(
    (acc, c) => {
      const s = states?.get(c.id)
      if (s) {
        acc.assigned += s.assigned
        acc.activity += s.activity
        acc.available += s.available
      }
      return acc
    },
    { assigned: 0, activity: 0, available: 0 },
  )

  return (
    <section className="group-card">
      <div className={`group-row${group.collapsed ? ' collapsed' : ''}`}>
        <div className="group-head-cell">
        <button
          className="group-name"
          onClick={() => updateCategoryGroup(group.id, { collapsed: !group.collapsed })}
          aria-expanded={!group.collapsed}
        >
          <span className="chev">
            <Icon name="chevronDown" size={16} />
          </span>
          <span className="truncate">{group.name}</span>
          {group.hidden && <span className="pill" style={{ fontSize: 10 }}>hidden</span>}
          {group.isSystem && (
            <span className="pill" style={{ fontSize: 10 }}>
              auto
            </span>
          )}
        </button>
        {!group.isSystem && (
          <MenuButton
            label={<Icon name="more" size={16} />}
            className="icon-btn group-menu"
            align="start"
            title={`${group.name} options`}
          >
            {(close) => (
              <>
                <button
                  onClick={() => {
                    onAddCategory()
                    close()
                  }}
                >
                  <Icon name="plus" size={15} /> Add category
                </button>
                <button
                  onClick={() => {
                    setRenaming(true)
                    close()
                  }}
                >
                  <Icon name="edit" size={15} /> Rename group
                </button>
                <button
                  onClick={() => {
                    updateCategoryGroup(group.id, { hidden: !group.hidden })
                    toast(group.hidden ? `${group.name} shown` : `${group.name} hidden`)
                    close()
                  }}
                >
                  <Icon name={group.hidden ? 'eye' : 'eyeOff'} size={15} />
                  {group.hidden ? 'Unhide group' : 'Hide group'}
                </button>
                <div className="menu-sep" />
                <button
                  className="danger"
                  onClick={() => {
                    setConfirmDelete(true)
                    close()
                  }}
                >
                  <Icon name="trash" size={15} /> Delete group
                </button>
              </>
            )}
          </MenuButton>
        )}
        </div>
        <span className="num">{money(totals.assigned)}</span>
        <span className="num col-activity">{money(totals.activity)}</span>
        <span className="num">{money(totals.available)}</span>
      </div>

      {!group.collapsed && (
        <>
          {items.map((c) => (
            <CategoryRow
              key={c.id}
              category={c}
              state={states?.get(c.id)}
              onOpen={() => onOpenCategory(c.id)}
              onMoveFrom={onMoveFrom}
            />
          ))}
          {!group.isSystem && (
            <button
              className="btn btn-ghost btn-sm"
              style={{ width: '100%', justifyContent: 'flex-start', padding: '9px 12px', borderRadius: 0 }}
              onClick={onAddCategory}
            >
              <Icon name="plus" size={15} /> Add category
            </button>
          )}
        </>
      )}

      {renaming && (
        <NamePrompt
          title="Rename group"
          placeholder={group.name}
          initial={group.name}
          submitLabel="Save"
          onSubmit={async (name) => {
            await updateCategoryGroup(group.id, { name: name.trim() })
            setRenaming(false)
            toast('Group renamed')
          }}
          onClose={() => setRenaming(false)}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${group.name}"?`}
          message={
            items.length > 0
              ? `The ${items.length} categor${items.length === 1 ? 'y' : 'ies'} inside will be hidden rather than deleted, so their history and balances stay intact.`
              : 'This group is empty.'
          }
          onConfirm={async () => {
            await deleteCategoryGroup(group.id)
            setConfirmDelete(false)
            toast('Group deleted')
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */

function CategoryRow({
  category,
  state,
  onOpen,
  onMoveFrom,
}: {
  category: Category
  state: CategoryMonthState | undefined
  onOpen: () => void
  onMoveFrom: (id: Id, amount: Cents) => void
}) {
  const { money } = useData()
  const month = useUi((s) => s.month)
  const [pillAnchor, setPillAnchor] = useState<HTMLElement | null>(null)

  if (!state) return null

  const pillClass =
    state.available < 0
      ? state.cashOverspending > 0
        ? 'overspent-cash'
        : 'overspent-credit'
      : state.goalUnderfunded > 0
        ? ''
        : state.available > 0
          ? 'positive'
          : ''

  const pillStyle =
    state.goalUnderfunded > 0 && state.available >= 0
      ? { background: 'var(--warning-soft)', color: 'var(--warning)' }
      : undefined

  return (
    <div className="cat-row" onClick={onOpen} role="button" tabIndex={-1}>
      <div className="cat-name">
        <div className="cat-text">
          <span className="title truncate">
            {category.name}
            {category.hidden && <span className="dim"> · hidden</span>}
          </span>
          {category.goal && (
            <span className="goal-line">
              <span className={`progress${state.goalUnderfunded === 0 ? ' done' : ' behind'}`}>
                <span style={{ width: `${Math.round(state.goalPercent * 100)}%` }} />
              </span>
              {state.goalUnderfunded > 0 ? `${money(state.goalUnderfunded)} more` : 'Funded'}
            </span>
          )}
        </div>
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        <AmountInput
          className="assign-input"
          aria-label={`Assigned to ${category.name}`}
          value={state.assigned}
          onChange={(v) => setAssigned(month, category.id, v)}
          blankZero
        />
      </div>

      <span className={`cat-num col-activity${state.activity === 0 ? ' dimmed' : ''}`}>
        {money(state.activity)}
      </span>

      <button
        className={`avail-pill ${pillClass}`}
        style={pillStyle}
        onClick={(e) => {
          e.stopPropagation()
          setPillAnchor(e.currentTarget)
        }}
      >
        {money(state.available)}
      </button>

      {pillAnchor && (
        <Popover anchor={pillAnchor} align="end" onClose={() => setPillAnchor(null)}>
          <div className="menu-label">{category.name}</div>
          {state.available > 0 && (
            <button
              onClick={() => {
                onMoveFrom(category.id, state.available)
                setPillAnchor(null)
              }}
            >
              <Icon name="transfer" size={15} /> Move money out
              <span className="amount">{money(state.available)}</span>
            </button>
          )}
          {state.available < 0 && (
            <button
              onClick={() => {
                onMoveFrom(category.id, state.available)
                setPillAnchor(null)
              }}
            >
              <Icon name="alert" size={15} /> Cover overspending
              <span className="amount">{money(-state.available)}</span>
            </button>
          )}
          <button
            onClick={() => {
              onOpen()
              setPillAnchor(null)
            }}
          >
            <Icon name="info" size={15} /> Category details
          </button>
          {state.creditOverspending > 0 && (
            <>
              <div className="menu-sep" />
              <div style={{ padding: '4px 10px 8px', fontSize: 12.5, color: 'var(--warning)' }}>
                {money(state.creditOverspending)} of this was charged to a credit card without funding —
                it rolls forward as debt.
              </div>
            </>
          )}
        </Popover>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */

function NamePrompt({
  title,
  placeholder,
  onSubmit,
  onClose,
  initial = '',
  submitLabel = 'Add',
}: {
  title: string
  placeholder: string
  onSubmit: (name: string) => void | Promise<void>
  onClose: () => void
  initial?: string
  submitLabel?: string
}) {
  const [name, setName] = useState(initial)
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onSubmit(name)} disabled={!name.trim()}>
            {submitLabel}
          </button>
        </>
      }
    >
      <input
        className="input"
        autoFocus
        value={name}
        placeholder={placeholder}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) onSubmit(name)
        }}
      />
    </Modal>
  )
}
