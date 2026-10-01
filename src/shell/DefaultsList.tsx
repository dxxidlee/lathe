import type { DefaultsManifest } from '../tools/types';

const show = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v));

/** Read-only for now. Milestone 4 makes rows editable, strikes through the maker's value,
    and adds "Reset to maker's defaults" and Fork. */
export function DefaultsList({ defaults }: { defaults: DefaultsManifest }) {
  if (!defaults.length) return null;
  return (
    <section className="l-section defaults" aria-label="Defaults">
      <h3 className="l-section__title">Defaults</h3>
      <p className="l-note">Every default was someone else's decision.</p>
      <dl className="defaults__list">
        {defaults.map(d => (
          <div className="defaults__row" key={d.key}>
            <dt className="defaults__label">{d.label}</dt>
            <dd className="defaults__value tabular">{show(d.value)}{d.unit ? ` ${d.unit}` : ''}</dd>
            <dd className="defaults__who">
              {d.inheritedFrom ? `Inherited from ${d.inheritedFrom}` : `Chosen by ${d.chosenBy}`}
              <span className="defaults__why"> · {d.reason}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
