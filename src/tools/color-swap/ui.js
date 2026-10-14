/* Color-swap UI controller, ported verbatim from reference/color-swap/index.html apart from marked
   Lathe changes: mounts into shell-provided stage/inspector nodes, persists through Lathe settings
   (IndexedDB) instead of localStorage, reports to the shell status bar and toasts, adds files and
   exports to the asset tray, renders stills from their canvas (alpha), removes its global listeners
   on unmount, and fixes the modal selector ('.overlay' → '.rc-overlay') so Escape and backdrop
   clicks close dialogs. */
import { MAX_COLORS, MAX_RULES, MAX_CLUST, MAX_PRESERVE, ColorMath, ROLES, ROLE_INDEX, SETTING_DEFS, PRESETS,
  PaletteManager, RecolorRenderer, ColorAnalyzer, VideoController, MappingManager, ExportManager } from './engine.js';
import { INSPECTOR_HTML, STAGE_HTML } from './markup.js';
import { slider as latheSlider } from '../../ui/primitives';
/* ============================================================
   UIController — wires DOM to the engine
   ============================================================ */
export class UIController {
  /* ctx: { stage, inspector, defaults, palette, presets, settings, statusbar, assets, emit } */
  constructor(ctx){
    this.ctx = ctx;
    // Scope all ID lookups to the tool's container so multiple tools don't clash.
    const root = ctx.stage.parentElement || ctx.stage;
    this.$ = id => root.querySelector('#' + id) || ctx.inspector.querySelector('#' + id);
    const $ = this.$;
    this.ac = new AbortController();   // every global listener is removed on unmount
    this.defs = SETTING_DEFS.map(d => ({ ...d, def: typeof ctx.defaults[d.key] === 'number' ? ctx.defaults[d.key] : d.def }));
    this.presets = ctx.presets || PRESETS;
    ctx.inspector.innerHTML = INSPECTOR_HTML;
    ctx.stage.innerHTML = STAGE_HTML;
    this.palette = new PaletteManager(ctx.palette);
    this.mapping = new MappingManager();
    this.analyzer = new ColorAnalyzer();
    this.video = new VideoController($('srcVideo'));
    this.exporter = new ExportManager(this);

    this.settings = {};
    this.defs.forEach(d => this.settings[d.key] = d.def);

    this.clusters = [];
    this.view = 'recolored';
    this.fit = 'fit';
    this.quality = 'standard';
    this.split = 0.5;
    this.pickMode = null;        // 'rule' | 'preserve' | 'cluster'
    this.pickClusterIdx = -1;
    this.fpsSamples = [];
    this.lastFrameTime = performance.now();

    this.renderer = new RecolorRenderer($('outCanvas'));
    if(!this.renderer.ok){
      this.status('WebGL2 is unavailable, so recoloring cannot run. Try Chrome, Edge, Firefox, or Safari 15+.', 'err');
      $('btnUpload').disabled = true;
      $('btnUpload2').disabled = true;
    }

    this.palette.onChange = () => { this.renderPalette(); this.renderClusters(); this.renderRules(); this.persist(); };
    this.mapping.onChange = () => { this.renderRules(); this.renderPreserve(); this.persist(); };

    this._active = true;
    this._wasPlaying = false;
    if(ctx.onActivate){
      this._offActivate = ctx.onActivate(active => {
        this._active = active;
        if(!active){
          // Pause video when tab becomes inactive
          this._wasPlaying = this.video.loaded && !this.video.v.paused;
          if(this._wasPlaying) this.video.pause();
        } else {
          // Restart rAF loop and resume video when tab becomes active
          if(!this._raf) this.loop();
          if(this._wasPlaying && this.video.loaded) this.video.play().catch(() => {});
        }
      });
    }

    this.buildSettings();
    this.buildPresets();
    this.renderPalette();
    this.renderClusters();
    this.renderRules();
    this.renderPreserve();
    this.bind();
    this.restore();
    this.loop();
  }

  /* ---------------- status + toast ---------------- */
  status(text, kind){
    const $ = this.$;
    $('statusText').textContent = text;
    const v = this.video && this.video.v;
    const w = (v && v.videoWidth) || (this.video && this.video._stillCanvas && this.video._stillCanvas.width) || undefined;
    const h = (v && v.videoHeight) || (this.video && this.video._stillCanvas && this.video._stillCanvas.height) || undefined;
    this.ctx.statusbar.set(this.video && this.video.loaded
      ? { name: this._fileName, width: w, height: h, bytes: this._fileSize, state: text }
      : { state: text });
    const d = $('statusDot');
    d.className = 'status-dot' + (kind ? ' ' + kind : '');
  }
  toast(msg){ this.ctx.emit('toast', msg); }

  /* ---------------- settings panel ---------------- */
  buildSettings(){
    const $ = this.$;
    const host = $('settingsList');
    host.innerHTML = '';
    this._settingsSliders = {};
    this.defs.forEach(def => {
      const id = 'set_'+def.key;
      const s = latheSlider({
        label: def.label, min: 0, max: 100, value: Math.round(def.def*100),
        onChange: v => {
          this.settings[def.key] = v/100;
          this.renderer.resetHistory();
          this.persist();
        },
      });
      s.el.id = id;
      s.el.title = def.tip || '';
      s.el.querySelector('.l-slider__label')?.addEventListener('dblclick', e => {
        e.preventDefault();
        this.settings[def.key] = def.def;
        s.input.value = String(Math.round(def.def*100));
        s.input.dispatchEvent(new Event('input'));
        this.renderer.resetHistory();
        this.persist();
        this.toast(def.label + ' reset');
      });
      this._settingsSliders[def.key] = s;
      host.appendChild(s.el);
    });
  }
  syncSettingsUI(){
    this.defs.forEach(d => {
      const s = this._settingsSliders?.[d.key];
      if(s){ s.input.value = String(Math.round(this.settings[d.key]*100)); s.input.dispatchEvent(new Event('input')); }
    });
  }

