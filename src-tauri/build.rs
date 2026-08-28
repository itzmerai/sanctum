fn main() {
    // The window and installer icons are embedded into the executable by the
    // build script, but cargo only reruns it when something it knows about
    // changes. Without these, regenerating `icons/` leaves the previous icon
    // baked into a binary that then rebuilds in under a second and looks like
    // it worked -- the icon silently stays stale until an unrelated Rust
    // change happens to force a rebuild.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    tauri_build::build()
}
