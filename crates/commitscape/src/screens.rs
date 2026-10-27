use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::PathBuf;

use clap::Args;
use commitscape_report::pack::{open_unpacked, read_pack, unpack, PackError};
use commitscape_report::screens::standard;

#[derive(Args)]
pub struct ScreensArgs {
    /// The pack a Build wrote.
    pack: PathBuf,

    /// Where to write the screens: one JSON object of answers, each under
    /// the key the Site asks it by.
    #[arg(long, value_name = "FILE")]
    out: PathBuf,
}

/// Works out the standard screens of a pack's head, reading the pack's columns in place, and writes them as one JSON object.
pub fn run(args: ScreensArgs) -> anyhow::Result<()> {
    let unpacked = args.out.with_extension("unpacked");
    let pack = match unpack(&args.pack, &unpacked) {
        Ok(_) => {
            let opened = open_unpacked(&unpacked);
            let _ = std::fs::remove_file(&unpacked);
            opened?
        }
        Err(PackError::Format(_)) => read_pack(&std::fs::read(&args.pack)?)?,
        Err(e) => return Err(e.into()),
    };
    let screens: serde_json::Map<String, serde_json::Value> = standard(&pack).into_iter().collect();
    let mut out = BufWriter::new(File::create(&args.out)?);
    serde_json::to_writer(&mut out, &screens)?;
    out.flush()?;
    Ok(())
}