  buildPresets(){
    const $ = this.$;
    const host = $('presetGrid');
    host.innerHTML = '';
    Object.keys(this.presets).forEach(name => {
      const b = document.createElement('button');
      b.className = 'btn sm';
      b.textContent = name;
      b.addEventListener('click', () => {
        this.defs.forEach(d => this.settings[d.key] = d.def);
        Object.assign(this.settings, this.presets[name]);
        this.syncSettingsUI();
        this.renderer.resetHistory();
        this.persist();
        this.toast(name + ' applied');
      });
      host.appendChild(b);
    });
  }

  /* ---------------- palette panel ---------------- */
  renderPalette(){
    const $ = this.$;
    const host = $('swatchList');
    host.innerHTML = '';
    $('paletteCount').textContent = this.palette.active.length + ' active';

    this.palette.colors.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = 'swatch' + (c.enabled ? '' : ' off') + (c.locked ? ' locked' : '');
      const roleOpts = ROLES.map(r => `<option value="${r}"${r===c.role?' selected':''}>${r}</option>`).join('');
      el.innerHTML = `
        <div class="swatch-top">
          <input type="checkbox" ${c.enabled?'checked':''} aria-label="Enable ${c.name}" data-a="on">
          <button class="swatch-chip" style="background:${c.hex}" aria-label="Pick color for ${c.name}">
            <input type="color" value="${c.hex}" data-a="picker" aria-label="${c.name} color">
          </button>
          <input class="swatch-name" value="${c.name.replace(/"/g,'&quot;')}" aria-label="Color name" data-a="name">
          <button class="lock-btn ${c.locked?'on':''}" data-a="lock"
                  aria-pressed="${c.locked}" aria-label="Lock ${c.name} weight" title="Lock weight">
            <svg class="ic ic-sm" viewBox="0 0 16 16">
              ${c.locked
                ? '<rect x="4" y="7" width="8" height="6" rx="1"/><path d="M6 7V5.2a2 2 0 014 0V7"/>'
                : '<rect x="4" y="7" width="8" height="6" rx="1"/><path d="M6 7V5.2a2 2 0 013.8-.9"/>'}
            </svg>
          </button>
          <button class="rc-btn ghost icon sm danger" data-a="del" aria-label="Remove ${c.name}">
            <svg class="ic" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
        </div>
        <div class="swatch-mid">
          <input class="input mono" value="${c.hex}" maxlength="7" data-a="hex" aria-label="${c.name} hex value">
          <select class="input" data-a="role" aria-label="${c.name} role">${roleOpts}</select>
        </div>
        <div class="ctrl ctrl--weight">
          <div class="ctrl-top">
            <span class="ctrl-name" data-a="wlabel" title="Double-click to reset">Weight</span>
            <span class="ctrl-val" data-a="wval">${c.weight}</span>
          </div>
          <input type="range" min="0" max="100" value="${c.weight}" data-a="weight"
                 aria-label="${c.name} weight" ${c.enabled?'':'disabled'}>
        </div>`;
      host.appendChild(el);

      const q = a => el.querySelector(`[data-a="${a}"]`);
      q('on').addEventListener('change', e => { c.enabled = e.target.checked; this.palette.changed(); this.renderer.resetHistory(); });
      q('picker').addEventListener('input', e => {
        c.hex = e.target.value.toUpperCase();
        el.querySelector('.swatch-chip').style.background = c.hex;
        q('hex').value = c.hex;
        this.renderer.resetHistory(); this.persist();
      });
      q('picker').addEventListener('change', () => this.palette.changed());
      q('name').addEventListener('change', e => { c.name = e.target.value.trim() || 'Untitled'; this.persist(); });
      q('hex').addEventListener('change', e => {
        const n = ColorMath.normalizeHex(e.target.value);
        if(n){ c.hex = n; this.palette.changed(); this.renderer.resetHistory(); }
        else { e.target.value = c.hex; this.toast('That is not a valid hex value'); }
      });
      q('role').addEventListener('change', e => { c.role = e.target.value; this.palette.changed(); this.renderer.resetHistory(); });
      q('lock').addEventListener('click', () => { c.locked = !c.locked; this.palette.changed(); });
      q('del').addEventListener('click', () => {
        if(!this.palette.remove(i)) this.toast('Keep at least two colors');
        else this.renderer.resetHistory();
      });
      const wSlider = q('weight'), wVal = q('wval');
      wSlider.addEventListener('input', e => {
        c.weight = parseInt(e.target.value,10);
        wVal.textContent = c.weight;
        this.renderer.resetHistory(); this.persist();
      });
      q('wlabel').addEventListener('dblclick', () => {
        const def = this.palette.defaultList.find(d => d.hex === c.hex);
        c.weight = def ? def.weight : 50;
        wSlider.value = c.weight; wVal.textContent = c.weight;
        this.renderer.resetHistory(); this.persist();
      });
    });
  }

  paletteOptions(selected){
    return '<option value="-1"' + (selected==null||selected<0?' selected':'') + '>Automatic</option>' +
      this.palette.colors.map((c,i) =>
        `<option value="${i}"${i===selected?' selected':''}${c.enabled?'':' disabled'}>${c.name}</option>`).join('');
  }

  /* ---------------- clusters ---------------- */
  renderClusters(){
    const $ = this.$;
    const host = $('clusterList');
    host.innerHTML = '';
    if(!this.clusters.length){ return; }

    this.clusters.forEach((cl, i) => {
      const el = document.createElement('div');
      el.className = 'cluster' + (cl.protect ? ' protected' : '');
      el.innerHTML = `
        <div class="cluster-src" style="background:${cl.hex}" title="${cl.hex}"></div>
        <span class="arrow">→</span>
        <div class="cluster-body">
          <select class="input" data-a="target" aria-label="Target palette color for source ${cl.hex}">
            ${this.paletteOptions(cl.target)}
          </select>
          <div class="ctrl ctrl--flush">
            <div class="ctrl-top">
              <span class="cluster-meta">${cl.hex} · ${(cl.share*100).toFixed(1)}% of frame</span>
              <span class="ctrl-val" data-a="sval">${Math.round(cl.strength*100)}</span>
            </div>
            <input type="range" min="0" max="100" value="${Math.round(cl.strength*100)}"
                   data-a="strength" aria-label="Mapping strength">
          </div>
          <label class="check"><input type="checkbox" data-a="protect" ${cl.protect?'checked':''}> Protect this family</label>
        </div>`;
      host.appendChild(el);
      const q = a => el.querySelector(`[data-a="${a}"]`);
      q('target').addEventListener('change', e => {
        cl.target = parseInt(e.target.value,10);
        this.renderer.resetHistory(); this.persist();
      });
      q('strength').addEventListener('input', e => {
        cl.strength = parseInt(e.target.value,10)/100;
        q('sval').textContent = e.target.value;
        this.renderer.resetHistory(); this.persist();
      });
      q('protect').addEventListener('change', e => {
        cl.protect = e.target.checked;
        el.classList.toggle('protected', cl.protect);
        this.renderer.resetHistory(); this.persist();
      });
    });
  }

  /* ---------------- rules ---------------- */
  renderRules(){
    const $ = this.$;
    const host = $('ruleList');
    host.innerHTML = '';
    $('ruleCount').textContent = this.mapping.rules.length + (this.mapping.rules.length===1?' rule':' rules');

    this.mapping.rules.forEach(r => {
      const el = document.createElement('div');
      el.className = 'rule' + (r.enabled ? '' : ' off');
      el.innerHTML = `
        <div class="rule-head">
          <input type="checkbox" ${r.enabled?'checked':''} data-a="on" aria-label="Enable rule">
          <button class="swatch-chip swatch-chip--sm" style="background:${r.source}" aria-label="Rule source color">
            <input type="color" value="${r.source}" data-a="src">
          </button>
          <span class="arrow">→</span>
          <select class="input grow" data-a="target" aria-label="Rule target color">
            ${this.palette.colors.map((c,i)=>`<option value="${i}"${i===r.target?' selected':''}${c.enabled?'':' disabled'}>${c.name}</option>`).join('')}
          </select>
          <button class="rc-btn ghost icon sm danger" data-a="del" aria-label="Delete rule">
            <svg class="ic" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
        </div>
        ${this.miniSlider('hue','Hue tolerance', r.hueTol, 0.02, 1)}
        ${this.miniSlider('sat','Saturation tolerance', r.satTol, 0.01, 0.4)}
        ${this.miniSlider('bri','Brightness tolerance', r.briTol, 0.01, 1)}
        ${this.miniSlider('str','Strength', r.strength, 0, 1)}
        ${this.miniSlider('fea','Feathering', r.feather, 0, 1)}`;
      host.appendChild(el);

      const q = a => el.querySelector(`[data-a="${a}"]`);
      q('on').addEventListener('change', e => { r.enabled = e.target.checked; el.classList.toggle('off', !r.enabled); this.renderer.resetHistory(); this.persist(); });
      q('src').addEventListener('input', e => {
        r.source = e.target.value.toUpperCase();
        e.target.parentElement.style.background = r.source;
        this.renderer.resetHistory(); this.persist();
      });
      q('target').addEventListener('change', e => { r.target = parseInt(e.target.value,10); this.renderer.resetHistory(); this.persist(); });
      q('del').addEventListener('click', () => this.mapping.removeRule(r.id));

      const bindMini = (key, prop, min, max) => {
        const s = el.querySelector(`[data-m="${key}"]`);
        const v = el.querySelector(`[data-mv="${key}"]`);
        s.addEventListener('input', () => {
          r[prop] = min + (max-min)*(s.value/100);
          v.textContent = s.value;
          this.renderer.resetHistory(); this.persist();
        });
      };
      bindMini('hue','hueTol',0.02,1);
      bindMini('sat','satTol',0.01,0.4);
      bindMini('bri','briTol',0.01,1);
      bindMini('str','strength',0,1);
      bindMini('fea','feather',0,1);
    });
  }

  miniSlider(key, label, val, min, max){
    const pct = Math.round((val-min)/(max-min)*100);
    return `<div class="ctrl ctrl--mini">
      <div class="ctrl-top ctrl-top--tight">
        <span class="mini grow">${label}</span>
        <span class="ctrl-val" data-mv="${key}">${pct}</span>
      </div>
      <input type="range" min="0" max="100" value="${pct}" data-m="${key}" aria-label="${label}">
    </div>`;
  }

  /* ---------------- preserved colors ---------------- */
  renderPreserve(){
    const $ = this.$;
    const host = $('preserveList');
    host.innerHTML = '';
    this.mapping.preserve.forEach(p => {
      const el = document.createElement('div');
      el.className = 'rule';
      el.innerHTML = `
        <div class="rule-head">
          <button class="swatch-chip swatch-chip--sm" style="background:${p.hex}" aria-label="Preserved color">
            <input type="color" value="${p.hex}" data-a="c">
          </button>
          <span class="rule-title tabular">${p.hex}</span>
          <button class="rc-btn ghost icon sm danger" data-a="del" aria-label="Remove preserved color">
            <svg class="ic" viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8"/></svg></button>
        </div>
        ${this.miniSlider('rad','Range', p.radius, 0.02, 0.30)}`;
      host.appendChild(el);
      el.querySelector('[data-a="c"]').addEventListener('input', e => {
        p.hex = e.target.value.toUpperCase();
        e.target.parentElement.style.background = p.hex;
        el.querySelector('.rule-title').textContent = p.hex;
        this.renderer.resetHistory(); this.persist();
      });
      el.querySelector('[data-a="del"]').addEventListener('click', () => this.mapping.removePreserve(p.id));
      const s = el.querySelector('[data-m="rad"]'), v = el.querySelector('[data-mv="rad"]');
      s.addEventListener('input', () => {
        p.radius = 0.02 + 0.28*(s.value/100);
        v.textContent = s.value;
        this.renderer.resetHistory(); this.persist();
      });
    });
    $('btnPickPreserve').disabled = !this.video.loaded || this.mapping.preserve.length >= MAX_PRESERVE;
  }

  /* ---------------- render state for the shader ---------------- */
  renderState(){
    return {
      palette: this.palette,
      clusters: this.clusters,
      rules: this.mapping.rules,
      preserve: this.mapping.preserve,
      settings: this.settings,
      view: this.view === 'original' ? 0 : this.view === 'split' ? 2 : 1,
      split: this.split
    };
  }

  /* ---------------- main loop ---------------- */
  previewScale(){
    return this.quality === 'draft' ? 0.5 : this.quality === 'high' ? 1.0 : 0.75;
  }

  loop(){
    const $ = this.$;
    const draw = () => {
      if(!this._active){ this._raf = 0; return; }
      this._raf = requestAnimationFrame(draw);
      if(!this.video.loaded || !this.renderer.ok) return;
      if(this.exporter.active) return;   // export owns the video element

      const v = this.video.v;
      if(v.readyState < 2 && !this.video.isStill) return;

      const scale = this.previewScale();
      const vw = v.videoWidth || (this.video._stillCanvas && this.video._stillCanvas.width) || 0;
      const vh = v.videoHeight || (this.video._stillCanvas && this.video._stillCanvas.height) || 0;
      if(!vw || !vh) return;
      const w = Math.max(2, Math.round(vw*scale/2)*2);
      const h = Math.max(2, Math.round(vh*scale/2)*2);
      this.renderer.resize(w,h);
      this.renderer.render(this.video.frameSource(), this.renderState());

      // fps meter
      const now = performance.now();
      const dt = now - this.lastFrameTime;
      this.lastFrameTime = now;
      if(dt > 0 && dt < 500){
        this.fpsSamples.push(1000/dt);
        if(this.fpsSamples.length > 30) this.fpsSamples.shift();
      }
      if(now - (this._lastMeter||0) > 400){
        this._lastMeter = now;
        const avg = this.fpsSamples.length
          ? this.fpsSamples.reduce((a,b)=>a+b,0)/this.fpsSamples.length : 0;
        $('fpsRead').textContent = avg ? avg.toFixed(0)+' fps' : '—';
        $('resRead').textContent = w+'×'+h;
      }
      this.updateTransport();
    };
    this._raf = requestAnimationFrame(draw);
  }

  updateTransport(){
    const $ = this.$;
    const v = this.video.v;
    if(!isFinite(v.duration)) return;
    if(!this._scrubbing){
      $('scrub').value = Math.round((v.currentTime/v.duration)*1000);
    }
    $('timeCur').textContent = VideoController.formatTime(v.currentTime);
    $('frameRead').textContent = `frame ${this.video.frameIndex} / ${this.video.totalFrames}`;
    const playing = !v.paused && !v.ended;
    $('icPlay').style.display = playing ? 'none' : 'block';
    $('icPause').style.display = playing ? 'block' : 'none';
    $('btnPlay').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  /* ---------------- video loading ---------------- */
  async handleFile(file){
    const $ = this.$;
    if(!file) return;
    // Case-by-case: each import clears prior analysis/mappings for this media
    this.clusters = [];
    this.mapping.rules = [];
    this.mapping.preserve = [];
    this.renderClusters();
    this.renderRules();
    this.renderPreserve();
    this.renderer.resetHistory();

    this._fileName = file.name; this._fileSize = file.size;
    const kind = (file.type||'').startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name)
      ? 'image' : 'video';
    this.status(kind === 'image' ? 'Reading image…' : 'Reading video…', 'busy');
    try {
      await this.video.load(file);
    } catch(e){
      this.status(e.message, 'err');
      this.toast(e.message);
      return;
    }
    $('dropZone').classList.add('hide');
    ['btnExport','btnPlay','btnPrevFrame','btnNextFrame','btnMute','btnLoop','scrub','btnReanalyze','btnPickPreserve','btnPickRule']
      .forEach(id => { const el = $(id); if(el) el.disabled = false; });
    const dur = this.video.v.duration;
    $('timeDur').textContent = this.video.isStill || !isFinite(dur)
      ? 'still' : VideoController.formatTime(dur);
    this.renderer.resetHistory();
    this.fitStage();
    const w = this.video.v.videoWidth || (this.video._stillCanvas && this.video._stillCanvas.width) || 0;
    const h = this.video.v.videoHeight || (this.video._stillCanvas && this.video._stillCanvas.height) || 0;
    this.status(
      this.video.isStill
        ? `Loaded ${file.name} · ${w}×${h} · fresh analysis`
        : `Loaded ${file.name} · ${w}×${h} · ${this.video.fps} fps · fresh analysis`,
      'ok'
    );
    await this.analyze();
    if(!this.video.isStill){
      this.video.play().catch(() => {
        this.status('Loaded. Press play to start.', 'ok');
      });
    }
  }

  async analyze(){
    const $ = this.$;
    if(!this.video.loaded) return;
    $('btnReanalyze').disabled = true;
    this.status('Analyzing color families…', 'busy');
    $('clusterNote').textContent = this.video.isStill ? 'Sampling image…' : 'Sampling frames…';
    try {
      const samples = await this.analyzer.collect(this.video.frameSource(), this.video.isStill ? 4 : (this.ctx.defaults.analysisFrames || 12), p => {
        $('clusterNote').textContent = `Analyzing… ${Math.round(p*100)}%`;
        this.status(`Analyzing color families… ${Math.round(p*100)}%`, 'busy');
      });
      if(!samples.length) throw new Error('No pixels could be sampled.');
      const found = await this.analyzer.kmeans(samples, MAX_CLUST, p => {
        $('clusterNote').textContent = `Analyzing… ${Math.round(p*100)}%`;
      });
      this.clusters = found.slice(0, MAX_CLUST).map(c => ({
        lab: c.lab, hex: c.hex, share: c.share,
        target: this.analyzer.suggest(c, this.palette),
        strength: 1.0, protect: false
      }));
      $('clusterNote').textContent =
        `${this.clusters.length} color families from this import. Fresh analysis — case by case.`;
      this.renderClusters();
      this.renderer.resetHistory();
      this.persist();
      this.status('Analysis complete. Recoloring live.', 'ok');
    } catch(e){
      $('clusterNote').textContent = 'Analysis failed: ' + e.message;
      this.status('Analysis failed: ' + e.message, 'err');
      this.clusters = [];
      this.renderClusters();
    }
    $('btnReanalyze').disabled = false;
  }

  /* ---------------- stage sizing ---------------- */
  fitStage(){
    const $ = this.$;
    const stage = $('stage'), inner = $('stageInner');
    if(!stage || !inner) return; // unmounted
    const v = this.video.v;
    const vw = v.videoWidth || (this.video._stillCanvas && this.video._stillCanvas.width) || 0;
    const vh = v.videoHeight || (this.video._stillCanvas && this.video._stillCanvas.height) || 0;
    if(!vw || !vh) return;
    if(this.fit === 'fill'){ inner.style.width=''; inner.style.height=''; return; }
    const pad = 28;
    const aw = stage.clientWidth - pad, ah = stage.clientHeight - pad;
    if(aw <= 0 || ah <= 0) return;
    const ar = vw / vh;
    let w = aw, h = w/ar;
    if(h > ah){ h = ah; w = h*ar; }
    inner.style.width = Math.floor(w)+'px';
    inner.style.height = Math.floor(h)+'px';
    $('outCanvas').style.width = '100%';
    $('outCanvas').style.height = '100%';
  }

  updateSplitUI(){
    const $ = this.$;
    const showSplit = this.view === 'split';
    $('splitHandle').hidden = !showSplit;
    $('tagL').hidden = !showSplit;
    $('tagR').hidden = !showSplit;
    if(showSplit){
      $('splitHandle').style.left = (this.split*100)+'%';
      $('splitHandle').setAttribute('aria-valuenow', Math.round(this.split*100));
    }
  }

  /* ---------------- color picking from the preview ---------------- */
  startPick(mode, clusterIdx){
    const $ = this.$;
    if(!this.video.loaded){ this.toast('Load a video first'); return; }
    this.pickMode = mode;
    this.pickClusterIdx = clusterIdx ?? -1;
    $('stage').classList.add('picking');
    $('pickHint').hidden = false;
    $('pickHint').textContent = mode === 'preserve'
      ? 'Click a color in the preview to preserve it'
      : 'Click a color in the preview to use as the rule source';
  }
  endPick(){
    const $ = this.$;
    this.pickMode = null;
    $('stage').classList.remove('picking');
    $('pickHint').hidden = true;
  }
  pickAt(clientX, clientY){
    const $ = this.$;
    const canvas = $('outCanvas');
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left)/rect.width;
    const y = (clientY - rect.top)/rect.height;
    if(x<0||x>1||y<0||y>1) return null;
    // Sample the ORIGINAL video, not the recolored output, so rules
    // reference source colors.
    const v = this.video.frameSource();
    const vw = v.videoWidth || v.width, vh = v.videoHeight || v.height;
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    const ctx = c.getContext('2d', { willReadFrequently:true });
    try {
      ctx.drawImage(v, Math.floor(x*vw), Math.floor(y*vh), 1, 1, 0, 0, 1, 1);
      const d = ctx.getImageData(0,0,1,1).data;
      return ColorMath.rgbToHex(d[0]/255, d[1]/255, d[2]/255);
    } catch(e){ return null; }
  }

  /* ---------------- persistence ---------------- */
  persist(){
    clearTimeout(this._persistT);
    this._persistT = setTimeout(() => {
      this.ctx.settings.set('state', this.snapshot());
    }, 250);
  }
  snapshot(){
    return {
      version: 1,
      palette: this.palette.colors,
      settings: this.settings,
      rules: this.mapping.rules,
      preserve: this.mapping.preserve,
      clusters: this.clusters.map(c => ({ lab:c.lab, hex:c.hex, share:c.share, target:c.target, strength:c.strength, protect:c.protect })),
      view: this.view, quality: this.quality, fit: this.fit, split: this.split
    };
  }
  applySnapshot(s){
    if(!s || typeof s !== 'object') return false;
    if(Array.isArray(s.palette) && s.palette.length >= 2){
      this.palette.colors = s.palette.slice(0, MAX_COLORS).map(c => ({
        name: String(c.name||'Color'),
        hex: ColorMath.normalizeHex(c.hex) || '#808080', /* tokens-allow: data fallback color */
        role: ROLES.includes(c.role) ? c.role : 'Midtone',
        weight: Math.max(0, Math.min(100, Number(c.weight)||50)),
        enabled: c.enabled !== false,
        locked: !!c.locked
      }));
    }
    if(s.settings) this.defs.forEach(d => {
      const v = Number(s.settings[d.key]);
      if(isFinite(v)) this.settings[d.key] = Math.max(0, Math.min(1, v));
    });
    if(Array.isArray(s.rules)) this.mapping.rules = s.rules.slice(0, MAX_RULES).map(r => ({
      id: r.id || 'r'+Math.random().toString(36).slice(2,8),
      source: ColorMath.normalizeHex(r.source) || '#808080', /* tokens-allow: data fallback color */
      target: Number.isInteger(r.target) ? r.target : 0,
      hueTol: Number(r.hueTol)||0.28, satTol: Number(r.satTol)||0.1,
      briTol: Number(r.briTol)||0.35, strength: Number(r.strength)??1,
      feather: Number(r.feather)??0.5, enabled: r.enabled !== false
    }));
    if(Array.isArray(s.preserve)) this.mapping.preserve = s.preserve.slice(0, MAX_PRESERVE).map(p => ({
      id: p.id || 'p'+Math.random().toString(36).slice(2,8),
      hex: ColorMath.normalizeHex(p.hex) || '#808080', /* tokens-allow: data fallback color */
      radius: Math.max(0.02, Math.min(0.3, Number(p.radius)||0.1))
    }));
    if(Array.isArray(s.clusters)) this.clusters = s.clusters
      .filter(c => Array.isArray(c.lab) && c.lab.length === 3)
      .slice(0, MAX_CLUST)
      .map(c => ({ lab:c.lab.map(Number), hex:c.hex||'#808080', share:Number(c.share)||0, /* tokens-allow: data fallback color */
                   target:Number.isInteger(c.target)?c.target:-1,
                   strength:Number(c.strength)??1, protect:!!c.protect }));
    if(['original','recolored','split'].includes(s.view)) this.view = s.view;
    if(['draft','standard','high'].includes(s.quality)) this.quality = s.quality;
    if(['fit','fill'].includes(s.fit)) this.fit = s.fit;
    if(isFinite(s.split)) this.split = Math.max(0, Math.min(1, Number(s.split)));
    return true;
  }
  restore(){
    const $ = this.$;
    let saved = null;
    saved = this.ctx.settings.get('state', null);
    saved = saved ? JSON.parse(JSON.stringify(saved)) : null;
    if(!saved) return;
    // Stored clusters describe a previous video, so drop them.
    saved.clusters = [];
    this.applySnapshot(saved);
    this.syncSettingsUI();
    this.renderPalette();
    this.renderRules();
    this.renderPreserve();
    this.renderClusters();
    $('selQuality').value = this.quality;
    const $$ = sel => [...this.ctx.stage.querySelectorAll(sel), ...this.ctx.inspector.querySelectorAll(sel)];
    $$('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === this.view));
    $$('[data-fit]').forEach(b => b.classList.toggle('on', b.dataset.fit === this.fit));
    this.updateSplitUI();
  }
  resetAll(){
    this.palette.reset();
    this.defs.forEach(d => this.settings[d.key] = d.def);
    this.mapping.rules = []; this.mapping.preserve = [];
    this.clusters.forEach(c => { c.target = this.analyzer.suggest(c, this.palette); c.strength = 1; c.protect = false; });
    this.syncSettingsUI();
    this.renderPalette(); this.renderRules(); this.renderPreserve(); this.renderClusters();
    this.ctx.settings.set('state', null);
    this.renderer.resetHistory();
    this.toast('Reset to defaults');
  }
}


