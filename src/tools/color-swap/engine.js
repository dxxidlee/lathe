/* tokens-exempt: shaders, color math and the default palette are content, not Lathe's interface.

   Color-swap engine, ported from reference/color-swap/index.html: shaders, OKLab color math,
   palette/mapping managers, WebGL2 recolor renderer, k-means analyzer, media and export managers.
   Kept as JavaScript, verbatim apart from these marked Lathe fixes (see VERIFY.md):
   - transparent stills keep their alpha (shader alpha pass-through, still canvas as the frame
     source, alpha-enabled export renderer);
   - WebM exports get their duration written into the header (fix-webm-duration);
   - the default palette comes from the defaults manifest; swatch names neutralised. */
import fixWebmDuration from 'fix-webm-duration';
/* ============================================================
   SHADERS
   ============================================================ */
const VERT_SRC = `#version 300 es
in vec2 aPos;
out vec2 vUv;
uniform bool uFlipY;
void main(){
  vUv = vec2(aPos.x*0.5+0.5, uFlipY ? (0.5-aPos.y*0.5) : (aPos.y*0.5+0.5));
  gl_Position = vec4(aPos,0.0,1.0);
}`;

/* Pass-through used for the temporal history copy. */
const COPY_SRC = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uTex;
void main(){ outColor = texture(uTex,vUv); }`;

const MAX_COLORS = 16;
const MAX_RULES  = 12;
const MAX_CLUST  = 8;
const MAX_PRESERVE = 6;

/* ------------------------------------------------------------
   Main recolor shader.

   Pipeline per pixel:
     sRGB -> linear -> OKLab (L, a, b)
     split L (lightness) from chroma (C, h)
     classify: shadow / midtone / highlight, neutral-ness
     score every enabled palette color against the pixel using
       role fit x weight x hue affinity x perceptual distance
     manual rules and cluster assignments override the score
     blend chroma toward the winner, keep source L, then
       re-impose the target's own tonal shape so highlights and
       shadows read as that color rather than as a flat tint
     saturation ceiling, gamut clamp, local contrast restore
     temporal blend against previous frame
   ------------------------------------------------------------ */
const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uFrame;     // current video frame
uniform sampler2D uPrev;      // previous processed frame (temporal)
uniform bool  uHasPrev;
uniform vec2  uTexel;         // 1/resolution
uniform float uSplit;         // split position 0..1
uniform int   uView;          // 0 original, 1 recolored, 2 split

// palette
uniform int   uCount;
uniform vec3  uPalLab[${MAX_COLORS}];   // OKLab of each palette color
uniform float uPalWeight[${MAX_COLORS}];
uniform int   uPalRole[${MAX_COLORS}];  // 0 primary 1 shadow 2 mid 3 high 4 neutral 5 accent 6 protect

// clusters (stable source-color families from analysis)
uniform int   uClusterCount;
uniform vec3  uClustLab[${MAX_CLUST}];
uniform int   uClustTarget[${MAX_CLUST}];  // palette index, -1 = auto
uniform float uClustStrength[${MAX_CLUST}];
uniform float uClustProtect[${MAX_CLUST}];

// manual rules
uniform int   uRuleCount;
uniform vec3  uRuleSrcLab[${MAX_RULES}];
uniform float uRuleSrcHue[${MAX_RULES}];
uniform int   uRuleTarget[${MAX_RULES}];
uniform vec4  uRuleTol[${MAX_RULES}];      // hue, sat, bright, strength
uniform float uRuleFeather[${MAX_RULES}];

// preserved source colors
uniform int   uPreserveCount;
uniform vec4  uPreserve[${MAX_PRESERVE}];  // xyz = OKLab, w = radius

// settings
uniform float uStrength, uLumaPreserve, uTexture, uShadowProtect, uHighlightProtect;
uniform float uNeutral, uAccentFreq, uSoftness, uSatLimit, uTemporal, uSeparation, uSkin;

const float PI = 3.14159265359;

/* ---------- sRGB <-> linear ---------- */
vec3 srgbToLinear(vec3 c){
  return mix(c/12.92, pow((c+0.055)/1.055, vec3(2.4)), step(0.04045, c));
}
vec3 linearToSrgb(vec3 c){
  c = max(c, 0.0);
  return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4))-0.055, step(0.0031308, c));
}

/* ---------- OKLab (Björn Ottosson) ----------
   Perceptually uniform: equal numeric steps look like equal
   perceptual steps, so distance and blending behave sanely. */
vec3 linearToOklab(vec3 c){
  float l = 0.4122214708*c.r + 0.5363325363*c.g + 0.0514459929*c.b;
  float m = 0.2119034982*c.r + 0.6806995451*c.g + 0.1073969566*c.b;
  float s = 0.0883024619*c.r + 0.2817188376*c.g + 0.6299787005*c.b;
  float l_ = sign(l)*pow(abs(l), 1.0/3.0);
  float m_ = sign(m)*pow(abs(m), 1.0/3.0);
  float s_ = sign(s)*pow(abs(s), 1.0/3.0);
  return vec3(
    0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
    1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
    0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_);
}
vec3 oklabToLinear(vec3 lab){
  float l_ = lab.x + 0.3963377774*lab.y + 0.2158037573*lab.z;
  float m_ = lab.x - 0.1055613458*lab.y - 0.0638541728*lab.z;
  float s_ = lab.x - 0.0894841775*lab.y - 1.2914855480*lab.z;
  float l = l_*l_*l_, m = m_*m_*m_, s = s_*s_*s_;
  return vec3(
    +4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
    -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
    -0.0041960863*l - 0.7034186147*m + 1.7076147010*s);
}
float labChroma(vec3 lab){ return length(lab.yz); }
float labHue(vec3 lab){ return atan(lab.z, lab.y); }

/* Shortest angular distance, normalized 0..1 (1 = opposite hue). */
float hueDist(float h1, float h2){
  float d = abs(h1-h2);
  d = min(d, 2.0*PI-d);
  return d/PI;
}

/* Role fit: how well a palette role suits this pixel's lightness.
   Keeps deep shadows out of highlight colors and vice versa. */
float roleFit(int role, float L, float neutralness, float chroma){
  // Strongly chromatic pixels must not be claimed by achromatic roles,
  // or a saturated cyan object washes out to white instead of taking
  // a palette color. Scales highlight/neutral down as chroma rises.
  float chromatic = smoothstep(0.02, 0.11, chroma);
  if(role==1) return smoothstep(0.62,0.10,L);           // shadow
  if(role==3) return smoothstep(0.55,0.95,L) * (1.0 - chromatic*0.85);
  if(role==2) return 1.0-abs(L-0.5)*1.7;                // midtone
  if(role==4) return (neutralness*0.85+0.15) * (1.0 - chromatic*0.90);
  // Accents compete only where the source is genuinely saturated. The
  // base term is boosted so the slider spans a useful range instead of
  // being double-penalized by the low accent weights; hue affinity in
  // the caller still decides which accent, so they stay selective.
  if(role==5) return smoothstep(0.05,0.16,chroma) * (0.35 + uAccentFreq*1.0);
  if(role==0) return 0.55+0.45*(1.0-abs(L-0.45)*1.5);   // primary
  return 0.0;                                            // protect: never a target
}

/* Approximate skin-tone range in OKLab: warm hue band, moderate
   chroma, mid-to-high lightness. This is a color-range guard, not
   face or person detection. */
float skinMask(vec3 lab, float C, float h){
  // Widened bands and a gamma lift so a genuine skin pixel reaches ~1.0.
  // Multiplying three partial ramps otherwise caps the mask near 0.5 and
  // the protection slider barely bites.
  float hd  = 1.0 - smoothstep(0.10, 0.42, hueDist(h, 0.97));
  float cd  = smoothstep(0.006, 0.030, C) * (1.0 - smoothstep(0.16, 0.28, C));
  float ld  = smoothstep(0.18, 0.34, lab.x) * (1.0 - smoothstep(0.84, 0.97, lab.x));
  return clamp(pow(hd*cd*ld, 0.45), 0.0, 1.0);
}

void main(){
  vec4 srcTex = texture(uFrame, vUv);
  vec3 srcSrgb = srcTex.rgb;
  float srcA = srcTex.a;   // Lathe fix: keep source alpha (transparent stills)

  if(uView==0){ outColor = vec4(srcSrgb,srcA); return; }
  if(uView==2 && vUv.x < uSplit){ outColor = vec4(srcSrgb,srcA); return; }

  vec3 lin = srgbToLinear(srcSrgb);
  vec3 lab = linearToOklab(lin);
  float L  = clamp(lab.x, 0.0, 1.0);
  float C  = labChroma(lab);
  float h  = labHue(lab);

  /* --- classify the pixel --- */
  float neutralness = 1.0 - smoothstep(0.006, 0.075, C);
  float shadowAmt   = smoothstep(0.42, 0.06, L);
  float highAmt     = smoothstep(0.66, 0.97, L);
  float skin        = skinMask(lab, C, h) * uSkin;

  /* --- local contrast: how much this pixel deviates from its
         neighborhood. Preserved and re-added after recoloring so
         texture and fine detail survive. --- */
  float lSum = 0.0;
  lSum += linearToOklab(srgbToLinear(texture(uFrame, vUv+vec2( uTexel.x,0.0)).rgb)).x;
  lSum += linearToOklab(srgbToLinear(texture(uFrame, vUv+vec2(-uTexel.x,0.0)).rgb)).x;
  lSum += linearToOklab(srgbToLinear(texture(uFrame, vUv+vec2(0.0, uTexel.y)).rgb)).x;
  lSum += linearToOklab(srgbToLinear(texture(uFrame, vUv+vec2(0.0,-uTexel.y)).rgb)).x;
  lSum += linearToOklab(srgbToLinear(texture(uFrame, vUv+uTexel*vec2( 1.0, 1.0)).rgb)).x;
  lSum += linearToOklab(srgbToLinear(texture(uFrame, vUv+uTexel*vec2(-1.0, 1.0)).rgb)).x;
  lSum += linearToOklab(srgbToLinear(texture(uFrame, vUv+uTexel*vec2( 1.0,-1.0)).rgb)).x;
  lSum += linearToOklab(srgbToLinear(texture(uFrame, vUv+uTexel*vec2(-1.0,-1.0)).rgb)).x;
  float localMean = lSum/8.0;
  float detail    = L - localMean;

  /* --- snap this pixel to its nearest stable source cluster.
         Using a fixed cluster set (computed once from sampled
         frames) is what keeps mapping consistent between frames
         instead of re-deciding per frame. --- */
  int   clustIdx = -1;
  float clustD   = 1e9;
  for(int i=0;i<${MAX_CLUST};i++){
    if(i>=uClusterCount) break;
    vec3 d = uClustLab[i]-lab;
    // weight chroma difference more than lightness: a light and a
    // dark blue belong to the same family, blue and green do not.
    float dist = d.x*d.x*0.55 + d.y*d.y*2.4 + d.z*d.z*2.4;
    if(dist<clustD){ clustD=dist; clustIdx=i; }
  }
  float clusterProtect = 0.0;
  int   forcedTarget   = -1;
  float forcedStrength = 1.0;
  if(clustIdx>=0){
    clusterProtect = uClustProtect[clustIdx];
    forcedStrength = uClustStrength[clustIdx];
    if(uClustTarget[clustIdx]>=0) forcedTarget = uClustTarget[clustIdx];
  }

  /* --- manual rules override clusters --- */
  float ruleWeight = 0.0;
  int   ruleTarget = -1;
  for(int i=0;i<${MAX_RULES};i++){
    if(i>=uRuleCount) break;
    if(uRuleTarget[i]<0) continue;
    vec3  rl = uRuleSrcLab[i];
    float rC = labChroma(rl);
    float hueOk, satOk, briOk;
    // Achromatic sources are matched by lightness only; hue is
    // meaningless for near-grays and would match randomly.
    if(rC < 0.012 || C < 0.012){
      hueOk = 1.0 - smoothstep(0.02, 0.02+uRuleTol[i].y*0.35, abs(C-rC));
    } else {
      hueOk = 1.0 - smoothstep(uRuleTol[i].x*0.55, uRuleTol[i].x, hueDist(h, uRuleSrcHue[i]));
    }
    satOk = 1.0 - smoothstep(uRuleTol[i].y*0.6, uRuleTol[i].y, abs(C-rC));
    briOk = 1.0 - smoothstep(uRuleTol[i].z*0.6, uRuleTol[i].z, abs(L-rl.x));
    float m = hueOk*satOk*briOk;
    m = pow(clamp(m,0.0,1.0), mix(2.2, 0.45, uRuleFeather[i]));
    m *= uRuleTol[i].w;
    if(m > ruleWeight){ ruleWeight = m; ruleTarget = uRuleTarget[i]; }
  }

  /* --- score palette candidates --- */
  int   best = -1, second = -1;
  float bestScore = -1e9, secondScore = -1e9;
  for(int i=0;i<${MAX_COLORS};i++){
    if(i>=uCount) break;
    float w = uPalWeight[i];
    if(w <= 0.0) continue;
    int role = uPalRole[i];
    if(role==6) continue;                       // protect role is never a destination
    vec3  p  = uPalLab[i];
    float pC = labChroma(p);
    float pH = labHue(p);

    float fit = roleFit(role, L, neutralness, C);
    if(fit <= 0.0) continue;

    // hue affinity keeps a source family landing on a consistent
    // palette family; ignored when either side is near-neutral.
    float hueAff = (C>0.012 && pC>0.012) ? (1.0 - hueDist(h,pH)) : 0.5;

    // perceptual closeness in the chroma plane
    float chromaDist = distance(vec2(lab.y,lab.z), vec2(p.y,p.z));
    float near = 1.0 - clamp(chromaDist*2.6, 0.0, 1.0);

    float score = fit * (0.35+w*0.65) * (0.45 + 0.55*hueAff) * (0.55 + 0.45*near);

    // neutral sources prefer neutral/highlight roles so grays and
    // whites do not all get dragged into red
    if(neutralness>0.5 && (role==4||role==3)) score *= 1.0 + uNeutral*1.5;
    if(neutralness>0.5 && role==5)            score *= 1.0 - uNeutral*0.85;

    if(score>bestScore){ secondScore=bestScore; second=best; bestScore=score; best=i; }
    else if(score>secondScore){ secondScore=score; second=i; }
  }
  if(best<0){ outColor = vec4(srcSrgb,srcA); return; }

  /* --- resolve the target, honoring overrides --- */
  int   tgt = best;
  float overrideAmt = 0.0;
  if(forcedTarget>=0 && forcedTarget<uCount){ tgt = forcedTarget; overrideAmt = 1.0; }
  if(ruleTarget>=0   && ruleTarget<uCount){   tgt = ruleTarget;   overrideAmt = ruleWeight; }

  vec3 target = uPalLab[tgt];

  /* --- Palette softness blends between a strict single-color
         result and a natural blend with the runner-up. Color
         separation pushes the opposite way so neighboring palette
         colors do not average into mud. --- */
  if(second>=0 && overrideAmt<0.99){
    float sep = clamp(1.0-uSeparation, 0.0, 1.0);
    float mixAmt = uSoftness * sep * 0.5;
    float gap = clamp((bestScore-secondScore)/max(bestScore,1e-4), 0.0, 1.0);
    mixAmt *= (1.0-gap);
    target = mix(target, uPalLab[second], mixAmt);
  }

  float tC = labChroma(target);
  float tH = labHue(target);

  /* --- Reconstruct the target's tonal shape.
         Rather than tinting flat, rebuild chroma as a function of
         the source lightness: shadows of a color are less chromatic
         and slightly hue-rotated, highlights desaturate toward the
         light. This is what makes it read as designed color rather
         than a gradient map. --- */
  float shape = 1.0 - abs(L-0.55)*1.25;
  shape = clamp(shape, 0.18, 1.0);
  // Shadow protection lifts the chroma floor in the darks when it is
  // low, so the control has real range instead of being pre-empted by
  // the neutral pass, which has already stripped near-black pixels.
  shape = mix(shape + shadowAmt*0.55, shape, uShadowProtect);
  float newC = tC * shape;

  // deep shadows keep less chroma so they do not glow
  newC *= mix(1.0, 0.24, shadowAmt*uShadowProtect);
  // bright areas roll off toward the light instead of clipping hot
  newC *= mix(1.0, 0.30, highAmt*uHighlightProtect);
  // low-saturation source areas stay low-saturation
  newC *= mix(1.0, 0.12, neutralness*uNeutral);

  // slight hue rotation in the darks adds depth instead of a flat wash
  float newH = tH + shadowAmt*0.10 - highAmt*0.06;

  vec3 outLab;
  outLab.x = L;
  outLab.y = cos(newH)*newC;
  outLab.z = sin(newH)*newC;

  /* --- Luminance preservation: reintroduce a controlled amount of
         the target's own lightness so a dark palette color still
         reads as dark, while uLumaPreserve keeps the original
         brightness structure dominant. --- */
  float targetL = mix(target.x, L, 0.5);
  outLab.x = mix(targetL, L, clamp(uLumaPreserve,0.0,1.0));
  // never let a region invert its tonal ordering
  outLab.x = mix(outLab.x, L, 0.22);

  /* --- restore local detail that the chroma rebuild flattened --- */
  outLab.x += detail * uTexture * 1.25;

  /* --- saturation ceiling --- */
  float outC = labChroma(outLab);
  float maxC = mix(0.055, 0.33, uSatLimit);
  if(outC > maxC){
    float k = maxC/max(outC,1e-5);
    outLab.yz *= k;
  }

  /* --- how far to move overall --- */
  float amt = uStrength;
  amt *= mix(1.0, forcedStrength, step(0.5, overrideAmt));
  amt = mix(amt, max(amt, uStrength*overrideAmt), overrideAmt);
  amt *= (1.0 - clusterProtect);
  amt *= (1.0 - skin*0.92);

  /* --- preserved sampled colors stay near their originals --- */
  for(int i=0;i<${MAX_PRESERVE};i++){
    if(i>=uPreserveCount) break;
    vec3 pl = uPreserve[i].xyz;
    float r = uPreserve[i].w;
    float d = distance(vec3(lab.x*0.6,lab.y,lab.z), vec3(pl.x*0.6,pl.y,pl.z));
    amt *= mix(1.0, 0.05, 1.0-smoothstep(r*0.45, r, d));
  }

  vec3 finalLab = mix(lab, outLab, clamp(amt,0.0,1.0));
  vec3 rgb = linearToSrgb(oklabToLinear(finalLab));

  /* --- gamut safety: if the result left sRGB, pull chroma in
         rather than letting channels clip to a false hue --- */
  for(int i=0;i<3;i++){
    float over = max(max(rgb.r,rgb.g),rgb.b);
    float under = min(min(rgb.r,rgb.g),rgb.b);
    if(over<=1.001 && under>=-0.001) break;
    finalLab.yz *= 0.86;
    rgb = linearToSrgb(oklabToLinear(finalLab));
  }
  rgb = clamp(rgb, 0.0, 1.0);

  /* --- Temporal stability: blend against the previous processed
         frame, but only where the source barely moved, so motion
         stays sharp while static areas stop shimmering. --- */
  if(uHasPrev && uTemporal > 0.001){
    vec3 prev = texture(uPrev, vUv).rgb;
    float motion = distance(prev, rgb);
    float still = 1.0 - smoothstep(0.02, 0.20, motion);
    rgb = mix(rgb, prev, uTemporal*0.72*still);
  }

  outColor = vec4(rgb, srcA);
}`;


