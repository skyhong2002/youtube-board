#!/usr/bin/env bash
# Print the 1-minute load average (Linux /proc/loadavg, macOS sysctl vm.loadavg).
if [ -r /proc/loadavg ]; then cut -d' ' -f1 /proc/loadavg; else sysctl -n vm.loadavg | awk '{print $2}'; fi
