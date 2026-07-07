# Headless Blender harness for the Natural Building GC add-on server.
#
# Runs inside `blender --background --python tools/blender_headless_server.py`
# and keeps the add-on's HTTP server (port 8000) alive by pumping its build /
# IFC-export queues manually — bpy.app.timers don't fire reliably without a UI
# event loop, so the timer the add-on registers is not enough in background.
#
# The studio backend spawns this automatically when "Sync to Blender" or
# "Export IFC" is used while no Blender is running (see backend/blender-
# launcher.mjs). Lifetime defaults to 60 minutes; pass a number of minutes
# after `--` to change it:  blender --background --python <this> -- 15
import sys
import time

import addon_utils

lifetime_min = 60.0
if "--" in sys.argv:
    try:
        lifetime_min = float(sys.argv[sys.argv.index("--") + 1])
    except (IndexError, ValueError):
        pass

try:
    addon_utils.enable("natural_house_designer", default_set=False)
except Exception as exc:  # noqa: BLE001 - report and exit, nothing to clean up
    print("ENABLE-FAIL", exc, flush=True)
    sys.exit(1)

from natural_house_designer import server  # noqa: E402

server.start_server()
print("HARNESS-READY", flush=True)

deadline = time.time() + lifetime_min * 60
while time.time() < deadline:
    try:
        server.check_queue_and_build()
    except Exception as exc:  # noqa: BLE001 - keep pumping; a bad state must not kill the server
        print("PUMP-ERROR", exc, flush=True)
    time.sleep(0.05)

print("HARNESS-DONE", flush=True)
