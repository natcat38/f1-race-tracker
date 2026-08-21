"""Make the self-check scripts importable from any pytest invocation dir.

The scripts in this directory import each other by bare name (`from live
import ...`) so they stay runnable directly (`python ingest/test_radio.py`).
That resolves when pytest runs with ingest/ as cwd (CI does this), but not
from the repo root, where the package __init__.py makes pytest import them
as `ingest.X` without ingest/ on sys.path. Pin it here so both work.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
