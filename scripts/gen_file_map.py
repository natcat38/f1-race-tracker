#!/usr/bin/env python3
"""Generate FILE-MAP.md — the repo's "where is what, and why" index for agents.

FILE-MAP.md is one third of the repo's memory system: CONTEXT.md is the
glossary, docs/adr/ holds the decisions, and this map holds the layout. An
agent should be able to answer "which file do I open?" from the map alone,
without crawling the tree.

Two sources feed the map, and only two:

  * Directory purposes come from the hand-maintained DIRS table below. It is
    the single place a folder's reason for existing is written down, and
    --check fails if a directory exists with no entry — new folders cannot
    appear undocumented.
  * File purposes come from each file's own header comment or docstring (Go
    comments, Python docstrings, TS/JS comments, `#` comments in Dockerfiles /
    YAML / ini / requirements, a Markdown file's front matter or leading HTML
    comment). The map
    therefore cannot drift from the code: edit the header, regenerate, done.
    A file with no header renders a blank Purpose, which makes the gap visible
    rather than inventing prose for it.

  python scripts/gen_file_map.py            # rewrite FILE-MAP.md
  python scripts/gen_file_map.py --check    # exit 1 if FILE-MAP.md is stale (CI)
"""
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "FILE-MAP.md"

# ---------------------------------------------------------------------------
# Layers, in reading order: data flows ingest -> seam -> gateway -> web, and
# everything else supports that pipeline.
# ---------------------------------------------------------------------------
LAYERS = [
    ("Root", "The front doors: what the repo is, how it builds, how it runs."),
    ("Ingest", "Python. Turns real or synthetic F1 sessions into replay clips and live frames."),
    ("Seam", "Go. The normalised contract and the Redis snapshot/pub-sub seam every layer talks through."),
    ("Gateway", "Go. Reads the seam and fans frames out to browsers over WebSocket."),
    ("Web", "TypeScript/React. The dashboard that renders the frames."),
    ("Tooling", "Scripts, benchmarks, CI workflows — how the repo tests, measures and ships itself."),
    ("Docs", "The memory system itself: glossary, decisions, agent how-tos, background notes."),
    ("Data", "Recorded clips and fixtures the other layers read."),
]

