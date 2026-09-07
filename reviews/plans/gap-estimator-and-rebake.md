# Gap estimator rework + clip re-bake — plan for approval

Status: **proposal**. Scope: `ingest/record.py`'s gap/interval pass, a new validation
script, a re-bake of the three committed clips, and retirement of the frontend
workarounds added for the old estimator (review finding **M10**).

---

## 1. Evidence — where the 0.566 s comes from

**Root cause: `_lap_fraction()` snaps each car to the nearest of the 150 baked
track-outline points, so race distance is quantised to 1/150 of a lap. That quantum
is then priced at a constant `LEADER_LAP_MS`, giving `LEADER_LAP_MS / 150` ms per
step.** It is not the position sample cadence (positions are interpolated onto a
clean 10 Hz grid) and not `LEADER_LAP_MS` on its own.

`ingest/record.py:434-437`:

```python
def _lap_fraction(nx, ny):
    """Fraction [0,1) around the lap = nearest baked-outline index / N."""
    d = (_track_xy[:, 0] - nx) ** 2 + (_track_xy[:, 1] - ny) ** 2
    return int(np.argmin(d)) / len(_track_xy)      # N = TRACK_POINTS = 150
```

Measured by a read-only scan of every `gapMs`/`intMs` value in a frame sample of each
committed clip — the set of distinct values is exactly the integer multiples of one step:

| clip | outline points | observed step | step x 150 | implied median lap |
|---|---|---|---|---|
| monza-2024 | 150 | 566 ms | 84 900 ms | 1:24.9 |
| monza-2023 | 150 | 580 ms | 87 000 ms | 1:27.0 |
| silverstone-2024 | 150 | 621 ms | 93 150 ms | 1:33.2 |

Each clip's quantum is its own field-median lap time divided by 150. That is the whole
explanation. The frontend's `GAP_RESOLUTION_MS = 566` comment attributes it to "the
recorder's cadence" — that attribution is wrong; it is the outline resolution.

**Second, worse defect: the 150 outline points are not evenly spaced in distance.**
They are a `np.linspace` over *sample indices* of one leader lap (`record.py:271-274`),
and position samples are uniform in *time*, so points bunch up where the car is slow.
Measured on the Monza 2024 outline, segment lengths span **9.9 m to 83.5 m** (8.4x
spread, median 37.8 m). Every one of those segments is charged the same 566 ms. In real
terms one step is worth roughly 0.3 s of race time in the Parabolica and roughly 1.0 s
on the main straight — so the estimator is not merely coarse, it is *systematically
biased by where on the lap each car happens to be*. That, not noise, is what produces
the non-monotonic column M10 reports (P3 `+7.364` behind P4 `+3.965`): two cars in
different track sectors are being measured with different rulers.

Third: `gap_ms = behind_lap_units * LEADER_LAP_MS` prices distance at the whole field's
median lap. A car losing 3 s/lap in traffic and the leader on a hot lap convert with the
same constant.

Other facts confirmed while looking:

- The **live** path (`ingest/live_signalr.py:_extract_timing`) already reads official
  `GapToLeader` / `IntervalToPositionAhead` off the SignalR feed into the same
  `gapMs` / `gapLaps` / `intMs` fields. **The wire contract needs no new fields** —
  replay just has to produce numbers as good as live's.
- The **ghost / overlay** view (`web/src/components/Ghost.tsx`) reads `lapTrace` and car
  positions only. It never references `gapMs`, `gapLaps` or `intMs`. Unaffected.
- `BENCHMARKS.md` makes **no** claim about gap fidelity. `CONTEXT.md` describes gap and
  interval as best-effort, derived at record time — still true after the change; only a
  small wording sharpening is needed.

---

## 2. Proposed estimator

The shape: **measure progress in metres of arc length along a distance-parameterised
centreline, then convert metres to seconds by inverting the leader's own distance-time
curve** — instead of measuring progress in outline-index steps and pricing them at a
field-median lap time.

### 2.1 A distance-parameterised centreline

