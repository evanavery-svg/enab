/**
 * The ENAB mark: three rounded bars — an E with its stem removed, which also
 * reads as a short list of envelopes. The tile takes the app's ink colour and
 * the bars its paper, so it inverts with the theme like every other control.
 */
export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden="true"
      className={className}
      style={{ flex: 'none', display: 'block' }}
    >
      <rect width="64" height="64" rx="15" fill="var(--accent)" />
      <rect x="18" y="17" width="28" height="7" rx="3.5" fill="var(--accent-text)" />
      <rect x="18" y="28.5" width="20" height="7" rx="3.5" fill="var(--accent-text)" />
      <rect x="18" y="40" width="28" height="7" rx="3.5" fill="var(--accent-text)" />
    </svg>
  )
}
