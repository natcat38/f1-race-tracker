"""Self-check for scripts/gen_file_map.py's Python directory-purpose precedence.

Collectable by pytest (`pytest scripts`) AND runnable directly
(`python scripts/test_gen_file_map.py`), same as the ingest/bench self-checks.

Covers issue #61: a directory's one-line purpose must come from its own
`__init__.py` module docstring when one exists, and only fall back to the
largest-non-test-file heuristic when it doesn't — so adding lines to an
unrelated module in the directory can never flip the description.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from gen_file_map import _describe, _py_doc, _py_pkg_doc  # noqa: E402


def _write(path, name, text):
    (path / name).write_text(text, encoding="utf-8")


def test_pkg_doc_wins_over_larger_sibling_file(tmp_path):
    # The __init__.py docstring is short; the sibling module is much larger.
    # Precedence must still go to the package docstring (this is the bug from
    # #61: byte count used to decide the winner).
    _write(tmp_path, "__init__.py", '"""Directory-level purpose statement."""\n')
    _write(
        tmp_path,
        "big_module.py",
        '"""A much bigger module with its own, unrelated docstring.\n\n'
        + ("padding line.\n" * 200)
        + '"""\n',
    )
    assert _describe(tmp_path) == "Directory-level purpose statement."


def test_falls_back_to_largest_file_when_no_pkg_doc(tmp_path):
    # No __init__.py at all: behaves exactly like the old heuristic.
    assert _py_pkg_doc(tmp_path) == ""
    _write(tmp_path, "small.py", '"""Small module."""\n')
    _write(tmp_path, "large.py", '"""Large module.\n\n' + ("padding.\n" * 50) + '"""\n')
    assert _describe(tmp_path) == "Large module."
    assert _py_doc(tmp_path) == "Large module."


def test_pkg_doc_ignored_when_empty(tmp_path):
    # An __init__.py with no docstring (or an empty one) is not a declaration —
    # fall through to the largest-file heuristic exactly as if it were absent.
    _write(tmp_path, "__init__.py", "# no docstring here\n")
    _write(tmp_path, "only.py", '"""Only real docstring in the directory."""\n')
    assert _py_pkg_doc(tmp_path) == ""
    assert _describe(tmp_path) == "Only real docstring in the directory."


def test_init_py_excluded_from_largest_file_fallback(tmp_path):
    # Even if __init__.py itself is the largest file and carries no usable
    # docstring, it must not be picked up by the largest-file scan either —
    # it is the package marker, not a candidate module.
    _write(tmp_path, "__init__.py", "# " + ("x" * 5000) + "\n")
    _write(tmp_path, "tiny.py", '"""The real answer."""\n')
    assert _describe(tmp_path) == "The real answer."


def test_growing_one_module_does_not_change_a_directory_with_a_pkg_doc(tmp_path):
    # Regression for the exact scenario in #61: ingest/live_signalr.py grew and
    # flipped the directory description. With a package docstring declared,
    # growing any sibling module must be a no-op for _describe's result.
    _write(tmp_path, "__init__.py", '"""Stable directory purpose."""\n')
    _write(tmp_path, "a.py", '"""A."""\n')
    before = _describe(tmp_path)
    _write(tmp_path, "a.py", '"""A, but now much longer.\n\n' + ("more.\n" * 500) + '"""\n')
    after = _describe(tmp_path)
    assert before == after == "Stable directory purpose."


if __name__ == "__main__":
    import pytest

    sys.exit(pytest.main([__file__, "-v"]))
