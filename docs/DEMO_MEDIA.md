# Silent demo video and screenshots

`pnpm capture:demo` records the built Electron app, composes an exactly 150-second silent 1080p MP4 with explanatory typography, and produces nine app screenshots plus a ZIP and overview. It does not modify the application theme, provider behavior or stored source identities.

## Requirements

- Run `pnpm build` first and configure the existing Tiger Data and Gemini settings in the ignored root `.env`.
- Apply the existing migrations explicitly if the database has not been prepared.
- Install the recorder once with `pnpm exec playwright install ffmpeg`.
- The compositor needs Python with Pillow, plus either an installed FFmpeg or `imageio-ffmpeg`. A separate environment can be selected with `TRUEIRIS_MEDIA_PYTHON`; `TRUEIRIS_FFMPEG` can select a binary. macOS Trebuchet MS / Arial Rounded or Linux DejaVu fonts are used locally.

For example, using a task-specific Python environment:

```bash
python3 -m venv /tmp/trueiris-media
/tmp/trueiris-media/bin/python -m pip install pillow imageio-ffmpeg
TRUEIRIS_MEDIA_PYTHON=/tmp/trueiris-media/bin/python pnpm capture:demo
```

## Recording behavior

The capture creates a random, separately scoped database owner and prepares generated history through the existing demo API. Gemini answers are produced by the configured real provider using that sample evidence. The recording exercises home navigation, a simulated voice interaction, optional activity capture/saving, simulated current physiology, the sample-week overview, timelines and baselines, patterns, cited answers, experiments and privacy/storage controls.

Personal audio, camera frames and native foreground-window titles are excluded: the capture uses synthetic microphone input and explicit test context/sensor providers, disables the Presage key in the recording process, and mutes the Electron window. This setup is confined to this capture process; ordinary launches retain their existing settings. Presentation text describes test providers as **simulated**, while source values and capture disclosures remain accurate. Historical data stays labeled generated sample history. Temporary UI text and cursor decorations are installed only in the recorder's renderer.

Only this run's random owner is removed afterward. The ordinary account and existing dedicated demo identity are untouched. Logs contain chapter/file names, not credentials or provider responses. Output goes to the Git-ignored `demo-deliverables/` folder, with intermediate footage in `.work/`.

## Deliverables and validation

- `TrueIris-Demo-2m30s.mp4`: H.264, 1920 × 1080, 30 fps, burned-in chapter titles and captions, no audio track.
- `screenshots/`: exactly nine 1920 × 1080 PNGs normalized from the full app viewport, covering home, recording, live signals, sample week, timeline, patterns, Ask Iris, experiments and settings.
- `TrueIris-9-Screenshots.zip`: the nine PNGs and a provenance/readme file.
- `TrueIris-Screenshot-Overview.png`: a separate contact sheet for reviewing the pages.
- `TrueIris-Captions.srt` and `Validation.json`: accessible caption text and technical delivery checks.

The recorder asserts the sample dataset and cited Gemini answers are available, checks presentation text at every screenshot, and verifies the storyboard totals 150 seconds. The compositor fully decodes the delivered MP4, verifies 4,500 frames and no audio, checks all nine image dimensions, and exports representative video frames for visual review. Generated footage, screenshots and credentials must remain outside Git.