/* ============================================================
   Event binding (attached to UIController prototype)
   ============================================================ */
UIController.prototype.bind = function(){
  const self = this;
  const $ = self.$;
  const $$ = sel => [...self.ctx.stage.querySelectorAll(sel), ...self.ctx.inspector.querySelectorAll(sel)];

  /* ---- collapsible sections ---- */
  $$('.section-head').forEach(head => {
    const toggle = () => {
      const sec = head.parentElement;
      sec.classList.toggle('collapsed');
      head.setAttribute('aria-expanded', String(!sec.classList.contains('collapsed')));
    };
    head.addEventListener('click', toggle);
    head.addEventListener('keydown', e => {
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); }
    });
    // apply the initial aria-expanded value from markup
    if(head.getAttribute('aria-expanded') === 'false') head.parentElement.classList.add('collapsed');
  });

  /* ---- file input ---- */
  const openFile = () => $('fileInput').click();
  $('btnUpload').addEventListener('click', openFile);
  $('btnUpload2').addEventListener('click', openFile);
  $('fileInput').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if(f){ self.ctx.assets.add(f, { source:'drop' }).then(a => self.ctx.settings.set('lastAsset', a.id)); self.handleFile(f); }
  });

  /* ---- drag and drop ---- */
  const dz = $('stage');
  ['dragenter','dragover'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    $('dropZone').classList.add('over');
    if(!self.video.loaded) $('dropZone').classList.remove('hide');
  }));
  ['dragleave','drop'].forEach(ev => dz.addEventListener(ev, e => {
    e.preventDefault(); e.stopPropagation();
    if(ev === 'dragleave' && dz.contains(e.relatedTarget)) return;
    $('dropZone').classList.remove('over');
    if(self.video.loaded) $('dropZone').classList.add('hide');
  }));
  dz.addEventListener('drop', e => {
    const trayId = e.dataTransfer && e.dataTransfer.getData('application/x-lathe-asset');
    const a = trayId && self.ctx.assets.get(trayId);
    if(a){ self.loadAsset(a); return; }
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if(f){ self.ctx.assets.add(f, { source:'drop' }).then(a => self.ctx.settings.set('lastAsset', a.id)); self.handleFile(f); }
  });

  /* ---- transport ---- */
  $('btnPlay').addEventListener('click', () => self.video.toggle());
  $('btnPrevFrame').addEventListener('click', () => self.video.step(-1));
  $('btnNextFrame').addEventListener('click', () => self.video.step(1));
  $('btnMute').addEventListener('click', () => {
    const v = self.video.v;
    v.muted = !v.muted;
    $('icVolOn').style.display = v.muted ? 'none' : 'block';
    $('icVolOff').style.display = v.muted ? 'block' : 'none';
    $('btnMute').setAttribute('aria-pressed', String(v.muted));
    $('btnMute').setAttribute('aria-label', v.muted ? 'Unmute' : 'Mute');
  });
  $('btnLoop').addEventListener('click', () => {
    const v = self.video.v;
    v.loop = !v.loop;
    $('btnLoop').setAttribute('aria-pressed', String(v.loop));
    $('btnLoop').classList.toggle('on', v.loop);
  });
  $('btnLoop').classList.add('on');

  const scrub = $('scrub');
  scrub.addEventListener('pointerdown', () => { self._scrubbing = true; });
  scrub.addEventListener('input', () => { self.video.seekFrac(scrub.value/1000); });
  const endScrub = () => { self._scrubbing = false; };
  scrub.addEventListener('pointerup', endScrub);
  scrub.addEventListener('pointercancel', endScrub);
  scrub.addEventListener('blur', endScrub);
  scrub.addEventListener('keyup', endScrub);

  self.video.v.addEventListener('seeked', () => self.renderer.resetHistory());
  self.video.v.addEventListener('play', () => self.renderer.resetHistory());

  /* ---- view + quality + fit ---- */
  $$('[data-view]').forEach(b => b.addEventListener('click', () => {
    $$('[data-view]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    self.view = b.dataset.view;
    self.updateSplitUI();
    self.renderer.resetHistory();
    self.persist();
  }));
  $$('[data-fit]').forEach(b => b.addEventListener('click', () => {
    $$('[data-fit]').forEach(x => x.classList.remove('on'));
    b.classList.add('on');
    self.fit = b.dataset.fit;
    $('stage').classList.toggle('fill', self.fit === 'fill');
    self.fitStage();
    self.persist();
  }));
  $('selQuality').addEventListener('change', e => {
    self.quality = e.target.value;
    self.renderer.resetHistory();
    self.persist();
  });

  /* ---- split handle ---- */
  const handle = $('splitHandle');
  let draggingSplit = false;
  const moveSplit = clientX => {
    const rect = $('outCanvas').getBoundingClientRect();
    self.split = Math.max(0, Math.min(1, (clientX - rect.left)/rect.width));
    self.updateSplitUI();
  };
  handle.addEventListener('pointerdown', e => {
    draggingSplit = true;
    handle.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  handle.addEventListener('pointermove', e => { if(draggingSplit) moveSplit(e.clientX); });
  handle.addEventListener('pointerup', e => {
    draggingSplit = false;
    try { handle.releasePointerCapture(e.pointerId); } catch(err){}
    self.persist();
  });
  handle.addEventListener('keydown', e => {
    const step = e.shiftKey ? 0.1 : 0.02;
    if(e.key === 'ArrowLeft'){ self.split = Math.max(0, self.split-step); self.updateSplitUI(); e.preventDefault(); }
    if(e.key === 'ArrowRight'){ self.split = Math.min(1, self.split+step); self.updateSplitUI(); e.preventDefault(); }
  });

  /* ---- click-to-sample on the preview ---- */
  $('outCanvas').addEventListener('click', e => {
    if(!self.pickMode) return;
    const hex = self.pickAt(e.clientX, e.clientY);
    if(!hex){ self.toast('Could not read that pixel'); self.endPick(); return; }
    if(self.pickMode === 'preserve'){
      if(!self.mapping.addPreserve(hex)) self.toast('Preserve list is full');
      else self.toast('Preserving ' + hex);
    } else if(self.pickMode === 'rule'){
      const r = self.mapping.addRule(hex, 0);
      if(!r) self.toast('Rule list is full');
      else self.toast('Rule added from ' + hex);
    }
    self.endPick();
    self.renderer.resetHistory();
  });
  $('btnPickRule').addEventListener('click', () => self.startPick('rule'));
  $('btnPickPreserve').addEventListener('click', () => self.startPick('preserve'));

  /* ---- palette buttons ---- */
  $('btnAddColor').addEventListener('click', () => {
    if(!self.palette.add()) self.toast(`Maximum ${MAX_COLORS} colors`);
  });
  $('btnResetPalette').addEventListener('click', () => {
    self.confirm('Reset palette?', 'This restores the eight default brand colors and their weights.', () => {
      self.palette.reset();
      self.clusters.forEach(c => c.target = self.analyzer.suggest(c, self.palette));
      self.renderClusters();
      self.renderer.resetHistory();
      self.toast('Palette reset');
    });
  });
  $('btnCopyPalette').addEventListener('click', async () => {
    const text = self.palette.copyText();
    try {
      await navigator.clipboard.writeText(text);
      self.toast('Copied ' + self.palette.active.length + ' hex values');
    } catch(e){
      // clipboard API needs a secure context; fall back to a selection
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); self.toast('Copied'); }
      catch(err){ self.toast('Copy blocked by the browser'); }
      document.body.removeChild(ta);
    }
  });
  $('btnImportPalette').addEventListener('click', () => {
    $('importText').value = '';
    $('importRead').textContent = 'No valid colors yet';
    self.openModal('importModal');
    $('importText').focus();
  });
  $('importText').addEventListener('input', e => {
    const n = (e.target.value.match(/#?[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || []).length;
    $('importRead').textContent = n ? `${n} color${n===1?'':'s'} detected` : 'No valid colors yet';
  });
  $('importApply').addEventListener('click', () => {
    const n = self.palette.importHex($('importText').value);
    if(n === 0){ self.toast('Need at least two valid hex values'); return; }
    self.clusters.forEach(c => c.target = self.analyzer.suggest(c, self.palette));
    self.renderClusters();
    self.closeModal('importModal');
    self.renderer.resetHistory();
    self.toast(`Imported ${n} colors`);
  });

  $('btnReanalyze').addEventListener('click', () => self.analyze());
  $('btnAddRule').addEventListener('click', () => {
    if(!self.mapping.addRule('#3A6EA5', 0)) self.toast(`Maximum ${MAX_RULES} rules`); /* tokens-allow: data fallback color */
  });

  /* ---- preset json ---- */
  $('btnSavePreset').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(self.snapshot(), null, 2)], { type:'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'palette-recolor-preset.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    self.toast('Preset saved');
  });
  $('btnLoadPreset').addEventListener('click', () => $('presetInput').click());
  $('presetInput').addEventListener('change', e => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if(!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        self.applySnapshot(data);
        self.syncSettingsUI();
        self.renderPalette(); self.renderRules(); self.renderPreserve(); self.renderClusters();
        $('selQuality').value = self.quality;
        $$('[data-view]').forEach(b => b.classList.toggle('on', b.dataset.view === self.view));
        $$('[data-fit]').forEach(b => b.classList.toggle('on', b.dataset.fit === self.fit));
        self.updateSplitUI();
        self.renderer.resetHistory();
        self.persist();
        self.toast('Preset loaded');
      } catch(err){ self.toast('That file is not a valid preset'); }
    };
    reader.onerror = () => self.toast('Could not read that file');
    reader.readAsText(f);
  });

  /* ---- global reset ---- */
  $('btnReset').addEventListener('click', () => {
    self.confirm('Reset everything?',
      'This restores the default palette, settings, and mappings, and clears saved data. The loaded video stays.',
      () => self.resetAll());
  });

  /* ---- modals ---- */
  $$('[data-close]').forEach(b =>
    b.addEventListener('click', () => self.closeModal(b.dataset.close)));
  $$('.rc-overlay').forEach(o =>
    o.addEventListener('click', e => { if(e.target === o) self.closeModal(o.id); }));

  /* ---- export ---- */
  $('btnExport').addEventListener('click', () => self.openExport());
  ['expRes','expFps','expQual','expAudio'].forEach(id =>
    $(id).addEventListener('change', () => self.updateExportReadout()));
  $('expStart').addEventListener('click', () => self.runExport());

  /* ---- keyboard ---- */
  const signal = self.ac.signal;
  document.addEventListener('keydown', e => {
    if(!self.ctx.stage.closest('[data-active-tab]')) return;
    if(e.key === 'Escape'){
      if(self.pickMode){ self.endPick(); return; }
      const open = self.ctx.stage.closest('[data-active-tab]')?.querySelector('.rc-overlay:not([hidden])');
      if(open){ self.closeModal(open.id); return; }
    }
    const tag = (e.target.tagName || '').toLowerCase();
    if(tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if(!self.video.loaded) return;
    if(e.key === ' '){ e.preventDefault(); self.video.toggle(); }
    else if(e.key === 'ArrowLeft'){ e.preventDefault(); self.video.step(-1); }
    else if(e.key === 'ArrowRight'){ e.preventDefault(); self.video.step(1); }
  }, { signal });

  /* ---- resize ---- */
  let rt;
  window.addEventListener('resize', () => {
    clearTimeout(rt);
    rt = setTimeout(() => self.fitStage(), 100);
  }, { signal });
  self._ro = new ResizeObserver(() => self.fitStage());
  self._ro.observe($('stage'));

  window.addEventListener('beforeunload', () => {
    if(self.exporter.active) self.exporter.cancel();
    self.video.destroy();
  }, { signal });
};

