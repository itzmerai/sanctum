/**
 * The module views the site shows (U4: R6, R7).
 *
 * Sample data is invented client work, never anything from the seeder or a
 * real vault. Every secret-shaped value renders masked, exactly as the app
 * masks it - a marketing page displaying a plausible production key teaches
 * the wrong habit to the audience least able to afford it.
 */
import { Icon } from '@app/components/Icon'
import { tintFor } from '@app/lib/tints'

import { AppFrame } from './AppFrame'

const MASK = '•'.repeat(10)

/** The letter tile beside an entry, tinted the way the app tints it. */
function Tile({ name }: { name: string }) {
  return (
    <span className="rep__tile" style={{ background: tintFor(name) }}>
      {name.trim().charAt(0).toUpperCase()}
    </span>
  )
}

const CREDENTIALS = [
  ['AWS Production Console', 'dev-admin@codeforge.io'],
  ['DigitalOcean VPC Infrastructure', 'root@digitalocean.com'],
  ['Stripe Developer Dashboard', 'billing@codeforge.io'],
]

export function DashboardReplica() {
  return (
    <AppFrame active="Dashboard">
      <div className="dash">
        <div className="dash__main">
          <h2 className="rep__greeting">Good evening, there.</h2>
          <p className="rep__sub">Here&rsquo;s everything across your Life OS.</p>

          <div className="rep__stats">
            {[
              ['key', 'Credentials', '24'],
              ['note', 'Env files', '9'],
              ['task', 'Tasks', '6'],
            ].map(([icon, label, value]) => (
              <div className="rep__stat" key={label}>
                <span className="rep__statLabel">
                  <Icon name={icon as 'key'} size={13} />
                  {label}
                </span>
                <span className="rep__statValue">{value}</span>
              </div>
            ))}
          </div>

          <div className="rep__callout">
            <span className="rep__dot rep__dot--warn" />
            2 tasks overdue
            <span className="rep__link">View tasks &rarr;</span>
          </div>

          <section className="rep__card">
            <header className="rep__cardHead">
              <span className="rep__cardTitle">
                <Icon name="income" size={14} />
                Income Activity
              </span>
              <span className="rep__pill">
                <span className="rep__dot rep__dot--ok" />
                Active
              </span>
            </header>
            <div className="rep__cardBody">
              <div className="rep__miniStats">
                <div className="rep__mini">
                  <span className="rep__statLabel">This month</span>
                  <span className="rep__miniValue">PHP 160,500.00</span>
                </div>
                <div className="rep__mini">
                  <span className="rep__statLabel">All time</span>
                  <span className="rep__miniValue">PHP 1,560,500.00</span>
                </div>
              </div>
              <svg className="rep__chart" viewBox="0 0 300 70" preserveAspectRatio="none">
                <polyline
                  points="0,52 50,26 100,32 150,20 200,34 250,14 300,40"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                />
              </svg>
              <div className="rep__months">
                {['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug'].map((month) => (
                  <span key={month}>{month}</span>
                ))}
              </div>
            </div>
          </section>

          <section className="rep__card">
            <header className="rep__cardHead">
              <span className="rep__cardTitle">Recent Credentials</span>
              <span className="rep__link">View all</span>
            </header>
            {CREDENTIALS.slice(0, 2).map(([name, account]) => (
              <div className="rep__row" key={name}>
                <Tile name={name!} />
                <span>
                  <span className="rep__name">{name}</span>
                  <span className="rep__meta">{account}</span>
                </span>
                <Icon name="copy" size={14} />
              </div>
            ))}
          </section>
        </div>

        <div className="dash__rail">
          <section className="rep__card">
            <header className="rep__cardHead">
              <span className="rep__cardTitle">
                <Icon name="clock" size={14} />
                World Clocks
              </span>
              <span className="rep__pill">
                <span className="rep__dot rep__dot--ok" />
                Live
              </span>
            </header>
            {[
              ['Manila', '09:59 PM', true],
              ['Sydney', '11:59 PM', false],
              ['Los Angeles', '06:59 AM', false],
            ].map(([city, time, local]) => (
              <div className="rep__clock" key={String(city)}>
                <span className="rep__name">
                  {city}
                  {local && <span className="rep__badge">Local</span>}
                </span>
                <span className="rep__time">{time}</span>
              </div>
            ))}
          </section>

          <section className="rep__card">
            <header className="rep__cardHead">
              <span className="rep__cardTitle">
                <Icon name="task" size={14} />
                Upcoming Tasks
              </span>
              <span className="rep__link">View all</span>
            </header>
            {[
              ['Refactor PostgreSQL query planner', 'Aug 22', 'high'],
              ['Migrate staging to managed Postgres', 'Aug 27', 'med'],
              ['Optimise Next.js LCP & image compression', 'Aug 31', 'med'],
            ].map(([task, due, priority]) => (
              <div className="rep__task" key={String(task)}>
                <span className={`rep__dot rep__dot--${priority}`} />
                <span className="rep__taskName">{task}</span>
                <span className="rep__due">{due}</span>
              </div>
            ))}
          </section>

          <section className="rep__card">
            <header className="rep__cardHead">
              <span className="rep__cardTitle">
                <Icon name="shield" size={14} />
                Vault Protection
              </span>
              <span className="rep__pill">Action needed</span>
            </header>
            <div className="rep__cardBody">
              <p className="rep__score">2/3</p>
              <p className="rep__scoreLabel">checks ready</p>
              <div className="rep__bar">
                <span style={{ width: '66%' }} />
              </div>
              {[
                ['Backup', 'No backup taken yet', 'warn'],
                ['Auto-lock', 'Locks after 5 mins', 'ok'],
                ['Recovery', 'Code is ready', 'ok'],
              ].map(([label, status, state]) => (
                <div className="rep__check" key={String(label)}>
                  <span className={`rep__dot rep__dot--${state}`} />
                  <span>{label}</span>
                  <span className="rep__meta">{status}</span>
                </div>
              ))}
              <span className="rep__button">Create Backup</span>
            </div>
          </section>
        </div>
      </div>
    </AppFrame>
  )
}