Built once per bake, separately from the 150-point display outline (which stays at 150 —
it is a rendering asset and is fine):

1. Take the same clean leader lap already selected for the outline, at full position
   sample rate (hundreds of points, not 150).
2. Compute cumulative Euclidean arc length `s` over the raw FastF1 X/Y (metres, not
   normalised units) and close the loop.
3. Resample to `CENTRELINE_POINTS = 2000` nodes **evenly spaced in `s`**. At Monza that
   is ~2.9 m per node, uniform by construction — which kills the 8.4x spacing bias.
4. Nearest-node lookup by plain `np.argmin` over 2000 points (cheap at 20 cars x ~4500
   frames); a `scipy` KD-tree is optional and not worth a new dependency.

### 2.2 Per-car race distance, in metres, interpolated

For a car at raw `(x, y)`:

- find the nearest centreline node `i`;
- **project onto the segment** between `i` and its better neighbour:
  `s = s_i + clamp(dot(p - c_i, u), 0, |seg|)`, with `u` the unit segment direction.
  This removes node quantisation entirely — resolution becomes continuous, limited by
  position-data noise rather than by node count;
- race distance `D = lap_number * L + s`, with `L` the centreline lap length.

Lap rollover uses the existing `_lap_number()` step lookup plus one guard: if `s` jumps
backwards by more than `0.9 * L` between consecutive frames while `lap_number` has not
incremented (or vice versa), trust the monotonicity of `D` and carry the previous lap
index for that frame. Standard start/finish straddle fix; prevents a one-frame `+1 LAP`
flash.

### 2.3 Metres to seconds — the leader's own recent pace

`gapMs` answers "how long ago was the leader here?", so compute exactly that:

- keep the leader's rolling `(t, D_leader)` history across the window (already computed
  frame by frame);
- for a car at `D_car` at time `t`, **invert the leader's distance-time curve**: find
  `t_lead` with `D_leader(t_lead) = D_car` by linear interpolation between the two
  bracketing leader samples; then `gapMs = (t - t_lead) * 1000`.

No lap-time constant is involved at all, and a slow corner is automatically priced as a
slow corner because the leader took that long there too.

`intMs` is the same inversion against the **car ahead in the reconciled running order**'s
own distance-time curve — not a subtraction of leader gaps, and not `prev_dist - dist`
times a constant. When the car ahead's history does not yet reach `D_car` (first frames
of the window), fall back to `gap_self - gap_ahead`, which is safe and non-negative.

**Lap deficit** stays distance-derived but honest: `gapLaps = floor((D_leader - D_car) / L)`
with the existing 0.1-lap tolerance. Because `D` is continuous metres, this is no longer
capable of the lap-number-difference bug that the frontend's `lapsDown()` exists to paper
over.

### 2.4 Explicit handling of the awkward cases

| case | behaviour |
|---|---|
| **Pit lane** | The pit lane is not on the centreline; projection would smear a stopped car onto the nearest track point. When `_in_pit(dnum, t)` is true, **freeze** `D` at its pit-entry value and emit **no** `gapMs`/`intMs` for that frame. The UI already renders `IN PIT` from `status: "Pit"` (`statusLabel`), so nothing is lost. Resume live projection at `PitOutTime`. |
| **Lapped cars** | Handled naturally — the leader's curve is inverted at `D_car`, possibly a full lap back in time, giving a true "how long ago" figure. Emit both `gapLaps >= 1` and the real `gapMs`; the UI's seconds-mode toggle already chooses between them. |
| **First lap / window start** | The leader's curve only exists from the window's first frame. Keep the existing guard (suppress until both cars have a completed reference lap) and additionally suppress when `D_car < D_leader(t_0)`. Honest em-dash, never a fabricated number. |
| **Retired (`Out`)** | No gap emitted; `statusLabel` renders `OUT`. |
| **Leader anchoring** | Unchanged — anchor to the *classified* P1 from `reconcile_positions`, not the max-`D` car. |
| **Monotonicity** | By construction: `gapMs` is a strictly increasing function of `-D_car` against one shared curve, so a car further back can never show a smaller gap. This kills M10's contradiction upstream instead of clamping it in the browser. |

