// Stops a console window appearing behind the app on Windows release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    satisfactory_companion_lib::run()
}
