# -*- coding: utf-8 -*-
import matplotlib
matplotlib.use("Agg")
matplotlib.rcParams["font.family"] = "Inter"
matplotlib.rcParams["font.sans-serif"] = ["Inter", "Arial", "DejaVu Sans"]
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap
import numpy as np

NAVY="#12263A"; TEAL="#2FB6A8"; MUTED="#6B7787"; INK="#12263A"; LINE="#D8E0EA"
GREEN="#3FA66A"; AMBER="#E0A93B"; RED="#D6533C"

accounts = ["Lockheed Martin","Boeing","RTX","Northrop Grumman","Spirit AeroSystems",
            "Howmet Aerospace","Moog Inc.","Woodward"]
quarters = ["Q4 FY25","Q1 FY26","Q2 FY26","Q3 FY26","Q4 FY26e","Q1 FY27e"]
# quarterly revenue ($K) — illustrative
rev = np.array([
 [820, 910, 980,1120,1210,1300],   # Lockheed - growing
 [540, 560, 600, 640, 660, 690],    # Boeing
 [410, 430, 405, 460, 480, 500],    # RTX
 [300, 320, 360, 380, 410, 440],    # Northrop
 [220, 210, 180, 120,  90,  60],    # Spirit - declining (at risk)
 [180, 190, 200, 205, 210, 215],    # Howmet
 [150, 140, 130, 135, 130, 128],    # Moog - flat/soft
 [110, 120,  90,  40,  20,   0],    # Woodward - churning
], dtype=float)
# retention status per account
status = ["Growing","Stable","Stable","Growing","At risk","Stable","Soft","Churned"]
scol = {"Growing":GREEN,"Stable":TEAL,"Soft":AMBER,"At risk":AMBER,"Churned":RED}

cmap = LinearSegmentedColormap.from_list("btx", ["#F4F8FC","#BFE3DD","#2FB6A8","#12263A"])

fig, ax = plt.subplots(figsize=(11.5, 7.4), dpi=150)
plt.subplots_adjust(bottom=0.20, top=0.90)
im = ax.imshow(rev, cmap=cmap, aspect="auto")

ax.set_xticks(range(len(quarters))); ax.set_xticklabels(quarters, fontsize=10, color=INK)
ax.set_yticks(range(len(accounts))); ax.set_yticklabels(accounts, fontsize=10.5, color=INK)
ax.set_xlabel("Fiscal quarter  (e = forecast)", fontsize=10.5, color=MUTED, labelpad=8)
ax.set_ylabel("Account (canonical)", fontsize=10.5, color=MUTED, labelpad=8)
ax.tick_params(length=0)
for spine in ax.spines.values(): spine.set_visible(False)
ax.set_xticks(np.arange(-.5, len(quarters), 1), minor=True)
ax.set_yticks(np.arange(-.5, len(accounts), 1), minor=True)
ax.grid(which="minor", color="white", linewidth=2.5)
ax.tick_params(which="minor", length=0)

# annotate values ($K); pick text color by cell darkness
vmax = rev.max()
for i in range(len(accounts)):
    for j in range(len(quarters)):
        v = rev[i,j]
        tcol = "white" if v > 0.55*vmax else INK
        label = f"${v:,.0f}K" if v>0 else "$0K"
        ax.text(j, i, label, ha="center", va="center", fontsize=8.6, color=tcol)

# retention status chips on the right
for i,st in enumerate(status):
    ax.text(len(quarters)-0.35, i, "●", ha="left", va="center", fontsize=13, color=scol[st], clip_on=False, transform=ax.transData)
    ax.text(len(quarters)-0.05, i, st, ha="left", va="center", fontsize=9, color=MUTED, clip_on=False, transform=ax.transData)
ax.set_xlim(-0.5, len(quarters)+1.4)

ax.set_title("Figure 1.  Account earnings and retention, Q4 FY25 to Q1 FY27 (forecast)",
             fontsize=15.5, fontweight="bold", color=INK, loc="left", pad=12)

cbar = fig.colorbar(im, ax=ax, fraction=0.025, pad=0.14)
cbar.set_label("Quarterly revenue ($K)", fontsize=9, color=MUTED)
cbar.ax.tick_params(labelsize=8, color=LINE, labelcolor=MUTED)
cbar.outline.set_visible(False)

# ---- research-paper style caption + summary ----
caption = (
 "Each cell is one account's revenue in one fiscal quarter; darker = higher revenue. "
 "The right-hand column reports retention status. Values in $ thousands; e-suffixed quarters are forecast. "
 "Source: HubSpot CRM deals, rolled up to canonical accounts. Internal use only; illustrative sample data.")
summary = (
 "Summary: Revenue is concentrating at the top. Lockheed Martin and Boeing together supply ~55% of quarterly "
 "earnings and are both growing. Two accounts are eroding in parallel: Spirit AeroSystems (at risk, revenue down "
 "~73% across the window) and Woodward (churned to zero). Net read: healthy top-line growth, but rising single-account "
 "concentration and a $270K/qtr retention leak that warrants a targeted save on Spirit.")
import textwrap
cap_wrapped = "\n".join(textwrap.wrap(caption, 150))
sum_wrapped = "\n".join(textwrap.wrap(summary, 150))
fig.text(0.045, 0.135, cap_wrapped, fontsize=8.8, color=MUTED, va="top", ha="left")
fig.text(0.045, 0.055, sum_wrapped, fontsize=9.2, color=INK, va="top", ha="left")

plt.savefig("/sessions/compassionate-gallant-ptolemy/mnt/outputs/BTX_Retention_Earnings_Heatmap.png",
            dpi=150, bbox_inches="tight", facecolor="white")
print("OK")