/* ============================================================
   COLOR MATH (CPU side, mirrors the shader)
   ============================================================ */
const ColorMath = {
  hexToRgb(hex){
    let h = String(hex||'').trim().replace(/^#/,'');
    if(h.length===3) h = h.split('').map(c=>c+c).join('');
    if(!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255];
  },
  rgbToHex(r,g,b){
    const c = v => Math.max(0,Math.min(255,Math.round(v*255))).toString(16).padStart(2,'0');
    return ('#'+c(r)+c(g)+c(b)).toUpperCase();
  },
  normalizeHex(hex){
    const rgb = this.hexToRgb(hex);
    return rgb ? this.rgbToHex(rgb[0],rgb[1],rgb[2]) : null;
  },
  srgbToLinear(c){ return c<=0.04045 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); },
  linearToSrgb(c){
    c = Math.max(0,c);
    return c<=0.0031308 ? c*12.92 : 1.055*Math.pow(c,1/2.4)-0.055;
  },
  linearToOklab(r,g,b){
    const l = 0.4122214708*r + 0.5363325363*g + 0.0514459929*b;
    const m = 0.2119034982*r + 0.6806995451*g + 0.1073969566*b;
    const s = 0.0883024619*r + 0.2817188376*g + 0.6299787005*b;
    const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    return [
      0.2104542553*l_ + 0.7936177850*m_ - 0.0040720468*s_,
      1.9779984951*l_ - 2.4285922050*m_ + 0.4505937099*s_,
      0.0259040371*l_ + 0.7827717662*m_ - 0.8086757660*s_
    ];
  },
  oklabToLinear(L,a,bb){
    const l_ = L + 0.3963377774*a + 0.2158037573*bb;
    const m_ = L - 0.1055613458*a - 0.0638541728*bb;
    const s_ = L - 0.0894841775*a - 1.2914855480*bb;
    const l = l_*l_*l_, m = m_*m_*m_, s = s_*s_*s_;
    return [
      +4.0767416621*l - 3.3077115913*m + 0.2309699292*s,
      -1.2684380046*l + 2.6097574011*m - 0.3413193965*s,
      -0.0041960863*l - 0.7034186147*m + 1.7076147010*s
    ];
  },
  hexToOklab(hex){
    const rgb = this.hexToRgb(hex);
    if(!rgb) return [0,0,0];
    return this.linearToOklab(this.srgbToLinear(rgb[0]),this.srgbToLinear(rgb[1]),this.srgbToLinear(rgb[2]));
  },
  rgb255ToOklab(r,g,b){
    return this.linearToOklab(this.srgbToLinear(r/255),this.srgbToLinear(g/255),this.srgbToLinear(b/255));
  },
  oklabToHex(L,a,b){
    const lin = this.oklabToLinear(L,a,b);
    return this.rgbToHex(this.linearToSrgb(lin[0]),this.linearToSrgb(lin[1]),this.linearToSrgb(lin[2]));
  },
  chroma(lab){ return Math.hypot(lab[1],lab[2]); },
  hue(lab){ return Math.atan2(lab[2],lab[1]); },
  /* Readable text color for a swatch background. */
  contrastText(hex){
    const rgb = this.hexToRgb(hex) || [0,0,0];
    const L = this.linearToOklab(this.srgbToLinear(rgb[0]),this.srgbToLinear(rgb[1]),this.srgbToLinear(rgb[2]))[0];
    return L > 0.62 ? '#1A1A1A' : '#FFFFFF';
  }
};

