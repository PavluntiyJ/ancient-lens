//! Read-only diagnostic for the production account reader; does not alter Store.
fn main() {
    let mut reader = ancient_lens::own_account::Reader::default();
    for _ in 0..2 {
        println!(
            "{}",
            // Running this probe by hand is the consent to read memory.
            serde_json::to_string(&reader.poll(&serde_json::Value::Null, true)).unwrap()
        );
        std::thread::sleep(std::time::Duration::from_secs(3));
    }
}