/* ---- modal helpers ---- */
UIController.prototype.openModal = function(id){
  const $ = this.$;
  const m = $(id);
  m.hidden = false;
  this._lastFocus = document.activeElement;
  const first = m.querySelector('input,select,textarea,button');
  if(first) first.focus();
};
UIController.prototype.closeModal = function(id){
  const $ = this.$;
  $(id).hidden = true;
  if(id === 'exportModal' && this.exporter.active) this.exporter.cancel();
  if(this._lastFocus && this._lastFocus.focus) this._lastFocus.focus();
};
UIController.prototype.confirm = function(title, body, onOk){
  const $ = this.$;
  $('confirmTitle').textContent = title;
  $('confirmBody').textContent = body;
  const ok = $('confirmOk');
  const fresh = ok.cloneNode(true);
  ok.parentNode.replaceChild(fresh, ok);
  fresh.addEventListener('click', () => { this.closeModal('confirmModal'); onOk(); });
  this.openModal('confirmModal');
};

/* ---- export flow ---- */
UIController.prototype.openExport = function(){
  const $ = this.$;
  const mime = ExportManager.pickMime();
  if(!mime){
    $('expNote').innerHTML = '<b>Recording is unavailable.</b> This browser does not support MediaRecorder with WebM. Try Chrome, Edge, or Firefox.';
    $('expStart').disabled = true;
  } else {
    $('expStart').disabled = false;
  }
  $('expProgWrap').hidden = true;
  $('expDownload').hidden = true;
  $('expStart').hidden = false;
  $('expCancel').textContent = 'Cancel';
  this.updateExportReadout();
  this.openModal('exportModal');
};