/* ============================================================
   DEFAULTS
   ============================================================ */
const ROLES = ['Primary','Shadow','Midtone','Highlight','Neutral','Accent','Protect'];
const ROLE_INDEX = { Primary:0, Shadow:1, Midtone:2, Highlight:3, Neutral:4, Accent:5, Protect:6 };

const DEFAULT_PALETTE = [
  { name:'Red',              hex:'#E71324', role:'Primary',   weight:100, enabled:true, locked:false },
  { name:'Dark red',         hex:'#92001D', role:'Midtone',   weight:90,  enabled:true, locked:false },
  { name:'Deep red',         hex:'#500010', role:'Shadow',    weight:85,  enabled:true, locked:false },
  { name:'White',               hex:'#FFFFFF', role:'Highlight', weight:55,  enabled:true, locked:false },
  { name:'Stone',               hex:'#DCE2E9', role:'Neutral',   weight:60,  enabled:true, locked:false },
  { name:'Sun',                 hex:'#FF9D00', role:'Accent',    weight:22,  enabled:true, locked:false },
  { name:'Amethyst',            hex:'#A200ED', role:'Accent',    weight:28,  enabled:true, locked:false },
  { name:'Ocean',               hex:'#00B0F2', role:'Accent',    weight:18,  enabled:true, locked:false }
];

