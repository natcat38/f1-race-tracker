"""Records FastF1 sessions to JSONL replay clips and runs the true-live SignalR ingest path.

This file exists to give the directory a stable, deliberate one-line purpose for
FILE-MAP.md (scripts/gen_file_map.py's _py_pkg_doc) instead of letting the
description flip to whichever module happens to be the largest — see issue #61.
It is not meant to be imported: ingest/ modules import each other as plain
top-level modules (e.g. `from live_signalr import ...`), and pytest is invoked
as `pytest .` from inside ingest/, so this file carries no other behaviour.
"""
