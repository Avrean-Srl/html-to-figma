import { describe, expect, it } from 'vitest'

import { pagePrefix, planSections, sectionGroupKey } from '../../src/mapper/sections'

describe('sectionGroupKey', () => {
  it('groups by the tens digit of the numeric prefix', () => {
    expect(sectionGroupKey('00-login.html')).toBe('0')
    expect(sectionGroupKey('01-portale-login.html')).toBe('0')
    expect(sectionGroupKey('10-dashboard.html')).toBe('1')
    expect(sectionGroupKey('15-impostazioni.html')).toBe('1')
    expect(sectionGroupKey('29-scadenza-nuova.html')).toBe('2')
    expect(sectionGroupKey('90-portale-notifiche.html')).toBe('9')
  })

  it('ignores a leading path', () => {
    expect(sectionGroupKey('pages/21-area-medicale.html')).toBe('2')
  })

  it('buckets non-numeric names into Other', () => {
    expect(sectionGroupKey('index.html')).toBe('Other')
    expect(sectionGroupKey('about.html')).toBe('Other')
  })
})

describe('pagePrefix', () => {
  it('returns the numeric prefix', () => {
    expect(pagePrefix('10-dashboard.html')).toBe(10)
    expect(pagePrefix('07-x.html')).toBe(7)
  })
  it('sorts non-numeric to the end', () => {
    expect(pagePrefix('index.html')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('planSections', () => {
  it('orders groups ascending, sorts pages within, Other last', () => {
    const items = [
      { name: '11-notifiche.html' },
      { name: '00-login.html' },
      { name: 'index.html' },
      { name: '10-dashboard.html' },
      { name: '01-portale-login.html' },
      { name: '20-scadenziario.html' }
    ]
    const plan = planSections(items)
    expect(plan.map((g) => g.key)).toEqual(['0', '1', '2', 'Other'])
    expect(plan[0].items.map((i) => i.name)).toEqual([
      '00-login.html',
      '01-portale-login.html'
    ])
    expect(plan[1].items.map((i) => i.name)).toEqual([
      '10-dashboard.html',
      '11-notifiche.html'
    ])
    expect(plan[3].items.map((i) => i.name)).toEqual(['index.html'])
  })

  it('handles a single group', () => {
    const plan = planSections([{ name: '40-catalogo.html' }, { name: '41-x.html' }])
    expect(plan).toHaveLength(1)
    expect(plan[0].key).toBe('4')
  })
})
