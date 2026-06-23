from run import parse_cpu_perc, parse_mem_mb, StatsSampler


def test_parse_cpu_perc():
    assert parse_cpu_perc("35.20%") == 35.2
    assert parse_cpu_perc("0.00%") == 0.0
    assert parse_cpu_perc("n/a") is None


def test_parse_mem_mb():
    assert parse_mem_mb("180MiB / 7.6GiB") == 180.0
    assert parse_mem_mb("1.5GiB / 7.6GiB") == 1536.0
    assert parse_mem_mb("512KiB / 7.6GiB") == 0.5
    assert parse_mem_mb("garbage") is None


def test_sampler_start_stop_does_not_collide_with_thread_internals():
    # Regression: the stop Event must not be named `_stop` — that shadows
    # threading.Thread._stop() and makes join() raise "Event is not callable".
    # Runs against a bogus container so docker stats yields nothing; we only
    # care that start()/stop() complete cleanly.
    s = StatsSampler("no-such-container-xyz")
    s.start()
    s.stop()  # would raise TypeError if _stop shadowed Thread._stop
    assert not s.is_alive()
