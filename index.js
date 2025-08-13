const video = document.getElementById("player");
const glCanvas = document.getElementById("glCanvas");
const gl =
  glCanvas.getContext("webgl", { preserveDrawingBuffer: true }) ||
  glCanvas.getContext("experimental-webgl");
const toggleBtn = document.getElementById("toggle");
const fileInput = document.getElementById("file");
const intensityRange = document.getElementById("intensity");
const freqRange = document.getElementById("freq");
const filterModeSel = document.getElementById("filterMode");

const parts = {
  top: document.getElementById("g-top"),
  bottom: document.getElementById("g-bottom"),
  left: document.getElementById("g-left"),
  right: document.getElementById("g-right"),
  tl: document.getElementById("c-tl"),
  tr: document.getElementById("c-tr"),
  bl: document.getElementById("c-bl"),
  br: document.getElementById("c-br"),
};

let enabled = false;
let updateMs = parseInt(freqRange.value);
let intensity = parseFloat(intensityRange.value);
let lastTs = 0;

const emaAlpha = 0.2;
const state = {
  top: [0, 0, 0],
  bottom: [0, 0, 0],
  left: [0, 0, 0],
  right: [0, 0, 0],
  tl: [0, 0, 0],
  tr: [0, 0, 0],
  bl: [0, 0, 0],
  br: [0, 0, 0],
};

function lerp(a, b, t) {
  return a + (b - a) * t;
}

const vs = `attribute vec2 a_pos; attribute vec2 a_uv; varying vec2 v_uv; void main(){ v_uv = a_uv; gl_Position = vec4(a_pos,0.0,1.0); }`;
const fs = `precision mediump float; varying vec2 v_uv; uniform sampler2D u_tex; void main(){ gl_FragColor = texture2D(u_tex, v_uv); }`;

function createShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}
function createProgram(gl, vsSrc, fsSrc) {
  const v = createShader(gl, gl.VERTEX_SHADER, vsSrc);
  const f = createShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const p = gl.createProgram();
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error(gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

const program = createProgram(gl, vs, fs);
gl.useProgram(program);

const quadVerts = new Float32Array([
  -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0,
]);
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, quadVerts, gl.STATIC_DRAW);
const a_pos = gl.getAttribLocation(program, "a_pos");
const a_uv = gl.getAttribLocation(program, "a_uv");
gl.enableVertexAttribArray(a_pos);
gl.vertexAttribPointer(a_pos, 2, gl.FLOAT, false, 16, 0);
gl.enableVertexAttribArray(a_uv);
gl.vertexAttribPointer(a_uv, 2, gl.FLOAT, false, 16, 8);

const tex = gl.createTexture();
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

const u_tex = gl.getUniformLocation(program, "u_tex");
gl.uniform1i(u_tex, 0);


const fb = gl.createFramebuffer();

function updateGLTexture() {
  try {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  } catch (e) {
    console.error(e);
  }
}

function renderToSmall() {
  const W = glCanvas.width;
  const H = glCanvas.height;

  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

  if (!fb.tex) {
    fb.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, fb.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      W,
      H,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null
    );
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      fb.tex,
      0
    );
  }

  gl.viewport(0, 0, W, H);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  updateGLTexture();
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);


  const pixels = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { pixels, W, H };
}


