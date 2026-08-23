//! Gamepad input via `gilrs`.
//!
//! NOT the browser Gamepad API: Tauri renders with WebKitGTK on Linux, whose
//! Gamepad API support is inconsistent, and this is the one thing the app cannot get
//! wrong (README §2). `gilrs` reads evdev directly, seeing Xbox/DualSense/8BitDo pads
//! the same way Steam does.
//!
//! This thread emits RAW EDGES ONLY — press and release. Repeat rate, initial delay
//! and hold-to-scroll are applied on the frontend so that the browser dev build and
//! this one share a single definition of input feel.
//!
//! ⚠️ On Bazzite 44 the pad reaches us through TWO virtualization layers:
//!
//! ```text
//! physical pad -> InputPlumber virtual device -> Steam Input virtual device -> here
//! ```
//!
//! Consequences this code must respect:
//!
//! - **Never hard-code device names.** What `gilrs` enumerates depends on
//!   InputPlumber's active profile *and* Steam Input's per-shortcut config, and it
//!   differs between Desktop and Game Mode. Enumerate at runtime, re-enumerate on
//!   hotplug — a device list captured once is not a spec.
//! - If the shortcut's controller template is the Desktop layout, the pad emits
//!   keyboard and mouse events instead and this thread legitimately sees NOTHING.
//!   That is configuration, not a bug here.
//! - Either layer can remap buttons before we see them, so a button arriving as the
//!   "wrong" action is not necessarily our mapping being wrong.
//!
//! See private/BAZZITE-NOTES.md §1.

use gilrs::{Button, Event, EventType, Gilrs};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct InputPayload {
    action: &'static str,
    pressed: bool,
}

/// Mapping matches the design's control scheme: dpad moves tile to tile, the
/// shoulders jump shelf to shelf, and the triggers page across a long shelf.
fn action_for(button: Button) -> Option<&'static str> {
    Some(match button {
        Button::DPadUp => "up",
        Button::DPadDown => "down",
        Button::DPadLeft => "left",
        Button::DPadRight => "right",
        Button::South => "accept",   // A
        Button::East => "back",      // B
        Button::West => "secondary", // X
        Button::North => "search",   // Y
        Button::LeftTrigger => "shelfPrev",   // LB
        Button::RightTrigger => "shelfNext",  // RB
        Button::LeftTrigger2 => "pagePrev",   // LT
        Button::RightTrigger2 => "pageNext",  // RT
        Button::Start => "menu",
        _ => return None,
    })
}

/// Left stick is latched into dpad-style edges past this magnitude.
const STICK_DEADZONE: f32 = 0.5;

/// One connected pad, for the Controller settings page's status card.
#[derive(serde::Serialize)]
pub struct PadInfo {
    pub name: String,
    /// Percent, when the pad reports one. A wired pad legitimately reports nothing,
    /// which is why this is `Option` and not 100.
    pub battery_percent: Option<u8>,
    /// gilrs's own word — "Charging", "Discharging", "Wired", "Unknown".
    pub power: Option<String>,
}

/// Which pads are attached right now.
///
/// ⚠️ A FRESH `Gilrs` instance, not the one the input thread owns. `Gilrs` is not
/// `Sync` and the input thread is in a blocking loop it must never be interrupted in
/// — sharing it behind a mutex would mean the settings page could stall the dpad.
/// Enumerating is cheap and this is called once when a page opens.
///
/// ⚠️ Enumerated at call time, never cached. Pads are hot-plugged; a list captured at
/// startup is a list of what *was* connected (private/BAZZITE-NOTES.md §1).
#[tauri::command]
pub fn pad_info() -> Vec<PadInfo> {
    let Ok(gilrs) = Gilrs::new() else { return Vec::new() };
    gilrs
        .gamepads()
        .map(|(_id, pad)| {
            let (battery_percent, power) = match pad.power_info() {
                gilrs::PowerInfo::Discharging(p) => (Some(p), Some("Discharging".into())),
                gilrs::PowerInfo::Charging(p) => (Some(p), Some("Charging".into())),
                gilrs::PowerInfo::Charged => (Some(100), Some("Charged".into())),
                gilrs::PowerInfo::Wired => (None, Some("Wired".into())),
                gilrs::PowerInfo::Unknown => (None, None),
            };
            PadInfo { name: pad.name().to_string(), battery_percent, power }
        })
        .collect()
}

