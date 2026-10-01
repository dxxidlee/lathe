import { useEffect } from 'react';
import { ShellLayout } from '../shell/ShellLayout';

/** Placeholder until Milestone 9 builds the scripted generation sequence. */
export function Make() {
  useEffect(() => { document.title = 'Make a tool · Lathe'; }, []);
  return (
    <ShellLayout title="Make a tool">
      <section className="stage stage--planned" aria-label="Make a tool">
        <div className="planned">
          <div className="planned__group">Yours</div>
          <label className="planned__name" htmlFor="make-prompt">Describe a tool you wish existed</label>
          <input id="make-prompt" className="make__input" placeholder="Turn my photo into a halftone poster" disabled />
          <p className="planned__when tabular">Arrives in milestone 9</p>
        </div>
      </section>
      <aside className="inspector" aria-label="Inspector">
        <section className="l-section">
          <h3 className="l-section__title">Inspector</h3>
          <p className="l-note">Inputs, outputs and defaults assemble here as the tool is generated. Defaults you set are chosen by you.</p>
        </section>
      </aside>
    </ShellLayout>
  );
}
