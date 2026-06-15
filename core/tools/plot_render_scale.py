#!/usr/bin/env python3
# =============================================================================
# plot_render_scale.py — render the render-wall SCALE sweep into a figure.
#
# Reads docs/phase1/artifacts/render_scale.csv (produced by
# render_scale_dump.exe) and draws a single log-log matplotlib figure to
# docs/phase1/artifacts/render_scale.png showing the RC-8 "render wall cleared"
# verdict at a glance:
#
#   * draw_calls    — FLAT (~tens), bold. The headline: type-bucketed
#                     instancing means draw calls DON'T scale with entities.
#   * item_evals    — the ACTUAL per-frame item work (O(lines) in the near bay),
#                     ~constant because the foreground bay stays fixed-size.
#   * naive_o_items — DASHED, the per-frame work a naive O(items) renderer would
#                     do (== every belt item in flight). This is the explosion
#                     into the millions that the LOD ladder AVOIDS — drawn so the
#                     gap to the actual work is dramatic on a log-y axis.
#
# Pure consumer: reads the CSV, writes the PNG. No core deps.
# =============================================================================
import csv
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
CSV_PATH = os.path.join(ROOT, "docs", "phase1", "artifacts", "render_scale.csv")
PNG_PATH = os.path.join(ROOT, "docs", "phase1", "artifacts", "render_scale.png")


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


def main():
    if not os.path.exists(CSV_PATH):
        sys.stderr.write("plot_render_scale: missing CSV at %s\n" % CSV_PATH)
        sys.stderr.write(
            "Run core/build/render_scale_dump.exe from the project root first.\n")
        return 1

    try:
        import matplotlib
        matplotlib.use("Agg")  # headless / no display
        import matplotlib.pyplot as plt
        from matplotlib.ticker import FuncFormatter
    except ImportError:
        sys.stderr.write("plot_render_scale: matplotlib not available\n")
        return 3

    d = load_csv(CSV_PATH)
    ent = d["entities"]
    draws = d["draw_calls"]
    item_evals = d["item_evals"]
    naive = d["naive_o_items"]

    C_DRAWS = "#2b6cb0"   # draw calls (blue) — the flat headline
    C_EVALS = "#2f855a"   # actual item-eval work (green) — O(lines)
    C_NAIVE = "#c53030"   # naive O(items) baseline (red) — the explosion avoided
    C_GRID = "#cbd5e0"

    plt.rcParams.update({"font.size": 11, "axes.grid": True,
                         "grid.alpha": 0.35, "figure.dpi": 130})

    fig, ax = plt.subplots(figsize=(12, 7), constrained_layout=True)

    # The explosion that DOESN'T happen — dashed, with a soft fill underneath to
    # make the avoided region read as "danger".
    ax.plot(ent, naive, color=C_NAIVE, lw=2.2, ls="--", marker="o", ms=5,
            label="naive O(items) — every belt item, every frame (AVOIDED)",
            zorder=4)
    ax.fill_between(ent, item_evals, naive, color=C_NAIVE, alpha=0.07, zorder=1)

    # The actual per-frame item work — O(lines) in the fixed near bay.
    ax.plot(ent, item_evals, color=C_EVALS, lw=2.6, marker="s", ms=6,
            label="item-evals — actual per-frame work, O(lines) in near bay",
            zorder=5)

    # The headline: draw calls, flat as a board, bold.
    ax.plot(ent, draws, color=C_DRAWS, lw=3.4, marker="D", ms=7,
            label="draw calls — type-bucketed, FLAT (~tens)", zorder=6)

    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("factory entity count")
    ax.set_ylabel("per-frame work (count, log scale)")
    ax.set_title(
        "Render wall cleared — draw calls stay flat as the factory scales "
        "to 100k+",
        fontsize=15, fontweight="bold", pad=12)

    # Human-readable tick labels (1k, 10k, ... ; 1M, 10M).
    def human(v, _pos):
        if v <= 0:
            return "0"
        for div, suf in ((1e9, "B"), (1e6, "M"), (1e3, "k")):
            if v >= div:
                q = v / div
                return ("%g%s" % (q, suf))
        return "%g" % v

    ax.xaxis.set_major_formatter(FuncFormatter(human))
    ax.yaxis.set_major_formatter(FuncFormatter(human))
    ax.set_xticks(ent)
    ax.tick_params(axis="x", labelrotation=0)
    ax.grid(True, which="both", color=C_GRID, alpha=0.35)
    ax.grid(True, which="minor", alpha=0.15)

    # Annotate the 100k point on each of the three series.
    def val_at(xs, ys, x0):
        for i, x in enumerate(xs):
            if int(round(x)) == int(round(x0)):
                return ys[i]
        return None

    x0 = 100000.0
    dc = val_at(ent, draws, x0)
    ie = val_at(ent, item_evals, x0)
    nv = val_at(ent, naive, x0)

    if dc is not None:
        ax.annotate("100k entities -> %d draw calls" % int(round(dc)),
                    xy=(x0, dc), xytext=(8000, dc * 3.2),
                    color=C_DRAWS, fontsize=11, fontweight="bold",
                    ha="left",
                    arrowprops=dict(arrowstyle="->", color=C_DRAWS, lw=1.6))
    if ie is not None:
        ax.annotate("%s item-evals (O(lines))" % human(ie, None),
                    xy=(x0, ie), xytext=(2500, ie * 0.16),
                    color=C_EVALS, fontsize=10.5, fontweight="bold",
                    ha="left",
                    arrowprops=dict(arrowstyle="->", color=C_EVALS, lw=1.4))
    if nv is not None:
        ax.annotate("naive would eval %s items/frame" % human(nv, None),
                    xy=(x0, nv), xytext=(1100, nv * 1.25),
                    color=C_NAIVE, fontsize=10.5, fontweight="bold",
                    ha="left",
                    arrowprops=dict(arrowstyle="->", color=C_NAIVE, lw=1.4))

    # Call out the gap at the right edge (200k).
    xr = ent[-1]
    nv_r = naive[-1]
    ie_r = item_evals[-1]
    if nv_r and ie_r:
        gap = nv_r / ie_r
        ax.text(0.985, 0.06,
                "at 200k entities the naive renderer would do\n"
                "~%dx the item work the LOD ladder actually does" % int(round(gap)),
                transform=ax.transAxes, fontsize=10, color="#1a202c",
                ha="right", va="bottom",
                bbox=dict(boxstyle="round,pad=0.4", facecolor="#f7fafc",
                          edgecolor=C_GRID))

    ax.legend(loc="upper left", fontsize=10, framealpha=0.95)

    fig.savefig(PNG_PATH)
    plt.close(fig)

    size = os.path.getsize(PNG_PATH)
    print("plot_render_scale: wrote %s (%.1f KB, %d points)"
          % (PNG_PATH, size / 1024.0, len(ent)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
