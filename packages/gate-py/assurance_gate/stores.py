"""Policy stores: memory (tests), file (local development), Vercel Blob (deployed)."""

from __future__ import annotations

import copy
import json
import os
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Mapping
from pathlib import Path
from typing import Any, Protocol

StoredPolicies = dict[str, Any]
"""{"current": policy, "previous": policy | None}"""


class PolicyStore(Protocol):
    kind: str

    def read(self) -> StoredPolicies | None: ...

    def write(self, state: StoredPolicies) -> None: ...


class MemoryStore:
    kind = "memory"

    def __init__(self) -> None:
        self._state: StoredPolicies | None = None

    def read(self) -> StoredPolicies | None:
        return copy.deepcopy(self._state)

    def write(self, state: StoredPolicies) -> None:
        self._state = copy.deepcopy(state)


class FileStore:
    kind = "file"

    def __init__(self, path: str | os.PathLike[str]) -> None:
        self._path = Path(path)

    def read(self) -> StoredPolicies | None:
        try:
            text = self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return None
        state: StoredPolicies = json.loads(text)
        return state

    def write(self, state: StoredPolicies) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        temp = self._path.with_name(f"{self._path.name}.{os.getpid()}.tmp")
        temp.write_text(json.dumps(state, indent=2, ensure_ascii=False), encoding="utf-8")
        os.replace(temp, self._path)


class BlobClient(Protocol):
    """The two calls the gate needs from Vercel Blob; injectable so tests never touch the network."""

    def put(self, pathname: str, body: str) -> None: ...

    def get(self, pathname: str) -> str | None: ...


class VercelBlobClient:
    """Vercel Blob over its REST interface with urllib.

    Not verified against the live service: no Blob token was available when this was written. The request shape
    follows what the official JavaScript SDK sends (bearer token, x-api-version, overwrite without a random suffix).
    """

    API = "https://blob.vercel-storage.com"
    API_VERSION = "7"

    def __init__(self, token: str, access: str = "private", timeout: float = 10.0) -> None:
        self._token = token
        self._access = access
        self._timeout = timeout

    def _open(self, request: urllib.request.Request) -> bytes:
        request.add_header("authorization", f"Bearer {self._token}")
        request.add_header("x-api-version", self.API_VERSION)
        with urllib.request.urlopen(request, timeout=self._timeout) as response:
            body: bytes = response.read()
            return body

    def put(self, pathname: str, body: str) -> None:
        request = urllib.request.Request(
            f"{self.API}/{urllib.parse.quote(pathname)}", data=body.encode("utf-8"), method="PUT"
        )
        request.add_header("x-content-type", "application/json")
        request.add_header("x-add-random-suffix", "0")
        request.add_header("x-allow-overwrite", "1")
        request.add_header("x-cache-control-max-age", "60")
        request.add_header("x-vercel-blob-access", self._access)
        self._open(request)

    def get(self, pathname: str) -> str | None:
        query = urllib.parse.urlencode({"prefix": pathname, "limit": "10"})
        listing = json.loads(self._open(urllib.request.Request(f"{self.API}?{query}")))
        blob = next((b for b in listing.get("blobs", []) if b.get("pathname") == pathname), None)
        if blob is None:
            return None
        try:
            return self._open(urllib.request.Request(str(blob["url"]))).decode("utf-8")
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return None
            raise


class BlobStore:
    kind = "blob"

    def __init__(
        self, asset_id: str, token: str | None = None, access: str = "private", client: BlobClient | None = None
    ) -> None:
        if client is None and not token:
            raise ValueError("BlobStore needs a token or a client")
        self._client: BlobClient = client if client is not None else VercelBlobClient(str(token), access)
        self._pathname = f"assurance-gate/{asset_id}/policy.json"

    def read(self) -> StoredPolicies | None:
        text = self._client.get(self._pathname)
        if text is None:
            return None
        state: StoredPolicies = json.loads(text)
        return state

    def write(self, state: StoredPolicies) -> None:
        self._client.put(self._pathname, json.dumps(state, separators=(",", ":"), ensure_ascii=False))


def store_from_env(
    asset_id: str, file_path: str | os.PathLike[str], env: Mapping[str, str] | None = None
) -> PolicyStore:
    """BlobStore when BLOB_READ_WRITE_TOKEN exists (ASSURANCE_BLOB_ACCESS private by default), else a FileStore."""
    source = os.environ if env is None else env
    token = source.get("BLOB_READ_WRITE_TOKEN")
    if not token:
        return FileStore(file_path)
    access = "public" if source.get("ASSURANCE_BLOB_ACCESS") == "public" else "private"
    return BlobStore(asset_id, token=token, access=access)
