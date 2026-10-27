#!/bin/bash
# Joe 10/25: the Driver Room TV board on a Raspberry Pi plugged into the TV's HDMI. Run once on the Pi, from its Terminal:
#   curl -sL https://ud-distribution.web.app/tv/pi-setup.sh | bash
# It makes the Pi, every time it powers on: sign in to its desktop by itself, never blank the screen, send a 1920 x 1080
# picture, turn the TV on and switch it to the Pi (HDMI-CEC), and open the Driver's Kiosk Station board full screen. The TV code is typed once on the
# board; Chrome keeps it. Nothing here touches the app or any other computer. Safe to run again (it replaces its own lines).
set -e
URL="${1:-https://ud-distribution.web.app/driver-station.html?tv=1}"
ME="$(id -un)"
HOME_DIR="$(getent passwd "$ME" | cut -d: -f6)"
echo "Setting up the Driver Room TV board for user $ME ..."

sudo apt-get update -y
sudo apt-get install -y v4l-utils
BROWSER="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$BROWSER" ]; then sudo apt-get install -y chromium-browser || sudo apt-get install -y chromium; BROWSER="$(command -v chromium-browser || command -v chromium)"; fi

# Desktop signs in by itself; the labwc desktop; the screen never blanks.
sudo raspi-config nonint do_boot_behaviour B4
sudo raspi-config nonint do_wayland W3 || true
sudo raspi-config nonint do_blanking 1 || true

# The browser: full screen, no "restore pages" bubble after a power cut, video plays with no button press, the board's
# timers never slowed down as if it were in the background (Joe 10/27: the lists stopped rolling), and it starts again by
# itself if it ever closes.
mkdir -p "$HOME_DIR/.local/bin" "$HOME_DIR/.config/labwc"
cat > "$HOME_DIR/.local/bin/ud-board" <<SH
#!/bin/bash
P="$HOME_DIR/.config/chromium/Default/Preferences"
[ -f "\$P" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"[A-Za-z]*"/"exit_type":"Normal"/' "\$P"
exec "$BROWSER" --kiosk --noerrdialogs --disable-infobars --no-first-run --password-store=basic \
  --autoplay-policy=no-user-gesture-required --check-for-update-interval=31536000 \
  --disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding \
  --force-device-scale-factor=1 "$URL"
SH
chmod +x "$HOME_DIR/.local/bin/ud-board"

# The TV: turn it on and switch it to the Pi at start-up, and every 10 minutes only if the TV is off (needs the TV's
# SIMPLINK / HDMI-CEC on). Joe 10/27: the TV went on and off; the 10-minute check no longer announces the Pi again or
# switches the TV's input while the TV is already on.
cat > "$HOME_DIR/.local/bin/ud-tv-on" <<'SH'
#!/bin/bash
for d in /dev/cec0 /dev/cec1; do
  [ -e "$d" ] || continue
  if [ "$1" = boot ]; then
    cec-ctl -d "$d" --playback >/dev/null 2>&1
  else
    cec-ctl -d "$d" --to 0 --give-device-power-status 2>/dev/null | grep -qi 'pwr-state: *\(standby\|to-on\|to-standby\)' || continue
  fi
  cec-ctl -d "$d" --to 0 --image-view-on >/dev/null 2>&1
  pa=$(cec-ctl -d "$d" 2>/dev/null | sed -n 's/.*Physical Address *: *\([0-9.]*\).*/\1/p' | head -1)
  [ -n "$pa" ] && cec-ctl -d "$d" --to 15 --active-source phys-addr="$pa" >/dev/null 2>&1
done
exit 0
SH
chmod +x "$HOME_DIR/.local/bin/ud-tv-on"

# The picture: 1920 x 1080, whatever the TV can do. Joe 10/27: on the 4K TV the board came out tiny (he had to zoom) and the
# Pi froze drawing four times the dots every time the lists rolled. Set at start-up for the desktop, and for the start
# screen too.
cat > "$HOME_DIR/.local/bin/ud-screen" <<'SH'
#!/bin/bash
command -v wlr-randr >/dev/null || exit 0
for o in HDMI-A-1 HDMI-A-2; do wlr-randr --output "$o" --mode 1920x1080@60Hz >/dev/null 2>&1 || wlr-randr --output "$o" --mode 1920x1080 >/dev/null 2>&1; done
exit 0
SH
chmod +x "$HOME_DIR/.local/bin/ud-screen"
CMD=/boot/firmware/cmdline.txt; [ -f "$CMD" ] || CMD=/boot/cmdline.txt
if [ -f "$CMD" ] && ! grep -q 'video=HDMI-A-1:1920x1080' "$CMD"; then
  sudo sed -i '1 s/$/ video=HDMI-A-1:1920x1080@60 video=HDMI-A-2:1920x1080@60/' "$CMD"
fi

AUTO="$HOME_DIR/.config/labwc/autostart"
touch "$AUTO"
sed -i '/ud-board\|ud-tv-on\|ud-screen/d' "$AUTO"
RESPAWN="$(command -v lwrespawn || true)"
cat >> "$AUTO" <<SH
$HOME_DIR/.local/bin/ud-screen
$HOME_DIR/.local/bin/ud-tv-on boot &
$RESPAWN $HOME_DIR/.local/bin/ud-board &
SH
( crontab -l 2>/dev/null | grep -v ud-tv-on; echo "*/10 * * * * $HOME_DIR/.local/bin/ud-tv-on" ) | crontab -

echo
echo "Done. Restarting in 10 seconds. The board opens by itself; type the TV code once."
sleep 10
sudo reboot
