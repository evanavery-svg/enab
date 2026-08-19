import { APP_VERSION, COPYRIGHT_HOLDER } from '../lib/version'

/** Copyright and build version, shown at the bottom of the app chrome. */
export function AppFooter({ style }: { style?: React.CSSProperties }) {
  return (
    <div className="app-footer" style={style}>
      <span>
        &copy; {new Date().getFullYear()} {COPYRIGHT_HOLDER}
      </span>
      <span aria-hidden="true">&middot;</span>
      <span>v{APP_VERSION}</span>
    </div>
  )
}