/* Each setting: uniform key, label, default, tooltip. */
const SETTING_DEFS = [
  { key:'strength',         label:'Recolor strength',    def:0.85, tip:'How far source colors move toward the palette. At 0 the frame is untouched.' },
  { key:'lumaPreserve',     label:'Luminance preservation', def:0.78, tip:'Keeps the original brightness structure. Lower values let palette colors impose their own lightness.' },
  { key:'texture',          label:'Texture preservation', def:0.70, tip:'Re-adds fine local detail after recoloring so surfaces do not turn into flat blocks.' },
  { key:'shadowProtect',    label:'Shadow protection',   def:0.72, tip:'Holds chroma out of deep shadows so darks stay dark instead of glowing.' },
  { key:'highlightProtect', label:'Highlight protection', def:0.68, tip:'Rolls bright areas off toward the light so they do not clip into fluorescent color.' },
  { key:'neutral',          label:'Neutral preservation', def:0.62, tip:'Keeps whites, grays, and blacks near-neutral rather than pulling them into a brand color.' },
  { key:'accentFreq',       label:'Accent frequency',    def:0.30, tip:'How often accent colors win a region. Low values keep the primary color dominant.' },
  { key:'softness',         label:'Palette softness',    def:0.35, tip:'Blends between neighboring palette colors. High values are natural, low values are graphic and strict.' },
  { key:'satLimit',         label:'Saturation limit',    def:0.58, tip:'Ceiling on output chroma. Prevents clipped or fluorescent results.' },
  { key:'temporal',         label:'Temporal stability',  def:0.55, tip:'Blends against the previous frame where the image is still, reducing flicker without smearing motion.' },
  { key:'separation',       label:'Color separation',    def:0.55, tip:'Stops nearby palette colors from averaging into muddy intermediates.' },
  { key:'skin',             label:'Skin-tone protection', def:0.55, tip:'Reduces recoloring inside an approximate skin hue range. This is a color-range guard, not person detection.' }
];

const PRESETS = {
  'Balanced': {},
  'Red Dominant': { accentFreq:0.08, neutral:0.40, strength:0.95, separation:0.70, satLimit:0.62 },
  'Cinematic':    { strength:0.70, lumaPreserve:0.88, shadowProtect:0.85, highlightProtect:0.80,
                    satLimit:0.42, softness:0.60, texture:0.80, temporal:0.68, accentFreq:0.18 },
  'Graphic':      { strength:1.0, lumaPreserve:0.45, softness:0.05, separation:0.90, texture:0.35,
                    satLimit:0.80, neutral:0.30, accentFreq:0.42 },
  'Preserve Neutrals': { neutral:0.95, strength:0.72, accentFreq:0.15, satLimit:0.48, highlightProtect:0.85 },
  'Maximum Palette':   { strength:1.0, neutral:0.10, accentFreq:0.55, satLimit:0.85, softness:0.20,
                         lumaPreserve:0.60, separation:0.75 },
  'Subtle Brand Grade':{ strength:0.34, lumaPreserve:0.92, satLimit:0.36, accentFreq:0.10,
                         neutral:0.80, softness:0.65, texture:0.85, temporal:0.70 }
};

/* ============================================================
   PaletteManager
   ============================================================ */
class PaletteManager {
  constructor(defaults = DEFAULT_PALETTE){ this.defaultList = defaults; this.colors = this.defaults(); this.onChange = null; }
  defaults(){ return this.defaultList.map(c => ({...c})); }
  get active(){ return this.colors.filter(c => c.enabled); }

  /* Index within the full list, used by rules and clusters so
     indices stay valid when colors are disabled rather than removed. */
  indexOf(color){ return this.colors.indexOf(color); }

  add(){
    if(this.colors.length >= MAX_COLORS) return false;
    this.colors.push({ name:'New color', hex:'#808080', role:'Midtone', weight:40, enabled:true, locked:false });
    this.changed(); return true;
  }
  remove(i){
    if(this.colors.length <= 2) return false;
    this.colors.splice(i,1); this.changed(); return true;
  }
  /* Reset restores defaults but keeps locked colors intact, since a
     lock means "automatic balancing must not alter this color". */
  reset(){
    const locked = this.colors.filter(c => c.locked);
    const fresh = this.defaults().filter(d => !locked.some(l => l.hex === d.hex));
    this.colors = locked.concat(fresh).slice(0, MAX_COLORS);
    this.changed();
  }

