"""Compose actual Electron footage into a silent, captioned 150-second demo."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import textwrap
import zipfile

from PIL import Image, ImageDraw, ImageFont


def ffmpeg_path():
    configured = os.environ.get("TRUEIRIS_FFMPEG") or shutil.which("ffmpeg")
    if configured:
        return configured
    import imageio_ffmpeg

    return imageio_ffmpeg.get_ffmpeg_exe()


def font_path(bold=False):
    choices = (
        ["/System/Library/Fonts/Supplemental/Arial Rounded Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"]
        if bold else
        ["/System/Library/Fonts/Supplemental/Trebuchet MS.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    )
    return next(str(Path(p)) for p in choices if Path(p).exists())


def filter_path(path):
    return "'" + str(path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'") + "'"


def stamp(seconds):
    ms = round(seconds * 1000)
    return f"{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}"


def run(command, log):
    with log.open("w") as stream:
        result = subprocess.run(command, stdout=stream, stderr=stream)
    if result.returncode:
        raise RuntimeError(f"Media rendering failed; see {log.name}")


def main():
    output = Path(sys.argv[1]).resolve()
    work = output / ".work"
    story = json.loads((work / "story.json").read_text())
    ffmpeg = ffmpeg_path()
    shots = story["shots"]
    assert len(shots) == 11 and sum(s["duration"] for s in shots) == 150
    captions, chunks = [], []
    elapsed = 0
    for index, shot in enumerate(shots, 1):
        duration = shot["duration"]
        assert shot["parts"] and all(p["end"] > p["start"] >= 0 for p in shot["parts"])
        assert not re.search(r"\bmock\b", shot["title"] + shot["text"], re.I)
        title = work / f"{index:02}-title.txt"
        title.write_text(shot["title"])
        description = textwrap.wrap(shot["text"], width=125)
        assert len(description) <= 2
        textfiles = []
        for line, text in enumerate(description):
            path = work / f"{index:02}-line-{line}.txt"
            path.write_text(text)
            textfiles.append(path)
        command = [ffmpeg, "-y", "-hide_banner", "-loglevel", "warning", "-threads", "4"]
        filters = []
        labels = []
        for part_index, part in enumerate(shot["parts"]):
            command += ["-ss", str(part["start"]), "-t", str(part["end"] - part["start"]), "-i", story["video"]]
            label = f"p{part_index}"
            filters.append(f"[{part_index}:v]setpts=PTS-STARTPTS[{label}]")
            labels.append(f"[{label}]")
        raw_duration = sum(p["end"] - p["start"] for p in shot["parts"])
        filters.append("".join(labels) + f"concat=n={len(labels)}:v=1:a=0,"
                       f"setpts={duration / raw_duration:.10f}*PTS,fps=30,"
                       f"tpad=stop_mode=clone:stop_duration={duration},trim=duration={duration},"
                       "scale=1600:900:flags=lanczos,setsar=1[app]")
        filters.append(f"color=c=0xedf6fd:s=1920x1080:r=30:d={duration},"
                       "drawbox=x=153:y=45:w=1614:h=916:color=0xdbe9f3:t=fill[canvas]")
        filters.append("[canvas][app]overlay=x=160:y=52:shortest=1[framed]")
        typography = (
            f"[framed]drawtext=fontfile={filter_path(font_path(True))}:text='trueiris.':x=160:y=12:fontsize=28:fontcolor=0x345b79,"
            f"drawtext=fontfile={filter_path(font_path())}:text='SILENT PRODUCT WALKTHROUGH':x=1363:y=19:fontsize=16:fontcolor=0x617d93,"
            f"drawtext=fontfile={filter_path(font_path(True))}:textfile={filter_path(title)}:x=160:y=975:fontsize=32:fontcolor=0x30455a,"
            f"drawtext=fontfile={filter_path(font_path())}:text='{index:02} / 11':x=1650:y=982:fontsize=20:fontcolor=0x617d93"
        )
        for line, path in enumerate(textfiles):
            typography += f",drawtext=fontfile={filter_path(font_path())}:textfile={filter_path(path)}:x=160:y={1018 + line * 28}:fontsize=21:fontcolor=0x516d84"
        typography += f",fade=t=in:st=0:d=0.16:color=0xedf6fd,fade=t=out:st={duration - 0.16}:d=0.16:color=0xedf6fd[final]"
        filters.append(typography)
        filter_file = work / f"{index:02}-filter.txt"
        filter_file.write_text(";\n".join(filters))
        chunk = work / f"{index:02}-{shot['name']}.mp4"
        command += ["-filter_complex_script", str(filter_file), "-map", "[final]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-r", "30", "-frames:v", str(duration * 30), str(chunk)]
        run(command, work / f"{index:02}-render.log")
        chunks.append(chunk)
        captions.append(f"{index}\n{stamp(elapsed)} --> {stamp(elapsed + duration)}\n{shot['title']}\n{shot['text']}\n")
        elapsed += duration
        print(f"Rendered {index:02}/11: {shot['title']}", flush=True)
    concat = work / "chapters.txt"
    concat.write_text("\n".join(f"file '{p}'" for p in chunks))
    video = output / "TrueIris-Demo-2m30s.mp4"
    run([ffmpeg, "-y", "-hide_banner", "-loglevel", "warning", "-f", "concat", "-safe", "0", "-i", str(concat), "-c", "copy", "-an", "-movflags", "+faststart", "-metadata", "title=TrueIris | Silent Product Walkthrough", "-metadata", "comment=Generated sample history and simulated current signals.", str(video)], work / "concat.log")
    (output / "TrueIris-Captions.srt").write_text("\n".join(captions))
    # Decode the whole delivery to verify frame count, runtime, dimensions and silence.
    verify = subprocess.run([ffmpeg, "-hide_banner", "-i", str(video), "-map", "0:v:0", "-an", "-f", "null", "-progress", "pipe:1", "-"], capture_output=True, text=True)
    assert verify.returncode == 0
    assert "Audio:" not in verify.stderr and "1920x1080" in verify.stderr
    assert "Duration: 00:02:30.00" in verify.stderr
    assert int(re.findall(r"^frame=(\d+)$", verify.stdout, re.M)[-1]) == 4500
    images = sorted((output / "screenshots").glob("*.png"))
    assert len(images) == 9
    for path in images:
        with Image.open(path) as captured:
            captured.convert("RGB").resize((1920, 1080), Image.Resampling.LANCZOS).save(path)
    assert all(Image.open(p).size == (1920, 1080) for p in images)
    readme = "TrueIris demo media\n\nVideo: 2:30, 1920 × 1080, 30 fps, H.264 MP4, no audio track.\nBurned-in explanatory titles and captions accompany actual app footage.\n\nHistorical data is generated sample history. Current physiology, desktop activity and voice input in this recording are simulated. Gemini answers use the real configured provider and a separately scoped sample database identity. No personal microphone audio, webcam images or foreground-window titles are recorded.\n\nNine app screenshots:\n" + "\n".join(p.name for p in images) + "\n"
    (output / "README.txt").write_text(readme)
    with zipfile.ZipFile(output / "TrueIris-9-Screenshots.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for image in images:
            archive.write(image, image.name)
        archive.writestr("README.txt", readme)
    # A separate overview makes all nine pages easy to review without opening the ZIP.
    overview = Image.new("RGB", (2100, 1450), "#edf6fd")
    draw = ImageDraw.Draw(overview)
    draw.text((60, 34), "TrueIris | Nine perspectives", font=ImageFont.truetype(font_path(True), 40), fill="#345b79")
    labels = ["Iris home", "Activity recording", "Live signals", "Sample week", "Timeline", "Patterns", "Ask Iris + evidence", "Experiments", "Privacy + settings"]
    for i, image in enumerate(images):
        x, y = 60 + (i % 3) * 680, 125 + (i // 3) * 420
        thumb = Image.open(image).convert("RGB").resize((620, 349), Image.Resampling.LANCZOS)
        overview.paste(thumb, (x, y))
        draw.text((x, y + 361), f"{i + 1:02}  {labels[i]}", font=ImageFont.truetype(font_path(True), 23), fill="#345b79")
    draw.text((60, 1400), "Generated sample history · simulated current signals · actual app interface", font=ImageFont.truetype(font_path(), 21), fill="#617d93")
    overview.save(output / "TrueIris-Screenshot-Overview.png")
    # Representative frames support visual/OCR review of the final video.
    elapsed = 0
    for i, shot in enumerate(shots, 1):
        run([ffmpeg, "-y", "-hide_banner", "-loglevel", "warning", "-ss", str(elapsed + shot["duration"] / 2), "-i", str(video), "-frames:v", "1", str(work / f"review-{i:02}.png")], work / "frame-review.log")
        review = Image.open(work / f"review-{i:02}.png").convert("RGB").crop((160, 52, 1760, 952))
        gray_pixels = sum(count for count, color in review.getcolors(review.width * review.height) if max(color) - min(color) <= 2 and 120 <= color[0] <= 136)
        assert gray_pixels / (review.width * review.height) < 0.01, "The app recording contains gray capture padding."
        elapsed += shot["duration"]
    (output / "Validation.json").write_text(json.dumps({"durationSeconds": 150, "width": 1920, "height": 1080, "fps": 30, "frames": 4500, "audioTracks": 0, "screenshots": 9, "historicalData": "generated samples", "currentSignals": "simulated", "reasoning": "Gemini"}, indent=2))
    print("Verified: 150 seconds, 4500 frames, 1080p, no audio track, nine screenshots.", flush=True)


if __name__ == "__main__":
    main()
