const SIZE = 3 // a 3×3 mini matrix, echoing the grids

interface LoadingIndicatorProps {
  size?: 'small' | 'large'
  label?: string // shown next to the indicator and announced to screen readers
}

// Squares light up in a diagonal wave. Static under prefers-reduced-motion.
export function LoadingIndicator({ size = 'small', label }: LoadingIndicatorProps) {
  const squares = Array.from({ length: SIZE * SIZE }, (_, index) => {
    const diagonal = Math.floor(index / SIZE) + (index % SIZE)
    return <span key={index} style={{ animationDelay: `${diagonal * 120}ms` }} />
  })

  return (
    <span className={`loading-indicator is-${size}`} role="status">
      <span className="loading-matrix" aria-hidden>
        {squares}
      </span>
      {label && <span className="loading-label">{label}</span>}
    </span>
  )
}
