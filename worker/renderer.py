"""Turns a Postly video job into a finished vertical MP4.

Everything here is free and runs offline on an ordinary PC:

    narration text  --> Piper TTS  --> one WAV per scene
    scene images    --> FFmpeg     --> Ken Burns move on each still
    both            --> FFmpeg     --> crossfades, burned subtitles, mixdown

The only paid-for-you part of the pipeline is the scene artwork, which the app
generated before the job ever reached this worker.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import requests

log = logging.getLogger("postly.render")

WIDTH, HEIGHT = 1080, 1920      # 9:16, the shape every short-form feed wants
FPS = 30
FADE = 0.4                      # crossfade between scenes, seconds
TAIL = 0.6                      # beat of silence after the last word
MAX_SECONDS = 59                # Shorts and Reels both cut off at a minute

PIPER_BIN = os.getenv("PIPER_BIN", "piper")
PIPER_VOICE = os.getenv("PIPER_VOICE", "voices/en_US-ryan-medium.onnx")
FFMPEG = os.getenv("FFMPEG_BIN", "ffmpeg")
FFPROBE = os.getenv("FFPROBE_BIN", "ffprobe")
MUSIC = os.getenv("BACKGROUND_MUSIC", "")       # optional path to a music bed
MUSIC_DB = os.getenv("BACKGROUND_MUSIC_DB", "-24")
# How far above the output size stills are scaled before the Ken Burns move.
# More headroom means smoother motion and more CPU — 1.5 is the compromise
# that still renders comfortably on a low-end machine.
KENBURNS_SCALE = float(os.getenv("KENBURNS_SCALE", "1.5"))


class RenderError(RuntimeError):
    pass


@dataclass
class Scene:
    narration: str
    image_url: str
    audio: Path | None = None
    image: Path | None = None
    duration: float = 0.0


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def run(cmd: list[str], **kw) -> subprocess.CompletedProcess:
    log.debug("$ %s", " ".join(str(c) for c in cmd))
    proc = subprocess.run(
        [str(c) for c in cmd], capture_output=True, text=True, **kw
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "").strip().splitlines()[-12:]
        raise RenderError(f"{cmd[0]} failed:\n" + "\n".join(tail))
    return proc


def check_tools() -> None:
    """Fails loudly at startup rather than halfway through the first render."""
    missing = [t for t in (FFMPEG, FFPROBE) if shutil.which(t) is None]
    if shutil.which(PIPER_BIN) is None:
        missing.append(PIPER_BIN)
    if missing:
        raise RenderError(
            "missing required tools: " + ", ".join(missing) +
            "\nInstall FFmpeg (apt install ffmpeg) and Piper (pip install piper-tts)."
        )
    if not Path(PIPER_VOICE).exists():
        raise RenderError(
            f"Piper voice not found at {PIPER_VOICE}. Download it with:\n"
            "  mkdir -p voices && cd voices && \\\n"
            "  wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/"
            "en_US-ryan-medium.onnx && \\\n"
            "  wget https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/ryan/medium/"
            "en_US-ryan-medium.onnx.json"
        )


def duration_of(path: Path) -> float:
    out = run([
        FFPROBE, "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", path,
    ]).stdout.strip()
    return float(out)


# ---------------------------------------------------------------------------
# Voice and artwork
# ---------------------------------------------------------------------------

def speak(text: str, out: Path) -> None:
    """Piper reads one narration line into a WAV file."""
    raw = out.with_suffix(".raw.wav")
    proc = subprocess.run(
        [PIPER_BIN, "--model", PIPER_VOICE, "--output_file", str(raw)],
        input=text, capture_output=True, text=True,
    )
    if proc.returncode != 0 or not raw.exists():
        tail = (proc.stderr or "").strip().splitlines()[-8:]
        raise RenderError("piper failed:\n" + "\n".join(tail))

    # Level the voice and give each line a little air on both sides, so the
    # crossfades do not clip a word.
    run([
        FFMPEG, "-y", "-i", raw,
        "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=0.35,adelay=120|120",
        "-ar", "48000", "-ac", "1", out,
    ])
    raw.unlink(missing_ok=True)


def fetch_image(url: str, out: Path, attempts: int = 4) -> None:
    """Download a scene still.

    The generator serves these on demand and answers 502/429 under load, which
    used to abandon a render half-finished. Transient failures are retried with
    a widening pause; only a genuinely dead URL raises.
    """
    last = None
    for attempt in range(attempts):
        try:
            res = requests.get(url, timeout=180)
            # 5xx and 429 are worth another try; 404 and friends are not.
            if res.status_code >= 500 or res.status_code == 429:
                raise requests.HTTPError(f"{res.status_code} from image host", response=res)
            res.raise_for_status()
            if not res.content:
                raise requests.HTTPError("empty image response")
            out.write_bytes(res.content)
            return
        except (requests.RequestException, OSError) as exc:
            last = exc
            if attempt == attempts - 1:
                break
            wait = 4 * (attempt + 1)
            log.warning("image fetch failed (%s), retrying in %ss", exc, wait)
            time.sleep(wait)
    raise RenderError(f"could not fetch scene image after {attempts} tries: {last}")


# ---------------------------------------------------------------------------
# Subtitles
# ---------------------------------------------------------------------------

def srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


def chunk(text: str, max_chars: int = 38) -> list[str]:
    """Splits a narration line into caption-sized pieces on word boundaries."""
    pieces, current = [], ""
    for word in text.split():
        if current and len(current) + 1 + len(word) > max_chars:
            pieces.append(current)
            current = word
        else:
            current = f"{current} {word}".strip()
    if current:
        pieces.append(current)
    return pieces or [text]


def write_srt(scenes: list[Scene], path: Path) -> None:
    """Captions in short bursts, the way short-form video does them.

    A whole narration line on screen at once would wrap to five rows and cover
    half the picture, so each line is broken into two-row chunks that share the
    scene's time in proportion to their length — close enough to the speaking
    rate to track the voice without needing word timings from the TTS.
    """
    cues, start, index = [], 0.0, 1
    for scene in scenes:
        pieces = chunk(scene.narration)
        total_chars = sum(len(p) for p in pieces) or 1
        at = start
        for piece in pieces:
            span = scene.duration * len(piece) / total_chars
            cues.append(f"{index}\n{srt_time(at)} --> {srt_time(at + span)}\n{piece}\n")
            at += span
            index += 1
        start += scene.duration
    path.write_text("\n".join(cues), encoding="utf-8")


def escape_for_filter(path: Path) -> str:
    """FFmpeg filter arguments need ':' and '\\' escaped inside the value."""
    return str(path).replace("\\", "/").replace(":", r"\:").replace("'", r"\'")


# ---------------------------------------------------------------------------
# The video itself
# ---------------------------------------------------------------------------

def build_filtergraph(scenes: list[Scene], srt: Path | None, music: bool) -> str:
    """One filter_complex: Ken Burns per scene, crossfades, subtitles, audio.

    Each still is held for its narration plus one crossfade, so after the
    crossfades overlap the timeline is exactly the narration length again and
    the voice stays locked to its own picture.
    """
    parts = []
    big_w, big_h = int(WIDTH * KENBURNS_SCALE), int(HEIGHT * KENBURNS_SCALE)
    for i, scene in enumerate(scenes):
        hold = scene.duration + FADE
        frames = max(int(hold * FPS), 1)
        # Pre-upscaling is what keeps zoompan's stepping from showing as jitter.
        # Alternating between a centred zoom and a drift stops the video from
        # feeling mechanical over five or six scenes.
        if i % 2 == 0:
            x, y = "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
        else:
            x, y = f"(iw-iw/zoom)*(1-on/{frames})", f"(ih-ih/zoom)*(on/{frames})"
        parts.append(
            f"[{i}:v]scale={big_w}:{big_h}:force_original_aspect_ratio=increase,"
            f"crop={big_w}:{big_h},"
            f"zoompan=z='min(zoom+0.0009,1.18)':d={frames}:x='{x}':y='{y}'"
            f":s={WIDTH}x{HEIGHT}:fps={FPS},"
            f"trim=duration={hold:.3f},setpts=PTS-STARTPTS,setsar=1,format=yuv420p[v{i}]"
        )

    # Chain the crossfades. Each clip is held for its narration plus one fade,
    # so clip i starts overlapping exactly when the previous narration ends —
    # which is also when its own voice line starts. Picture and voice stay
    # locked together however long each line turns out to be.
    video, offset = "[v0]", 0.0
    for i in range(1, len(scenes)):
        offset += scenes[i - 1].duration
        out = f"[x{i}]"
        parts.append(
            f"{video}[v{i}]xfade=transition=fade:duration={FADE}:offset={offset:.3f}{out}"
        )
        video = out

    tail = f"{video}fade=t=in:st=0:d=0.4"
    if srt is not None:
        # Sizes are in libass' own 384x288 space for SRT input, so Fontsize=14
        # lands at roughly 90px on a 1920-tall frame and MarginV clears the
        # buttons every app draws along the bottom.
        style = (
            "FontName=DejaVu Sans,Fontsize=14,Bold=1,PrimaryColour=&H00FFFFFF,"
            "OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,"
            "Alignment=2,MarginV=45"
        )
        tail += f",subtitles='{escape_for_filter(srt)}':force_style='{style}'"
    parts.append(tail + "[vout]")

    n = len(scenes)
    parts.append("".join(f"[{n + i}:a]" for i in range(n)) + f"concat=n={n}:v=0:a=1[voice]")
    if music:
        fade_at = max(sum(s.duration for s in scenes) - 1.5, 0.1)
        parts.append(f"[{2 * n}:a]volume={MUSIC_DB}dB,afade=t=out:st={fade_at:.2f}:d=1.5[bed]")
        parts.append("[voice][bed]amix=inputs=2:duration=first:dropout_transition=0[aout]")
    else:
        parts.append("[voice]anull[aout]")

    return ";".join(parts)


def render_video(scenes: list[Scene], out: Path, srt: Path | None) -> None:
    music = bool(MUSIC and Path(MUSIC).exists())
    cmd = [FFMPEG, "-y"]
    for scene in scenes:                                  # video inputs first
        # -t bounds each looped still: without it the loop never ends and
        # FFmpeg keeps generating frames nothing will ever consume.
        cmd += ["-loop", "1", "-framerate", str(FPS),
                "-t", f"{scene.duration + FADE:.3f}", "-i", str(scene.image)]
    for scene in scenes:                                  # then the voice
        cmd += ["-i", str(scene.audio)]
    if music:
        cmd += ["-stream_loop", "-1", "-i", MUSIC]

    cmd += [
        "-filter_complex", build_filtergraph(scenes, srt, music),
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", os.getenv("X264_PRESET", "veryfast"),
        "-crf", os.getenv("X264_CRF", "23"), "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
        "-t", str(MAX_SECONDS), "-movflags", "+faststart",
        str(out),
    ]
    run(cmd)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def render_job(job: dict, workdir: Path) -> tuple[Path, float]:
    """Renders one job and returns (mp4 path, duration in seconds)."""
    raw_scenes = job.get("scenes") or []
    scenes = [
        Scene(narration=s.get("narration", "").strip(), image_url=s.get("image_url", ""))
        for s in raw_scenes
        if s.get("narration") and s.get("image_url")
    ]
    if not scenes:
        raise RenderError("job has no usable scenes")

    workdir.mkdir(parents=True, exist_ok=True)
    for i, scene in enumerate(scenes):
        scene.image = workdir / f"scene{i}.png"
        scene.audio = workdir / f"scene{i}.wav"
        fetch_image(scene.image_url, scene.image)
        speak(scene.narration, scene.audio)
        scene.duration = duration_of(scene.audio)
        log.info("scene %d: %.1fs — %s", i + 1, scene.duration, scene.narration[:60])

    # Trim from the end if the script overran what the feeds will play.
    total = sum(s.duration for s in scenes)
    while total > MAX_SECONDS - TAIL and len(scenes) > 1:
        dropped = scenes.pop()
        log.warning("script runs %.1fs — dropping the last scene to fit", total)
        total -= dropped.duration

    srt = workdir / "captions.srt"
    write_srt(scenes, srt)

    out = workdir / "postly.mp4"
    try:
        render_video(scenes, out, srt)
    except RenderError as e:
        # libass is optional in some FFmpeg builds; a video without burned-in
        # captions is far better than no video at all.
        if "subtitles" not in str(e).lower():
            raise
        log.warning("subtitle filter unavailable, rendering without captions")
        render_video(scenes, out, None)

    return out, duration_of(out)
