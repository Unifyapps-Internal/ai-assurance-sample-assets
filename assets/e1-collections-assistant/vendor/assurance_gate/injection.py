"""Prompt-injection heuristics in English and Arabic. Mirrors packages/gate-node/src/injection.ts rule for rule."""

from __future__ import annotations

import re
import unicodedata

_DIACRITICS = re.compile("[ً-ٰٟـ]")
_ALEF = re.compile("[أإآٱ]")
_SPACE = re.compile(r"\s+")


def normalise_text(text: str) -> str:
    """Folds case, compatibility forms, Arabic diacritics, tatweel and letter variants."""
    out = unicodedata.normalize("NFKC", text).lower()
    out = _DIACRITICS.sub("", out)
    out = _ALEF.sub("ا", out)
    out = out.replace("ى", "ي").replace("ة", "ه")
    return _SPACE.sub(" ", out).strip()


def _rule(name: str, pattern: str) -> tuple[str, re.Pattern[str]]:
    return name, re.compile(pattern, re.ASCII)


# Written against normalised text (so Arabic patterns use ا for every alef and ه for ta marbuta).
_RULES: list[tuple[str, re.Pattern[str]]] = [
    _rule(
        "instruction override",
        r"\b(ignore|disregard|forget|override|bypass)\b.{0,40}"
        r"\b(previous|prior|above|earlier|all|any|your|system|safety)\b.{0,30}"
        r"\b(instructions?|rules?|prompts?|guidelines|directions|policies|restrictions)\b",
    ),
    _rule("instruction override", r"\bnew (instructions?|rules?)\s*:"),
    _rule("instruction override", r"\b(from now on|henceforth)\b.{0,40}\b(you (will|must|shall)|obey|only follow)\b"),
    _rule(
        "instruction override",
        r"(^|\s)(تجاهل\S*|تجاوز\S*|انسي?|اهمل\S*|الغي?|الغاء)\s.{0,40}"
        r"(التعليمات|القواعد|الاوامر|التوجيهات|القيود|الارشادات)",
    ),
    _rule("instruction override", r"(تعليمات|اوامر) جديده\s*:"),
    _rule(
        "system prompt extraction",
        r"\b(reveal|show|print|repeat|display|output|leak|tell me|give me|what (is|are|were))\b.{0,40}"
        r"\b(system prompt|system message|hidden prompt|initial prompt|developer message"
        r"|your (instructions|prompt|rules|guidelines))\b",
    ),
    _rule(
        "system prompt extraction",
        r"(اكشف|اظهر|اعرض|اطبع|كرر|اخبرني|اعطني|ما هي|ما هو).{0,40}"
        r"(تعليمات النظام|رساله النظام|موجه النظام|تعليماتك|التعليمات السريه|التعليمات المخفيه|التعليمات الاصليه)",
    ),
    _rule(
        "role-play jailbreak",
        r"\b(dan mode|do anything now|developer mode|jailbreak|jailbroken|unrestricted mode|god mode)\b",
    ),
    _rule(
        "role-play jailbreak",
        r"\b(pretend|act as|role-?play|you are now|imagine you are)\b.{0,80}"
        r"\b(no (rules|restrictions|limits|filters)|without (any )?(rules|restrictions|limits|filters)"
        r"|unrestricted|unfiltered|uncensored)\b",
    ),
    _rule(
        "role-play jailbreak",
        r"(تظاهر|تصرف|تقمص|تخيل انك).{0,60}(بلا قيود|بدون قيود|دون قيود|بلا قواعد|بدون قواعد|غير مقيد)",
    ),
    _rule("role-play jailbreak", r"وضع المطور"),
]


def detect_injection(text: str) -> str | None:
    """Returns the name of the first heuristic the text trips, or None."""
    normalised = normalise_text(text)
    for name, pattern in _RULES:
        if pattern.search(normalised):
            return name
    return None