# Directory -> (layer, one-line purpose). Hand-maintained on purpose: a folder's
# reason for existing is a human judgement, not something to scrape. Adding a
# directory without adding a row here fails --check.
DIRS = {
    ".": ("Root", "Repo root: module definition, container build, compose stack, and the top-level docs an agent reads first."),
    ".github": ("Tooling", "GitHub repo configuration that isn't a workflow."),
    ".github/workflows": ("Tooling", "CI: the checks that gate every PR, plus the GitHub Pages static-demo deploy."),
    "bench": ("Tooling", "The benchmark harness behind BENCHMARKS.md — drives cmd/loadtest and records gateway resource usage."),
    "cmd": ("Gateway", "Go entry points; one subdirectory per binary."),
    "cmd/bake-static": ("Tooling", "Bakes a replay clip into newline-delimited WebSocket envelopes for the GitHub Pages static demo."),
    "cmd/genclip": ("Tooling", "Synthesises a fake circular-track clip so the pipeline can be exercised without live F1 data."),
    "cmd/loadtest": ("Tooling", "Concurrency load generator for the gateway; produces the numbers in BENCHMARKS.md."),
    "cmd/server": ("Gateway", "The single production binary — runs as gateway or replay writer depending on config.Role."),
    "data": ("Data", "Recorded and synthesised inputs. Large; read by path, never listed file-by-file here."),
    "data/replays": ("Data", "JSONL replay clips (tens of MB each): recorded F1 sessions plus one synthetic clip. Produced by ingest/record.py or cmd/genclip, consumed by internal/feed/replay."),
    "docs": ("Docs", "Long-form documentation: product and technical scope, UX evaluations, and the subtrees below."),
    "docs/adr": ("Docs", "Architecture Decision Records — why the system is shaped the way it is. Read the ones touching your area before changing it."),
    "docs/agents": ("Docs", "How-to guides for agents working in this repo: issue tracker, triage labels, domain docs."),
    "docs/assets": ("Docs", "Screenshots embedded in the README and docs."),
    "docs/runbooks": ("Docs", "Operational procedures for humans — verifying a live session, etc."),
    "docs/superpowers": ("Docs", "Artefacts from planning sessions, kept as a record of how decisions were reached."),
    "docs/superpowers/plans": ("Docs", "Historical implementation plans. Kept for provenance; not current instructions."),
    "docs/superpowers/specs": ("Docs", "Historical design specs and spike findings. Kept for provenance; not current instructions."),
    "memory": ("Docs", "Portable cross-session agent memory: one fact per file, indexed by memory/MEMORY.md. Lives in the repo (not .claude/) so it survives machine and agent changes."),
    "ingest": ("Ingest", "The Python side: records FastF1 sessions to JSONL clips and runs the true-live SignalR ingest path."),
    "ingest/tests": ("Ingest", "Captured SignalR wire samples used as fixtures by the ingest tests."),
    "internal": ("Seam", "Go internals; not importable outside this module."),
    "internal/app": ("Gateway", "Wires the replay source, the bus and the hub into the runnable gateway/writer roles."),
    "internal/bus": ("Seam", "The Redis seam: snapshot store plus frame pub/sub."),
    "internal/config": ("Gateway", "Loads and validates the process's environment configuration."),
    "internal/feed": ("Ingest", "Frame sources that feed the seam."),
    "internal/feed/replay": ("Ingest", "Reads a .jsonl clip and replays it as a paced frame stream."),
    "internal/model": ("Seam", "The normalised contract shared by every layer — the shape of a frame."),
    "internal/ws": ("Gateway", "The gateway-side WebSocket fan-out hub and its HTTP handler."),
    "knowledge": ("Docs", "Background notes on the domain and the components, written for orientation rather than as decisions."),
    "knowledge/components": ("Docs", "How each component works: ingest pipeline, Redis pub/sub, replay engine, WebSocket protocol."),
    "knowledge/data": ("Docs", "Notes on the upstream data sources the ingest layer depends on."),
    "knowledge/domain": ("Docs", "Notes on F1 domain concepts: the event model, leaderboard rules."),
    "scripts": ("Tooling", "Repo-level developer scripts: the full test sweep and this map generator."),
    "testdata": ("Data", "Golden fixtures shared across Go tests."),
    "testdata/contract": ("Data", "The golden snapshot pinning the wire contract between Go, Python and the frontend."),
    "web": ("Web", "The React dashboard, plus the Go embed that serves its build output same-origin."),
    "web/dist": ("Web", "Vite build output. Generated, gitignored except for the .gitkeep that keeps web/embed.go compiling."),
    "web/public": ("Web", "Static assets copied verbatim into the build: favicon and social preview image."),
    "web/src": ("Web", "The app shell: entry point, root component, error boundary, static-demo bootstrap."),
    "web/src/components": ("Web", "Presentational components — map, timing tower, telemetry, comms, race control, the lap-delta overlay — and their shared layout and formatting helpers."),
    "web/src/hooks": ("Web", "Hooks deriving UI-facing state (staleness, gap/lap history, smoothed positions, comms playback) from the raw RaceState stream."),
    "web/src/realtime": ("Web", "Data-source connections: a reconnecting live WebSocket and a paced static-replay reader, both feeding the same reducer."),
    "web/src/state": ("Web", "Race state: wire message types, the applyMessage reducer, and the comms/ghost/auth sub-state it composes."),
    "web/src/styles": ("Web", "Global CSS: design tokens and component styles."),
}

# Directories whose contents are deliberately summarised rather than listed.
SUMMARY_ONLY = {"docs/superpowers/plans", "docs/superpowers/specs"}

# What FILE-MAP.md says about itself. Not read back off disk: the generator would
# be describing the previous run's output, so a fresh checkout and a regenerated
# one would disagree and --check would flip between them.
SELF_DESC = (
    "Where every directory and source file lives and why — the layout half of "
    "the repo's memory system, generated from the DIRS table and each file's "
    "own header comment."
)

# Files that carry no comment syntax we're willing to abuse (strict JSON, lock
# files). Kept here rather than left blank so the map stays honest about them.
FILE_NOTES = {
    "FILE-MAP.md": SELF_DESC,
    "web/package.json": "Frontend dependencies and the npm scripts CI runs (lint, test, build).",
    "web/tsconfig.json": "TypeScript project root — references the app and node configs below.",
    "web/tsconfig.app.json": "TypeScript settings for the browser app sources under web/src.",
    "web/tsconfig.node.json": "TypeScript settings for the Node-side build files (vite.config.ts).",
}

# Extensions worth a row of their own, plus config/build files matched by name.
CODE_SUFFIXES = {".go", ".py", ".ts", ".tsx", ".js", ".md", ".yml", ".sh", ".ps1"}
CONFIG_NAMES = {"go.mod", "pytest.ini", "package.json"}
CONFIG_PATTERNS = (
    re.compile(r"^Dockerfile"),
    re.compile(r"^requirements.*\.txt$"),
    re.compile(r"^tsconfig.*\.json$"),
)
# Directories never walked: build output, caches, vendored deps, agent scratch.
SKIP_PARTS = {"node_modules", "__pycache__", ".venv", ".git", ".claude", "reviews"}

