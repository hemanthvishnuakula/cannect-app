#!/usr/bin/env python3
"""
Cannect Intelligence - Scheduled Runner
Runs extraction during off-peak hours with load awareness
"""

import subprocess
import time
from datetime import datetime
import os

# Configuration
RUN_24_7 = True      # Run anytime, not just off-peak
OFF_PEAK_START = 0   # 12 AM (ignored if RUN_24_7)
OFF_PEAK_END = 6     # 6 AM (ignored if RUN_24_7)
BATCH_SIZE = 500     # Posts per run (increased for 24/7 mode)
MAX_LOAD = 4.0       # Max 1-minute load average (4 cores = allow full usage)

def get_load_average():
    """Get 1-minute load average"""
    try:
        with open('/proc/loadavg', 'r') as f:
            return float(f.read().split()[0])
    except:
        return 0.5

def is_off_peak():
    """Check if current time is in off-peak window (or always True if RUN_24_7)"""
    if RUN_24_7:
        return True
    hour = datetime.now().hour
    return OFF_PEAK_START <= hour < OFF_PEAK_END

def run_batch():
    """Run the batch processor"""
    print(f"[{datetime.now()}] Starting extraction batch...")
    
    result = subprocess.run(
        ['/root/cannect-intel/venv/bin/python', '/root/cannect-intel/batch.py', 'run', str(BATCH_SIZE)],
        capture_output=True,
        text=True,
        cwd='/root/cannect-intel'
    )
    
    print(result.stdout)
    if result.stderr:
        print(f"Errors: {result.stderr}")
    
    return result.returncode == 0

def main():
    print(f"=== Cannect Intelligence Scheduler ===")
    print(f"Off-peak window: {OFF_PEAK_START}:00 - {OFF_PEAK_END}:00")
    print(f"Batch size: {BATCH_SIZE} posts")
    print(f"Max load: {MAX_LOAD}")
    
    if not is_off_peak():
        hour = datetime.now().hour
        print(f"Current hour: {hour}:00 - Outside off-peak window, exiting")
        return
    
    load = get_load_average()
    print(f"Current load: {load:.2f}")
    
    if load > MAX_LOAD:
        print(f"Load too high ({load:.2f} > {MAX_LOAD}), skipping this run")
        return
    
    run_batch()
    print(f"[{datetime.now()}] Batch complete")

if __name__ == '__main__':
    main()