UIController.prototype.updateExportReadout = function(){
  const $ = this.$;
  const v = this.video.v;
  if(!v.videoWidth) return;
  const [w,h] = ExportManager.targetSize($('expRes').value, v.videoWidth, v.videoHeight);
  const fps = $('expFps').value === 'original' ? (this.video.fps||30) : parseInt($('expFps').value,10);
  const mime = ExportManager.pickMime();
  $('expSizeRead').textContent = w + '×' + h;
  $('expFpsRead').textContent = fps + ' fps';
  $('expMime').textContent = mime || 'unavailable';
  $('expDur').textContent = VideoController.formatTime(v.duration);
};

UIController.prototype.runExport = function(){
  const self = this;
  const $ = self.$;
  const opts = {
    resolution: $('expRes').value,
    fps: $('expFps').value,
    quality: $('expQual').value,
    audio: $('expAudio').checked
  };
  $('expProgWrap').hidden = false;
  $('expStart').hidden = true;
  $('expDownload').hidden = true;
  $('expStatus').textContent = 'Rendering in real time…';
  $('expProg').style.width = '0%';
  $('expPct').textContent = '0%';
  this.status('Exporting…', 'busy');

  this.exporter.start(opts,
    (p, cur, dur) => {
      const pct = Math.round(p*100);
      $('expProg').style.width = pct + '%';
      $('expPct').textContent = pct + '%';
      $('expStatus').textContent = `Rendering ${VideoController.formatTime(cur)} of ${VideoController.formatTime(dur)}`;
    },
    result => {
      $('expProg').style.width = '100%';
      $('expPct').textContent = '100%';
      const mb = (result.blob.size/1048576).toFixed(1);
      $('expStatus').textContent = `Done · ${mb} MB · ${result.audio ? 'with audio' : 'no audio track'}`;
      const a = $('expDownload');
      a.href = result.url;
      a.download = (self.video.fileName || 'media') + (result.still ? '-recolored.png' : '-recolored.webm');
      self.ctx.assets.add(result.blob, { name: a.download, source: 'export', origin: 'recolor' });
      a.hidden = false;
      $('expCancel').textContent = 'Close';
      $('expMime').textContent = result.mime;
      self.status('Export complete.', 'ok');
      self.renderer.resetHistory();
    },
    err => {
      $('expStatus').textContent = 'Failed: ' + err.message;
      $('expStart').hidden = false;
      self.status('Export failed: ' + err.message, 'err');
    }
  );
};


/* ---- Lathe integration ---- */
/** An asset handed over by the shell (drop anywhere, tray, Send to). */
UIController.prototype.loadAsset = function(a){
  this.ctx.settings.set('lastAsset', a.id);
  const f = a.blob instanceof File ? a.blob : new File([a.blob], a.name, { type: a.type });
  return this.handleFile(f);
};
/** Tear down: listeners, render loop, media, audio graph, GL context. */
UIController.prototype.destroy = function(){
  this.ac.abort();
  if(this._offActivate) this._offActivate();
  if(this._ro) this._ro.disconnect();
  cancelAnimationFrame(this._raf);
  clearTimeout(this._persistT);
  try { if(this.exporter.active) this.exporter.cancel(); } catch(e){}
  try { this.video.pause(); this.video.destroy(); } catch(e){}
  try { if(this.exporter.audioCtx) this.exporter.audioCtx.close(); } catch(e){}
  try { const ext = this.renderer.gl && this.renderer.gl.getExtension('WEBGL_lose_context'); if(ext) ext.loseContext(); } catch(e){}
};
