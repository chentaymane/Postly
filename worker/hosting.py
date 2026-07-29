"""Puts a rendered MP4 somewhere the social platforms can fetch it.

Instagram, Facebook and Pinterest all pull the file from a public HTTPS URL, so
a video sitting on your laptop is not publishable — it needs a host. Three free
options, picked by whichever environment variables are set:

  VIDEO_HOST=blob   Vercel Blob         (free tier, same account as the app)
  VIDEO_HOST=s3     any S3-compatible   (Cloudflare R2 free tier, needs boto3)
  VIDEO_HOST=local  a folder you already serve publicly (tunnel, NAS, VPS)
"""

from __future__ import annotations

import logging
import os
import shutil
import time
from pathlib import Path

import requests

log = logging.getLogger("postly.hosting")


class HostingError(RuntimeError):
    pass


def upload_video(path: Path, name: str) -> str:
    host = os.getenv("VIDEO_HOST", "blob").lower()
    if host == "blob":
        return _vercel_blob(path, name)
    if host == "s3":
        return _s3(path, name)
    if host == "local":
        return _local(path, name)
    raise HostingError(f"unknown VIDEO_HOST {host!r} (expected blob, s3 or local)")


def _vercel_blob(path: Path, name: str) -> str:
    """Vercel Blob's upload API — one PUT, public URL in the response."""
    token = os.getenv("BLOB_READ_WRITE_TOKEN")
    if not token:
        raise HostingError("BLOB_READ_WRITE_TOKEN is not set (Vercel dashboard -> Storage -> Blob)")

    with path.open("rb") as fh:
        res = requests.put(
            f"https://blob.vercel-storage.com/{name}",
            data=fh,
            headers={
                "authorization": f"Bearer {token}",
                "x-api-version": "7",
                "x-content-type": "video/mp4",
                "x-add-random-suffix": "1",
                "x-cache-control-max-age": "31536000",
            },
            timeout=300,
        )
    if not res.ok:
        # A store's access mode is fixed when it is created, so a private store
        # can never serve the public URL the social platforms need to fetch.
        if "private store" in res.text:
            raise HostingError(
                "This Blob store was created with private access, and the social platforms "
                "need a public URL to fetch the video.\n"
                "Create a store with PUBLIC access (Vercel -> Storage -> Create -> Blob, "
                "choose public), then put its BLOB_READ_WRITE_TOKEN in worker/.env.\n"
                "Alternatively host the files yourself: set VIDEO_HOST=s3 (Cloudflare R2) "
                "or VIDEO_HOST=local with a publicly reachable folder."
            )
        raise HostingError(f"Vercel Blob upload failed (HTTP {res.status_code}): {res.text[:200]}")
    url = res.json().get("url")
    if not url:
        raise HostingError("Vercel Blob returned no URL")
    return url


def _s3(path: Path, name: str) -> str:
    """Cloudflare R2 or any other S3-compatible bucket."""
    try:
        import boto3  # imported lazily: only this backend needs it
    except ImportError as e:
        raise HostingError("VIDEO_HOST=s3 needs boto3 — pip install boto3") from e

    bucket = os.getenv("S3_BUCKET")
    public_base = os.getenv("S3_PUBLIC_BASE_URL", "").rstrip("/")
    if not bucket or not public_base:
        raise HostingError("VIDEO_HOST=s3 needs S3_BUCKET and S3_PUBLIC_BASE_URL")

    client = boto3.client(
        "s3",
        endpoint_url=os.getenv("S3_ENDPOINT_URL") or None,
        aws_access_key_id=os.getenv("S3_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("S3_SECRET_ACCESS_KEY"),
        region_name=os.getenv("S3_REGION", "auto"),
    )
    key = f"{os.getenv('S3_PREFIX', 'postly').strip('/')}/{int(time.time())}-{name}"
    client.upload_file(str(path), bucket, key, ExtraArgs={"ContentType": "video/mp4"})
    return f"{public_base}/{key}"


def _local(path: Path, name: str) -> str:
    """Copy into a directory that something else already serves publicly."""
    directory = os.getenv("LOCAL_VIDEO_DIR")
    public_base = os.getenv("LOCAL_PUBLIC_BASE_URL", "").rstrip("/")
    if not directory or not public_base:
        raise HostingError("VIDEO_HOST=local needs LOCAL_VIDEO_DIR and LOCAL_PUBLIC_BASE_URL")

    target = Path(directory) / f"{int(time.time())}-{name}"
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(path, target)
    return f"{public_base}/{target.name}"
