// Pure grouping logic for the "group pages into sections" import option.
// Kept Figma-free so it is unit-testable; main.ts applies the resulting
// plan to real SectionNodes.

// The label that becomes the section name. Files are grouped by the TENS
// digit of their numeric filename prefix, so 00/01 -> "0", 10..15 -> "1",
// 20..29 -> "2", etc. Files without a numeric prefix fall into "Other".
export function sectionGroupKey(name: string): string {
  const base = name.split('/').pop() ?? name
  const m = base.match(/^(\d+)/)
  if (!m) return 'Other'
  return String(Math.floor(parseInt(m[1], 10) / 10))
}

// Numeric filename prefix used to order pages within (and across) groups.
// Non-numeric names sort to the end.
export function pagePrefix(name: string): number {
  const base = name.split('/').pop() ?? name
  const m = base.match(/^(\d+)/)
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER
}

// Buckets items by section key and returns the groups in display order:
// numeric groups ascending, "Other" last, pages sorted by prefix inside.
export function planSections<T extends { name: string }>(
  items: ReadonlyArray<T>
): Array<{ key: string; items: T[] }> {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = sectionGroupKey(item.name)
    const arr = groups.get(key)
    if (arr) arr.push(item)
    else groups.set(key, [item])
  }

  const keys = Array.from(groups.keys()).sort((a, b) => {
    if (a === 'Other') return 1
    if (b === 'Other') return -1
    return Number(a) - Number(b)
  })

  return keys.map((key) => {
    const groupItems = groups.get(key) as T[]
    groupItems.sort((p, q) => pagePrefix(p.name) - pagePrefix(q.name))
    return { key, items: groupItems }
  })
}
