import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { toast } from '../state/ui'
import { updateSettings } from '../db/actions'
import {
  canPromptInstall,
  detectPlatform,
  isIosNonSafari,
  promptInstall,
  subscribeToInstallability,
  type Platform,
} from '../lib/install'

const STEPS: Record<Exclude<Platform, 'desktop'>, { icon: string; text: string }[]> = {
  ios: [
    { icon: 'Share', text: 'Tap the Share button — the square with an arrow coming out of it.' },
    { icon: 'Add', text: 'Scroll down the list and tap **Add to Home Screen**.' },
    { icon: 'Done', text: 'Tap **Add** in the top corner. ENAB appears on your Home Screen.' },
  ],
  android: [
    { icon: 'Menu', text: 'Tap the **⋮** menu button in the top corner.' },
    { icon: 'Add', text: 'Tap **Install app**, or **Add to Home screen** if you see that instead.' },
    { icon: 'Done', text: 'Confirm with **Install**. ENAB appears with your other apps.' },
  ],
}

/** Renders `**bold**` segments without pulling in a markdown parser. */
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*)/).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  )
}

export function InstallGuide({ onClose }: { onClose: () => void }) {
  const detected = detectPlatform()
  const [platform, setPlatform] = useState<Exclude<Platform, 'desktop'>>(
    detected === 'desktop' ? 'ios' : detected,
  )
  const [installable, setInstallable] = useState(canPromptInstall())
  const [copied, setCopied] = useState(false)

  useEffect(() => subscribeToInstallability(() => setInstallable(canPromptInstall())), [])

  async function dismiss() {
    // Remembered so the guide only interrupts once; Settings can reopen it.
    await updateSettings({ installGuideSeenAt: new Date().toISOString() })
    onClose()
  }

  async function install() {
    const outcome = await promptInstall()
    if (outcome === 'accepted') {
      toast('ENAB installed')
      await dismiss()
    } else if (outcome === 'unavailable') {
      toast('Your browser did not offer an install button — follow the steps instead')
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast('Could not copy — select the address bar and copy it manually', { tone: 'danger' })
    }
  }

  return (
    <Modal
      title="Put ENAB on your phone"
      onClose={dismiss}
      footer={
        <>
          {installable && (
            <button className="btn btn-primary" onClick={install}>
              <Icon name="download" size={16} /> Install now
            </button>
          )}
          <span className="spacer" />
          <button className={installable ? 'btn' : 'btn btn-primary'} onClick={dismiss}>
            {installable ? 'Maybe later' : 'Got it'}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 14.5, marginBottom: 16 }}>
        ENAB is designed to live on your Home Screen. Installed, it opens full screen with its own icon and
        works with no connection — your budget is stored on the phone itself.
      </p>

      {detected === 'desktop' && (
        <div className="install-link">
          <div className="k">Open this address on your phone</div>
          <div className="install-url truncate">{window.location.href}</div>
          <button className="btn btn-sm" onClick={copyLink}>
            <Icon name={copied ? 'check' : 'copy'} size={14} />
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}

      {detected === 'desktop' && (
        <div className="segmented" style={{ marginBottom: 16 }}>
          <button aria-pressed={platform === 'ios'} onClick={() => setPlatform('ios')}>
            iPhone or iPad
          </button>
          <button aria-pressed={platform === 'android'} onClick={() => setPlatform('android')}>
            Android
          </button>
        </div>
      )}

      {isIosNonSafari() && (
        <div className="pill pill-warning" style={{ marginBottom: 14, whiteSpace: 'normal', textAlign: 'left' }}>
          <Icon name="info" size={14} />
          Open this page in Safari first — other iPhone browsers can't always add to the Home Screen.
        </div>
      )}

      <ol className="install-steps">
        {STEPS[platform].map((step, i) => (
          <li key={step.icon}>
            <span className="n">{i + 1}</span>
            <span className="t">
              <RichText text={step.text} />
            </span>
          </li>
        ))}
      </ol>

      <p className="hint" style={{ marginTop: 14 }}>
        You can reopen these steps any time from Settings.
      </p>
    </Modal>
  )
}
