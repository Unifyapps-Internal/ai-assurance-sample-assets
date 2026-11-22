"""Assurance Gate for Python: signed policy pushes, masking, input checks, AI label, role map, masked logs, traces."""

from .gate import GATE_VERSION, REFRESH_INTERVAL_MS, Decision, Gate, create_gate
from .injection import detect_injection, normalise_text
from .policy import BUILT_IN_PATTERNS, DEFAULT_LABEL, DEFAULT_REFUSAL, Policy, PolicyError, normalise_policy
from .signature import MAX_SKEW_MS, canonical_json, is_fresh, parse_timestamp, sign, verify_signature
from .stores import BlobClient, BlobStore, FileStore, MemoryStore, PolicyStore, VercelBlobClient, store_from_env
from .telemetry import SpanHandle, Telemetry

__all__ = [
    "BUILT_IN_PATTERNS",
    "DEFAULT_LABEL",
    "DEFAULT_REFUSAL",
    "GATE_VERSION",
    "MAX_SKEW_MS",
    "REFRESH_INTERVAL_MS",
    "BlobClient",
    "BlobStore",
    "Decision",
    "FileStore",
    "Gate",
    "MemoryStore",
    "Policy",
    "PolicyError",
    "PolicyStore",
    "SpanHandle",
    "Telemetry",
    "VercelBlobClient",
    "canonical_json",
    "create_gate",
    "detect_injection",
    "is_fresh",
    "normalise_policy",
    "normalise_text",
    "parse_timestamp",
    "sign",
    "store_from_env",
    "verify_signature",
]