function analyzePixels(pixels, W, H, mode = "avg") {

  const edgeStrip = Math.max(1, Math.floor(H * 0.12));
  const cornerSize = Math.max(1, Math.floor(Math.min(W, H) * 0.22));

  function getIdx(x, y) {
    return (y * W + x) * 4;
  }
  function regionPixels(xs, ys, xe, ye) {
    const arr = [];
    for (let y = ys; y < ye; y++)
      for (let x = xs; x < xe; x++) arr.push(getIdx(x, y));
    return arr;
  }

  const regions = {
    top: regionPixels(0, 0, W, edgeStrip),
    bottom: regionPixels(0, H - edgeStrip, W, H),
    left: regionPixels(0, 0, edgeStrip, H),
    right: regionPixels(W - edgeStrip, 0, W, H),
    tl: regionPixels(0, 0, cornerSize, cornerSize),
    tr: regionPixels(W - cornerSize, 0, W, cornerSize),
    bl: regionPixels(0, H - cornerSize, cornerSize, H),
    br: regionPixels(W - cornerSize, H - cornerSize, W, H),
  };

  const out = {};
  for (const k in regions) {
    const idxs = regions[k];
    if (idxs.length === 0) {
      out[k] = [0, 0, 0];
      continue;
    }

    if (mode === "avg") {
      let r = 0,
        g = 0,
        b = 0,
        cnt = 0;
      for (const i of idxs) {
        r += pixels[i];
        g += pixels[i + 1];
        b += pixels[i + 2];
        cnt++;
      }
      out[k] = [r / cnt, g / cnt, b / cnt];
    } else {

      const arr = [];
      for (const i of idxs) {
        const r = pixels[i],
          g = pixels[i + 1],
          b = pixels[i + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const sat = computeSaturation(r, g, b);
        const metric = mode === "bright" ? lum : sat * 255;
        arr.push({ metric, r, g, b });
      }

      arr.sort((a, b) => b.metric - a.metric);

      const take = Math.max(1, Math.floor(arr.length * 0.4));
      let r = 0,
        g = 0,
        b = 0;
      for (let i = 0; i < take; i++) {
        r += arr[i].r;
        g += arr[i].g;
        b += arr[i].b;
      }
      out[k] = [r / take, g / take, b / take];
    }
  }

  return out;
}

function computeSaturation(r, g, b) {
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b);
  if (mx === 0) return 0;
  return (mx - mn) / mx;
}

function applyColors(targets) {

  for (const k in targets) {
    const t = targets[k];
    const s = state[k];

    const alpha = 1 - Math.pow(1 - emaAlpha, 16 / (updateMs / 16));
    s[0] = lerp(s[0], t[0], alpha);
    s[1] = lerp(s[1], t[1], alpha);
    s[2] = lerp(s[2], t[2], alpha);


    const lum = (0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2]) / 255;
    let a = clamp((lum * 1.6 + 0.06) * intensity, 0, 1.0);
    const sat = computeSaturation(s[0], s[1], s[2]);
    a *= clamp(0.6 + sat * 1.4, 0.4, 1.6);

    const css = `rgba(${Math.round(s[0])},${Math.round(s[1])},${Math.round(
      s[2]
    )},${a})`;

    if (k === "top" || k === "bottom") {
      parts[k].style.background = `linear-gradient(to ${
        k === "top" ? "top" : "bottom"
      }, rgba(0,0,0,0) 0%, ${css} 100%)`;
      parts[k].style.opacity = a > 0.01 ? 1 : 0;
    } else if (k === "left" || k === "right") {
      parts[k].style.background = `linear-gradient(to ${
        k === "left" ? "left" : "right"
      }, rgba(0,0,0,0) 0%, ${css} 100%)`;
      parts[k].style.opacity = a > 0.01 ? 1 : 0;
    } else {
      parts[
        k
      ].style.background = `radial-gradient(circle at 50% 50%, ${css} 0%, rgba(0,0,0,0) 65%)`;
      parts[k].style.opacity = a > 0.01 ? 1 : 0;
    }
  }
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}


function tick(ts) {
  if (!enabled) return;
  if (ts - lastTs < updateMs) {
    requestAnimationFrame(tick);
    return;
  }
  lastTs = ts;

  if (video.readyState >= 2) {
    const { pixels, W, H } = renderToSmall();
    const mode = filterModeSel.value;
    const analyzed = analyzePixels(pixels, W, H, mode);
    applyColors(analyzed);
  }

  requestAnimationFrame(tick);
}

toggleBtn.addEventListener("click", () => {
  enabled = !enabled;
  toggleBtn.textContent = enabled ? "Вкл" : "Выкл";
  if (enabled) {
    lastTs = performance.now();
    requestAnimationFrame(tick);
  } else {
    for (const p of Object.values(parts)) p.style.opacity = 0;
  }
});

fileInput.addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const url = URL.createObjectURL(f);
  video.src = url;
  video.play();
});
intensityRange.addEventListener("input", (e) => {
  intensity = parseFloat(e.target.value);
});
freqRange.addEventListener("input", (e) => {
  updateMs = parseInt(e.target.value);
});


video.addEventListener("loadeddata", () => {

  glCanvas.width = 8;
  glCanvas.height = 8;
});