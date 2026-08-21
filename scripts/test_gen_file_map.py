"""Self-check for scripts/gen_file_map.py — the FILE-MAP.md generator.

Collectable by pytest (`pytest scripts`) AND runnable directly
(`python scripts/test_gen_file_map.py`), same as the ingest/bench self-checks.

Three things are worth pinning:

  * the directory-coverage gate — a directory with no DIRS entry must fail
    rather than appear undocumented in the map;
  * header extraction for every language the map reads, including the Go
    package-doc convention that keeps `go doc` working;
  * determinism — the map is CI-gated with --check, so two renders of the same
    inputs must be byte-identical.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

import pytest  # noqa: E402

from gen_file_map import (  # noqa: E402
    DIRS,
    OUT,
    ROOT,
    _go_doc,
    _hash_doc,
    _md_doc,
    _py_doc,
    _ts_doc,
    build,
    describe_file,
    directories,
    is_listed,
    missing_dirs,
    render,
    tracked_files,
)


# --- directory coverage ----------------------------------------------------

def test_every_directory_in_the_repo_has_a_dirs_entry():
    # The gate itself, against the real tree: a new folder cannot appear in the
    # map without someone writing down what it is for.
    assert missing_dirs(tracked_files()) == []


def test_missing_dirs_reports_an_undocumented_directory():
    # Ancestors count too: an undocumented parent is as opaque as an undocumented leaf.
    assert missing_dirs(["brand/new/thing.go"]) == ["brand", "brand/new"]


def test_render_refuses_to_emit_a_map_with_an_undocumented_directory():
    with pytest.raises(SystemExit) as e:
        render(["brand/new/thing.go"], lambda rel: "// x\n")
    assert "brand/new" in str(e.value)


def test_dirs_table_has_no_entries_for_directories_that_no_longer_exist():
    # The other half of coverage: stale rows describing folders that were
    # deleted are as misleading as missing ones.
    assert sorted(set(DIRS) - set(directories(tracked_files()))) == []


# --- header extraction, one language at a time -----------------------------

def test_go_package_doc_keeps_the_package_name():
    src = "// Package bus is the Redis seam.\npackage bus\n"
    assert _go_doc(src) == "bus is the Redis seam."


def test_go_file_comment_above_a_package_doc_wins():
    # The convention that lets a file carry its own purpose without stealing
    # the package doc: a blank line separates them, so `go doc` still reads the
    # second block as the package doc while the map reads the first.
    src = "// Wire envelopes for the frontend.\n\n// Package ws is the hub.\npackage ws\n"
    assert _go_doc(src) == "Wire envelopes for the frontend."


def test_go_file_with_no_header_reports_nothing():
    assert _go_doc("package ws\n\nimport \"fmt\"\n") == ""


def test_python_module_docstring_survives_a_shebang():
    assert _py_doc('#!/usr/bin/env python3\n"""Records clips."""\n') == "Records clips."


def test_python_file_with_only_comments_reports_nothing():
    assert _py_doc("# just a comment\nimport os\n") == ""


def test_ts_block_comment_strips_tsdoc_tags():
    src = "/**\n * The app shell.\n * @packageDocumentation\n */\nexport const x = 1\n"
    assert _ts_doc(src) == "The app shell."


def test_ts_line_comment_header():
    assert _ts_doc("// The timing tower.\nimport x from 'y'\n") == "The timing tower."


def test_ts_comment_after_imports_is_not_a_header():
    # Only a true top-of-file header counts; a comment explaining the first
    # declaration is about that declaration, not about the file.
    assert _ts_doc("import x from 'y'\n\n// Explains the const below.\nconst z = 1\n") == ""


def test_hash_comment_header_survives_a_shebang():
    assert _hash_doc("#!/bin/sh\n# Runs the suite.\nexit 0\n") == "Runs the suite."


def test_markdown_front_matter_description_wins():
    src = "---\ntype: Component\ndescription: The Redis seam.\n---\n\n# Redis\n\nProse.\n"
    assert _md_doc(src) == "The Redis seam."


def test_markdown_html_comment_beats_the_first_paragraph():
    assert _md_doc("<!-- What this doc is. -->\n\n# Title\n\nStatus: accepted\n") == "What this doc is."


def test_markdown_falls_back_to_the_first_real_sentence():
    assert _md_doc("# Title\n\n> quote\n\nThe actual opening line.\n") == "The actual opening line."


def test_describe_file_dispatches_on_extension():
    assert describe_file("a/b.go", "// Go header.\n\npackage b\n") == "Go header."
    assert describe_file("a/b.py", '"""Py header."""\n') == "Py header."
    assert describe_file("a/b.tsx", "// TS header.\n") == "TS header."
    assert describe_file("a/Dockerfile", "# Image header.\nFROM x\n") == "Image header."


def test_file_notes_cover_files_that_cannot_carry_a_comment():
    # tsconfig/package.json are strict-JSON in enough tools that a header
    # comment isn't safe; FILE_NOTES keeps them described anyway.
    assert describe_file("web/package.json", "{}") != ""


def test_only_source_and_key_config_files_get_a_row():
    assert is_listed("hub.go") and is_listed("record.py") and is_listed("App.tsx")
    assert is_listed("Dockerfile.live") and is_listed("requirements-dev.txt")
    assert is_listed("go.mod") and is_listed("ci.yml") and is_listed("test.sh")
    assert not is_listed("results.csv")
    assert not is_listed("monza-2024-race.jsonl")
    assert not is_listed("favicon.svg")


# --- determinism -----------------------------------------------------------

def test_render_is_deterministic_for_the_same_inputs():
    files = ["cmd/server/main.go", "internal/ws/hub.go"]
    read = {"cmd/server/main.go": "// A.\n\npackage main\n",
            "internal/ws/hub.go": "// B.\n\npackage ws\n"}
    first = render(files, read.__getitem__)
    second = render(list(reversed(files)), read.__getitem__)
    assert first == second


def test_build_is_stable_across_runs_and_matches_the_committed_map():
    # --check compares byte-for-byte, so an unstable render would make CI flap.
    # In particular the map must not describe itself by reading itself back.
    first = build()
    assert first == build()
    assert OUT.read_text(encoding="utf-8") == first, (
        "FILE-MAP.md is stale - run: python scripts/gen_file_map.py"
    )


def test_generated_map_uses_lf_endings_only():
    # Windows and CI must produce the identical file.
    assert "\r" not in OUT.read_bytes().decode("utf-8")
    assert (ROOT / "FILE-MAP.md").exists()


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