/// Whether the app window currently has focus.
///
/// ⚠️ This exists because `gilrs` reads `/dev/input` DIRECTLY and therefore knows nothing
/// about focus. Keyboard events arrive through the compositor and stop when something
/// else takes over; pad events do not. In Game Mode that means opening Steam's Quick
/// Access Menu over the app leaves the dpad still driving the store underneath — you come
/// back to a completely different screen from the one you left.
///
/// ⚠️ The asymmetry IS the evidence, measured on the box: with the QAM open, a USB
/// keyboard's arrow keys no longer reach the app, while the dpad still drives it. Keyboard
/// input is focus-mediated and stops; `/dev/input` is not and does not. That also implies
/// gamescope genuinely moves focus rather than merely swallowing keys, which is what makes
/// `WindowEvent::Focused` the right signal to hang this on.
///
/// `pad_focus` exposes the flag so the behaviour can be checked directly rather than
/// inferred from whether the store moved.
pub static FOCUSED: AtomicBool = AtomicBool::new(true);

/// What the input thread believes about focus — surfaced for the debug HUD.
#[tauri::command]
pub fn pad_focus() -> bool {
    FOCUSED.load(Ordering::Relaxed)
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut gilrs = match Gilrs::new() {
            Ok(g) => g,
            Err(err) => {
                eprintln!("[input] gilrs unavailable: {err}. Keyboard still works.");
                return;
            }
        };

        for (_id, pad) in gilrs.gamepads() {
            println!("[input] pad: {} ({:?})", pad.name(), pad.power_info());
        }

        // Stick axes are continuous; remember the latched state so we emit one edge
        // per crossing rather than a storm of events every poll.
        let mut stick = [false; 4]; // left, right, up, down

        // Latched actions, so focus loss can release whatever the pad was holding.
        let mut held_buttons: Vec<&'static str> = Vec::new();
        let mut was_focused = true;

        loop {
            let focused = FOCUSED.load(Ordering::Relaxed);

            // ⚠️ On losing focus, RELEASE everything first. A direction held at the
            // moment Steam's menu opens would otherwise stay latched forever: the press
            // was delivered, the release is swallowed, and the store scrolls on its own
            // when focus returns.
            if was_focused && !focused {
                for action in held_buttons.drain(..) {
                    let _ = app.emit("input://action", InputPayload { action, pressed: false });
                }
                for (i, latched) in stick.iter_mut().enumerate() {
                    if *latched {
                        *latched = false;
                        let action = ["left", "right", "up", "down"][i];
                        let _ = app.emit("input://action", InputPayload { action, pressed: false });
                    }
                }
            }
            was_focused = focused;

            while let Some(Event { event, .. }) = gilrs.next_event() {
                // ⚠️ Drained, not skipped. `gilrs` queues events regardless, so returning
                // early here would bank every press made while the menu was open and
                // replay the lot the instant it closed.
                if !focused {
                    continue;
                }
                match event {
                    EventType::ButtonPressed(button, _) => {
                        if let Some(action) = action_for(button) {
                            if !held_buttons.contains(&action) {
                                held_buttons.push(action);
                            }
                            let _ = app.emit("input://action", InputPayload { action, pressed: true });
                        }
                    }
                    EventType::ButtonReleased(button, _) => {
                        if let Some(action) = action_for(button) {
                            held_buttons.retain(|a| *a != action);
                            let _ = app.emit("input://action", InputPayload { action, pressed: false });
                        }
                    }
                    EventType::AxisChanged(axis, value, _) => {
                        let (index, action) = match axis {
                            gilrs::Axis::LeftStickX if value < -STICK_DEADZONE => (0, "left"),
                            gilrs::Axis::LeftStickX if value > STICK_DEADZONE => (1, "right"),
                            gilrs::Axis::LeftStickY if value > STICK_DEADZONE => (2, "up"),
                            gilrs::Axis::LeftStickY if value < -STICK_DEADZONE => (3, "down"),
                            // Back inside the deadzone: release whichever axis this is.
                            gilrs::Axis::LeftStickX => {
                                for i in [0usize, 1] {
                                    if stick[i] {
                                        stick[i] = false;
                                        let a = if i == 0 { "left" } else { "right" };
                                        let _ = app.emit("input://action", InputPayload { action: a, pressed: false });
                                    }
                                }
                                continue;
                            }
                            gilrs::Axis::LeftStickY => {
                                for i in [2usize, 3] {
                                    if stick[i] {
                                        stick[i] = false;
                                        let a = if i == 2 { "up" } else { "down" };
                                        let _ = app.emit("input://action", InputPayload { action: a, pressed: false });
                                    }
                                }
                                continue;
                            }
                            _ => continue,
                        };
                        if !stick[index] {
                            stick[index] = true;
                            let _ = app.emit("input://action", InputPayload { action, pressed: true });
                        }
                    }
                    _ => {}
                }
            }
            // gilrs has no blocking read; poll at a rate well under one frame so the
            // dpad never feels behind the UI.
            std::thread::sleep(std::time::Duration::from_millis(4));
        }
    });
}
