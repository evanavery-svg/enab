import type {
  Account,
  AccountType,
  BudgetEntry,
  Category,
  Cents,
  Id,
  ISODate,
  Transaction,
} from '../../types'

let counter = 0
const nextId = (p: string) => `${p}${++counter}`

export function resetIds() {
  counter = 0
}

export function account(
  name: string,
  type: AccountType = 'checking',
  extra: Partial<Account> = {},
): Account {
  const cls: Account['class'] =
    type === 'creditCard' || type === 'lineOfCredit'
      ? 'credit'
      : type === 'checking' || type === 'savings' || type === 'cash'
        ? 'budget'
        : 'tracking'
  return {
    id: nextId('acct'),
    name,
    type,
    class: cls,
    onBudget: cls !== 'tracking',
    closed: false,
    note: '',
    sortOrder: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    deleted: false,
    ...extra,
  }
}

export function category(name: string, extra: Partial<Category> = {}): Category {
  return {
    id: nextId('cat'),
    groupId: 'group1',
    name,
    sortOrder: 0,
    hidden: false,
    note: '',
    deleted: false,
    ...extra,
  }
}

export function txn(
  accountId: Id,
  date: ISODate,
  amount: Cents,
  extra: Partial<Transaction> = {},
): Transaction {
  return {
    id: nextId('txn'),
    accountId,
    date,
    month: date.slice(0, 7),
    amount,
    payeeId: null,
    categoryId: null,
    memo: '',
    cleared: 'cleared',
    approved: true,
    flag: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    deleted: false,
    ...extra,
  }
}

export function entry(month: string, categoryId: Id, assigned: Cents): BudgetEntry {
  return { id: `${month}:${categoryId}`, month, categoryId, assigned }
}

/** Build both legs of a transfer at once. */
export function transfer(
  fromAccount: Id,
  toAccount: Id,
  date: ISODate,
  amount: Cents,
): [Transaction, Transaction] {
  const outId = nextId('txn')
  const inId = nextId('txn')
  const base = {
    date,
    month: date.slice(0, 7),
    payeeId: null,
    categoryId: null,
    memo: '',
    cleared: 'cleared' as const,
    approved: true,
    flag: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    deleted: false,
  }
  return [
    { ...base, id: outId, accountId: fromAccount, amount: -amount, transferAccountId: toAccount, transferTransactionId: inId },
    { ...base, id: inId, accountId: toAccount, amount, transferAccountId: fromAccount, transferTransactionId: outId },
  ]
}
