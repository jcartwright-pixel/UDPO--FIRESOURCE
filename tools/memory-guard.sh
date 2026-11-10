#!/usr/bin/env bash
# Screen tests' memory guard (11-10-26). Checked every second; every 5 seconds: one MEMORY line with the memory used and the 4 biggest programs.
# A screen test program (node test/browser/...) past 3 GB is asked for a Node report (its JavaScript stack, where it is
# stuck), the report is printed (lines starting STUCK), and the program is stopped, so the run fails with a name and a
# place instead of the machine running out of memory. Needs NODE_OPTIONS with --report-on-signal --report-signal=SIGUSR2
# --report-directory="$REPORTS".
REPORTS="${REPORTS:-$RUNNER_TEMP/node-reports}"
mkdir -p "$REPORTS"
n=0
while true; do
  [ $((n++ % 5)) -eq 0 ] && echo "MEMORY $(date -u +%T) used $(free -m | awk '/Mem/{print $3}')MB of $(free -m | awk '/Mem/{print $2}')MB: $(ps -eo rss=,args= --sort=-rss | head -4 | awk '{a=$2" "$3" "$4" "$5; printf "%dMB %s | ", $1/1024, substr(a,1,110)}')"
  for p in $(pgrep -f '^node .*test/browser/'); do
    rss=$(ps -o rss= -p "$p" 2>/dev/null | tr -d ' ')
    [ -z "$rss" ] && continue
    if [ "$rss" -gt 3000000 ]; then
      echo "STUCK $(date -u +%T) $(ps -o args= -p "$p") at $((rss / 1024)) MB: asking for its report, then stopping it"
      # Where it is looping: the main thread's stack, with the JavaScript names from node's perf map (diagnostic).
      sudo gdb -p "$p" -batch -ex "bt 60" 2>/dev/null | grep -E '^#' > /tmp/stuck-bt.txt
      for i in 1 2 3; do sleep 0.3; sudo gdb -p "$p" -batch -ex "bt 60" 2>/dev/null | grep -E '^#' >> /tmp/stuck-bt.txt; done
      node -e '
        const fs = require("fs"), map = [];
        try { fs.readFileSync("/tmp/perf-" + process.argv[1] + ".map", "utf8").split("\n").forEach(l => { const [a, s, ...n] = l.split(" "); if (a) map.push([parseInt(a, 16), parseInt(s, 16), n.join(" ")]); }); } catch (e) { console.log("STUCK no perf map"); }
        fs.readFileSync("/tmp/stuck-bt.txt", "utf8").split("\n").filter(Boolean).forEach(l => {
          const m = l.match(/0x([0-9a-f]+)/), a = m ? parseInt(m[1], 16) : 0, f = map.find(([s, z]) => a >= s && a < s + z);
          console.log("STUCK bt " + l.slice(0, 160) + (f ? "  <= " + f[2] : ""));
        });' "$p"
      kill -USR2 "$p" 2>/dev/null
      sleep 4
      f=$(ls -t "$REPORTS"/*.json 2>/dev/null | head -1)
      if [ -n "$f" ]; then
        node -e '
          const r = require(process.argv[1]), h = r.javascriptHeap || {}, s = r.resourceUsage || {};
          console.log("STUCK heap used " + Math.round((h.usedMemory || 0) / 1048576) + " MB of " + Math.round((h.totalMemory || 0) / 1048576) + " MB; most memory " + Math.round((s.maxRss || 0) / 1048576) + " MB");
          console.log("STUCK message: " + ((r.javascriptStack || {}).message || ""));
          ((r.javascriptStack || {}).stack || []).slice(0, 40).forEach(l => console.log("STUCK js " + l));
          (r.nativeStack || []).slice(0, 25).forEach(l => console.log("STUCK native " + (l.symbol || "")));
          console.log("STUCK handles: " + (r.libuv || []).map(x => x.type).join(", "));
        ' "$f" || echo "STUCK report could not be read: $f"
      else
        echo "STUCK no report was written"
      fi
      kill -9 "$p" 2>/dev/null
    fi
  done
  sleep 1
done
