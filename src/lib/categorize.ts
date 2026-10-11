/**
 * A first guess at which envelope a bank transaction belongs in, from the
 * merchant name alone. Used when a file arrives with no categories, so the
 * budget suggestions have something to work from on day one.
 *
 * Guesses map to the *names* of the starter categories, which are then
 * matched against whatever categories this budget actually has. A wrong
 * guess costs more than no guess — ambiguous merchants (Amazon, Target,
 * Walmart) are deliberately left for the person to decide.
 */
import type { Cents } from '../types'

export type GuessKind = 'spending' | 'income' | 'transfer' | 'unknown'

export interface CategoryGuess {
  /** A starter-category name, or null when nothing is confident. */
  name: string | null
  kind: GuessKind
}

/** Processor prefixes banks tack on: `SQ *`, `TST*`, `PP*`, `DD *`. */
const PROCESSOR_PREFIX = /^(?:[a-z]{2,4}\s?\*\s*)+/

function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9&'.\- ]+/g, ' ')
    .replace(PROCESSOR_PREFIX, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Movements between your own accounts, and card payments: not spending. */
const TRANSFER = [
  /payment\s*-?\s*thank you/, /thank you.*payment/, /online payment|internet payment|mobile payment|e-?payment/,
  /\btransfer\b|\bxfer\b/, /\bzelle\b/, /\bvenmo\b/, /cash ?app/, /\bcredit crd\b|\bcrd pmt\b|card pmt|\bpymt\b/,
  /\bepayment\b/, /\batm\b/,
]
/** "Autopay" on its own is a card payment; on a merchant's name it's just how the bill was paid. */
const WEAK_TRANSFER = [/autopay|auto ?pay/]

/** Money coming in that belongs in Ready to Assign. */
const INCOME = [
  /payroll|salary|paycheck|\bwages\b/, /direct ?dep|dir ?dep/, /\bgusto\b|\badp\b|paychex|rippling|workday/,
  /ssa treas|irs treas|tax ref/, /unemployment/, /\bdividend\b/,
]

/** Ordered: the first match wins, so the specific sit above the general. */
const SPENDING: [RegExp, string][] = [
  [/starbucks|dunkin|peet'?s|dutch bros|coffee|caf[eé]\b|espresso|tim hortons|blue bottle|philz/, 'Coffee'],
  [/whole ?foods|trader joe|kroger|safeway|\baldi\b|costco|publix|wegmans|\bh-?e-?b\b|sprouts|food lion|stop & shop|meijer|winco|\blidl\b|albertsons|ralphs|\bvons\b|fred meyer|giant\b|shoprite|wholefds|instacart|grocer|supermarket|\bmarket\b/, 'Groceries'],
  [/restaurant|pizza|taco|burger|grill|sushi|doordash|uber ?eats|grubhub|postmates|chipotle|mcdonald|wendy'?s|chick-?fil|panera|subway|domino|popeyes|\bkfc\b|taqueria|bistro|diner|\bdeli\b|bakery|kitchen|ramen|noodle|thai|pho\b|curry|steakhouse|cantina|brewery|\bpub\b|\bbar\b|tavern|eatery|\bbbq\b|wings/, 'Eating Out'],
  [/\bshell\b|chevron|exxon|\bmobil\b|\bbp\b|\barco\b|\b76\b|sunoco|speedway|valero|marathon|citgo|texaco|\bgas\b|fuel|\buber\b|\blyft\b|parking|\btoll|metro|transit|\bmta\b|\bbart\b|amtrak|septa|\bcta\b|wmata|\bev charg|chargepoint|electrify/, 'Transportation'],
  [/netflix|spotify|hulu|disney|hbo|\bmax\b|apple\.com|apple music|icloud|youtube|prime video|amazon prime|google (one|storage)|adobe|dropbox|patreon|audible|paramount|peacock|crunchyroll|openai|chatgpt|nytimes|substack|\bsubscri/, 'Subscriptions'],
  [/comcast|xfinity|spectrum|\bcox\b|centurylink|frontier|\bfios\b|internet|broadband|starlink|google fiber|optimum|\brcn\b|wow!/, 'Internet'],
  [/verizon|t-?mobile|at&t|\batt\b|sprint|mint mobile|cricket|boost|visible|wireless|\bphone\b|google fi/, 'Phone'],
  [/insurance|geico|progressive|state farm|allstate|\busaa\b|liberty mutual|farmers|nationwide|lemonade|aetna|cigna|anthem|blue cross|kaiser/, 'Insurance'],
  [/pharmacy|\bcvs\b|walgreens|rite aid|clinic|hospital|dental|dentist|\bdoctor|\bmedical|\bhealth|optometr|urgent care|\bmd\b|labcorp|quest diag|physician|therap|chiropract|vision/, 'Medical'],
  [/\bgym\b|fitness|planet fit|la fitness|equinox|peloton|yoga|crossfit|orangetheory|\bymca\b|anytime fit|24 hour fit|strava|climb/, 'Fitness'],
  [/cinema|\bamc\b|regal|theat(er|re)|concert|ticketmaster|stubhub|\bsteam\b|playstation|\bxbox\b|nintendo|fandango|bowling|arcade|museum|\bzoo\b|eventbrite/, 'Entertainment'],
  [/\bnike\b|adidas|\bzara\b|h&m|uniqlo|\bgap\b|old navy|nordstrom|macy|tj ?maxx|\bross\b|marshalls|clothing|apparel|shoes|footwear|lululemon|\bshein\b|asos|levi|banana republic|j\.? ?crew|burlington|dsw\b/, 'Clothing'],
  [/home depot|lowe'?s|ace hardware|hardware|plumb|hvac|handyman|menards|roto-?rooter|pest|lawn|landscap|\bikea\b|wayfair|bed bath|container store|sherwin/, 'Home Maintenance'],
  [/autozone|o'?reilly|advance auto|jiffy lube|oil change|\btire|auto repair|mechanic|car wash|\bdmv\b|pep boys|firestone|midas|valvoline|discount tire|napa auto|\btoyota\b|\bhonda\b|\bford\b/, 'Auto Maintenance'],
  [/\bgift|florist|flowers|hallmark|edible arrange/, 'Gifts'],
  [/hobby|michaels|joann|guitar center|craft|yarn|lego|game ?stop|bookstore|barnes|comic/, 'Hobbies'],
  // Generic words last: they only win when nothing more specific did.
  [/electric|\bpower\b|energy|pg&e|edison|duke|con ?ed|\butilit|\bpse\b|dominion|xcel|ameren|entergy/, 'Electric'],
  [/\bwater\b|sewer|waste|sanitation/, 'Water'],
  [/\brent\b|landlord|mortgage|property|apartments?\b|realty|\bhoa\b|homes\b|rocket mort|wells fargo home|\bescrow/, 'Rent/Mortgage'],
]

export function guessCategory(payee: string, amount: Cents): CategoryGuess {
  const p = normalize(payee)
  if (!p) return { name: null, kind: 'unknown' }

  if (TRANSFER.some((re) => re.test(p))) return { name: null, kind: 'transfer' }
  // Refunds and reimbursements belong with whatever they refund, so the
  // merchant rules run for inflows too; only a paycheck is income.
  if (amount > 0 && INCOME.some((re) => re.test(p))) return { name: 'Inflow: Ready to Assign', kind: 'income' }
  for (const [re, name] of SPENDING) if (re.test(p)) return { name, kind: 'spending' }
  if (WEAK_TRANSFER.some((re) => re.test(p))) return { name: null, kind: 'transfer' }
  return { name: null, kind: 'unknown' }
}
