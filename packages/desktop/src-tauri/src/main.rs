//! NoChat Desktop - Main entry point
//!
//! This is the entry point for the NoChat desktop application.
//! All the heavy lifting is done in lib.rs.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    nochat_desktop_lib::run();
}
