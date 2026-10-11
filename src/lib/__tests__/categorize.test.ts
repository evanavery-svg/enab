import { describe, expect, it } from 'vitest'
import { guessCategory } from '../categorize'

describe('guessCategory', () => {
  it.each([
    // The strings banks actually write, processor prefixes and all.
    ['WHOLEFDS MKT 10234', 'Groceries'],
    ['TRADER JOE S #123', 'Groceries'],
    ['SQ *BLUE BOTTLE COFFEE', 'Coffee'],
    ['STARBUCKS STORE 12345 SEATTLE WA', 'Coffee'],
    ['TST* TAQUERIA EL SOL', 'Eating Out'],
    ['DOORDASH*CHIPOTLE', 'Eating Out'],
    ['SHELL OIL 57444', 'Transportation'],
    ['UBER *TRIP', 'Transportation'],
    ['NETFLIX.COM', 'Subscriptions'],
    ['APPLE.COM/BILL', 'Subscriptions'],
    ['CITY POWER & LIGHT', 'Electric'],
    ['COMCAST CABLE COMM', 'Internet'],
    ['T-MOBILE *AUTOPAY', 'Phone'],
    ['GEICO *AUTO', 'Insurance'],
    ['CVS/PHARMACY #1234', 'Medical'],
    ['PLANET FITNESS', 'Fitness'],
    ['AMC THEATRES 0455', 'Entertainment'],
    ['OLD NAVY US 1234', 'Clothing'],
    ['THE HOME DEPOT #0123', 'Home Maintenance'],
    ['JIFFY LUBE #2145', 'Auto Maintenance'],
    ['LANDLORD PROPERTIES', 'Rent/Mortgage'],
  ])('%s → %s', (payee, name) => {
    expect(guessCategory(payee, -1000)).toEqual({ name, kind: 'spending' })
  })

  it('reads a paycheck as income, only when money came in', () => {
    expect(guessCategory('ACME CORP DES:PAYROLL', 240000)).toEqual({ name: 'Inflow: Ready to Assign', kind: 'income' })
    expect(guessCategory('ACME CORP DES:PAYROLL', -5000).kind).not.toBe('income')
  })

  it('treats card payments and transfers as neither spending nor income', () => {
    for (const p of ['Payment Thank You-Mobile', 'CAPITAL ONE MOBILE PYMT', 'AUTOPAY PAYMENT - THANK YOU', 'Zelle payment to Jane Doe', 'ONLINE TRANSFER TO SAVINGS']) {
      expect(guessCategory(p, -50000)).toEqual({ name: null, kind: 'transfer' })
    }
  })

  it('leaves ambiguous merchants for the person to decide', () => {
    for (const p of ['AMAZON.COM*2K4', 'TARGET 00012345', 'WAL-MART #1234', 'PAYPAL *SOMESHOP', 'MYSTERY SHOP']) {
      expect(guessCategory(p, -2000)).toEqual({ name: null, kind: 'unknown' })
    }
  })

  it('does not mistake a gym called Water Street for the water bill', () => {
    // Specific rules sit above general ones, so the fitness match wins.
    expect(guessCategory('WATER STREET FITNESS', -5000).name).toBe('Fitness')
  })
})
