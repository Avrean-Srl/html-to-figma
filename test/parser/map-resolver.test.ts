import { describe, expect, it } from 'vitest'

import { isGoogleMapsUrl } from '../../src/parser/map-resolver'

describe('isGoogleMapsUrl', () => {
  it('recognises maps.google.com URLs', () => {
    expect(
      isGoogleMapsUrl('https://maps.google.com/maps?q=Roma&z=15&output=embed')
    ).toBe(true)
  })

  it('recognises google.com/maps/embed URLs', () => {
    expect(
      isGoogleMapsUrl('https://www.google.com/maps/embed?pb=!1m18!1m12!')
    ).toBe(true)
  })

  it('does not match unrelated URLs', () => {
    expect(isGoogleMapsUrl('https://example.com/photo.jpg')).toBe(false)
    expect(isGoogleMapsUrl('')).toBe(false)
    expect(isGoogleMapsUrl('https://youtube.com/watch')).toBe(false)
  })
})
