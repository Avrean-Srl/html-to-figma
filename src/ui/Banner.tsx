import { h } from 'preact'

// Brand header. Tailored small SVG instead of an external image so the
// bundle stays slim and the asset is themable. Inspired by the "code
// becomes design" idea: a code-bracket glyph on the left, a brand
// gradient bar, and two filled squares hinting at Figma frames on the
// right.
export function Banner() {
  return (
    <div
      style={{
        background:
          'linear-gradient(135deg, #1e293b 0%, #0f172a 60%, #0c111d 100%)',
        padding: '20px 16px',
        color: 'white',
        display: 'flex',
        alignItems: 'center',
        gap: 14
      }}
    >
      <svg
        width="44"
        height="44"
        viewBox="0 0 44 44"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <rect x="2" y="6" width="18" height="32" rx="3" fill="#f97316" />
        <text
          x="11"
          y="27"
          fill="white"
          fontSize="10"
          fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
          fontWeight="700"
          textAnchor="middle"
        >
          {'</>'}
        </text>
        <path
          d="M22 22 L28 22"
          stroke="white"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
        <path
          d="M26 19 L29 22 L26 25"
          stroke="white"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <rect x="30" y="10" width="12" height="12" rx="2" fill="#0acf83" />
        <rect x="30" y="24" width="12" height="12" rx="2" fill="#a259ff" />
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <div
          style={{
            fontSize: 15,
            fontWeight: 700,
            letterSpacing: '-0.01em',
            lineHeight: '20px'
          }}
        >
          HTML to Figma
        </div>
        <div
          style={{
            fontSize: 11,
            opacity: 0.65,
            lineHeight: '14px'
          }}
        >
          Tailwind / shadcn → native Figma frames
        </div>
      </div>
    </div>
  )
}
