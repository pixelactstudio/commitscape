use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};

use clap::Args;
use commitscape_report::pack::{open_unpacked, read_pack, unpack, PackError};
use commitscape_report::universe::{atlas, write_rows};

#[derive(Args)]
pub struct AtlasArgs {
    /// The pack a Build wrote.
    pack: PathBuf,

    /// The folder to write the Atlas into, as `map.bin.br` and
    /// `names.bin.br`.
    #[arg(long, value_name = "DIR")]
    out: PathBuf,

    /// How hard brotli packs the Atlas, 1 to 11.
    #[arg(long, default_value_t = 5, value_parser = clap::value_parser!(u32).range(1..=11))]
    quality: u32,

    /// Also write the map and the names uncompressed (`map.bin`,
    /// `names.bin`) and the rows they are made from (`universe.jsonl`).
    #[arg(long, hide = true)]
    raw: bool,
}

fn packed(bytes: &[u8], quality: u32, to: &Path) -> anyhow::Result<()> {
    let params = brotli::enc::BrotliEncoderParams {
        quality: quality as i32,
        lgwin: 24,
        size_hint: bytes.len(),
        ..Default::default()
    };
    let mut out =
        brotli::CompressorWriter::with_params(BufWriter::new(File::create(to)?), 1 << 16, &params);
    out.write_all(bytes)?;
    out.flush()?;
    Ok(())
}

/// Makes the Universe's Atlas of a pack, reading the pack's columns in place, and writes its map and names packed with brotli as the Site sends them.
pub fn run(args: AtlasArgs) -> anyhow::Result<()> {
    std::fs::create_dir_all(&args.out)?;
    let unpacked = args.out.join("atlas.unpacked");
    let pack = match unpack(&args.pack, &unpacked) {
        Ok(_) => {
            let opened = open_unpacked(&unpacked);
            let _ = std::fs::remove_file(&unpacked);
            opened?
        }
        Err(PackError::Format(_)) => read_pack(&std::fs::read(&args.pack)?)?,
        Err(e) => return Err(e.into()),
    };
    let made = atlas(&pack)?;
    if args.raw {
        std::fs::write(args.out.join("map.bin"), &made.map)?;
        std::fs::write(args.out.join("names.bin"), &made.names)?;
        let mut rows = BufWriter::new(File::create(args.out.join("universe.jsonl"))?);
        write_rows(&pack, &mut rows)?;
        rows.flush()?;
    }
    packed(&made.map, args.quality, &args.out.join("map.bin.br"))?;
    packed(&made.names, args.quality, &args.out.join("names.bin.br"))?;
    Ok(())
}
