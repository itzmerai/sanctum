/**
 * The three module views the site shows (U4: R6, R7).
 *
 * Sample data is invented client work, never anything from the seeder or a
 * real vault. Every secret-shaped value renders masked, exactly as the app
 * masks it - a marketing page displaying a plausible production key teaches
 * the wrong habit to the audience least able to afford it.
 */
import { AppFrame } from './AppFrame'

const MASK = '•'.repeat(10)

export function DashboardReplica() {
  return (
    <AppFrame active="Dashboard">
      <h2 className="rep__title">Good evening.</h2>
      <p className="rep__sub">Everything across your work, on this machine only.</p>

      <div className="rep__stats">
        <div className="rep__stat">
          <span className="rep__statLabel">Credentials</span>
          <span className="rep__statValue">24</span>
        </div>
        <div className="rep__stat">
          <span className="rep__statLabel">Env files</span>
          <span className="rep__statValue">9</span>
        </div>
        <div className="rep__stat">
          <span className="rep__statLabel">Tasks</span>
          <span className="rep__statValue">6</span>
        </div>
      </div>

      <div className="rep__card">
        <div className="rep__row">
          <span className="rep__icon">A</span>
          <span>
            <span className="rep__name">Acme Storefront</span>
            <span className="rep__meta">deploy@acme.example</span>
          </span>
          <span className="rep__masked">{MASK}</span>
        </div>
        <div className="rep__row">
          <span className="rep__icon">G</span>
          <span>
            <span className="rep__name">Globex API</span>
            <span className="rep__meta">ops@globex.example</span>
          </span>
          <span className="rep__masked">{MASK}</span>
        </div>
        <div className="rep__row">
          <span className="rep__icon">I</span>
          <span>
            <span className="rep__name">Initech Staging</span>
            <span className="rep__meta">root@initech.example</span>
          </span>
          <span className="rep__masked">{MASK}</span>
        </div>
      </div>
    </AppFrame>
  )
}

export function VaultReplica() {
  return (
    <AppFrame active="Vault" compact>
      <h2 className="rep__title">Vault</h2>
      <p className="rep__sub">Saved logins stay encrypted and organised in this local vault.</p>

      <div className="rep__card">
        {[
          ['A', 'Acme Storefront', 'deploy@acme.example'],
          ['G', 'Globex API', 'ops@globex.example'],
          ['I', 'Initech Staging', 'root@initech.example'],
        ].map(([initial, name, account]) => (
          <div className="rep__row" key={name}>
            <span className="rep__icon">{initial}</span>
            <span>
              <span className="rep__name">{name}</span>
              <span className="rep__meta">{account}</span>
            </span>
            <span className="rep__actions">
              <span className="rep__masked">{MASK}</span>
            </span>
          </div>
        ))}
      </div>
    </AppFrame>
  )
}

export function EnvReplica() {
  return (
    <AppFrame active="Env Files" compact>
      <h2 className="rep__title">Env Files</h2>
      <p className="rep__sub">One record per project and environment, stored byte for byte.</p>

      <div className="rep__card">
        {[
          ['Acme Storefront', 'production', '14 keys'],
          ['Acme Storefront', 'staging', '14 keys'],
          ['Globex API', 'local', '8 keys'],
        ].map(([project, environment, keys], index) => (
          <div className="rep__row" key={index}>
            <span className="rep__icon">{'▤'}</span>
            <span>
              <span className="rep__name">{project}</span>
              <span className="rep__meta">{keys}</span>
            </span>
            <span className="rep__chip">{environment}</span>
          </div>
        ))}
      </div>
    </AppFrame>
  )
}
