/* Color-swap markup, from reference/color-swap/index.html. The three-panel app is split for Lathe:
   panels go to the inspector, the viewbar/preview/transport to the stage. The top toolbar became
   the inspector's File section. Inline pixel styles moved to color-swap.css. */
export const INSPECTOR_HTML = `<div class="cs-inspector">
<section class="section" data-sec="file">
        <div class="section-head" role="button" tabindex="0" aria-expanded="true">
          <svg class="caret" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5l3-3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>
          <h2>File</h2>
        </div>
        <div class="section-body">
          <div class="rc-status" role="status" aria-live="polite">
            <div class="status-dot" id="statusDot"></div>
            <div class="status-text" id="statusText">Ready. Upload an image or video to begin.</div>
          </div>
          <div class="row">
            <button class="rc-btn grow" id="btnUpload">Upload</button>
            <button class="rc-btn primary grow" id="btnExport" disabled>Export</button>
            <button class="rc-btn" id="btnReset">Reset</button>
          </div>
        </div>
      </section>
<section class="section" data-sec="presets">
        <div class="section-head" role="button" tabindex="0" aria-expanded="true">
          <svg class="caret" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5l3-3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>
          <h2>Presets</h2>
        </div>
        <div class="section-body">
          <div class="preset-grid" id="presetGrid"></div>
        </div>
      </section>
<section class="section" data-sec="palette">
        <div class="section-head" role="button" tabindex="0" aria-expanded="true">
          <svg class="caret" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5l3-3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>
          <h2>Palette</h2>
          <span class="fps" id="paletteCount">8 colors</span>
        </div>
        <div class="section-body">
          <p class="section-note">Weight sets how much of the frame a color claims. Role decides which part of the tonal range it lands in.</p>
          <div class="swatch-list" id="swatchList"></div>
          <div class="row">
            <button class="rc-btn sm grow" id="btnAddColor">Add color</button>
            <button class="rc-btn sm grow" id="btnResetPalette">Reset palette</button>
          </div>
          <div class="row">
            <button class="rc-btn sm grow" id="btnCopyPalette">Copy hex list</button>
            <button class="rc-btn sm grow" id="btnImportPalette">Import hex</button>
          </div>
        </div>
      </section>

      <section class="section" data-sec="clusters">
        <div class="section-head" role="button" tabindex="0" aria-expanded="true">
          <svg class="caret" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5l3-3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>
          <h2>Detected source colors</h2>
        </div>
        <div class="section-body">
          <p class="section-note" id="clusterNote">Load a video to analyze its color families.</p>
          <div id="clusterList"></div>
          <button class="rc-btn sm" id="btnReanalyze" disabled data-full>Re-run analysis</button>
        </div>
      </section>

      <section class="section" data-sec="mapping">
        <div class="section-head" role="button" tabindex="0" aria-expanded="true">
          <svg class="caret" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5l3-3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>
          <h2>Color mapping</h2>
          <span class="fps" id="ruleCount">0 rules</span>
        </div>
        <div class="section-body">
          <p class="section-note">Rules run before automatic mapping. Sample a source color from the preview, then pick where it should go.</p>
          <div id="ruleList"></div>
          <div class="row">
            <button class="rc-btn sm grow" id="btnAddRule">Add rule</button>
            <button class="rc-btn sm grow" id="btnPickRule">Sample from video</button>
          </div>
        </div>
      </section>

      



      <section class="section" data-sec="settings">
        <div class="section-head" role="button" tabindex="0" aria-expanded="true">
          <svg class="caret" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5l3-3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>
          <h2>Recolor settings</h2>
        </div>
        <div class="section-body">
          <p class="section-note">Double-click any label to reset that value.</p>
          <div id="settingsList"></div>
        </div>
      </section>

      <section class="section" data-sec="protect">
        <div class="section-head" role="button" tabindex="0" aria-expanded="true">
          <svg class="caret" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5l3-3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>
          <h2>Preserved colors</h2>
        </div>
        <div class="section-body">
          <p class="section-note">Sampled colors stay close to their original values.</p>
          <div id="preserveList"></div>
          <button class="rc-btn sm" id="btnPickPreserve" data-full>Sample color to preserve</button>
        </div>
      </section>

<section class="section" data-sec="presetio">
        <div class="section-head" role="button" tabindex="0" aria-expanded="false">
          <svg class="caret" viewBox="0 0 10 10"><path d="M2 3.5L5 6.5l3-3" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>
          <h2>Presets file</h2>
        </div>
        <div class="section-body">
          <div class="row">
            <button class="rc-btn sm grow" id="btnSavePreset">Save .json</button>
            <button class="rc-btn sm grow" id="btnLoadPreset">Load .json</button>
          </div>
          <input type="file" id="presetInput" accept="application/json,.json" class="sr">
        </div>
      </section>
</div>`;