GO_PKG_DOC = re.compile(r"^// Package (\w+)\s+(.*)$")


def _first_sentence(text, capitalize=True):
    text = " ".join(text.split())
    if not text:
        return ""
    cut = re.split(r"(?<=[.!?])\s", text, maxsplit=1)[0]
    return cut[:1].upper() + cut[1:] if capitalize else cut


def _leading_block(src, prefix):
    """Text of the first contiguous run of `prefix` comment lines at the top.

    Blank lines and shebangs before the block are skipped; anything else ends
    the search, so a comment buried mid-file is never mistaken for a header.
    """
    lines = []
    for raw in src.splitlines():
        line = raw.strip()
        if not lines and (not line or line.startswith("#!")):
            continue
        if line.startswith(prefix):
            lines.append(line[len(prefix):].strip())
            continue
        break
    return " ".join(x for x in lines if x)


def _go_doc(src):
    """Header comment of a .go file, package doc or plain file comment alike.

    `// Package x <desc>` (the doc comment immediately above `package x`) yields
    `<desc>`; any other leading `//` block is taken verbatim. Non-doc files
    therefore carry a normal comment separated from `package` by a blank line,
    which gofmt leaves alone and go/doc does not treat as a package doc.
    """
    block = _leading_block(src, "//")
    m = GO_PKG_DOC.match("// " + block) if block else None
    if m:
        # "Package bus is the Redis seam" -> "bus is the Redis seam": a sentence
        # once "Package " is dropped, and package names stay lowercase.
        return _first_sentence(f"{m.group(1)} {m.group(2)}", capitalize=False)
    return _first_sentence(block)


def _py_doc(src):
    """First line of a Python module docstring, past any shebang/comment preamble."""
    src = re.sub(r"\A(?:\s*#[^\n]*\n)+", "", src)
    m = re.match(r'\s*(?:"""|\'\'\')(.*?)(?:"""|\'\'\')', src, re.S)
    if not m or not m.group(1).strip():
        return ""
    body = [ln.strip() for ln in m.group(1).strip().splitlines()]
    return _first_sentence(next((ln for ln in body if ln), ""))


def _ts_doc(src):
    """Header comment of a .ts/.tsx/.js file: `/** ... */` block or `//` run.

    TSDoc's `@packageDocumentation` tag is stripped when present — it marks a
    comment as describing the module, which is exactly what a header is.
    """
    m = re.match(r"\s*/\*\*?(.*?)\*/", src, re.S)
    if m:
        body = re.sub(r"^\s*\*?\s*@\w+.*$", "", m.group(1), flags=re.M)
        lines = [ln.strip().lstrip("*").strip() for ln in body.splitlines()]
        return _first_sentence(" ".join(ln for ln in lines if ln))
    return _first_sentence(_leading_block(src, "//"))


def _hash_doc(src):
    """Header comment of a `#`-commented file (Dockerfile, YAML, ini, txt)."""
    return _first_sentence(_leading_block(src, "#"))


def _md_doc(src):
    """Purpose of a Markdown file.

    A YAML front-matter `description:` wins where one exists (the knowledge
    notes already carry them). Failing that, an HTML comment at the very top — the Markdown equivalent of a header
    comment, invisible when rendered, for documents whose opening paragraph
    doesn't describe the document. Otherwise the first real sentence, skipping
    the title and any badges.
    """
    fm = re.match(r"\s*---\n(.*?)\n---", src, re.S)
    if fm:
        d = re.search(r"^description:\s*(.+)$", fm.group(1), re.M)
        if d:
            return _first_sentence(d.group(1).strip())
    m = re.match(r"\s*<!--(.*?)-->", src, re.S)
    if m and m.group(1).strip():
        return _first_sentence(m.group(1))
    for raw in src.splitlines():
        line = raw.strip()
        if not line or line.startswith(("#", ">", "|", "!", "[", "---", "<")):
            continue
        return _first_sentence(line)
    return ""


EXTRACTORS = {
    ".go": _go_doc,
    ".sh": _hash_doc,
    ".ps1": _hash_doc,
    ".yml": _hash_doc,
    ".py": _py_doc,
    ".ts": _ts_doc,
    ".tsx": _ts_doc,
    ".js": _ts_doc,
    ".mod": _go_doc,
    ".md": _md_doc,
}


def describe_file(rel, src):
    """One-line purpose for `rel`, read out of its own contents (or FILE_NOTES)."""
    if rel in FILE_NOTES:
        return FILE_NOTES[rel]
    name = rel.rsplit("/", 1)[-1]
    suffix = "." + name.rsplit(".", 1)[-1] if "." in name else ""
    return EXTRACTORS.get(suffix, _hash_doc)(src)


