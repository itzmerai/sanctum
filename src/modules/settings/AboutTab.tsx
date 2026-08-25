/**
 * About (U21).
 *
 * The Argon2id parameters are read from the vault header rather than
 * hardcoded — they were calibrated on this machine (KTD11), so a fixed figure
 * would be a guess about someone else's hardware.
 */
import { useEffect, useState } from 'react'

import { setup, type KdfParams } from '../../lib/ipc'

export function AboutTab() {
  const [params, setParams] = useState<KdfParams | null>(null)

  useEffect(() => {
    void setup
      .kdfParameters()
      .then(setParams)
      .catch(() => setParams(null))
  }, [])

  return (
    <>
      <section className="setrow">
        <div className="setrow__text">
          <h2 className="setrow__title">Sanctum</h2>
          <p className="setrow__hint">
            Version 0.1.0 — a local-first vault. No accounts, no cloud, no telemetry.
          </p>
        </div>
      </section>

      <section className="setrow">
        <div className="setrow__text">
          <h2 className="setrow__title">Encryption</h2>
          <p className="setrow__hint">
            Records are encrypted with AES-256-GCM. Your master password derives a key with
            Argon2id, which unwraps the data key. The data key never leaves the Rust core and is
            dropped from memory when the vault locks.
          </p>
        </div>
      </section>

      <section className="setrow">
        <div className="setrow__text">
          <h2 className="setrow__title">Key derivation</h2>
          <p className="setrow__hint">
            Calibrated on this machine when the vault was created, so a faster computer gets
            stronger settings rather than the same ones.
          </p>
        </div>
        <div className="setrow__control">
          <dl className="about__params">
            <dt className="label">Memory</dt>
            <dd>{params ? `${Math.round(params.m_cost_kib / 1024)} MiB` : '—'}</dd>
            <dt className="label">Passes</dt>
            <dd>{params?.t_cost ?? '—'}</dd>
            <dt className="label">Lanes</dt>
            <dd>{params?.p_cost ?? '—'}</dd>
          </dl>
        </div>
      </section>

      <p className="about__footer">
        root@sanctum:~/vault/ — NO CLOUD. NO BACKDOORS. NO COMPROMISE.
      </p>
    </>
  )
}
