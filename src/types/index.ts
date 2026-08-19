/**
 * ENAB domain model.
 *
 * All monetary amounts are integer **cents**. Outflows are negative, inflows
 * positive. Dates are ISO `YYYY-MM-DD` strings; months are `YYYY-MM` strings.
 */

export type Id = string
/** Integer cents. Negative = outflow. */
export type Cents = number
/** `YYYY-MM-DD` */
export type ISODate = string
/** `YYYY-MM` */
export type MonthKey = string

/* ------------------------------------------------------------------ */
/* Accounts                                                            */
/* ------------------------------------------------------------------ */

/**
 * `budget`   — cash-like, on budget (checking / savings / cash)
 * `credit`   — debt accounts on budget, each owns a payment category
 * `tracking` — off budget (investments, mortgage, other assets/loans)
 */
export type AccountClass = 'budget' | 'credit' | 'tracking'

export type AccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'creditCard'
  | 'lineOfCredit'
  | 'mortgage'
  | 'autoLoan'
  | 'studentLoan'
  | 'personalLoan'
  | 'medicalDebt'
  | 'otherDebt'
  | 'investment'
  | 'asset'
  | 'otherLiability'

export interface Account {
  id: Id
  name: string
  type: AccountType
  /** Derived from `type` at creation, stored so queries stay cheap. */
  class: AccountClass
  onBudget: boolean
  closed: boolean
  note: string
  /** Sort order within the sidebar. */
  sortOrder: number
  /** Last reconciliation date, if ever reconciled. */
  lastReconciledAt?: string
  /** Only set for `credit` accounts: the linked payment category. */
  paymentCategoryId?: Id
  createdAt: string
  deleted: boolean
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

export interface CategoryGroup {
  id: Id
  name: string
  sortOrder: number
  hidden: boolean
  collapsed: boolean
  /** True for the system-owned "Credit Card Payments" group. */
  isSystem?: boolean
  /** True for the hidden internal group holding Ready to Assign. */
  isInternal?: boolean
  deleted: boolean
}

export interface Category {
  id: Id
  groupId: Id
  name: string
  sortOrder: number
  hidden: boolean
  note: string
  /** Set for credit-card payment categories: the account they pay. */
  linkedAccountId?: Id
  /** True only for "Inflow: Ready to Assign". */
  isInflow?: boolean
  goal?: Goal
  deleted: boolean
}

/* ------------------------------------------------------------------ */
/* Targets / goals                                                     */
/* ------------------------------------------------------------------ */

export type GoalType =
  /** Needed for spending — recurring amount per period. */
  | 'need'
  /** Have a balance of X (no deadline). */
  | 'balance'
  /** Have a balance of X by a date. */
  | 'balanceByDate'
  /** Pay off a debt account by a date (or by a monthly amount). */
  | 'debt'

export type GoalCadence = 'weekly' | 'monthly' | 'yearly' | 'custom'

export interface Goal {
  type: GoalType
  /** Target amount in cents (always positive). */
  amount: Cents
  /** For `need`: how often the target repeats. */
  cadence?: GoalCadence
  /** For `custom` cadence: repeat every N `cadenceUnit`s. */
  every?: number
  cadenceUnit?: 'month' | 'year'
  /** For weekly cadence: 0 = Sunday … 6 = Saturday. */
  dayOfWeek?: number
  /**
   * `refill`   — top the category's *available* balance up to `amount`
   * `setAside` — assign `amount` fresh each period regardless of balance
   */
  fundingStyle?: 'refill' | 'setAside'
  /** First month the target applies (`YYYY-MM`). */
  startMonth: MonthKey
  /** Deadline month for balanceByDate / debt / dated need targets. */
  targetMonth?: MonthKey
  /** Snooze the "underfunded" warning through this month. */
  snoozedThrough?: MonthKey
}

/* ------------------------------------------------------------------ */
/* Payees                                                              */
/* ------------------------------------------------------------------ */

export interface Payee {
  id: Id
  name: string
  /** Set when the payee represents the other side of a transfer. */
  transferAccountId?: Id
  /** Remembered category for auto-fill on new transactions. */
  lastCategoryId?: Id
  deleted: boolean
}

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

export type ClearedStatus = 'uncleared' | 'cleared' | 'reconciled'

export type FlagColor = 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'purple' | null

export interface SubTransaction {
  id: Id
  amount: Cents
  categoryId: Id | null
  payeeId?: Id | null
  memo: string
  /** Set when this split leg is a transfer to another account. */
  transferAccountId?: Id | null
  transferTransactionId?: Id | null
}

export interface Transaction {
  id: Id
  accountId: Id
  date: ISODate
  /** Denormalised `YYYY-MM` for fast month queries. */
  month: MonthKey
  amount: Cents
  payeeId: Id | null
  categoryId: Id | null
  memo: string
  cleared: ClearedStatus
  approved: boolean
  flag: FlagColor
  /** The account on the far side, when this is one leg of a transfer. */
  transferAccountId?: Id | null
  /** The sibling transaction id on the far side of a transfer. */
  transferTransactionId?: Id | null
  /** Present (non-empty) when this is a split transaction. */
  subtransactions?: SubTransaction[]
  /** The scheduled transaction that generated this, if any. */
  scheduledId?: Id
  /** Marks the immutable opening-balance transaction of an account. */
  isStartingBalance?: boolean
  createdAt: string
  deleted: boolean
}

/* ------------------------------------------------------------------ */
/* Scheduled transactions                                              */
/* ------------------------------------------------------------------ */

export type Frequency =
  | 'once'
  | 'daily'
  | 'weekly'
  | 'everyOtherWeek'
  | 'twiceAMonth'
  | 'every4Weeks'
  | 'monthly'
  | 'everyOtherMonth'
  | 'every3Months'
  | 'every4Months'
  | 'every6Months'
  | 'yearly'
  | 'everyOtherYear'

export interface ScheduledTransaction {
  id: Id
  accountId: Id
  /** Next date this scheduled transaction will be entered. */
  nextDate: ISODate
  frequency: Frequency
  amount: Cents
  payeeId: Id | null
  categoryId: Id | null
  memo: string
  flag: FlagColor
  transferAccountId?: Id | null
  subtransactions?: SubTransaction[]
  /** Automatically create the transaction when the date arrives. */
  autoEnter: boolean
  paused: boolean
  deleted: boolean
}

/* ------------------------------------------------------------------ */
/* Budget entries (assigned amounts) and month notes                   */
/* ------------------------------------------------------------------ */

export interface BudgetEntry {
  /** `${month}:${categoryId}` */
  id: string
  month: MonthKey
  categoryId: Id
  assigned: Cents
}

export interface MonthNote {
  month: MonthKey
  note: string
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export interface Settings {
  id: 'settings'
  budgetName: string
  currencySymbol: string
  /** ISO 4217 code, used for Intl formatting. */
  currencyCode: string
  /** `before` = $1.00, `after` = 1,00 € */
  symbolPosition: 'before' | 'after'
  decimalSeparator: '.' | ','
  groupSeparator: ',' | '.' | ' ' | ''
  /** Hide the cents portion in most places. */
  hideDecimals: boolean
  dateFormat: 'MM/dd/yyyy' | 'dd/MM/yyyy' | 'yyyy-MM-dd' | 'dd.MM.yyyy'
  /** 0 = Sunday. */
  firstDayOfWeek: number
  theme: 'system' | 'light' | 'dark'
  /** Show the running balance column in account registers. */
  showRunningBalance: boolean
  /** Reconciled transactions are locked from editing. */
  lockReconciled: boolean
  /** Optional numeric PIN gate on app open. */
  pinHash?: string
  /** Set once the "add to Home Screen" guide has been shown. */
  installGuideSeenAt?: string
  createdAt: string
}

/* ------------------------------------------------------------------ */
/* Computed view models                                                */
/* ------------------------------------------------------------------ */

export interface CategoryMonthState {
  categoryId: Id
  month: MonthKey
  /** Balance carried in from last month (never positive-clamped to 0 here). */
  carriedOver: Cents
  assigned: Cents
  /** All activity in the month: cash + credit spending, inflows, refunds. */
  activity: Cents
  available: Cents
  /** Portion of `activity` that was spent on credit cards (positive number). */
  creditSpending: Cents
  /** Overspending that was funded by credit and rolls forward as negative. */
  creditOverspending: Cents
  /** Overspending that hits next month's Ready to Assign (positive number). */
  cashOverspending: Cents
  /** Goal-derived amount still needed this month (0 when met / no goal). */
  goalUnderfunded: Cents
  /** Goal target for this month, 0 when no goal applies. */
  goalTarget: Cents
  /** 0..1 progress toward the goal for this month. */
  goalPercent: number
}

export interface MonthSummary {
  month: MonthKey
  /** Money that arrived this month destined for Ready to Assign. */
  income: Cents
  /** Total assigned across all categories this month. */
  assigned: Cents
  /** Total activity (spending is negative) across budget categories. */
  activity: Cents
  /** Left over from last month's Ready to Assign. */
  leftOverFromLastMonth: Cents
  /** Cash overspending inherited from last month (positive number). */
  cashOverspendingLastMonth: Cents
  /** The headline number. Negative means over-assigned. */
  readyToAssign: Cents
  /** Sum of positive available balances (money sitting in envelopes). */
  totalAvailable: Cents
}
