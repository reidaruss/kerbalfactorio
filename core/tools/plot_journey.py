#!/usr/bin/env python3
# =============================================================================
# plot_journey.py — render the headless journey CSV into a readable figure.
#
# Reads docs/phase1/artifacts/journey.csv (produced by journey_dump.exe) and
# draws a multi-panel matplotlib figure to docs/phase1/artifacts/journey.png:
#
#   (a) altitude vs time, with the ACTIVE / ON-RAILS phases shaded differently
#       and the SOI-switch (Forge→Cinder) moment marked,
#   (b) factory produced-count vs time (on a twin axis over panel a, plus its
#       own dedicated panel), proving the base kept working the whole flight,
#   (c) speed vs time, again phase-shaded.
#
# Pure consumer: reads the CSV, writes the PNG. No core deps.
# =============================================================================
import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CSV_PATH = os.path.join(ROOT, "docs", "phase1", "artifacts", "journey.csv")
PNG_PATH = os.path.join(ROOT, "docs", "phase1", "artifacts", "journey.png")


def load_csv(path):
    cols = {}
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        names = reader.fieldnames
        for n in names:
            cols[n] = []
        for row in reader:
            for n in names:
                cols[n].append(float(row[n]))
    return cols


def contiguous_runs(times, modes, want):
    """Yield (t_start, t_end) spans where mode == want (0=active, 1=rails)."""
    runs = []
    start = None
    for i, m in enumerate(modes):
        on = (int(round(m)) == want)
        if on and start is None:
            start = times[i]
        elif not on and start is not None:
            runs.append((start, times[i]))
            start = None
    if start is not None:
        runs.append((start, times[-1]))
    return runs


def main():
    if not os.path.exists(CSV_PATH):
        sys.stderr.write("plot_journey: missing CSV at %s\n" % CSV_PATH)
        sys.stderr.write("Run core/build/journey_dump.exe from the project root first.\n")
        return 1

    try:
        import matplotlib
        matplotlib.use("Agg")  # headless / no display
        import matplotlib.pyplot as plt
        from matplotlib.patches import Patch
        from matplotlib.lines import Line2D
    except ImportError:
        sys.stderr.write("plot_journey: matplotlib not available\n")
        return 3

    d = load_csv(CSV_PATH)
    t = d["simTime_s"]
    alt = d["altitude_km"]
    terr = d["terrainAltitude_km"]
    speed = d["speed_mps"]
    mode = d["mode"]
    produced = d["factoryProduced"]
    soi = d["soiSwitches"]
    dist = d["distToCinder_km"]

    # Phase spans for shading.
    active_runs = contiguous_runs(t, mode, 0)
    rails_runs = contiguous_runs(t, mode, 1)

    # First time SOI switch count increments (Forge -> Cinder crossing).
    soi_time = None
    for i in range(1, len(soi)):
        if int(round(soi[i])) > int(round(soi[i - 1])):
            soi_time = t[i]
            break

    C_ACTIVE = "#2b6cb0"   # active flight (blue)
    C_RAILS = "#dd6b20"    # on-rails coast (orange)
    C_ALT = "#1a202c"
    C_PROD = "#2f855a"     # factory (green)
    C_SPEED = "#805ad5"    # speed (purple)
    C_SOI = "#c53030"      # SOI marker (red)

    plt.rcParams.update({"font.size": 10, "axes.grid": True,
                         "grid.alpha": 0.3, "figure.dpi": 130})

    fig, (ax1, ax2, ax3) = plt.subplots(
        3, 1, figsize=(12, 11), sharex=True,
        gridspec_kw={"height_ratios": [3, 2, 2]},
        constrained_layout=True)

    def shade(ax):
        for (a, b) in active_runs:
            ax.axvspan(a, b, color=C_ACTIVE, alpha=0.07, zorder=0)
        for (a, b) in rails_runs:
            ax.axvspan(a, b, color=C_RAILS, alpha=0.10, zorder=0)
        if soi_time is not None:
            ax.axvline(soi_time, color=C_SOI, lw=1.8, ls="--", zorder=5)

    # ---- Panel (a): altitude + factory twin axis ----------------------------
    shade(ax1)
    ax1.plot(t, alt, color=C_ALT, lw=1.6, label="altitude above mean radius")
    ax1.plot(t, terr, color="#718096", lw=1.0, ls=":", label="altitude above terrain")
    ax1.set_ylabel("altitude (km)")
    ax1.set_title("Orbital Foundry — Forge→Cinder slice journey",
                  fontsize=15, fontweight="bold", pad=12)

    axp = ax1.twinx()
    axp.plot(t, produced, color=C_PROD, lw=2.0, label="factory produced")
    axp.set_ylabel("factory items produced", color=C_PROD)
    axp.tick_params(axis="y", labelcolor=C_PROD)
    axp.grid(False)

    if soi_time is not None:
        ymax = max(alt)
        ax1.annotate("SOI switch\nForge→Cinder",
                     xy=(soi_time, ymax * 0.50),
                     xytext=(soi_time - 42, ymax * 0.72),
                     color=C_SOI, fontsize=9, fontweight="bold",
                     ha="center",
                     arrowprops=dict(arrowstyle="->", color=C_SOI))

    legend_elems = [
        Line2D([0], [0], color=C_ALT, lw=1.6, label="altitude (mean radius)"),
        Line2D([0], [0], color="#718096", lw=1.0, ls=":", label="altitude (terrain)"),
        Line2D([0], [0], color=C_PROD, lw=2.0, label="factory produced"),
        Patch(facecolor=C_ACTIVE, alpha=0.18, label="ACTIVE (integrated)"),
        Patch(facecolor=C_RAILS, alpha=0.22, label="ON-RAILS (Kepler)"),
        Line2D([0], [0], color=C_SOI, lw=1.8, ls="--", label="SOI switch"),
    ]
    ax1.legend(handles=legend_elems, loc="upper left", fontsize=8,
               framealpha=0.9, ncol=2)

    # ---- Panel (b): factory produced on its own (clear monotonic climb) ------
    shade(ax2)
    ax2.plot(t, produced, color=C_PROD, lw=2.0)
    ax2.fill_between(t, 0, produced, color=C_PROD, alpha=0.12)
    ax2.set_ylabel("factory items produced")
    ax2.set_ylim(bottom=0)
    ax2.text(0.012, 0.86,
             "the base keeps working through every phase\n"
             "(active ascent, on-rails orbit, transfer, descent)",
             transform=ax2.transAxes, fontsize=8.5, color=C_PROD,
             va="top")

    # ---- Panel (c): speed + distance-to-Cinder twin -------------------------
    shade(ax3)
    ax3.plot(t, speed, color=C_SPEED, lw=1.5, label="speed")
    ax3.set_ylabel("speed (m/s)", color=C_SPEED)
    ax3.tick_params(axis="y", labelcolor=C_SPEED)
    ax3.set_xlabel("sim time (s)")

    axd = ax3.twinx()
    axd.plot(t, dist, color="#3182ce", lw=1.3, ls="-.", label="dist to Cinder")
    axd.set_ylabel("distance to Cinder centre (km)", color="#3182ce")
    axd.tick_params(axis="y", labelcolor="#3182ce")
    axd.grid(False)

    ax3.legend(loc="upper left", fontsize=8, framealpha=0.9)
    axd.legend(loc="upper right", fontsize=8, framealpha=0.9)

    fig.savefig(PNG_PATH)
    plt.close(fig)

    size = os.path.getsize(PNG_PATH)
    print("plot_journey: wrote %s (%.1f KB, %d samples)"
          % (PNG_PATH, size / 1024.0, len(t)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