def is_listed(name):
    """Does a file get its own row, or is it just part of its directory's story?"""
    if "." in name and "." + name.rsplit(".", 1)[-1] in CODE_SUFFIXES:
        return True
    return name in CONFIG_NAMES or any(p.search(name) for p in CONFIG_PATTERNS)


def tracked_files(root=ROOT):
    """Repo-relative paths of every tracked file, minus the skipped trees.

    git is the source of truth so build output and untracked scratch can never
    leak into the map.
    """
    out = subprocess.run(
        ["git", "-C", str(root), "ls-files"],
        check=True, capture_output=True, text=True,
    ).stdout
    return sorted(
        p for p in out.splitlines()
        if p and not SKIP_PARTS & set(p.split("/")[:-1])
    )


def _dir_of(rel):
    return rel.rsplit("/", 1)[0] if "/" in rel else "."


def directories(files):
    """Every directory the map covers, intermediate ones included.

    A folder that only holds other folders (`cmd`, `internal`) still needs a
    purpose — it is a signpost an agent reads on the way down — so ancestors
    count towards coverage just like leaves do.
    """
    seen = set()
    for f in files:
        d = _dir_of(f)
        while d != ".":
            seen.add(d)
            d = _dir_of(d)
        seen.add(".")
    return sorted(seen)


def missing_dirs(files):
    """Directories with no DIRS entry — the coverage gate --check enforces."""
    return [d for d in directories(files) if d not in DIRS]


def render(files, read):
    """Render FILE-MAP.md. `read(rel)` returns a file's text (injectable for tests)."""
    gaps = missing_dirs(files)
    if gaps:
        raise SystemExit(
            "FILE-MAP: no DIRS entry for: " + ", ".join(gaps)
            + "\nAdd one to the DIRS table in scripts/gen_file_map.py."
        )

    by_dir = {}
    for f in files:
        if is_listed(f.rsplit("/", 1)[-1]):
            by_dir.setdefault(_dir_of(f), []).append(f)

    out = [
        f"<!-- {SELF_DESC} -->",
        "# FILE-MAP",
        "",
        "Generated by `scripts/gen_file_map.py` — **do not hand-edit.**",
        "",
        "Where everything lives and why. This is the layout half of the repo's",
        "memory: read **FILE-MAP.md** for structure, **CONTEXT.md** for vocabulary,",
        "**`docs/adr/`** for decisions, **`docs/agents/`** for how-tos.",
        "",
        "Directory purposes come from the `DIRS` table in the generator — the one",
        "place a folder's reason for existing is written down, and a directory with",
        "no entry fails `--check`. File purposes are read out of each file's own",
        "header comment or docstring, so they cannot drift from the code: edit the",
        "header and regenerate. A blank Purpose means the file declares none.",
        "",
        "Regenerate with `python scripts/gen_file_map.py`; CI fails if stale.",
        "",
    ]

    listed = 0
    blank = 0
    for layer, blurb in LAYERS:
        members = sorted(d for d, (lay, _) in DIRS.items() if lay == layer and d in set(directories(files)))
        if not members:
            continue
        out += [f"## {layer}", "", f"_{blurb}_", ""]
        for d in members:
            out += [f"### `{'/' if d == '.' else d}`", "", DIRS[d][1], ""]
            rows = [] if d in SUMMARY_ONLY else by_dir.get(d, [])
            if not rows:
                continue
            out += ["| File | Purpose |", "| --- | --- |"]
            for rel in rows:
                desc = describe_file(rel, read(rel))
                listed += 1
                blank += not desc
                out.append(f"| `{rel.rsplit('/', 1)[-1]}` | {desc} |")
            out.append("")

    out += [
        "---",
        "",
        f"{len(DIRS)} directories, {listed} files listed, "
        f"{blank} without a declared purpose.",
        "",
    ]
    return "\n".join(out)


def build():
    files = tracked_files()
    return render(files, lambda rel: (ROOT / rel).read_text(encoding="utf-8", errors="replace"))


def main():
    text = build()
    if "--check" in sys.argv:
        current = OUT.read_text(encoding="utf-8") if OUT.exists() else ""
        if current != text:
            print("FILE-MAP.md is stale - run: python scripts/gen_file_map.py")
            return 1
        print("FILE-MAP.md is current")
        return 0
    # newline="" keeps the LF endings built above intact on Windows, so the file
    # is byte-identical wherever it is generated and --check never trips on CRLF.
    with OUT.open("w", encoding="utf-8", newline="") as fh:
        fh.write(text)
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
