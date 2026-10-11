import { useMemo, useState } from 'react'
import { Icon } from '../components/Icon'
import { NavMenuButton } from '../components/NavMenuButton'
import { Modal } from '../components/Modal'
import { AmountInput, Field } from '../components/Fields'
import { useData } from '../hooks/useData'
import { toast, useUi } from '../state/ui'
import { deleteSubscription, saveSubscription, setAssigned, setSubscriptionStatus, type SubscriptionInput } from '../db/actions'
import { detectRecurring, type RecurringSeries } from '../budget/analyze'
import { currentMonth, monthLabel, today } from '../lib/dates'
import {
  BILLED_THROUGH,
  CADENCE_SUFFIX,
  KNOWN_SERVICES,
  MONTH_SHORT,
  billingLabel,
  brandOf,
  draftFromSeries,
  isTracked,
  monthlyCost,
  nextCharge,
  savedSoFar,
  totals,
  whenLabel,
  yearlyCost,
} from '../lib/subscriptions'
import type { Cents, Subscription, SubscriptionCadence } from '../types'

type Tab = 'active' | 'cancelled'

export default function SubscriptionsPage() {
  const { subscriptions, accounts, categories, payees, transactions, budget, money } = useData()
  const [tab, setTab] = useState<Tab>('active')
  const [editing, setEditing] = useState<Subscription | 'new' | null>(null)
  const todayIso = today()

  const active = useMemo(() => sortByCost(subscriptions.filter((s) => s.status === 'active')), [subscriptions])
  const cancelled = useMemo(() => sortByCost(subscriptions.filter((s) => s.status === 'cancelled')), [subscriptions])

  // Repeating charges in the bank history that aren't tracked yet.
  const found = useMemo(() => {
    const series = detectRecurring({ accounts, categories, payees, transactions, asOf: todayIso })
    return series.filter((s) => s.isSubscription && !isTracked(s, subscriptions))
  }, [accounts, categories, payees, transactions, subscriptions, todayIso])
  const foundHere = found.filter((s) => (tab === 'active' ? s.active : !s.active))

  async function track(series: RecurringSeries) {
    const draft = draftFromSeries(series)
    await saveSubscription(draft)
    toast(draft.status === 'active' ? `Tracking ${draft.name}` : `${draft.name} added to cancelled`)
  }

  const list = tab === 'active' ? active : cancelled

  return (
    <>
      <header className="topbar">
        <NavMenuButton />
        <h1>Subscriptions</h1>
        <span className="spacer" />
        <button className="btn btn-sm btn-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={15} /> Add
        </button>
      </header>

      <div className="content content-pad">
        <div className="content-narrow subs">
          <div className="segmented subs-tabs" role="tablist">
            <button role="tab" aria-pressed={tab === 'active'} onClick={() => setTab('active')}>
              Active <span className="count">{active.length}</span>
            </button>
            <button role="tab" aria-pressed={tab === 'cancelled'} onClick={() => setTab('cancelled')}>
              Cancelled <span className="count">{cancelled.length}</span>
            </button>
          </div>

          {tab === 'active' ? (
            <>
              {active.length > 0 && <SpendHero subs={active} />}
              {active.length > 0 && <NextUp subs={active} today={todayIso} onOpen={setEditing} />}
              {active.length > 0 && <BudgetTie monthly={totals(active).monthly} budget={budget} />}
            </>
          ) : (
            cancelled.length > 0 && <SavingsHero subs={cancelled} today={todayIso} />
          )}

          {list.length > 0 ? (
            <section className="card subs-list" aria-label={tab === 'active' ? 'Active subscriptions' : 'Cancelled subscriptions'}>
              {list.map((s) => (
                <SubscriptionRow key={s.id} sub={s} today={todayIso} onOpen={() => setEditing(s)} />
              ))}
            </section>
          ) : (
            <div className="card subs-empty">
              <div className="subs-empty-art" aria-hidden="true">
                <span style={{ background: '#e50914' }} />
                <span style={{ background: '#1db954' }} />
                <span style={{ background: '#0070d1' }} />
              </div>
              {tab === 'active' ? (
                <>
                  <h3>Track what you pay for</h3>
                  <p>Add each subscription once and see what they really cost you — every month and every year.</p>
                </>
              ) : (
                <>
                  <h3>Nothing cancelled yet</h3>
                  <p>When you cancel one, mark it here and watch what it saves you add up.</p>
                </>
              )}
              <button className="btn btn-primary" onClick={() => setEditing('new')}>
                <Icon name="plus" size={15} /> Add a subscription
              </button>
            </div>
          )}

          {foundHere.length > 0 && (
            <section className="card subs-found">
              <header>
                <Icon name="search" size={16} />
                <div>
                  <h3>{tab === 'active' ? 'Found in your transactions' : 'Looks like these stopped'}</h3>
                  <p>
                    {tab === 'active'
                      ? 'Charges that repeat for about the same amount. Track any that are subscriptions.'
                      : "Repeating charges that haven't come back — probably cancelled."}
                  </p>
                </div>
              </header>
              {foundHere.slice(0, 8).map((s) => {
                const brand = brandOf(s.payeeName)
                return (
                  <div className="subs-found-row" key={s.id}>
                    <span className="sub-avatar sm" style={{ background: brand.bg, color: brand.fg }}>
                      {brand.initial}
                    </span>
                    <div className="who">
                      <div className="name truncate">{s.payeeName}</div>
                      <div className="meta">
                        {money(s.amount)} · {s.cadence === 'irregular' ? 'repeats' : s.cadence}
                        {!s.active && ` · last ${shortDay(s.lastDate)}`}
                      </div>
                    </div>
                    <button className="btn btn-sm" onClick={() => track(s)}>
                      <Icon name="plus" size={14} /> Track
                    </button>
                  </div>
                )
              })}
            </section>
          )}
        </div>
      </div>

      {editing && (
        <SubscriptionSheet
          sub={editing === 'new' ? null : editing}
          defaultStatus={tab}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

/** "Mar 4" for a date in this year, "Mar 4, 2025" otherwise. */
function shortDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const label = `${MONTH_SHORT[m - 1]} ${d}`
  return String(y) === today().slice(0, 4) ? label : `${label}, ${y}`
}

function sortByCost(subs: Subscription[]): Subscription[] {
  // Most expensive first; unknown prices last, then by name.
  return [...subs].sort((a, b) => (monthlyCost(b) ?? -1) - (monthlyCost(a) ?? -1) || a.name.localeCompare(b.name))
}

/* ------------------------------------------------------------------ */

function SpendHero({ subs }: { subs: Subscription[] }) {
  const { money } = useData()
  const t = totals(subs)
  const tilde = t.approximate ? '~' : ''
  const shares = subs.filter((s) => (yearlyCost(s) ?? 0) > 0)

  return (
    <section className="subs-hero spend" aria-label="What subscriptions cost">
      <div className="k">You spend</div>
      <div className="big">
        {tilde}
        {money(t.monthly)}
        <span className="per">/mo</span>
      </div>
      <div className="line">
        {tilde}
        {money(t.yearly)} a year · {t.priced} subscription{t.priced === 1 ? '' : 's'}
      </div>
      {t.unpriced.length > 0 && (
        <div className="extra">
          +{' '}
          {t.unpriced.length <= 2
            ? t.unpriced.map((s) => s.name).join(' and ')
            : `${t.unpriced.length} without a price`}
        </div>
      )}
      {shares.length > 1 && (
        <div className="share-bar" role="img" aria-label="Each subscription's share of the total">
          {shares.map((s) => {
            const pct = ((yearlyCost(s) ?? 0) / t.yearly) * 100
            return <span key={s.id} title={`${s.name} · ${Math.round(pct)}%`} style={{ flexGrow: pct, background: brandOf(s.name).onDark }} />
          })}
        </div>
      )}
    </section>
  )
}

function SavingsHero({ subs, today: todayIso }: { subs: Subscription[]; today: string }) {
  const { money } = useData()
  const t = totals(subs)
  const tilde = t.approximate ? '~' : ''
  const soFar = subs.reduce((sum, s) => sum + (savedSoFar(s, todayIso) ?? 0), 0)
  return (
    <section className="subs-hero saving" aria-label="What cancelling saved">
      <div className="k">
        <Icon name="check" size={14} strokeWidth={2.6} /> You're saving
      </div>
      <div className="big">
        {tilde}
        {money(t.monthly)}
        <span className="per">/mo</span>
      </div>
      <div className="line">
        {tilde}
        {money(t.yearly)} a year · {subs.length} cancelled
      </div>
      {soFar > 0 && <div className="extra">{money(soFar)} kept since you cancelled</div>}
    </section>
  )
}

function NextUp({ subs, today: todayIso, onOpen }: { subs: Subscription[]; today: string; onOpen: (s: Subscription) => void }) {
  const { money } = useData()
  const upcoming = subs
    .map((s) => ({ s, date: nextCharge(s, todayIso) }))
    .filter((x): x is { s: Subscription; date: string } => !!x.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6)
  if (upcoming.length === 0) return null
  return (
    <section className="next-up" aria-label="Next charges">
      <h3>Next up</h3>
      <div className="next-up-row">
        {upcoming.map(({ s, date }) => {
          const brand = brandOf(s.name)
          const soon = whenLabel(date, todayIso)
          return (
            <button key={s.id} className={`next-chip${/today|tomorrow/.test(soon) ? ' soon' : ''}`} onClick={() => onOpen(s)}>
              <span className="sub-avatar xs" style={{ background: brand.bg, color: brand.fg }}>
                {brand.initial}
              </span>
              <span className="what">
                <span className="name truncate">{s.name}</span>
                <span className="when">{soon}</span>
              </span>
              <span className="amt">{s.amount === null ? '—' : money(s.amount)}</span>
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** The YNAB question: is the money for these already set aside? */
function BudgetTie({ monthly, budget }: { monthly: Cents; budget: ReturnType<typeof useData>['budget'] }) {
  const { categories, money } = useData()
  const openDetail = useUi((s) => s.openCategoryDetail)
  const month = currentMonth()
  const category = categories.find((c) => c.name.trim().toLowerCase() === 'subscriptions' && !c.hidden)
  if (!category || monthly <= 0) return null
  const assigned = budget.categoryStates.get(month)?.get(category.id)?.assigned ?? 0
  const covered = assigned >= monthly

  return (
    <section className={`card subs-tie${covered ? ' ok' : ''}`}>
      <Icon name={covered ? 'check' : 'target'} size={18} />
      <div className="txt">
        <strong>{covered ? 'Covered in your budget' : 'Set the money aside'}</strong>
        <span>
          {money(assigned)} assigned to{' '}
          <button className="linkish" onClick={() => openDetail(category.id)}>
            {category.name}
          </button>{' '}
          in {monthLabel(month, { withYear: false })}
          {covered ? '' : ` · needs ${money(monthly)}`}
        </span>
      </div>
      {!covered && (
        <button
          className="btn btn-sm btn-primary"
          onClick={async () => {
            await setAssigned(month, category.id, monthly)
            toast(`Assigned ${money(monthly)} to ${category.name}`)
          }}
        >
          Assign {money(monthly)}
        </button>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */

function SubscriptionRow({ sub, today: todayIso, onOpen }: { sub: Subscription; today: string; onOpen: () => void }) {
  const { money } = useData()
  const brand = brandOf(sub.name)
  const isCancelled = sub.status === 'cancelled'
  const when = billingLabel(sub)
  const next = !isCancelled ? nextCharge(sub, todayIso) : null
  const soon = next ? whenLabel(next, todayIso) : null
  const tilde = sub.amountIsEstimate ? '~' : ''
  const perMonth = monthlyCost(sub)
  const perYear = yearlyCost(sub)
  const saved = isCancelled ? savedSoFar(sub, todayIso) : null

  const meta: string[] = []
  if (isCancelled && sub.cancelledOn) {
    const [y, m] = sub.cancelledOn.split('-').map(Number)
    meta.push(`Cancelled ${MONTH_SHORT[m - 1]} ${y}`)
  }
  if (when) meta.push(isCancelled ? `was ${when}` : when)
  if (sub.billedThrough) meta.push(sub.billedThrough)

  return (
    <button className={`sub-row${isCancelled ? ' cancelled' : ''}`} onClick={onOpen}>
      <span className="sub-avatar" style={{ background: brand.bg, color: brand.fg }}>
        {brand.initial}
      </span>
      <span className="who">
        <span className="name truncate">{sub.name}</span>
        <span className="meta">
          {meta.join(' · ') || (isCancelled ? 'Cancelled' : 'Tap to add details')}
          {soon && /today|tomorrow|in \d day/.test(soon) && <span className="soon-badge">{soon}</span>}
        </span>
      </span>
      <span className="cost">
        {sub.amount === null ? (
          <>
            <span className="price unknown">No price</span>
            <span className="alt">tap to add</span>
          </>
        ) : isCancelled ? (
          <>
            <span className="price saved">
              +{money(perMonth ?? 0)}
              <span className="per">/mo</span>
            </span>
            <span className="alt">{saved ? `${money(saved)} kept so far` : `${sub.amountIsEstimate ? 'about ' : ''}${money(perYear ?? 0)}/yr`}</span>
          </>
        ) : (
          <>
            <span className="price">
              {tilde}
              {money(sub.amount)}
              <span className="per">{CADENCE_SUFFIX[sub.cadence]}</span>
            </span>
            <span className="alt">
              {sub.cadence === 'monthly' ? `${tilde}${money(perYear ?? 0)}/yr` : `≈ ${money(perMonth ?? 0)}/mo`}
            </span>
          </>
        )}
      </span>
    </button>
  )
}

/* ------------------------------------------------------------------ */

const DAYS = Array.from({ length: 31 }, (_, i) => i + 1)

function SubscriptionSheet({ sub, defaultStatus, onClose }: { sub: Subscription | null; defaultStatus: Tab; onClose: () => void }) {
  const { money } = useData()
  const [name, setName] = useState(sub?.name ?? '')
  const [amount, setAmount] = useState<Cents>(sub?.amount ?? 0)
  const [unknownPrice, setUnknownPrice] = useState(sub ? sub.amount === null : false)
  const [estimate, setEstimate] = useState(sub?.amountIsEstimate ?? false)
  const [cadence, setCadence] = useState<SubscriptionCadence>(sub?.cadence ?? 'monthly')
  const [day, setDay] = useState<number | null>(sub?.billingDay ?? null)
  const [month, setMonth] = useState<number | null>(sub?.billingMonth ?? null)
  const [billedThrough, setBilledThrough] = useState(sub?.billedThrough ?? '')
  const [status, setStatus] = useState<Subscription['status']>(sub?.status ?? defaultStatus)
  const [cancelledOn, setCancelledOn] = useState(sub?.cancelledOn ?? (defaultStatus === 'cancelled' ? '' : today()))

  const brand = brandOf(name || '?')
  const input = (): SubscriptionInput => ({
    name: name.trim(),
    amount: unknownPrice ? null : amount,
    amountIsEstimate: !unknownPrice && estimate,
    cadence,
    billingDay: cadence === 'weekly' ? null : day,
    billingMonth: cadence === 'yearly' ? month : null,
    billedThrough,
    status,
    cancelledOn: status === 'cancelled' ? cancelledOn || undefined : undefined,
    payeeId: sub?.payeeId ?? null,
  })
  const valid = name.trim().length > 0 && (unknownPrice || amount > 0)

  async function save() {
    if (!valid) return
    await saveSubscription(input(), sub?.id)
    toast(sub ? `${name.trim()} saved` : `${name.trim()} added`)
    onClose()
  }

  async function cancelIt() {
    if (!sub) return
    await saveSubscription(input(), sub.id)
    await setSubscriptionStatus(sub.id, 'cancelled')
    const per = monthlyCost(input())
    toast(per ? `Cancelled ${sub.name} — saving ${money(per)}/mo` : `Cancelled ${sub.name}`, {
      action: { label: 'Undo', run: () => void setSubscriptionStatus(sub.id, 'active') },
    })
    onClose()
  }

  async function resubscribe() {
    if (!sub) return
    await saveSubscription({ ...input(), status: 'active', cancelledOn: undefined }, sub.id)
    toast(`${sub.name} is active again`)
    onClose()
  }

  async function remove() {
    if (!sub) return
    await deleteSubscription(sub.id)
    toast(`Removed ${sub.name}`, { action: { label: 'Undo', run: () => void saveSubscription(input(), sub.id) } })
    onClose()
  }

  return (
    <Modal
      title={sub ? 'Edit subscription' : 'Add subscription'}
      onClose={onClose}
      headerExtra={
        <span className="sub-avatar sm" style={{ background: brand.bg, color: brand.fg }} aria-hidden="true">
          {brand.initial}
        </span>
      }
      footer={
        <>
          {sub && (
            <button className="btn btn-ghost" onClick={remove} aria-label="Remove subscription">
              <Icon name="trash" size={16} />
            </button>
          )}
          <span className="spacer" />
          {sub?.status === 'active' && (
            <button className="btn" onClick={cancelIt}>
              Mark cancelled
            </button>
          )}
          {sub?.status === 'cancelled' && (
            <button className="btn" onClick={resubscribe}>
              Resubscribe
            </button>
          )}
          <button className="btn btn-primary" onClick={save} disabled={!valid}>
            {sub ? 'Save' : 'Add'}
          </button>
        </>
      }
    >
      <Field label="Subscription">
        <input
          className="input"
          list="known-services"
          placeholder="Netflix, Spotify, iCloud…"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus={!sub}
        />
        <datalist id="known-services">
          {KNOWN_SERVICES.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Field>

      <div className="segmented" style={{ marginBottom: 14 }}>
        {(['monthly', 'yearly', 'weekly'] as const).map((c) => (
          <button key={c} aria-pressed={cadence === c} onClick={() => setCadence(c)}>
            {c === 'monthly' ? 'Monthly' : c === 'yearly' ? 'Yearly' : 'Weekly'}
          </button>
        ))}
      </div>

      <Field label={`Price ${cadence === 'monthly' ? 'per month' : cadence === 'yearly' ? 'per year' : 'per week'}`}>
        <AmountInput value={amount} onChange={(v) => setAmount(Math.abs(v))} blankZero placeholder="0.00" disabled={unknownPrice} aria-label="Price" />
      </Field>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', margin: '-4px 0 14px' }}>
        <label className="checkbox">
          <input type="checkbox" checked={estimate} disabled={unknownPrice} onChange={(e) => setEstimate(e.target.checked)} />
          About this much
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={unknownPrice} onChange={(e) => setUnknownPrice(e.target.checked)} />
          I don't know the price
        </label>
      </div>

      {cadence !== 'weekly' && (
        <div className="row">
          {cadence === 'yearly' && (
            <Field label="Bills in">
              <select className="select" value={month ?? ''} onChange={(e) => setMonth(e.target.value ? Number(e.target.value) : null)} aria-label="Billing month">
                <option value="">Not sure</option>
                {MONTH_SHORT.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={cadence === 'yearly' ? 'Day' : 'Bills around the'}>
            <select className="select" value={day ?? ''} onChange={(e) => setDay(e.target.value ? Number(e.target.value) : null)} aria-label="Billing day">
              <option value="">Not sure</option>
              {DAYS.map((d) => (
                <option key={d} value={d}>
                  {cadence === 'monthly' && d === 31 ? 'End of month' : d}
                </option>
              ))}
            </select>
          </Field>
        </div>
      )}

      <Field label="Billed through">
        <input
          className="input"
          list="billed-through"
          placeholder="Apple, Google, PayPal…"
          value={billedThrough}
          onChange={(e) => setBilledThrough(e.target.value)}
          aria-label="Billed through"
        />
        <datalist id="billed-through">
          {BILLED_THROUGH.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Field>

      {!sub && (
        <label className="checkbox" style={{ marginBottom: 12 }}>
          <input type="checkbox" checked={status === 'cancelled'} onChange={(e) => setStatus(e.target.checked ? 'cancelled' : 'active')} />
          I've already cancelled this
        </label>
      )}
      {status === 'cancelled' && (
        <Field label="Cancelled on" hint="Optional — with a date, ENAB counts what it has saved you so far.">
          <input className="input" type="date" value={cancelledOn} onChange={(e) => setCancelledOn(e.target.value)} />
        </Field>
      )}
    </Modal>
  )
}
