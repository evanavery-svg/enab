/** Short, collision-resistant, sortable-ish ids. */
export function uid(prefix = ''): string {
  const time = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}${time}${rand}`
}