  importHex(text){
    const found = String(text||'').match(/#?[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || [];
    const hexes = [];
    for(const raw of found){
      const n = ColorMath.normalizeHex(raw);
      if(n && !hexes.includes(n)) hexes.push(n);
      if(hexes.length >= MAX_COLORS) break;
    }
    if(hexes.length < 2) return 0;
    // Keep locked colors; their influence should survive an import.
    const locked = this.colors.filter(c => c.locked);
    const fresh = hexes.map((hex,i) => {
      const lab = ColorMath.hexToOklab(hex);
      const C = ColorMath.chroma(lab);
      let role = 'Midtone';
      if(C < 0.02) role = lab[0] > 0.7 ? 'Highlight' : (lab[0] < 0.25 ? 'Shadow' : 'Neutral');
      else if(lab[0] < 0.30) role = 'Shadow';
      else if(lab[0] > 0.78) role = 'Highlight';
      else if(i === 0) role = 'Primary';
      else if(i > 4) role = 'Accent';
      return { name:'Color '+(i+1), hex, role, weight: Math.max(20, 100 - i*11), enabled:true, locked:false };
    });
    this.colors = locked.concat(fresh).slice(0, MAX_COLORS);
    this.changed();
    return fresh.length;
  }
  copyText(){ return this.colors.filter(c=>c.enabled).map(c=>c.hex).join('\n'); }

  /* Normalized weights for the shader.

     Locked colors keep their weight exactly as the user set it (scaled
     only by the fixed 0..100 range). Unlocked colors are normalized
     against the strongest unlocked color, so adding or removing colors
     rebalances them without ever changing a locked color's influence. */
  shaderWeights(){
    const out = new Float32Array(MAX_COLORS);
    let maxUnlocked = 0;
    for(const c of this.colors){
      if(c.enabled && !c.locked) maxUnlocked = Math.max(maxUnlocked, c.weight);
    }
    this.colors.forEach((c,i) => {
      if(!c.enabled){ out[i] = 0; return; }
      if(c.locked) out[i] = c.weight/100;
      else out[i] = maxUnlocked > 0 ? (c.weight/maxUnlocked) : 0;
    });
    return out;
  }
  changed(){ if(this.onChange) this.onChange(); }
}


/* ============================================================
   RecolorRenderer — WebGL2 pipeline with ping-pong history
   ============================================================ */
class RecolorRenderer {
  constructor(canvas, opts = {}){
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl2', {
      alpha:!!opts.alpha, antialias:false, depth:false, stencil:false,
      preserveDrawingBuffer:true, premultipliedAlpha:false
    });
    this.ok = !!this.gl;
    this.hasPrev = false;
    if(!this.ok) return;
    try { this.init(); }
    catch(e){ this.ok = false; this.error = e.message; }
  }

  compile(type, src){
    const gl = this.gl, sh = gl.createShader(type);
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if(!gl.getShaderParameter(sh, gl.COMPILE_STATUS)){
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('Shader compile failed: ' + log);
    }
    return sh;
  }
  link(vsSrc, fsSrc){
    const gl = this.gl, p = gl.createProgram();
    const vs = this.compile(gl.VERTEX_SHADER, vsSrc);
    const fs = this.compile(gl.FRAGMENT_SHADER, fsSrc);
    gl.attachShader(p, vs); gl.attachShader(p, fs);
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if(!gl.getProgramParameter(p, gl.LINK_STATUS)){
      const log = gl.getProgramInfoLog(p);
      throw new Error('Program link failed: ' + log);
    }
    gl.deleteShader(vs); gl.deleteShader(fs);
    return p;
  }

  init(){
    const gl = this.gl;
    this.prog = this.link(VERT_SRC, FRAG_SRC);
    this.copyProg = this.link(VERT_SRC, COPY_SRC);

    // fullscreen triangle pair
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.frameTex = this.makeTex();
    this.histTex  = [this.makeTex(), this.makeTex()];
    this.histFbo  = [gl.createFramebuffer(), gl.createFramebuffer()];
    this.histIdx  = 0;
    this.histSize = [0,0];

    // cache uniform locations once
    this.u = {};
    const n = gl.getProgramParameter(this.prog, gl.ACTIVE_UNIFORMS);
    for(let i=0;i<n;i++){
      const info = gl.getActiveUniform(this.prog, i);
      const name = info.name.replace(/\[0\]$/,'');
      this.u[name] = gl.getUniformLocation(this.prog, name);
    }
    this.uCopyTex   = gl.getUniformLocation(this.copyProg, 'uTex');
    this.uCopyFlip  = gl.getUniformLocation(this.copyProg, 'uFlipY');
  }

  makeTex(){
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  resize(w,h){
    if(this.canvas.width !== w || this.canvas.height !== h){
      this.canvas.width = w; this.canvas.height = h;
      this.hasPrev = false;
    }
    if(this.histSize[0] !== w || this.histSize[1] !== h){
      const gl = this.gl;
      for(let i=0;i<2;i++){
        gl.bindTexture(gl.TEXTURE_2D, this.histTex[i]);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.histFbo[i]);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.histTex[i], 0);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.histSize = [w,h];
      this.hasPrev = false;
    }
  }

  uploadFrame(video){
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, video);
    } catch(e){ return false; }
    return true;
  }

  /* state: { palette, clusters, rules, preserve, settings, view, split } */
  render(video, state){
    if(!this.ok) return false;
    const gl = this.gl;
    const w = this.canvas.width, h = this.canvas.height;
    if(w < 2 || h < 2) return false;
    if(!this.uploadFrame(video)) return false;

    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.viewport(0,0,w,h);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.uniform1i(this.u.uFrame, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.histTex[this.histIdx]);
    gl.uniform1i(this.u.uPrev, 1);
    gl.uniform1i(this.u.uHasPrev, this.hasPrev ? 1 : 0);

    gl.uniform2f(this.u.uTexel, 1/w, 1/h);
    gl.uniform1f(this.u.uSplit, state.split);
    gl.uniform1i(this.u.uView, state.view);
    gl.uniform1i(this.u.uFlipY, 0);

    this.setPalette(state.palette);
    this.setClusters(state.clusters, state.palette);
    this.setRules(state.rules, state.palette);
    this.setPreserve(state.preserve);
    this.setSettings(state.settings);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // copy result into the history buffer for the next frame
    const next = 1 - this.histIdx;
    gl.useProgram(this.copyProg);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.histFbo[next]);
    gl.viewport(0,0,w,h);
    gl.activeTexture(gl.TEXTURE0);
    // read the freshly drawn default framebuffer via a texture copy
    gl.bindTexture(gl.TEXTURE_2D, this.histTex[next]);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 0, 0, w, h, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.histIdx = next;
    this.hasPrev = true;

    gl.bindVertexArray(null);
    return true;
  }

  setPalette(pm){
    const gl = this.gl, list = pm.colors;
    const lab = new Float32Array(MAX_COLORS*3);
    const role = new Int32Array(MAX_COLORS);
    const weights = pm.shaderWeights();
    for(let i=0;i<list.length && i<MAX_COLORS;i++){
      const L = ColorMath.hexToOklab(list[i].hex);
      lab[i*3]=L[0]; lab[i*3+1]=L[1]; lab[i*3+2]=L[2];
      role[i] = ROLE_INDEX[list[i].role] ?? 2;
    }
    gl.uniform1i(this.u.uCount, Math.min(list.length, MAX_COLORS));
    gl.uniform3fv(this.u.uPalLab, lab);
    gl.uniform1fv(this.u.uPalWeight, weights);
    gl.uniform1iv(this.u.uPalRole, role);
  }

  setClusters(clusters, pm){
    const gl = this.gl;
    const lab = new Float32Array(MAX_CLUST*3);
    const tgt = new Int32Array(MAX_CLUST).fill(-1);
    const str = new Float32Array(MAX_CLUST).fill(1);
    const pro = new Float32Array(MAX_CLUST);
    const n = Math.min(clusters.length, MAX_CLUST);
    for(let i=0;i<n;i++){
      const c = clusters[i];
      lab[i*3]=c.lab[0]; lab[i*3+1]=c.lab[1]; lab[i*3+2]=c.lab[2];
      tgt[i] = (c.target != null && c.target >= 0 && c.target < pm.colors.length && pm.colors[c.target].enabled) ? c.target : -1;
      str[i] = c.strength;
      pro[i] = c.protect ? 1 : 0;
    }
    gl.uniform1i(this.u.uClusterCount, n);
    gl.uniform3fv(this.u.uClustLab, lab);
    gl.uniform1iv(this.u.uClustTarget, tgt);
    gl.uniform1fv(this.u.uClustStrength, str);
    gl.uniform1fv(this.u.uClustProtect, pro);
  }

  setRules(rules, pm){
    const gl = this.gl;
    const src = new Float32Array(MAX_RULES*3);
    const hue = new Float32Array(MAX_RULES);
    const tgt = new Int32Array(MAX_RULES).fill(-1);
    const tol = new Float32Array(MAX_RULES*4);
    const fea = new Float32Array(MAX_RULES);
    const on = rules.filter(r => r.enabled).slice(0, MAX_RULES);
    on.forEach((r,i) => {
      const L = ColorMath.hexToOklab(r.source);
      src[i*3]=L[0]; src[i*3+1]=L[1]; src[i*3+2]=L[2];
      hue[i] = ColorMath.hue(L);
      tgt[i] = (r.target >= 0 && r.target < pm.colors.length && pm.colors[r.target].enabled) ? r.target : -1;
      tol[i*4]   = Math.max(0.02, r.hueTol);
      tol[i*4+1] = Math.max(0.01, r.satTol);
      tol[i*4+2] = Math.max(0.01, r.briTol);
      tol[i*4+3] = r.strength;
      fea[i] = r.feather;
    });
    gl.uniform1i(this.u.uRuleCount, on.length);
    gl.uniform3fv(this.u.uRuleSrcLab, src);
    gl.uniform1fv(this.u.uRuleSrcHue, hue);
    gl.uniform1iv(this.u.uRuleTarget, tgt);
    gl.uniform4fv(this.u.uRuleTol, tol);
    gl.uniform1fv(this.u.uRuleFeather, fea);
  }

  setPreserve(list){
    const gl = this.gl;
    const arr = new Float32Array(MAX_PRESERVE*4);
    const n = Math.min(list.length, MAX_PRESERVE);
    for(let i=0;i<n;i++){
      const L = ColorMath.hexToOklab(list[i].hex);
      arr[i*4]=L[0]; arr[i*4+1]=L[1]; arr[i*4+2]=L[2]; arr[i*4+3]=list[i].radius;
    }
    gl.uniform1i(this.u.uPreserveCount, n);
    gl.uniform4fv(this.u.uPreserve, arr);
  }

  setSettings(s){
    const gl = this.gl, u = this.u;
    gl.uniform1f(u.uStrength, s.strength);
    gl.uniform1f(u.uLumaPreserve, s.lumaPreserve);
    gl.uniform1f(u.uTexture, s.texture);
    gl.uniform1f(u.uShadowProtect, s.shadowProtect);
    gl.uniform1f(u.uHighlightProtect, s.highlightProtect);
    gl.uniform1f(u.uNeutral, s.neutral);
    gl.uniform1f(u.uAccentFreq, s.accentFreq);
    gl.uniform1f(u.uSoftness, s.softness);
    gl.uniform1f(u.uSatLimit, s.satLimit);
    gl.uniform1f(u.uTemporal, s.temporal);
    gl.uniform1f(u.uSeparation, s.separation);
    gl.uniform1f(u.uSkin, s.skin);
  }

  resetHistory(){ this.hasPrev = false; }
}

