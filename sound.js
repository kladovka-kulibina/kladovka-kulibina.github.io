const preferenceKey = "kk-sounds-enabled";
const melodies = {
  preview: [523.25],
  welcome: [392],
  saved: [440, 554.37],
  returned: [659.25, 523.25, 392]
};
const noteLength = 0.23;
const noteSpacing = 0.095;
const AudioEngine = window.AudioContext || window.webkitAudioContext;
let enabled = true;
let context = null;
let resuming = null;
let playing = null;
const sounds = new Map();

function readPreference() {
  try { return localStorage.getItem(preferenceKey) !== "off"; }
  catch { return true; }
}

function releaseAudio() {
  const old = context;
  context = null;
  resuming = null;
  playing = null;
  sounds.clear();
  if (old && old.state !== "closed") old.close().catch(() => {});
}

// A trusted gesture unlocks audio before a network write can outlast browser activation.
function unlock() {
  if (!enabled || document.hidden || !AudioEngine) return;
  try {
    context ??= new AudioEngine({latencyHint:"interactive"});
    if (context.state !== "running" && !resuming) {
      const current = context;
      resuming = current.resume().catch(() => {}).finally(() => {
        if (current === context) resuming = null;
      });
    }
  } catch { /* The workspace also runs with audio unavailable. */ }
}

function makeChime(audio, notes) {
  const rate = audio.sampleRate;
  const length = Math.ceil((noteLength + noteSpacing * (notes.length - 1)) * rate);
  const buffer = audio.createBuffer(1, length, rate);
  const wave = buffer.getChannelData(0);
  notes.forEach((frequency, index) => {
    const start = Math.round(index * noteSpacing * rate);
    const samples = Math.min(Math.round(noteLength * rate), length - start);
    for (let i = 0; i < samples; i++) {
      const t = i / rate;
      const phase = 2 * Math.PI * frequency * t;
      const attack = 1 - Math.exp(-t / 0.006);
      const release = Math.min(1, (samples - 1 - i) / (rate * 0.025));
      const fundamental = Math.sin(phase) * Math.exp(-t * 18);
      const overtone = 0.19 * Math.sin(2 * phase) * Math.exp(-t * 38);
      wave[start + i] += 0.09 * attack * release * (fundamental + overtone);
    }
  });
  return buffer;
}

export function playFeedback(cue) {
  const audio = context;
  if (!audio || !enabled || document.hidden) return;
  const requested = performance.now();
  function start() {
    if (audio !== context || !enabled || audio.state !== "running" || document.hidden || performance.now() - requested > 450) return;
    try {
      if (!sounds.has(cue)) sounds.set(cue, makeChime(audio, melodies[cue]));
      if (playing) playing.stop();
      const source = audio.createBufferSource();
      source.buffer = sounds.get(cue);
      source.connect(audio.destination);
      source.onended = () => {
        source.disconnect();
        if (playing === source) playing = null;
      };
      playing = source;
      source.start();
    } catch { /* Optional feedback must never interrupt a completed action. */ }
  }
  if (audio.state === "running") start();
  else resuming?.then(start);
}

export function initSounds(button, icon) {
  if (!button || !AudioEngine) return;
  function update(value) {
    enabled = value;
    button.innerHTML = icon(value ? "soundOn" : "soundOff");
    button.setAttribute("aria-pressed", String(value));
    button.title = value ? "Выключить звуки действий" : "Включить звуки действий";
    if (!value) releaseAudio();
  }
  update(readPreference());
  button.hidden = false;
  document.addEventListener("click", event => {
    if (event.isTrusted && !button.contains(event.target)) unlock();
  }, true);
  document.addEventListener("keydown", event => {
    if (event.isTrusted && (event.key === "Enter" || event.key === " ") && !button.contains(event.target)) unlock();
  }, true);
  button.addEventListener("click", () => {
    update(!enabled);
    try { localStorage.setItem(preferenceKey, enabled ? "on" : "off"); } catch {}
    if (enabled) { unlock(); playFeedback("preview"); }
  });
  window.addEventListener("storage", event => {
    if (event.key === preferenceKey || event.key === null) update(readPreference());
  });
  window.addEventListener("pagehide", releaseAudio);
  document.addEventListener("visibilitychange", () => { if (document.hidden) releaseAudio(); });
}