### 2.5 Expected resolution and failure modes

**Expected resolution: ~50–100 ms**, dominated by the 10 Hz grid and position noise, not
by any quantum. Error budget:

- leader-curve inversion between 100 ms samples, linear: **< ±20 ms** at steady speed;
- FastF1 position accuracy (~1–3 m longitudinal) at 250 km/h: **~15–45 ms**;
- centreline projection residual (each car's racing line differs from the one leader lap
  the centreline is built from): **~30–80 ms** — the largest single term, irreducible
  without per-car reference laps.

So: honest at **one decimal place (0.1 s)** everywhere. That is defensible to an
F1-literate reader, who knows the official feed's three decimals come from physical
timing loops this data set does not contain. There is no longer any case for printing
three decimals, and this plan does not propose to.

Failure modes to document in the docstring and `CONTEXT.md`:

1. **Different racing lines** — a wider line covers more metres and reads marginally
   behind. Tens of ms; unavoidable.
2. **Safety car / red flag** — the leader's curve flattens and inversion near a plateau
   amplifies error. The three chosen windows are green-flag: **accept and document**.
3. **Pit lane length** — a car in the pits accrues no track distance, so its gap jumps by
   the whole stop on exit. Correct (it is what a pit wall sees) but abrupt; the `Pit`
   status covers the stop itself.
4. **Window edges** — no gap for roughly the first lap of the window for cars ahead of
   the leader's earliest sample. Deliberate.
5. **Single-lap centreline** — an odd reference lap biases the whole field by a constant,
   which cancels in *interval* and largely cancels in *gap*.

Proportionality: roughly 80–120 lines of Python replacing ~30. No new runtime dependency.
This is not a timing system and will not claim to be — but every number it prints is one
it can justify.

---

## 3. Validation plan — `ingest/check_gaps.py` (committed self-check)

**Ground truth needs no new download.** `session.laps` carries `LapStartTime` per driver
per lap — the moment that driver crossed the start/finish line. At the instant the leader
crosses the line on lap `n`, the true gap for car `c` on the lead lap is
`LapStartTime[c, n] - LapStartTime[leader, n]`, which is exact official timing-loop data.
Each clip window spans 4–5 crossings x ~20 cars = **80–100 independent ground-truth
points per clip**.

The script:

1. Loads the session from `cache/` (offline) and the matching baked clip.
2. For each driver and each in-window line crossing, finds the clip frame nearest that
   driver's `LapStartTime` and reads the baked `gapMs`.
3. Compares against the official `LapStartTime` difference; separately compares `intMs`
   against the adjacent-driver crossing difference.
4. Reports per clip: **N points, mean signed error (bias), median |error|, p95 |error|,
   max |error|**, plus a monotonicity check (fraction of frames where the gap column is
   non-decreasing down the running order — must be 100%).
5. Exits non-zero if median |error| > 250 ms, p95 > 600 ms, or monotonicity < 100%.

Thresholds get set after phase 0 runs it against the **old** clips, so the before/after
numbers both go in the PR body and the script is not marking its own homework.

CI has no FastF1 cache, so gate the full script as a local/manual check and additionally
extract the pure geometry (arc length, segment projection, curve inversion) into a
dependency-free `ingest/geometry.py`, unit-tested in the existing CI contract job — the
same pattern `resample.py` and `ghost.py` already follow.

---

## 4. Re-bake plan

### 4.1 Commands (windows unchanged — they are content-chosen)

The lap windows stay **exactly** as documented in `ingest/README.md`. They were chosen
because they contain real green-flag pit stops, which is what makes tyre stints, pit
status and the strategy chart show anything at all; the default window lands on laps 1–5
with no stops. **Do not "improve" the windows while re-baking.**