/* ============================================================
   ColorAnalyzer — samples frames, runs k-means in OKLab.
   Async and chunked so the UI never blocks.
   ============================================================ */
class ColorAnalyzer {
  constructor(){
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently:true });
    this.cancelled = false;
    this.SAMPLE_W = 96;
  }
  cancel(){ this.cancelled = true; }

  /* Seek the video to each sample point and read pixels back. */
  async collect(video, frameCount, onProgress){
    this.cancelled = false;
    const dur = video.duration;
    const still = !isFinite(dur) || dur <= 0;
    const vw = video.videoWidth || (video.width||0);
    const vh = video.videoHeight || (video.height||0);
    if(!vw || !vh) throw new Error('Media dimensions unavailable.');
    const ar = vh / Math.max(1, vw);
    const w = this.SAMPLE_W, h = Math.max(2, Math.round(w*ar));
    this.canvas.width = w; this.canvas.height = h;

    const samples = [];
    const pushFrame = () => {
      this.ctx.drawImage(video, 0, 0, w, h);
      let data;
      try { data = this.ctx.getImageData(0,0,w,h).data; }
      catch(e){ throw new Error('Cannot read pixels. The file may be cross-origin protected.'); }
      for(let p=0;p<data.length;p+=4){
        if(data[p+3] < 128) continue;
        samples.push(ColorMath.rgb255ToOklab(data[p],data[p+1],data[p+2]));
      }
    };

    if(still){
      const passes = Math.min(4, Math.max(1, frameCount));
      for(let i=0;i<passes;i++){
        if(this.cancelled) break;
        pushFrame();
        if(onProgress) onProgress((i+1)/passes * 0.6);
        await this.yield();
      }
      return samples;
    }

    const wasPaused = video.paused;
    const resumeAt = video.currentTime;
    video.pause();

    for(let i=0;i<frameCount;i++){
      if(this.cancelled) break;
      const t = dur * (i + 0.5) / frameCount;
      await this.seek(video, Math.min(Math.max(t, 0), Math.max(0, dur - 0.05)));
      pushFrame();
      if(onProgress) onProgress((i+1)/frameCount * 0.6);
      await this.yield();
    }

    try {
      await this.seek(video, resumeAt);
      if(!wasPaused) await video.play().catch(()=>{});
    } catch(e){ /* seeking back is best-effort */ }

    return samples;
  }

  seek(video, t){
    return new Promise((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => { if(!done){ done=true; cleanup(); resolve(); } }, 2500);
      const onSeek = () => { if(!done){ done=true; clearTimeout(timer); cleanup(); resolve(); } };
      const cleanup = () => video.removeEventListener('seeked', onSeek);
      video.addEventListener('seeked', onSeek);
      try { video.currentTime = t; }
      catch(e){ done=true; clearTimeout(timer); cleanup(); reject(e); }
    });
  }
  yield(){ return new Promise(r => setTimeout(r, 0)); }

  /* k-means++ style seeding, then chunked Lloyd iterations. */
  async kmeans(samples, k, onProgress){
    if(samples.length === 0) return [];
    k = Math.min(k, Math.max(2, Math.floor(samples.length/40)) , samples.length);
    if(k < 2) k = Math.min(2, samples.length);

    const dist2 = (a,b) => {
      const dl=a[0]-b[0], da=a[1]-b[1], db=a[2]-b[2];
      // chroma weighted higher so hue families separate before tone
      return dl*dl*0.55 + da*da*2.4 + db*db*2.4;
    };

    // seed: first point random, rest biased toward far-away points
    const centers = [samples[Math.floor(Math.random()*samples.length)].slice()];
    while(centers.length < k){
      let bestP = null, bestD = -1;
      const tries = Math.min(320, samples.length);
      for(let t=0;t<tries;t++){
        const p = samples[Math.floor(Math.random()*samples.length)];
        let nearest = Infinity;
        for(const c of centers) nearest = Math.min(nearest, dist2(p,c));
        if(nearest > bestD){ bestD = nearest; bestP = p; }
      }
      centers.push(bestP.slice());
    }

    const assign = new Int32Array(samples.length);
    const ITER = 12;
    for(let it=0; it<ITER; it++){
      if(this.cancelled) break;
      let moved = 0;
      for(let i=0;i<samples.length;i++){
        let bi=0, bd=Infinity;
        for(let c=0;c<centers.length;c++){
          const d = dist2(samples[i], centers[c]);
          if(d<bd){ bd=d; bi=c; }
        }
        if(assign[i]!==bi){ assign[i]=bi; moved++; }
      }
      const sums = centers.map(()=>[0,0,0,0]);
      for(let i=0;i<samples.length;i++){
        const s = sums[assign[i]], p = samples[i];
        s[0]+=p[0]; s[1]+=p[1]; s[2]+=p[2]; s[3]++;
      }
      for(let c=0;c<centers.length;c++){
        if(sums[c][3] > 0){
          centers[c][0]=sums[c][0]/sums[c][3];
          centers[c][1]=sums[c][1]/sums[c][3];
          centers[c][2]=sums[c][2]/sums[c][3];
        }
      }
      if(onProgress) onProgress(0.6 + (it+1)/ITER*0.4);
      await this.yield();
      if(moved === 0) break;
    }

    const counts = new Array(centers.length).fill(0);
    for(let i=0;i<samples.length;i++) counts[assign[i]]++;

    return centers.map((lab,i) => ({
      lab,
      share: counts[i]/samples.length,
      hex: ColorMath.oklabToHex(lab[0],lab[1],lab[2])
    })).filter(c => c.share > 0.004)
       .sort((a,b) => b.share - a.share);
  }

  /* Pick a sensible palette destination for a detected cluster. */
  suggest(cluster, pm){
    const lab = cluster.lab, C = ColorMath.chroma(lab), L = lab[0], H = ColorMath.hue(lab);
    let best = -1, bestScore = -Infinity;
    pm.colors.forEach((col, i) => {
      if(!col.enabled || col.role === 'Protect') return;
      const pl = ColorMath.hexToOklab(col.hex);
      const pC = ColorMath.chroma(pl), pH = ColorMath.hue(pl);
      let score = 0;
      // tonal agreement
      score += (1 - Math.abs(L - pl[0])) * 1.5;
      // role agreement with the cluster's position in the range
      if(L < 0.32 && col.role === 'Shadow') score += 1.3;
      else if(L > 0.72 && (col.role === 'Highlight' || col.role === 'Neutral')) score += 1.2;
      else if(col.role === 'Primary' || col.role === 'Midtone') score += 0.8;
      // neutral sources should land on neutral destinations
      if(C < 0.03){
        if(col.role === 'Neutral' || col.role === 'Highlight' || col.role === 'Shadow') score += 1.1;
        if(col.role === 'Accent') score -= 1.4;
      } else {
        let hd = Math.abs(H - pH); hd = Math.min(hd, Math.PI*2 - hd) / Math.PI;
        score += (1 - hd) * 0.9;
        if(col.role === 'Accent') score -= 0.5;
      }
      score += col.weight / 100 * 0.7;
      if(score > bestScore){ bestScore = score; best = i; }
    });
    return best;
  }
}


/* ============================================================
   VideoController
   ============================================================ */
