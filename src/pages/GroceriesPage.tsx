import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Icon } from '../components/Icon'
import { NavMenuButton } from '../components/NavMenuButton'
import { MenuButton } from '../components/Menu'
import { Modal } from '../components/Modal'
import { AmountInput, Field } from '../components/Fields'
import { useData } from '../hooks/useData'
import { toast, useUi } from '../state/ui'
import { addGroceryItem, removeGroceryItems, restoreGroceryItems, updateGroceryItem } from '../db/actions'
import { currentMonth, monthLabel } from '../lib/dates'
import { listTotals, parseQuickAdd, usualItems } from '../lib/grocery'
import type { GroceryItem } from '../types'

/**
 * A plain shopping list that knows about the budget: it shows what's left in
 * Groceries next to what the list should cost, and turns the cart into a
 * transaction when you're done.
 */
export default function GroceriesPage() {
  const { groceryItems, categories, budget, money } = useData()
  const openTxnModal = useUi((s) => s.openTxnModal)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<GroceryItem | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const onList = useMemo(() => groceryItems.filter((i) => !i.deleted), [groceryItems])
  const toBuy = useMemo(
    () => onList.filter((i) => !i.checked).sort((a, b) => (a.addedAt < b.addedAt ? -1 : 1)),
    [onList],
  )
  const inCart = useMemo(
    () => onList.filter((i) => i.checked).sort((a, b) => a.name.localeCompare(b.name)),
    [onList],
  )
  const usual = useMemo(() => usualItems(groceryItems), [groceryItems])
  const history = useMemo(() => groceryItems.map((i) => i.name).sort((a, b) => a.localeCompare(b)), [groceryItems])
  const totals = listTotals(onList)

  const groceriesCategory = categories.find((c) => /grocer/i.test(c.name) && !c.hidden && !c.isInflow)

  async function add(e?: FormEvent) {
    e?.preventDefault()
    const parsed = parseQuickAdd(draft)
    if (!parsed) return
    await addGroceryItem(parsed)
    setDraft('')
    inputRef.current?.focus()
  }

  async function clear(items: GroceryItem[], what: string) {
    if (!items.length) return
    const snapshot = items.map((i) => ({ ...i }))
    await removeGroceryItems(items.map((i) => i.id))
    toast(what, { action: { label: 'Undo', run: () => void restoreGroceryItems(snapshot) } })
  }

  function logTrip() {
    openTxnModal({
      categoryId: groceriesCategory?.id,
      amount: totals.cart > 0 ? totals.cart : undefined,
      memo: `${inCart.length} item${inCart.length === 1 ? '' : 's'} from the list`,
    })
  }

  return (
    <>
      <header className="topbar">
        <NavMenuButton />
        <h1>Grocery list</h1>
        <span className="spacer" />
        {onList.length > 0 && (
          <MenuButton label={<Icon name="more" size={18} />} className="icon-btn" align="end" title="List options">
            {(close) => (
              <>
                <button
                  disabled={inCart.length === 0}
                  onClick={() => {
                    void Promise.all(inCart.map((i) => updateGroceryItem(i.id, { checked: false })))
                    close()
                  }}
                >
                  <Icon name="refresh" size={16} /> Take everything out of the cart
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    void clear(onList, 'List cleared')
                    close()
                  }}
                >
                  <Icon name="trash" size={16} /> Clear the whole list
                </button>
              </>
            )}
          </MenuButton>
        )}
      </header>

      <div className="content content-pad">
        <div className="content-narrow groc">
          {groceriesCategory && <BudgetLine categoryId={groceriesCategory.id} name={groceriesCategory.name} estimate={totals.estimate} unpriced={totals.unpriced} budget={budget} />}

          <form className="groc-add" onSubmit={add}>
            <input
              ref={inputRef}
              className="input"
              list="grocery-history"
              placeholder="Add an item — “2 lb chicken $8.99”"
              aria-label="Add an item"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              enterKeyHint="done"
              autoCapitalize="sentences"
            />
            <datalist id="grocery-history">
              {history.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <button className="btn btn-primary" type="submit" disabled={!parseQuickAdd(draft)} aria-label="Add to list">
              <Icon name="plus" size={18} />
            </button>
          </form>

          {usual.length > 0 && (
            <div className="groc-usual" aria-label="Usual items">
              {usual.map((i) => (
                <button key={i.id} className="groc-chip" onClick={() => void addGroceryItem({ name: i.name })}>
                  <Icon name="plus" size={13} strokeWidth={2.4} /> {i.name}
                </button>
              ))}
            </div>
          )}

          {onList.length === 0 ? (
            <div className="card groc-empty">
              <Icon name="cart" size={30} />
              <h3>Your list is empty</h3>
              <p>Type what you need above. Add a price if you know it and the list keeps a running total against your Groceries budget.</p>
            </div>
          ) : (
            <>
              {toBuy.length > 0 && (
                <section className="card groc-list" aria-label="To buy">
                  {toBuy.map((i) => (
                    <ItemRow key={i.id} item={i} onEdit={() => setEditing(i)} />
                  ))}
                </section>
              )}
              {toBuy.length === 0 && (
                <p className="groc-done">
                  <Icon name="check" size={16} strokeWidth={2.6} /> Everything's in the cart
                </p>
              )}

              {inCart.length > 0 && (
                <section className="groc-cart" aria-label="In the cart">
                  <header>
                    <h3>
                      In the cart <span className="n">{inCart.length}</span>
                    </h3>
                    {totals.cart > 0 && <span className="sum">≈ {money(totals.cart)}</span>}
                  </header>
                  <div className="card groc-list">
                    {inCart.map((i) => (
                      <ItemRow key={i.id} item={i} onEdit={() => setEditing(i)} />
                    ))}
                  </div>
                  <div className="groc-cart-actions">
                    <button className="btn btn-primary" onClick={logTrip}>
                      <Icon name="plus" size={15} /> Log this trip
                    </button>
                    <button className="btn" onClick={() => void clear(inCart, `Cleared ${inCart.length} from the cart`)}>
                      Clear cart
                    </button>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>

      {editing && <ItemSheet item={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

function BudgetLine({
  categoryId,
  name,
  estimate,
  unpriced,
  budget,
}: {
  categoryId: string
  name: string
  estimate: number
  unpriced: number
  budget: ReturnType<typeof useData>['budget']
}) {
  const { money } = useData()
  const openDetail = useUi((s) => s.openCategoryDetail)
  const month = currentMonth()
  const available = budget.categoryStates.get(month)?.get(categoryId)?.available ?? 0
  const over = estimate > available
  const pct = available > 0 ? Math.min(100, (estimate / available) * 100) : estimate > 0 ? 100 : 0

  return (
    <button className={`card groc-budget${over ? ' over' : ''}`} onClick={() => openDetail(categoryId)}>
      <div className="row1">
        <span className="label">
          {name} · {monthLabel(month, { withYear: false })}
        </span>
        <span className={`left${available < 0 ? ' neg' : ''}`}>{money(available)} left</span>
      </div>
      <div className="meter" aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
      <div className="row2">
        {estimate > 0 ? (
          <>
            List ≈ {money(estimate)}
            {unpriced > 0 && ` + ${unpriced} unpriced`}
            {over ? ` · about ${money(estimate - available)} over` : ` · ${money(available - estimate)} to spare`}
          </>
        ) : (
          'Add prices to see the list against your budget'
        )}
      </div>
    </button>
  )
}

function ItemRow({ item, onEdit }: { item: GroceryItem; onEdit: () => void }) {
  const { money } = useData()
  return (
    <div className={`groc-row${item.checked ? ' checked' : ''}`}>
      <button
        className="groc-check"
        role="checkbox"
        aria-checked={item.checked}
        aria-label={`${item.name} in cart`}
        onClick={() => void updateGroceryItem(item.id, { checked: !item.checked })}
      >
        <Icon name="check" size={14} strokeWidth={3} />
      </button>
      <button className="groc-body" onClick={onEdit}>
        <span className="name">{item.name}</span>
        {item.quantity && <span className="qty">{item.quantity}</span>}
        <span className="price">{item.price !== null ? money(item.price) : ''}</span>
      </button>
    </div>
  )
}

function ItemSheet({ item, onClose }: { item: GroceryItem; onClose: () => void }) {
  const [name, setName] = useState(item.name)
  const [quantity, setQuantity] = useState(item.quantity)
  const [price, setPrice] = useState(item.price ?? 0)

  async function save() {
    if (!name.trim()) return
    await updateGroceryItem(item.id, { name: name.trim(), quantity: quantity.trim(), price: price > 0 ? price : null })
    onClose()
  }

  async function remove() {
    const snapshot = { ...item }
    await removeGroceryItems([item.id])
    toast(`Removed ${item.name}`, { action: { label: 'Undo', run: () => void restoreGroceryItems([snapshot]) } })
    onClose()
  }

  return (
    <Modal
      title="Edit item"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={remove} aria-label="Remove from list">
            <Icon name="trash" size={16} />
          </button>
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save} disabled={!name.trim()}>
            Save
          </button>
        </>
      }
    >
      <Field label="Item">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Item name" />
      </Field>
      <div className="row">
        <Field label="Quantity">
          <input className="input" value={quantity} placeholder="2, 1 lb…" onChange={(e) => setQuantity(e.target.value)} aria-label="Quantity" />
        </Field>
        <Field label="Price (estimate)">
          <AmountInput value={price} onChange={(v) => setPrice(Math.abs(v))} blankZero placeholder="0.00" aria-label="Item price" />
        </Field>
      </div>
    </Modal>
  )
}