export const STAGE_HTML = `<div class="cs">
<div class="cs-center">
<div class="viewbar">
        <div class="seg" role="group" aria-label="Preview mode">
          <button data-view="original">Original</button>
          <button data-view="recolored" class="on">Recolored</button>
          <button data-view="split">Split</button>
        </div>
        <div class="divider"></div>
        <span class="rc-field-label">Quality</span>
        <select class="input" id="selQuality">
          <option value="draft">Draft</option>
          <option value="standard" selected>Standard</option>
          <option value="high">High</option>
        </select>
        <div class="divider"></div>
        <div class="seg" role="group" aria-label="Preview fit">
          <button data-fit="fit" class="on">Fit</button>
          <button data-fit="fill">Fill</button>
        </div>
        <div class="tb-spacer"></div>
        <span class="fps" id="fpsRead">—</span>
        <div class="divider"></div>
        <span class="fps" id="resRead">—</span>
      </div>

      <div class="cs-stage" id="stage">
        <div class="stage-inner" id="stageInner">
          <canvas id="outCanvas" width="16" height="9" aria-label="Video preview"></canvas>
          <div class="stage-tag l" id="tagL" hidden>ORIGINAL</div>
          <div class="stage-tag r" id="tagR" hidden>RECOLORED</div>
          <div class="split-handle" id="splitHandle" hidden role="slider"
               aria-label="Split position" tabindex="0" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50"></div>
        </div>
        <div class="pick-hint" id="pickHint" hidden>Click a color in the preview</div>
        <div class="drop" id="dropZone">
          <div class="drop-box">
            <div class="drop-title">Drop an image or video here</div>
            <div class="drop-sub">PNG, JPG, WebP, MP4, WebM, MOV — analyzed fresh on each import.</div>
            <button class="rc-btn primary" id="btnUpload2">Choose file</button>
          </div>
          <div class="privacy">
            <svg class="ic" viewBox="0 0 16 16"><path d="M8 2l5 2v4c0 3-2.2 5.4-5 6-2.8-.6-5-3-5-6V4l5-2z"/></svg>
            Processed locally in your browser. Each import starts a fresh analysis.
          </div>
        </div>
      </div>

      <div class="transport">
        <div class="scrub-wrap">
          <span class="time" id="timeCur">0:00.00</span>
          <input type="range" id="scrub" min="0" max="1000" value="0" step="1" aria-label="Timeline" disabled>
          <span class="time" id="timeDur">0:00.00</span>
        </div>
        <div class="transport-btns">
          <button class="rc-btn icon" id="btnPlay" disabled aria-label="Play">
            <svg class="ic solid" viewBox="0 0 16 16" id="icPlay"><path d="M5 3.5l7 4.5-7 4.5z"/></svg>
            <svg class="ic solid" viewBox="0 0 16 16" id="icPause" style="display:none"><path d="M5 3h2.2v10H5zM8.8 3H11v10H8.8z"/></svg>
          </button>
          <button class="rc-btn icon" id="btnPrevFrame" disabled aria-label="Previous frame" title="Previous frame (←)">
            <svg class="ic" viewBox="0 0 16 16"><path d="M10 3.5L5.5 8l4.5 4.5M4 3.5v9"/></svg></button>
          <button class="rc-btn icon" id="btnNextFrame" disabled aria-label="Next frame" title="Next frame (→)">
            <svg class="ic" viewBox="0 0 16 16"><path d="M6 3.5L10.5 8 6 12.5M12 3.5v9"/></svg></button>
          <div class="divider"></div>
          <button class="rc-btn icon" id="btnMute" disabled aria-label="Mute" aria-pressed="false">
            <svg class="ic" viewBox="0 0 16 16" id="icVolOn"><path d="M4 6h2l3-2.5v9L6 10H4zM11 6c.8.8.8 3.2 0 4"/></svg>
            <svg class="ic" viewBox="0 0 16 16" id="icVolOff" style="display:none"><path d="M4 6h2l3-2.5v9L6 10H4zM11 6.5l3 3M14 6.5l-3 3"/></svg>
          </button>
          <button class="rc-btn sm" id="btnLoop" disabled aria-pressed="true">Loop</button>
          <div class="tb-spacer"></div>
          <span class="fps" id="frameRead">—</span>
        </div>
      </div>
</div>
<div class="rc-overlay" id="exportModal" hidden role="dialog" aria-modal="true" aria-labelledby="exportTitle">
  <div class="rc-modal">
    <div class="rc-modal-head"><h3 id="exportTitle">Export</h3>
      <button class="rc-btn ghost icon sm" data-close="exportModal" aria-label="Close">
        <svg class="ic" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>
    <div class="rc-modal-body">
      <div class="rc-field"><label for="expRes">Resolution</label>
        <select class="input" id="expRes">
          <option value="original" selected>Original</option>
          <option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option>
        </select></div>
      <div class="rc-field"><label for="expFps">Frame rate</label>
        <select class="input" id="expFps">
          <option value="original" selected>Original (detected)</option>
          <option value="30">30 fps</option><option value="24">24 fps</option>
        </select></div>
      <div class="rc-field"><label for="expQual">Quality</label>
        <select class="input" id="expQual">
          <option value="high" selected>High</option><option value="medium">Medium</option><option value="small">Small file</option>
        </select></div>
      <div class="rc-field"><label class="check"><input type="checkbox" id="expAudio" checked> Include audio</label></div>
      <div class="kv"><span>Output size</span><span id="expSizeRead">—</span></div>
      <div class="kv"><span>Frame rate</span><span id="expFpsRead">—</span></div>
      <div class="kv"><span>Format</span><span id="expMime">—</span></div>
      <div class="kv"><span>Estimated duration</span><span id="expDur">—</span></div>
      <div class="note" id="expNote">
        Export renders in real time and produces <b>WebM</b>. MP4 cannot be reliably encoded by
        MediaRecorder in a dependency-free page, so it is not offered rather than faked.
      </div>
      <div id="expProgWrap" hidden>
        <div class="progress"><div class="progress-bar" id="expProg"></div></div>
        <div class="kv"><span id="expStatus">Rendering…</span><span id="expPct">0%</span></div>
      </div>
    </div>
    <div class="rc-modal-foot">
      <button class="rc-btn" data-close="exportModal" id="expCancel">Cancel</button>
      <button class="rc-btn primary" id="expStart">Start export</button>
      <a class="rc-btn primary" id="expDownload" hidden download>Download</a>
    </div>
  </div>
</div>

<div class="rc-overlay" id="importModal" hidden role="dialog" aria-modal="true" aria-labelledby="importTitle">
  <div class="rc-modal" data-narrow>
    <div class="rc-modal-head"><h3 id="importTitle">Import palette</h3>
      <button class="rc-btn ghost icon sm" data-close="importModal" aria-label="Close">
        <svg class="ic" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button></div>
    <div class="rc-modal-body">
      <div class="rc-field"><label for="importText">Paste hex values, separated by commas, spaces, or new lines</label>
        <textarea class="input mono" id="importText" rows="6" placeholder="E71324&#10;92001D&#10;500010"></textarea></div>
      <div class="kv"><span id="importRead">No valid colors yet</span><span></span></div>
    </div>
    <div class="rc-modal-foot">
      <button class="rc-btn" data-close="importModal">Cancel</button>
      <button class="rc-btn primary" id="importApply">Replace palette</button>
    </div>
  </div>
</div>

<div class="rc-overlay" id="confirmModal" hidden role="dialog" aria-modal="true" aria-labelledby="confirmTitle">
  <div class="rc-modal" data-narrow>
    <div class="rc-modal-head"><h3 id="confirmTitle">Reset everything?</h3></div>
    <div class="rc-modal-body" id="confirmBody">
      This restores the default palette, settings, and mappings, and clears saved data. The loaded video stays.
    </div>
    <div class="rc-modal-foot">
      <button class="rc-btn" data-close="confirmModal">Cancel</button>
      <button class="rc-btn primary" id="confirmOk">Reset</button>
    </div>
  </div>
</div>

<input type="file" id="fileInput" accept="image/*,video/*" class="sr">
<video id="srcVideo" class="sr" playsinline crossorigin="anonymous"></video>
</div>`;
