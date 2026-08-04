"""Postly render worker.

Polls the app for video drafts, renders each one locally with Piper TTS and
FFmpeg, uploads the MP4, and hands the URL back. Everything it needs runs
offline on an ordinary machine — the app itself stays on the free serverless
tier, where neither Piper nor FFmpeg can run.

    python render_worker.py            # keep polling on a schedule
    python render_worker.py --once     # drain the queue once and exit
"""

from __future__ import annotations

import argparse
import logging
import os
import shutil
import sys
import tempfile
from pathlib import Path

import requests
from apscheduler.schedulers.blocking import BlockingScheduler

from hosting import upload_video
from renderer import RenderError, check_tools, render_job

try:  # optional: a .env next to this file, so nothing has to be exported
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).with_name(".env"))
except ImportError:
    pass

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s  %(levelname)-7s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("postly.worker")

APP_URL = os.getenv("POSTLY_APP_URL", "http://localhost:3000").rstrip("/")
TOKEN = os.getenv("RENDER_WORKER_TOKEN", "")
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "60"))
BATCH = int(os.getenv("BATCH", "1"))
KEEP_FILES = os.getenv("KEEP_RENDER_FILES", "").lower() in ("1", "true", "yes")
# Which machine is doing the rendering. The app shows this, so "my videos are
# stuck" can be answered with where the renderer last ran rather than a guess.
SOURCE = os.getenv("WORKER_SOURCE", "local")


def api(method: str, path: str, **kw) -> dict:
    res = requests.request(
        method,
        f"{APP_URL}{path}",
        headers={"Authorization": f"Bearer {TOKEN}", "x-worker-source": SOURCE},
        timeout=kw.pop("timeout", 60),
        **kw,
    )
    if not res.ok:
        raise RuntimeError(f"{method} {path} -> HTTP {res.status_code}: {res.text[:200]}")
    return res.json()


def claim_jobs() -> list[dict]:
    return api("GET", f"/api/render/jobs?limit={BATCH}").get("jobs", [])


def report(job_id, *, video_url=None, duration=None, error=None) -> None:
    body = {"video_url": video_url, "duration_seconds": duration} if video_url else {"error": error}
    api("POST", f"/api/render/jobs/{job_id}", json=body)


def handle(job: dict) -> bool:
    """Renders one job. Returns True when the MP4 was hosted and reported."""
    job_id = job["id"]
    log.info("job %s (%s): %d scenes", job_id, job.get("platform"), len(job.get("scenes", [])))
    workdir = Path(tempfile.mkdtemp(prefix=f"postly-{job_id}-"))
    try:
        mp4, duration = render_job(job, workdir)
        log.info("job %s rendered: %.1fs, %.1f MB", job_id, duration, mp4.stat().st_size / 1e6)
        url = upload_video(mp4, f"postly-{job_id}.mp4")
        report(job_id, video_url=url, duration=duration)
        log.info("job %s ready: %s", job_id, url)
        return True
    except Exception as e:                           # noqa: BLE001
        # Every failure is reported, not just the ones we predicted: an
        # unexpected exception used to escape here and leave the draft claimed,
        # which is exactly the state that says "rendering" forever. The app
        # decides from the attempt count whether to retry or give up.
        log.error("job %s failed: %s", job_id, e)
        try:
            report(job_id, error=str(e))
        except Exception as report_error:            # noqa: BLE001 - last resort
            log.error("could not report job %s: %s", job_id, report_error)
        return False
    finally:
        if KEEP_FILES:
            log.info("job %s files kept in %s", job_id, workdir)
        else:
            shutil.rmtree(workdir, ignore_errors=True)


def tick(seen: set | None = None, failures: list | None = None) -> int:
    """Claims and renders a batch. Returns how many jobs were handled.

    `seen` collects the ids already attempted in this process. A job that fails
    goes back in the queue for another try later, so without it a single
    draining run would burn every retry the job had within a few seconds —
    against exactly the transient condition the retries exist to outlast.

    `failures` collects the ids that did not produce a hosted MP4, so a caller
    that runs to completion can exit with the truth about what happened.
    """
    try:
        jobs = claim_jobs()
    except Exception as e:                            # noqa: BLE001 - keep polling
        log.error("could not fetch jobs: %s", e)
        return 0
    if seen is not None:
        fresh = [j for j in jobs if j["id"] not in seen]
        if not fresh:
            return 0
        seen.update(j["id"] for j in fresh)
        jobs = fresh
    for job in jobs:
        if not handle(job) and failures is not None:
            failures.append(job["id"])
    return len(jobs)


def main() -> int:
    parser = argparse.ArgumentParser(description="Postly video render worker")
    parser.add_argument("--once", action="store_true", help="drain the queue once and exit")
    args = parser.parse_args()

    if not TOKEN:
        log.error("RENDER_WORKER_TOKEN is not set — it must match the app's value")
        return 1
    try:
        check_tools()
    except RenderError as e:
        log.error("%s", e)
        return 1

    log.info("worker ready — app %s, source %s, polling every %ss", APP_URL, SOURCE, POLL_SECONDS)
    if args.once:
        seen: set = set()
        failures: list = []
        while tick(seen, failures):
            pass
        log.info("drained %d job(s), %d failed", len(seen), len(failures))

        # A drain in which nothing rendered must not report success. Every
        # failure is already recorded against its own draft, so the run looked
        # green while five videos in a row failed to upload — which is how a
        # broken storage token went unnoticed. The exit code is the only part
        # of this anyone sees without opening the log.
        if failures:
            log.error("jobs that did not produce a video: %s", failures)
            return 1
        return 0

    tick()  # don't make the first job wait a full interval
    scheduler = BlockingScheduler(timezone=os.getenv("TZ", "UTC"))
    scheduler.add_job(tick, "interval", seconds=POLL_SECONDS, max_instances=1, coalesce=True)
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        log.info("bye")
    return 0


if __name__ == "__main__":
    sys.exit(main())
