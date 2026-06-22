from run import parse_cpu_perc, parse_mem_mb


def test_parse_cpu_perc():
    assert parse_cpu_perc("35.20%") == 35.2
    assert parse_cpu_perc("0.00%") == 0.0
    assert parse_cpu_perc("n/a") is None


def test_parse_mem_mb():
    assert parse_mem_mb("180MiB / 7.6GiB") == 180.0
    assert parse_mem_mb("1.5GiB / 7.6GiB") == 1536.0
    assert parse_mem_mb("512KiB / 7.6GiB") == 0.5
    assert parse_mem_mb("garbage") is None
