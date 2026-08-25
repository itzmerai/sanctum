/**
 * Appearance settings (U21: R37).
 *
 * Website icons default to **off**, which differs from the reference
 * screenshot showing it on. R24 and AE12 require a fresh install to make no
 * network request at all, and a default-on privacy toggle would break that on
 * first launch, before anyone could turn it off.
 */
import { useEffect } from 'react'

import { favicon } from '../../lib/ipc'
import { ACCENTS, useAppearance, type Accent, type FontSize } from '../../store/useAppearance'

const SIZES: { id: FontSize; label: string }[] = [
  { id: 'small', label: 'Small' },
  { id: 'medium', label: 'Medium' },
  { id: 'large', label: 'Large' },
]

export function AppearanceTab() {
  const {
    theme,
    setTheme,
    accent,
    setAccent,
    fontSize,
    setFontSize,
    websiteIcons,
    setWebsiteIcons,
  } = useAppearance()

  // The authoritative gate lives in Rust and resets to off on every launch, so
  // the persisted preference is pushed across on mount as well as on change.
  useEffect(() => {
    void favicon.setEnabled(websiteIcons).catch(() => undefined)
  }, [websiteIcons])

  return (
    <>
      <section className="setrow">
        <div className="setrow__text">
          <h2 className="setrow__title">Theme</h2>
        </div>
        <div className="setrow__control setrow__group">
          <button className="segbtn" data-on={theme === 'light'} onClick={() => setTheme('light')}>
            Light
          </button>
          <button className="segbtn" data-on={theme === 'dark'} onClick={() => setTheme('dark')}>
            Dark
          </button>
        </div>
      </section>

      <section className="setrow">
        <div className="setrow__text">
          <h2 className="setrow__title">Accent color</h2>
        </div>
        <div className="setrow__control accent__grid">
          {ACCENTS.map((item) => (
            <button
              key={item.id}
              className="accent__swatch"
              data-on={accent === item.id}
              onClick={() => setAccent(item.id as Accent)}
              aria-pressed={accent === item.id}
            >
              <span className="accent__dot" data-accent={item.id} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="setrow">
        <div className="setrow__text">
          <h2 className="setrow__title">Font size</h2>
        </div>
        <div className="setrow__control setrow__group">
          {SIZES.map((item) => (
            <button
              key={item.id}
              className="segbtn"
              data-on={fontSize === item.id}
              onClick={() => setFontSize(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="setrow">
        <div className="setrow__text">
          <h2 className="setrow__title">Website icons</h2>
          <p className="setrow__hint">
            Fetches site icons from DuckDuckGo. Domains may be sent, but never usernames or
            passwords. Off by default, so a fresh install makes no network request at all.
          </p>
        </div>
        <div className="setrow__control setrow__group">
          <button className="segbtn" data-on={websiteIcons} onClick={() => setWebsiteIcons(true)}>
            On
          </button>
          <button className="segbtn" data-on={!websiteIcons} onClick={() => setWebsiteIcons(false)}>
            Off
          </button>
        </div>
      </section>
    </>
  )
}