```bash
.venv/Scripts/python ingest/record.py data/replays/monza-2024-race.jsonl \
  --gp Monza --year 2024 --start-lap 13 --end-lap 17

.venv/Scripts/python ingest/record.py data/replays/monza-2023-race.jsonl \
  --gp Monza --year 2023 --start-lap 19 --end-lap 23

.venv/Scripts/python ingest/record.py data/replays/silverstone-2024-race.jsonl \
  --gp Silverstone --year 2024 --start-lap 25 --end-lap 28
```

### 4.2 Cache / network

All three sessions are already cached locally (`cache/` = 284 MB:
`2023/2023-09-03_Italian_Grand_Prix`, `2024/2024-09-01_Italian_Grand_Prix`,
`2024/2024-07-07_British_Grand_Prix`, plus a 59 MB `fastf1_http_cache.sqlite`). Position,
car, laps and weather data therefore load **offline**. The two network-touching extras —
team radio (`_api.fetch_page`) and race-control messages — should also be served from the
HTTP cache, and both are already wrapped in try/except that degrades to empty.
**Recommendation: re-bake with the network available anyway**, and diff the resulting
`radio` / `messages` counts against the current clips to prove nothing silently vanished.

### 4.3 File sizes, and the size question

Current: 24.2 / 24.9 / 23.4 MB, ~70 MB total — each just under `record.py`'s 25 MB
warning. The new estimator barely moves this (continuous `gapMs` has more distinct values
but the same digit count; pit-lane suppression *removes* some fields).

Cheap wins exist. **Recommendation: NO, not in this PR.**

- Trimming `p.x`/`p.y` from 4 decimals to 3 saves maybe 4%, but 4 decimals is ~0.6 m of
  track at Monza and 3 is ~6 m — visible car jitter on the map. Not worth it.
- The real win is hoisting the constant per-car fields `code` and `team` into the header:
  roughly 20 bytes x 20 cars x 4500 frames ≈ **1.8 MB per clip**, ~8%. But that is a
  **wire-contract change** touching `internal/model`, `web/src/state/race.ts`,
  `check_live_contract.py` and the live path — a separate, cleanly reviewable PR.
- File a follow-up issue: "hoist constant per-car fields into the clip header".

### 4.4 What retires in the frontend afterwards

| item | fate | why |
|---|---|---|
| `lapsDown()` (`timingHelpers.ts:83`) + its 6 tests in `TimingTower.test.ts` | **delete** | It exists solely to reconcile old clips whose `gapLaps` was a lap-*number* difference. After the re-bake no committed clip carries that, and the live path never did. Callers: `TimingTower.tsx:291-292`, `Standings.tsx:27` — both pass `c.gapLaps` straight through instead. |
| `GAP_RESOLUTION_MS = 566` | **delete** | Names a quantum that no longer exists (and misattributes it to "the recorder's cadence"). Referenced only in comments and tests, not in logic. |
| `fmtGapEstimate` (1 decimal) | **keep** | Still the honest precision — ~50–100 ms error rounds to 0.1 s. Update its comment to cite the new error budget. |
| `displayGaps()` monotonic clamp | **keep, demoted to belt-and-braces** | The estimator is monotonic by construction now, so it should never fire on replay. Keep it as a safety net for the **live** lane, whose gaps come from a real feed and can still arrive inconsistently across ticks; note it is no longer load-bearing for replay. |
| `updateGapSmoothing` / `settle` / `GAP_WINDOW = 9` | **keep** | Real gaps genuinely wobble at 10 Hz, and a column repainting every 100 ms is unreadable. The 9-sample median stays wanted. |
| `GAP_HYSTERESIS_MS = 750` | **retune to ~150–200 ms** | 750 was sized as "more than one 566 ms step, less than two". With the quantum gone that threshold now *hides real movement* by up to 0.7 s. Set the new value from the measured p95 in phase 3, not from a guess. |
| `GAP_TITLE` disclaimer tooltip | **keep, reword** | Still derived, not official — but "derived from track position" becomes "derived from track position and the leader's own pace; accurate to about a tenth". |