export function VaultReplica() {
  return (
    <AppFrame active="Vault" compact>
      <h2 className="rep__title">Vault</h2>
      <p className="rep__sub">
        You have 24 credentials. Saved logins stay encrypted and organised in this local vault.
      </p>

      <div className="rep__toolbar">
        <span className="rep__field">
          <Icon name="search" size={13} />
          Search vault
        </span>
        <span className="rep__select">All tags</span>
        <span className="rep__add">
          <Icon name="plus" size={14} />
        </span>
      </div>

      <div className="rep__card">
        {CREDENTIALS.map(([name, account]) => (
          <div className="rep__row rep__row--vault" key={name}>
            <Tile name={name!} />
            <span>
              <span className="rep__name">{name}</span>
              <span className="rep__meta">{account}</span>
            </span>
            <span className="rep__masked">{MASK}</span>
            <span className="rep__actions">
              <Icon name="eye" size={14} />
              <Icon name="copy" size={14} />
              <Icon name="star" size={14} />
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
      <p className="rep__sub">9 files across 4 projects, stored byte for byte.</p>

      <div className="rep__toolbar">
        <span className="rep__field">
          <Icon name="search" size={13} />
          Search env files
        </span>
        <span className="rep__select">All environments</span>
        <span className="rep__add">
          <Icon name="plus" size={14} />
        </span>
      </div>

      <div className="rep__card">
        {[
          ['Acme Storefront', 'production', '14 keys'],
          ['Acme Storefront', 'staging', '14 keys'],
          ['Globex API', 'local', '8 keys'],
        ].map(([project, environment, keys], index) => (
          <div className="rep__row" key={index}>
            <Tile name={project!} />
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
