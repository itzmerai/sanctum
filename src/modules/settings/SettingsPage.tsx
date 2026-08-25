/**
 * Settings (U21: R36, R37, R38, R39).
 *
 * The screen where U5's rotation and U6's backup finally get controls. Five
 * tabs, matching the reference: Account, Appearance, Security, Data, About.
 */
import { useState } from 'react'

import { Icon, type IconName } from '../../components/Icon'
import { AboutTab } from './AboutTab'
import { AccountTab } from './AccountTab'
import { AppearanceTab } from './AppearanceTab'
import { DataTab } from './DataTab'
import { SecurityTab } from './SecurityTab'
import './settings.css'

type Tab = 'account' | 'appearance' | 'security' | 'data' | 'about'

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'account', label: 'Account', icon: 'settings' },
  { id: 'appearance', label: 'Appearance', icon: 'sun' },
  { id: 'security', label: 'Security', icon: 'shield' },
  { id: 'data', label: 'Data', icon: 'folder' },
  { id: 'about', label: 'About', icon: 'history' },
]

export function SettingsPage() {
  const [tab, setTab] = useState<Tab>('account')

  return (
    <div data-testid="route-settings">
      <header className="page__head">
        <h1 className="page__title">Settings</h1>
        <p className="page__sub">
          Manage account, appearance, security, backup, and reset options.
        </p>
      </header>

      <div className="settings">
        <nav className="settings__tabs" aria-label="Settings sections">
          {TABS.map((item) => (
            <button
              key={item.id}
              className="settings__tab"
              data-on={tab === item.id}
              onClick={() => setTab(item.id)}
              aria-current={tab === item.id}
            >
              <Icon name={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>

        <div className="settings__panel">
          {tab === 'account' && <AccountTab />}
          {tab === 'appearance' && <AppearanceTab />}
          {tab === 'security' && <SecurityTab />}
          {tab === 'data' && <DataTab />}
          {tab === 'about' && <AboutTab />}
        </div>
      </div>
    </div>
  )
}
