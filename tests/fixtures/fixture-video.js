async function makeFixtureVideo(video, label, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = options.width || 640;
  canvas.height = options.height || 360;
  const context = canvas.getContext("2d");
  const stream = canvas.captureStream(30);
  const audioContext = new AudioContext();
  const audioDestination = audioContext.createMediaStreamDestination();
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.frequency.value = 220;
  gain.gain.value = 0.01;
  oscillator.connect(gain).connect(audioDestination);
  oscillator.start();
  stream.addTrack(audioDestination.stream.getAudioTracks()[0]);
  await audioContext.resume().catch(() => {});
  const chunks = [];
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
    ? "video/webm;codecs=vp8,opus"
    : "video/webm;codecs=vp8";
  const recorder = new MediaRecorder(stream, { mimeType });
  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size) chunks.push(event.data);
  });

  let start = performance.now();
  function draw(now) {
    const progress = ((now - start) % 2400) / 2400;
    const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
    gradient.addColorStop(0, `hsl(${250 + progress * 35} 72% 54%)`);
    gradient.addColorStop(1, `hsl(${168 + progress * 25} 70% 42%)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "rgba(8, 8, 16, .28)";
    context.beginPath();
    context.arc(90 + progress * 460, 180, 62, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = "white";
    context.font = "700 34px system-ui";
    context.textAlign = "center";
    context.fillText(label, canvas.width / 2, 165);
    context.font = "500 19px system-ui";
    context.fillText("Locally generated test video", canvas.width / 2, 200);
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);

  recorder.start();
  await new Promise((resolve) => setTimeout(resolve, 2600));
  const stopped = new Promise((resolve) => recorder.addEventListener("stop", resolve, { once: true }));
  recorder.stop();
  await stopped;
  oscillator.stop();
  stream.getTracks().forEach((track) => track.stop());
  await audioContext.close();

  video.src = URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || "video/webm" }));
  if (options.textTrack !== false) {
    const captions = video.addTextTrack("captions", "English", "en");
    captions.mode = "showing";
    captions.addCue(new VTTCue(0, 0.85, `${label}: subtitles are preserved.`));
    captions.addCue(new VTTCue(0.85, 1.7, "Use the typography icon to style subtitles."));
    captions.addCue(new VTTCue(1.7, 2.55, "Space, arrows, M, and C are keyboard shortcuts."));
  }
  await video.play();
}