**Tests that change:** `web/src/components/gapDisplay.test.ts` (the `settle` hysteresis
cases and the 566-multiple fixtures), `web/src/components/TimingTower.test.ts` (the
`lapsDown` describe block goes; `fmtGapEstimate` comment updates),
`web/src/components/Standings.render.test.tsx` (drops the `lapsDown` import).
`web/src/state/race.test.ts` is unaffected — it tests field plumbing, not values.

**`check_live_contract.py` and the Go model: no changes needed.**
`internal/model/model.go:33-35` already carries `GapMs` / `GapLaps` / `IntMs` with
`omitempty`, and `CAR_EXTRA_KEYS` (`check_live_contract.py:23`) already lists all three.
**No new wire fields are introduced.** Only the `// best-effort, derived at record time`
comments on the Go struct need updating to name the new derivation.

**Ghost / overlay: confirmed unaffected.** `Ghost.tsx` reads `lapTrace` and car positions;
it references none of the gap fields.

**`CONTEXT.md`:** the Gap / Interval / Lap-deficit entries keep their "best-effort,
derived at record time" framing (still accurate) — add one clause naming the method
("arc-length progress along the centreline, converted through the leader's own pace") so
the vocabulary page matches the code.

---

## 5. Phases and effort

| phase | work | effort |
|---|---|---|
| **0** | Run `check_gaps.py` against the **current** clips to record before-numbers. Nothing else. | S (~1 h) |
| **1** | `ingest/geometry.py`: dependency-free arc-length centreline, segment projection, distance-time inversion, plus unit tests in the CI contract job. | M (~half a day) |
| **2** | Rewire `record.py`'s gap/interval pass onto it, including pit / lapped / window-edge handling. Delete `_lap_fraction` and `LEADER_LAP_MS`. | M (~half a day) |
| **3** | Finish `check_gaps.py` + thresholds; re-bake all three clips; commit clips plus the error-stat table in the PR body. | M (~half a day, mostly bake time) |
| **4** | Frontend retirement: `lapsDown`, `GAP_RESOLUTION_MS`, hysteresis retune, test and comment updates, `CONTEXT.md` + `ingest/README.md` wording. | S/M (~2–3 h) |
| **5** *(deferred)* | Separate PR: hoist constant per-car fields into the header for ~8% size. | M |

Total roughly **2 days**, split cleanly across 3–4 PRs (geometry+tests / recorder /
re-bake+validation / frontend retirement).

---

## 6. Risks

- **Re-bake churn.** Three ~24 MB files change wholesale in git history. Unavoidable and
  already the status quo; flag it in the PR.
- **A re-bake could silently lose radio or race-control content** if the HTTP cache misses
  and the network is down — both paths degrade to empty with only a warning. Mitigate:
  diff header `radio` length and total `messages` count old vs new before committing, and
  treat any decrease as a failed bake.
- **Centreline from one leader lap.** An odd reference lap shifts the whole field by a
  constant. Mitigate: assert the closed centreline length is within ~2% of the circuit's
  published length, and print it during the bake.
- **Validation thresholds could be fitted to whatever the new code produces.** Mitigate by
  running phase 0 first and quoting both before and after.
- **Hysteresis retune could reintroduce visible jitter** if the estimator is noisier than
  predicted. Mitigate: derive the constant from the measured p95 in phase 3.

---

## 7. Recommendation

**Proceed, in the phase order above.** The defect is real, cheaply fixed, and sits on the
most scrutinised number in the whole demo — a gap column where P4 is closer to the leader
than P3 is the one thing an F1-literate reviewer notices in the first ten seconds. The fix
is ~100 lines of well-understood geometry with genuine ground truth to check against; it
needs no new wire fields, no new dependency and no network, and it lets four frontend
workarounds be deleted rather than accumulated.

Two deliberate non-goals: **do not** change the lap windows (content-chosen), and **do
not** bundle the clip size optimisation (separate contract change).