class VideoController {
  constructor(video){
    this.v = video;
    this.fps = 30;
    this.loaded = false;
    this.objectUrl = null;
    this.isStill = false;
    this.v.loop = true;
    this.v.muted = false;
  }

  load(file){
    if(!file) return Promise.reject(new Error('No file selected.'));
    const isImage = !!(file.type && file.type.startsWith('image/'));
    const isVideo = !!(file.type && file.type.startsWith('video/'));
    if(file.type && !isImage && !isVideo){
      return Promise.reject(new Error(`"${file.name}" is not an image or video file.`));
    }
    if(isImage || (!file.type && /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name))){
      return this.loadImage(file);
    }
    return this.loadVideo(file);
  }

  loadImage(file){
    return new Promise((resolve, reject) => {
      if(this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      if(this._stillStream){
        this._stillStream.getTracks().forEach(t => t.stop());
        this._stillStream = null;
      }
      this.objectUrl = URL.createObjectURL(file);
      this.loaded = false;
      this.isStill = true;
      this.fps = 1;
      this.v.removeAttribute('src');
      this.v.srcObject = null;

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          if(!canvas.width || !canvas.height){
            reject(new Error('This image has no readable dimensions.')); return;
          }
          canvas.getContext('2d').drawImage(img, 0, 0);
          this._stillCanvas = canvas;
          const stream = canvas.captureStream(1);
          this._stillStream = stream;

          const onMeta = () => {
            cleanup();
            this.loaded = true;
            this.fileName = file.name.replace(/\.[^.]+$/,'') || 'image';
            this.v.play().catch(()=>{});
            resolve();
          };
          const onErr = () => { cleanup(); reject(new Error(`Could not load "${file.name}".`)); };
          const cleanup = () => {
            this.v.removeEventListener('loadedmetadata', onMeta);
            this.v.removeEventListener('error', onErr);
            clearTimeout(timer);
          };
          const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out reading this image.')); }, 20000);
          this.v.addEventListener('loadedmetadata', onMeta);
          this.v.addEventListener('error', onErr);
          this.v.srcObject = stream;
        } catch(e){
          reject(new Error(e.message || 'Could not prepare this image.'));
        }
      };
      img.onerror = () => reject(new Error(`This browser cannot decode "${file.name}".`));
      img.src = this.objectUrl;
    });
  }

  loadVideo(file){
    return new Promise((resolve, reject) => {
      if(this.objectUrl) URL.revokeObjectURL(this.objectUrl);
      if(this._stillStream){
        this._stillStream.getTracks().forEach(t => t.stop());
        this._stillStream = null;
      }
      this.objectUrl = URL.createObjectURL(file);
      this.loaded = false;
      this.isStill = false;
      this._stillCanvas = null;
      this.v.srcObject = null;

      const onMeta = () => {
        cleanup();
        if(!this.v.videoWidth || !this.v.videoHeight){
          reject(new Error('This file has no readable video track.')); return;
        }
        this.loaded = true;
        this.fileName = file.name.replace(/\.[^.]+$/,'') || 'video';
        this.detectFps().then(() => resolve()).catch(() => resolve());
      };
      const onErr = () => {
        cleanup();
        reject(new Error(`This browser cannot decode "${file.name}". Try MP4 (H.264) or WebM.`));
      };
      const cleanup = () => {
        this.v.removeEventListener('loadedmetadata', onMeta);
        this.v.removeEventListener('error', onErr);
        clearTimeout(timer);
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out reading this video.')); }, 20000);

      this.v.addEventListener('loadedmetadata', onMeta);
      this.v.addEventListener('error', onErr);
      this.v.src = this.objectUrl;
      this.v.load();
    });
  }

  /* Estimate frame rate from requestVideoFrameCallback timestamps
     when available; fall back to 30. */
  detectFps(){
    return new Promise(resolve => {
      if(typeof this.v.requestVideoFrameCallback !== 'function'){ this.fps = 30; resolve(); return; }
      const stamps = [];
      let handle = null;
      const done = () => {
        if(stamps.length >= 3){
          const deltas = [];
          for(let i=1;i<stamps.length;i++) deltas.push(stamps[i]-stamps[i-1]);
          deltas.sort((a,b)=>a-b);
          const med = deltas[Math.floor(deltas.length/2)];
          if(med > 0.002 && med < 0.5){
            const f = Math.round(1/med);
            // snap to common rates
            const common = [23.976,24,25,29.97,30,48,50,59.94,60];
            let nearest = common.reduce((p,c)=> Math.abs(c-f)<Math.abs(p-f)?c:p, 30);
            this.fps = Math.abs(nearest - f) <= 2 ? nearest : Math.min(120, Math.max(1, f));
          }
        }
        resolve();
      };
      const step = (now, meta) => {
        stamps.push(meta.mediaTime);
        if(stamps.length >= 6){ done(); return; }
        handle = this.v.requestVideoFrameCallback(step);
      };
      const t0 = this.v.currentTime;
      this.v.muted = true;
      this.v.play().then(() => {
        handle = this.v.requestVideoFrameCallback(step);
        setTimeout(() => {
          this.v.pause();
          try { this.v.currentTime = t0; } catch(e){}
          this.v.muted = false;
          if(handle && this.v.cancelVideoFrameCallback) this.v.cancelVideoFrameCallback(handle);
          done();
        }, 700);
      }).catch(() => { this.v.muted = false; resolve(); });
    });
  }

  /** Lathe fix: stills render from their canvas, which keeps alpha; video frames from the element. */
  frameSource(){ return this.isStill && this._stillCanvas ? this._stillCanvas : this.v; }

  play(){ return this.v.play(); }
  pause(){ this.v.pause(); }
  toggle(){ return this.v.paused ? this.play() : (this.pause(), Promise.resolve()); }
  step(dir){
    this.pause();
    const dt = 1/(this.fps||30);
    const t = Math.min(Math.max(0, this.v.currentTime + dir*dt), this.v.duration||0);
    this.v.currentTime = t;
  }
  seekFrac(f){
    if(!isFinite(this.v.duration)) return;
    this.v.currentTime = Math.min(this.v.duration, Math.max(0, f*this.v.duration));
  }
  get frameIndex(){ return Math.floor(this.v.currentTime * (this.fps||30)); }
  get totalFrames(){ return Math.floor((this.v.duration||0) * (this.fps||30)); }

  static formatTime(t){
    if(!isFinite(t) || t < 0) t = 0;
    const m = Math.floor(t/60), s = Math.floor(t%60), cs = Math.floor((t%1)*100);
    return `${m}:${String(s).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
  }
  destroy(){
    if(this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    if(this._stillStream){ this._stillStream.getTracks().forEach(t => t.stop()); this._stillStream = null; }
  }
}

/* ============================================================
   MappingManager — manual rules + preserved colors
   ============================================================ */
class MappingManager {
  constructor(){ this.rules = []; this.preserve = []; this.onChange = null; }

  addRule(source='#3A6EA5', target=0){
    if(this.rules.length >= MAX_RULES) return null;
    const r = {
      id: 'r'+Date.now()+Math.random().toString(36).slice(2,6),
      source: ColorMath.normalizeHex(source) || '#3A6EA5',
      target, hueTol:0.28, satTol:0.10, briTol:0.35,
      strength:1.0, feather:0.5, enabled:true
    };
    this.rules.push(r); this.changed(); return r;
  }
  removeRule(id){ this.rules = this.rules.filter(r => r.id !== id); this.changed(); }

  addPreserve(hex){
    if(this.preserve.length >= MAX_PRESERVE) return null;
    const p = { id:'p'+Date.now()+Math.random().toString(36).slice(2,6),
                hex: ColorMath.normalizeHex(hex) || '#808080', radius:0.10 };
    this.preserve.push(p); this.changed(); return p;
  }
  removePreserve(id){ this.preserve = this.preserve.filter(p => p.id !== id); this.changed(); }
  changed(){ if(this.onChange) this.onChange(); }
}

/* ============================================================
   ExportManager — canvas.captureStream + MediaRecorder.
   WebM only; MP4 is not offered rather than faked.
   ============================================================ */
class ExportManager {
  constructor(app){
    this.app = app;
    this.recorder = null;
    this.chunks = [];
    this.active = false;
    this.blobUrl = null;
    this.audioCtx = null;
  }

  static pickMime(){
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    if(typeof MediaRecorder === 'undefined') return null;
    for(const m of candidates) if(MediaRecorder.isTypeSupported(m)) return m;
    return null;
  }

  static bitrate(quality, w, h, fps){
    const pixels = w*h*fps;
    const perPixel = quality === 'high' ? 0.14 : quality === 'medium' ? 0.08 : 0.04;
    return Math.max(600000, Math.min(48000000, Math.round(pixels*perPixel)));
  }

  static targetSize(mode, vw, vh){
    if(mode === 'original') return [vw, vh];
    const target = parseInt(mode,10);
    const scale = target / vh;
    // even dimensions keep encoders happy
    const w = Math.max(2, Math.round(vw*scale/2)*2);
    const h = Math.max(2, Math.round(target/2)*2);
    return [w, h];
  }

  async exportStill(opts, onProgress, onDone, onError){
    const app = this.app;
    const video = app.video.v;
    const vw = video.videoWidth || (app.video._stillCanvas && app.video._stillCanvas.width);
    const vh = video.videoHeight || (app.video._stillCanvas && app.video._stillCanvas.height);
    if(!vw || !vh){ onError(new Error('Image dimensions unavailable.')); return; }
    const [w,h] = ExportManager.targetSize(opts.resolution, vw, vh);
    const expCanvas = document.createElement('canvas');
    expCanvas.width = w; expCanvas.height = h;
    const expRenderer = new RecolorRenderer(expCanvas, { alpha:true });
    if(!expRenderer.ok){ onError(new Error('Could not create the export renderer: ' + (expRenderer.error||'WebGL2 unavailable'))); return; }
    expRenderer.resize(w,h);
    onProgress(0.2);
    const st = app.renderState();
    st.view = 1; // recolored
    st.split = 1;
    expRenderer.render(app.video.frameSource(), st);
    onProgress(0.8);
    expCanvas.toBlob(blob => {
      if(!blob){ onError(new Error('Could not encode PNG.')); return; }
      if(this.blobUrl) URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = URL.createObjectURL(blob);
      onDone({ url:this.blobUrl, blob, mime:'image/png', w, h, fps:1, audio:false, still:true });
    }, 'image/png');
  }

  async start(opts, onProgress, onDone, onError){
    const app = this.app;
    const video = app.video.v;
    if(app.video.isStill){
      return this.exportStill(opts, onProgress, onDone, onError);
    }
    const mime = ExportManager.pickMime();
    if(!mime){ onError(new Error('This browser cannot record video. Try Chrome, Edge, or Firefox.')); return; }

    const [w,h] = ExportManager.targetSize(opts.resolution, video.videoWidth, video.videoHeight);
    const fps = opts.fps === 'original' ? (app.video.fps||30) : parseInt(opts.fps,10);
    const duration = video.duration;
    if(!isFinite(duration) || duration <= 0){ onError(new Error('Video duration unavailable.')); return; }

    // Dedicated canvas + renderer so export resolution is independent
    // of the preview and the preview is not disturbed.
    const expCanvas = document.createElement('canvas');
    expCanvas.width = w; expCanvas.height = h;
    const expRenderer = new RecolorRenderer(expCanvas);
    if(!expRenderer.ok){ onError(new Error('Could not create the export renderer: ' + (expRenderer.error||'WebGL2 unavailable'))); return; }
    expRenderer.resize(w,h);

    const stream = expCanvas.captureStream(fps);

    // Route audio through a MediaStream destination so it is muxed in.
    let audioTrackAdded = false;
    if(opts.audio){
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if(AC && !this.audioCtx){
          this.audioCtx = new AC();
          this.srcNode = this.audioCtx.createMediaElementSource(video);
          this.dest = this.audioCtx.createMediaStreamDestination();
          this.srcNode.connect(this.dest);
          this.srcNode.connect(this.audioCtx.destination);
        }
        if(this.audioCtx){
          if(this.audioCtx.state === 'suspended') await this.audioCtx.resume();
          const tracks = this.dest.stream.getAudioTracks();
          if(tracks.length){ stream.addTrack(tracks[0]); audioTrackAdded = true; }
        }
      } catch(e){ audioTrackAdded = false; }
    }

    let recorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond: ExportManager.bitrate(opts.quality, w, h, fps)
      });
    } catch(e){ onError(new Error('Recorder rejected these settings: ' + e.message)); return; }

    this.recorder = recorder;
    this.chunks = [];
    this.active = true;
    this.cancelled = false;

    recorder.ondataavailable = e => { if(e.data && e.data.size) this.chunks.push(e.data); };
    recorder.onerror = e => { this.cleanup(video); onError(new Error('Recording failed.')); };
    recorder.onstop = async () => {
      this.cleanup(video);
      if(this.cancelled){ this.chunks = []; return; }
      let blob = new Blob(this.chunks, { type: mime.split(';')[0] });
      // Lathe fix: MediaRecorder writes no duration; patch it so players can seek.
      try { blob = await fixWebmDuration(blob, Math.round(duration*1000), { logger:false }); } catch(e){ /* keep the unpatched file */ }
      this.chunks = [];
      if(this.blobUrl) URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = URL.createObjectURL(blob);
      onDone({ url:this.blobUrl, blob, mime, w, h, fps, audio: audioTrackAdded });
    };

    // Play from the start and render every displayed frame into the
    // export canvas in real time. MediaRecorder is a realtime encoder,
    // so export takes about as long as the clip.
    const wasMuted = video.muted;
    const wasLoop = video.loop;
    video.loop = false;
    video.muted = opts.audio ? wasMuted : true;
    video.pause();
    try { video.currentTime = 0; } catch(e){}
    await new Promise(r => {
      if(video.readyState >= 2 && video.currentTime < 0.05) return r();
      const h2 = () => { video.removeEventListener('seeked', h2); r(); };
      video.addEventListener('seeked', h2);
      setTimeout(r, 1500);
    });

    this.restore = { wasMuted, wasLoop };
    const state = () => app.renderState();

    const drawOnce = () => {
      expRenderer.render(video, state());
    };
    drawOnce();
    recorder.start(250);

    const tick = () => {
      if(!this.active) return;
      drawOnce();
      const p = Math.min(1, video.currentTime / duration);
      onProgress(p, video.currentTime, duration);
      if(video.ended || video.currentTime >= duration - 0.02){
        this.finish();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };

    try { await video.play(); }
    catch(e){ this.active=false; this.cleanup(video); onError(new Error('Playback was blocked. Click the preview once, then export again.')); return; }

    this.onEnded = () => this.finish();
    video.addEventListener('ended', this.onEnded);
    this.raf = requestAnimationFrame(tick);
  }

  finish(){
    if(!this.active) return;
    this.active = false;
    if(this.raf) cancelAnimationFrame(this.raf);
    try { if(this.recorder && this.recorder.state !== 'inactive') this.recorder.stop(); }
    catch(e){ /* already stopped */ }
  }

  cancel(){
    this.cancelled = true;
    this.finish();
  }

  cleanup(video){
    if(this.raf) cancelAnimationFrame(this.raf);
    if(this.onEnded){ video.removeEventListener('ended', this.onEnded); this.onEnded = null; }
    video.pause();
    if(this.restore){
      video.muted = this.restore.wasMuted;
      video.loop = this.restore.wasLoop;
      this.restore = null;
    }
    this.active = false;
  }
}


export { MAX_COLORS, MAX_RULES, MAX_CLUST, MAX_PRESERVE, ColorMath, ROLES, ROLE_INDEX, DEFAULT_PALETTE, SETTING_DEFS, PRESETS,
  PaletteManager, RecolorRenderer, ColorAnalyzer, VideoController, MappingManager, ExportManager };
